# Air-alert bot — Вінниця, Ладижин, Козятин

Watches Ukrainian air-threat Telegram channels and notifies you **only** when a town you
follow is named — with a confidence score based on how many channels corroborate.
Each subscriber picks towns with `/cities`.

> Supplement to sirens and the official «Повітряна тривога» app, never a replacement.
> It runs on hardware in Ukraine with no external health monitoring: silence from this
> bot means nothing.

See [DESIGN.md](DESIGN.md) for why every rule is the way it is.

## Setup

```bash
npm install
cp .env.example .env          # fill BOT_TOKEN and JOIN_SECRET
npm start                     # runs on the scraper, no Telegram credentials needed
```

### Ingestion sources

`SOURCE` picks one; the default is `scrape`.

| Source | Latency | Needs | Notes |
|---|---|---|---|
| `scrape` | ~15–60s | nothing | polls public `t.me/s/<channel>` pages |
| `fake` | — | nothing | replay fixtures or type messages by hand |

Check the scraper still parses (its main failure mode is silent markup drift):

```bash
npm run scrapecheck
```

## Running without Telegram

The whole pipeline works with no credentials at all.

```bash
# replay a scripted raid
SOURCE=fake SCENARIO=config/scenario.json DRY_RUN=1 npm run dev

# type messages by hand
SOURCE=fake DRY_RUN=1 npm run dev
> @kpszsu | Вінниця: реактивний БпЛА в напрямку міста з півдня

npm test
```

## Tuning

| File | Controls |
|---|---|
| `config/towns/<id>.json` | one town: name forms, exclusions, match fixtures |
| `config/vocabulary.json` | homoglyph folding and invisible-char stripping, shared |
| `config/threat-keywords.json` | danger words for mixed-content channels |
| `config/channels.json` | channels, reliability, correlation window, loud threshold |
| `.env` | credentials, cooldown/freshness/retention |

Every config file carries its own fixtures, and `npm test` runs them.

To add a town, copy a file in `config/towns/`, give it a new `id` and `order`, and fill
its fixtures with real posts (search `t.me/s/<channel>?q=<name>`). Read DESIGN.md §3
first — masculine `-ин` names need enumerated endings. Change a rule,
run the tests, and you will know immediately what else you changed.

## Auditing misses

Every message from every channel is logged, matched or not:

```bash
grep -i 'вінн\|винн\|vinn\|ладиж\|козят' data/shadow-*.ndjson | jq -r 'select(.matched==false) | .text'
```

Anything real in that output is a phrasing to add to that town's file in `config/towns/`.

## Watchdog

The scraper can fail silently — changed markup, a renamed channel, a network that is
up but blocked. The watchdog catches that, but it only speaks when **every** channel
has gone dark at once:

```
⚠️ Жоден канал не читається вже 2 год.
   Схоже на проблему з мережею або блокування t.me.
   Перевірте: npm run scrapecheck
```

A single quiet channel is never reported. Monitoring channels go quiet when there is
nothing to report, and one of them posts «тимчасово офлайн» for hours at a time — as
long as any other channel is still producing posts, the pipeline is demonstrably
working, and waking someone to say otherwise is worse than saying nothing.

Per-channel detail is available on demand via `/status`, and in the log. It is never
pushed.

Warns once, re-arms on recovery (`✅ Потік відновлено`). Tuned by
`WATCHDOG_QUIET_HOURS` (default 6) and `WATCHDOG_PARSE_STALE_HOURS` (default 1).

It cannot tell you the host is off — nothing running on that host can.

## Commands

| Command | Behaviour |
|---|---|
| `/start <secret>` | subscribe (deep link only) |
| `/cities` | choose towns — tap to toggle |
| `/stop` | unsubscribe |
| `/status` | uptime, channels, your towns, cooldown per town |
| `/test <text>` | which towns this text would alert for, and why |

## Running on the Pi

```ini
# /etc/systemd/system/vinnytsia-alert.service
[Unit]
Description=Vinnytsia alert bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/telegram-alert
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
npm run build
sudo systemctl enable --now vinnytsia-alert
```

`Restart=always` plus `enable` is what brings it back unattended after a blackout.
