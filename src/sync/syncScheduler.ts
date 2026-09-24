/**
 * When a sync pass runs: soon after a local edit, on the fallback interval, or right now.
 *
 * Both apps used to own one of these by hand -- a `running` ref and a `setInterval` -- and
 * neither pushed after an edit. So an edit reached the server up to a minute late, which is
 * long enough to hide a copy from others, open your own profile and still find it there.
 */

/** How long after a local write its push goes out. Long enough to catch a burst of edits. */
export const LOCAL_WRITE_SYNC_DELAY_MS = 1_500;
/**
 * The longest a steady stream of edits can hold its push back.
 *
 * The delay restarts on every write, which is what folds a burst into one pass -- and
 * would, without a ceiling, let somebody typing into a note keep their first change off
 * the server for as long as they kept typing.
 */
export const LOCAL_WRITE_SYNC_MAX_DELAY_MS = 5_000;

/** The timer functions, injectable so tests can drive them. */
export interface SchedulerTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SyncSchedulerOptions {
  readonly delayMs?: number;
  readonly maxDelayMs?: number;
  readonly timers?: SchedulerTimers;
  readonly now?: () => number;
}

const DEFAULT_TIMERS: SchedulerTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Serialises sync passes and coalesces the requests for them.
 *
 * Never two passes at once: a request that arrives while one is running marks the scheduler
 * dirty, and exactly one more pass follows the current one. That follow-up is not waste --
 * a write that landed after the running pass read its pending ids is only carried by the
 * next one, and without it would sit there until the interval.
 *
 * The pass itself decides whether it may sync (signed in, sign-in conflict answered, sync
 * switched on); this only decides when to ask. A failing pass is not retried from here:
 * offline, an edit costs one failed attempt, and the interval is the retry, as before.
 */
export class SyncScheduler {
  private readonly delayMs: number;
  private readonly maxDelayMs: number;
  private readonly timers: SchedulerTimers;
  private readonly now: () => number;

  private timer: unknown = null;
  /** When the oldest write still waiting on the timer landed. */
  private firstRequestAt: number | null = null;
  private running: Promise<void> | null = null;
  /** The pass promised to whoever asked while another was running. */
  private followUp: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly run: () => Promise<unknown>,
    options: SyncSchedulerOptions = {},
  ) {
    this.delayMs = options.delayMs ?? LOCAL_WRITE_SYNC_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? LOCAL_WRITE_SYNC_MAX_DELAY_MS;
    this.timers = options.timers ?? DEFAULT_TIMERS;
    this.now = options.now ?? Date.now;
  }

  /** A local write happened: run a pass shortly, folding whatever else lands meanwhile in. */
  schedule(): void {
    if (this.disposed) return;
    const now = this.now();
    this.firstRequestAt ??= now;
    const ceiling = this.firstRequestAt + this.maxDelayMs - now;
    this.clearTimer();
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = null;
        this.firstRequestAt = null;
        void this.runNow();
      },
      Math.max(0, Math.min(this.delayMs, ceiling)),
    );
  }

  /** Whether a scheduled pass is still waiting for its delay. */
  get pending(): boolean {
    return this.timer !== null;
  }

  /**
   * Run a pass now; resolves once a pass that started after this call has finished.
   *
   * What a pull-to-refresh and returning to the app call. Mid-pass, it waits for the one
   * follow-up pass rather than starting a second alongside -- or pretending the pass that
   * began before the request answered it.
   */
  runNow(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    // Anything waiting on the timer rides along with this pass.
    this.clearTimer();
    this.firstRequestAt = null;
    if (this.running === null) return this.start();
    this.followUp ??= this.running.then(() => this.start());
    return this.followUp;
  }

  /** The interval's tick: a pass if nothing is running, and nothing queued behind one if it is. */
  runIfIdle(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running !== null) return this.running;
    this.clearTimer();
    this.firstRequestAt = null;
    return this.start();
  }

  /**
   * Run a scheduled pass now instead of when its delay is up. Nothing scheduled, nothing run.
   *
   * For the app leaving the screen: a phone stops running timers in the background, and an
   * edit made just before the switch would otherwise wait until the app came back.
   */
  flush(): Promise<void> {
    if (!this.pending) return Promise.resolve();
    return this.runNow();
  }

  /** Stops scheduling for good. A pass already running finishes; nothing follows it. */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.firstRequestAt = null;
  }

  private start(): Promise<void> {
    this.followUp = null;
    if (this.disposed) return Promise.resolve();
    const pass = (async () => {
      try {
        await this.run();
      } catch {
        // The pass owns its own error handling; a throw that escapes it must not wedge the
        // scheduler with a pass that never finished.
      } finally {
        this.running = null;
      }
    })();
    this.running = pass;
    return pass;
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}
