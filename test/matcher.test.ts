import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelsConfig, fastThreatKeywords, threatKeywords } from '../src/config.js';
import { isDanger, isFastThreat } from '../src/danger.js';
import { stripFooter } from '../src/text.js';
import { recordMatch } from '../src/window.js';
import type { WindowState } from '../src/types.js';

// Town fixtures live with each town in config/towns/ and run in towns.test.ts.

test('danger filter separates threats from local news', () => {
    for (const s of threatKeywords.fixtures.danger) assert.ok(isDanger(s), `danger: ${s}`);
    for (const s of threatKeywords.fixtures.notDanger) assert.ok(!isDanger(s), `not danger: ${s}`);
});

test('fast-threat filter: missiles and КАБ yes, drones no', () => {
    for (const s of fastThreatKeywords.fixtures.danger) assert.ok(isFastThreat(s), `fast: ${s}`);
    for (const s of fastThreatKeywords.fixtures.notDanger) assert.ok(!isFastThreat(s), `not fast: ${s}`);
});

test('promo footer is stripped before matching', () => {
    const cfg = channelsConfig.channels.find((c) => c.username === 'vinnitsa_vinnistya')!;
    const out = stripFooter('2 БпЛА на Вінницю\n\nНадіслати новину @typ_Vinn_bot\n👉ПІДПИСАТИСЯ', cfg.stripFooterPatterns);
    assert.equal(out, '2 БпЛА на Вінницю');
});

const fresh = (): WindowState => ({ loudAt: null, sources: {}, fastSources: {} });
const MIN = 60_000;

test('confidence: one reliable source is 90% and loud', () => {
    const d = recordMatch(fresh(), 'kpszsu', false, 0);
    assert.equal(d.confidencePct, 90);
    assert.ok(d.loud);
});

test('confidence: the local news channel alone is 50% and silent', () => {
    const d = recordMatch(fresh(), 'vinnitsa_vinnistya', false, 0);
    assert.equal(d.confidencePct, 50);
    assert.ok(!d.loud);
    assert.ok(!d.cooldown);
});

test('escalation: 50% then a reliable source crosses to 95% and goes loud', () => {
    const s = fresh();
    assert.ok(!recordMatch(s, 'vinnitsa_vinnistya', false, 0).loud);
    const second = recordMatch(s, 'kpszsu', false, 2 * MIN);
    assert.equal(second.confidencePct, 95);
    assert.equal(second.sourceCount, 2);
    assert.ok(second.loud, 'crossing the threshold must be loud');
});

test('cooldown: nothing is loud for 15 min after a loud alert', () => {
    const s = fresh();
    assert.ok(recordMatch(s, 'kpszsu', false, 0).loud);
    for (const [u, m] of [['war_monitor', 2], ['ukraine_pyxx', 8], ['kpszsu', 14.9]] as const) {
        const d = recordMatch(s, u, false, m * MIN);
        assert.ok(!d.loud, `${u} at ${m} min`);
        assert.ok(d.cooldown);
    }
});

test('cooldown is fixed: posts inside it do not extend it', () => {
    const s = fresh();
    recordMatch(s, 'kpszsu', false, 0);
    recordMatch(s, 'kpszsu', false, 14 * MIN);
    const d = recordMatch(s, 'war_monitor', false, 15.1 * MIN);
    assert.ok(d.loud, 'loud again once 15 min have passed since the LOUD alert');
    assert.ok(!d.cooldown);
});

test('after a cooldown confidence starts fresh: Типова alone is not enough', () => {
    const s = fresh();
    recordMatch(s, 'kpszsu', false, 0);
    const d = recordMatch(s, 'vinnitsa_vinnistya', false, 16 * MIN);
    assert.equal(d.confidencePct, 50, 'pre-cooldown sources must not carry over');
    assert.ok(!d.loud);
    const e = recordMatch(s, 'war_monitor', false, 17 * MIN);
    assert.equal(e.confidencePct, 95);
    assert.ok(e.loud);
});

test('a missile passes the cooldown and restarts it', () => {
    const s = fresh();
    recordMatch(s, 'kpszsu', false, 0);
    const missile = recordMatch(s, 'kpszsu', true, 5 * MIN);
    assert.ok(missile.loud);
    assert.ok(!missile.cooldown);
    assert.ok(!recordMatch(s, 'war_monitor', false, 16 * MIN).loud, 'cooldown now runs from 5 min');
    assert.ok(recordMatch(s, 'war_monitor', false, 21 * MIN).loud);
});

test('a missile from Типова alone stays unconfirmed, even in a cooldown', () => {
    const s = fresh();
    recordMatch(s, 'kpszsu', false, 0);
    const d = recordMatch(s, 'vinnitsa_vinnistya', true, 3 * MIN);
    assert.equal(d.confidencePct, 50);
    assert.ok(!d.loud);
    // A reliable channel confirming the missile crosses the threshold.
    const e = recordMatch(s, 'war_monitor', true, 4 * MIN);
    assert.equal(e.confidencePct, 95);
    assert.ok(e.loud);
});

test('all four sources reach 100%', () => {
    const s = fresh();
    recordMatch(s, 'vinnitsa_vinnistya', false, 0);
    const d = recordMatch(s, 'kpszsu', false, MIN);
    assert.equal(d.confidencePct, 95);
    const t = fresh();
    t.sources = { kpszsu: 0, war_monitor: 0, ukraine_pyxx: 0 };
    const all = recordMatch(t, 'vinnitsa_vinnistya', false, MIN);
    assert.equal(all.confidencePct, 100);
    assert.equal(all.sourceCount, 4);
});

test('corroboration expires after the correlation window', () => {
    const s = fresh();
    recordMatch(s, 'vinnitsa_vinnistya', false, 0);
    // 25 min later: outside the 20 min correlation window, so it no longer counts.
    const d = recordMatch(s, 'kpszsu', false, 25 * MIN);
    assert.equal(d.sourceCount, 1);
    assert.equal(d.confidencePct, 90);
});

test('footer: Hangul filler (ㅤ U+3164) used as a blank last line is removed', () => {
    assert.equal(stripFooter('Реактивний БпЛА в напрямку Ладижина\nㅤ', []), 'Реактивний БпЛА в напрямку Ладижина');
    assert.equal(stripFooter('Рядок 1\nㅤ\nРядок 2', []), 'Рядок 1\n\nРядок 2');
});

test('a clock that steps back never stretches a cooldown past 15 min', () => {
    const s = fresh();
    recordMatch(s, 'kpszsu', false, 60 * MIN);
    // Clock steps back 45 min. The cooldown runs at most 15 min from the first post
    // seen after the jump, not until the clock catches up with the old alert.
    assert.ok(!recordMatch(s, 'war_monitor', false, 15 * MIN).loud, 'still cooling down right after the jump');
    assert.ok(recordMatch(s, 'war_monitor', false, 31 * MIN).loud);
});

test('a missile designation with a non-ASCII hyphen is fast', () => {
    assert.ok(isFastThreat('Х‑101 курсом на Вінницю'), 'non-breaking hyphen');
    assert.ok(isFastThreat('Х–101 курсом на Вінницю'), 'en dash');
});
