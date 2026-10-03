# Server setup — Вінниця alert bot

**Read this on `homeserver` (192.168.50.69). You are finishing a deployment that is
already 90% done.**

The bot watches Ukrainian air-threat Telegram channels and notifies the owner only when
the city of **Вінниця** is named. Full rationale is in `DESIGN.md`; how to operate it is
in `README.md`. This file covers only getting it running here.

> This is a **supplement** to sirens and the official «Повітряна тривога» app, never a
> replacement. It runs on hardware in Ukraine with no external health monitoring:
> silence from this bot means nothing. Do not add claims to the contrary.

---

## 1. State you should find

Everything below was done from the owner's Mac before you were asked to help.

| | |
|---|---|
| Code | `/home/f13r/telegram-alert` (rsynced from the Mac) |
| Dependencies | installed (`npm ci`) |
| Build | done (`dist/` present) |
| Tests | 21/21 passing |
| `.env` | present, mode `0600`, all values filled |
| `data/` | exists, empty |
| systemd service | **NOT installed** ← this is the remaining work |
| Running process | **none** |

Verify in one go:

```bash
cd /home/f13r/telegram-alert
ls dist/index.js && ls -l .env && ls -ld data
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
systemctl is-enabled vinnytsia-alert 2>/dev/null || echo "service not installed (expected)"
pgrep -f 'dist/index.js' || echo "not running (expected)"
```

Expected: `# pass 21`, `# fail 0`, `.env` showing `-rw-------`, both "expected" lines.

**If `dist/` or `node_modules/` is missing**, the code was never pushed or the push was
partial. Do not try to fetch it from here — this machine has no access to the Mac. Ask
the owner to run this **on the Mac**:

```bash
cd ~/html/telegram-alert && ./deploy/deploy.sh
```

That rsyncs source, copies `.env` as 0600, and runs `npm ci && npm run build` here.

---

## 2. Do this first: stop the Mac instance

The bot is currently running **on the owner's Mac**. Two instances across two machines
would:

- double the `t.me` scrape traffic, which gets the IP throttled by Telegram
- deliver duplicate alerts
- break `/start` and `/status` with `409 Conflict` — two Bot API long-polls on one token

The PID lock in `data/bot.pid` only protects against two copies on the *same* machine.
It cannot see across hosts.

Ask the owner to run **on the Mac**:

```bash
pkill -f 'dist/index.js'
```

Do not continue until they confirm it is stopped.

---

## 3. Install the systemd service

This needs `sudo`, and `sudo` on this box requires a password. You cannot supply it —
ask the owner to run this and paste the output back:

```bash
sudo cp /home/f13r/telegram-alert/deploy/vinnytsia-alert.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vinnytsia-alert
systemctl status vinnytsia-alert --no-pager
```

`enable` is what starts it again after a power cut — the single most important flag
here, because the host is in Ukraine and loses power during exactly the events the bot
exists to warn about.

### Why the unit looks the way it does

Read `deploy/vinnytsia-alert.service`. Points worth preserving if you edit it:

- `Restart=always`, `RestartSec=10` — survives crashes
- `StartLimitIntervalSec=0` — never stops retrying during a flaky boot after a blackout
- `ProtectHome=read-only` **plus** `ReadWritePaths=.../data` — systemd refuses to start
  if that directory does not exist, so never delete `data/`
- `WorkingDirectory` — the app reads `config/*.json` by relative path

---

## 4. Verify it is actually working

```bash
systemctl is-active vinnytsia-alert          # active
journalctl -u vinnytsia-alert -n 20 --no-pager
```

You want:

```
[boot]   source=scrape channels=4 loud≥90% cooldown=15m fresh=10m
[scrape] baseline pass over 4 channels
[scrape] polling every 20s
[bot]    polling
```

`[bot] polling` means the Bot API side is live and commands will answer.

Then confirm all four channels are readable from this host:

```bash
cd /home/f13r/telegram-alert && npm run scrapecheck
```

Expected: four `✓` lines. A `302` on one channel is **transient, not a dead channel** —
the source backs off exponentially (2→4→8→16→30 min, capped) and recovers on its own. Do
not "fix" it by removing the channel. The cause is not yet known: it is NOT plain per-IP
rate limiting (other channels stay 200 at the same moment, and a 1 req/s burst is fine).
Each 302 now logs a `[scrape:302]` line with the redirect target, headers, time since the
last good poll, and whether `?before=` still answers:

```bash
journalctl -u vinnytsia-alert | grep 'scrape:302'
```

---

## 5. Re-subscribe the owner

Subscriptions live in `data/data.json`, which is host-local and deliberately **not**
synced by `deploy.sh`. This machine's copy is empty, so alerts currently go nowhere but
the journal.

Get the join link (never print the secret into a chat or commit it anywhere):

```bash
cd /home/f13r/telegram-alert
echo "https://t.me/vinnitsya_alert_bot_bot?start=$(grep '^JOIN_SECRET=' .env | cut -d= -f2)"
```

The owner opens that on their **main phone**. They should see
«✅ Підписано на сповіщення про загрозу для Вінниці». Then confirm:

```bash
node -e 'console.log(require("./data/data.json").subscribers)'
```

Finally ask them to send `/status` to the bot. If it replies, the whole chain —
scraper → matcher → confidence → Bot API → their phone — is proven.

Remind them once: give that chat a **loud custom notification sound** and a
Do-Not-Disturb exception. The entire alert design assumes the loud message wakes them.

---

## 6. Operating it afterwards

```bash
journalctl -u vinnytsia-alert -f                      # live
journalctl -u vinnytsia-alert --since '6 hours ago' | grep alert
sudo systemctl restart vinnytsia-alert
sudo systemctl stop vinnytsia-alert
```

Updates are pushed **from the Mac**, not edited here — this directory is an rsync
target and local edits are destroyed by the next `deploy.sh --delete`:

```bash
# on the Mac
cd ~/html/telegram-alert && ./deploy/deploy.sh
```

Optional, so deploys can restart the service without a password prompt:

```bash
echo 'f13r ALL=(ALL) NOPASSWD: /bin/systemctl restart vinnytsia-alert' \
  | sudo tee /etc/sudoers.d/vinnytsia-alert
sudo chmod 440 /etc/sudoers.d/vinnytsia-alert
```

### Auditing missed mentions

Every message from every channel is logged, matched or not. After any raid:

```bash
cd /home/f13r/telegram-alert
grep -i 'вінн\|винн\|vinn' data/shadow-*.ndjson | jq -r 'select(.matched==false) | .text'
```

Anything real in that output is a phrasing to add to that town's file in `config/towns/` — then run
`npm test`, which executes the fixtures in all the config files.

---

## 7. Rules

- **One instance anywhere.** Never run `npm start` here while the service is active, and
  never while the Mac copy is running.
- **Never print, commit or paste `.env`, `TG_SESSION`, `BOT_TOKEN` or `JOIN_SECRET`.**
  `TG_SESSION` grants full access to a Telegram *user account* with no second factor.
- **Do not widen the matching rules on your own.** City-only is a deliberate decision by
  the owner: oblast forms (`Вінниччина`, `Вінницька область`) are excluded on purpose,
  and the exclusion is structural, not a blocklist. See `DESIGN.md` §2–3.
- **Do not make the watchdog chattier.** It warns only when *every* channel is dark at
  once. Per-channel silence used to be reported and woke the owner at night for a system
  that was working; that is why the rule is what it is. See `DESIGN.md` §11.
- **Do not add health-monitoring claims.** There is no external dead-man switch. If this
  host is off, nothing warns anyone. The owner accepted that knowingly.
- **`npm test` must pass before and after any change you make.**

---

## 8. Known state, as of this handoff

- MTProto ingestion is **blocked**: Telegram refuses to deliver login codes for newly
  created `api_id`s on this owner's accounts (three different apps, two accounts, two
  days, identical `SentCodeTypeApp`-with-no-delivery). The bot therefore runs on
  `SOURCE=scrape`. If a working `api_id` ever appears, `npm run login` writes
  `TG_SESSION` and the source switches automatically — no other change.
- `@war_monitor` is intermittently offline by its own admission («Тимчасово офлайн»).
  That is normal and not a fault; the confidence model simply scores lower without it.
- Latency on the scraper is roughly 15–30s versus ~1s for MTProto.
