/**
 * The wishlist's own rules (design turn 16).
 *
 * An entry is a release plus three things — the format you want, an optional note, and the
 * date it went on. Everything below is a decision the two clients have to make identically:
 * which order the list is in, when an entry a new copy has satisfied should leave, and what
 * a drag does to the stored order. Drawing is each app's own; deciding is not.
 */

import { copyFormat } from "./copyFormat.js";
import type { Copy, Format, Release, WishlistItem } from "./types.js";

/**
 * The formats a wish can name, plus `null` for "any".
 *
 * Three, not five. `DIGITAL` and `OTHER` are formats a *copy* can be, but nobody hunts for
 * a download: a wishlist is a list you keep so you remember at the shop. A wish taken from
 * a release that is neither vinyl, CD nor tape becomes "any" rather than an unpickable
 * fourth chip.
 */
export const WISH_FORMATS = ["VINYL", "CD", "CASSETTE"] as const;
export type WishFormat = (typeof WISH_FORMATS)[number];

/** Narrows a release's format to something a wish can ask for; anything else means "any". */
export function asWishFormat(format: Format | null): WishFormat | null {
  return format !== null && (WISH_FORMATS as readonly string[]).includes(format)
    ? (format as WishFormat)
    : null;
}

/**
 * How the list is ordered.
 *
 * `MANUAL` is not offered until somebody drags a row — it is the order *they* built, so
 * picking it from a menu before it exists would sort by nothing.
 */
export const WISH_SORTS = ["NEWEST", "OLDEST", "ARTIST", "TITLE", "MANUAL"] as const;
export type WishSort = (typeof WISH_SORTS)[number];

export const DEFAULT_WISH_SORT: WishSort = "NEWEST";

/** The sorts a menu offers: everything but the one only a drag can produce. */
export const CHOOSABLE_WISH_SORTS: readonly WishSort[] = ["NEWEST", "OLDEST", "ARTIST", "TITLE"];

export function parseWishSort(raw: string | undefined): WishSort {
  return (WISH_SORTS as readonly string[]).includes(raw ?? "")
    ? (raw as WishSort)
    : DEFAULT_WISH_SORT;
}

const byTitle = (a: WishlistItem, b: WishlistItem): number =>
  a.title.localeCompare(b.title) || a.createdAt - b.createdAt;

/**
 * Applies a sort. Never mutates the input — both clients hand it a query result.
 *
 * Entries with no `sortIndex` sort *before* the placed ones under `MANUAL`, newest first
 * among themselves: something added since the last drag is new, and the top of the list is
 * where somebody who just added it looks for it. They used to go to the bottom, which on a
 * list of any length put a fresh wish below the fold. Only the comparator decides this --
 * nothing is written on add, so sync and the stored order are untouched, and the next drag
 * places the new entries wherever they then sit.
 */
export function sortWishlist(
  items: readonly WishlistItem[],
  sort: WishSort,
): readonly WishlistItem[] {
  const sorted = [...items];
  switch (sort) {
    case "NEWEST":
      return sorted.sort((a, b) => b.createdAt - a.createdAt);
    case "OLDEST":
      return sorted.sort((a, b) => a.createdAt - b.createdAt);
    case "ARTIST":
      return sorted.sort((a, b) => a.artistName.localeCompare(b.artistName) || byTitle(a, b));
    case "TITLE":
      return sorted.sort(byTitle);
    case "MANUAL":
      return sorted.sort((a, b) => {
        if (a.sortIndex === null && b.sortIndex === null) return b.createdAt - a.createdAt;
        if (a.sortIndex === null) return -1;
        if (b.sortIndex === null) return 1;
        return a.sortIndex - b.sortIndex;
      });
  }
}

/** True once at least one row has been dragged, which is when "Your order" becomes a thing. */
export function hasManualOrder(items: readonly WishlistItem[]): boolean {
  return items.some((item) => item.sortIndex !== null);
}

/** The list with one entry lifted out and dropped at another position. */
export function moveWish(
  ordered: readonly WishlistItem[],
  from: number,
  to: number,
): readonly WishlistItem[] {
  if (from === to || from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) {
    return ordered;
  }
  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as WishlistItem);
  return next;
}

/**
 * The writes a drag produces: every entry whose position changed, renumbered densely from 0.
 *
 * Renumbering the whole list rather than wedging one fractional index between two
 * neighbours keeps the values meaningful when two devices drag at once. Field-level
 * last-write-wins would resolve fractional indices into an order neither person built; a
 * dense renumber resolves into *one* of the two orders, which is a thing somebody meant.
 */
export function manualOrderWrites(
  ordered: readonly WishlistItem[],
): readonly { readonly item: WishlistItem; readonly sortIndex: number }[] {
  return ordered
    .map((item, index) => ({ item, sortIndex: index }))
    .filter(({ item, sortIndex }) => item.sortIndex !== sortIndex);
}

/**
 * Whether a wish is asking for the format a copy turned out to be.
 *
 * "Any" matches every format — that is the whole of what the word promises, and a list
 * that kept an entry you had explicitly marked as format-agnostic after you filed the
 * record would be a list nobody trusts to empty itself. A named format matches only
 * itself: wanting *Ege Bamyasi* on vinyl is not satisfied by buying the CD, and the design
 * leaves the entry standing so you can keep hunting for the press you actually wanted.
 */
export function wishWantsFormat(wish: WishlistItem, format: Format): boolean {
  return wish.desiredFormat === null || wish.desiredFormat === format;
}

/**
 * The entry a newly-filed copy has just satisfied, if any.
 *
 * Matched on the album and the format, never on the copy's identity: a wish points at the
 * record, and which pressing settled it is not something the entry ever claimed to know.
 * A hand-entered copy (`local:` release id) satisfies nothing — it has no album to match.
 *
 * Takes only the part of a copy it reads, so a caller that is about to *make* one can ask
 * the same question of the same function: the scan review says "was on your wishlist" on a
 * row before it is written, and a second, nearly-identical predicate for that is how the
 * row and the write start disagreeing.
 */
export function wishSatisfiedBy(
  wishes: readonly WishlistItem[],
  copy: Pick<Copy, "manualFormat">,
  release: Release | undefined,
): WishlistItem | undefined {
  if (release === undefined) return undefined;
  const format = copyFormat(copy, release);
  return wishes.find(
    (wish) =>
      wish.deletedAt === null && wish.albumId === release.albumId && wishWantsFormat(wish, format),
  );
}

/**
 * The list narrowed to the entries a typed term names.
 *
 * Matched on the title, the artist and the note — the three things the row actually shows.
 * The note is in there because it is the reason the wishlist is a list of rows rather than
 * a wall of sleeves: "original Spoon press, green label" is what somebody remembers about
 * an entry, so it has to be a thing they can type.
 *
 * One substring over the three joined, which is what the library's search does. The two
 * boxes look the same and sit in the same app, so a term that finds a record on one shelf
 * and not the other would read as one of them being broken.
 *
 * The format is deliberately not searchable: "vinyl" is a chip's job, not a word to type,
 * and folding it in would have every entry match the moment somebody types "c".
 */
export function filterWishlist(
  items: readonly WishlistItem[],
  term: string,
): readonly WishlistItem[] {
  const needle = term.trim().toLowerCase();
  if (needle === "") return items;
  return items.filter((item) =>
    [item.title, item.artistName, item.note]
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}
