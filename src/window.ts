import { channelByUsername, channelsConfig, env } from './config.js';
import type { WindowState } from './types.js';

export interface WindowDecision {
    /** 1 − Π(1 − rᵢ) over corroborating channels, as a percentage. */
    confidencePct: number;
    /** Deliver, with sound. */
    loud: boolean;
    /** Distinct channels corroborating inside the correlation window. */
    sourceCount: number;
    /** Held back: the town is in its cooldown after a loud alert. */
    cooldown: boolean;
}

const reliabilityOf = (username: string): number =>
    channelByUsername.get(username.toLowerCase())?.reliability ?? 0;

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
export function recordMatch(state: WindowState, username: string, fast: boolean, now = Date.now()): WindowDecision {
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
    if (counted) pool[username] = now;

    const names = new Set([...Object.keys(pool), username]);
    const product = [...names].reduce((acc, u) => acc * (1 - reliabilityOf(u)), 1);
    const confidencePct = Math.round((1 - product) * 100);
    const loud = counted && confidencePct >= threshold;

    if (loud) {
        state.loudAt = now;
        state.sources = {};
        state.fastSources = {};
    }

    return { confidencePct, loud, sourceCount: names.size, cooldown: inCooldown && !loud };
}
