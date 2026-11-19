import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-bot-'));
const { buildBot, citiesKeyboard, onTownTap } = await import('../src/bot.js');
const { addSubscriber, getSubscriber, toggleTown } = await import('../src/storage.js');

const rows = (chatId: number) =>
    citiesKeyboard(getSubscriber(chatId)!).reply_markup.inline_keyboard.map((r) => r[0].text);

test('new subscriber starts with only Вінниця on', () => {
    addSubscriber(5, 'x');
    assert.deepEqual(rows(5), ['✅ Вінниця', '⬜ Ладижин', '⬜ Козятин', '⬜ Вороновиця']);
});

test('keyboard: one row per town, in catalogue order, with state', () => {
    toggleTown(5, 'ladyzhyn');
    assert.deepEqual(rows(5), ['✅ Вінниця', '✅ Ладижин', '⬜ Козятин', '⬜ Вороновиця']);
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

test('a failing handler is logged, never rethrown — a rethrow stops polling and kills the process', async () => {
    const bot = buildBot('scrape');
    bot.botInfo = { id: 1, is_bot: true, first_name: 'b', username: 'b' } as typeof bot.botInfo;
    bot.telegram.callApi = (async () => {
        throw Object.assign(new Error('400: Bad Request: query is too old'), { response: { error_code: 400 } });
    }) as typeof bot.telegram.callApi;
    await bot.handleUpdate({
        update_id: 1,
        callback_query: {
            id: 'q',
            chat_instance: 'c',
            data: 'town:ladyzhyn',
            from: { id: 5, is_bot: false, first_name: 'x' },
            message: { message_id: 1, date: 0, chat: { id: 5, type: 'private', first_name: 'x' } },
        },
    } as Parameters<typeof bot.handleUpdate>[0]);
});

const { testReport } = await import('../src/bot.js');

test('/test: Типова alone is shown as needing confirmation, not as an alert', () => {
    const r = testReport('БпЛА на Козятин');
    assert.match(r, /✓ Козятин/);
    assert.match(r, /ПС ЗСУ.*одразу/);
    assert.match(r, /Типова Вінниця.*лише з підтвердженням/);
    assert.doesNotMatch(r, /з будь-якого каналу/);
});

test('/test: a news article is ignored on Типова even with threat words', () => {
    const r = testReport('Як працюють лікарні Вінниці під час тривог\n\nПід час атаки дронів — в укриття.');
    assert.match(r, /Типова Вінниця.*не загроза/);
});

test('/test: ППО needs confirmation; its news about last night is dropped', () => {
    assert.match(testReport('❗️ВІННИЦЯ, в укриття !'), /ППО Вінниця.*лише з підтвердженням.*80%/);
    const r = testReport('💥 Внаслідок удару ворога по пʼятиповерхівці у Вінниці, постраждали 6 людей');
    assert.match(r, /ППО Вінниця.*новина про наслідки/);
    assert.match(r, /ПС ЗСУ.*одразу/, 'national channels are not news-filtered');
});

test('/test: a landmark-only mention says why nothing is sent', () => {
    const r = testReport('1х реактивний східніше Вінниці на Погребище');
    assert.match(r, /орієнтир/);
    assert.match(r, /не надішле/);
});

test('/test: a missile is flagged as passing a cooldown', () => {
    assert.match(testReport('2х крилаті ракети курсом на Вінницю'), /ракета\/КАБ/);
});

test('/test: beta channels are listed only for beta chats', () => {
    assert.doesNotMatch(testReport('БпЛА на Козятин'), /ППО ВІННИЦЯ 📡|ППО у Вінницькій/);
    const r = testReport('БпЛА на Козятин', true);
    assert.match(r, /ППО ВІННИЦЯ 📡.*лише з підтвердженням.*80%/);
    assert.match(r, /ППО у Вінницькій області.*лише з підтвердженням.*50%/);
});
