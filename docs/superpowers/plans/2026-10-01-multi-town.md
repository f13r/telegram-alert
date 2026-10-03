# Multi-town alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alert for a curated catalogue of towns (Вінниця, Ладижин, Козятин), each with its own threat window, and let every subscriber toggle towns from the chat via `/cities`.

**Architecture:** Town vocabularies move to `config/towns/*.json`. `matchTowns()` returns every town named in a post. Storage keeps one `WindowState` per town and an `off` list per subscriber. The pipeline runs the unchanged `recordMatch` once per matched town, then a delivery step groups subscribers by the towns they follow and sends one rendered message per group.

**Tech Stack:** TypeScript (ESM, NodeNext), telegraf 4, node:test via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-01-multi-town-design.md`

## Global Constraints

- Вінниця regexes, literals and fixtures move unchanged; all 24 existing vocabulary fixtures and 13 threat fixtures must still pass.
- Ладижин/Козятин Cyrillic patterns enumerate endings: uk `(?:а|у|ом|і|е)?`, ru `(?:а|у|ом|е)?`, never `\p{L}{0,2}`.
- `recordMatch` in `src/window.ts` is not modified.
- Default is every town ON; storage holds `off: string[]` only.
- Single-town Вінниця alert text stays identical to today's format.
- Watchdog warnings go to every subscriber regardless of `off`.
- Not a git repo — "commit" steps are replaced by running the full suite (`npm test`) and `npx tsc --noEmit`.

## Review Focus

- Legacy `data.json` (with `window`, no `windows`, subscribers without `off`) must load without losing the subscriber or the open Вінниця window → test in Task 2.
- An `off` entry for a town no longer in the catalogue must not crash or hide other towns → test in Task 2.
- A post naming two towns where one was already alerted (edit) must alert only the new town → test in Task 4.
- A subscriber who muted every town must receive no alert but still receive watchdog warnings → test in Task 3 (grouping) + Task 4.
- A tapped button for a town id that was removed from the catalogue must answer, not throw → test in Task 5.

---

## File structure

| File | Change |
|---|---|
| `config/towns/vinnytsia.json` | new — Вінниця targets/excluded/fixtures moved from vocabulary.json |
| `config/towns/ladyzhyn.json` | new |
| `config/towns/koziatyn.json` | new |
| `config/vocabulary.json` | keep `normalization` only |
| `src/config.ts` | `TownCfg`, `towns`, `townById` |
| `src/types.ts` | `TownMatch`, `Subscriber.off`, `StorageData.windows` |
| `src/matcher.ts` | `matchTowns()` |
| `src/storage.ts` | per-town windows, migration, `toggleTown`, `followedTowns`, `getSubscriber` |
| `src/notify.ts` | `groupByTowns`, `sendTo`; `broadcast` stays for watchdog |
| `src/format.ts` | multi-town header |
| `src/pipeline.ts` | per-town loop, `deliver` dep |
| `src/index.ts` | `deliver` implementation |
| `src/bot.ts` | `/cities`, callback, `citiesKeyboard`, updated `/start` `/status` `/test` |
| `src/shadow.ts` | `towns`, `confidencePct: Record` |
| `scripts/scrapecheck.ts` | per-town counts |
| `test/towns.test.ts` | new — fixtures per town, cross-town |
| `test/storage.test.ts` | new — migration, toggle |
| `test/delivery.test.ts` | new — grouping, format, pipeline |
| `test/matcher.test.ts` | drop old vocabulary fixture tests (moved to towns.test.ts) |
| `DESIGN.md`, `README.md`, `package.json` | docs |

---

### Task 1: Town catalogue + matcher

**Files:** create `config/towns/{vinnytsia,ladyzhyn,koziatyn}.json`, `test/towns.test.ts`; modify `config/vocabulary.json`, `src/config.ts`, `src/types.ts`, `src/matcher.ts`, `test/matcher.test.ts`, `scripts/scrapecheck.ts`.

**Interfaces — Produces:**
```ts
// config.ts
export interface TownTarget { id: string; script: 'cyrillic'|'latin'; matchOn: 'normalized'|'raw'; regex?: string; literals?: string[]; negativeLookahead?: string }
export interface TownCfg { id: string; name: string; header: string; order: number; targets: TownTarget[]; fixtures: { shouldMatch: string[]; shouldNotMatch: string[] } }
export const towns: TownCfg[];              // sorted by order
export const townById: Map<string, TownCfg>;
// types.ts
export interface TownMatch { townId: string; form: string; targetId: string }
// matcher.ts
export function matchTowns(raw: string): TownMatch[];   // catalogue order, one per town
```

- [ ] **Step 1: Write the failing test** `test/towns.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { towns } from '../src/config.js';
import { matchTowns } from '../src/matcher.js';

const ids = (s: string) => matchTowns(s).map((m) => m.townId);

test('catalogue: Вінниця, Ладижин, Козятин in order', () => {
    assert.deepEqual(towns.map((t) => t.id), ['vinnytsia', 'ladyzhyn', 'koziatyn']);
});

for (const t of towns) {
    test(`${t.id}: every shouldMatch hits this town and only this town`, () => {
        for (const s of t.fixtures.shouldMatch) assert.deepEqual(ids(s), [t.id], `should match only ${t.id}: ${s}`);
    });
    test(`${t.id}: every shouldNotMatch hits no town`, () => {
        for (const s of t.fixtures.shouldNotMatch) assert.deepEqual(ids(s), [], `should NOT match: ${s}`);
    });
}

test('one post can name several towns', () => {
    assert.deepEqual(ids('БпЛА з Вінниці на Козятин, далі Ладижин'), ['vinnytsia', 'ladyzhyn', 'koziatyn']);
});

test('the matched form is reported verbatim', () => {
    assert.equal(matchTowns('над Козятином')[0].form.toLowerCase(), 'козятином');
});
```

- [ ] **Step 2: Run** `node --import tsx --test test/towns.test.ts` → FAIL (`towns` not exported).

- [ ] **Step 3: Implement.**
  - `config/towns/vinnytsia.json`: `{ id:"vinnytsia", name:"Вінниця", header:"ВІННИЦЯ", order:1, _sources, targets, excluded, fixtures }` copied from vocabulary.json (target `regex`/`literals`/`negativeLookahead` unchanged). Strip `vocabulary.json` to `_about` + `normalization`.
  - `config/towns/ladyzhyn.json`, `koziatyn.json`: targets and fixtures exactly as listed in the spec §Matching research.
  - `config.ts`: load with `fs.readdirSync('config/towns').filter(f => f.endsWith('.json'))`, sort by `order`, throw on duplicate id / empty catalogue / missing `order`.
  - `matcher.ts`: compile per town (same compile logic as today), `matchTowns` loops towns, first target hit per town.
  - Remove `MatchResult`; remove old fixture tests from `matcher.test.ts` (now covered per-town) and its `vocabulary`/`matchTown` imports.
  - `scrapecheck.ts`: count hits per town, print `Вінниця 2 · Козятин 1`.

- [ ] **Step 4: Run** `node --import tsx --test test/towns.test.ts test/matcher.test.ts` → PASS. (`pipeline.ts`/`bot.ts` still call the removed `matchTown`; `tsc --noEmit` is green again at the end of Task 5.)

---

### Task 2: Storage — per-town windows, `off`, migration

**Files:** modify `src/types.ts`, `src/storage.ts`; create `test/storage.test.ts`.

**Interfaces — Consumes:** `towns`, `townById`. **Produces:**
```ts
interface Subscriber { chatId: number; name: string; since: string; off?: string[] }
interface StorageData { subscribers: Subscriber[]; windows: Record<string, WindowState>; alertedIds: Record<string, number> }
export function getSubscriber(chatId: number): Subscriber | undefined;
export function getTownWindow(townId: string): WindowState;   // creates empty on demand
export function saveWindows(): void;
export function followedTowns(sub: Subscriber): string[];     // catalogue order, minus off
export function toggleTown(chatId: number, townId: string): boolean | null; // new ON state; null = not subscribed
```

- [ ] **Step 1: Write the failing test** `test/storage.test.ts` — sets `DATA_DIR` to a temp dir holding a legacy file, *then* dynamically imports storage.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-storage-'));
process.env.DATA_DIR = dir;
fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({
    subscribers: [{ chatId: 1, name: 'a', since: 'x' }, { chatId: 2, name: 'b', since: 'x', off: ['gone-town'] }],
    window: { openedAt: 10, lastMatchAt: 20, sources: { kpszsu: 20 }, announcedPct: 90 },
    alertedIds: {},
}));
const s = await import('../src/storage.js');

test('legacy window migrates to windows.vinnytsia', () => {
    assert.equal(s.getTownWindow('vinnytsia').announcedPct, 90);
    assert.equal(s.getTownWindow('vinnytsia').lastMatchAt, 20);
    assert.equal(s.getTownWindow('koziatyn').lastMatchAt, null);
});

test('legacy subscriber follows every town', () => {
    assert.deepEqual(s.followedTowns(s.getSubscriber(1)!), ['vinnytsia', 'ladyzhyn', 'koziatyn']);
});

test('unknown id in off is ignored', () => {
    assert.deepEqual(s.followedTowns(s.getSubscriber(2)!), ['vinnytsia', 'ladyzhyn', 'koziatyn']);
});

test('toggle off then on, persisted', () => {
    assert.equal(s.toggleTown(1, 'ladyzhyn'), false);
    assert.deepEqual(s.followedTowns(s.getSubscriber(1)!), ['vinnytsia', 'koziatyn']);
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
    assert.deepEqual(disk.subscribers[0].off, ['ladyzhyn']);
    assert.equal(disk.window, undefined, 'legacy field dropped on persist');
    assert.equal(disk.windows.vinnytsia.announcedPct, 90);
    assert.equal(s.toggleTown(1, 'ladyzhyn'), true);
    assert.deepEqual(s.followedTowns(s.getSubscriber(1)!), ['vinnytsia', 'ladyzhyn', 'koziatyn']);
});

test('toggle by a non-subscriber returns null', () => {
    assert.equal(s.toggleTown(999, 'ladyzhyn'), null);
});
```

- [ ] **Step 2: Run** `node --import tsx --test test/storage.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `storage.ts`: `load()` builds `windows` from `parsed.windows ?? (parsed.window ? { vinnytsia: {...EMPTY_WINDOW, ...parsed.window} } : {})`; remove `getWindow/saveWindow`; add the functions above. `toggleTown` on: remove from `off`; off: push. Persist on every toggle.
- [ ] **Step 4: Run** → PASS.

---

### Task 3: Delivery grouping + multi-town format

**Files:** modify `src/notify.ts`, `src/format.ts`; create `test/delivery.test.ts`.

**Interfaces — Consumes:** `followedTowns`, `TownCfg`, `WindowDecision`. **Produces:**
```ts
// notify.ts
export interface DeliveryGroup { towns: string[]; chatIds: number[] }
export function groupByTowns(subs: Subscriber[], matched: string[], follow: (s: Subscriber) => string[]): DeliveryGroup[];
export async function sendTo(bot: Telegraf, chatIds: number[], html: string, silent: boolean): Promise<void>;
export async function broadcast(bot: Telegraf, html: string, silent: boolean): Promise<void>; // all subs (watchdog)
// format.ts
export interface ShownTown { town: TownCfg; d: WindowDecision }
export function formatAlert(msg: IncomingMessage, text: string, label: string, shown: ShownTown[]): string;
```

- [ ] **Step 1: Write the failing tests** (`test/delivery.test.ts`, grouping + format part)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { townById } from '../src/config.js';
import { formatAlert } from '../src/format.js';
import { groupByTowns } from '../src/notify.js';
import type { Subscriber } from '../src/types.js';
import type { WindowDecision } from '../src/window.js';

const sub = (chatId: number, off: string[] = []): Subscriber => ({ chatId, name: '', since: '', off });
const ALL = ['vinnytsia', 'ladyzhyn', 'koziatyn'];
const follow = (s: Subscriber) => ALL.filter((t) => !(s.off ?? []).includes(t));

test('grouping: muted town is not delivered, overlap groups share one render', () => {
    const groups = groupByTowns([sub(1), sub(2, ['ladyzhyn']), sub(3, ALL), sub(4)], ['ladyzhyn', 'koziatyn'], follow);
    assert.deepEqual(groups, [
        { towns: ['ladyzhyn', 'koziatyn'], chatIds: [1, 4] },
        { towns: ['koziatyn'], chatIds: [2] },
    ]);
});

test('grouping: nobody follows the matched town → no groups', () => {
    assert.deepEqual(groupByTowns([sub(1, ['ladyzhyn'])], ['ladyzhyn'], follow), []);
});

const dec = (pct: number, loud: boolean, extra: Partial<WindowDecision> = {}): WindowDecision =>
    ({ confidencePct: pct, loud, escalated: false, sourceCount: 1, newWindow: true, ...extra });
const msg = { channelUsername: 'kpszsu', channelTitle: '', messageId: 7, text: '', date: new Date('2026-10-01T11:02:00Z'), isEdit: false };

test('format: single Вінниця alert unchanged', () => {
    const html = formatAlert(msg, 'текст', 'ПС ЗСУ', [{ town: townById.get('vinnytsia')!, d: dec(95, true, { escalated: true, sourceCount: 2 }) }]);
    assert.equal(html.split('\n')[0], '🚨 <b>ВІННИЦЯ</b> · 95% ↑');
    assert.match(html, /підтверджено \(2 джерела\)/);
});

test('format: two towns in one header, loud if any is loud', () => {
    const html = formatAlert(msg, 'т', 'war_monitor', [
        { town: townById.get('ladyzhyn')!, d: dec(50, false) },
        { town: townById.get('koziatyn')!, d: dec(90, true) },
    ]);
    assert.equal(html.split('\n')[0], '🚨 <b>ЛАДИЖИН</b> 50% (непідтверджено) · <b>КОЗЯТИН</b> 90%');
    assert.doesNotMatch(html.split('\n').at(-1)!, /джерел/);
});

test('format: all quiet → bullet icon', () => {
    const html = formatAlert(msg, 'т', 'x', [{ town: townById.get('koziatyn')!, d: dec(90, false) }]);
    assert.ok(html.startsWith('• '));
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Single-town header keeps today's exact shape `${icon} <b>${HEADER}</b> · ${pct}%${arrow}` with `непідтверджено`/`підтверджено (N …)` in the footer. Multi-town header: `${icon} ` + parts joined by ` · `, each `<b>${HEADER}</b> ${pct}%${arrow}${pct<threshold?' (непідтверджено)':''}`; footer without the confidence clause. `groupByTowns` keys on `towns.join(',')`, preserves first-seen order; `towns` = `matched.filter(t => follow(s).includes(t))` (keeps catalogue order of `matched`). `sendTo` = today's broadcast body over `chatIds`; `broadcast` = `sendTo(all chatIds)`.
- [ ] **Step 4: Run** → PASS.

---

### Task 4: Pipeline per town + index wiring + shadow

**Files:** modify `src/pipeline.ts`, `src/index.ts`, `src/shadow.ts`; extend `test/delivery.test.ts`.

**Interfaces — Consumes:** `matchTowns`, `getTownWindow`, `saveWindows`, `recordMatch`, `formatAlert`, `townById`. **Produces:**
```ts
export interface PipelineDeps {
    deliver(decisions: Map<string, WindowDecision>, render: (towns: string[]) => string): Promise<void>;
    now?: () => number;
}
```

- [ ] **Step 1: Failing test** appended to `test/delivery.test.ts` (top of file gains a temp `DATA_DIR` set *before* any `src` import — move the import block to dynamic imports after `process.env.DATA_DIR = …`):

```ts
test('pipeline: two towns → one deliver call with both decisions; edit alerts only the new town', async () => {
    const calls: Array<{ towns: string[]; html: string }> = [];
    const deps = {
        now: () => Date.parse('2026-10-01T11:03:00Z'),
        deliver: async (d: Map<string, WindowDecision>, render: (t: string[]) => string) => {
            const towns = [...d.keys()];
            calls.push({ towns, html: render(towns) });
        },
    };
    const base = { channelUsername: 'kpszsu', channelTitle: '', messageId: 501, date: new Date('2026-10-01T11:02:00Z') };
    await handleMessage({ ...base, text: 'БпЛА на Козятин', isEdit: false }, deps);
    await handleMessage({ ...base, text: 'БпЛА на Козятин і Ладижин', isEdit: true }, deps);
    assert.deepEqual(calls.map((c) => c.towns), [['koziatyn'], ['ladyzhyn']]);
    assert.match(calls[1].html, /ЛАДИЖИН/);
});

test('pipeline: towns have separate windows — Козятин loud does not silence Вінниця', async () => {
    const loud: boolean[] = [];
    const deps = {
        now: () => Date.parse('2026-10-01T12:00:00Z'),
        deliver: async (d: Map<string, WindowDecision>) => { for (const x of d.values()) loud.push(x.loud); },
    };
    const date = new Date('2026-10-01T11:59:00Z');
    await handleMessage({ channelUsername: 'war_monitor', channelTitle: '', messageId: 900, date, text: 'Шахед на Козятин', isEdit: false }, deps);
    await handleMessage({ channelUsername: 'war_monitor', channelTitle: '', messageId: 901, date, text: 'Шахед на Вінницю', isEdit: false }, deps);
    assert.deepEqual(loud, [true, true]);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Pipeline loop per spec §4; `render = (ts) => formatAlert(msg, text, cfg.label, ts.map(id => ({ town: townById.get(id)!, d: decisions.get(id)! })))`. Shadow: `towns: string[]`, `confidencePct?: Record<string, number>`. `index.ts` deliver: no subscribers or DRY_RUN → print `render([...decisions.keys()])`; else `for (g of groupByTowns(getSubscribers(), [...decisions.keys()], followedTowns)) await sendTo(bot, g.chatIds, render(g.towns), !g.towns.some(t => decisions.get(t)!.loud))`. Watchdog keeps `broadcast`.
- [ ] **Step 4: Run** `npm test` → PASS.

---

### Task 5: Bot — `/cities`, callbacks, updated commands

**Files:** modify `src/bot.ts`; create `test/bot.test.ts`.

**Interfaces — Produces:**
```ts
export function citiesKeyboard(sub: Subscriber): { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } };
export function onTownTap(chatId: number, townId: string): { answer: string; changed: boolean };
```

- [ ] **Step 1: Failing test** `test/bot.test.ts` (temp `DATA_DIR`, then dynamic import):

```ts
test('keyboard shows one row per town with state', () => {
    addSubscriber(5, 'x'); toggleTown(5, 'koziatyn');
    const k = citiesKeyboard(getSubscriber(5)!);
    assert.deepEqual(k.reply_markup.inline_keyboard.map((r) => r[0].text), ['✅ Вінниця', '✅ Ладижин', '⬜ Козятин']);
    assert.equal(k.reply_markup.inline_keyboard[1][0].callback_data, 'town:ladyzhyn');
});
test('all off warns', () => {
    toggleTown(5, 'vinnytsia'); toggleTown(5, 'ladyzhyn');
    assert.match(citiesKeyboard(getSubscriber(5)!).text, /жодного міста/);
});
test('tap on removed town answers, does not throw', () => {
    assert.deepEqual(onTownTap(5, 'gone'), { answer: 'Місто більше не відстежується', changed: false });
});
test('tap by non-subscriber', () => {
    assert.deepEqual(onTownTap(42, 'ladyzhyn'), { answer: 'Ви не підписані.', changed: false });
});
test('tap toggles and reports', () => {
    assert.deepEqual(onTownTap(5, 'ladyzhyn'), { answer: 'Ладижин увімкнено', changed: true });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `/cities`, `bot.action(/^town:(.+)$/)` → `onTownTap`, `answerCbQuery`, `editMessageText` with fresh keyboard when changed. `/start` text lists towns and `/cities`. `/status` window line per town + caller's towns. `/test` lists every matched town. `setMyCommands` in `buildBot` (fire-and-forget with catch).
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit` → PASS.

---

### Task 6: Docs + live verification

**Files:** `DESIGN.md`, `README.md`, `package.json`.

- [ ] Update DESIGN §3 (per-town files, explicit endings, Козятин collision), §4 (window per town), §6 (multi-town header), §10 (`/cities`); README tuning table + "adding a town" + `/cities`; package description.
- [ ] `npm run scrapecheck` → per-town counts print, no crash.
- [ ] `SOURCE=fake SCENARIO=config/scenario.json DRY_RUN=1` run for ~20 s → Вінниця alerts render as before.
- [ ] Re-run the 204-post corpus check against the real `matchTowns` → 86/86 Ладижин, 99/99 Козятин.
