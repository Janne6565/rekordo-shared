import { describe, expect, it } from "vitest";

import { albumResults, editionLabel, isSingleOrEp } from "./albumResults.js";
import type { Album } from "./types.js";

/**
 * The two kinds of noise a record search comes back with.
 *
 * Both arrive as text rather than as fields, which is why this is worth pinning: Apple
 * sends `primaryType` as null on every row, so "- Single" in the title is the only signal
 * there is, and four editions of Nevermind are four unrelated albums as far as the API is
 * concerned. Getting either wrong does not fail; it quietly reinstates the complaint the
 * album-first search exists to answer.
 */
describe("albumResults", () => {
  const album = (title: string, artistName: string, year: number | null = 1970): Album => ({
    albumId: `applemusic:${title}:${artistName}`,
    title,
    artistName,
    year,
    primaryType: null,
    coverArtUrl: null,
    coverArtTemplate: null,
  });

  it("folds the editions of one record into it", () => {
    // The real answer for "nirvana nevermind": four rows that read the same.
    const { records } = albumResults([
      album("Nevermind", "Nirvana", 1991),
      album("Nevermind (Super Deluxe Edition)", "Nirvana", 1991),
      album("Nevermind (30th Anniversary Super Deluxe)", "Nirvana", 1991),
      album("Nevermind (Deluxe Edition)", "Nirvana", 1991),
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]?.album.title).toBe("Nevermind");
    expect(records[0]?.editions.map((e) => e.title)).toEqual([
      "Nevermind (Super Deluxe Edition)",
      "Nevermind (30th Anniversary Super Deluxe)",
      "Nevermind (Deluxe Edition)",
    ]);
  });

  it("keeps a record whose title merely starts the same", () => {
    // "The Complete Bitches Brew Sessions" is a different record, not an edition of one.
    const { records } = albumResults([
      album("Bitches Brew", "Miles Davis"),
      album("Bitches Brew (Legacy Edition)", "Miles Davis"),
      album("The Complete Bitches Brew Sessions", "Miles Davis"),
    ]);

    expect(records.map((r) => r.album.title)).toEqual([
      "Bitches Brew",
      "The Complete Bitches Brew Sessions",
    ]);
    expect(records[0]?.editions).toHaveLength(1);
  });

  it("never folds two artists together", () => {
    // Same title, unrelated records. Folding would hide one behind the other.
    const { records } = albumResults([
      album("Bitches Brew", "Miles Davis", 1970),
      album("Bitches Brew", "Inspiral Carpets", 1992),
    ]);

    expect(records).toHaveLength(2);
    expect(records.every((r) => r.editions.length === 0)).toBe(true);
  });

  it("leaves editions alone when the plain record is not in the answer", () => {
    // Promoting one of them would put a row on screen claiming to be the record itself.
    const { records } = albumResults([
      album("Homework (Deluxe)", "Daft Punk"),
      album("Homework (Remixes)", "Daft Punk"),
    ]);

    expect(records).toHaveLength(2);
  });

  it("ignores case and punctuation when deciding what is the same record", () => {
    const { records } = albumResults([
      album("1989 (Taylor's Version)", "Taylor Swift"),
      album("1989 (Taylor’s Version) [Deluxe]", "Taylor Swift"),
    ]);

    // The curly apostrophe and the second bracket must not split the record.
    expect(records).toHaveLength(1);
    expect(records[0]?.editions).toHaveLength(1);
  });

  it("keeps singles and EPs out of the records block", () => {
    // "if you leave": the record once, then four covers by people you have not heard of.
    const { records, singles } = albumResults([
      album("If You Leave", "Daughter", 2013),
      album("If You Leave - Single", "Elysia Vale", 2026),
      album("If You Leave - Single", "Sky McCreery", 2020),
      album("The Wild Youth EP", "Daughter", 2011),
    ]);

    expect(records.map((r) => r.album.artistName)).toEqual(["Daughter"]);
    expect(singles).toHaveLength(3);
  });

  it("keeps Apple's own order", () => {
    // Relevance is the best signal about which record was meant, and nothing here is in a
    // position to improve on it.
    const { records } = albumResults([
      album("Syro", "Aphex Twin", 2014),
      album("Drukqs", "Aphex Twin", 2001),
      album("Come to Daddy", "Aphex Twin", 1997),
    ]);

    expect(records.map((r) => r.album.title)).toEqual(["Syro", "Drukqs", "Come to Daddy"]);
  });

  it("survives an empty answer", () => {
    expect(albumResults([])).toEqual({ records: [], singles: [] });
  });
});

describe("editionLabel", () => {
  const edition = (title: string): Album => ({
    albumId: "applemusic:1",
    title,
    artistName: "Nirvana",
    year: 1991,
    primaryType: null,
    coverArtUrl: null,
    coverArtTemplate: null,
  });

  it("names an edition by what makes it different", () => {
    // Under a row that already says "Nevermind", repeating it is noise.
    expect(editionLabel(edition("Nevermind (Deluxe Edition)"))).toBe("Deluxe Edition");
    expect(editionLabel(edition("1989 [Deluxe]"))).toBe("Deluxe");
  });

  it("falls back to the whole title rather than rendering an empty row", () => {
    expect(editionLabel(edition("Nevermind"))).toBe("Nevermind");
    expect(editionLabel(edition("Nevermind ()"))).toBe("Nevermind ()");
  });
});

describe("isSingleOrEp", () => {
  it("reads the forms Apple actually writes", () => {
    expect(isSingleOrEp("If You Leave - Single")).toBe(true);
    expect(isSingleOrEp("His Young Heart - EP")).toBe(true);
    expect(isSingleOrEp("The Wild Youth EP")).toBe(true);
  });

  it("does not eat records that merely contain the words", () => {
    // A looser rule starts hiding albums, which is worse than showing a single.
    expect(isSingleOrEp("Single Mothers")).toBe(false);
    expect(isSingleOrEp("Epic")).toBe(false);
    expect(isSingleOrEp("Nevermind")).toBe(false);
  });
});
