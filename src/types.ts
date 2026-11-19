/** A post seen in a monitored channel, normalised across ingestion sources. */
export interface IncomingMessage {
    channelUsername: string;
    channelTitle: string;
    messageId: number;
    /** Message body, or the caption of a photo/video post. */
    text: string;
    /** When the CHANNEL published it — not when we received it. */
    date: Date;
    isEdit: boolean;
}

/**
 * Every ingestion source implements this: the t.me/s scraper in production,
 * `fake` to replay fixtures in testing.
 */
export interface MessageSource {
    readonly name: string;
    start(onMessage: (m: IncomingMessage) => Promise<void>): Promise<void>;
    /** Channels this source can actually read — known only after start(). */
    activeChannels?(): string[];
    stop(): Promise<void>;
}

export interface ChannelCfg {
    username: string;
    label: string;
    /** P(a town match here is a real threat). Combined as 1 − Π(1 − r). */
    reliability: number;
    /** Require a danger keyword too — for channels that publish other content. */
    requiresThreat: boolean;
    /** Drop after-the-fact news (config/news-keywords.json) — for local channels. */
    rejectNews?: boolean;
    stripFooterPatterns: string[];
    /** A post that only points toward a town («у бік», «в районі») needs a second channel to go loud. */
    vagueNeedsSecondSource?: boolean;
    /** Also match city districts — only for oblast-only channels, see config/channels.json. */
    localDistricts?: boolean;
    /** false = the channel has no public t.me/s page, so it cannot be read. */
    webPreview?: boolean;
    /** Read only for the beta track (BETA_CHAT_IDS); stable never sees its posts. */
    beta?: boolean;
}

export interface ChannelsConfig {
    correlationWindowMin: number;
    loudThresholdPct: number;
    channels: ChannelCfg[];
}

export interface Subscriber {
    chatId: number;
    name: string;
    since: string;
    /** Town ids this subscriber follows. A town added to the catalogue later is NOT in it: new towns start off. */
    on?: string[];
    /** Legacy: town ids muted. Converted to `on` at boot (see storage.ts). */
    off?: string[];
}

/**
 * One threat window per town. Shared by every subscriber — a raid is a shared event.
 * A loud alert starts a cooldown of COOLDOWN_MIN; see window.ts.
 */
export interface WindowState {
    /** Epoch ms of the last loud alert, null if none yet. */
    loudAt: number | null;
    /** username → epoch ms of its latest match since the last loud alert, outside a cooldown. */
    sources: Record<string, number>;
    /** Same, for missile/КАБ posts during a cooldown. */
    fastSources: Record<string, number>;
}

/**
 * Which pipeline a subscriber hears. `beta` runs every post through the same
 * pipeline a second time, with its own state, for BETA_CHAT_IDS only — so a
 * filter change can be tried on one chat before it reaches everyone.
 */
export type Track = 'stable' | 'beta';

/** Pipeline state. Each track keeps its own, so a beta cooldown never holds stable. */
export interface TrackState {
    /** townId → its threat window. */
    windows: Record<string, WindowState>;
    /** "channel:messageId:townId" → epoch ms, so an edit does not re-alert. */
    alertedIds: Record<string, number>;
}

/** The stable track's state sits at the top level, as it did before tracks existed. */
export interface StorageData extends TrackState {
    subscribers: Subscriber[];
    beta: TrackState;
}

export interface TownMatch {
    townId: string;
    /** The exact substring that matched, e.g. "Вінницю". */
    form: string;
    targetId: string;
    /** Matched a district (Тяжилів, ГПЗ…), not the town name itself. */
    district?: boolean;
}
