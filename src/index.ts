import cron from 'node-cron';
import { buildBot } from './bot.js';
import { channelsConfig, env, towns } from './config.js';
import { broadcast, groupByTowns, sendTo, trackOf } from './notify.js';
import { acquireLock } from './lock.js';
import { handleMessage } from './pipeline.js';
import { rotate } from './shadow.js';
import { FakeSource } from './sources/fake.js';
import { ScrapeSource } from './sources/scrape.js';
import { followedTowns, getSubscribers } from './storage.js';
import { checkWatchdog, initWatchdog } from './watchdog.js';
import type { MessageSource, Track } from './types.js';
import type { WindowDecision } from './window.js';

const dryRun = process.env.DRY_RUN === '1';

function pickSource(): MessageSource {
    return env.source === 'fake' ? new FakeSource() : new ScrapeSource();
}

async function main(): Promise<void> {
    acquireLock();
    const source = pickSource();
    const bot = buildBot(source.name);

    console.log(
        `[boot] source=${source.name} channels=${channelsConfig.channels.length} towns=${towns.map((t) => t.id).join(',')} ` +
            `loud≥${channelsConfig.loudThresholdPct}% cooldown=${env.cooldownMin}m fresh=${env.freshnessMin}m` +
            (env.betaChatIds.size ? ` beta=${[...env.betaChatIds].join(',')}` : '') +
            (dryRun ? ' DRY_RUN' : ''),
    );

    const print = (html: string, silent: boolean, track: Track = 'stable'): void => {
        const plain = html.replace(/<[^>]+>/g, '');
        console.log(`\n┌─ ${silent ? 'silent' : 'LOUD 🔔'}${track === 'beta' ? ' [beta]' : ''}\n${plain.split('\n').map((l) => '│ ' + l).join('\n')}\n└─\n`);
    };

    /** Watchdog warnings — every subscriber, whatever towns they follow. */
    const send = async (html: string, silent: boolean): Promise<void> => {
        if (dryRun || getSubscribers().length === 0) return print(html, silent);
        await broadcast(bot, html, silent);
    };

    /**
     * Alerts — each subscriber gets one message covering only the towns they follow,
     * and only from their own track.
     */
    const deliverTo = (track: Track) => async (
        decisions: Map<string, WindowDecision>,
        render: (towns: string[]) => string,
    ): Promise<void> => {
        // Every delivered town is loud: pipeline.ts drops the rest before calling this.
        const matched = [...decisions.keys()];
        if (dryRun || getSubscribers().length === 0) return print(render(matched), false, track);
        const subs = getSubscribers().filter((s) => trackOf(s.chatId) === track);
        // Not awaited: retries can take ~20 s and must not hold up the next post.
        void Promise.all(
            groupByTowns(subs, matched, followedTowns).map((g) =>
                sendTo(bot, g.chatIds, render(g.towns), false),
            ),
        ).catch((e) => console.error('[notify]', (e as Error).message));
    };

    // Commands only — alerts are sent directly and work even while polling is down.
    // launch() rejects when getMe fails (network down at boot); retry, never crash.
    const launch = (): void => {
        bot.launch(() => console.log('[bot] polling')).catch((e) => {
            console.error('[bot] polling stopped:', (e as Error).message, '— retrying in 30s');
            setTimeout(launch, 30_000);
        });
    };
    if (!dryRun) launch();

    rotate();
    cron.schedule('17 4 * * *', rotate, { timezone: 'Europe/Kyiv' });

    const stable = deliverTo('stable');
    const beta = deliverTo('beta');
    await source.start(async (msg) => {
        await handleMessage(msg, { deliver: stable });
        if (env.betaChatIds.size === 0) return;
        // A bug in beta-only code must never cost stable anything: stable already ran.
        await handleMessage(msg, { track: 'beta', deliver: beta }).catch((e) =>
            console.error('[beta] pipeline:', (e as Error).message),
        );
    });

    // Warns about a source that has gone silent. Started after the source, so it
    // only watches channels this source could actually reach. Delivered quietly —
    // a broken scraper is urgent to know about, but it is not an air-raid alert.
    initWatchdog(Date.now(), source.activeChannels?.());
    cron.schedule('43 * * * *', () => {
        for (const w of checkWatchdog()) {
            console.warn(`[watchdog] ${w.kind}`);
            send(w.text, true).catch((e) => console.error('[watchdog] send:', (e as Error).message));
        }
    }, { timezone: 'Europe/Kyiv' });

    const shutdown = async (sig: string): Promise<void> => {
        console.log(`\n[boot] ${sig}, stopping`);
        try {
            await source.stop();
            // Throws «Bot is not running!» if launch() never got past getMe.
            if (!dryRun) bot.stop(sig);
        } catch (e) {
            console.error('[boot] stop:', (e as Error).message);
        }
        process.exit(0);
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
    console.error('[boot] fatal:', e);
    process.exit(1);
});
