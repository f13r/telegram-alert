import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// storage.ts loads DATA_DIR/data.json at import time, so the legacy file must be
// in place before the module is imported.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-storage-'));
process.env.DATA_DIR = dir;
fs.writeFileSync(
    path.join(dir, 'data.json'),
    JSON.stringify({
        subscribers: [
            { chatId: 1, name: 'a', since: 'x' },
            { chatId: 2, name: 'b', since: 'x', off: ['gone-town'] },
        ],
        window: { openedAt: 10, lastMatchAt: 20, sources: { kpszsu: 20 }, announcedPct: 90 },
        alertedIds: {},
    }),
);
const s = await import('../src/storage.js');
const ALL = ['vinnytsia', 'ladyzhyn', 'koziatyn'];

test('legacy window migrates to windows.vinnytsia; an announced raid counts as loud at its last match', () => {
    assert.deepEqual(s.getTownWindow('vinnytsia'), { loudAt: 20, sources: {}, fastSources: {} });
    assert.equal(s.getTownWindow('koziatyn').loudAt, null);
});

test('legacy subscriber follows every town', () => {
    assert.deepEqual(s.followedTowns(s.getSubscriber(1)!), ALL);
});

test('unknown id in off is ignored', () => {
    assert.deepEqual(s.followedTowns(s.getSubscriber(2)!), ALL);
});

test('toggle off then on, persisted', () => {
    assert.equal(s.toggleTown(1, 'ladyzhyn'), false);
    assert.deepEqual(s.followedTowns(s.getSubscriber(1)!), ['vinnytsia', 'koziatyn']);

    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
    assert.deepEqual(disk.subscribers[0].off, ['ladyzhyn']);
    assert.equal(disk.window, undefined, 'legacy field dropped on persist');
    assert.equal(disk.windows.vinnytsia.loudAt, 20);

    assert.equal(s.toggleTown(1, 'ladyzhyn'), true);
    assert.deepEqual(s.followedTowns(s.getSubscriber(1)!), ALL);
});

test('toggle by a non-subscriber returns null', () => {
    assert.equal(s.toggleTown(999, 'ladyzhyn'), null);
});
