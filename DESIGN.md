# Air-Alert Bot — Design

Monitors Ukrainian air-alert Telegram channels and pushes a notification **only** when
a town from a curated catalogue is named — currently Вінниця, Ладижин, Козятин. Each
subscriber chooses which of those towns they get (`/cities`).

> **Scope statement.** This is a *supplement* to sirens, the official «Повітряна тривога»
> app and local authorities — never a primary warning. It runs on hardware in Ukraine
> with no external health monitoring, so silence from this bot means nothing.

---

## 1. Architecture

```
  monitored channels (public)
            │
            │  https://t.me/s/<channel>, polled every ~20 s
            ▼
  ┌──────────────────────┐
  │ scraper              │   no Telegram account, no credentials
  │ (src/sources/scrape) │   new posts + edits, 302 → backoff
  └──────────┬───────────┘
             │ post text
             ▼
  ┌──────────────────────┐
  │ normalize            │  NFC, strip stress/invisibles, latin→cyrillic homoglyphs
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │ match (vocabulary)   │  cyrillic on normalized, latin on raw
  └──────────┬───────────┘
             │ hit                        ├── every message ──▶ shadow log (NDJSON)
             ▼
  ┌──────────────────────┐
  │ threat window        │  confirmed hit = LOUD + 15 min cooldown; missiles pass it
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │ telegraf Bot API     │  sendMessage → every subscriber
  └──────────────────────┘
```

**Why a scraper and no user account:** reading needs no login, so no personal Telegram
account is ever at risk. The only identity is the bot, which only writes. A user-account
(MTProto) reader was built first and removed on 2026-10-03: Telegram never delivered its
login code, so it never ran. The cost is latency — roughly 15–60 s instead of ~1 s.

## 2. Decisions

| Area | Decision |
|---|---|
| Ingestion | Polls public `t.me/s/<channel>` preview pages; no Telegram account |
| Channel access | Public channels only, allowlist in `config/channels.json`; nothing to join |
| Match scope | **Town only**, curated catalogue in `config/towns/`. Oblast / raion / Вінниччина deliberately excluded |
| Town choice | Per subscriber, toggle buttons via `/cities`; every town on by default |
| Danger filter | Threat-keyword requirement, **mixed-content channels only** |
| Confidence | Noisy-OR across corroborating channels; ≥90% delivered, below = **not sent** |
| Match method | Stem + max-2-suffix + word boundary (uk, ru) · literal alternation (latin) |
| Events | New posts, edits, photo/video captions. **Albums not handled** |
| Alert fatigue | **Cooldown per town**: a confirmed hit is LOUD and starts a fixed 15 min cooldown; nothing is sent during it and posts do not extend it. Missile/КАБ posts pass the cooldown and restart it. See `docs/adr/0001-fixed-cooldown.md` |
| Restart | Freshness cutoff 10 min; older matches dropped **silently**, no gap notice |
| Delivery | Separate bot → private chats |
| Recipients | Subscriber list in `data/data.json`, gated by secret deep link |
| Hosting | Raspberry Pi / home machine in Ukraine |
| Health monitoring | No external dead-man switch (accepted risk). Internal watchdog warns when a source goes dark |
| Validation | Rotating shadow log (7d) + `/test` command |

## 3. Matching

One file per town in `config/towns/<id>.json`: targets, excluded forms and fixtures
together. `config/vocabulary.json` holds only the shared normalization. `npm test`
runs every town's fixtures and checks that no fixture matches a different town.

`matchTowns(text)` returns **every** town a post names — "Погребище Козятин і далі на
Ладижин" is one post, two towns.

### Вінниця

```js
uk:    /(?<!\p{L})вінниц\p{L}{0,2}(?!\p{L})/giu     // matches on NORMALIZED text
ru:    /(?<!\p{L})винниц\p{L}{0,2}(?!\p{L})/giu     // matches on NORMALIZED text
latin: literal alternation + negative lookahead on (oblast|raion|region|…)
                                                    // matches on RAW text
```

The `{0,2}` suffix cap is what separates the **city** from the **oblast adjective**:

```
Вінниця Вінниці Вінницю Вінницею Віннице   = stem + 0–2  → ALERT
Вінницька Вінницький Вінниччина            = stem + 3+   → ignored
```

No blocklist is maintained. Exclusion is structural. `config/towns/vinnytsia.json` carries
the excluded forms only as a regression fixture.

Latin cannot use this trick (`Vinnytsia Oblast` contains the bare city name), so it
uses a negative lookahead instead.

**Known collision:** `винниця` is a real Ukrainian noun (*distillery / vineyard*) and
declines identically to the Russian spelling. Accepted — vanishing probability in an
air-alert feed.

**Known blind spot:** map screenshots posted with no caption are unmatchable by any design.

### Ладижин, Козятин — enumerated endings

Masculine `-ин` towns cannot use `stem + \p{L}{0,2}`. Two free letters reach real
non-town words:

```
Ладижинка, Ладижинку, Ладижинці   village in Уманський р-н, Черкаська обл.
ладижинці, козятинці              residents (seen in the wild: «козятинці фіксували…»)
козятинка                         female resident
```

So their endings are listed explicitly:

```js
uk: /(?<!\p{L})ладижин(?:а|у|ом|і|е)?(?!\p{L})/iu
ru: /(?<!\p{L})ладыжин(?:а|у|ом|е)?(?!\p{L})/iu
uk: /(?<!\p{L})козятин(?:а|у|ом|і|е)?(?!\p{L})/iu
ru: /(?<!\p{L})(?:казатин|козятин)(?:а|у|ом|е)?(?!\p{L})/iu    // Казатин = Russian official name
```

Verified against 204 real posts from all four channels (`t.me/s/<ch>?q=<name>`):
Ладижин 86/86, Козятин 99/99, including `Гайсин-Ладижин`, `Козятин-1` (the city's
station) and the non-standard genitive `Козятину`. No channel used a Russian spelling.

**Known collision:** villages also named **Козятин** exist in Сумська and Волинська
oblasts. Identical spelling, no lexical rule separates them. None seen in the corpus.
Accepted.

### Adding a town

Copy a town file, set a new `id` and `order`, write targets, add real posts to
`shouldMatch` and every same-stem non-town word to `shouldNotMatch`, run `npm test`.
Masculine `-ин`/`-ів` names: enumerate endings. Adjective names (Хмельницький) need
their own design — the suffix trick does not apply at all.

### Landmark mentions

`config/vocabulary.json → referencePoint`. A town named only as a reference point is
not a threat to it:

```
"1х реактивний східніше Вінниці на Погребище"     ✗ dropped  (reference-point)
"Шахед на південний захід від м. Вінниця"        ✗ dropped
"БпЛА восточнее Винницы"                         ✗ dropped
"…східніше Вінниці, далі курс на Вінницю"         ✓ alert    (second mention is real)
"БпЛА повз Вінницю"                              ✓ alert    (passing the city is a threat)
```

A mention directly after a compass comparative (`східніше`, `північно-західніше`, …) or
a «на схід від» / «к востоку от» phrase does not count. If the town is named nowhere
else, the post is dropped and shadow-logged with `dropped: "reference-point"` and
`landmarkOnly: [...]`. Added after a real false loud alert on 2026-10-01.

## 3b. Danger filter

`config/threat-keywords.json`. Applied **only** to channels with `requiresThreat: true`
— currently just `@vinnitsa_vinnistya`, which is a general local-news channel:

```
"2 БпЛА на Вінницю"                       ✓ danger
"У Вінниці не буде води та світла"        ✗ dropped
"У Вінниці відремонтували кабінет"        ✗ dropped  (каб is word-anchored)
"У Вінниці відкрили курси англійської"    ✗ dropped
```

Keywords are word-boundary anchored, never raw substrings. `каб` must not match
`кабінет`, `ппо` must not match `ппозиція`. `міг` was deliberately **removed** from the
list — it is also the past tense of *могти* and would fire on ordinary news.

The three pure air-threat channels are **unfiltered**, so an unusual phrasing there can
never be silently dropped. 13 fixtures, all passing.

## 3c. Confidence

Each channel carries a `reliability` r. Confidence is standard independent-evidence
combination over every channel that reported a match inside the correlation window
(20 min):

```
confidence = 1 − Π(1 − rᵢ)
```

| Reporting channels | Confidence | Delivery |
|---|---|---|
| Типова Вінниця alone | 50% | **not sent** — shadow-logged `dropped: "unconfirmed"` |
| one reliable channel | 90% | 🚨 LOUD |
| Типова Вінниця + one reliable | 95% | 🚨 LOUD |
| two reliable | 99% | 🚨 LOUD |
| three or four | 100% | 🚨 LOUD |

`loudThresholdPct: 90`. **Below the threshold nothing is sent.** Типова Вінниця alone is
a local-news channel; a match there is recorded in the town's window but delivered only
once a reliable channel reports the same town. That reliable post then arrives LOUD with
the combined confidence («95% · підтверджено (2 джерела)»). Added after a hospital-
procedures article («…під час повітряних тривог…ударних дронів…») went out as an alert
on 2026-10-02.

Confidence is per town and resets with every loud alert, so after a cooldown it is built
from fresh posts only.

## 3d. Channels

| Channel | Type | r | Danger filter |
|---|---|---|---|
| `@kpszsu` | official ПС ЗСУ | 0.9 | no |
| `@ukraine_pyxx` | air-threat tracking | 0.9 | no |
| `@war_monitor` | air-threat tracking | 0.9 | no |
| `@vinnitsa_vinnistya` | **general local news** | 0.5 | **yes** + footer stripping |

All four are public and read through their `t.me/s/` pages — no subscription needed. A
channel without a web preview (`webPreview: false`) cannot be read at all.

## 4. Threat window

One per town, shared by all subscribers — a raid is a shared event, and a raid on
Козятин must not put Вінниця in cooldown. Confidence is per town too.

```
state: { loudAt, sources, fastSources }

match arrives
  ├─ now - loudAt < COOLDOWN_MIN (15)   →  in cooldown
  │    ├─ missile / КАБ (threat-fast.json), ≥90%  →  SEND, LOUD, cooldown restarts
  │    └─ anything else                            →  not sent, not counted,
  │                                                   shadow-logged `cooldown`
  └─ not in cooldown
       ├─ reaches ≥90%                  →  SEND, LOUD, cooldown starts
       └─ below                         →  not sent, counts toward confidence,
                                           shadow-logged `unconfirmed`
every LOUD clears sources: after a cooldown, confidence starts fresh
```

**At most one message per town per 15 minutes**, measured from the loud alert, not from
the last post. A long raid sends a message every ~15 minutes while posts keep coming; a
drone flurry within one minute still sends once. Missiles and КАБ get through any
cooldown because they reach a town in minutes. In a digest post with region headers
(«Сумщина: … Вінниччина: …») a missile counts only for towns in its own section, plus
any preamble before the first header — «Харківщина: ракети… Вінниччина: БпЛА на
Ладижин» is a drone for Ладижин. Replaced the sliding 30 min window on
2026-10-03: posts kept extending it, so a second threat during a long raid was never
sent (00:09 Ладижин).

A post naming several towns lists only the towns that went loud; towns in cooldown are
left out of the header, the text stays as written.

Persisted to `DATA_DIR` (`windows.<townId>`) so a restart mid-cooldown does not re-trigger
a loud alert. A pre-towns `data.json` with a single `window` loads as `windows.vinnytsia`;
a pre-cooldown window that already announced counts as loud at its last match.

## 5. Edits

`alertedIds: Set<"channel:messageId:townId">` with 24 h TTL, persisted.

- Edit arrives, id already alerted for that town → ignore (typo fix, no re-notify)
- Edit adds a town the post did not name before → alert for that town only
- Edit arrives, id not alerted, now matches, within freshness → alert normally

## 6. Alert format

```
🚨 ВІННИЦЯ · 95%

<channel text, verbatim, never paraphrased, promo footer stripped>

<channel title> · HH:MM · підтверджено (2 джерела) · відкрити ↗
```

- Always `🚨` and loud — at most one per town per cooldown, missiles excepted

Several towns in one post → one message per subscriber, listing only the towns they
follow, each with its own confidence. Unconfirmed towns are left out. Loud if any listed
town is loud:

```
🚨 ЛАДИЖИН 99% · КОЗЯТИН 90%
```
- Text is escaped, never reformatted. Only the channel's own promo footer is stripped
  (`stripFooterPatterns` per channel), so what you read is what they wrote.

## 7. Layout

```
telegram-alert/
├── config/
│   ├── vocabulary.json     shared normalization
│   ├── towns/              one file per town, fixtures included
│   ├── channels.json       ✅ 4 channels, reliabilities, footer patterns
│   ├── threat-keywords.json ✅ written, 13 fixtures pass
│   └── threat-fast.json    missiles + КАБ: pass a cooldown
├── src/
│   ├── index.ts            wiring
│   ├── sources/scrape.ts   t.me/s poller, edits, backoff, 302 diagnostics
│   ├── matcher.ts          normalize + compile vocabulary → regex
│   ├── window.ts           per-town cooldown + confidence accumulation
│   ├── danger.ts           threat-keyword filter (mixed channels only) + fast-threat test
│   ├── notify.ts           telegraf send fan-out
│   ├── storage.ts          data.json (subscribers, window, alertedIds)
│   ├── shadow.ts           NDJSON log, 7-day rotation
│   └── types.ts
├── scripts/scrapecheck.ts  checks every channel's page still parses
├── test/towns.test.ts     runs every config/towns/*.json fixture set
├── test/matcher.test.ts   threat-keywords fixtures, window, footer
└── DESIGN.md
```

Stack mirrors `telegram-lybohora`: TypeScript, ESM, `tsx` for dev, `telegraf`, `dotenv`.
Adds `axios` + `cheerio` for the scraper. `node-cron` only for shadow-log rotation.

## 8. Environment

```
BOT_TOKEN=          # @BotFather
JOIN_SECRET=        # deep-link payload for /start
DATA_DIR=./data
COOLDOWN_MIN=15
FRESHNESS_MIN=10
SHADOW_RETENTION_DAYS=7
```

`.env` is gitignored. `BOT_TOKEN` lets anyone send as the bot — never commit or paste it.

## 9. Resilience on a Pi

- `systemd` unit, `Restart=always`, `RestartSec=10`, `WantedBy=multi-user.target`
  (survives power return unattended)
- Scraper: a failed or throttled channel (302) backs off exponentially, capped at
  30 min, and is retried forever — home internet flaps and t.me throttling are expected
- On start the first poll still alerts on posts younger than `FRESHNESS_MIN`, so a
  threat posted during a restart is not lost
- Shadow log rotated daily, 7 days retained — bounded SD-card writes
- Consider: UPS on the Pi + router, and an LTE fallback. Without power the bot is dark
  and, per the decision above, nothing will tell you.

## 11. Watchdog

Hourly. Reports **only system-wide** failure:

| Condition | Threshold | Message |
|---|---|---|
| no channel readable | 1 h | `⚠️ Жоден канал не читається` + cause if known |
| all readable, none posting | 6 h | `⚠️ Жодного допису з усіх каналів` |
| recovered | — | `✅ Потік відновлено` |

**A single quiet or unreadable channel is never pushed.** Channels go quiet legitimately
(`@war_monitor` posts «тимчасово офлайн» for hours; a local news channel sleeps at
night), so one channel's silence carries no information about the pipeline while any
other channel is still delivering. Pushing it produced a night-time notification for a
system that was working perfectly — the exact failure this watchdog exists to avoid
causing.

Per-channel health is on demand via `/status`, never pushed.

**It cannot detect the host being off.** Nothing running on the host can. That remains
the accepted risk from section 2.

## 10. Commands

| Command | Behaviour |
|---|---|
| `/start <secret>` | Subscribe, if payload matches `JOIN_SECRET` |
| `/start` | Refuse politely |
| `/stop` | Unsubscribe |
| `/cities` | Toggle buttons, one per town. All off is allowed, with a warning |
| `/status` | Uptime, channels, your towns, cooldown per town |
| `/test <text>` | Which towns match and which form hit |
