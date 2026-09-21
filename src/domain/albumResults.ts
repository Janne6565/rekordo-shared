import type { Album } from "./types.js";

/**
 * A record, with the other editions of it folded underneath.
 *
 * `editions` is empty for most records. When it is not, `album` is the plainest of the
 * group and the rest are refinements of it, each keeping its full title so a screen can
 * name it by {@link editionLabel}.
 */
export interface RecordGroup {
  readonly album: Album;
  readonly editions: readonly Album[];
}

/** What a search answers: records first, singles and EPs kept apart. */
export interface AlbumResults {
  readonly records: readonly RecordGroup[];
  readonly singles: readonly Album[];
}

/**
 * Splits and folds a search answer into what the results list draws.
 *
 * Two problems, both of which arrive as text rather than as fields.
 *
 * **Editions.** Apple lists "Nevermind", "Nevermind (Deluxe Edition)", "Nevermind (Super
 * Deluxe Edition)" and "Nevermind (30th Anniversary Super Deluxe)" as four separate
 * albums. They are one record. Folding them leaves one row with a count you can open,
 * which is the same complaint the album-first search was built to answer -- ten identical
 * pressings became four near-identical editions, one layer up.
 *
 * **Singles and EPs.** A title search drowns in them: "if you leave" returns the record
 * once and then four unrelated covers, every one suffixed "- Single". There is no type
 * field to sort on, because Apple sends `primaryType` as null for every row; the only
 * signal is that literal text. So it is read from the title, and only in the forms Apple
 * actually writes.
 *
 * Order is preserved throughout -- Apple's relevance ranking is the best signal there is
 * about which record was meant, and nothing here is in a position to improve on it.
 */
export function albumResults(albums: readonly Album[]): AlbumResults {
  const records: Album[] = [];
  const singles: Album[] = [];
  for (const album of albums) {
    (isSingleOrEp(album.title) ? singles : records).push(album);
  }
  return { records: foldEditions(records), singles };
}

/**
 * Groups records that differ only by a parenthetical or bracketed suffix.
 *
 * An edition attaches to whichever record in the same answer its own title becomes once
 * the trailing bracket is removed. Matching against the other rows, rather than against a
 * stripped stem, is what keeps two things right at once: "The Complete Bitches Brew
 * Sessions" is a different title rather than a suffix, so it stays its own row; and a
 * record that is itself parenthetical can still be a parent, so "1989 (Taylor's Version)
 * [Deluxe]" hangs off "1989 (Taylor's Version)" rather than off a bare "1989" that was
 * never returned.
 *
 * Titles are compared case- and punctuation-insensitively, because Apple is inconsistent
 * about both, and the artist has to match as well: "Bitches Brew" by Miles Davis and
 * "Bitches Brew" by Inspiral Carpets share a title and nothing else, and folding one into
 * the other would hide a record behind an unrelated one.
 *
 * When no plain record is in the answer at all, the editions stay separate rather than
 * one of them being promoted to stand for the rest.
 */
function foldEditions(albums: readonly Album[]): RecordGroup[] {
  // Every record in the answer, by its own full title. An edition attaches to whichever
  // of these its title becomes once the trailing bracket is removed, so a record that is
  // itself parenthetical can still be a parent: "1989 (Taylor's Version) [Deluxe]" hangs
  // off "1989 (Taylor's Version)" rather than off a bare "1989" that was never returned.
  const byTitle = new Map<string, Album>();
  for (const album of albums) {
    const key = titleKey(album, normalise(album.title));
    if (!byTitle.has(key)) {
      byTitle.set(key, album);
    }
  }

  const groups = new Map<string, { album: Album; editions: Album[] }>();
  const order: string[] = [];
  for (const album of albums) {
    const parent = byTitle.get(titleKey(album, baseTitle(album.title)));
    // Keyed by whichever record heads the group, never by the row's own id: a record with
    // no parent of its own still has to answer to the same key its editions look it up by,
    // or the two arrive in separate groups and nothing folds.
    const head = parent ?? album;
    const key = titleKey(head, normalise(head.title));
    let group = groups.get(key);
    if (group === undefined) {
      group = { album: head, editions: [] };
      groups.set(key, group);
      order.push(key);
    }
    if (parent !== undefined && parent !== album) {
      group.editions.push(album);
    }
  }
  return order.map((key) => {
    const group = groups.get(key) as { album: Album; editions: Album[] };
    return { album: group.album, editions: group.editions };
  });
}

/**
 * Artist plus an already-normalised title.
 *
 * The artist is part of it because "Bitches Brew" by Miles Davis and "Bitches Brew" by
 * Inspiral Carpets share a title and nothing else; folding one into the other would hide
 * a record behind an unrelated one. Joined on a character no title contains, so an artist
 * ending where a title begins cannot collide.
 */
function titleKey(album: Album, title: string): string {
  return `${normalise(album.artistName)}\u0000${title}`;
}

/**
 * How an edition is named once its record is already on the row above it.
 *
 * "Nevermind (Deluxe Edition)" under "Nevermind" reads as "Deluxe Edition": repeating the
 * record's own name in every child is noise, and what the reader is choosing between is
 * exactly the part that differs. Falls back to the full title when the suffix cannot be
 * lifted out, which is better than an empty row.
 */
export function editionLabel(edition: Album): string {
  const match = edition.title.match(SUFFIX);
  const inner = match?.[1]?.trim();
  return inner !== undefined && inner.length > 0 ? inner : edition.title;
}

/**
 * Whether a title says, in Apple's own words, that it is not an album.
 *
 * Only the shapes Apple actually writes: a trailing " - Single" or " - EP", or a title
 * ending in "EP" as a word ("The Wild Youth EP"). Anything looser starts eating records --
 * "Ep" occurs inside ordinary words, and a record whose title merely contains "single"
 * belongs with the albums.
 */
export function isSingleOrEp(title: string): boolean {
  return /\s[-–]\s(single|ep)\s*$/i.test(title) || /\sEP$/.test(title.trim());
}

/** The trailing "(…)" or "[…]" an edition is named by. */
const SUFFIX = /[([]([^)\]]+)[)\]]\s*$/;

/** The title with any trailing bracketed suffix removed, normalised for comparison. */
function baseTitle(title: string): string {
  return normalise(title.replace(SUFFIX, ""));
}

/**
 * Case, punctuation and spacing folded away.
 *
 * Apple sends "1989 (Taylor's Version) [Deluxe]" and "THE TORTURED POETS DEPARTMENT" in
 * the same answer; comparing either literally would split records that are the same and
 * is the kind of thing that only shows up on somebody else's shelf.
 */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}
