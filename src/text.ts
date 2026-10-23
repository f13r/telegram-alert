import { vocabulary, type ThreatKeywords } from './config.js';

const { stripCombining, stripInvisible, latinToCyrillicHomoglyphs } = vocabulary.normalization;

/**
 * Drop stress marks and invisible characters, collapse whitespace. Changes no
 * letters, so it is what LATIN matching runs on: a soft hyphen (U+00AD) inside "Vinnytsia"
 * no longer hides the town.
 */
export function clean(input: string): string {
    // Decompose first: NFC would fuse a grave stress onto и as the single code
    // point ѝ, which no longer contains the mark we strip.
    let s = input.normalize('NFD');
    for (const c of [...stripCombining, ...stripInvisible]) s = s.split(c).join('');
    return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Prepare text for CYRILLIC matching: clean(), then fold latin look-alikes onto
 * Cyrillic (people type "Вiнниця" with a latin i) and lowercase.
 *
 * Latin matching runs on clean() alone — folding would turn "Vinnytsia" into mush.
 */
export function normalize(input: string): string {
    return clean(input)
        .replace(/[A-Za-z]/g, (ch) => latinToCyrillicHomoglyphs[ch] ?? ch)
        .toLowerCase();
}

/**
 * Hangul fillers render as blank but are not whitespace, so `trim()` keeps them.
 * Channels use ㅤ (U+3164) as an "empty" last line.
 */
const FILLERS = /[\u115F\u1160\u3164\uFFA0]/g;

/** Remove a channel's boilerplate promo footer before matching and before display. */
export function stripFooter(text: string, patterns: string[]): string {
    let out = text.replace(FILLERS, '');
    for (const p of patterns) out = out.replace(new RegExp(p, 'gmiu'), '');
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Escape a literal for use inside a RegExp. */
export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "х-101" also matches a non-breaking hyphen, en/em dash or minus sign. */
const anyHyphen = (s: string) => s.replace(/-/g, '[-\u2010-\u2015\u2212]');

/**
 * Word-boundary anchored, never a raw substring: "каб" must not fire on
 * "кабінет", "ппо" must not fire on "ппозиція". Test against normalize()d text.
 */
export const keywordRe = (kw: Pick<ThreatKeywords, 'stems' | 'exact'>): RegExp =>
    new RegExp(
        '(?<!\\p{L})(?:' +
            [...kw.stems.map((s) => escapeRe(s) + '\\p{L}*'), ...kw.exact.map(escapeRe)].map(anyHyphen).join('|') +
            ')(?!\\p{L})',
        'iu',
    );

export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
