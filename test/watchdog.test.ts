import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWatchdog, healthReport, initWatchdog, markUnavailable, recordOk, recordPost } from '../src/watchdog.js';

const HOUR = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;
const ALL = ['kpszsu', 'ukraine_pyxx', 'war_monitor', 'vinnitsa_vinnistya', 'vinnytsiappo'];

test('a healthy start produces no warnings', () => {
    initWatchdog(T0);
    assert.deepEqual(checkWatchdog(T0 + 10 * 60_000), []);
});

test('one quiet channel is NOT reported while others are posting', () => {
    initWatchdog(T0);
    // war_monitor posts "тимчасово офлайн" and goes dark for 8 hours; the rest
    // keep working. This used to wake the user at night. It must stay silent.
    for (const u of ALL.filter((u) => u !== 'war_monitor')) recordPost(u, T0 + 8 * HOUR);
    assert.deepEqual(checkWatchdog(T0 + 8 * HOUR), []);
});

test('two quiet channels are still not reported if one keeps posting', () => {
    initWatchdog(T0);
    recordPost('kpszsu', T0 + 9 * HOUR);
    assert.deepEqual(checkWatchdog(T0 + 9 * HOUR), []);
});

test('all channels quiet at once IS reported, once', () => {
    initWatchdog(T0);
    // Pages keep reading fine — only the posts stop. That is the "quiet" case,
    // as distinct from a network failure.
    for (const u of ALL) recordOk(u, T0 + 7 * HOUR);
    const out = checkWatchdog(T0 + 7 * HOUR);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'all-quiet');
    assert.match(out[0].text, new RegExp(`Жодного допису з усіх ${ALL.length} каналів`));

    for (const u of ALL) recordOk(u, T0 + 8 * HOUR);
    assert.deepEqual(checkWatchdog(T0 + 8 * HOUR), [], 'must not repeat hourly');
});

test('a single post from any channel clears the warning', () => {
    initWatchdog(T0);
    for (const u of ALL) recordOk(u, T0 + 7 * HOUR);
    checkWatchdog(T0 + 7 * HOUR);
    recordPost('kpszsu', T0 + 8 * HOUR);
    const out = checkWatchdog(T0 + 8 * HOUR);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'recovered');
});

test('all channels unreadable is reported as a network problem, not silence', () => {
    initWatchdog(T0);
    const out = checkWatchdog(T0 + 2 * HOUR);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'all-unreadable');
    assert.match(out[0].text, /Жоден канал не читається/);
});

test('one unreadable channel is not reported while others read fine', () => {
    initWatchdog(T0);
    for (const u of ALL.filter((u) => u !== 'ukraine_pyxx')) recordOk(u, T0 + 5 * HOUR);
    assert.deepEqual(checkWatchdog(T0 + 5 * HOUR), []);
});

test('a known cause is named in the all-unreadable warning', () => {
    initWatchdog(T0, ['ukraine_pyxx']);
    markUnavailable('ukraine_pyxx', 'вебпревʼю вимкнено');
    const [w] = checkWatchdog(T0 + 2 * HOUR);
    assert.match(w.text, /вебпревʼю вимкнено/);
});

test('per-channel detail is available on demand, not pushed', () => {
    initWatchdog(T0);
    recordPost('kpszsu', T0 + 8 * HOUR);
    const report = healthReport(T0 + 8 * HOUR);
    assert.match(report, /✓ @kpszsu — останній допис щойно/);
    assert.match(report, /@war_monitor — останній допис 8 год тому/);
});

test('backoff grows exponentially and caps at 30 minutes', async () => {
    const { backoffMs } = await import('../src/sources/scrape.js');
    assert.equal(backoffMs(1), 2 * 60_000);
    assert.equal(backoffMs(5), 30 * 60_000);
    assert.equal(backoffMs(20), 30 * 60_000, 'never gives up');
});

test('a cause recorded in an old outage is not reused once the channel reads again', () => {
    initWatchdog(T0);
    markUnavailable('ukraine_pyxx', 'вебпревʼю вимкнено');
    recordOk('ukraine_pyxx', T0 + HOUR / 2);
    const [w] = checkWatchdog(T0 + 3 * HOUR);
    assert.equal(w.kind, 'all-unreadable');
    assert.doesNotMatch(w.text, /вебпревʼю/);
});
