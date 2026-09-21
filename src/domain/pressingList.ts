import type { Format, Release } from "./types.js";

/**
 * The pressings worth offering, in the order a collector reads them.
 *
 * Discogs answers `pressingsOf` in its own relevance order, which for a record as
 * catalogued as Nevermind puts a 2011 German DVD above every LP of it. Neither half of
 * what the list needs comes for free:
 *
 * **Filtered by format**, because the chips above the list are the same question the list
 * answers. Someone who has said "vinyl" is not choosing between cassettes, and leaving
 * them in means the one row they want is eight rows down.
 *
 * **Sorted by year, oldest first**, because that is the order pressings happened in and
 * the first pressing is the one people most often mean. A pressing with no year sinks to
 * the bottom rather than sorting as year zero, which would put the least identifiable rows
 * at the top of a list whose whole job is identification.
 */
export function pressingList(
  releases: readonly Release[],
  format: Format | null,
): readonly Release[] {
  const matching = format === null ? releases : releases.filter((r) => r.format === format);
  return [...matching].sort(byYearThenCountry);
}

function byYearThenCountry(a: Release, b: Release): number {
  if (a.year !== b.year) {
    // Undated last: "1991 · US" identifies a record and a bare country does not.
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return a.year - b.year;
  }
  // Two pressings of the same year are told apart by where they were pressed, so ordering
  // them by it keeps a re-render from shuffling rows the reader is looking at.
  return (a.country ?? "").localeCompare(b.country ?? "");
}
