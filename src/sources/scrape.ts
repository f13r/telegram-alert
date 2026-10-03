import { setTimeout as sleep } from 'node:timers/promises';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { channelsConfig, env } from '../config.js';
import type { ChannelCfg } from '../types.js';
import type { IncomingMessage, MessageSource } from '../types.js';
import { markUnavailable, recordOk, recordPost } from '../watchdog.js';

const INTERVAL_SEC = Number(process.env.SCRAPE_INTERVAL_SEC) || 20;
const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

/** Consecutive failures before we stop calling it a blip and diagnose it. */
export const SUSTAINED_FAILURES = 4;

/**
 * Exponential, capped at 30 min. Telegram throttles t.me/s per IP, so backing
 * off hard is what gets a channel back rather than what loses it.
 */
export const backoffMs = (consecutiveFailures: number): number =>
    Math.min(2 ** consecutiveFailures * 60_000, 30 * 60_000);

interface Post {
    id: number;
    text: string;
    date: Date;
}

export interface Emitted extends Post {
    isEdit: boolean;
}

/**
 * Which posts on a freshly fetched page are worth handing to the pipeline, and
 * remember what every post said.
 *
 *  - new (id above `lastId`) → emitted. On the first poll after a start `lastId`
 *    is 0, so only posts within `freshMs` are emitted: a threat posted while the
 *    bot restarted must still alert, but hours-old posts are not worth a log line.
 *    The pipeline's persisted alertedIds stop anything already alerted.
 *  - text changed → emitted as an edit, dated by the ORIGINAL post. Telegram's
 *    preview carries no edit time, and "now" would let an edit to an old post
 *    (Типова appends «ㅤ» to nearly every post) pass the freshness gate.
 */
export function postsToEmit(
    username: string,
    posts: Post[],
    lastId: number,
    seenText: Map<string, string>,
    now: number,
    freshMs: number,
): Emitted[] {
    const out: Emitted[] = [];
    for (const p of posts) {
        const key = `${username}:${p.id}`;
        const before = seenText.get(key);
        seenText.set(key, p.text);

        const isEdit = before !== undefined && before !== p.text;
        const isNew = p.id > lastId && before === undefined;
        if (isEdit || (isNew && (lastId > 0 || now - p.date.getTime() <= freshMs))) {
            out.push({ ...p, isEdit });
        }
    }
    return out;
}

/**
 * Credential-free ingestion: polls the public t.me/s/<channel> preview pages.
 *
 * Poll interval plus Telegram's edge caching put real latency at roughly 15–60s.
 */
export class ScrapeSource implements MessageSource {
    readonly name = 'scrape';
    private stopped = false;
    private timer?: NodeJS.Timeout;
    private lastId = new Map<string, number>();
    private seenText = new Map<string, string>();
    private backoff = new Map<string, number>();
    private failures = new Map<string, number>();
    private lastOkAt = new Map<string, number>();
    private usable: ChannelCfg[] = [];

    async start(onMessage: (m: IncomingMessage) => Promise<void>): Promise<void> {
        this.usable = channelsConfig.channels.filter((c) => c.webPreview !== false);
        for (const c of channelsConfig.channels) {
            if (c.webPreview === false) {
                console.warn(`[scrape] @${c.username} has no public t.me/s page — skipped`);
            }
        }
        // No silent baseline pass: the first poll alerts on posts that are still
        // fresh, so a threat posted during a restart is not lost (see postsToEmit).
        await this.pollAll(onMessage);
        console.log(`[scrape] polling every ${INTERVAL_SEC}s`);
        this.schedule(onMessage);
    }

    private async pollAll(onMessage: (m: IncomingMessage) => Promise<void>): Promise<void> {
        for (const c of this.usable) {
            if (this.stopped) return;
            try {
                await this.poll(c.username, c.label, onMessage);
            } catch (e) {
                // Never let one bad post kill the poll loop — the timer would not re-arm.
                console.error(`[scrape] @${c.username} poll:`, (e as Error).message);
            }
            // Stagger so we never fire four requests at the same instant.
            await sleep(400 + Math.random() * 400);
        }
    }

    private schedule(onMessage: (m: IncomingMessage) => Promise<void>): void {
        // Jitter so we never settle into a perfectly regular request pattern.
        this.timer = setTimeout(async () => {
            await this.pollAll(onMessage);
            if (!this.stopped) this.schedule(onMessage);
        }, INTERVAL_SEC * 1000 * (0.85 + Math.random() * 0.3));
    }

    private async poll(
        username: string,
        label: string,
        onMessage: (m: IncomingMessage) => Promise<void>,
    ): Promise<void> {
        const until = this.backoff.get(username) ?? 0;
        if (Date.now() < until) return;

        let posts: Post[];
        try {
            const { data } = await axios.get<string>(`https://t.me/s/${username}`, {
                timeout: 12_000,
                headers: { 'User-Agent': UA, 'Accept-Language': 'uk,en;q=0.8' },
                // A 302 to /<channel> means the preview was switched off. Following
                // it would yield a post-less page and look like a parser bug.
                maxRedirects: 0,
                validateStatus: (s) => s === 200,
            });
            posts = parse(data, username);
            this.backoff.delete(username);
            this.failures.delete(username);
            this.lastOkAt.set(username, Date.now());
            // Only a page we actually parsed counts as healthy — a 200 with
            // unrecognised markup is exactly the failure we are watching for.
            if (posts.length) recordOk(username);
        } catch (e) {
            const response = (e as { response?: { status?: number; headers?: Record<string, unknown> } }).response;
            const status = response?.status;
            const n = (this.failures.get(username) ?? 0) + 1;
            this.failures.set(username, n);

            // A 302 is usually transient, not a channel that went away — it
            // recovers on its own (cause unknown, see diagnose302). Back off exponentially and keep
            // retrying forever; never drop a channel over a transient answer.
            const wait = backoffMs(n);
            this.backoff.set(username, Date.now() + wait);
            console.error(
                `[scrape] @${username} ${status ?? (e as Error).message} ` +
                    `(fail ${n}) — retrying in ${Math.round(wait / 60_000)}m`,
            );
            // Diagnostics make extra requests; never let them hold up the other channels.
            // The cause of these 302s is still unknown — record what Telegram said.
            if (status === 302) {
                const lastId = this.lastId.get(username) ?? 0;
                void diagnose302(username, response?.headers ?? {}, this.lastOkAt.get(username), lastId).then(console.error);
            }

            // Only after a sustained outage is it worth naming a cause.
            if (n === SUSTAINED_FAILURES) {
                void classifyUnavailable(username).then((r) => markUnavailable(username, r));
            }
            return;
        }

        const prev = this.lastId.get(username) ?? 0;
        const maxId = Math.max(prev, ...posts.map((p) => p.id));

        for (const p of postsToEmit(username, posts, prev, this.seenText, Date.now(), env.freshnessMin * 60_000)) {
            try {
                await onMessage({
                    channelUsername: username,
                    channelTitle: label,
                    messageId: p.id,
                    text: p.text,
                    date: p.date,
                    isEdit: p.isEdit,
                });
            } catch (e) {
                console.error(`[scrape] @${username}/${p.id} handler:`, (e as Error).message);
            }
        }

        if (maxId > prev) recordPost(username);
        this.lastId.set(username, maxId);
        if (this.seenText.size > 400) {
            for (const k of [...this.seenText.keys()].slice(0, 200)) this.seenText.delete(k);
        }
    }

    activeChannels(): string[] {
        return this.usable.map((c) => c.username);
    }

    async stop(): Promise<void> {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
    }
}

const DIAG_HEADERS = ['location', 'retry-after', 'cache-control', 'content-type', 'server', 'x-frame-options'];

const ago = (ms: number) => `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s ago`;

/**
 * One log line describing a 302 from t.me/s: where it pointed, the headers that
 * could explain it, how long since the channel last answered, and whether the
 * history page (?before=) still answers — a possible fallback if it does.
 */
export async function diagnose302(
    username: string,
    headers: Record<string, unknown>,
    lastOkAt: number | undefined,
    lastId: number,
    base = 'https://t.me',
): Promise<string> {
    const hdr = DIAG_HEADERS.filter((h) => headers[h] !== undefined)
        .map((h) => `${h}=${String(headers[h])}`)
        .join(' ');
    let before = 'before=skipped';
    if (lastId > 0) {
        const id = lastId + 100;
        try {
            const r = await axios.get<string>(`${base}/s/${username}?before=${id}`, {
                timeout: 10_000,
                headers: { 'User-Agent': UA, 'Accept-Language': 'uk,en;q=0.8' },
                maxRedirects: 0,
                validateStatus: () => true,
            });
            before = `before=${id} → ${r.status}${r.headers.location ? ` location=${r.headers.location}` : ''}`;
        } catch (e) {
            before = `before=${id} → ${(e as Error).message}`;
        }
    }
    const ok = lastOkAt === undefined ? 'lastOk=never' : `lastOk=${ago(Date.now() - lastOkAt)}`;
    return `[scrape:302] @${username} ${hdr || 'no-headers'} ${ok} ${before}`;
}

/**
 * A 302 from t.me/s has two very different causes. The single-post embed
 * endpoint says which: Telegram returns an explicit error when the username
 * does not resolve at all (renamed channel, or it went private), as opposed to
 * a channel that merely stopped publishing a web preview.
 */
export async function classifyUnavailable(username: string): Promise<string> {
    try {
        const { data } = await axios.get<string>(`https://t.me/${username}/1?embed=1&mode=tme`, {
            timeout: 10_000,
            headers: { 'User-Agent': UA },
        });
        // The error element contains markup (<b>@name</b>), so read to the
        // closing tag and strip, rather than stopping at the first '<'.
        const raw = /tgme_widget_message_error[^>]*>([\s\S]{0,300}?)<\/div>/.exec(data)?.[1] ?? '';
        const err = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (/not found/i.test(err)) {
            return (
                'юзернейм не існує — канал перейменовано або став приватним.\n' +
                'Відкрийте канал у Telegram → назва каналу → перевірте посилання t.me/…'
            );
        }
        if (err) return err.trim();
    } catch {
        /* fall through to the generic reason */
    }
    return 'вебпревʼю вимкнено (t.me/s віддає 302)';
}

export function parse(html: string, username: string): Post[] {
    const $ = cheerio.load(html);
    const out: Post[] = [];

    $('.tgme_widget_message').each((_, el) => {
        const post = $(el).attr('data-post');
        const id = Number(post?.split('/')[1]);
        if (!Number.isFinite(id)) return;

        const node = $(el).find('.tgme_widget_message_text').first();
        if (!node.length) return;
        // <br> carries real meaning in these posts; .text() would lose the lines.
        const text = cheerio
            .load(node.html()?.replace(/<br\s*\/?>/gi, '\n') ?? '')
            .text()
            .trim();
        if (!text) return;

        const dt = $(el).find('time[datetime]').last().attr('datetime');
        out.push({ id, text, date: dt ? new Date(dt) : new Date() });
    });

    if (!out.length) console.warn(`[scrape] @${username}: no posts parsed — markup may have changed`);
    return out.sort((a, b) => a.id - b.id);
}
