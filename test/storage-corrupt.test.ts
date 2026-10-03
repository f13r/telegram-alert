import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// storage.ts loads data.json at import time — the broken file must exist first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-corrupt-'));
process.env.DATA_DIR = dir;
const broken = '{"subscribers": [{"chatId": 1, "name": "a"';
fs.writeFileSync(path.join(dir, 'data.json'), broken);
const s = await import('../src/storage.js');

test('unreadable data.json is moved aside, never overwritten', () => {
    s.addSubscriber(42, 'new');
    const aside = fs.readdirSync(dir).filter((f) => f.startsWith('data.json.corrupt-'));
    assert.equal(aside.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), broken);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).subscribers.map((x: { chatId: number }) => x.chatId), [42]);
});
