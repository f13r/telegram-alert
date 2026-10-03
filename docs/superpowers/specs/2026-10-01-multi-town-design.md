# Multi-town alerts — Design

**Date:** 2026-10-01
**Status:** approved in chat, awaiting spec review

## Goal

The bot currently alerts only for Вінниця. Add a curated catalogue of towns —
initially **Вінниця, Ладижин, Козятин** — and let every subscriber switch any town on
or off from the Telegram chat (e.g. drop Ладижин in a few days without touching the
server).

## Decisions

| Area | Decision |
|---|---|
| Who picks | Each subscriber, several towns at once |
| Catalogue | Curated, one hand-checked config file per town, fixtures required |
| Default | Every town ON — for new subscribers, existing ones, and towns added later |
| Stored as | `off: string[]` per subscriber (muted ids), missing = all on |
| Threat window | One per town. A raid on Козятин does not spend Вінниця's loud alert |
| Confidence | Per town, same formula `1 − Π(1 − rᵢ)` |
| Multi-town post | One message per subscriber, header lists only towns they follow |
| Loudness | Loud if ANY of the subscriber's matched towns is loud |
| UI | `/cities` inline keyboard, tap toggles |
| Channels | Unchanged. All four cover the whole oblast |
| Danger filter | Unchanged, shared across towns |
| Watchdog | Unchanged, goes to all subscribers regardless of towns |

## Matching research

A corpus of **204 real posts** was pulled from all four channels via
`t.me/s/<channel>?q=<name>` and every form extracted.

| Town | Forms seen in the wild | Posts | Candidate regex hit |
|---|---|---|---|
| Ладижин | Ладижин 56, Ладижині 22, Ладижина 6, `Гайсин-Ладижин`, `→Гайсин -Ладижин` | 86 | 86/86 |
| Козятин | Козятин 64, Козятині 23, `Козятин-1` 12 (rail station), Козятина 10, Козятину 1 (non-standard genitive), Козятином 1 | 99 | 99/99 |

No Russian spellings (Ладыжин, Казатин) appeared in any channel. Kept anyway as a
cheap fallback.

### Why Вінниця's `stem + \p{L}{0,2}` rule is NOT reused

For masculine `-ин` towns, two trailing letters reach real non-city words:

| Word | What it is | Seen in corpus |
|---|---|---|
| Ладижинка / Ладижинку / Ладижинці | village in Уманський р-н, **Черкаська** обл. | no |
| ладижинці, козятинці | residents (plural demonym) | yes: «козятинці фіксували підвищений тиск газу» |
| козятинка | female resident | no |

So these towns enumerate their case endings explicitly. Вінниця (feminine) keeps its
existing rule untouched.

### Regexes

All Cyrillic patterns run on the **normalized** text (lowercased, homoglyphs folded).

```
ladyzhyn-uk  (?<!\p{L})ладижин(?:а|у|ом|і|е)?(?!\p{L})
ladyzhyn-ru  (?<!\p{L})ладыжин(?:а|у|ом|е)?(?!\p{L})
koziatyn-uk  (?<!\p{L})козятин(?:а|у|ом|і|е)?(?!\p{L})
koziatyn-ru  (?<!\p{L})(?:казатин|козятин)(?:а|у|ом|е)?(?!\p{L})
```

Latin runs on the **raw** text, literal alternation plus the existing negative
lookahead extended with `hromada|community`:

```
ladyzhyn-latin  Ladyzhyn Ladyzhin Ladyżyn Ladyschyn Ladyzyn
koziatyn-latin  Koziatyn Kozyatyn Kozjatyn Kosjatyn Kazatin Kozyatin Koziatin
lookahead       \s*(?:oblast|oblasts|region|regional|raion|rayon|district|area|province|hromada|community)\b
```

Hyphens and arrows are not letters, so `Гайсин-Ладижин`, `→Гайсин -Ладижин` and
`Козятин-1` match. `Козятин-1` is the city's own station — correct to alert.

### Fixtures (minimum)

**ladyzhyn shouldMatch:** «🚀Група ракет на Вінниччині курс на Ладижин.»,
«У Ладижині вибухи», «Реактивний БпЛА у напрямку Ладижина на Вінниччині з південного
сходу», «над Ладижином», «Ладижину загрожує», «Близько 4 БпЛА рухаються крізь
Вінничину, Гайсин-Ладижин Північно-Західним курсом.», «→Гайсин -Ладижин», «ЛАДИЖИН»,
«Лади́жин», «#Ладижин», «взрывы в Ладыжине», «на Ладыжин», «Ladyzhyn», «drones over
Ladyzhin».

**ladyzhyn shouldNotMatch:** «Ладижинська ТЕС», «на Ладижинську ТЕС», «Ладижинська
громада», «Ладижинка», «БпЛА на Ладижинку», «у Ладижинці», «ладижинці вийшли»,
«ладижинець», «Ладыжинская ТЭС», «Ladyzhyn hromada», «Ladyzhynka».

**koziatyn shouldMatch:** «😱 «Шахед» на критично низькій висоті пролетів над
Козятином», «у Козятині», «🛵 Вінниччина - БпЛА в районі Іллінців та Козятина.»,
«Вінниччина: 1х реактивний шахед в районі Козятину.», «Козятин-1», «⚠️ 7х БпЛА з
Уманського району у напрямку Погребище Козятин і далі по курсу.», «КОЗЯТИН»,
«Козя́тин», «на Казатин», «в Казатине», «Kozyatyn», «Koziatyn under attack».

**koziatyn shouldNotMatch:** «Козятинський район», «Козятинського району»,
«Козятинщина», «на Козятинщині», «козятинці фіксували», «козятинка», «козятинець»,
«Казатинский район», «Koziatyn Raion», «Koziatyn district».

**Cross-town:** every town's `shouldMatch` must match **only** that town. (Mentions
of Вінниччина inside a Ладижин fixture are fine — the oblast matches no town.)

### Accepted risk

Villages also named **Козятин** exist in Сумська (Охтирка area) and Волинська
oblasts. Identical spelling — no lexical rule separates them. None appeared in the
corpus. Accepted, same class as the existing `винниця` = distillery collision.

## 1. Config layout

```
config/
├── vocabulary.json      normalization only (homoglyphs, invisible chars) — shared
└── towns/
    ├── vinnytsia.json   moved from vocabulary.json unchanged, fixtures included
    ├── ladyzhyn.json
    └── koziatyn.json
```

Town file:

```json
{
  "id": "ladyzhyn",
  "name": "Ладижин",
  "header": "ЛАДИЖИН",
  "targets": [
    { "id": "ladyzhyn-uk", "script": "cyrillic", "matchOn": "normalized", "regex": "..." },
    { "id": "ladyzhyn-ru", "script": "cyrillic", "matchOn": "normalized", "regex": "..." },
    { "id": "ladyzhyn-latin", "script": "latin", "matchOn": "raw", "literals": [], "negativeLookahead": "..." }
  ],
  "excluded": {},
  "fixtures": { "shouldMatch": [], "shouldNotMatch": [] }
}
```

`config.ts` loads every `config/towns/*.json` and fails at boot on a duplicate `id`
or an empty catalogue. Button and header order comes from a required `order` number
in each file: Вінниця 1, Ладижин 2, Козятин 3.

## 2. Matcher

```ts
matchTowns(raw: string): TownMatch[]   // [{ townId, form, targetId }], one per town
```

Returns every town named, first hit per town. Old `matchTown` is removed; callers
(`pipeline.ts`, `bot.ts /test`) move to the new one.

## 3. Storage

```ts
interface Subscriber { chatId: number; name: string; since: string; off?: string[] }
interface StorageData {
    subscribers: Subscriber[];
    windows: Record<string, WindowState>;   // was: window
    alertedIds: Record<string, number>;     // key "channel:msgId:townId"
}
```

- **Migration on load:** a legacy `window` becomes `windows.vinnytsia`; the legacy
  field is dropped on next persist. Legacy `alertedIds` keys are left alone and
  expire by their 24 h TTL.
- `off` may contain an id no longer in the catalogue → ignored.
- New helpers: `getTownWindow(id)` (creates empty on demand), `saveWindows()`,
  `toggleTown(chatId, townId): boolean | null` (null = not subscribed),
  `followedTowns(sub): string[]`.

## 4. Pipeline

```
cfg unknown                       → ignore
matches = matchTowns(text)
no matches                        → shadow log
stale                             → shadow log 'stale'
requiresThreat && !danger         → shadow log 'not-danger'
for each match:
    key = channel:msgId:town; if alerted → skip that town
    decision[town] = recordMatch(windows[town], channel, now); markAlerted(key)
no fresh decisions                → shadow log 'already-alerted'
persist windows once
deliver(msg, text, label, decisions)
```

`recordMatch` (window.ts) is unchanged. Per-town isolation comes from passing each
town its own `WindowState`.

Shadow log record gains `towns: string[]`; `confidencePct` becomes
`Record<townId, number>`.

## 5. Delivery

`PipelineDeps.send(html, silent)` becomes:

```ts
deliver(decisions: Map<townId, WindowDecision>, render: (towns: string[]) => string): Promise<void>
```

For each subscriber: `towns = matched − off`. Empty → skip. Group subscribers by the
sorted `towns` key, render once per group, `silent = !towns.some(t => decision[t].loud)`.

Format (`format.ts`):

```
🚨 ЛАДИЖИН 90% · КОЗЯТИН 90% ↑

<channel text, verbatim>

war_monitor · 14:02 · відкрити ↗
```

- Icon: `🚨` if any shown town is loud, else `•`.
- Each town: `HEADER pct%`, plus ` ↑` if escalated, plus ` (непідтверджено)` if
  below threshold.
- Footer `підтверджено (N джерел)` only when exactly one town is shown.
- Single-town output for Вінниця stays byte-identical to today, except header text
  now comes from the town file.

DRY_RUN and the zero-subscriber console print keep working: print each distinct
group once, or the all-towns render when there are no subscribers.

Watchdog warnings bypass town filtering and go to all subscribers (`broadcastAll`).

## 6. Bot

| Command | Behaviour |
|---|---|
| `/cities` | Inline keyboard, one row per town: `✅ Вінниця` / `⬜ Козятин`. Non-subscriber → «Ви не підписані.» |
| button `town:<id>` | Toggle in `off`, persist, `editMessageReplyMarkup`, `answerCbQuery('Ладижин вимкнено')`. Unknown id → answer «Місто більше не відстежується» |
| all off | Message text gains «⚠️ Ви не відстежуєте жодного міста — сповіщень не буде.» |
| `/start <secret>` | Lists towns, points to `/cities`. No more «для Вінниці» |
| `/status` | Window line per town; caller's followed towns |
| `/test <text>` | Each matched town with its form; danger result unchanged |

`bot.telegram.setMyCommands` registers `start, cities, status, test, stop` at launch.

## 7. Testing

- Town fixtures: iterate `config/towns/*.json`; every `shouldMatch` hits its own town,
  every `shouldNotMatch` hits nothing.
- Cross-town: no fixture matches a different town than intended.
- Corpus fixtures above are included verbatim.
- Window isolation: loud on Козятин, then loud on Вінниця minutes later; confidence
  does not leak between towns.
- Delivery: muted town not sent; two-town post = one message; loud if any is loud;
  subscriber with no overlap gets nothing; group rendering called once per group.
- Storage migration: legacy `window` → `windows.vinnytsia`; `off` absent = all on;
  toggle on/off round-trip; toggle by non-subscriber returns null.
- Existing 24 vocabulary + 13 threat fixtures, window and watchdog tests still pass.

## 8. Docs

- DESIGN.md §3: per-town files, explicit endings for `-ин` towns and why, Козятин
  village collision as accepted risk. §4: window per town. §10: `/cities`.
- README: tuning table points to `config/towns/`, how to add a town, `/cities`.
- `package.json` description no longer Вінниця-only.

## Out of scope

- Adding/removing towns from the catalogue via chat (catalogue = config files).
- Oblast-level or raion-level matching.
- Per-subscriber thresholds or quiet hours.
- New channels.
