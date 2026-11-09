import { Telegraf } from 'telegraf';
import { channelsConfig, env, townById, towns } from './config.js';
import { fastTowns, isNews, isThreatReport } from './danger.js';
import { scanTowns } from './matcher.js';
import { trackOf } from './notify.js';
import {
    addSubscriber,
    followedTowns,
    getSubscriber,
    getSubscribers,
    getTownWindow,
    removeSubscriber,
    toggleTown,
} from './storage.js';
import { escapeHtml } from './text.js';
import type { Subscriber } from './types.js';
import { healthReport } from './watchdog.js';

const startedAt = Date.now();

function uptime(): string {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return [d && `${d}д`, h && `${h}год`, `${m}хв`].filter(Boolean).join(' ');
}

const kyiv = (ms: number) => new Date(ms).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

/** The /cities message: one button per town, tap to toggle. */
export function citiesKeyboard(sub: Subscriber) {
    const on = new Set(followedTowns(sub));
    const text =
        'Міста для сповіщень — натисніть, щоб увімкнути або вимкнути:' +
        (on.size === 0 ? '\n\n⚠️ Ви не відстежуєте жодного міста — сповіщень не буде.' : '');
    return {
        text,
        reply_markup: {
            inline_keyboard: towns.map((t) => [
                { text: `${on.has(t.id) ? '✅' : '⬜'} ${t.name}`, callback_data: `town:${t.id}` },
            ]),
        },
    };
}

/** A tap on a /cities button. `changed` = the keyboard needs redrawing. */
export function onTownTap(chatId: number, townId: string): { answer: string; changed: boolean } {
    if (!getSubscriber(chatId)) return { answer: 'Ви не підписані.', changed: false };
    const town = townById.get(townId);
    // A button from an old /cities message can outlive its town's config file.
    if (!town) return { answer: 'Місто більше не відстежується', changed: false };
    const on = toggleTown(chatId, townId);
    return { answer: `${town.name} ${on ? 'увімкнено' : 'вимкнено'}`, changed: true };
}

/**
 * /test: what the pipeline would do with this text if each channel posted it as
 * the first post about the town — the same rules as pipeline.ts, so it never
 * promises an alert that would not come.
 */
export function testReport(text: string, beta = false): string {
    // Districts are scanned too; channels without localDistricts are told apart below.
    const { matches, landmarkOnly } = scanTowns(text, { local: true });
    const districtsOnly = matches.every((m) => m.district);
    const threshold = channelsConfig.loudThresholdPct;
    const lines = matches.map(
        (m) => `✓ ${townById.get(m.townId)!.name}: <code>${escapeHtml(m.form)}</code>${m.district ? ' (район)' : ''}`,
    );
    for (const id of landmarkOnly) lines.push(`✗ ${townById.get(id)!.name}: лише як орієнтир («східніше…»)`);
    if (lines.length === 0) lines.push('✗ жодного міста');
    if (matches.length === 0) return [...lines, '', '<i>не надішле сповіщення</i>'].join('\n');

    if (fastTowns(text, matches.map((m) => m.townId), { local: true }).length) lines.push('🚀 ракета/КАБ — пройде й під час 15-хв паузи');
    lines.push('', '<i>якщо це перший допис про місто:</i>');
    for (const c of channelsConfig.channels.filter((ch) => beta || !ch.beta)) {
        const verdict =
            districtsOnly && !c.localDistricts
                ? '✗ район — лише для місцевих каналів'
                : c.requiresThreat && !isThreatReport(text)
                ? '✗ не загроза (немає ключового слова, або довгий допис/новина)'
                : c.rejectNews && isNews(text)
                ? '✗ новина про наслідки, не загроза'
                : c.reliability * 100 >= threshold
                  ? '✓ одразу'
                  : `✗ лише з підтвердженням іншого каналу (${Math.round(c.reliability * 100)}%)`;
        lines.push(`${escapeHtml(c.label)}: ${verdict}`);
    }
    return lines.join('\n');
}

export function buildBot(sourceName: string): Telegraf {
    const bot = new Telegraf(env.botToken);

    // Telegraf's default rethrows, which stops polling and — via the discarded
    // launch() promise — kills the whole process, scraper included. A tap on a
    // stale /cities button («query is too old») was enough.
    bot.catch((e, ctx) => console.error(`[bot] update ${ctx.update.update_id}:`, (e as Error).message));

    bot.telegram
        .setMyCommands([
            { command: 'cities', description: 'Обрати міста' },
            { command: 'status', description: 'Стан бота' },
            { command: 'test', description: 'Перевірити текст' },
            { command: 'stop', description: 'Відписатися' },
        ])
        .catch((e) => console.warn('[bot] setMyCommands:', (e as Error).message));

    bot.start(async (ctx) => {
        const payload = (ctx.payload ?? '').trim();
        if (payload !== env.joinSecret || !env.joinSecret) {
            return ctx.reply('Це приватний бот. Потрібне запрошення.');
        }
        const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'невідомо';
        const added = addSubscriber(ctx.chat.id, name);
        const on = added ? followedTowns(getSubscriber(ctx.chat.id)!).map((id) => townById.get(id)!.name) : [];
        await ctx.reply(
            added
                ? `✅ Підписано на сповіщення про загрозу для міст: ${on.join(', ')}.\n\n` +
                      'Додати інші міста: /cities\n\n' +
                      'Порада: увімкніть для цього чату окремий гучний звук і додайте у винятки «Не турбувати».'
                : 'Ви вже підписані. Обрати міста: /cities',
        );
    });

    bot.command('stop', async (ctx) => {
        await ctx.reply(removeSubscriber(ctx.chat.id) ? 'Відписано.' : 'Ви не були підписані.');
    });

    bot.command('cities', async (ctx) => {
        const sub = getSubscriber(ctx.chat.id);
        if (!sub) return ctx.reply('Ви не підписані.');
        const k = citiesKeyboard(sub);
        await ctx.reply(k.text, { reply_markup: k.reply_markup });
    });

    bot.action(/^town:(.+)$/, async (ctx) => {
        const chatId = ctx.chat?.id ?? ctx.from.id;
        const { answer, changed } = onTownTap(chatId, ctx.match[1]);
        await ctx.answerCbQuery(answer);
        const sub = getSubscriber(chatId);
        if (!changed || !sub) return;
        const k = citiesKeyboard(sub);
        await ctx.editMessageText(k.text, { reply_markup: k.reply_markup }).catch(() => {
            // "message is not modified" after a double tap — harmless.
        });
    });

    bot.command('status', async (ctx) => {
        const cooldownMs = env.cooldownMin * 60_000;
        const windowLines = towns.map((t) => {
            const { loudAt } = getTownWindow(t.id);
            const until = loudAt !== null && Date.now() - loudAt < cooldownMs ? loudAt + cooldownMs : null;
            const last = loudAt ? kyiv(loudAt) : '—';
            return `${t.name}: ${until ? `пауза до ${kyiv(until)}` : 'чергує'} · остання тривога ${last}`;
        });
        const sub = getSubscriber(ctx.chat.id);
        const mine = sub ? followedTowns(sub).map((id) => townById.get(id)!.name).join(', ') || 'жодного' : '—';
        await ctx.replyWithHTML(
            [
                `<b>Статус</b>`,
                `джерело: ${sourceName}`,
                `канали: ${channelsConfig.channels.filter((c) => trackOf(ctx.chat.id) === 'beta' || !c.beta).length}`,
                `підписників: ${getSubscribers().length}`,
                `аптайм: ${uptime()}`,
                `ваші міста: ${escapeHtml(mine)}`,
                '',
                ...windowLines.map(escapeHtml),
                '',
                healthReport(),
            ].join('\n'),
        );
    });

    bot.command('test', async (ctx) => {
        const text = ctx.message.text.replace(/^\/test(@\S+)?\s*/, '');
        if (!text) return ctx.reply('Використання: /test <текст повідомлення>');

        await ctx.replyWithHTML(testReport(text, trackOf(ctx.chat.id) === 'beta'));
    });

    return bot;
}
