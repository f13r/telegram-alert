import { towns, vocabulary, type TownTarget } from './config.js';
import { clean, escapeRe, keywordRe, normalize } from './text.js';
import type { TownMatch } from './types.js';

interface Compiled {
    id: string;
    re: RegExp;
    matchOn: 'normalized' | 'raw';
    district?: boolean;
}

function compile(t: TownTarget): Compiled {
    if (t.matchOn === 'raw' && t.literals?.length) {
        // Latin cannot use the suffix-length trick: English writes the bare city
        // name in "Vinnytsia Oblast". A negative lookahead excludes those instead.
        const alt = t.literals.map(escapeRe).join('|');
        const tail = t.negativeLookahead ? `(?!${t.negativeLookahead})` : '';
        return { id: t.id, re: new RegExp(`(?<!\\p{L})(?:${alt})(?!\\p{L})${tail}`, 'giu'), matchOn: t.matchOn };
    }
    if (!t.regex) throw new Error(`town target ${t.id} has neither regex nor literals`);
    return { id: t.id, re: new RegExp(t.regex, 'giu'), matchOn: t.matchOn };
}

/** Ends with a landmark phrase: «східніше », «на північ від м. ». Tested on the text before a hit. */
const landmarkRe = new RegExp(
    `(?<!\\p{L})(?:${vocabulary.referencePoint.patterns.join('|')})\\s+(?:(?:м|г)\\.\\s*|міста\\s+|города\\s+)?$`,
    'iu',
);
const LANDMARK_LOOKBEHIND = 60;

const compiled = towns.map((t) => ({
    townId: t.id,
    targets: t.targets.map(compile),
    districts: t.districts && {
        requires: keywordRe(t.districts.requires),
        targets: t.districts.targets.map((d) => ({
            id: d.id,
            re: new RegExp(d.regex, 'giu'),
            matchOn: 'normalized' as const,
            district: true,
        })),
    },
}));

export interface ScanOptions {
    /** Also match city districts — set for channels with localDistricts. */
    local?: boolean;
}

export interface TownScan {
    /** Towns the text names as a place in its own right, in catalogue order. */
    matches: TownMatch[];
    /** Towns named only as a landmark («східніше Вінниці») — never alerted. */
    landmarkOnly: string[];
}

/** Every town this text names, split into real mentions and landmark-only ones. */
export function scanTowns(raw: string, { local = false }: ScanOptions = {}): TownScan {
    const norm = normalize(raw);
    const latin = clean(raw);
    const matches: TownMatch[] = [];
    const landmarkOnly: string[] = [];
    for (const town of compiled) {
        let match: TownMatch | undefined;
        let landmark = false;
        // Districts come after the town's own targets, so a post naming both reports the town.
        const districts = local && town.districts?.requires.test(norm) ? town.districts.targets : [];
        for (const c of [...town.targets, ...districts]) {
            const text = c.matchOn === 'raw' ? latin : norm;
            for (const hit of text.matchAll(c.re)) {
                if (landmarkRe.test(text.slice(Math.max(0, hit.index - LANDMARK_LOOKBEHIND), hit.index))) {
                    landmark = true;
                    continue;
                }
                match = { townId: town.townId, form: hit[0], targetId: c.id, ...(c.district ? { district: true } : {}) };
                break;
            }
            if (match) break;
        }
        if (match) matches.push(match);
        else if (landmark) landmarkOnly.push(town.townId);
    }
    return { matches, landmarkOnly };
}

/** Every town this text names, in catalogue order, with the exact form that matched. */
export function matchTowns(raw: string, opts: ScanOptions = {}): TownMatch[] {
    return scanTowns(raw, opts).matches;
}
