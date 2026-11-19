import type { TownCfg } from './config.js';
import { escapeHtml } from './text.js';
import type { IncomingMessage } from './types.js';
import type { WindowDecision } from './window.js';

const kyivTime = new Intl.DateTimeFormat('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Kyiv',
});

/** 2–4 джерела, 5+ джерел. */
function sourcesWord(n: number): string {
    const last = n % 10;
    const teen = n % 100 >= 11 && n % 100 <= 14;
    return !teen && last >= 2 && last <= 4 ? 'джерела' : 'джерел';
}

/**
 * Telegram rejects a message over 4096 characters (400, not retried), so an
 * over-long post would reach nobody. Header and footer stay well under the gap.
 */
const MAX_POST_CHARS = 3500;

function clip(text: string): string {
    if (text.length <= MAX_POST_CHARS) return text;
    // Never cut an emoji (surrogate pair) in half.
    const cut = /[\uD800-\uDBFF]/.test(text[MAX_POST_CHARS - 1]) ? MAX_POST_CHARS - 1 : MAX_POST_CHARS;
    return text.slice(0, cut) + '…';
}

export interface ShownTown {
    town: TownCfg;
    d: WindowDecision;
}

/**
 * One alert for one post, listing only the towns this recipient follows. Only
 * confirmed (loud) towns ever reach here — see pipeline.ts.
 * A single town keeps the original layout: confidence in the header, corroboration
 * in the footer. Several towns put each town's confidence in the header instead.
 */
/** First line of every beta alert — the line a phone notification shows. */
export const BETA_MARK = '🧪 <b>БЕТА</b> — бачите лише ви';

export function formatAlert(
    msg: IncomingMessage,
    text: string,
    label: string,
    shown: ShownTown[],
    beta = false,
): string {
    const link = `https://t.me/${msg.channelUsername}/${msg.messageId}`;

    let header: string;
    let confidence = '';
    if (shown.length === 1) {
        const { town, d } = shown[0];
        header = `🚨 <b>${town.header}</b>`;
        if (d.sourceCount > 1) confidence = ` · підтверджено (${d.sourceCount} ${sourcesWord(d.sourceCount)})`;
    } else {
        header = '🚨 ' + shown.map(({ town, d }) => `<b>${town.header}</b>`).join(' · ');
    }

    return [
        ...(beta ? [BETA_MARK] : []),
        header,
        '',
        escapeHtml(clip(text)),
        '',
        `<i>${escapeHtml(label)} · ${kyivTime.format(msg.date)}${confidence} · <a href="${link}">відкрити</a></i>`,
    ].join('\n');
}
