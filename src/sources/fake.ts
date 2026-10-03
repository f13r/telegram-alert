import fs from 'node:fs';
import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import { channelsConfig } from '../config.js';
import type { IncomingMessage, MessageSource } from '../types.js';

/**
 * Testing source. Two modes:
 *
 *   SCENARIO=config/scenario.json  replay a scripted raid with relative delays
 *   (otherwise)                    interactive: type  @channel | text
 *
 * Lets the whole pipeline be exercised without any Telegram credentials.
 */
export class FakeSource implements MessageSource {
    readonly name = 'fake';
    private rl?: readline.Interface;
    private stopped = false;
    private nextId = 1000;

    async start(onMessage: (m: IncomingMessage) => Promise<void>): Promise<void> {
        const scenarioPath = process.env.SCENARIO;
        if (scenarioPath) return this.replay(scenarioPath, onMessage);

        console.log('[fake] interactive. Type:  @kpszsu | Вінниця: реактивний БпЛА з півдня');
        console.log('[fake] channels:', channelsConfig.channels.map((c) => '@' + c.username).join(' '));
        this.rl = readline.createInterface({ input: stdin, output: stdout, prompt: '> ' });
        this.rl.prompt();
        this.rl.on('line', async (line) => {
            const m = /^\s*@?(\S+)\s*\|\s*(.+)$/.exec(line);
            if (m) await onMessage(this.make(m[1], m[2]));
            else if (line.trim()) console.log('   format:  @channel | text');
            this.rl?.prompt();
        });
    }

    private async replay(path: string, onMessage: (m: IncomingMessage) => Promise<void>): Promise<void> {
        const steps = JSON.parse(fs.readFileSync(path, 'utf8')) as Array<{
            afterSec: number;
            channel: string;
            text: string;
        }>;
        for (const s of steps) {
            if (this.stopped) return;
            if (s.afterSec) await new Promise((r) => setTimeout(r, s.afterSec * 1000));
            console.log(`\n[fake] +${s.afterSec}s  @${s.channel}: ${s.text}`);
            await onMessage(this.make(s.channel, s.text));
        }
        console.log('\n[fake] scenario finished');
        process.exit(0);
    }

    private make(channel: string, text: string): IncomingMessage {
        const cfg = channelsConfig.channels.find((c) => c.username === channel);
        return {
            channelUsername: channel,
            channelTitle: cfg?.label ?? channel,
            messageId: this.nextId++,
            text,
            date: new Date(),
            isEdit: false,
        };
    }

    async stop(): Promise<void> {
        this.stopped = true;
        this.rl?.close();
    }
}
