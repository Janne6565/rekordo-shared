/**
 * The shelf's own ordering rules.
 *
 * The wishlist has had a hand-built order since design turn 16; the shelf has not, and
 * every screen that showed copies showed them newest-first because that is the only order
 * anybody had ever written down. These are the decisions both clients have to make
 * identically once a shelf can be arranged: which orders exist, what a drag writes, and
 * where a record filed since the last arranging belongs.
 *
 * Deliberately the same shape as `wishlist.ts`, down to the function names -- the two
 * lists are dragged with the same gesture and a person who arranges one has learnt how the
 * other behaves. Where the two differ it is because a shelf differs from a want list, and
 * the difference is written down at the place it happens.
 */

import type { Copy } from "./types.js";

/**
 * How a shelf is ordered.
 *
 * `MANUAL` is not offered in a menu until at least one record has been dragged, for the
 * same reason the wishlist's is not: it is the order *you* built, and picking it before it
 * exists would sort by nothing.
 */
export const LIBRARY_SORTS = ["ADDED_DESC", "ARTIST_ASC", "YEAR_DESC", "MANUAL"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const DEFAULT_LIBRARY_SORT: LibrarySort = "ADDED_DESC";

/** The orders a menu offers: everything but the one only a drag can produce. */
export const CHOOSABLE_LIBRARY_SORTS: readonly LibrarySort[] = [
  "ADDED_DESC",
  "ARTIST_ASC",
  "YEAR_DESC",
];

export function parseLibrarySort(raw: string | undefined): LibrarySort {
  return (LIBRARY_SORTS as readonly string[]).includes(raw ?? "")
    ? (raw as LibrarySort)
    : DEFAULT_LIBRARY_SORT;
}

/**
 * Which of two hand-placed copies comes first.
 *
 * Exported because both stores order by this in SQL/IndexedDB rather than in memory -- a
 * shelf is thousands of rows where a wishlist is dozens -- and two hand-written orderings
 * that are meant to agree are two orderings that will eventually stop agreeing. The stores
 * are tested against this function.
 *
 * Unplaced copies (`sortIndex === null`) sort last, newest first among themselves.
 */
export function compareManualOrder(
  a: Pick<Copy, "sortIndex" | "createdAt">,
  b: Pick<Copy, "sortIndex" | "createdAt">,
): number {
  if (a.sortIndex === null && b.sortIndex === null) return b.createdAt - a.createdAt;
  if (a.sortIndex === null) return 1;
  if (b.sortIndex === null) return -1;
  return a.sortIndex - b.sortIndex;
}

/**
 * True once at least one record has been dragged, which is when "Your order" becomes a
 * thing a menu can offer.
 *
 * Named apart from the wishlist's `hasManualOrder` rather than shared with it: both are
 * one-line predicates over `sortIndex`, and a single exported name would have to widen to
 * cover two row types that have nothing else in common.
 */
export function hasArrangedOrder(copies: readonly Pick<Copy, "sortIndex">[]): boolean {
  return copies.some((copy) => copy.sortIndex !== null);
}

/** The list with one record lifted out and set down at another position. */
export function moveCopy<T>(ordered: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) {
    return ordered;
  }
  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/**
 * The writes a drag produces: every copy whose position changed, renumbered densely from 0.
 *
 * The list handed in is *what was on screen* -- whatever sort the shelf happened to be in,
 * with the drag already applied. That is the whole of how a shelf becomes hand-arranged:
 * there is no separate "start arranging" step, because the order you were looking at when
 * you picked a record up is the order you meant to adjust. The first drag on a shelf sorted
 * by artist therefore writes an index to every copy, which is correct and not cheap -- it
 * is one row per record on the next sync push, so callers should write them in one
 * transaction.
 *
 * Renumbering the whole list rather than wedging a fractional index between two neighbours
 * is the same call the wishlist made, for the same reason: field-level last-write-wins
 * resolves fractional indices into an order neither person built, while a dense renumber
 * resolves into *one* of the two orders, which is a thing somebody meant.
 *
 * Filtered shelves are not passed here -- a position in a narrowed list means nothing in
 * the whole one, so the clients refuse the drag instead. See the callers.
 */
export function libraryOrderWrites<T extends Pick<Copy, "sortIndex">>(
  ordered: readonly T[],
): readonly { readonly copy: T; readonly sortIndex: number }[] {
  return ordered
    .map((copy, index) => ({ copy, sortIndex: index }))
    .filter(({ copy, sortIndex }) => copy.sortIndex !== sortIndex);
}

/**
 * Applies an order in memory. Never mutates the input.
 *
 * The stores do this in their own query language for the shelf itself; this exists for the
 * places that already hold rows and cannot go back to disk for them -- and as the
 * definition the store orderings are checked against.
 */
export function sortLibrary<T extends Pick<Copy, "sortIndex" | "createdAt">>(
  copies: readonly T[],
  sort: LibrarySort,
  facts: (copy: T) => { readonly artistName: string; readonly year: number | null },
): readonly T[] {
  const sorted = [...copies];
  switch (sort) {
    case "ADDED_DESC":
      return sorted.sort((a, b) => b.createdAt - a.createdAt);
    case "ARTIST_ASC":
      return sorted.sort(
        (a, b) =>
          facts(a).artistName.localeCompare(facts(b).artistName) || b.createdAt - a.createdAt,
      );
    case "YEAR_DESC":
      // A record with no year sorts last rather than as year zero, which is the same
      // promise the store's `COALESCE(...) DESC NULLS LAST` makes.
      return sorted.sort((a, b) => {
        const left = facts(a).year;
        const right = facts(b).year;
        if (left === null && right === null) return b.createdAt - a.createdAt;
        if (left === null) return 1;
        if (right === null) return -1;
        return right - left;
      });
    case "MANUAL":
      return sorted.sort(compareManualOrder);
  }
}
