import { channelsConfig } from './config.js';

const HOUR = 60 * 60 * 1000;

const quietMs = (Number(process.env.WATCHDOG_QUIET_HOURS) || 6) * HOUR;
const parseStaleMs = (Number(process.env.WATCHDOG_PARSE_STALE_HOURS) || 1) * HOUR;

interface Health {
    /** Last time the source could read this channel at all. */
    lastOk: number;
    /** Last time a NEW post appeared. */
    lastPost: number;
}

export interface Warning {
    kind: 'all-unreadable' | 'all-quiet' | 'recovered';
    text: string;
}

const health = new Map<string, Health>();
const reasons = new Map<string, string>();
let warned = false;

export function initWatchdog(now = Date.now(), only?: string[]): void {
    health.clear();
    reasons.clear();
    warned = false;
    const watched = only?.length
        ? channelsConfig.channels.filter((c) => only.includes(c.username))
        : channelsConfig.channels;
    for (const c of watched) health.set(c.username, { lastOk: now, lastPost: now });
}

export function recordOk(username: string, now = Date.now()): void {
    const h = health.get(username);
    if (h) h.lastOk = now;
}

export function recordPost(username: string, now = Date.now()): void {
    const h = health.get(username);
    if (h) {
        h.lastOk = now;
        h.lastPost = now;
    }
}

export function markUnavailable(username: string, reason: string): void {
    reasons.set(username, reason);
}

const hours = (ms: number) => Math.floor(ms / HOUR);

/**
 * Warns only when EVERY channel has gone dark at once.
 *
 * A single quiet channel is not evidence of anything: monitoring channels go
 * quiet when there is nothing to report, and one of them posts "тимчасово
 * офлайн" for hours at a time. As long as any other channel is still producing
 * posts, the pipeline is demonstrably working — and waking someone to tell them
 * otherwise is worse than saying nothing.
 *
 * Per-channel problems are visible in /status and the log instead.
 */
export function checkWatchdog(now = Date.now()): Warning[] {
    if (health.size === 0) return [];

    const entries = [...health.entries()];
    const allUnreadable = entries.every(([, h]) => now - h.lastOk > parseStaleMs);
    const allQuiet = entries.every(([, h]) => now - h.lastPost > quietMs);
    const degraded = allUnreadable || allQuiet;

    if (degraded && !warned) {
        warned = true;
        if (allUnreadable) {
            const oldest = Math.max(...entries.map(([, h]) => now - h.lastOk));
            const named = entries
                .map(([u]) => reasons.get(u))
                .find((r): r is string => Boolean(r));
            return [{
                kind: 'all-unreadable',
                text:
                    `⚠️ <b>Жоден канал не читається</b> вже ${hours(oldest)} год.\n` +
                    (named ? `${named}\n` : 'Схоже на проблему з мережею або блокування t.me.\n') +
                    `Перевірте: <code>npm run scrapecheck</code>`,
            }];
        }
        const oldest = Math.max(...entries.map(([, h]) => now - h.lastPost));
        return [{
            kind: 'all-quiet',
            text:
                `⚠️ <b>Жодного допису з усіх ${entries.length} каналів</b> вже ${hours(oldest)} год.\n` +
                `Сторінки читаються, але потік порожній — можливо, бот більше не бачить нові дописи.`,
        }];
    }

    if (!degraded && warned) {
        warned = false;
        return [{ kind: 'recovered', text: '✅ <b>Потік відновлено</b> — канали знову надходять.' }];
    }

    return [];
}

/** Per-channel detail, on demand via /status — never pushed. */
export function healthReport(now = Date.now()): string {
    if (health.size === 0) return 'немає каналів під наглядом';
    return [...health.entries()]
        .map(([u, h]) => {
            const readable = now - h.lastOk <= parseStaleMs;
            const since = hours(now - h.lastPost);
            const age = since >= 1 ? `${since} год тому` : 'щойно';
            return `${readable ? '✓' : '✗'} @${u} — останній допис ${age}`;
        })
        .join('\n');
}
