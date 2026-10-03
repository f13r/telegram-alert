import { vocabulary } from './config.js';

const { stripCombining, stripInvisible, latinToCyrillicHomoglyphs } = vocabulary.normalization;

/**
 * Prepare text for CYRILLIC matching: drop stress marks and invisible characters,
 * fold latin look-alikes onto Cyrillic (people type "Вiнниця" with a latin i),
 * collapse whitespace, lowercase.
 *
 * Latin matching deliberately runs on the RAW text — folding here would turn
 * "Vinnytsia" into mush.
 */
export function normalize(input: string): string {
    // Decompose first: NFC would fuse a grave stress onto и as the single code
    // point ѝ, which no longer contains the mark we strip.
    let s = input.normalize('NFD');
    for (const c of [...stripCombining, ...stripInvisible]) s = s.split(c).join('');
    s = s.normalize('NFC');
    s = s.replace(/[A-Za-z]/g, (ch) => latinToCyrillicHomoglyphs[ch] ?? ch);
    return s.replace(/\s+/g, ' ').trim().toLowerCase();
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

export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
