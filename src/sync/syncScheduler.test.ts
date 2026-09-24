import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hlcInitial, hlcTick } from "../domain/hlc.js";
import type { Release } from "../domain/types.js";
import { type ClockSource, createCopy } from "../local/copyWrites.js";
import { observeLocalWrites, unobservedStore } from "../local/localWrites.js";
import { createPhoto } from "../local/photoWrites.js";
import { createWishlistItem } from "../local/wishWrites.js";
import { MemoryStore } from "../testing/MemoryStore.js";
import { SyncEngine } from "./syncEngine.js";
import {
  LOCAL_WRITE_SYNC_DELAY_MS,
  LOCAL_WRITE_SYNC_MAX_DELAY_MS,
  SyncScheduler,
} from "./syncScheduler.js";
import type { SyncTransport } from "./transport.js";
import { useSyncLoop } from "./useSyncLoop.js";

function clockSource(node: string): ClockSource {
  let current = hlcInitial(node);
  let wall = 1000;
  return {
    next() {
      wall += 1;
      current = hlcTick(current, wall);
      return current;
    },
  };
}

const release = {
  id: "rel-1",
  albumId: "group-1",
  title: "Bitches Brew",
  artistName: "Miles Davis",
  year: 1970,
  format: "VINYL",
  coverArtUrl: null,
} as Release;

const draft = {
  condition: "VG_PLUS" as const,
  sleeveCondition: "NM" as const,
  catalogArt: "AUTO" as const,
  pricePaidCents: null,
  currency: "EUR",
  purchasedOn: null,
  purchasedAt: null,
  notes: null,
  rating: null,
};

/** A pass that stays running until the test lets it finish. */
function controllablePass() {
  const releases: Array<() => void> = [];
  const run = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      }),
  );
  return {
    run,
    finish: async () => {
      releases.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

describe("SyncScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs one pass a delay after a write", async () => {
    const run = vi.fn(async () => undefined);
    const scheduler = new SyncScheduler(run);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_SYNC_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("folds a burst of writes into one pass", async () => {
    const run = vi.fn(async () => undefined);
    const scheduler = new SyncScheduler(run);

    for (let write = 0; write < 5; write += 1) {
      scheduler.schedule();
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_SYNC_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not let a steady stream of writes hold the push back past the ceiling", async () => {
    const run = vi.fn(async () => undefined);
    const scheduler = new SyncScheduler(run);

    // A write every second restarts the delay every time and would never let it expire.
    for (let elapsed = 0; elapsed < LOCAL_WRITE_SYNC_MAX_DELAY_MS; elapsed += 1_000) {
      scheduler.schedule();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never overlaps a running pass, and runs once more after it when asked meanwhile", async () => {
    const pass = controllablePass();
    const scheduler = new SyncScheduler(pass.run);

    void scheduler.runNow();
    expect(pass.run).toHaveBeenCalledTimes(1);

    // Three writes land while the first pass is still out.
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_SYNC_DELAY_MS);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_SYNC_DELAY_MS);
    void scheduler.runNow();
    expect(pass.run).toHaveBeenCalledTimes(1);

    await pass.finish();
    expect(pass.run).toHaveBeenCalledTimes(2);

    await pass.finish();
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_SYNC_DELAY_MS * 4);
    expect(pass.run).toHaveBeenCalledTimes(2);
  });

  it("resolves runNow only after a pass that started after the call", async () => {
    const pass = controllablePass();
    const scheduler = new SyncScheduler(pass.run);
    void scheduler.runNow();

    let answered = false;
    void scheduler.runNow().then(() => {
      answered = true;
    });
    await pass.finish();
    expect(answered).toBe(false);
    await pass.finish();
    expect(answered).toBe(true);
  });

  it("lets an interval tick skip a running pass instead of queueing behind it", async () => {
    const pass = controllablePass();
    const scheduler = new SyncScheduler(pass.run);

    void scheduler.runIfIdle();
    void scheduler.runIfIdle();
    await pass.finish();
    expect(pass.run).toHaveBeenCalledTimes(1);
  });

  it("keeps working after a pass throws", async () => {
    const run = vi.fn(async () => {
      throw new Error("offline");
    });
    const scheduler = new SyncScheduler(run);

    await scheduler.runNow();
    await scheduler.runNow();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("flushes a waiting pass straight away, and does nothing when none waits", async () => {
    const run = vi.fn(async () => undefined);
    const scheduler = new SyncScheduler(run);

    await scheduler.flush();
    expect(run).not.toHaveBeenCalled();

    scheduler.schedule();
    await scheduler.flush();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_SYNC_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs nothing once disposed, and nothing after the pass it was running", async () => {
    const pass = controllablePass();
    const scheduler = new SyncScheduler(pass.run);

    void scheduler.runNow();
    void scheduler.runNow();
    scheduler.schedule();
    scheduler.dispose();
    await pass.finish();
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_SYNC_DELAY_MS);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_SYNC_DELAY_MS);
    expect(pass.run).toHaveBeenCalledTimes(1);
  });
});

describe("observeLocalWrites", () => {
  it("announces every pending-marking write after it has landed", async () => {
    const raw = new MemoryStore();
    const { store, localWrites } = observeLocalWrites(raw);
    const pendingAtNotice: string[][] = [];
    localWrites.subscribe(() => {
      void raw.readPendingIds().then((ids) => pendingAtNotice.push(ids));
    });
    const clock = clockSource("a");

    await store.putCopy(createCopy(release, draft, clock, 1000, "copy-1"));
    await store.putCopies([createCopy(release, draft, clock, 1000, "copy-2")]);
    await store.putWishlistItem(
      createWishlistItem(
        {
          albumId: "group-1",
          releaseId: null,
          title: "Kind of Blue",
          artistName: "Miles Davis",
          year: 1959,
          desiredFormat: null,
          note: null,
        },
        clock,
        1000,
        "wish-1",
      ),
    );
    await store.putPhoto(
      createPhoto(
        { copyId: "copy-1", contentType: "image/jpeg", byteSize: 1, sortIndex: 0 },
        clock,
        1000,
        "photo-1",
      ),
    );
    await Promise.resolve();

    expect(pendingAtNotice).toHaveLength(4);
    expect(pendingAtNotice[0]).toContain("copy-1");
  });

  it("stays quiet for sync's own adopts, the catalogue, settings and empty batches", async () => {
    const { store, localWrites } = observeLocalWrites(new MemoryStore());
    const listener = vi.fn();
    localWrites.subscribe(listener);

    await store.adoptCopy(createCopy(release, draft, clockSource("a"), 1000, "copy-1"));
    await store.cacheReleases([release]);
    await store.writeSetting("k", "v");
    await store.writePendingIds([]);
    await store.putCopies([]);

    expect(listener).not.toHaveBeenCalled();
  });

  it("passes everything else through to the store it wraps", async () => {
    const raw = new MemoryStore();
    const { store } = observeLocalWrites(raw);

    await store.putCopy(createCopy(release, draft, clockSource("a"), 1000, "copy-1"));

    expect((await raw.getCopy("copy-1"))?.id).toBe("copy-1");
    expect(await store.readPendingIds()).toEqual(["copy-1"]);
    expect(unobservedStore(store)).toBe(raw);
    expect(unobservedStore(raw)).toBe(raw);
  });

  it("stops announcing once unsubscribed", async () => {
    const { store, localWrites } = observeLocalWrites(new MemoryStore());
    const listener = vi.fn();
    const unsubscribe = localWrites.subscribe(listener);
    unsubscribe();

    await store.putCopy(createCopy(release, draft, clockSource("a"), 1000, "copy-1"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("is not woken by the sync engine's own writes", async () => {
    const { store, localWrites } = observeLocalWrites(new MemoryStore());
    const clock = clockSource("a");
    const copy = createCopy(release, draft, clock, 1000, "copy-1");
    await store.adoptCopy(copy);
    const photo = createPhoto(
      { copyId: "copy-1", contentType: "image/jpeg", byteSize: 1, sortIndex: 0 },
      clock,
      1000,
      "photo-1",
    );
    await store.adoptPhoto(photo);
    const listener = vi.fn();
    localWrites.subscribe(listener);

    const transport: SyncTransport = {
      pull: async () => ({ copies: [], wishes: [], photos: [], cursor: 0, hasMore: false }),
      push: async () => ({ copies: [], wishes: [], photos: [], cursor: 0, hasMore: false }),
      // An upload the engine records with `putPhoto` -- a pending-marking write.
      uploadPhoto: async () => ({ storageKey: "key-1" }),
      downloadPhoto: async () => undefined,
      fetchReleases: async () => [],
    };
    const engine = new SyncEngine(store, clock, transport);
    await engine.firstSync("KEEP_ACCOUNT");

    expect((await store.getCopyIncludingDeleted("copy-1"))?.deletedAt).not.toBeNull();
    // The upload was recorded with `putPhoto` too, and still woke nothing.
    expect((await store.getPhotoIncludingDeleted("photo-1"))?.storageKey).toBe("key-1");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("useSyncLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes shortly after a store write, once for a burst", async () => {
    const { store, localWrites } = observeLocalWrites(new MemoryStore());
    const run = vi.fn(async () => undefined);
    renderHook(() => useSyncLoop({ active: true, run, localWrites, intervalMs: 60_000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(run).toHaveBeenCalledTimes(1); // the pass on start

    const clock = clockSource("a");
    await act(async () => {
      await store.putCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      await store.putCopy(createCopy(release, draft, clock, 1000, "copy-2"));
      await vi.advanceTimersByTimeAsync(LOCAL_WRITE_SYNC_DELAY_MS);
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps the interval as the fallback", async () => {
    const run = vi.fn(async () => undefined);
    renderHook(() => useSyncLoop({ active: true, run, intervalMs: 60_000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does nothing at all while inactive -- signed out, or before the sign-in conflict", async () => {
    const { store, localWrites } = observeLocalWrites(new MemoryStore());
    const run = vi.fn(async () => undefined);
    renderHook(() => useSyncLoop({ active: false, run, localWrites, intervalMs: 60_000 }));

    await act(async () => {
      await store.putCopy(createCopy(release, draft, clockSource("a"), 1000, "copy-1"));
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("stops scheduling when it goes inactive", async () => {
    const { store, localWrites } = observeLocalWrites(new MemoryStore());
    const run = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ active }) => useSyncLoop({ active, run, localWrites, intervalMs: 60_000 }),
      { initialProps: { active: true } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({ active: false });

    await act(async () => {
      await store.putCopy(createCopy(release, draft, clockSource("a"), 1000, "copy-1"));
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("uses the latest pass without restarting the loop", async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(
      ({ run }) => useSyncLoop({ active: true, run, intervalMs: 60_000 }),
      { initialProps: { run: first } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({ run: second });
    await act(async () => {
      await result.current.syncNow();
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
