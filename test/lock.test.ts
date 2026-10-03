import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-lock-'));
const { isBotProcess } = await import('../src/lock.js');

test('lock: the systemd bot and a dev run count as the bot', () => {
    assert.equal(isBotProcess(process.pid, '/usr/bin/node\0dist/index.js\0'), true);
    assert.equal(isBotProcess(process.pid, 'node\0/x/node_modules/tsx/dist/cli.mjs\0watch\0src/index.ts\0'), true);
});

test('lock: a PID reused by another process after a power cut is not the bot', () => {
    assert.equal(isBotProcess(process.pid, '/usr/lib/firefox/firefox\0'), false);
    // This test runner is alive but is not the bot.
    assert.equal(isBotProcess(process.pid), false);
});

test('lock: a dead PID is not the bot', () => {
    assert.equal(isBotProcess(2 ** 22 + 7), false);
});
