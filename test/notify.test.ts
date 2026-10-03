import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Telegraf } from 'telegraf';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-notify-'));
const { sendTo } = await import('../src/notify.js');

const tgError = (error_code: number, description = 'x') => Object.assign(new Error(description), { response: { error_code, description } });

/** Fake bot: `plan[chatId]` lists what each successive attempt does — 'ok' or an error. */
function fakeBot(plan: Record<number, Array<'ok' | Error>>) {
    const attempts: Record<number, number> = {};
    const bot = {
        telegram: {
            sendMessage: async (chatId: number) => {
                const i = (attempts[chatId] = (attempts[chatId] ?? 0) + 1) - 1;
                const step = plan[chatId]?.[i] ?? 'ok';
                if (step !== 'ok') throw step;
            },
        },
    } as unknown as Telegraf;
    return { bot, attempts };
}

test('send: a network failure is retried until it goes through', async () => {
    const net = Object.assign(new Error('connect ETIMEDOUT'), {});
    const { bot, attempts } = fakeBot({ 1: [net, net, 'ok'], 2: ['ok'] });
    await sendTo(bot, [1, 2], 'h', false, [0, 0, 0]);
    assert.deepEqual(attempts, { 1: 3, 2: 1 });
});

test('send: gives up after the last retry', async () => {
    const net = new Error('connect ETIMEDOUT');
    const { bot, attempts } = fakeBot({ 1: [net, net, net, net, net] });
    await sendTo(bot, [1], 'h', false, [0, 0, 0]);
    assert.equal(attempts[1], 4);
});

test('send: 400 (bad message) is not retried', async () => {
    const { bot, attempts } = fakeBot({ 1: [tgError(400), 'ok'] });
    await sendTo(bot, [1], 'h', false, [0, 0, 0]);
    assert.equal(attempts[1], 1);
});

test('send: a 403 whose unsubscribe cannot be saved (disk read-only) is logged, never thrown', async () => {
    const { addSubscriber } = await import('../src/storage.js');
    addSubscriber(77, 'x');
    fs.chmodSync(process.env.DATA_DIR!, 0o500);
    try {
        const { bot } = fakeBot({ 77: [tgError(403)] });
        await sendTo(bot, [77], 'h', false, [0, 0, 0]);
    } finally {
        fs.chmodSync(process.env.DATA_DIR!, 0o700);
    }
});
