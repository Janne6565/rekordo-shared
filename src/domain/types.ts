/**
 * The domain the app stores locally.
 *
 * Three levels, mirroring MusicBrainz and the design deck's screens:
 *
 *   ReleaseGroup  the album            Bitches Brew
 *   Release       a specific edition   Columbia GP 26, 2xLP, US, 1970
 *   Copy          the item you own     VG+, EUR 28, Concerto Amsterdam, 14 Aug 2026
 *
 * `Release` rows are a cache of what the metadata proxy returned. `Copy` and
 * `WishlistItem` are the user's own data — the only records that ever sync.
 */

export const FORMATS = ["VINYL", "CD", "CASSETTE", "DIGITAL", "OTHER"] as const;
export type Format = (typeof FORMATS)[number];

/**
 * What a copy has said about the release's own cover art.
 *
 *   AUTO       nothing said — the copy's first photo wins, and the catalogue art stands in
 *              where it has none
 *   PREFERRED  the catalogue art is the preview, even though the copy has photos
 *   HIDDEN     the catalogue art is not one of this copy's images at all
 *
 * `HIDDEN` is per copy, not per release: the artwork the archive holds for a pressing can
 * be the wrong cover, or a cover you simply do not want on your shelf, and neither is a
 * claim about the pressing that other people's copies should inherit.
 */
export const CATALOG_ART_CHOICES = ["AUTO", "PREFERRED", "HIDDEN"] as const;
export type CatalogArtChoice = (typeof CATALOG_ART_CHOICES)[number];

/** The Goldmine grading scale, which screen 1l names as the default. */
export const CONDITIONS = ["M", "NM", "VG_PLUS", "VG", "G_PLUS", "G", "F", "P"] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface CoverTheme {
  readonly dominantColor: string;
  readonly accentColor: string;
  /**
   * Perceptual lightness (CIE L*), normalised to 0..1 — not WCAG relative luminance,
   * which is linear light and would put mid-grey at 0.22.
   */
  readonly lightness: number;
  /** Precomputed by the server so the theme is right on first paint, before the image loads. */
  readonly dark: boolean;
}

/**
 * A person or group, as the search offers them (screens 10a/10b).
 *
 * `disambiguation` is load-bearing, not decoration: MusicBrainz holds several distinct
 * artists called "Daughter", and that one line ("UK indie folk band fronted by Elena
 * Tonra") is frequently the only thing separating them in a list.
 */
export interface Artist {
  readonly mbid: string;
  readonly name: string;
  /** Empty rather than null when the archive has none, so no caller has to guard it. */
  readonly disambiguation: string;
  /** "Group" or "Person" as MusicBrainz classifies it, when it knows. */
  readonly type: string | null;
  readonly country: string | null;
  readonly beganIn: string | null;
  readonly endedIn: string | null;
  /** MusicBrainz's own match confidence, 0-100. An exact name scores 100. */
  readonly score: number | null;
}

/**
 * A release group — the album, above the pressings of it.
 *
 * A discography lists these rather than releases because listing it by pressing is
 * unreadable: Miles Davis has 51 albums and over 1400 releases, and Bitches Brew alone
 * accounts for 47 of them.
 */
export interface Album {
  readonly albumId: string;
  readonly title: string;
  readonly artistName: string;
  readonly year: number | null;
  /** Album, EP, Single, Broadcast, Compilation — how the artist screen sections itself. */
  readonly primaryType: string | null;
  readonly coverArtUrl: string | null;
}

export interface Release {
  /**
   * Source-qualified: "musicbrainz:<uuid>" or "discogs:<int>".
   *
   * The app reads two catalogues and they share no identifiers, so an id has to say where
   * it came from. Source and id are one value rather than two fields on purpose — see the
   * note on Copy.releaseId.
   */
  readonly id: string;
  /** The album this is a pressing of, source-qualified the same way. */
  readonly albumId: string;
  readonly title: string;
  readonly artistName: string;
  readonly year: number | null;
  readonly format: Format;
  readonly label: string | null;
  readonly catalogNumber: string | null;
  readonly country: string | null;
  readonly barcode: string | null;
  /** Partial dates are normal: "1970", "1970-03" and "1970-03-30" all occur. */
  readonly releaseDate: string | null;
  readonly trackCount: number | null;
  readonly discCount: number | null;
  readonly coverArtUrl: string | null;
  readonly coverTheme: CoverTheme | null;
  /** When this cache row was written, so it can be refreshed later. */
  readonly cachedAt: number;
}

/**
 * Fields of a Copy that sync independently. Each carries its own clock, so two devices
 * editing different fields of the same copy both keep their edit.
 */
export const COPY_MERGEABLE_FIELDS = [
  "releaseId",
  "manualTitle",
  "manualArtist",
  "manualYear",
  "manualLabel",
  "manualCatalogNumber",
  "manualFormat",
  "pendingBarcode",
  "condition",
  "sleeveCondition",
  "catalogArt",
  "pricePaidCents",
  "currency",
  "purchasedOn",
  "purchasedAt",
  "notes",
  "rating",
  "hidden",
  "sortIndex",
  "deletedAt",
] as const;
export type CopyMergeableField = (typeof COPY_MERGEABLE_FIELDS)[number];

/** Encoded HLC stamps, one per mergeable field. */
export type FieldClocks<Field extends string> = Readonly<Record<Field, string>>;

/**
 * The prefix on the release id of a copy nobody has a record of.
 *
 * The two catalogues are `musicbrainz:` and `discogs:`; `local:` is the third source, and
 * the only one whose rows are not a cache of anything. What follows the prefix is the
 * copy's own id — see {@link manualReleaseId}.
 */
export const MANUAL_RELEASE_PREFIX = "local:";

/**
 * The release id a manually entered copy points at: its own id, source-qualified.
 *
 * Deliberately derived from the copy rather than a second generated uuid. A manual
 * pressing is described by exactly one copy — that is what "manual" means here — so
 * inventing a separate identity for it would only create the possibility of a release
 * nobody owns, or a copy pointing at a release this device has never heard of. With the
 * copy's own id inside it, any device holding the copy can resolve the release, including
 * one that pulled the copy from the server and has no local cache row for it at all.
 */
export function manualReleaseId(copyId: string): string {
  return `${MANUAL_RELEASE_PREFIX}${copyId}`;
}

export function isManualReleaseId(releaseId: string): boolean {
  return releaseId.startsWith(MANUAL_RELEASE_PREFIX);
}

/** The copy id inside a manual release id, or null when it is not one. */
export function manualReleaseCopyId(releaseId: string): string | null {
  return isManualReleaseId(releaseId) ? releaseId.slice(MANUAL_RELEASE_PREFIX.length) : null;
}

/**
 * What a manually entered copy says about its own pressing.
 *
 * These live on the `Copy` rather than in the release cache because they are the user's
 * data, not the archive's: they have to sync, they have to survive a cache the client is
 * free to drop, and they have to be correctable later. Six fields rather than one blob so
 * that each merges under its own clock — fixing the year on the phone and the label on the
 * laptop keeps both corrections, which is the whole point of the field-level merge.
 *
 * All null on a copy matched to a real release, with the one exception of
 * `manualFormat` — see its note. Nothing else reads them there: a copy's release facts
 * come from the archive whenever the archive has any.
 */
export interface ManualRelease {
  readonly manualTitle: string | null;
  readonly manualArtist: string | null;
  readonly manualYear: number | null;
  readonly manualLabel: string | null;
  readonly manualCatalogNumber: string | null;
  /**
   * Format is the one manual field with no sensible null: the shelf filters by it and the
   * silhouette on an artless copy is drawn from it.
   *
   * It is also the one manual field a *matched* copy may carry. The other five describe a
   * pressing the archive has no record of, but a format can be wrong about a pressing it
   * does have — a tape of a record catalogued as vinyl is a normal thing to own, and
   * re-matching the copy to another release would throw away its photos, grades and price
   * to fix one word. So this overrides the catalogue's format when it is set, and is null
   * when the archive's answer stands. Read it through {@link copyFormat}, never directly.
   */
  readonly manualFormat: Format | null;
}

export interface Copy extends ManualRelease {
  /** Client-generated, so a record created offline never collides on sync. */
  readonly id: string;
  /**
   * Which release this is a copy of, source-qualified ("musicbrainz:<uuid>",
   * "discogs:<int>", or "local:<this copy's id>" when it was typed in by hand).
   *
   * One field rather than a source beside an id: this is a mergeable value, so as two
   * fields each would merge under its own clock and one device's source could pair with
   * another device's id — a copy pointing at nothing. One field makes that
   * unrepresentable.
   */
  readonly releaseId: string;
  /**
   * The barcode of a scan that has not been identified yet, or null once it has.
   *
   * Scanning is a camera reading digits, which works in a basement with no signal; naming
   * the record behind those digits is a request to a catalogue, which does not. Rather
   * than refuse the scan, the copy is created from what the phone genuinely knows — a
   * number, and whichever format the person picked — and carries the barcode here until
   * some device with a connection can look it up. Until then the copy is an ordinary
   * manual copy with no title, so every screen already draws it without knowing about any
   * of this.
   *
   * Mergeable, and deliberately paired with `releaseId` in the resolving write: whoever
   * identifies it first clears this and sets the release under one stamp, so a second
   * device resolving the same scan cannot leave a copy that both points at a release and
   * still claims to be waiting for one.
   */
  readonly pendingBarcode: string | null;
  /**
   * The media grade. Named `condition` rather than `mediaCondition` because it is the
   * field that already syncs — renaming it would have meant a coordinated rename of the
   * merge contract in three repositories for no gain.
   */
  readonly condition: Condition | null;
  /**
   * The sleeve grade, judged separately from the media. A near-mint record in a ring-worn
   * jacket is a different object from a near-mint one in a near-mint jacket, and that is
   * how sellers list them.
   */
  readonly sleeveCondition: Condition | null;
  /**
   * What this copy has decided about the catalogue's own artwork.
   *
   * Everything else about "which picture stands for this record" is the order of the photo
   * list — starring a photo moves it to the front, and the front one is what the grid and
   * the hero draw. The catalogue cover cannot be expressed that way: it is not a Photo, it
   * belongs to the release rather than to the copy, and it has no position to be moved to.
   * So the choices the order cannot represent live here, and only those.
   *
   * One field with three states rather than two booleans beside each other: "prefer it"
   * and "hide it" are answers to the same question, and as separate flags a copy could
   * hold both at once — a state nobody chose, kept out only by every write path
   * remembering to clear the other one.
   *
   * Mergeable, so two devices that disagree converge like they do about a grade. `AUTO` is
   * both the default and what a client older than this field sends.
   */
  readonly catalogArt: CatalogArtChoice;
  readonly pricePaidCents: number | null;
  readonly currency: string;
  /** ISO date, no time — you know the day you bought a record, not the minute. */
  readonly purchasedOn: string | null;
  readonly purchasedAt: string | null;
  readonly notes: string | null;
  /**
   * The other device's version of the notes, when a merge found two different ones.
   *
   * Notes are the one long free-text field, so plain last-write-wins would silently
   * discard a paragraph someone wrote elsewhere. The winner still becomes `notes`; the
   * loser is kept here for the person to reconcile, and the detail screen surfaces it.
   *
   * Derived by the merge from its two inputs rather than written by a device, so it
   * carries no clock of its own.
   */
  readonly notesConflict: string | null;
  readonly rating: number | null;
  /**
   * Kept off every shelf but your own, whatever the sharing settings say.
   *
   * A record can be a gift not yet given, or simply nobody's business, and that is a
   * decision about one copy rather than a reason to close the whole collection. Mergeable
   * like every other field here: hiding one on the phone has to reach the laptop, and a
   * client older than this field sends nothing, which reads as not hidden.
   */
  readonly hidden: boolean;
  /**
   * Where this copy sits on a shelf that has been arranged by hand, or `null` while it
   * never has been -- the same field, with the same rules, that {@link WishlistItem} has.
   *
   * Synced rather than device-local because arranging a shelf is a statement about the
   * collection: putting the records you actually reach for at the top is a thing you mean,
   * not a preference of the phone you happened to do it on.
   *
   * Null is not position 0. A copy filed since the last arranging sorts *after* every
   * placed one, newest first among themselves, so a new record surfaces where new records
   * belong instead of silently jumping to the front of an order it was never part of.
   */
  readonly sortIndex: number | null;
  readonly createdAt: number;
  /** Tombstone. Deletes have to be represented, or sync would resurrect the row. */
  readonly deletedAt: number | null;
  readonly fieldClocks: FieldClocks<CopyMergeableField>;
}

/**
 * Fields of a WishlistItem that sync independently, mirroring how a Copy works. A wish is
 * edited less often than a copy, but sharing the machinery costs less than inventing a
 * second, subtly different merge.
 */
export const WISH_MERGEABLE_FIELDS = [
  "albumId",
  "releaseId",
  "pendingBarcode",
  "title",
  "artistName",
  "year",
  "desiredFormat",
  "note",
  "sortIndex",
  "deletedAt",
] as const;
export type WishMergeableField = (typeof WISH_MERGEABLE_FIELDS)[number];

export interface WishlistItem {
  /** Client-generated, so an item added offline keeps its identity when it syncs. */
  readonly id: string;
  readonly albumId: string;
  /**
   * The pressing this entry was made from, when it was made from one.
   *
   * A wish is still *for* an album — that is what `albumId` is, and what "one entry per
   * release" is checked against — but the row somebody clicked in the search was one
   * pressing among several, each with its own sleeve. Without this the cover shown is
   * whichever pressing of the album the mirror happens to rank first, which is not the
   * one that was on screen when the entry was made.
   *
   * Null for a hand-typed entry, and for every entry made before this field existed.
   */
  readonly releaseId: string | null;
  /**
   * The barcode of a scan sent here before it could be identified, mirroring
   * {@link Copy.pendingBarcode}.
   *
   * A record you covet is scanned in the same basement as one you bought, and the two
   * destinations are meant to be equal answers to the same question — so the wishlist has
   * to be able to hold a number too. `title` and `artistName` are empty while this is set,
   * which is what the list draws as an unnamed entry.
   */
  readonly pendingBarcode: string | null;
  readonly title: string;
  readonly artistName: string;
  readonly year: number | null;
  /** A wish is for an album in a format, not for one specific pressing. */
  readonly desiredFormat: Format | null;
  readonly note: string | null;
  /**
   * Where the entry sits once the list has been hand-sorted, or `null` while it never has
   * been. It is a synced, mergeable field rather than a device preference because dragging
   * a row is a statement about the list itself — "this is the one I am closest to finding"
   * — and a hand-built order that only existed on the phone would be gone the moment you
   * opened the web app.
   *
   * A drag renumbers every live entry from 0, so the values are dense and the ordering
   * survives one device's writes losing a merge: the worst case is a list ordered by
   * somebody else's drag, never a list with holes in it.
   */
  readonly sortIndex: number | null;
  readonly createdAt: number;
  readonly deletedAt: number | null;
  readonly fieldClocks: FieldClocks<WishMergeableField>;
}

/**
 * Fields of a Photo that sync independently.
 *
 * The bytes are immutable — a photo id points at one image forever — so `storageKey`,
 * `contentType` and `byteSize` only ever change from "not uploaded yet" to "uploaded".
 * What genuinely moves is where it sits in the strip and whether it was deleted.
 */
export const PHOTO_MERGEABLE_FIELDS = [
  "copyId",
  "wishId",
  "storageKey",
  "contentType",
  "byteSize",
  "sortIndex",
  "deletedAt",
] as const;
export type PhotoMergeableField = (typeof PHOTO_MERGEABLE_FIELDS)[number];

export interface Photo {
  /** Client-generated: the photo exists on the device before it is ever uploaded. */
  readonly id: string;
  /**
   * The copy this pictures, or null when the picture belongs to a wishlist entry instead.
   *
   * Exactly one of `copyId` and `wishId` is set. They are two fields rather than one
   * owner id and a kind, because a photo that lost track of *what sort of thing* it
   * belongs to is a photo nothing can find, whereas a null is a question every reader has
   * to answer anyway.
   */
  readonly copyId: string | null;
  /**
   * The wishlist entry this pictures, for a record no catalogue has.
   *
   * A wish for a hand-entered album can never be handed artwork by the mirror — nobody
   * has it — so the only cover it can have is one somebody photographed or saved. A
   * matched wish does not carry one: its album resolves through the metadata proxy, and
   * two sources for the same tile would need a precedence rule nobody asked for.
   */
  readonly wishId: string | null;
  /**
   * Where the bytes live in object storage, or null while the photo is still only on this
   * device. This *is* the upload state — a separate flag could disagree with reality.
   */
  readonly storageKey: string | null;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sortIndex: number;
  readonly createdAt: number;
  readonly deletedAt: number | null;
  readonly fieldClocks: FieldClocks<PhotoMergeableField>;
}

export interface CollectionStats {
  readonly copyCount: number;
  readonly releaseGroupCount: number;
  readonly totalSpentCents: number;
  readonly averageSpentCents: number;
  readonly byFormat: Readonly<Record<Format, number>>;
}

export const CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  M: "Mint",
  NM: "Near Mint",
  VG_PLUS: "Very Good Plus",
  VG: "Very Good",
  G_PLUS: "Good Plus",
  G: "Good",
  F: "Fair",
  P: "Poor",
};

/** The short form the design deck shows on badges ("VG+", "NM"). */
export const CONDITION_SHORT: Readonly<Record<Condition, string>> = {
  M: "M",
  NM: "NM",
  VG_PLUS: "VG+",
  VG: "VG",
  G_PLUS: "G+",
  G: "G",
  F: "F",
  P: "P",
};

export const FORMAT_LABELS: Readonly<Record<Format, string>> = {
  VINYL: "Vinyl",
  CD: "CD",
  CASSETTE: "Cassette",
  DIGITAL: "Digital",
  OTHER: "Other",
};
