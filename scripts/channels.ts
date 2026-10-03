/**
 * Verify the account is subscribed to every configured channel, and cache their
 * numeric ids. Run: npm run channels
 *
 * Uses a single getDialogs call rather than resolving each username, so the
 * account's outbound footprint stays at one request.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

dotenv.config();

interface ChannelCfg {
    username: string;
    label: string;
    reliability: number;
    requiresThreat: boolean;
}

const cfg = JSON.parse(fs.readFileSync('config/channels.json', 'utf8')) as {
    channels: ChannelCfg[];
};

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH!;
const session = process.env.TG_SESSION;
const dataDir = process.env.DATA_DIR ?? './data';

if (!session) {
    console.error('✗ TG_SESSION missing. Run `npm run login` first.');
    process.exit(1);
}

async function main(): Promise<void> {
    const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
        connectionRetries: 5,
    });
    await client.connect();

    const dialogs = await client.getDialogs({ limit: 500 });
    const byUsername = new Map<string, { id: string; title: string }>();
    for (const d of dialogs) {
        const e = d.entity as { username?: string; id?: unknown; title?: string } | undefined;
        if (e?.username) {
            byUsername.set(e.username.toLowerCase(), {
                id: String(e.id),
                title: e.title ?? e.username,
            });
        }
    }

    const resolved: Record<string, { id: string; title: string }> = {};
    let missing = 0;

    for (const c of cfg.channels) {
        const hit = byUsername.get(c.username.toLowerCase());
        if (hit) {
            resolved[c.username] = hit;
            console.log(`✓ @${c.username.padEnd(20)} ${String(Math.round(c.reliability * 100)).padStart(3)}%  ${hit.title}`);
        } else {
            missing++;
            console.log(`✗ @${c.username.padEnd(20)}      NOT SUBSCRIBED — join it in your Telegram app`);
        }
    }

    if (Object.keys(resolved).length) {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(
            path.join(dataDir, 'channels.cache.json'),
            JSON.stringify(resolved, null, 2) + '\n',
        );
        console.log(`\n✓ ids cached to ${path.join(dataDir, 'channels.cache.json')}`);
    }
    if (missing) console.log(`\n⚠ ${missing} channel(s) not subscribed — the bot will not see their posts.`);

    await client.disconnect();
}

main().catch((e) => { console.error('✗', e); process.exitCode = 1; });
