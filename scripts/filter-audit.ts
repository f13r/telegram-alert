/**
 * Audit the news filter on the local channels (rejectNews in config/channels.json).
 * Driven by the /filter-alerts skill.
 *
 *   npm run filter-audit -- recent [hours]   every post of the last N hours (default 48)
 *                                            re-judged with the CURRENT config
 *   npm run filter-audit -- try [word ...]   which town posts in ~2 months of history
 *                                            a candidate news word would drop; no
 *                                            words = what the current list drops
 *
 * `recent` reads the shadow log (kept 7 days). `try` also reads a t.me/s history
 * cache, data/history-<channel>.ndjson, topped up on every run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { channelsConfig, env, newsKeywords } from '../src/config.js';
import { isNews, isThreatReport } from '../src/danger.js';
import { scanTowns } from '../src/matcher.js';
import { fetchPreview, parse } from '../src/sources/scrape.js';
import { keywordRe, normalize, stripFooter } from '../src/text.js';
import type { ChannelCfg } from '../src/types.js';

const HISTORY_DAYS = 60;
const local = channelsConfig.channels.filter((c) => c.rejectNews);

interface Post {
    channel: string;
    id: number;
    date: string;
    text: string;
}

type Verdict = 'no-town' | 'not-danger' | 'news' | 'counted';

/** What the pipeline would do with this post today, before the window. */
function judge(cfg: ChannelCfg, raw: string): { text: string; verdict: Verdict; towns: string[] } {
    const text = stripFooter(raw, cfg.stripFooterPatterns);
    const towns = [...new Set(scanTowns(text, { local: cfg.localDistricts }).matches.map((m) => m.townId))];
    const verdict: Verdict = !towns.length
        ? 'no-town'
        : cfg.requiresThreat && !isThreatReport(text)
          ? 'not-danger'
          : isNews(text)
            ? 'news'
            : 'counted';
    return { text, verdict, towns };
}

/** Shadow-log posts of the local channels; an edit replaces the earlier text. */
function shadowPosts(sinceMs: number): Post[] {
    const byKey = new Map<string, Post>();
    const files = fs.readdirSync(env.dataDir).filter((f) => /^shadow-\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).sort();
    for (const f of files) {
        for (const line of fs.readFileSync(path.join(env.dataDir, f), 'utf8').split('\n')) {
            if (!line) continue;
            const e = JSON.parse(line);
            if (!local.some((c) => c.username === e.channel) || Date.parse(e.ts) < sinceMs) continue;
            byKey.set(`${e.channel}:${e.messageId}`, { channel: e.channel, id: e.messageId, date: e.ts, text: e.text });
        }
    }
    return [...byKey.values()];
}

const historyFile = (u: string) => path.join(env.dataDir, `history-${u}.ndjson`);

/** Page back through t.me/s until the cache is reached (first run: HISTORY_DAYS). */
async function topUpHistory(username: string): Promise<Post[]> {
    const file = historyFile(username);
    const cached: Post[] = fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
    const known = new Set(cached.map((p) => p.id));
    const stopAt = Date.now() - HISTORY_DAYS * 86_400_000;
    const fresh: Post[] = [];
    let before: number | undefined;
    for (;;) {
        const page = parse(await fetchPreview(username, before), username);
        if (!page.length) break;
        const added = page.filter((p) => !known.has(p.id));
        for (const p of added) fresh.push({ channel: username, id: p.id, date: p.date.toISOString(), text: p.text });
        if (added.length < page.length || page[0].date.getTime() < stopAt || page[0].id <= 1) break;
        before = page[0].id;
        await new Promise((r) => setTimeout(r, 1500));
    }
    const all = [...cached, ...fresh].filter((p) => Date.parse(p.date) >= stopAt).sort((a, b) => a.id - b.id);
    fs.writeFileSync(file, all.map((p) => JSON.stringify(p)).join('\n') + '\n');
    return all;
}

const line = (p: Post, text: string, towns: string[]) =>
    `  @${p.channel} #${p.id} ${p.date.slice(0, 16)} [${towns.join(',')}] ${text.replace(/\s+/g, ' ').slice(0, 220)}`;

function recent(hours: number): void {
    const posts = shadowPosts(Date.now() - hours * 3_600_000).sort((a, b) => a.date.localeCompare(b.date));
    const groups: Record<'counted' | 'news', string[]> = { counted: [], news: [] };
    for (const p of posts) {
        const cfg = local.find((c) => c.username === p.channel)!;
        const { text, verdict, towns } = judge(cfg, p.text);
        if (verdict === 'counted' || verdict === 'news') groups[verdict].push(line(p, text, towns));
    }
    console.log(`last ${hours}h, ${posts.length} posts from ${local.map((c) => '@' + c.username).join(' ')}\n`);
    console.log(`COUNTED — goes into the town's window (alerts or confirms). Any news here slips through:`);
    console.log(groups.counted.join('\n') || '  (none)');
    console.log(`\nDROPPED AS NEWS — any live threat here is lost:`);
    console.log(groups.news.join('\n') || '  (none)');
}

async function tryWords(words: string[]): Promise<void> {
    const posts: Post[] = [];
    for (const c of local) posts.push(...(await topUpHistory(c.username)));
    const seen = new Set(posts.map((p) => `${p.channel}:${p.id}`));
    for (const p of shadowPosts(0)) if (!seen.has(`${p.channel}:${p.id}`)) posts.push(p);

    // A multi-word entry is a phrase prefix, as in news-keywords.json.
    const re = words.length ? keywordRe({ stems: words, exact: [] }) : null;
    const hits: string[] = [];
    let considered = 0;
    for (const p of posts) {
        const cfg = local.find((c) => c.username === p.channel)!;
        const { text, verdict, towns } = judge(cfg, p.text);
        if (verdict === 'no-town' || verdict === 'not-danger') continue;
        considered++;
        const dropped = re ? re.test(normalize(text)) : verdict === 'news';
        if (dropped) hits.push(`${re && verdict === 'news' ? '(already news) ' : ''}${line(p, text, towns)}`);
    }
    const what = words.length ? `«${words.join('», «')}»` : `the current list (${newsKeywords.stems.length + newsKeywords.exact.length} words)`;
    console.log(`${considered} town posts that pass the other filters, ${HISTORY_DAYS} days.`);
    console.log(`Dropped by ${what}: ${hits.length}. Every one must be news — a live threat here means the word is unsafe.\n`);
    console.log(hits.join('\n') || '  (none)');
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'recent') recent(Number(rest[0]) || 48);
else if (cmd === 'try') await tryWords(rest);
else {
    console.error('usage: filter-audit recent [hours] | try [word ...]');
    process.exit(2);
}
