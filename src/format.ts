import { channelsConfig, type TownCfg } from './config.js';
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

export interface ShownTown {
    town: TownCfg;
    d: WindowDecision;
}

/**
 * One alert for one post, listing only the towns this recipient follows.
 * A single town keeps the original layout: confidence in the header, corroboration
 * in the footer. Several towns put each town's confidence in the header instead.
 */
export function formatAlert(msg: IncomingMessage, text: string, label: string, shown: ShownTown[]): string {
    const threshold = channelsConfig.loudThresholdPct;
    const icon = shown.some((s) => s.d.loud) ? '🚨' : '•';
    const link = `https://t.me/${msg.channelUsername}/${msg.messageId}`;

    let header: string;
    let confidence = '';
    if (shown.length === 1) {
        const { town, d } = shown[0];
        header = `${icon} <b>${town.header}</b> · ${d.confidencePct}%`;
        if (d.confidencePct < threshold) {
            confidence = ' · непідтверджено';
        } else if (d.sourceCount > 1) {
            confidence = ` · підтверджено (${d.sourceCount} ${sourcesWord(d.sourceCount)})`;
        }
    } else {
        header =
            `${icon} ` +
            shown
                .map(({ town, d }) =>
                    `<b>${town.header}</b> ${d.confidencePct}%` +
                    (d.confidencePct < threshold ? ' (непідтверджено)' : ''),
                )
                .join(' · ');
    }

    return [
        header,
        '',
        escapeHtml(text),
        '',
        `<i>${escapeHtml(label)} · ${kyivTime.format(msg.date)}${confidence} · <a href="${link}">відкрити</a></i>`,
    ].join('\n');
}
