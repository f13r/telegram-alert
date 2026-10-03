import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { diagnose302 } from '../src/sources/scrape.js';

test('a 302 is diagnosed: redirect target, headers, staleness, and whether ?before= still works', async () => {
    const server = http.createServer((req, res) => {
        if (req.url?.includes('before=')) return void res.writeHead(200).end('<html></html>');
        res.writeHead(302, { Location: '/ukraine_pyxx', 'Retry-After': '60' }).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
        const headers = { location: '/ukraine_pyxx', 'retry-after': '60', 'content-type': 'text/html' };
        const line = await diagnose302('ukraine_pyxx', headers, Date.now() - 90_000, 93800, base);
        assert.match(line, /location=\/ukraine_pyxx/);
        assert.match(line, /retry-after=60/);
        assert.match(line, /lastOk=1m30s ago/);
        assert.match(line, /before=93900 → 200/);
    } finally {
        server.close();
    }
});

test('a 302 before any successful poll says so', async () => {
    const line = await diagnose302('x', {}, undefined, 0, 'http://127.0.0.1:1');
    assert.match(line, /lastOk=never/);
    assert.match(line, /before=skipped/);
});

import { postsToEmit } from '../src/sources/scrape.js';

const MIN = 60_000;
const NOW = Date.parse('2026-10-03T00:30:00Z');
const at = (minAgo: number) => new Date(NOW - minAgo * MIN);

test('first poll after start emits recent posts, so a threat posted during a restart is not lost', () => {
    const seen = new Map<string, string>();
    const out = postsToEmit('kpszsu', [
        { id: 1, text: 'old', date: at(60) },
        { id: 2, text: 'БпЛА на Вінницю', date: at(1) },
    ], 0, seen, NOW, 10 * MIN);
    assert.deepEqual(out.map((p) => [p.id, p.isEdit]), [[2, false]]);
    assert.equal(seen.size, 2, 'every post is remembered, emitted or not');
});

test('an edit keeps the post date — editing an old post does not make it fresh', () => {
    const seen = new Map([['kpszsu:5', 'БпЛА']]);
    const out = postsToEmit('kpszsu', [{ id: 5, text: 'БпЛА на Вінницю', date: at(15) }], 5, seen, NOW, 10 * MIN);
    assert.equal(out.length, 1);
    assert.equal(out[0].isEdit, true);
    assert.equal(out[0].date.getTime(), at(15).getTime());
});

test('an unchanged post already seen is not emitted again', () => {
    const seen = new Map([['kpszsu:5', 'БпЛА']]);
    assert.deepEqual(postsToEmit('kpszsu', [{ id: 5, text: 'БпЛА', date: at(1) }], 5, seen, NOW, 10 * MIN), []);
});
