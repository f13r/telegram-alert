/**
 * One-time MTProto login. Run: npm run login
 *
 * Produces TG_SESSION and writes it into .env. Run this ONCE — repeated logins
 * are the behaviour that draws attention to a user account, which is exactly
 * what this project is designed to avoid.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import dotenv from 'dotenv';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

dotenv.config();

const ENV_PATH = path.resolve('.env');
const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;

if (!apiId || !apiHash) {
    console.error('✗ TG_API_ID / TG_API_HASH missing from .env');
    process.exit(1);
}

const rl = readline.createInterface({ input: stdin, output: stdout });
const ask = (q: string) => rl.question(q);

async function main(): Promise<void> {
    if (process.env.TG_SESSION) {
        const yes = await ask('⚠  TG_SESSION already set. Logging in again creates a NEW session.\n   Type "yes" to continue: ');
        if (yes.trim().toLowerCase() !== 'yes') {
            console.log('Cancelled. Nothing changed.');
            return;
        }
    }

    // Telegram delivers the code to the "Telegram" service chat in an existing
    // session. If that chat is archived/muted it arrives silently. `--sms` falls
    // back to a text message, which Telegram only permits after an in-app attempt.
    const forceSMS = process.argv.includes('--sms');
    if (forceSMS) console.log('→ requesting the code by SMS instead of in-app\n');

    const client = new TelegramClient(new StringSession(''), apiId, apiHash!, {
        connectionRetries: 5,
        // Identify as a normal desktop client rather than leaving GramJS defaults.
        deviceModel: 'Raspberry Pi',
        systemVersion: 'Linux',
        appVersion: '1.0.0',
    });

    await client.start({
        forceSMS,
        phoneNumber: () => ask('Phone (+380…): '),
        password: () => ask('2FA password (blank if none): '),
        phoneCode: () => ask(
            forceSMS
                ? 'Code (sent by SMS): '
                : 'Code — check the "Telegram" service chat, incl. Archived (it is NOT an SMS): ',
        ),
        onError: (err) => console.error('✗', err.message),
    });

    const session = (client.session as StringSession).save();
    const me = await client.getMe();
    console.log(`\n✓ Logged in as ${'firstName' in me ? me.firstName : ''} (id ${me.id})`);

    // Write straight into .env so the session string never passes through a clipboard.
    let env = fs.readFileSync(ENV_PATH, 'utf8');
    env = /^TG_SESSION=.*$/m.test(env)
        ? env.replace(/^TG_SESSION=.*$/m, `TG_SESSION=${session}`)
        : `${env.trimEnd()}\nTG_SESSION=${session}\n`;
    fs.writeFileSync(ENV_PATH, env, { mode: 0o600 });
    console.log(`✓ TG_SESSION written to .env (${session.length} chars)`);
    console.log('  Back this up somewhere off the SD card. Losing it means logging in again.');

    await client.disconnect();
}

main()
    .catch((e) => { console.error('✗', e); process.exitCode = 1; })
    .finally(() => rl.close());
