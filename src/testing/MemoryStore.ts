import { copyFormat } from "../domain/copyFormat.js";
import { manualRelease } from "../domain/manualRelease.js";
import type {
  CollectionStats,
  Copy,
  Format,
  Photo,
  Release,
  WishlistItem,
} from "../domain/types.js";
import {
  FORMATS,
  albumIdOf,
  catalogueKeyOf,
  catalogueKeysOf,
  manualReleaseCopyId,
} from "../domain/types.js";
import type { LibraryFilter, LocalStore } from "../local/LocalStore.js";
import { mergeCachedRelease } from "../local/releaseCache.js";

/**
 * A LocalStore that lives in a Map, for testing the parts of the app that are about
 * records rather than about storage.
 *
 * The sync engine's tests used to run against the web app's Dexie store, which is why they
 * could only live in the web app — and so the mobile engine, a hand-copy of the same
 * program, was never covered by them at all. This is the same contract with none of the
 * platform: it deliberately reproduces the two behaviours the engine actually depends on —
 * a write marks the record pending, an adopt does not — and nothing else.
 */
export class MemoryStore implements LocalStore {
  private copies = new Map<string, Copy>();
  private releases = new Map<string, Release>();
  private photos = new Map<string, Photo>();
  private bytes = new Map<string, { buffer: ArrayBuffer; contentType: string }>();
  private wishes = new Map<string, WishlistItem>();
  private settings = new Map<string, string>();
  private pending: string[] = [];
  private cursor = 0;

  async open(): Promise<void> {}

  private markPending(id: string): void {
    if (!this.pending.includes(id)) this.pending.push(id);
  }

  private live<T extends { deletedAt: number | null }>(values: Iterable<T>): T[] {
    return [...values].filter((value) => value.deletedAt === null);
  }

  async listCopies(filter?: LibraryFilter): Promise<Copy[]> {
    let copies = this.live(this.copies.values());
    if (filter?.format !== undefined && filter.format !== "ALL") {
      const releases = await this.getReleases(catalogueKeysOf(copies));
      copies = copies.filter(
        (copy) => copyFormat(copy, releases.get(catalogueKeyOf(copy) ?? "")) === filter.format,
      );
    }
    if (filter?.condition !== undefined && filter.condition !== null) {
      copies = copies.filter((copy) => copy.condition === filter.condition);
    }
    return copies;
  }

  async getCopy(id: string): Promise<Copy | undefined> {
    const copy = this.copies.get(id);
    return copy?.deletedAt === null ? copy : undefined;
  }

  async getCopyIncludingDeleted(id: string): Promise<Copy | undefined> {
    return this.copies.get(id);
  }

  async listCopiesInReleaseGroup(albumId: string): Promise<Copy[]> {
    const copies = this.live(this.copies.values());
    const releases = await this.getReleases(catalogueKeysOf(copies));
    return copies.filter(
      (copy) => albumIdOf(copy, releases.get(catalogueKeyOf(copy) ?? "")) === albumId,
    );
  }

  async putCopy(copy: Copy): Promise<void> {
    this.copies.set(copy.id, copy);
    this.markPending(copy.id);
  }

  async putCopies(copies: readonly Copy[]): Promise<void> {
    for (const copy of copies) {
      this.copies.set(copy.id, copy);
      this.markPending(copy.id);
    }
  }

  async adoptCopy(copy: Copy): Promise<void> {
    this.copies.set(copy.id, copy);
  }

  async cacheReleases(releases: readonly Release[]): Promise<void> {
    for (const release of releases) {
      this.releases.set(release.id, mergeCachedRelease(release, this.releases.get(release.id)));
    }
  }

  async getRelease(releaseId: string): Promise<Release | undefined> {
    // A manual release is not cached anywhere — it is derived from the copy that describes
    // it, so that a device which pulled the copy from the server resolves it too.
    const copyId = manualReleaseCopyId(releaseId);
    if (copyId !== null) {
      const copy = this.copies.get(copyId);
      return copy === undefined ? undefined : manualRelease(copy);
    }
    return this.releases.get(releaseId);
  }

  async getReleases(releaseIds: readonly string[]): Promise<Map<string, Release>> {
    const found = new Map<string, Release>();
    for (const id of releaseIds) {
      const release = await this.getRelease(id);
      if (release !== undefined) found.set(id, release);
    }
    return found;
  }

  async listPhotos(copyId: string): Promise<Photo[]> {
    return this.live(this.photos.values())
      .filter((photo) => photo.copyId === copyId)
      .sort((a, b) => a.sortIndex - b.sortIndex);
  }

  async listCoverPhotos(copyIds: readonly string[]): Promise<Map<string, Photo>> {
    const covers = new Map<string, Photo>();
    for (const copyId of copyIds) {
      const first = (await this.listPhotos(copyId))[0];
      if (first !== undefined) covers.set(copyId, first);
    }
    return covers;
  }

  async listWishPhotos(wishIds: readonly string[]): Promise<Map<string, Photo>> {
    const wanted = new Set(wishIds);
    const covers = new Map<string, Photo>();
    // Newest first, so the picture a replacement produced wins over the one it replaced
    // in the moment before the old one's tombstone has synced.
    for (const photo of this.live(this.photos.values()).sort((a, b) => b.createdAt - a.createdAt)) {
      if (photo.wishId === null || !wanted.has(photo.wishId)) continue;
      if (!covers.has(photo.wishId)) covers.set(photo.wishId, photo);
    }
    return covers;
  }

  /**
   * The raw bytes, without going through a `Blob`.
   *
   * jsdom's `Blob` has no `arrayBuffer`, and React Native's has no way to read the bytes
   * at all — which is the very reason the export takes a byte reader rather than calling
   * `getPhotoBytes` itself. Tests use this the way each app uses its own platform's route.
   */
  photoBuffer(id: string): ArrayBuffer | undefined {
    return this.bytes.get(id)?.buffer;
  }

  async listAllPhotos(): Promise<Photo[]> {
    return this.live(this.photos.values()).sort((a, b) => a.sortIndex - b.sortIndex);
  }

  async getPhotoIncludingDeleted(id: string): Promise<Photo | undefined> {
    return this.photos.get(id);
  }

  async listPhotosAwaitingUpload(): Promise<Photo[]> {
    return this.live(this.photos.values()).filter((photo) => photo.storageKey === null);
  }

  async putPhoto(photo: Photo): Promise<void> {
    this.photos.set(photo.id, photo);
    this.markPending(photo.id);
  }

  async adoptPhoto(photo: Photo): Promise<void> {
    this.photos.set(photo.id, photo);
  }

  async putPhotoBytes(id: string, buffer: ArrayBuffer, contentType: string): Promise<void> {
    this.bytes.set(id, { buffer, contentType });
  }

  async getPhotoBytes(id: string): Promise<Blob | undefined> {
    const stored = this.bytes.get(id);
    return stored === undefined
      ? undefined
      : new Blob([stored.buffer], { type: stored.contentType });
  }

  async hasPhotoBytes(id: string): Promise<boolean> {
    return this.bytes.has(id);
  }

  async deletePhotoBytes(id: string): Promise<void> {
    this.bytes.delete(id);
  }

  async listPendingScans(): Promise<{ copies: Copy[]; wishes: WishlistItem[] }> {
    return {
      copies: this.live(this.copies.values()).filter((copy) => copy.pendingBarcode !== null),
      wishes: this.live(this.wishes.values()).filter((wish) => wish.pendingBarcode !== null),
    };
  }

  async listWishlist(): Promise<WishlistItem[]> {
    return this.live(this.wishes.values());
  }

  async getWishlistItemIncludingDeleted(id: string): Promise<WishlistItem | undefined> {
    return this.wishes.get(id);
  }

  async putWishlistItem(item: WishlistItem): Promise<void> {
    this.wishes.set(item.id, item);
    this.markPending(item.id);
  }

  async adoptWishlistItem(item: WishlistItem): Promise<void> {
    this.wishes.set(item.id, item);
  }

  async wishlistHas(albumId: string): Promise<boolean> {
    return this.live(this.wishes.values()).some((item) => item.albumId === albumId);
  }

  async stats(): Promise<CollectionStats> {
    const copies = await this.listCopies();
    const byFormat = Object.fromEntries(FORMATS.map((format) => [format, 0])) as Record<
      Format,
      number
    >;
    const albums = new Set<string>();
    let totalSpentCents = 0;
    let priced = 0;
    for (const copy of copies) {
      const release = this.releases.get(catalogueKeyOf(copy) ?? "");
      byFormat[copyFormat(copy, release)] += 1;
      const album = albumIdOf(copy, release);
      if (album !== null) albums.add(album);
      if (copy.pricePaidCents !== null) {
        totalSpentCents += copy.pricePaidCents;
        priced += 1;
      }
    }
    return {
      copyCount: copies.length,
      releaseGroupCount: albums.size,
      totalSpentCents,
      averageSpentCents: priced === 0 ? 0 : Math.round(totalSpentCents / priced),
      byFormat,
    };
  }

  async deviceId(): Promise<string> {
    return "memory-device";
  }

  async readClock(): Promise<string | undefined> {
    return this.settings.get("clock");
  }

  async writeClock(encoded: string): Promise<void> {
    this.settings.set("clock", encoded);
  }

  async readSyncCursor(): Promise<number> {
    return this.cursor;
  }

  async writeSyncCursor(cursor: number): Promise<void> {
    this.cursor = cursor;
  }

  async readPendingIds(): Promise<string[]> {
    return [...this.pending];
  }

  async writePendingIds(ids: readonly string[]): Promise<void> {
    this.pending = [...ids];
  }

  async readSetting(key: string): Promise<string | undefined> {
    return this.settings.get(key);
  }

  async writeSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }
}
