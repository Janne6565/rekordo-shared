import { useCallback, useEffect, useRef } from "react";
import type { LocalWriteSignal } from "../local/localWrites.js";
import { SyncScheduler, type SyncSchedulerOptions } from "./syncScheduler.js";

export interface SyncLoopOptions {
  /**
   * Whether this device may sync at all: signed in, and past the sign-in conflict.
   *
   * While false there is no scheduler, no interval and no subscription -- a signed-out app
   * edits its shelf without ever reaching for the network.
   */
  readonly active: boolean;
  /**
   * One sync pass, with the app's own guards and error handling inside it.
   *
   * Read through a ref, so a new function every render does not restart the loop.
   */
  readonly run: () => Promise<void>;
  /** Local writes to push soon after. Without it only the interval and `syncNow` run passes. */
  readonly localWrites?: LocalWriteSignal;
  /** The fallback: how often a pass runs with nobody asking for one. */
  readonly intervalMs: number;
  /** Test seam; the defaults are the delays in `syncScheduler.ts`. */
  readonly scheduler?: SyncSchedulerOptions;
}

export interface SyncLoopControls {
  /** A pass now, resolved when one that started after the call has finished. */
  readonly syncNow: () => Promise<void>;
  /** Runs a pass a local write has scheduled, if one is waiting. For leaving the screen. */
  readonly flush: () => Promise<void>;
}

/**
 * The sync loop both apps run: a pass on start, one per interval, and one shortly after
 * every local write -- never two at once.
 *
 * One implementation because the two apps' loops had already drifted in exactly the way
 * that mattered: neither pushed after an edit, and each guarded against overlapping passes
 * with its own ref.
 */
export function useSyncLoop({
  active,
  run,
  localWrites,
  intervalMs,
  scheduler: schedulerOptions,
}: SyncLoopOptions): SyncLoopControls {
  const runRef = useRef(run);
  runRef.current = run;
  const schedulerRef = useRef<SyncScheduler | null>(null);
  const optionsRef = useRef(schedulerOptions);

  useEffect(() => {
    if (!active) return;
    const scheduler = new SyncScheduler(() => runRef.current(), optionsRef.current);
    schedulerRef.current = scheduler;
    void scheduler.runNow();
    const timer = setInterval(() => void scheduler.runIfIdle(), intervalMs);
    const unsubscribe = localWrites?.subscribe(() => scheduler.schedule());
    return () => {
      unsubscribe?.();
      clearInterval(timer);
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [active, localWrites, intervalMs]);

  // Without a loop the pass still runs, so its own guards can say why it did nothing.
  const syncNow = useCallback(() => schedulerRef.current?.runNow() ?? runRef.current(), []);
  const flush = useCallback(() => schedulerRef.current?.flush() ?? Promise.resolve(), []);
  return { syncNow, flush };
}
