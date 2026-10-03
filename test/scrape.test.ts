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
