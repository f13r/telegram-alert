import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Subscriber } from '../src/types.js';
import type { WindowDecision } from '../src/window.js';

// pipeline.ts persists windows and the shadow log — keep them out of ./data.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-delivery-'));
const { townById } = await import('../src/config.js');
const { formatAlert } = await import('../src/format.js');
const { groupByTowns } = await import('../src/notify.js');
const { handleMessage } = await import('../src/pipeline.js');

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

const dec = (pct: number, loud: boolean, extra: Partial<WindowDecision> = {}): WindowDecision => ({
    confidencePct: pct,
    loud,
    sourceCount: 1,
    cooldown: false,
    ...extra,
});
const msg = {
    channelUsername: 'kpszsu',
    channelTitle: '',
    messageId: 7,
    text: '',
    date: new Date('2026-10-01T11:02:00Z'),
    isEdit: false,
};

test('format: single Вінниця alert unchanged', () => {
    const html = formatAlert(msg, 'текст', 'ПС ЗСУ', [
        { town: townById.get('vinnytsia')!, d: dec(95, true, { sourceCount: 2 }) },
    ]);
    assert.equal(
        html,
        '🚨 <b>ВІННИЦЯ</b> · 95%\n\nтекст\n\n' +
            '<i>ПС ЗСУ · 14:02 · підтверджено (2 джерела) · <a href="https://t.me/kpszsu/7">відкрити</a></i>',
    );
});

test('format: single town below threshold says непідтверджено', () => {
    const html = formatAlert(msg, 'т', 'x', [{ town: townById.get('ladyzhyn')!, d: dec(50, false) }]);
    assert.equal(html.split('\n')[0], '• <b>ЛАДИЖИН</b> · 50%');
    assert.match(html, /· непідтверджено ·/);
});

test('format: two towns in one header, loud if any is loud', () => {
    const html = formatAlert(msg, 'т', 'war_monitor', [
        { town: townById.get('ladyzhyn')!, d: dec(50, false) },
        { town: townById.get('koziatyn')!, d: dec(90, true) },
    ]);
    assert.equal(html.split('\n')[0], '🚨 <b>ЛАДИЖИН</b> 50% (непідтверджено) · <b>КОЗЯТИН</b> 90%');
    assert.doesNotMatch(html.split('\n').at(-1)!, /джерел|непідтверджено/);
});

test('format: all quiet → bullet icon', () => {
    const html = formatAlert(msg, 'т', 'x', [{ town: townById.get('koziatyn')!, d: dec(90, false) }]);
    assert.ok(html.startsWith('• '));
});

test('pipeline: two towns → one deliver call; edit alerts only the newly named town', async () => {
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
    await handleMessage({ ...base, text: 'БпЛА на Козятин і Ладижин!', isEdit: true }, deps);
    assert.deepEqual(calls.map((c) => c.towns), [['koziatyn'], ['ladyzhyn']]);
    assert.match(calls[1].html, /ЛАДИЖИН/);
});

test('pipeline: towns have separate windows — a loud Козятин does not silence Вінниця', async () => {
    const loud: Record<string, boolean> = {};
    const deps = {
        now: () => Date.parse('2026-10-01T12:00:00Z'),
        deliver: async (d: Map<string, WindowDecision>) => {
            for (const [t, x] of d) loud[t] = x.loud;
        },
    };
    const date = new Date('2026-10-01T11:59:00Z');
    const base = { channelUsername: 'war_monitor', channelTitle: '', date, isEdit: false };
    await handleMessage({ ...base, messageId: 900, text: 'Шахед на Ладижин' }, deps);
    await handleMessage({ ...base, messageId: 901, text: 'Шахед на Вінницю' }, deps);
    assert.deepEqual(loud, { ladyzhyn: true, vinnytsia: true });
});

test('pipeline: a post naming no town is never delivered', async () => {
    let called = false;
    await handleMessage(
        { channelUsername: 'kpszsu', channelTitle: '', messageId: 77, date: new Date(), text: 'Вінниччина: БпЛА', isEdit: false },
        { deliver: async () => void (called = true) },
    );
    assert.equal(called, false);
});

test('pipeline: a town named only as a landmark is not delivered, and is logged as reference-point', async () => {
    let called = false;
    const now = new Date();
    await handleMessage(
        {
            channelUsername: 'ukraine_pyxx',
            channelTitle: '',
            messageId: 93001,
            date: now,
            text: 'Вінниччина:\n1х реактивний східніше Вінниці на Погребище.',
            isEdit: false,
        },
        { now: () => now.getTime(), deliver: async () => void (called = true) },
    );
    assert.equal(called, false);
    const log = fs.readFileSync(path.join(process.env.DATA_DIR!, `shadow-${now.toISOString().slice(0, 10)}.ndjson`), 'utf8');
    const entry = log.trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.messageId === 93001);
    assert.equal(entry.dropped, 'reference-point');
    assert.deepEqual(entry.landmarkOnly, ['vinnytsia']);
});

test('pipeline: Типова Вінниця alone is held back until another channel confirms', async () => {
    const calls: Array<{ towns: string[]; html: string }> = [];
    const now = Date.now();
    const deps = {
        now: () => now,
        deliver: async (d: Map<string, WindowDecision>, render: (t: string[]) => string) => {
            const towns = [...d.keys()];
            calls.push({ towns, html: render(towns) });
        },
    };
    const date = new Date(now - 30_000);
    await handleMessage(
        { channelUsername: 'vinnitsa_vinnistya', channelTitle: '', messageId: 41400, date, text: 'БПЛа на Козятин', isEdit: false },
        deps,
    );
    assert.equal(calls.length, 0);
    const log = fs.readFileSync(path.join(process.env.DATA_DIR!, `shadow-${new Date(now).toISOString().slice(0, 10)}.ndjson`), 'utf8');
    const entry = log.trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.messageId === 41400);
    assert.equal(entry.dropped, 'unconfirmed');
    assert.deepEqual(entry.confidencePct, { koziatyn: 50 });

    await handleMessage(
        { channelUsername: 'kpszsu', channelTitle: '', messageId: 82600, date, text: 'БпЛА на Козятин', isEdit: false },
        deps,
    );
    assert.deepEqual(calls.map((c) => c.towns), [['koziatyn']]);
    assert.match(calls[0].html, /95%/);
    assert.match(calls[0].html, /підтверджено \(2 джерела\)/);
});

test('pipeline: a multi-town post delivers only the confirmed towns', async () => {
    const delivered: string[][] = [];
    const now = Date.parse('2026-10-02T15:00:00Z');
    const deps = {
        now: () => now,
        deliver: async (d: Map<string, WindowDecision>) => void delivered.push([...d.keys()]),
    };
    const date = new Date(now - 30_000);
    const base = { channelTitle: '', date, isEdit: false };
    await handleMessage({ ...base, channelUsername: 'war_monitor', messageId: 9100, text: 'Шахед на Вінницю' }, deps);
    await handleMessage({ ...base, channelUsername: 'vinnitsa_vinnistya', messageId: 41401, text: 'БпЛА на Вінницю і Ладижин' }, deps);
    await handleMessage({ ...base, channelUsername: 'kpszsu', messageId: 82700, text: 'БпЛА на Вінницю і Ладижин' }, deps);
    // Вінниця already went out; Ладижин is confirmed only by the kpszsu post.
    assert.deepEqual(delivered, [['vinnytsia'], ['ladyzhyn']]);
});

test('pipeline: 15 min cooldown — the 03.10 Ладижин sequence sends at 0 and 24 min', async () => {
    const sent: string[] = [];
    const t0 = Date.now();
    let now = t0;
    const deps = {
        now: () => now,
        deliver: async (_d: Map<string, WindowDecision>, render: (t: string[]) => string) =>
            void sent.push(render(['ladyzhyn'])),
    };
    const post = async (min: number, channelUsername: string, messageId: number, text: string) => {
        now = t0 + min * 60_000;
        await handleMessage({ channelUsername, channelTitle: '', messageId, date: new Date(now), text, isEdit: false }, deps);
    };
    await post(0, 'ukraine_pyxx', 93970, 'Вінниччина:\n1х реактивний БпЛА курсом на Ладижин.');
    await post(0.5, 'vinnitsa_vinnistya', 41311, 'Реактивний БпЛА в напрямку Ладижина');
    await post(8, 'ukraine_pyxx', 93971, 'Вінниччина:\nБпЛА курсом на Ладижин.');
    assert.equal(sent.length, 1, 'inside the cooldown');
    assert.match(sent[0], /^🚨 <b>ЛАДИЖИН<\/b> · 90%/);

    await post(24, 'kpszsu', 82498, '🏍 Вінниччина: реактивний БпЛА в напрямку Ладижина.');
    assert.equal(sent.length, 2, '24 min after the loud alert the cooldown is over');

    // A missile 2 min into the new cooldown still gets through.
    await post(26, 'war_monitor', 9200, 'Ракета курсом на Ладижин');
    assert.equal(sent.length, 3);
    await post(27, 'kpszsu', 82499, 'БпЛА на Ладижин');
    assert.equal(sent.length, 3, 'the missile restarted the cooldown');
});

test('pipeline: a town in cooldown drops out of a multi-town post', async () => {
    const delivered: string[][] = [];
    // A day ahead: earlier tests left Козятин loud at the real clock.
    const t0 = Date.now() + 24 * 60 * 60_000;
    let now = t0;
    const deps = {
        now: () => now,
        deliver: async (d: Map<string, WindowDecision>) => void delivered.push([...d.keys()]),
    };
    const base = { channelTitle: '', isEdit: false };
    await handleMessage({ ...base, channelUsername: 'kpszsu', messageId: 82800, date: new Date(now), text: 'БпЛА на Вінницю' }, deps);
    now = t0 + 5 * 60_000;
    await handleMessage({ ...base, channelUsername: 'war_monitor', messageId: 9300, date: new Date(now), text: 'БпЛА на Вінницю і Козятин' }, deps);
    assert.deepEqual(delivered, [['vinnytsia'], ['koziatyn']]);
});

test('pipeline: an edit that turns a cooldown-held post into a missile post alerts', async () => {
    const sent: string[][] = [];
    const t0 = Date.now() + 2 * 24 * 60 * 60_000;
    let now = t0;
    const deps = {
        now: () => now,
        deliver: async (d: Map<string, WindowDecision>) => void sent.push([...d.keys()]),
    };
    const post = async (min: number, messageId: number, text: string, isEdit = false) => {
        now = t0 + min * 60_000;
        await handleMessage({ channelUsername: 'kpszsu', channelTitle: '', messageId, date: new Date(t0 + Math.floor(min) * 60_000), text, isEdit }, deps);
    };
    await post(0, 82900, 'БпЛА на Вінницю');
    await post(3, 82901, 'БпЛА на Вінницю');
    assert.equal(sent.length, 1, 'held by the cooldown');
    await post(3.5, 82901, 'БпЛА на Вінницю', true);
    assert.equal(sent.length, 1, 'a plain edit of a held post stays held');
    await post(4, 82901, 'Ракета на Вінницю', true);
    assert.equal(sent.length, 2, 'the edit made it a missile post');
    await post(4.5, 82901, 'Ракета на Вінницю!', true);
    assert.equal(sent.length, 2, 'a typo fix after that does not re-alert');
});

test('format: a post over Telegram\'s 4096-char limit is cut, link kept', () => {
    const long = '🚀'.repeat(1000) + 'Вінниця '.repeat(600);
    const html = formatAlert(msg, long, 'ПС ЗСУ', [{ town: townById.get('vinnytsia')!, d: dec(90, true) }]);
    const visible = html.replace(/<[^>]+>/g, '');
    assert.ok(visible.length <= 4096, `visible length ${visible.length}`);
    assert.match(html, /…\n/);
    assert.match(html, /відкрити<\/a><\/i>$/);
    assert.doesNotMatch(html, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, 'no split emoji');
});
