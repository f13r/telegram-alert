import fs from 'node:fs';
import path from 'node:path';
import { channelsConfig, env, towns } from './config.js';
import type { StorageData, Subscriber, Track, TrackState, WindowState } from './types.js';

const FILE = path.join(env.dataDir, 'data.json');
const ALERTED_TTL_MS = 24 * 60 * 60 * 1000;

const EMPTY_WINDOW: WindowState = { loudAt: null, sources: {}, fastSources: {} };
const DEFAULT: StorageData = { subscribers: [], windows: {}, alertedIds: {}, beta: { windows: {}, alertedIds: {} } };

/** Before cooldowns: a sliding window that announced at most once per raid. */
interface LegacyWindow {
    lastMatchAt: number | null;
    sources: Record<string, number>;
    announcedPct: number;
}
type StoredWindow = Partial<WindowState> & Partial<LegacyWindow>;

/** data.json written before towns existed has a single `window` — it was Вінниця's. */
type LegacyData = Omit<Partial<StorageData>, 'windows' | 'beta'> & {
    windows?: Record<string, StoredWindow>;
    window?: StoredWindow;
    beta?: { windows?: Record<string, StoredWindow>; alertedIds?: Record<string, number> };
};

const migrateWindows = (stored: Record<string, StoredWindow>): Record<string, WindowState> =>
    Object.fromEntries(Object.entries(stored).map(([id, w]) => [id, migrateWindow(w)]));

/**
 * A pre-cooldown window that already went loud counts as loud at its last match —
 * later than the real alert, so a restart mid-raid errs towards staying quiet.
 */
function migrateWindow(w: StoredWindow): WindowState {
    if ('loudAt' in w) return { ...structuredClone(EMPTY_WINDOW), ...w } as WindowState;
    const wasLoud = (w.announcedPct ?? 0) >= channelsConfig.loudThresholdPct;
    return { loudAt: wasLoud ? w.lastMatchAt ?? null : null, sources: wasLoud ? {} : w.sources ?? {}, fastSources: {} };
}

let data: StorageData = load();
migrateSubscribers();

function load(): StorageData {
    try {
        fs.mkdirSync(env.dataDir, { recursive: true });
        if (!fs.existsSync(FILE)) return structuredClone(DEFAULT);
        const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8')) as LegacyData;
        const stored = parsed.windows ?? (parsed.window ? { vinnytsia: parsed.window } : {});
        const windows = migrateWindows(stored);
        const alertedIds = parsed.alertedIds ?? {};
        return {
            subscribers: parsed.subscribers ?? [],
            windows,
            alertedIds,
            // First boot with tracks: beta starts as a copy of stable, so it neither
            // re-alerts edits stable already sent nor ignores a cooldown in progress.
            beta: parsed.beta
                ? { windows: migrateWindows(parsed.beta.windows ?? {}), alertedIds: parsed.beta.alertedIds ?? {} }
                : structuredClone({ windows, alertedIds }),
        };
    } catch (e) {
        // Move the bad file aside first: the next persist() would otherwise
        // overwrite it, and with it every subscriber.
        const aside = `${FILE}.corrupt-${Date.now()}`;
        try {
            fs.renameSync(FILE, aside);
        } catch {
            /* nothing there to keep */
        }
        console.error(`[storage] unreadable (${(e as Error).message}), kept as ${aside}, starting fresh`);
        return structuredClone(DEFAULT);
    }
}

/**
 * Write via temp file + rename. This runs on a Raspberry Pi that loses power
 * without warning; a half-written data.json would lose the subscriber list.
 */
function persist(): void {
    fs.mkdirSync(env.dataDir, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, FILE);
}

export const getSubscribers = (): Subscriber[] => data.subscribers;

/** A new subscriber starts with only these towns on; the rest are one tap away in /cities. */
const DEFAULT_TOWNS = ['vinnytsia'];

/**
 * Subscribers used to store the towns they muted, so every new town came on for everyone.
 * Freeze the current choice as an explicit `on` list once; towns added later stay off
 * until the subscriber turns them on in /cities.
 */
function migrateSubscribers(): void {
    let changed = false;
    for (const sub of data.subscribers) {
        if (sub.on) continue;
        const off = new Set(sub.off ?? []);
        sub.on = towns.map((t) => t.id).filter((id) => !off.has(id));
        delete sub.off;
        changed = true;
    }
    if (changed) persist();
}

export function addSubscriber(chatId: number, name: string): boolean {
    if (data.subscribers.some((s) => s.chatId === chatId)) return false;
    data.subscribers.push({ chatId, name, since: new Date().toISOString(), on: [...DEFAULT_TOWNS] });
    persist();
    return true;
}

export function removeSubscriber(chatId: number): boolean {
    const before = data.subscribers.length;
    data.subscribers = data.subscribers.filter((s) => s.chatId !== chatId);
    if (data.subscribers.length === before) return false;
    persist();
    return true;
}

export const getSubscriber = (chatId: number): Subscriber | undefined =>
    data.subscribers.find((s) => s.chatId === chatId);

/** Catalogue towns this subscriber gets alerts for. Ids no longer in the catalogue are ignored. */
export function followedTowns(sub: Subscriber): string[] {
    const on = new Set(sub.on ?? []);
    return towns.map((t) => t.id).filter((id) => on.has(id));
}

/** Flip one town for one subscriber. Returns the new state (true = on), or null if not subscribed. */
export function toggleTown(chatId: number, townId: string): boolean | null {
    const sub = getSubscriber(chatId);
    if (!sub) return null;
    const on = sub.on ?? [];
    const nowOn = !on.includes(townId);
    sub.on = nowOn ? [...on, townId] : on.filter((id) => id !== townId);
    persist();
    return nowOn;
}

const stateOf = (track: Track): TrackState => (track === 'beta' ? data.beta : data);

/** The live window object for a town — mutate it, then save(). */
export function getTownWindow(townId: string, track: Track = 'stable'): WindowState {
    return (stateOf(track).windows[townId] ??= structuredClone(EMPTY_WINDOW));
}

/** Write windows and alerted ids — once per post, after every change to them. */
export function save(): void {
    persist();
}

export function wasAlerted(key: string, track: Track = 'stable'): boolean {
    return key in stateOf(track).alertedIds;
}

/** In memory only; save() writes it. */
export function markAlerted(key: string, track: Track = 'stable'): void {
    stateOf(track).alertedIds[key] = Date.now();
}

/** Drop alerted ids older than a day, on both tracks. In memory only; save() writes it. */
export function pruneAlerted(now = Date.now()): void {
    const cutoff = now - ALERTED_TTL_MS;
    for (const ids of [data.alertedIds, data.beta.alertedIds]) {
        for (const [k, ts] of Object.entries(ids)) {
            if (ts < cutoff) delete ids[k];
        }
    }
}
