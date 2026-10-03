import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { EditedMessage } from 'telegram/events/EditedMessage.js';
import { channelByUsername, env } from '../config.js';
import type { IncomingMessage, MessageSource } from '../types.js';
import { recordPost } from '../watchdog.js';

/**
 * Primary ingestion. The account is READ ONLY: it connects, calls getDialogs
 * exactly once to learn the numeric ids of the configured channels, and then
 * only listens. No joins, no polling, no sends.
 *
 * You must already be subscribed to each channel in your own Telegram app.
 */
export class MtprotoSource implements MessageSource {
    readonly name = 'mtproto';
    private client?: TelegramClient;
    private found: string[] = [];

    async start(onMessage: (m: IncomingMessage) => Promise<void>): Promise<void> {
        const client = new TelegramClient(new StringSession(env.session), env.apiId, env.apiHash, {
            connectionRetries: Number.MAX_SAFE_INTEGER, // home internet flaps; never give up
            retryDelay: 2000,
            autoReconnect: true,
            floodSleepThreshold: 120,
            deviceModel: 'Raspberry Pi',
            systemVersion: 'Linux',
            appVersion: '1.0.0',
        });
        this.client = client;
        await client.connect();

        // One outbound call, at boot. Everything after this is passive.
        const map = new Map<string, { username: string; title: string }>();
        for (const d of await client.getDialogs({ limit: 500 })) {
            const e = d.entity as { username?: string; id?: unknown; title?: string } | undefined;
            if (e?.username && channelByUsername.has(e.username.toLowerCase())) {
                map.set(String(e.id), { username: e.username, title: e.title ?? e.username });
            }
        }

        for (const c of channelByUsername.values()) {
            const found = [...map.values()].some((v) => v.username.toLowerCase() === c.username.toLowerCase());
            if (!found) console.warn(`[mtproto] ⚠ not subscribed to @${c.username} — its posts will not be seen`);
        }
        this.found = [...map.values()].map((v) => v.username);
        console.log(`[mtproto] listening on ${map.size}/${channelByUsername.size} channels`);

        const handler = async (event: { message: Record<string, unknown> }): Promise<void> => {
            try {
                const msg = event.message as {
                    chatId?: unknown; id: number; message?: string;
                    date: number; editDate?: number;
                };
                const info = map.get(String(msg.chatId ?? ''));
                if (!info) return;
                // GramJS puts a photo/video caption in `.message` too, so captions
                // are covered without special handling.
                const text = msg.message ?? '';
                if (!text.trim()) return;

                recordPost(info.username);
                await onMessage({
                    channelUsername: info.username,
                    channelTitle: info.title,
                    messageId: msg.id,
                    text,
                    // For an edit, freshness must be judged by the EDIT time.
                    date: new Date((msg.editDate ?? msg.date) * 1000),
                    isEdit: Boolean(msg.editDate),
                });
            } catch (e) {
                console.error('[mtproto] handler:', (e as Error).message);
            }
        };

        client.addEventHandler(handler, new NewMessage({}));
        client.addEventHandler(handler, new EditedMessage({}));
    }

    activeChannels(): string[] {
        return this.found;
    }

    async stop(): Promise<void> {
        await this.client?.disconnect();
    }
}
