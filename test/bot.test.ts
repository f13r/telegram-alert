import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-bot-'));
const { citiesKeyboard, onTownTap } = await import('../src/bot.js');
const { addSubscriber, getSubscriber, toggleTown } = await import('../src/storage.js');

const rows = (chatId: number) =>
    citiesKeyboard(getSubscriber(chatId)!).reply_markup.inline_keyboard.map((r) => r[0].text);

test('keyboard: one row per town, in catalogue order, with state', () => {
    addSubscriber(5, 'x');
    toggleTown(5, 'koziatyn');
    assert.deepEqual(rows(5), ['✅ Вінниця', '✅ Ладижин', '⬜ Козятин']);
    const k = citiesKeyboard(getSubscriber(5)!);
    assert.equal(k.reply_markup.inline_keyboard[1][0].callback_data, 'town:ladyzhyn');
    assert.doesNotMatch(k.text, /жодного/);
});

test('keyboard: everything off warns that no alerts will come', () => {
    toggleTown(5, 'vinnytsia');
    toggleTown(5, 'ladyzhyn');
    assert.match(citiesKeyboard(getSubscriber(5)!).text, /жодного міста/);
});

test('tap: toggles and reports the new state', () => {
    assert.deepEqual(onTownTap(5, 'ladyzhyn'), { answer: 'Ладижин увімкнено', changed: true });
    assert.deepEqual(onTownTap(5, 'ladyzhyn'), { answer: 'Ладижин вимкнено', changed: true });
});

test('tap: a town removed from the catalogue answers instead of throwing', () => {
    assert.deepEqual(onTownTap(5, 'gone'), { answer: 'Місто більше не відстежується', changed: false });
});

test('tap: a non-subscriber is told so', () => {
    assert.deepEqual(onTownTap(42, 'ladyzhyn'), { answer: 'Ви не підписані.', changed: false });
});
