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
    stripFooterPatterns: string[];
    /** false = the channel has no public t.me/s page, so it cannot be read. */
    webPreview?: boolean;
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
    /** Town ids this subscriber muted. Missing = every town on. */
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

export interface StorageData {
    subscribers: Subscriber[];
    /** townId → its threat window. */
    windows: Record<string, WindowState>;
    /** "channel:messageId:townId" → epoch ms, so an edit does not re-alert. */
    alertedIds: Record<string, number>;
}

export interface TownMatch {
    townId: string;
    /** The exact substring that matched, e.g. "Вінницю". */
    form: string;
    targetId: string;
}
