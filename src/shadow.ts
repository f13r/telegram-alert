import fs from 'node:fs';
import path from 'node:path';
import { env } from './config.js';

export interface ShadowEntry {
    ts: string;
    channel: string;
    messageId: number;
    isEdit: boolean;
    text: string;
    matched: boolean;
    /** Town ids the text named — empty when matched is false. */
    towns: string[];
    /** null when the channel has no danger filter. */
    danger: boolean | null;
    /** Missile/КАБ wording — passes a cooldown. Absent when false. */
    fast?: boolean;
    /** Towns named only as a landmark («східніше Вінниці») — never alerted. */
    landmarkOnly?: string[];
    /** townId → confidence. Set when the window recorded the match, delivered or `unconfirmed`. */
    confidencePct?: Record<string, number>;
    dropped?: string;
}

const fileFor = (d: Date) =>
    path.join(env.dataDir, `shadow-${d.toISOString().slice(0, 10)}.ndjson`);

/**
 * Every message from every monitored channel, matched or not. This is how a
 * phrasing the matcher missed becomes findable after the fact:
 *
 *   grep -i 'вінн\|ладиж\|козят' data/shadow-*.ndjson | jq 'select(.matched==false)'
 */
export function logMessage(entry: ShadowEntry): void {
    try {
        fs.mkdirSync(env.dataDir, { recursive: true });
        fs.appendFileSync(fileFor(new Date()), JSON.stringify(entry) + '\n');
    } catch (e) {
        console.error('[shadow]', (e as Error).message);
    }
}

/** Bounded SD-card writes: drop logs older than SHADOW_RETENTION_DAYS. */
export function rotate(): void {
    try {
        const cutoff = Date.now() - env.shadowRetentionDays * 24 * 60 * 60 * 1000;
        for (const f of fs.readdirSync(env.dataDir)) {
            if (!/^shadow-\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)) continue;
            const day = Date.parse(f.slice(7, 17));
            if (Number.isFinite(day) && day < cutoff) {
                fs.unlinkSync(path.join(env.dataDir, f));
                console.log(`[shadow] removed ${f}`);
            }
        }
    } catch (e) {
        console.error('[shadow] rotate:', (e as Error).message);
    }
}
