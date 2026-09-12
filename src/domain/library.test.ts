import { describe, expect, it } from "vitest";
import {
  CHOOSABLE_LIBRARY_SORTS,
  compareManualOrder,
  hasArrangedOrder,
  libraryOrderWrites,
  moveCopy,
  parseLibrarySort,
  sortLibrary,
} from "./library.js";

/** Only the parts of a copy the ordering rules read. */
function copy(
  sortIndex: number | null,
  createdAt: number,
  artistName = "",
  year: number | null = null,
) {
  return { id: `${artistName}-${createdAt}`, sortIndex, createdAt, artistName, year };
}

const facts = (row: ReturnType<typeof copy>) => ({ artistName: row.artistName, year: row.year });

describe("parseLibrarySort", () => {
  it("accepts every sort, MANUAL included — a stored order has to survive a restart", () => {
    expect(parseLibrarySort("MANUAL")).toBe("MANUAL");
    expect(parseLibrarySort("ARTIST_ASC")).toBe("ARTIST_ASC");
  });

  it("falls back to newest-first on anything it does not recognise", () => {
    expect(parseLibrarySort(undefined)).toBe("ADDED_DESC");
    expect(parseLibrarySort("BY_COLOUR")).toBe("ADDED_DESC");
  });

  it("does not offer MANUAL in a menu", () => {
    expect(CHOOSABLE_LIBRARY_SORTS).not.toContain("MANUAL");
  });
});

describe("compareManualOrder", () => {
  it("places a copy that has never been dragged after every one that has", () => {
    const placed = copy(9, 1000);
    const unplaced = copy(null, 9000);
    expect([unplaced, placed].sort(compareManualOrder)).toEqual([placed, unplaced]);
  });

  it("orders two unplaced copies newest first, so a new record surfaces", () => {
    const older = copy(null, 1000);
    const newer = copy(null, 2000);
    expect([older, newer].sort(compareManualOrder)).toEqual([newer, older]);
  });
});

describe("hasArrangedOrder", () => {
  it("is false until something has been dragged", () => {
    expect(hasArrangedOrder([copy(null, 1), copy(null, 2)])).toBe(false);
    expect(hasArrangedOrder([copy(null, 1), copy(0, 2)])).toBe(true);
  });
});

describe("moveCopy", () => {
  it("lifts one out and sets it down at the target index", () => {
    expect(moveCopy(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveCopy(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns the list untouched for a move that goes nowhere or out of bounds", () => {
    const list = ["a", "b"];
    expect(moveCopy(list, 1, 1)).toBe(list);
    expect(moveCopy(list, 0, 5)).toBe(list);
    expect(moveCopy(list, -1, 0)).toBe(list);
  });
});

describe("libraryOrderWrites", () => {
  it("renumbers the shown order densely from zero", () => {
    const writes = libraryOrderWrites([copy(null, 3), copy(null, 2), copy(null, 1)]);
    expect(writes.map((write) => write.sortIndex)).toEqual([0, 1, 2]);
  });

  it("writes nothing for the copies that were already where they ended up", () => {
    const writes = libraryOrderWrites([copy(0, 1), copy(5, 2), copy(2, 3)]);
    // Only the middle one moved: index 0 and index 2 already held those values.
    expect(writes).toHaveLength(1);
    expect(writes[0]?.sortIndex).toBe(1);
  });

  it("is idempotent — arranging an arranged shelf writes nothing at all", () => {
    const arranged = [copy(0, 1), copy(1, 2), copy(2, 3)];
    expect(libraryOrderWrites(arranged)).toEqual([]);
  });
});

describe("sortLibrary", () => {
  const a = copy(2, 100, "Can", 1972);
  const b = copy(0, 300, "Aphex Twin", null);
  const c = copy(1, 200, "Broadcast", 1996);

  it("orders newest first by default", () => {
    expect(sortLibrary([a, b, c], "ADDED_DESC", facts)).toEqual([b, c, a]);
  });

  it("orders by artist, newest first within one artist", () => {
    expect(sortLibrary([a, b, c], "ARTIST_ASC", facts)).toEqual([b, c, a]);
  });

  it("puts a record with no year last rather than treating it as year zero", () => {
    expect(sortLibrary([a, b, c], "YEAR_DESC", facts)).toEqual([c, a, b]);
  });

  it("follows the hand-built order when there is one", () => {
    expect(sortLibrary([a, b, c], "MANUAL", facts)).toEqual([b, c, a]);
  });

  it("never mutates what it was handed", () => {
    const given = [a, b, c];
    sortLibrary(given, "MANUAL", facts);
    expect(given).toEqual([a, b, c]);
  });
});
