import { channelByUsername, channelsConfig, env, townById } from './config.js';
import { fastTowns, isThreatReport } from './danger.js';
import { formatAlert } from './format.js';
import { scanTowns } from './matcher.js';
import { logMessage } from './shadow.js';
import { getTownWindow, markAlerted, pruneAlerted, save, wasAlerted } from './storage.js';
import { stripFooter } from './text.js';
import type { IncomingMessage } from './types.js';
import { recordMatch, type WindowDecision } from './window.js';

export interface PipelineDeps {
    /**
     * Hand one post's decisions to delivery. `render(towns)` builds the alert for
     * a recipient who follows exactly those towns.
     */
    deliver(decisions: Map<string, WindowDecision>, render: (towns: string[]) => string): Promise<void>;
    now?: () => number;
}

/**
 * One message in, at most one alert per recipient out.
 *
 *   unknown channel → ignored
 *   no town match   → shadow-logged only
 *   landmark only   → shadow-logged as reference-point, dropped («східніше Вінниці»
 *                     is somewhere east of the city, not the city)
 *   stale           → shadow-logged, dropped silently (a boot after a blackout
 *                     must not replay hours-old alerts as if they were live)
 *   mixed channel   → must also contain a danger keyword
 *   already alerted → an edit does not re-notify for a town it already alerted;
 *                     an edit that adds a town alerts for that town only; an edit
 *                     that adds missile/КАБ wording is evaluated once more
 *   unconfirmed     → below loudThresholdPct (Типова Вінниця alone) is recorded in
 *                     the window but never delivered; it only adds confidence once
 *                     a reliable channel reports the same town
 *   cooldown        → the town went loud less than COOLDOWN_MIN ago; not delivered
 *                     and not counted. Missile/КАБ posts (`fast`, judged on the town's
 *                     own region section — see fastTowns) are the exception:
 *                     they go loud through a cooldown and restart it.
 *
 * Each town runs its own window, so a loud Козятин never puts Вінниця in cooldown.
 */
export async function handleMessage(msg: IncomingMessage, deps: PipelineDeps): Promise<void> {
    const now = deps.now?.() ?? Date.now();
    const cfg = channelByUsername.get(msg.channelUsername.toLowerCase());
    if (!cfg) return;

    const text = stripFooter(msg.text, cfg.stripFooterPatterns);
    const { matches, landmarkOnly } = scanTowns(text);
    const danger = cfg.requiresThreat ? isThreatReport(text) : null;
    const fast = new Set(fastTowns(text, matches.map((m) => m.townId)));

    const log = (dropped?: string, confidencePct?: Record<string, number>) =>
        logMessage({
            ts: new Date(now).toISOString(),
            channel: msg.channelUsername,
            messageId: msg.messageId,
            isEdit: msg.isEdit,
            text,
            matched: matches.length > 0,
            towns: matches.map((m) => m.townId),
            danger,
            ...(fast.size ? { fast: true } : {}),
            ...(landmarkOnly.length ? { landmarkOnly } : {}),
            ...(confidencePct ? { confidencePct } : {}),
            ...(dropped ? { dropped } : {}),
        });

    if (matches.length === 0) return log(landmarkOnly.length ? 'reference-point' : undefined);

    if (now - msg.date.getTime() > env.freshnessMin * 60_000) return log('stale');
    if (cfg.requiresThreat && !danger) return log('not-danger');

    const decisions = new Map<string, WindowDecision>();
    for (const m of matches) {
        const key = `${msg.channelUsername}:${msg.messageId}:${m.townId}`;
        // An edit that turns the post into a missile post is new information: it
        // must pass a cooldown that held the original, so it is let through once.
        const isFast = fast.has(m.townId);
        if (wasAlerted(key) && (!isFast || wasAlerted(`${key}:fast`))) continue;
        decisions.set(m.townId, recordMatch(getTownWindow(m.townId), cfg.username, isFast, now));
        markAlerted(key);
        if (isFast) markAlerted(`${key}:fast`);
    }
    if (decisions.size === 0) return log('already-alerted');
    pruneAlerted();
    save();

    const confidencePct = Object.fromEntries([...decisions].map(([t, d]) => [t, d.confidencePct]));
    // Only loud towns are delivered; a town in cooldown drops out of the header.
    const unconfirmed = [...decisions.values()].every((d) => d.confidencePct < channelsConfig.loudThresholdPct);
    for (const [t, d] of decisions) if (!d.loud) decisions.delete(t);
    if (decisions.size === 0) return log(unconfirmed ? 'unconfirmed' : 'cooldown', confidencePct);

    log(undefined, confidencePct);

    const render = (towns: string[]) =>
        formatAlert(
            msg,
            text,
            cfg.label,
            towns.map((id) => ({ town: townById.get(id)!, d: decisions.get(id)! })),
        );
    await deps.deliver(decisions, render);

    for (const m of matches) {
        const d = decisions.get(m.townId);
        if (!d) continue;
        console.log(
            `[alert] ${d.loud ? 'LOUD  ' : 'silent'} ${d.confidencePct}% ${d.sourceCount} src  ` +
                `${m.townId}  @${msg.channelUsername}  «${m.form}»`,
        );
    }
}
