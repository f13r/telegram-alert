import fs from 'node:fs';
import path from 'node:path';
import { env } from './config.js';

const LOCK = path.join(env.dataDir, 'bot.pid');

const alive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

/**
 * Is `pid` a running instance of this bot? Alive is not enough: bot.pid survives
 * a power cut, and after the reboot an unrelated process can hold that PID —
 * the bot would then refuse to start, every 10 s, forever.
 * `cmdline` is for tests; normally read from /proc. No /proc → trust liveness.
 */
export function isBotProcess(pid: number, cmdline?: string): boolean {
    if (!alive(pid)) return false;
    let cmd = cmdline;
    if (cmd === undefined) {
        try {
            cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        } catch {
            return true;
        }
    }
    return /node/.test(cmd) && /index\.[jt]s(\0|$)/.test(cmd);
}

/**
 * Refuse to start twice. Two instances mean duplicate alerts, doubled scraping
 * (which gets the IP throttled) and 409 Conflict on the Bot API long-poll,
 * which silently breaks /start and /status.
 */
export function acquireLock(): void {
    try {
        fs.mkdirSync(env.dataDir, { recursive: true });
        if (fs.existsSync(LOCK)) {
            const pid = Number(fs.readFileSync(LOCK, 'utf8').trim());
            if (Number.isFinite(pid) && pid !== process.pid && isBotProcess(pid)) {
                console.error(
                    `[boot] already running as PID ${pid}.\n` +
                        `       Stop it first:  kill ${pid}\n` +
                        `       Or remove a stale lock: rm ${LOCK}`,
                );
                process.exit(1);
            }
        }
        fs.writeFileSync(LOCK, String(process.pid));
        const release = (): void => {
            try {
                if (fs.existsSync(LOCK) && fs.readFileSync(LOCK, 'utf8').trim() === String(process.pid)) {
                    fs.unlinkSync(LOCK);
                }
            } catch { /* nothing useful to do while exiting */ }
        };
        process.once('exit', release);
    } catch (e) {
        console.warn('[boot] could not take lock:', (e as Error).message);
    }
}
