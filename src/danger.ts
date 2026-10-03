import { fastThreatKeywords, threatKeywords, type ThreatKeywords } from './config.js';
import { normalize } from './text.js';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/** Missile or КАБ wording — passes a town's cooldown. Applied to every channel. */
export function isFastThreat(text: string): boolean {
    return fastRe.test(normalize(text));
}
