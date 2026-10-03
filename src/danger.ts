import { fastThreatKeywords, threatKeywords, type ThreatKeywords } from './config.js';
import { scanTowns } from './matcher.js';
import { escapeRe, normalize } from './text.js';

/** "х-101" also matches a non-breaking hyphen, en/em dash or minus sign. */
const anyHyphen = (s: string) => s.replace(/-/g, '[-\u2010-\u2015\u2212]');

/**
 * Word-boundary anchored, never a raw substring: "каб" must not fire on
 * "кабінет", "ппо" must not fire on "ппозиція".
 */
const keywordRe = (kw: ThreatKeywords) =>
    new RegExp(
        '(?<!\\p{L})(?:' +
            [...kw.stems.map((s) => escapeRe(s) + '\\p{L}*'), ...kw.exact.map(escapeRe)].map(anyHyphen).join('|') +
            ')(?!\\p{L})',
        'iu',
    );

const dangerRe = keywordRe(threatKeywords);
const fastRe = keywordRe(fastThreatKeywords);

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
export function fastTowns(text: string, towns: string[]): string[] {
    const starts = [...text.matchAll(REGION_HEADER)].map((m) => m.index);
    if (starts.length === 0) return isFastThreat(text) ? [...towns] : [];

    const preambleFast = isFastThreat(text.slice(0, starts[0]));
    const sections = starts.map((s, i) => text.slice(s, starts[i + 1]));
    return towns.filter(
        (t) =>
            preambleFast ||
            sections.some((sec) => isFastThreat(sec) && scanTowns(sec).matches.some((m) => m.townId === t)),
    );
}
