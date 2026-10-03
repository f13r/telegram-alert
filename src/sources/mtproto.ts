import { TelegramClient, utils } from 'telegram';
import type { Entity } from 'telegram/define.js';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { EditedMessage } from 'telegram/events/EditedMessage.js';
import { channelByUsername, env } from '../config.js';
import type { IncomingMessage, MessageSource } from '../types.js';
import { recordOk, recordPost } from '../watchdog.js';

/** How often a live connection marks every channel readable for the watchdog. */
const HEALTH_EVERY_MS = 5 * 60_000;

/**
 * The key events are looked up by. GramJS marks channel ids on `message.chatId`
 * (-100<id>), while `entity.id` is the raw id — they never matched, so every
 * post was ignored.
 */
export const channelKey = (entity: Entity): string => utils.getPeerId(entity);

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
    private health?: NodeJS.Timeout;

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
            const e = d.entity as { username?: string; title?: string } | undefined;
            if (d.entity && e?.username && channelByUsername.has(e.username.toLowerCase())) {
                map.set(channelKey(d.entity), { username: e.username, title: e.title ?? e.username });
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

        // Updates are pushed, so a quiet night produces no posts — readability has to
        // come from the connection itself, or the watchdog reports every channel
        // unreadable after an hour of silence.
        const markReadable = (): void => {
            if (client.connected) for (const u of this.found) recordOk(u);
        };
        this.health = setInterval(markReadable, HEALTH_EVERY_MS);
    }

    activeChannels(): string[] {
        return this.found;
    }

    async stop(): Promise<void> {
        if (this.health) clearInterval(this.health);
        await this.client?.disconnect();
    }
}
