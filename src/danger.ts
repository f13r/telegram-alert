import { fastThreatKeywords, newsKeywords, threatKeywords } from './config.js';
import { scanTowns, type ScanOptions } from './matcher.js';
import { keywordRe, normalize } from './text.js';

const dangerRe = keywordRe(threatKeywords);
const fastRe = keywordRe(fastThreatKeywords);
const newsRe = keywordRe(newsKeywords);

/**
 * Reporting on an attack that is already over — «внаслідок удару… постраждали»,
 * «Вночі ворог вдарив… по «Епіцентру»». Applied ONLY to channels with rejectNews.
 */
export function isNews(text: string): boolean {
    return newsRe.test(normalize(text));
}

/** Applied ONLY to channels with requiresThreat — see config/channels.json. */
export function isDanger(text: string): boolean {
    return dangerRe.test(normalize(text));
}

/** Real threat posts on a mixed channel are one short line; news runs longer. */
const MAX_REPORT_CHARS = 200;

/**
 * A mixed channel's post counts as a threat report only if it is short, one
 * paragraph AND has a danger keyword. Keywords alone are not enough: a Типова
 * article on how hospitals work «під час повітряних тривог… ударних дронів…
 * ракетної атаки» has five of them (2026-10-02), and would otherwise count as
 * corroboration in the town's window.
 */
export function isThreatReport(text: string): boolean {
    const t = text.trim();
    return t.length <= MAX_REPORT_CHARS && !/\n\s*\n/.test(t) && isDanger(t);
}

/**
 * An explosion report with no flight wording — «Вінниця Вибух 💥». The blast already
 * happened, so it says nothing about a drone still inbound and must not corroborate
 * a later threat post in the town's window (2026-10-31: ППО «Вибух» + Типова
 * «БпЛА на Вінницю» went loud after the drone had moved on to Козятин).
 */
const explosionSrc = '(?<![\\p{L}\\p{N}])(?:вибух|взрыв)\\p{L}*';
const explosionRe = new RegExp(explosionSrc, 'u');
export function isExplosionOnly(text: string): boolean {
    const t = normalize(text);
    return explosionRe.test(t) && !dangerRe.test(t.replace(new RegExp(explosionSrc, 'gu'), ' '));
}

/**
 * A «збитий / знищено» report with no flight wording — «Попередньо збитий, у передмісті
 * Вінниці». The threat is over, so it must not raise a loud alert (2026-11-06).
 */
const shotSrc = '(?<![\\p{L}\\p{N}])(?:збит|сбит|знищен|уражен)\\p{L}*';
const shotRe = new RegExp(shotSrc, 'u');
export function isShotDownOnly(text: string): boolean {
    const t = normalize(text);
    return shotRe.test(t) && !dangerRe.test(t.replace(new RegExp(shotSrc, 'gu'), ' '));
}

/** Missile or КАБ wording — passes a town's cooldown. Applied to every channel. */
export function isFastThreat(text: string): boolean {
    return fastRe.test(normalize(text));
}

/**
 * A line opening a region section in a digest post: «Сумщина:», «Вінниччина:»,
 * «Запорізька область:». ukraine_pyxx lists several oblasts in one post.
 */
const REGION_HEADER = /^[^\p{L}\n]*\p{Lu}[\p{L}ʼ'’-]*(?:щина|ччина|\s+область)\s*:/gmu;

/**
 * The towns, out of `towns`, that this post threatens with a missile or КАБ.
 * Judged per region section — «Харківщина: ракети… Вінниччина: БпЛА на Ладижин»
 * is a drone for Ладижин and must not break its cooldown. Text before the first
 * header (a general «Ракетна небезпека!») applies to every section. A post without
 * headers is one section.
 */
export function fastTowns(text: string, towns: string[], opts: ScanOptions = {}): string[] {
    const starts = [...text.matchAll(REGION_HEADER)].map((m) => m.index);
    if (starts.length === 0) return isFastThreat(text) ? [...towns] : [];

    const preambleFast = isFastThreat(text.slice(0, starts[0]));
    const sections = starts.map((s, i) => text.slice(s, starts[i + 1]));
    return towns.filter(
        (t) =>
            preambleFast ||
            sections.some((sec) => isFastThreat(sec) && scanTowns(sec, opts).matches.some((m) => m.townId === t)),
    );
}
