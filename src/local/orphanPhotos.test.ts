import { beforeEach, describe, expect, it } from "vitest";
import { hlcInitial, hlcTick } from "../domain/hlc.js";
import type { Release } from "../domain/types.js";
import { MemoryStore } from "../testing/MemoryStore.js";
import { type ClockSource, createCopy, tombstoneCopy } from "./copyWrites.js";
import { ORPHAN_PHOTO_GRACE_MS, sweepOrphanPhotos } from "./orphanPhotos.js";
import { type PhotoOwner, createPhoto } from "./photoWrites.js";
import { createWishlistItem, tombstoneWishlistItem } from "./wishWrites.js";

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

const draft = {
  condition: null,
  sleeveCondition: null,
  catalogArt: "AUTO" as const,
  pricePaidCents: null,
  currency: "EUR",
  purchasedOn: null,
  purchasedAt: null,
  notes: null,
  rating: null,
};

const NOW = 10_000_000;

describe("sweepOrphanPhotos", () => {
  let store: MemoryStore;
  let clock: ClockSource;

  beforeEach(() => {
    store = new MemoryStore();
    clock = clockSource("device-a");
  });

  async function photo(id: string, owner: PhotoOwner) {
    const created = createPhoto(
      { ...owner, contentType: "image/jpeg", byteSize: 1200, sortIndex: 0 },
      clock,
      1000,
      id,
    );
    await store.putPhoto(created);
    await store.putPhotoBytes(id, new ArrayBuffer(4), "image/jpeg");
    return created;
  }

  async function copyRemovedAt(id: string, at: number | null) {
    const copy = createCopy(release, draft, clock, 1000, id);
    await store.putCopy(at === null ? copy : tombstoneCopy(copy, clock, at));
  }

  async function wishRemovedAt(id: string, at: number | null) {
    const wish = createWishlistItem(
      {
        albumId: "group-1",
        releaseId: null,
        title: "Bitches Brew",
        artistName: "Miles Davis",
        year: 1970,
        desiredFormat: null,
        note: null,
      },
      clock,
      1000,
      id,
    );
    await store.putWishlistItem(at === null ? wish : tombstoneWishlistItem(wish, clock, at));
  }

  it("puts down the photos of a copy removed longer ago than the grace", async () => {
    await copyRemovedAt("copy-1", NOW - ORPHAN_PHOTO_GRACE_MS - 1);
    const before = await photo("photo-1", { copyId: "copy-1" });
    await photo("photo-2", { copyId: "copy-1" });
    await store.writePendingIds([]);

    expect(await sweepOrphanPhotos(store, clock, NOW)).toBe(2);

    const swept = await store.getPhotoIncludingDeleted("photo-1");
    expect(swept?.deletedAt).toBe(NOW);
    // Stamped, or the tombstone would lose the merge and the photo would come back.
    expect(swept?.fieldClocks.deletedAt).not.toBe(before.fieldClocks.deletedAt);
    expect(await store.readPendingIds()).toEqual(expect.arrayContaining(["photo-1", "photo-2"]));
    expect(await store.hasPhotoBytes("photo-1")).toBe(false);
  });

  it("puts down a removed wish's picture the same way", async () => {
    await wishRemovedAt("wish-1", NOW - ORPHAN_PHOTO_GRACE_MS);
    await photo("picture-1", { wishId: "wish-1" });

    expect(await sweepOrphanPhotos(store, clock, NOW)).toBe(1);
    expect((await store.getPhotoIncludingDeleted("picture-1"))?.deletedAt).toBe(NOW);
  });

  it("leaves a record removed inside the grace alone, so Undo still brings its photos back", async () => {
    await copyRemovedAt("copy-1", NOW - 5_000);
    await wishRemovedAt("wish-1", NOW - 5_000);
    await photo("photo-1", { copyId: "copy-1" });
    await photo("picture-1", { wishId: "wish-1" });

    expect(await sweepOrphanPhotos(store, clock, NOW)).toBe(0);
    expect((await store.getPhotoIncludingDeleted("photo-1"))?.deletedAt).toBeNull();
    expect(await store.hasPhotoBytes("picture-1")).toBe(true);
  });

  it("never touches the photos of a record that is still there", async () => {
    await copyRemovedAt("copy-1", null);
    await wishRemovedAt("wish-1", null);
    await photo("photo-1", { copyId: "copy-1" });
    await photo("picture-1", { wishId: "wish-1" });

    expect(await sweepOrphanPhotos(store, clock, NOW)).toBe(0);
  });

  it("leaves a photo alone when this device has never seen its owner", async () => {
    await photo("photo-1", { copyId: "copy-not-pulled-yet" });

    expect(await sweepOrphanPhotos(store, clock, NOW)).toBe(0);
    expect((await store.getPhotoIncludingDeleted("photo-1"))?.deletedAt).toBeNull();
  });
});
