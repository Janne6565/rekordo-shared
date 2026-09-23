import { describe, expect, it } from "vitest";
import type { Copy, Release, WishlistItem } from "./types.js";
import {
  asWishFormat,
  filterWishlist,
  hasManualOrder,
  manualOrderWrites,
  moveWish,
  parseWishSort,
  sortWishlist,
  wishSatisfiedBy,
  wishWantsFormat,
} from "./wishlist.js";

function wish(over: Partial<WishlistItem> & Pick<WishlistItem, "id">): WishlistItem {
  return {
    albumId: `album-${over.id}`,
    releaseId: null,
    pendingBarcode: null,
    title: "Ege Bamyasi",
    artistName: "Can",
    year: 1972,
    desiredFormat: "VINYL",
    note: null,
    sortIndex: null,
    createdAt: 0,
    deletedAt: null,
    fieldClocks: {} as WishlistItem["fieldClocks"],
    ...over,
  };
}

const ids = (items: readonly WishlistItem[]): string[] => items.map((item) => item.id);

describe("sortWishlist", () => {
  const a = wish({ id: "a", createdAt: 300, artistName: "Can", title: "Tago Mago" });
  const b = wish({ id: "b", createdAt: 100, artistName: "Aphex Twin", title: "Selected" });
  const c = wish({ id: "c", createdAt: 200, artistName: "Sun Ra", title: "Lanquidity" });
  const items = [a, b, c];

  it("defaults to newest first", () => {
    expect(ids(sortWishlist(items, "NEWEST"))).toEqual(["a", "c", "b"]);
    expect(ids(sortWishlist(items, "OLDEST"))).toEqual(["b", "c", "a"]);
  });

  it("sorts by artist, then title", () => {
    expect(ids(sortWishlist(items, "ARTIST"))).toEqual(["b", "a", "c"]);
    expect(ids(sortWishlist(items, "TITLE"))).toEqual(["c", "b", "a"]);
  });

  it("leaves the input untouched", () => {
    sortWishlist(items, "TITLE");
    expect(ids(items)).toEqual(["a", "b", "c"]);
  });

  it("puts entries added since the last drag before the placed ones, newest first", () => {
    const placed = [
      wish({ id: "one", sortIndex: 1 }),
      wish({ id: "zero", sortIndex: 0 }),
      wish({ id: "fresh", sortIndex: null, createdAt: 50 }),
      wish({ id: "fresher", sortIndex: null, createdAt: 80 }),
    ];
    expect(ids(sortWishlist(placed, "MANUAL"))).toEqual(["fresher", "fresh", "zero", "one"]);
  });
});

describe("parseWishSort", () => {
  it("falls back to newest first for anything it does not recognise", () => {
    expect(parseWishSort("TITLE")).toBe("TITLE");
    expect(parseWishSort(undefined)).toBe("NEWEST");
    expect(parseWishSort("by-vibes")).toBe("NEWEST");
  });
});

describe("hasManualOrder", () => {
  it("is true only once something has been dragged", () => {
    expect(hasManualOrder([wish({ id: "a" })])).toBe(false);
    expect(hasManualOrder([wish({ id: "a" }), wish({ id: "b", sortIndex: 0 })])).toBe(true);
  });
});

describe("moveWish and manualOrderWrites", () => {
  const ordered = [wish({ id: "a" }), wish({ id: "b" }), wish({ id: "c" })];

  it("lifts a row out and drops it at the new position", () => {
    expect(ids(moveWish(ordered, 2, 0))).toEqual(["c", "a", "b"]);
    expect(ids(moveWish(ordered, 0, 2))).toEqual(["b", "c", "a"]);
  });

  it("returns the list unchanged for a move that goes nowhere", () => {
    expect(moveWish(ordered, 1, 1)).toBe(ordered);
    expect(moveWish(ordered, 0, 9)).toBe(ordered);
  });

  it("renumbers the whole list densely from zero", () => {
    const writes = manualOrderWrites(moveWish(ordered, 2, 0));
    expect(writes.map((write) => [write.item.id, write.sortIndex])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("writes nothing for rows that are already where they say they are", () => {
    const placed = [wish({ id: "a", sortIndex: 0 }), wish({ id: "b", sortIndex: 1 })];
    expect(manualOrderWrites(placed)).toEqual([]);
  });
});

describe("wishWantsFormat", () => {
  it("matches only the format it named", () => {
    const vinyl = wish({ id: "a", desiredFormat: "VINYL" });
    expect(wishWantsFormat(vinyl, "VINYL")).toBe(true);
    // Buying the CD is not finding the vinyl press you were after.
    expect(wishWantsFormat(vinyl, "CD")).toBe(false);
  });

  it("matches everything when it named none", () => {
    const any = wish({ id: "a", desiredFormat: null });
    expect(wishWantsFormat(any, "CD")).toBe(true);
    expect(wishWantsFormat(any, "DIGITAL")).toBe(true);
  });
});

describe("asWishFormat", () => {
  it("keeps the three formats you can hunt for and calls everything else 'any'", () => {
    expect(asWishFormat("VINYL")).toBe("VINYL");
    expect(asWishFormat("CASSETTE")).toBe("CASSETTE");
    expect(asWishFormat("DIGITAL")).toBeNull();
    expect(asWishFormat("OTHER")).toBeNull();
    expect(asWishFormat(null)).toBeNull();
  });
});

describe("wishSatisfiedBy", () => {
  const release = { albumId: "album-a", format: "VINYL" } as Release;
  const copy = { manualFormat: null } as Copy;

  it("finds the entry for the album in the format that turned up", () => {
    const wishes = [wish({ id: "a", albumId: "album-a", desiredFormat: "VINYL" })];
    expect(wishSatisfiedBy(wishes, copy, release)?.id).toBe("a");
  });

  it("leaves an entry standing when the copy is the wrong format", () => {
    const wishes = [wish({ id: "a", albumId: "album-a", desiredFormat: "CD" })];
    expect(wishSatisfiedBy(wishes, copy, release)).toBeUndefined();
  });

  it("prefers the copy's own format over the catalogue's", () => {
    const wishes = [wish({ id: "a", albumId: "album-a", desiredFormat: "CASSETTE" })];
    const tape = { manualFormat: "CASSETTE" } as Copy;
    expect(wishSatisfiedBy(wishes, tape, release)?.id).toBe("a");
  });

  it("satisfies nothing when the copy has no release to match on", () => {
    const wishes = [wish({ id: "a", albumId: "album-a" })];
    expect(wishSatisfiedBy(wishes, copy, undefined)).toBeUndefined();
  });

  it("ignores entries that are already gone", () => {
    const wishes = [wish({ id: "a", albumId: "album-a", deletedAt: 5 })];
    expect(wishSatisfiedBy(wishes, copy, release)).toBeUndefined();
  });
});

describe("filterWishlist", () => {
  const a = wish({ id: "a", title: "Tago Mago", artistName: "Can", note: "green label" });
  const b = wish({ id: "b", title: "Selected Ambient Works", artistName: "Aphex Twin" });
  const items = [a, b];

  it("keeps everything when nothing is typed", () => {
    expect(filterWishlist(items, "")).toEqual(items);
    expect(filterWishlist(items, "   ")).toEqual(items);
  });

  it("matches the title and the artist, either case", () => {
    expect(ids(filterWishlist(items, "tago"))).toEqual(["a"]);
    expect(ids(filterWishlist(items, "APHEX"))).toEqual(["b"]);
  });

  it("matches the note, which is why the list has rows", () => {
    expect(ids(filterWishlist(items, "green label"))).toEqual(["a"]);
  });

  it("leaves an entry with no note alone rather than tripping over it", () => {
    expect(ids(filterWishlist(items, "ambient"))).toEqual(["b"]);
  });

  it("does not match the format somebody wants", () => {
    expect(filterWishlist(items, "vinyl")).toEqual([]);
  });
});
