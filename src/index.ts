import cron from 'node-cron';
import { buildBot } from './bot.js';
import { channelsConfig, env, towns } from './config.js';
import { broadcast, groupByTowns, sendTo } from './notify.js';
import { acquireLock } from './lock.js';
import { handleMessage } from './pipeline.js';
import { rotate } from './shadow.js';
import { FakeSource } from './sources/fake.js';
import { MtprotoSource } from './sources/mtproto.js';
import { ScrapeSource } from './sources/scrape.js';
import { followedTowns, getSubscribers } from './storage.js';
import { checkWatchdog, initWatchdog } from './watchdog.js';
import type { MessageSource } from './types.js';
import type { WindowDecision } from './window.js';

const dryRun = process.env.DRY_RUN === '1';

function pickSource(): MessageSource {
    if (env.source === 'scrape') return new ScrapeSource();
    if (env.source === 'mtproto') {
        if (!env.session) throw new Error('SOURCE=mtproto but TG_SESSION is empty. Run `npm run login`.');
        return new MtprotoSource();
    }
    return new FakeSource();
}

async function main(): Promise<void> {
    acquireLock();
    const source = pickSource();
    const bot = buildBot(source.name);

    console.log(
        `[boot] source=${source.name} channels=${channelsConfig.channels.length} towns=${towns.map((t) => t.id).join(',')} ` +
            `loud≥${channelsConfig.loudThresholdPct}% cooldown=${env.cooldownMin}m fresh=${env.freshnessMin}m` +
            (dryRun ? ' DRY_RUN' : ''),
    );

    const print = (html: string, silent: boolean): void => {
        const plain = html.replace(/<[^>]+>/g, '');
        console.log(`\n┌─ ${silent ? 'silent' : 'LOUD 🔔'}\n${plain.split('\n').map((l) => '│ ' + l).join('\n')}\n└─\n`);
    };

    /** Watchdog warnings — every subscriber, whatever towns they follow. */
    const send = async (html: string, silent: boolean): Promise<void> => {
        if (dryRun || getSubscribers().length === 0) return print(html, silent);
        await broadcast(bot, html, silent);
    };

    /** Alerts — each subscriber gets one message covering only the towns they follow. */
    const deliver = async (
        decisions: Map<string, WindowDecision>,
        render: (towns: string[]) => string,
    ): Promise<void> => {
        const matched = [...decisions.keys()];
        const silentFor = (towns: string[]) => !towns.some((t) => decisions.get(t)!.loud);
        if (dryRun || getSubscribers().length === 0) return print(render(matched), silentFor(matched));
        // Not awaited: retries can take ~20 s and must not hold up the next post.
        void Promise.all(
            groupByTowns(getSubscribers(), matched, followedTowns).map((g) =>
                sendTo(bot, g.chatIds, render(g.towns), silentFor(g.towns)),
            ),
        ).catch((e) => console.error('[notify]', (e as Error).message));
    };

    if (!dryRun) {
        void bot.launch(() => console.log('[bot] polling'));
    }

    rotate();
    cron.schedule('17 4 * * *', rotate, { timezone: 'Europe/Kyiv' });

    await source.start((msg) => handleMessage(msg, { deliver }));

    // Warns about a source that has gone silent. Started after the source, so it
    // only watches channels this source could actually reach. Delivered quietly —
    // a broken scraper is urgent to know about, but it is not an air-raid alert.
    initWatchdog(Date.now(), source.activeChannels?.());
    cron.schedule('43 * * * *', () => {
        for (const w of checkWatchdog()) {
            console.warn(`[watchdog] ${w.kind}`);
            void send(w.text, true);
        }
    }, { timezone: 'Europe/Kyiv' });

    const shutdown = async (sig: string): Promise<void> => {
        console.log(`\n[boot] ${sig}, stopping`);
        await source.stop();
        if (!dryRun) bot.stop(sig);
        process.exit(0);
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
    console.error('[boot] fatal:', e);
    process.exit(1);
});
