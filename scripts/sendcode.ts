/**
 * Diagnostic: ask Telegram to send a login code and print HOW it says it sent it.
 * Run: npm run sendcode
 *
 * Sends nothing else and does not log in. Rate-limited — do not run repeatedly.
 */
import dotenv from 'dotenv';
import { TelegramClient, Api, errors } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

dotenv.config();

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH!;

const EXPLAIN: Record<string, string> = {
    SentCodeTypeApp: 'in the "Telegram" service chat of an existing session',
    SentCodeTypeSms: 'by SMS',
    SentCodeTypeCall: 'by voice call (a robot reads the digits)',
    SentCodeTypeMissedCall: 'as a MISSED CALL — the code is the last digits of the calling number',
    SentCodeTypeFlashCall: 'as a flash call — read the code from the caller number',
    SentCodeTypeEmailCode: 'to your LOGIN EMAIL, not your phone',
    SentCodeTypeSetUpEmailRequired: 'BLOCKED — Telegram demands you set up a login email in the official app first',
    SentCodeTypeFragmentSms: 'via Fragment (anonymous number) — check fragment.com',
    SentCodeTypeFirebaseSms: 'via Firebase SMS — third-party clients usually cannot receive this',
};

async function main(): Promise<void> {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const phone = (await rl.question('Phone (+380…): ')).trim();
    rl.close();

    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 3,
        deviceModel: 'Raspberry Pi',
        systemVersion: 'Linux',
        appVersion: '1.0.0',
    });
    await client.connect();

    const send = () => client.invoke(new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
    }));

    let res;
    try {
        res = await send();
    } catch (e) {
        const msg = (e as Error).message ?? '';
        const mig = /PHONE_MIGRATE_(\d+)/.exec(msg);
        if (mig) {
            console.log(`→ account lives on DC ${mig[1]}, switching…`);
            await (client as unknown as { _switchDC(dc: number): Promise<void> })._switchDC(Number(mig[1]));
            res = await send();
        } else if (e instanceof errors.FloodWaitError) {
            console.error(`✗ FLOOD_WAIT — Telegram wants you to wait ${e.seconds}s (${Math.ceil(e.seconds / 60)} min).`);
            await client.disconnect();
            return;
        } else {
            throw e;
        }
    }

    console.log('\n--- Telegram\'s answer ---');
    if (res instanceof Api.auth.SentCode) {
        const type = res.type.className.replace(/^auth\./, '');
        console.log(`delivery : ${type}`);
        console.log(`meaning  : code sent ${EXPLAIN[type] ?? '(unknown type)'}`);
        if ('length' in res.type) console.log(`digits   : ${(res.type as { length?: number }).length}`);
        if (res.nextType) console.log(`fallback : ${res.nextType.className} (available after ${res.timeout ?? '?'}s)`);
    } else {
        console.log(res);
    }
    console.log('-------------------------\n');

    await client.disconnect();
}

main().catch((e) => { console.error('✗', e); process.exitCode = 1; });
