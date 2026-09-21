import { describe, expect, it } from "vitest";
import { pressingList } from "./pressingList.js";
import type { Format, Release } from "./types.js";

/**
 * What Discogs answers, and what the step has to make of it.
 *
 * The order here is not cosmetic. Asked for the pressings of Nevermind, staging returns a
 * 2011 German DVD first and no vinyl at all in the top eight, because `pressingsOf`
 * answers in Discogs' own relevance order. A list in that order looks broken to anyone
 * holding the LP.
 */
describe("pressingList", () => {
  const release = (
    id: string,
    format: Format,
    year: number | null,
    country: string | null,
  ): Release => ({
    id,
    albumId: "discogs:204840",
    title: "Nevermind",
    artistName: "Nirvana",
    year,
    format,
    label: "DGC",
    catalogNumber: "DGC-24425",
    country,
    barcode: null,
    releaseDate: null,
    trackCount: null,
    discCount: null,
    coverArtUrl: null,
    coverTheme: null,
    cachedAt: 0,
  });

  /** Trimmed from the real staging answer, in the order it actually arrives. */
  const asDiscogsAnswers: readonly Release[] = [
    release("discogs:3214414", "CD", 2011, "Germany"),
    release("discogs:2", "CD", null, "US"),
    release("discogs:3", "CD", 2004, "Japan"),
    release("discogs:4", "CASSETTE", 1991, "Malaysia"),
    release("discogs:5", "VINYL", 2009, "US"),
    release("discogs:6", "VINYL", 1991, "US"),
    release("discogs:7", "VINYL", 1991, "DE"),
  ];

  it("keeps only the format the chips asked for", () => {
    // Someone who has said vinyl is not choosing between cassettes.
    expect(pressingList(asDiscogsAnswers, "VINYL").map((r) => r.id)).toEqual([
      "discogs:7",
      "discogs:6",
      "discogs:5",
    ]);
  });

  it("puts the first pressing first", () => {
    // Oldest first, because that is the order pressings happened in and the first one is
    // what people most often mean. Discogs put the 2009 reissue above both 1991s.
    expect(pressingList(asDiscogsAnswers, "VINYL").map((r) => r.year)).toEqual([1991, 1991, 2009]);
  });

  it("sinks an undated pressing rather than sorting it as year zero", () => {
    // "1991 · US" identifies a record; a bare country does not, so it is the last thing
    // worth offering rather than the first.
    expect(pressingList(asDiscogsAnswers, "CD").map((r) => r.year)).toEqual([2004, 2011, null]);
  });

  it("orders two pressings of one year by where they were pressed", () => {
    // Stable rather than arbitrary: without it a re-render can shuffle the two rows the
    // reader is currently looking at.
    expect(
      pressingList(asDiscogsAnswers, "VINYL")
        .slice(0, 2)
        .map((r) => r.country),
    ).toEqual(["DE", "US"]);
  });

  it("shows everything until a format is chosen", () => {
    expect(pressingList(asDiscogsAnswers, null)).toHaveLength(asDiscogsAnswers.length);
  });

  it("does not mutate what it was given", () => {
    // The array belongs to react-query's cache; sorting it in place would reorder the
    // cached answer under every other reader of it.
    const original = asDiscogsAnswers.map((r) => r.id);
    pressingList(asDiscogsAnswers, null);
    expect(asDiscogsAnswers.map((r) => r.id)).toEqual(original);
  });
});
