import { beforeEach, describe, expect, it, vi } from "vitest";
import { hlcInitial, hlcTick } from "../domain/hlc.js";
import type { Copy, Photo, Release } from "../domain/types.js";
import { type ClockSource, createCopy, tombstoneCopy } from "../local/copyWrites.js";
import { ORPHAN_PHOTO_GRACE_MS } from "../local/orphanPhotos.js";
import { createPhoto, markUploaded } from "../local/photoWrites.js";
import { createWishlistItem } from "../local/wishWrites.js";
import { MemoryStore } from "../testing/MemoryStore.js";
import { SyncEngine } from "./syncEngine.js";
import type { SyncTransport } from "./transport.js";
import { readUploadRefusal, writeUploadRefusal } from "./uploadRefusal.js";

const pull = vi.fn();
const push = vi.fn();
const fetchReleases = vi.fn();

/**
 * The engine's whole view of the network. Carrying the bytes is each platform's own code;
 * *deciding which bytes are missing* is the engine's, and that is exercised below.
 */
const downloadPhoto = vi.fn();

/** Null by default: "the bytes are not on this device", which is not a failure. */
const uploadPhoto = vi.fn<SyncTransport["uploadPhoto"]>(async () => null);

const transport: SyncTransport = {
  pull: (cursor) => pull(cursor),
  push: (copies, wishes, photos, releases) => push(copies, wishes, photos, releases),
  uploadPhoto: (photo) => uploadPhoto(photo),
  downloadPhoto: (photo) => downloadPhoto(photo),
  fetchReleases: (releaseIds) => fetchReleases(releaseIds),
};

const EMPTY_PAGE = { copies: [], wishes: [], photos: [], cursor: 0, hasMore: false };

/** A minimal wishlist entry — the batch's other half, so a poisoned photo has company. */
function wish(id: string) {
  return createWishlistItem(
    {
      albumId: "group-1",
      releaseId: null,
      title: "Bitches Brew",
      artistName: "Miles Davis",
      year: 1970,
      desiredFormat: null,
      note: null,
    },
    clockSource("a"),
    1000,
    id,
  );
}

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

const release: Release = {
  id: "rel-1",
  albumId: "group-1",
  title: "Bitches Brew",
  artistName: "Miles Davis",
  year: 1970,
  format: "VINYL",
  label: null,
  catalogNumber: null,
  country: null,
  barcode: null,
  releaseDate: null,
  trackCount: null,
  discCount: null,
  coverArtUrl: null,
  coverTheme: null,
  cachedAt: 0,
};

/** One of many distinct releases, for the paths that only show up past a single page. */
function releaseNumbered(index: number): Release {
  return { ...release, id: `rel-${index}`, albumId: `group-${index}`, title: `Release ${index}` };
}

/** `count` copies, each naming a release of its own that this device does not hold. */
async function adoptCopiesNaming(
  store: MemoryStore,
  clock: ClockSource,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await store.adoptCopy(createCopy(releaseNumbered(index), draft, clock, 1000, `copy-${index}`));
  }
}

const draft = {
  condition: "VG_PLUS" as const,
  sleeveCondition: "NM" as const,
  catalogArt: "AUTO" as const,
  pricePaidCents: 2800,
  currency: "EUR",
  purchasedOn: null,
  purchasedAt: null,
  notes: null,
  rating: null,
};

describe("SyncEngine", () => {
  let store: MemoryStore;
  let engine: SyncEngine;
  let clock: ClockSource;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.open();
    clock = clockSource("device-a");
    engine = new SyncEngine(store, clock, transport);
    pull.mockReset();
    push.mockReset();
    fetchReleases.mockReset();
    fetchReleases.mockResolvedValue([]);
    pull.mockResolvedValue(EMPTY_PAGE);
    push.mockResolvedValue({ ...EMPTY_PAGE });
    // The one-time catalogue offer is exercised in its own block; without this every test
    // here would also be a test of that, and would count its requests.
    await store.writeSetting("catalogueOffered", "true");
  });

  it("pushes a locally created copy exactly once", async () => {
    await store.cacheReleases([release]);
    await store.putCopy(createCopy(release, draft, clock, 1000, "copy-1"));

    const first = await engine.sync();
    const second = await engine.sync();

    expect(first.pushed).toBe(1);
    // Without clearing pending after a successful push, the client resends forever.
    expect(second.pushed).toBe(0);
  });

  it("does not push back what it just pulled", async () => {
    const remote = createCopy(release, draft, clock, 1000, "copy-remote");
    pull.mockResolvedValueOnce({ ...EMPTY_PAGE, copies: [remote], cursor: 5, hasMore: false });

    const first = await engine.sync();

    expect(first.pulled).toBe(1);
    expect(await store.readPendingIds()).toEqual([]);
    expect(push).not.toHaveBeenCalled();
  });

  it("merges a pulled record against local edits rather than overwriting them", async () => {
    await store.cacheReleases([release]);
    const local = createCopy(release, draft, clock, 1000, "copy-1");
    await store.putCopy(local);

    // The server has a newer rating; everything else on it is older.
    const remote: Copy = {
      ...local,
      rating: 5,
      condition: "G",
      fieldClocks: {
        ...local.fieldClocks,
        rating: "000000000900000:0000:b",
        condition: "000000000000001:0000:b",
      },
    };
    pull.mockResolvedValueOnce({ ...EMPTY_PAGE, copies: [remote], cursor: 9, hasMore: false });

    await engine.sync();

    const merged = await store.getCopy("copy-1");
    expect(merged?.rating).toBe(5);
    // The local condition is newer, so the server's older one must not win.
    expect(merged?.condition).toBe("VG_PLUS");
  });

  it("follows the cursor across pages", async () => {
    const one = createCopy(release, draft, clock, 1000, "copy-1");
    const two = createCopy(release, draft, clock, 1000, "copy-2");
    pull
      .mockResolvedValueOnce({ ...EMPTY_PAGE, copies: [one], cursor: 1, hasMore: true })
      .mockResolvedValueOnce({ ...EMPTY_PAGE, copies: [two], cursor: 2, hasMore: false });

    const result = await engine.sync();

    expect(result.pulled).toBe(2);
    expect(await store.readSyncCursor()).toBe(2);
    expect(pull).toHaveBeenNthCalledWith(2, 1);
  });

  it("pushes a tombstone so deletes propagate", async () => {
    await store.cacheReleases([release]);
    await store.putCopy(createCopy(release, draft, clock, 1000, "copy-1"));
    await engine.sync();
    push.mockClear();

    const alive = await store.getCopy("copy-1");
    await store.putCopy(tombstoneCopy(alive as Copy, clock, 5000));
    await engine.sync();

    const pushed = push.mock.calls[0]?.[0] as Copy[];
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.deletedAt).toBe(5000);
  });

  it("puts down a removed copy's photos in the same pass, once Undo is out of reach", async () => {
    await store.cacheReleases([release]);
    const copy = createCopy(release, draft, clock, 1000, "copy-1");
    await store.putCopy(tombstoneCopy(copy, clock, Date.now() - ORPHAN_PHOTO_GRACE_MS - 1));
    // Uploaded: a photo that never was has nothing on the server to delete, and its
    // tombstone is dropped rather than pushed.
    const taken = createPhoto(
      { copyId: "copy-1", contentType: "image/jpeg", byteSize: 1200, sortIndex: 0 },
      clock,
      1000,
      "photo-1",
    );
    await store.putPhoto(markUploaded(taken, "photos/photo-1", clock));

    await engine.sync();

    const photos = push.mock.calls[0]?.[2] as Photo[];
    expect(photos.map((photo) => [photo.id, photo.deletedAt !== null])).toEqual([
      ["photo-1", true],
    ]);
  });

  describe("the catalogue behind pulled copies", () => {
    it("fetches the releases a pulled copy names but this device has never seen", async () => {
      const remote = createCopy(release, draft, clock, 1000, "copy-remote");
      pull.mockResolvedValueOnce({ ...EMPTY_PAGE, copies: [remote], cursor: 5, hasMore: false });
      fetchReleases.mockResolvedValueOnce([release]);

      await engine.sync();

      expect(fetchReleases).toHaveBeenCalledWith(["rel-1"]);
      expect(await store.getRelease("rel-1")).toMatchObject({ title: "Bitches Brew" });
    });

    it("does not ask again for a release it already holds", async () => {
      await store.cacheReleases([release]);
      await store.putCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      // The first sync spends the one-off cover repair below; the steady state is after it.
      fetchReleases.mockResolvedValueOnce([]);
      await engine.sync();
      fetchReleases.mockClear();

      await engine.sync();

      expect(fetchReleases).not.toHaveBeenCalled();
    });

    it("asks once about a release it holds with no cover, and takes the answer", async () => {
      // A throttled cover probe on the server used to be recorded as "this release has no
      // artwork", and the client cached the answer over the URL it had — so a record lost
      // its sleeve on both sides at once. This is the repair, and it runs exactly once.
      await store.cacheReleases([release]);
      await store.putCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      fetchReleases.mockResolvedValueOnce([{ ...release, coverArtUrl: "https://art/rel-1" }]);

      await engine.sync();

      expect(fetchReleases).toHaveBeenCalledWith(["rel-1"]);
      expect(await store.getRelease("rel-1")).toMatchObject({ coverArtUrl: "https://art/rel-1" });

      fetchReleases.mockClear();
      await engine.sync();
      expect(fetchReleases).not.toHaveBeenCalled();
    });

    it("never asks a catalogue about a hand-entered release", async () => {
      const manual: Copy = {
        ...createCopy(release, draft, clock, 1000, "copy-manual"),
        releaseId: "local:copy-manual",
      };
      pull.mockResolvedValueOnce({ ...EMPTY_PAGE, copies: [manual], cursor: 5, hasMore: false });

      await engine.sync();

      expect(fetchReleases).not.toHaveBeenCalled();
    });

    it("reports what it filled in, so a caller can redraw a shelf nothing was pulled onto", async () => {
      await store.adoptCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      fetchReleases.mockResolvedValueOnce([release]);

      const result = await engine.sync();

      expect(result.pulled).toBe(0);
      expect(result.releases).toBe(1);
    });

    it("heals a device that pulled its copies before this existed", async () => {
      // The copies are already here, the pull brings nothing new, and the shelf is still
      // blank -- which is exactly the state a client left in by an older build is in.
      await store.adoptCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      fetchReleases.mockResolvedValueOnce([release]);

      await engine.sync();

      expect(fetchReleases).toHaveBeenCalledWith(["rel-1"]);
      expect(await store.getRelease("rel-1")).toMatchObject({ title: "Bitches Brew" });
    });

    it("survives a mirror that is unreachable", async () => {
      const remote = createCopy(release, draft, clock, 1000, "copy-remote");
      pull.mockResolvedValueOnce({ ...EMPTY_PAGE, copies: [remote], cursor: 5, hasMore: false });
      fetchReleases.mockRejectedValueOnce(new Error("offline"));

      const result = await engine.sync();

      expect(result.pulled).toBe(1);
      expect(await store.getCopy("copy-remote")).toBeDefined();
    });

    it("carries on to the later pages when one of them fails", async () => {
      // Two pages' worth, so the first rejection used to end the whole refill and strand
      // every record after it -- permanently, if the failing page was the first one.
      await adoptCopiesNaming(store, clock, 150);
      fetchReleases.mockRejectedValueOnce(new Error("offline"));
      fetchReleases.mockResolvedValueOnce([releaseNumbered(120)]);

      const result = await engine.sync();

      expect(fetchReleases).toHaveBeenCalledTimes(2);
      expect(await store.getRelease("rel-120")).toMatchObject({ title: "Release 120" });
      expect(result.releases).toBe(1);
    });

    it("says the catalogue could not be reached, rather than reporting nothing missing", async () => {
      await store.adoptCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      fetchReleases.mockRejectedValueOnce(new Error("offline"));

      const result = await engine.sync();

      expect(result.releasesUnreachable).toBe(true);
      expect(result.releasesMissing).toBe(1);
    });

    it("counts the copies the mirror answered about but had no entry for", async () => {
      // The mirror stays silent about ids it has never seen rather than failing, so this
      // is a reachable server and a shelf that still cannot be described.
      await store.adoptCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      fetchReleases.mockResolvedValueOnce([]);

      const result = await engine.sync();

      expect(result.releasesUnreachable).toBe(false);
      expect(result.releasesMissing).toBe(1);
      expect(result.releases).toBe(0);
    });

    it("offers the server the catalogue it is missing, and stops once it took them", async () => {
      // The device that made the copies is the only one still holding their releases: the
      // mirror never saw them, and for a Discogs id it can never fetch them either.
      await store.writeSetting("catalogueOffered", "false");
      // Not what this test is about: the one-off cover repair would spend a mocked answer.
      await store.writeSetting("catalogue.coverRepair", "1");
      await store.cacheReleases([release]);
      await store.adoptCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      // Asked before the offer and again after it: nothing, then the release it just took.
      fetchReleases.mockResolvedValueOnce([]).mockResolvedValueOnce([release]);

      await engine.sync();

      const offered = push.mock.calls.find((call) => (call[3] as Release[]).length > 0);
      expect(offered?.[3]).toEqual([expect.objectContaining({ id: "rel-1" })]);
      // Copies are not resent by the offer; it carries the catalogue and nothing else.
      expect(offered?.[0]).toEqual([]);

      push.mockClear();
      await engine.sync();
      expect(push.mock.calls.every((call) => (call[3] as Release[]).length === 0)).toBe(true);
    });

    it("offers again when the server took the push but stored nothing", async () => {
      // A server too old to know the field answers 200 and changes nothing. Counting that
      // as done would spend the single offer a collection gets on absolutely nothing.
      await store.writeSetting("catalogueOffered", "false");
      // Not what this test is about: the one-off cover repair would spend a mocked answer.
      await store.writeSetting("catalogue.coverRepair", "1");
      await store.cacheReleases([release]);
      await store.adoptCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      fetchReleases.mockResolvedValue([]);

      await engine.sync();
      expect(push.mock.calls.some((call) => (call[3] as Release[]).length > 0)).toBe(true);

      push.mockClear();
      await engine.sync();
      expect(push.mock.calls.some((call) => (call[3] as Release[]).length > 0)).toBe(true);
    });

    it("offers nothing the mirror can already answer for", async () => {
      await store.writeSetting("catalogueOffered", "false");
      // Not what this test is about: the one-off cover repair would spend a mocked answer.
      await store.writeSetting("catalogue.coverRepair", "1");
      await store.cacheReleases([release]);
      await store.adoptCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      fetchReleases.mockResolvedValue([release]);

      await engine.sync();

      expect(push.mock.calls.every((call) => (call[3] as Release[]).length === 0)).toBe(true);
    });

    it("never offers a hand-entered release", async () => {
      // "local:<copy id>" is derived from its copy and belongs in no shared cache.
      await store.writeSetting("catalogueOffered", "false");
      const manual: Copy = {
        ...createCopy(release, draft, clock, 1000, "copy-manual"),
        releaseId: "local:copy-manual",
      };
      await store.adoptCopy(manual);

      await engine.sync();

      expect(fetchReleases).not.toHaveBeenCalled();
      expect(push.mock.calls.every((call) => (call[3] as Release[]).length === 0)).toBe(true);
    });

    it("tries again next sync when the offer could not get through", async () => {
      await store.writeSetting("catalogueOffered", "false");
      // Not what this test is about: the one-off cover repair would spend a mocked answer.
      await store.writeSetting("catalogue.coverRepair", "1");
      await store.cacheReleases([release]);
      await store.adoptCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      fetchReleases.mockResolvedValue([]);
      push.mockRejectedValueOnce(new Error("offline"));

      // The whole sync must survive it: the catalogue is not worth failing a merge over.
      await expect(engine.sync()).resolves.toBeDefined();

      push.mockClear();
      push.mockResolvedValue({ ...EMPTY_PAGE });
      await engine.sync();
      expect(push.mock.calls.some((call) => (call[3] as Release[]).length > 0)).toBe(true);
    });

    it("sends the catalogue behind an ordinary push alongside it", async () => {
      await store.cacheReleases([release]);
      await store.putCopy(createCopy(release, draft, clock, 1000, "copy-1"));

      await engine.sync();

      const pushed = push.mock.calls.find((call) => (call[0] as Copy[]).length > 0);
      expect(pushed?.[3]).toEqual([expect.objectContaining({ id: "rel-1" })]);
    });

    it("reports nothing missing once the shelf can describe itself", async () => {
      await store.adoptCopy(createCopy(release, draft, clock, 1000, "copy-1"));
      fetchReleases.mockResolvedValueOnce([release]);

      const result = await engine.sync();

      expect(result.releasesMissing).toBe(0);
      expect(result.releasesUnreachable).toBe(false);
    });
  });
});

describe("first sign-in", () => {
  let store: MemoryStore;
  let engine: SyncEngine;
  let clock: ClockSource;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.open();
    clock = clockSource("device-a");
    engine = new SyncEngine(store, clock, transport);
    pull.mockReset();
    push.mockReset();
    push.mockResolvedValue({ ...EMPTY_PAGE });

    await store.cacheReleases([release]);
    await store.putCopy(createCopy(release, draft, clock, 1000, "local-1"));
  });

  it("MERGE keeps both sides", async () => {
    const accountCopy = createCopy(release, draft, clockSource("device-b"), 2000, "account-1");
    pull.mockResolvedValueOnce({ ...EMPTY_PAGE, copies: [accountCopy], cursor: 4, hasMore: false });

    await engine.firstSync("MERGE");

    expect((await store.listCopies()).map((c) => c.id).sort()).toEqual(["account-1", "local-1"]);
  });

  it("KEEP_ACCOUNT discards the local collection", async () => {
    const accountCopy = createCopy(release, draft, clockSource("device-b"), 2000, "account-1");
    pull.mockResolvedValue({ ...EMPTY_PAGE, copies: [accountCopy], cursor: 4, hasMore: false });

    await engine.firstSync("KEEP_ACCOUNT");

    expect((await store.listCopies()).map((c) => c.id)).toEqual(["account-1"]);
    // The discard is a tombstone, so it replicates rather than letting another device
    // hand the records straight back.
    expect((await store.getCopyIncludingDeleted("local-1"))?.deletedAt).not.toBeNull();
  });

  it("KEEP_LOCAL discards what was only in the account", async () => {
    const accountCopy = createCopy(release, draft, clockSource("device-b"), 2000, "account-1");
    pull.mockResolvedValue({ ...EMPTY_PAGE, copies: [accountCopy], cursor: 4, hasMore: false });

    await engine.firstSync("KEEP_LOCAL");

    expect((await store.listCopies()).map((c) => c.id)).toEqual(["local-1"]);
    expect((await store.getCopyIncludingDeleted("account-1"))?.deletedAt).not.toBeNull();
  });
});

describe("deletes stay deleted", () => {
  let store: MemoryStore;
  let engine: SyncEngine;
  let clock: ClockSource;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.open();
    clock = clockSource("device-a");
    engine = new SyncEngine(store, clock, transport);
    pull.mockReset();
    push.mockReset();
    push.mockResolvedValue({ ...EMPTY_PAGE });
  });

  it("does not resurrect a locally deleted copy that the server still has alive", async () => {
    // The regression that motivated getCopyIncludingDeleted: a tombstoned copy looked
    // absent, so the server's live version was adopted as if it were new.
    await store.cacheReleases([release]);
    const alive = createCopy(release, draft, clock, 1000, "copy-1");
    await store.putCopy(alive);
    await store.putCopy(tombstoneCopy(alive, clock, 5000));

    pull.mockResolvedValue({ ...EMPTY_PAGE, copies: [alive], cursor: 7, hasMore: false });
    await engine.sync();

    expect(await store.getCopy("copy-1")).toBeUndefined();
    expect((await store.getCopyIncludingDeleted("copy-1"))?.deletedAt).toBe(5000);
  });

  it("accepts a delete made on another device", async () => {
    await store.cacheReleases([release]);
    const alive = createCopy(release, draft, clock, 1000, "copy-1");
    await store.putCopy(alive);

    const deletedElsewhere = tombstoneCopy(alive, clockSource("device-z"), 9000);
    pull.mockResolvedValue({
      ...EMPTY_PAGE,
      copies: [deletedElsewhere],
      cursor: 7,
      hasMore: false,
    });
    await engine.sync();

    expect(await store.getCopy("copy-1")).toBeUndefined();
  });
});

describe("photo bytes this device does not hold", () => {
  beforeEach(() => {
    downloadPhoto.mockReset();
    fetchReleases.mockResolvedValue([]);
    push.mockResolvedValue(undefined);
  });

  function storedPhoto(id: string, storageKey: string | null) {
    const photo = createPhoto(
      { copyId: "copy-1", contentType: "image/jpeg", byteSize: 10, sortIndex: 0 },
      clockSource("a"),
      1000,
      id,
    );
    return { ...photo, storageKey };
  }

  it("fetches them for the whole collection, not just this pass's pull", async () => {
    // The bug this replaced: the sweep ran over the photos a pull returned, so a row that
    // arrived before its bytes existed — or whose download failed once — could never come
    // up again, because it cannot appear in a later pull.
    const store = new MemoryStore();
    await store.adoptPhoto(storedPhoto("photo-old", "user/photo-old"));
    pull.mockResolvedValue(EMPTY_PAGE);

    await new SyncEngine(store, clockSource("a"), transport).sync();

    expect(downloadPhoto).toHaveBeenCalledTimes(1);
    expect(downloadPhoto.mock.calls[0]?.[0]?.id).toBe("photo-old");
  });

  it("leaves alone what it already holds, and what has no bytes to fetch", async () => {
    const store = new MemoryStore();
    await store.adoptPhoto(storedPhoto("photo-here", "user/photo-here"));
    await store.putPhotoBytes("photo-here", new ArrayBuffer(4), "image/jpeg");
    // Never uploaded: its bytes are on this device and nowhere else, so there is nothing
    // to fetch and asking would 404 on every single sync.
    await store.adoptPhoto(storedPhoto("photo-local", null));
    pull.mockResolvedValue(EMPTY_PAGE);

    await new SyncEngine(store, clockSource("a"), transport).sync();

    expect(downloadPhoto).not.toHaveBeenCalled();
  });
});

describe("a photo that never uploaded", () => {
  beforeEach(() => {
    push.mockReset();
    pull.mockReset();
    fetchReleases.mockReset();
    fetchReleases.mockResolvedValue([]);
    pull.mockResolvedValue(EMPTY_PAGE);
    push.mockResolvedValue(EMPTY_PAGE);
    downloadPhoto.mockReset();
  });

  function unuploaded(id: string, deletedAt: number | null) {
    const photo = createPhoto(
      { copyId: "copy-1", contentType: "image/jpeg", byteSize: 10, sortIndex: 0 },
      clockSource("a"),
      1000,
      id,
    );
    return { ...photo, storageKey: null, deletedAt };
  }

  it("is dropped once deleted, instead of poisoning every later push", async () => {
    // The bug: this row was pushed because it is a tombstone, the server's storage_key was
    // NOT NULL, and push is one transaction — so it took every copy and wish in the batch
    // down with it. The client only clears pending on success, so the same doomed batch
    // came back a minute later, for days.
    const store = new MemoryStore();
    await store.putPhoto(unuploaded("photo-gone", 2000));
    await store.putWishlistItem(wish("wish-1"));

    await new SyncEngine(store, clockSource("a"), transport).sync();

    const [, wishes, photos] = push.mock.calls[0] ?? [];
    expect(photos).toEqual([]);
    expect(wishes?.map((item: { id: string }) => item.id)).toEqual(["wish-1"]);
    // Forgotten for good: there is nothing on the server to delete, because a photo only
    // gets there by being uploaded.
    expect(await store.readPendingIds()).toEqual([]);
  });

  it("stays pending while it is still live, so it goes up once the bytes land", async () => {
    const store = new MemoryStore();
    await store.putPhoto(unuploaded("photo-waiting", null));

    await new SyncEngine(store, clockSource("a"), transport).sync();

    expect(push).not.toHaveBeenCalled();
    expect(await store.readPendingIds()).toEqual(["photo-waiting"]);
  });
});

describe("a record written while the push is in flight", () => {
  beforeEach(() => {
    push.mockReset();
    pull.mockReset();
    fetchReleases.mockReset();
  });

  it("is kept pending rather than cleared with the batch", async () => {
    // Clearing the whole set on success threw this away, and nothing marks a record
    // pending twice: it lived on that device alone for ever while the UI showed it saved.
    const store = new MemoryStore();
    await store.putWishlistItem(wish("wish-early"));
    pull.mockResolvedValue(EMPTY_PAGE);
    fetchReleases.mockResolvedValue([]);
    push.mockImplementation(async () => {
      await store.putWishlistItem(wish("wish-mid-flight"));
      return EMPTY_PAGE;
    });

    await new SyncEngine(store, clockSource("a"), transport).sync();

    expect(await store.readPendingIds()).toEqual(["wish-mid-flight"]);
  });
});

describe("an upload the server refuses", () => {
  beforeEach(() => {
    uploadPhoto.mockReset();
    downloadPhoto.mockReset();
    pull.mockResolvedValue(EMPTY_PAGE);
    // A real answer, not undefined: once an upload succeeds the photo is marked and the
    // metadata push behind it actually runs.
    push.mockResolvedValue({ ...EMPTY_PAGE });
    fetchReleases.mockResolvedValue([]);
  });

  function pending(id: string) {
    const photo = createPhoto(
      { copyId: "copy-1", contentType: "image/jpeg", byteSize: 10, sortIndex: 0 },
      clockSource("a"),
      1000,
      id,
    );
    return { ...photo, storageKey: null };
  }

  async function withPending(ids: readonly string[]) {
    const store = new MemoryStore();
    for (const id of ids) {
      await store.adoptPhoto(pending(id));
      await store.putPhotoBytes(id, new ArrayBuffer(4), "image/jpeg");
    }
    return store;
  }

  it("remembers a full account, because that never fixes itself", async () => {
    const store = await withPending(["photo-1"]);
    uploadPhoto.mockRejectedValue(Object.assign(new Error("507"), { status: 507 }));

    await new SyncEngine(store, clockSource("a"), transport).sync();

    expect(await readUploadRefusal(store)).toMatchObject({ reason: "full", photoId: "photo-1" });
  });

  it("keeps quiet about being offline, which does", async () => {
    // The photo is kept and the next sync tries again. Saying anything here would be noise
    // about something that resolves on its own.
    const store = await withPending(["photo-1"]);
    uploadPhoto.mockRejectedValue(new TypeError("Failed to fetch"));

    await new SyncEngine(store, clockSource("a"), transport).sync();

    expect(await readUploadRefusal(store)).toBeNull();
  });

  it("names the first photo refused, not the last", async () => {
    // A full account refuses everything behind it for the same reason, and the last one is
    // a worse answer to "which photo is stuck" than the first.
    const store = await withPending(["photo-1", "photo-2"]);
    uploadPhoto.mockRejectedValue(Object.assign(new Error("507"), { status: 507 }));

    await new SyncEngine(store, clockSource("a"), transport).sync();

    expect((await readUploadRefusal(store))?.photoId).toBe("photo-1");
  });

  it("forgets it as soon as anything gets through", async () => {
    const store = await withPending(["photo-1"]);
    await writeUploadRefusal(store, { reason: "full", photoId: "photo-old", at: 1 });
    uploadPhoto.mockResolvedValue({ storageKey: "user/photo-1" });

    await new SyncEngine(store, clockSource("a"), transport).sync();

    expect(await readUploadRefusal(store)).toBeNull();
  });

  it("lets one success outrank a refusal seen in the same pass", async () => {
    // An account that just freed space can take some photos and still be full for the rest.
    // "Full" is only honest once nothing at all gets through, and this is what makes the
    // banner leave by itself.
    const store = await withPending(["photo-1", "photo-2"]);
    uploadPhoto
      .mockRejectedValueOnce(Object.assign(new Error("507"), { status: 507 }))
      .mockResolvedValueOnce({ storageKey: "user/photo-2" });

    await new SyncEngine(store, clockSource("a"), transport).sync();

    expect(await readUploadRefusal(store)).toBeNull();
  });
});
