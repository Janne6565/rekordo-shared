import type { LocalStore } from "./LocalStore.js";

/**
 * Tells whoever is listening that a local write just gave sync something to push.
 *
 * The web tab used to push only on its minute-long interval, so hiding a copy from others
 * and opening your own profile still showed it there for up to a minute. The server was
 * right the moment the push landed -- nothing had asked for one. This is the "something
 * changed" half of fixing that; `SyncScheduler` is the "so push soon" half.
 */
export interface LocalWriteSignal {
  /** Calls `listener` after every write that marks a record pending. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * The writes that mark a record pending, which are exactly the ones a push has to carry.
 *
 * Adopts are sync writing back what it pulled and must never wake sync again; cached
 * releases, photo bytes, settings and cursors are not records anybody pushes.
 */
const PENDING_WRITES = new Set<PropertyKey>([
  "putCopy",
  "putCopies",
  "putWishlistItem",
  "putPhoto",
]);

/** Where an observed store keeps the one it wraps, for `unobservedStore`. */
const UNOBSERVED = Symbol("rekordo.unobservedStore");

/**
 * Wraps a store so every pending-marking write announces itself once it has landed.
 *
 * A wrapper rather than a hook in each app's store, so the web's Dexie store and the
 * phone's SQLite store cannot disagree about which writes count. Every other method -- the
 * phone's native extras included -- passes straight through, bound to the real store so a
 * class that keeps private state keeps working behind the proxy.
 *
 * The announcement follows the write rather than preceding it: a sync woken before the
 * pending id is recorded would find nothing to push and the edit would wait for the
 * interval after all. A write that throws announces nothing.
 */
export function observeLocalWrites<S extends LocalStore>(
  store: S,
): { readonly store: S; readonly localWrites: LocalWriteSignal } {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A listener that throws must not turn a successful write into a failed one.
      }
    }
  };

  const observed = new Proxy(store, {
    get(target, property) {
      if (property === UNOBSERVED) return target;
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (!PENDING_WRITES.has(property)) return value.bind(target);
      return async (...args: unknown[]) => {
        const result = await value.apply(target, args);
        // `putCopies([])` wrote nothing, and nothing is waiting to be pushed.
        const empty = property === "putCopies" && (args[0] as readonly unknown[]).length === 0;
        if (!empty) notify();
        return result;
      };
    },
  });

  return {
    store: observed,
    localWrites: {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

/**
 * The store behind an observed one, or the store itself when it was never wrapped.
 *
 * The sync engine writes through this. Its own writes -- a tombstone for a first-sync
 * choice, the storage key an upload hands back -- are either pushed in the same pass or
 * followed by one, so announcing them would only wake a second, empty sync behind every
 * sync that uploaded a photo.
 */
export function unobservedStore<S extends LocalStore>(store: S): S {
  return ((store as unknown as Record<PropertyKey, unknown>)[UNOBSERVED] as S | undefined) ?? store;
}
