import type { LibrarySort } from "../domain/library.js";
import type {
  CollectionStats,
  Condition,
  Copy,
  Format,
  Photo,
  Release,
  WishlistItem,
} from "../domain/types.js";

export interface LibraryFilter {
  readonly format?: Format | "ALL";
  /** The grade rail from screen 1f. Null — or absent — is every grade, ungraded included. */
  readonly condition?: Condition | null;
  readonly search?: string;
  /**
   * Which order to read the shelf in. `MANUAL` is the one somebody dragged into place --
   * see `library.ts`, and `compareManualOrder` for the rule each store implements in its
   * own query language.
   */
  readonly sort?: LibrarySort;
}

/**
 * Everything the app reads and writes. There is no API behind this in phase 2 — the local
 * store *is* the source of truth, and the sync engine (phase 3) will reconcile it with the
 * server without any screen needing to know.
 *
 * The mobile app implements the same interface over expo-sqlite. Keep the two in step: a
 * screen written against this should port with no changes to its data access.
 */
export interface LocalStore {
  /** Idempotent; safe to call on every start. */
  open(): Promise<void>;

  listCopies(filter?: LibraryFilter): Promise<Copy[]>;
  getCopy(id: string): Promise<Copy | undefined>;
  /** Tombstones included — sync has to be able to push a delete. */
  getCopyIncludingDeleted(id: string): Promise<Copy | undefined>;
  /** Copies of the same album, for the detail screen's "other copies you own". */
  listCopiesInReleaseGroup(albumId: string): Promise<Copy[]>;
  /**
   * A local write. Records the copy as pending, so nothing has to remember to do that at
   * the call site — a write that forgot would simply never reach the server.
   */
  putCopy(copy: Copy): Promise<void>;
  /**
   * Many local writes at once, as one transaction and one pass over the pending list.
   *
   * Exists for arranging a shelf, which is the only thing in the app that writes to every
   * record at once: the first drag on a shelf that has never been arranged gives all of
   * them a `sortIndex`. Looping `putCopy` does that in n transactions while re-reading and
   * re-writing the whole pending-id list each time, which is quadratic in the size of the
   * collection -- on a shelf of a few hundred records, long enough to be visible as the
   * gesture not having been taken.
   */
  putCopies(copies: readonly Copy[]): Promise<void>;
  /** A write that came from sync. Deliberately does not mark the copy pending, or the
   * client would push straight back what it just pulled, forever. */
  adoptCopy(copy: Copy): Promise<void>;

  // There is deliberately no deleteCopy here. A delete is an ordinary write of a
  // tombstone, stamped by `tombstoneCopy`, and it goes through putCopy like any other
  // edit. An unstamped delete would lose every merge and the copy would come back.

  cacheReleases(releases: readonly Release[]): Promise<void>;
  getRelease(releaseId: string): Promise<Release | undefined>;
  getReleases(releaseIds: readonly string[]): Promise<Map<string, Release>>;

  /** Live photos for one copy, in strip order. */
  listPhotos(copyId: string): Promise<Photo[]>;
  /**
   * The first photo of each of these copies, keyed by copy id, for the library grid to
   * stand in with where a release has no artwork. One indexed query rather than one per
   * tile — a shelf of a few hundred records would otherwise open a few hundred of them.
   */
  listCoverPhotos(copyIds: readonly string[]): Promise<Map<string, Photo>>;
  /**
   * The picture somebody gave each of these wishes, keyed by wish id.
   *
   * One picture per wish, not a strip: a wish is a line on a list, and all a picture has
   * to do there is say which record it is — uploading a second replaces the first. Batched
   * like `listCoverPhotos` for the same reason, since the list asks for the whole screen.
   */
  listWishPhotos(wishIds: readonly string[]): Promise<Map<string, Photo>>;
  /**
   * Every live photo on the device, whoever owns it.
   *
   * For the `.mc` export, which has to put the whole shelf in one file. Deliberately not
   * used by any screen: a screen asks for the photos of the thing it is drawing, and one
   * that pulled the lot and filtered in JavaScript would get slower with every record
   * added.
   */
  listAllPhotos(): Promise<Photo[]>;
  getPhotoIncludingDeleted(id: string): Promise<Photo | undefined>;
  /** Photos whose bytes are on this device but not yet in object storage. */
  listPhotosAwaitingUpload(): Promise<Photo[]>;
  putPhoto(photo: Photo): Promise<void>;
  adoptPhoto(photo: Photo): Promise<void>;

  /**
   * The image bytes, kept on the device.
   *
   * Photos are local-first like everything else: once fetched, they render with no
   * network at all, and a photo taken without an account never leaves the device.
   */
  // Stored as a buffer plus its content type rather than a Blob: Blob support in
  // IndexedDB is uneven across engines, and the pair reconstructs the Blob exactly.
  putPhotoBytes(id: string, buffer: ArrayBuffer, contentType: string): Promise<void>;
  getPhotoBytes(id: string): Promise<Blob | undefined>;
  /**
   * Whether this device is holding the bytes, without reading them.
   *
   * Its own question rather than `getPhotoBytes(id) !== undefined`, because answering it
   * that way costs a full read of every picture on the device: the phone stores them as
   * files and would decode each one from base64 to say yes or no. The sync sweep asks this
   * about the whole collection on every pass.
   */
  hasPhotoBytes(id: string): Promise<boolean>;
  deletePhotoBytes(id: string): Promise<void>;

  /**
   * Everything still waiting to find out what it is: copies and wishes carrying a
   * `pendingBarcode`.
   *
   * One call for both, because the resolver runs once and asks the catalogue about a set
   * of numbers — splitting it in two would look each barcode up twice whenever the same
   * record was scanned onto the shelf and the wishlist in the same session.
   */
  listPendingScans(): Promise<{ copies: Copy[]; wishes: WishlistItem[] }>;

  listWishlist(): Promise<WishlistItem[]>;
  getWishlistItemIncludingDeleted(id: string): Promise<WishlistItem | undefined>;
  putWishlistItem(item: WishlistItem): Promise<void>;
  adoptWishlistItem(item: WishlistItem): Promise<void>;
  /** True when the wishlist already holds a live wish for this album. */
  wishlistHas(albumId: string): Promise<boolean>;

  stats(): Promise<CollectionStats>;

  /**
   * Stable per-installation id. It is the tie-breaker in every field-level merge, so it
   * must survive reloads — a device that reinvents its id on every start would make
   * conflict resolution non-deterministic.
   */
  deviceId(): Promise<string>;
  /** The device's HLC, persisted so it never goes backwards across a restart. */
  readClock(): Promise<string | undefined>;
  writeClock(encoded: string): Promise<void>;

  /** How far through the server's change log this device has read. */
  readSyncCursor(): Promise<number>;
  writeSyncCursor(cursor: number): Promise<void>;
  /** Ids written locally since the last successful push. */
  readPendingIds(): Promise<string[]>;
  writePendingIds(ids: readonly string[]): Promise<void>;

  /**
   * Device-local preferences, keyed by name.
   *
   * Deliberately not synced: "sync is off on this laptop" is a statement about this
   * device, and pushing it would switch sync off everywhere the moment it was turned off
   * anywhere — including, absurdly, disabling the sync that would carry the change back.
   */
  readSetting(key: string): Promise<string | undefined>;
  writeSetting(key: string, value: string): Promise<void>;
}
