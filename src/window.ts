import { channelByUsername, channelsConfig, env } from './config.js';
import type { WindowState } from './types.js';

export interface WindowDecision {
    /** 1 − Π(1 − rᵢ) over corroborating channels, as a percentage. */
    confidencePct: number;
    /** Deliver, with sound. */
    loud: boolean;
    /** Distinct channels corroborating inside the correlation window. */
    sourceCount: number;
}

/** Pool key of a post that only points toward the town: it counts for half. */
const VAGUE = '~vague';
const VAGUE_RELIABILITY = 0.5;

const reliabilityOf = (key: string): number => {
    const vague = key.endsWith(VAGUE);
    const r = channelByUsername.get((vague ? key.slice(0, -VAGUE.length) : key).toLowerCase())?.reliability ?? 0;
    return vague ? Math.min(r, VAGUE_RELIABILITY) : r;
};

/**
 * Record a match and decide whether it is delivered.
 *
 *  - The first post to reach the threshold is LOUD and starts a fixed cooldown
 *    (COOLDOWN_MIN). During it nothing is delivered and later posts do not extend it.
 *  - Exception: a `fast` post (missile, КАБ) can still go loud during a cooldown,
 *    and restarts it. During a cooldown only fast posts corroborate each other.
 *  - Every loud alert clears the corroboration, so after a cooldown confidence is
 *    built from fresh posts only — Типова Вінниця alone still needs a reliable channel.
 */
export function recordMatch(state: WindowState, username: string, fast: boolean, now = Date.now(), vague = false): WindowDecision {
    const cooldownMs = env.cooldownMin * 60_000;
    const corrMs = channelsConfig.correlationWindowMin * 60_000;
    const threshold = channelsConfig.loudThresholdPct;

    // A clock that stepped back would otherwise hold the town in cooldown until it
    // caught up with the old alert. Restart the cooldown from now instead.
    if (state.loudAt !== null && state.loudAt > now) state.loudAt = now;
    const inCooldown = state.loudAt !== null && now - state.loudAt < cooldownMs;
    const pool = inCooldown ? state.fastSources : state.sources;
    for (const [u, ts] of Object.entries(pool)) {
        if (now - ts > corrMs) delete pool[u];
    }
    const counted = !inCooldown || fast;
    const key = vague ? username + VAGUE : username;
    if (counted) pool[key] = now;

    // One channel counts once, at its best reliability: a vague post plus a direct one
    // from the same channel is still a single source.
    const best = new Map<string, number>();
    for (const k of new Set([...Object.keys(pool), key])) {
        const base = k.endsWith(VAGUE) ? k.slice(0, -VAGUE.length) : k;
        best.set(base, Math.max(best.get(base) ?? 0, reliabilityOf(k)));
    }
    const names = new Set(best.keys());
    const product = [...best.values()].reduce((acc, r) => acc * (1 - r), 1);
    const confidencePct = Math.round((1 - product) * 100);
    const loud = counted && confidencePct >= threshold;

    if (loud) {
        state.loudAt = now;
        state.sources = {};
        state.fastSources = {};
    }

    return { confidencePct, loud, sourceCount: names.size };
}
