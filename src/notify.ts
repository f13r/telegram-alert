import { setTimeout as sleep } from 'node:timers/promises';
import type { Telegraf } from 'telegraf';
import { getSubscribers, removeSubscriber } from './storage.js';
import type { Subscriber } from './types.js';

/** Subscribers who should get the same rendering of one alert. */
export interface DeliveryGroup {
    /** Matched towns this group follows, in the order they were matched. */
    towns: string[];
    chatIds: number[];
}

/**
 * Split subscribers by which of the matched towns they follow. Someone who muted
 * every matched town is left out entirely.
 */
export function groupByTowns(
    subs: Subscriber[],
    matched: string[],
    follow: (s: Subscriber) => string[],
): DeliveryGroup[] {
    const groups = new Map<string, DeliveryGroup>();
    for (const s of subs) {
        const mine = new Set(follow(s));
        const towns = matched.filter((t) => mine.has(t));
        if (towns.length === 0) continue;
        const key = towns.join(',');
        const g = groups.get(key) ?? { towns, chatIds: [] };
        g.chatIds.push(s.chatId);
        groups.set(key, g);
    }
    return [...groups.values()];
}

/** Pauses before each retry. A home connection that flaps usually recovers within these. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

/**
 * `silent` maps to Telegram's disable_notification: the message still appears
 * in the chat, the phone just stays quiet.
 *
 * Each raid is announced once, so a failed send is retried — a lost send means
 * that subscriber never hears about the raid. Chats that failed are retried
 * together, so one bad chat never delays the others' first attempt.
 * 403 (blocked) and 400 (message rejected) are final and never retried.
 */
export async function sendTo(
    bot: Telegraf,
    chatIds: number[],
    html: string,
    silent: boolean,
    retryDelaysMs = RETRY_DELAYS_MS,
): Promise<void> {
    let pending = chatIds;
    let wait = 0;
    for (let attempt = 0; pending.length > 0; attempt++) {
        if (attempt > 0) await sleep(Math.max(retryDelaysMs[attempt - 1], wait));
        const failed: number[] = [];
        wait = 0;
        for (const chatId of pending) {
            try {
                await bot.telegram.sendMessage(chatId, html, {
                    parse_mode: 'HTML',
                    disable_notification: silent,
                    link_preview_options: { is_disabled: true },
                });
            } catch (e) {
                const err = e as { response?: { error_code?: number; description?: string; parameters?: { retry_after?: number } } };
                const code = err.response?.error_code;
                const why = err.response?.description ?? (e as Error).message;
                if (code === 403) {
                    // Blocked the bot or deleted the chat — stop trying forever.
                    removeSubscriber(chatId);
                    console.warn(`[notify] ${chatId} blocked the bot, unsubscribed`);
                } else if (code === 400 || attempt >= retryDelaysMs.length) {
                    console.error(`[notify] ${chatId}: ${why} — giving up after ${attempt + 1} attempt(s)`);
                } else {
                    // 429 says how long to back off; honour it.
                    wait = Math.max(wait, (err.response?.parameters?.retry_after ?? 0) * 1000);
                    console.warn(`[notify] ${chatId}: ${why} — retry ${attempt + 1}/${retryDelaysMs.length}`);
                    failed.push(chatId);
                }
            }
        }
        pending = failed;
    }
}

/** Every subscriber, regardless of towns — for watchdog warnings. */
export async function broadcast(bot: Telegraf, html: string, silent: boolean): Promise<void> {
    await sendTo(bot, getSubscribers().map((s) => s.chatId), html, silent);
}
