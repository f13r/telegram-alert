import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import type { ChannelsConfig } from './types.js';

dotenv.config();

function readJson<T>(rel: string): T {
    return JSON.parse(fs.readFileSync(path.resolve(rel), 'utf8')) as T;
}

function num(name: string, fallback: number): number {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const env = {
    botToken: process.env.BOT_TOKEN ?? '',
    joinSecret: process.env.JOIN_SECRET ?? '',
    dataDir: process.env.DATA_DIR ?? './data',
    /** Minutes after a loud alert during which that town sends nothing (missiles excepted). */
    cooldownMin: num('COOLDOWN_MIN', 15),
    freshnessMin: num('FRESHNESS_MIN', 10),
    shadowRetentionDays: num('SHADOW_RETENTION_DAYS', 7),
    /** scrape (t.me/s preview pages) | fake (replays fixtures, for testing) */
    source: process.env.SOURCE ?? 'scrape',
};

export interface Vocabulary {
    normalization: {
        stripCombining: string[];
        stripInvisible: string[];
        latinToCyrillicHomoglyphs: Record<string, string>;
    };
    /** Phrases that name a town only as a landmark — «східніше Вінниці». */
    referencePoint: { patterns: string[] };
}

export interface TownTarget {
    id: string;
    script: 'cyrillic' | 'latin';
    matchOn: 'normalized' | 'raw';
    regex?: string;
    literals?: string[];
    negativeLookahead?: string;
}

/** One file in config/towns/. Subscribers toggle towns by `id`. */
export interface TownCfg {
    id: string;
    /** Display name, e.g. "Ладижин" — buttons and replies. */
    name: string;
    /** Alert header, e.g. "ЛАДИЖИН". */
    header: string;
    /** Button and header order. */
    order: number;
    targets: TownTarget[];
    fixtures: { shouldMatch: string[]; shouldNotMatch: string[] };
}

export interface ThreatKeywords {
    stems: string[];
    exact: string[];
    fixtures: { danger: string[]; notDanger: string[] };
}

export const vocabulary = readJson<Vocabulary>('config/vocabulary.json');
export const threatKeywords = readJson<ThreatKeywords>('config/threat-keywords.json');
/** Missiles and КАБ — minutes to impact, so they pass a cooldown. */
export const fastThreatKeywords = readJson<ThreatKeywords>('config/threat-fast.json');
export const channelsConfig = readJson<ChannelsConfig>('config/channels.json');

function loadTowns(dir: string): TownCfg[] {
    const list = fs
        .readdirSync(path.resolve(dir))
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson<TownCfg>(path.join(dir, f)));
    if (list.length === 0) throw new Error(`no towns in ${dir}`);
    const seen = new Set<string>();
    for (const t of list) {
        if (!Number.isFinite(t.order)) throw new Error(`town ${t.id} has no "order"`);
        if (seen.has(t.id)) throw new Error(`duplicate town id ${t.id}`);
        seen.add(t.id);
    }
    return list.sort((a, b) => a.order - b.order);
}

export const towns = loadTowns('config/towns');
export const townById = new Map(towns.map((t) => [t.id, t]));

export const channelByUsername = new Map(
    channelsConfig.channels.map((c) => [c.username.toLowerCase(), c]),
);
