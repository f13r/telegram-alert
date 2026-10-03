/**
 * Does the t.me/s scraper still parse the live pages? Run: npm run scrapecheck
 *
 * Silent markup drift is this source's main failure mode, so check it after any
 * unexplained quiet period.
 */
import axios from 'axios';
import { channelsConfig, townById } from '../src/config.js';
import { matchTowns } from '../src/matcher.js';
import { classifyUnavailable, parse } from '../src/sources/scrape.js';

const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

async function main(): Promise<void> {
    for (const c of channelsConfig.channels) {
        try {
            const { data } = await axios.get<string>(`https://t.me/s/${c.username}`, {
                timeout: 15_000,
                headers: { 'User-Agent': UA, 'Accept-Language': 'uk,en;q=0.8' },
                maxRedirects: 0,
                validateStatus: (s) => s === 200,
            });
            const posts = parse(data, c.username);
            const newest = posts.at(-1);
            const ageMin = newest ? Math.round((Date.now() - newest.date.getTime()) / 60_000) : NaN;
            const counts = new Map<string, number>();
            for (const p of posts) for (const m of matchTowns(p.text)) counts.set(m.townId, (counts.get(m.townId) ?? 0) + 1);
            const hits = [...counts].map(([id, n]) => `${townById.get(id)!.name} ${n}`).join(' · ') || '0 збігів';
            console.log(
                `${posts.length ? '✓' : '✗'} @${c.username.padEnd(20)} ` +
                    `${String(posts.length).padStart(2)} posts · newest #${newest?.id ?? '—'} ` +
                    `${ageMin}m ago · ${hits}`,
            );
            if (newest) console.log(`    "${newest.text.split('\n')[0].slice(0, 66)}"`);
        } catch (e) {
            const status = (e as { response?: { status?: number } }).response?.status;
            if (status === 302 || status === 301) {
                console.log(`✗ @${c.username.padEnd(20)} ${(await classifyUnavailable(c.username)).split('\n')[0]}`);
            } else {
                console.log(`✗ @${c.username.padEnd(20)} FAILED ${status ?? (e as Error).message}`);
            }
        }
    }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
