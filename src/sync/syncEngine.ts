import { copyFormat } from "../domain/copyFormat.js";
import { mergeCopies, mergePhotos, mergeWishlistItems } from "../domain/merge.js";
import {
  type Copy,
  type Photo,
  type Release,
  type WishlistItem,
  catalogueKeyOf,
  isManualReleaseId,
} from "../domain/types.js";
import type { LocalStore } from "../local/LocalStore.js";
import { type CopyPatch, applyCopyPatch, tombstoneCopy } from "../local/copyWrites.js";
import type { ClockSource } from "../local/copyWrites.js";
import { unobservedStore } from "../local/localWrites.js";
import { markUploaded } from "../local/photoWrites.js";
import { type WishPatch, applyWishPatch, tombstoneWishlistItem } from "../local/wishWrites.js";
import {
  type EntryLabel,
  type ReviewPlan,
  type ShelfComparison,
  type ValueDifference,
  compareShelves,
  differenceKey,
} from "./conflict.js";
import type { SyncTransport } from "./transport.js";
import {
  type UploadRefusal,
  clearUploadRefusal,
  httpStatusOf,
  refusalReasonFor,
  writeUploadRefusal,
} from "./uploadRefusal.js";

/**
 * Reconciles the local store with the server.
 *
 * Sync is deliberately not in the read path: screens always read local, and this runs
 * alongside them. That is what lets the app work identically with and without an account —
 * and it is why turning sync off, or losing the network, changes nothing about what the
 * user can do.
 */

/** How the very first sync after signing in should treat the two collections. */
export type FirstSyncStrategy = "MERGE" | "KEEP_LOCAL" | "KEEP_ACCOUNT";

/** The server takes a hundred release ids at a time, so a large collection pages. */
const RELEASE_BATCH = 100;
/**
 * Marks the one-off refresh of releases whose cover a bad probe took away.
 *
 * A setting rather than a schema flag: it is a repair, not a state the app reasons about,
 * and it wants to be forgotten as soon as it has run. See `cacheMissingReleases`.
 */
const COVER_REPAIR_KEY = "catalogue.coverRepair";
const COVER_REPAIR_DONE = "1";

/** Set once this device has offered the server the catalogue it holds. */
const CATALOGUE_OFFERED = "catalogueOffered";

export interface SyncResult {
  readonly pulled: number;
  readonly pushed: number;
  /**
   * How many catalogue entries this sync filled in.
   *
   * Counted separately from `pulled` because it moves on its own: a device that pulled its
   * copies before the client fetched releases at all has nothing new to pull and still has
   * a whole shelf to redraw. A caller that refreshes its screens on `pulled` alone would
   * leave that device showing placeholders until the next reload.
   */
  readonly releases: number;
  /**
   * How many copies still have no catalogue entry after this sync.
   *
   * The shelf draws one of these as an untitled placeholder in the generic silhouette, so
   * a number above zero is the difference between "your collection is empty" and "your
   * collection is here but this device cannot describe it yet" — the two look identical
   * on screen and want opposite reactions from the user.
   */
  readonly releasesMissing: number;
  /**
   * Whether asking the mirror for catalogue entries failed outright.
   *
   * Separate from `releasesMissing` because the two are different problems wearing the
   * same placeholder: a request that never landed is worth retrying and worth saying out
   * loud, while an id the mirror simply does not hold will read the same on every attempt
   * and is not the user's to fix.
   */
  readonly releasesUnreachable: boolean;
  readonly cursor: number;
}

/** What one pass of {@link SyncEngine.cacheMissingReleases} managed to do. */
interface ReleaseRefill {
  readonly cached: number;
  readonly missing: number;
  readonly unreachable: boolean;
}

export class SyncEngine {
  private readonly store: LocalStore;

  constructor(
    store: LocalStore,
    private readonly clock: ClockSource,
    private readonly transport: SyncTransport,
  ) {
    // The engine's own writes are pushed by the pass that made them, or by the one it runs
    // straight after. Announced as local writes, they would wake another pass behind every
    // sync that uploaded a photo. See `observeLocalWrites`.
    this.store = unobservedStore(store);
  }

  /**
   * Deletes go through the same stamped write path as any other edit. An unstamped
   * tombstone would lose every merge, and the copy would reappear on the next sync.
   */
  private async discard(copy: Copy, now: number): Promise<void> {
    await this.store.putCopy(tombstoneCopy(copy, this.clock, now));
  }

  /**
   * Reads the account without adopting a single record of it.
   *
   * Deliberately not a sync: it pages the change log from the beginning into memory, never
   * writes the cursor, and never adopts. That is what lets the dialogue promise "nothing
   * changes until you choose" — a comparison that wrote as it read would already have
   * merged the two shelves by the time the question appeared on screen.
   *
   * The catalogue is the one exception, and it is not the user's data: a copy that exists
   * only in the account names a release this device has never heard of, so without filling
   * that in the difference would be a list of untitled placeholders and unreadable exactly
   * where reading matters most. A release row is a cache of MusicBrainz that any client may
   * drop and refill, so caching it costs nothing and decides nothing.
   */
  async compare(): Promise<ShelfComparison> {
    const account = await this.peekAccount();
    const localCopies = await this.store.listCopies();
    const localWishes = await this.store.listWishlist();

    const releases = await this.describeReleases([...localCopies, ...account.copies]);
    const labels = {
      labelForCopy: (copy: Copy): EntryLabel => {
        const release = releases.get(catalogueKeyOf(copy) ?? "");
        return {
          title: copy.manualTitle ?? release?.title ?? null,
          artistName: copy.manualArtist ?? release?.artistName ?? null,
          year: copy.manualYear ?? release?.year ?? null,
          format: copyFormat(copy, release),
        };
      },
      labelForWish: (wish: WishlistItem): EntryLabel => ({
        title: wish.title === "" ? null : wish.title,
        artistName: wish.artistName === "" ? null : wish.artistName,
        year: wish.year,
        format: wish.desiredFormat ?? "OTHER",
      }),
    };

    const photos = (await this.store.listAllPhotos()).filter(
      (photo) => photo.deletedAt === null,
    ).length;

    return compareShelves(
      { copies: localCopies, wishes: localWishes },
      { copies: account.copies, wishes: account.wishes },
      labels,
      photos,
    );
  }

  /** The whole account, read into memory and written nowhere. */
  private async peekAccount(): Promise<{ copies: Copy[]; wishes: WishlistItem[] }> {
    const copies: Copy[] = [];
    const wishes: WishlistItem[] = [];
    let cursor = 0;
    let hasMore = true;
    while (hasMore) {
      const page = await this.transport.pull(cursor);
      copies.push(...page.copies);
      wishes.push(...page.wishes);
      // A server that answers the same cursor forever would page for ever. It cannot
      // happen against our own backend, and a comparison that hangs the sign-in is a worse
      // failure than one that compares what it has.
      if (page.cursor === cursor) break;
      cursor = page.cursor;
      hasMore = page.hasMore;
    }
    return { copies, wishes };
  }

  /**
   * The catalogue rows behind these copies, filled in from the mirror where this device
   * has none. Unreachable ids are simply absent: the difference then names that entry by
   * whatever the copy itself carries, which is what an untitled row already looks like
   * everywhere else in the app.
   */
  private async describeReleases(copies: readonly Copy[]): Promise<Map<string, Release>> {
    const wanted = [
      ...new Set(
        copies
          .map(catalogueKeyOf)
          .filter((id): id is string => id !== null && !isManualReleaseId(id)),
      ),
    ];
    const held = await this.store.getReleases(wanted);
    const missing = wanted.filter((releaseId) => !held.has(releaseId));
    for (let from = 0; from < missing.length; from += RELEASE_BATCH) {
      try {
        const fetched = await this.transport.fetchReleases(
          missing.slice(from, from + RELEASE_BATCH),
        );
        if (fetched.length > 0) await this.store.cacheReleases(fetched);
        for (const release of fetched) held.set(release.id, release);
      } catch {
        // Offline or the mirror is down. The comparison is still the truth about which
        // records differ; only their titles are missing, and the next sync fills them in.
      }
    }
    return held;
  }

  /**
   * Signing in for the first time on a device that already has a collection.
   *
   * Nothing happens until the person chooses, because every option here is destructive in
   * one direction or another and none of them should be picked on their behalf.
   */
  async firstSync(strategy: FirstSyncStrategy): Promise<SyncResult> {
    if (strategy === "KEEP_ACCOUNT") {
      // Drop the local collection by tombstoning it, so the discard itself replicates
      // rather than leaving the records to come back from another device later.
      const now = Date.now();
      for (const copy of await this.store.listCopies()) {
        await this.discard(copy, now);
      }
      for (const wish of await this.store.listWishlist()) {
        await this.store.putWishlistItem(tombstoneWishlistItem(wish, this.clock, now));
      }
      await this.store.writePendingIds([]);
      return this.sync();
    }

    if (strategy === "KEEP_LOCAL") {
      // Snapshot what is local *before* pulling. Reading it afterwards would count the
      // account's records as local and keep exactly what this option is meant to discard.
      const localIds = new Set(await this.allCopyIds());

      const pulled = await this.pullAll();
      const now = Date.now();
      for (const copy of pulled.copies) {
        if (!localIds.has(copy.id) && copy.deletedAt === null) {
          await this.discard(copy, now);
        }
      }
      for (const wish of pulled.wishes) {
        if (!localIds.has(wish.id) && wish.deletedAt === null) {
          await this.store.putWishlistItem(tombstoneWishlistItem(wish, this.clock, now));
        }
      }
      await this.store.writePendingIds(await this.allCopyIds());
      return this.sync();
    }

    await this.store.writePendingIds(await this.allCopyIds());
    return this.sync();
  }

  /**
   * The per-item resolution: merge everything, then undo the parts of the merge somebody
   * disagreed with.
   *
   * Written as "merge, then correct" rather than as a fourth reconciliation strategy on
   * purpose. Every record ends up on this device first, so a pick is an ordinary stamped
   * edit and a drop is an ordinary stamped delete — which means both replicate to every
   * other device by the machinery that already exists, and neither can produce a state the
   * normal merge could not have reached. A bespoke path that assembled the final shelf
   * itself would be a second definition of convergence, and the two would drift.
   *
   * The plan is sparse: anything nobody decided keeps the merge's own answer, which is why
   * abandoning the review half-finished is safe.
   */
  async firstSyncReviewed(comparison: ShelfComparison, plan: ReviewPlan): Promise<SyncResult> {
    await this.store.writePendingIds(await this.allCopyIds());
    const merged = await this.sync();
    const corrections = await this.applyReview(comparison, plan);
    // A correction is a local write, and a local write is not real until it has been
    // pushed. Skipped when there were none, so the ordinary "keep both, but let me look
    // first" path costs one sync like every other choice.
    return corrections === 0 ? merged : this.sync();
  }

  /** Writes the review's decisions over the merged shelf. Returns how many it changed. */
  private async applyReview(comparison: ShelfComparison, plan: ReviewPlan): Promise<number> {
    let written = 0;
    const now = Date.now();

    for (const id of plan.dropped) {
      const copy = await this.store.getCopyIncludingDeleted(id);
      if (copy !== undefined) {
        if (copy.deletedAt !== null) continue;
        await this.store.putCopy(tombstoneCopy(copy, this.clock, now));
        written += 1;
        continue;
      }
      const wish = await this.store.getWishlistItemIncludingDeleted(id);
      if (wish === undefined || wish.deletedAt !== null) continue;
      await this.store.putWishlistItem(tombstoneWishlistItem(wish, this.clock, now));
      written += 1;
    }

    for (const difference of comparison.values) {
      const side = plan.picks[differenceKey(difference)];
      if (side === undefined) continue;
      if (await this.applyPick(difference, side)) written += 1;
    }
    return written;
  }

  /**
   * Puts one chosen value back on the merged record.
   *
   * The patch helpers restamp only fields whose value actually changed, so picking the
   * side that already won is a no-op rather than a write that would start beating real
   * edits made elsewhere. That is also why this returns whether anything moved.
   */
  private async applyPick(
    difference: ValueDifference,
    side: "LOCAL" | "ACCOUNT",
  ): Promise<boolean> {
    const value = side === "LOCAL" ? difference.local : difference.account;
    if (difference.kind === "COPY") {
      const copy = await this.store.getCopy(difference.id);
      if (copy === undefined) return false;
      const patched = applyCopyPatch(copy, { [difference.field]: value } as CopyPatch, this.clock);
      if (patched === copy) return false;
      await this.store.putCopy(patched);
      return true;
    }
    const wish = await this.store.getWishlistItemIncludingDeleted(difference.id);
    if (wish === undefined || wish.deletedAt !== null) return false;
    const patched = applyWishPatch(wish, { [difference.field]: value } as WishPatch, this.clock);
    if (patched === wish) return false;
    await this.store.putWishlistItem(patched);
    return true;
  }

  /** A normal incremental sync: pull what is new, push what changed locally. */
  async sync(): Promise<SyncResult> {
    const pulled = await this.pullAll();
    await this.downloadMissingPhotoBytes();
    const releases = await this.cacheMissingReleases();
    try {
      await this.uploadUnmirroredCatalogue();
    } catch {
      // Offline, or the server is down. Unmarked, so the next sync offers it again.
    }
    const pushed = await this.pushPending();
    return {
      pulled: pulled.copies.length + pulled.wishes.length + pulled.photos.length,
      pushed,
      releases: releases.cached,
      releasesMissing: releases.missing,
      releasesUnreachable: releases.unreachable,
      cursor: await this.store.readSyncCursor(),
    };
  }

  private async pullAll(): Promise<{ copies: Copy[]; wishes: WishlistItem[]; photos: Photo[] }> {
    const applied: Copy[] = [];
    const appliedWishes: WishlistItem[] = [];
    const appliedPhotos: Photo[] = [];
    let cursor = await this.store.readSyncCursor();
    let hasMore = true;

    while (hasMore) {
      const page = await this.transport.pull(cursor);
      for (const remote of page.photos) {
        const local = await this.store.getPhotoIncludingDeleted(remote.id);
        const merged = mergePhotos(local, remote);
        await this.store.adoptPhoto(merged);
        appliedPhotos.push(merged);
        // A photo deleted anywhere is not worth the space here either.
        if (merged.deletedAt !== null) await this.store.deletePhotoBytes(merged.id);
      }
      for (const remote of page.wishes) {
        const local = await this.store.getWishlistItemIncludingDeleted(remote.id);
        const merged = mergeWishlistItems(local, remote);
        await this.store.adoptWishlistItem(merged);
        appliedWishes.push(merged);
      }
      for (const remote of page.copies) {
        // Tombstones included. Looking this up with getCopy would hide a locally deleted
        // copy, make the server's live version look like a record we had never seen, and
        // adopt it wholesale — resurrecting every delete on the next sync.
        const local = await this.store.getCopyIncludingDeleted(remote.id);
        const merged = mergeCopies(local, remote);
        await this.store.adoptCopy(merged);
        applied.push(merged);
      }
      cursor = page.cursor;
      hasMore = page.hasMore;
      await this.store.writeSyncCursor(cursor);
    }
    return { copies: applied, wishes: appliedWishes, photos: appliedPhotos };
  }

  /**
   * Uploads the bytes of any photo that only exists on this device.
   *
   * Runs before the metadata push on purpose: a photo record with no storageKey is one
   * other devices can see but never fetch, so the bytes have to land first.
   *
   * Two kinds of failure, and the difference is the whole of design 28d. An upload that
   * fails because the network is down, or because storage is having a bad minute, is not
   * news: the photo is kept, the next sync tries again, and saying anything would be noise
   * about something that fixes itself. An upload the *server refuses* is the opposite. The
   * account is full or the picture is too big, neither ever resolves on its own, and
   * retrying in silence is how a photo lives on one phone for two days while the person who
   * took it believes it is backed up.
   *
   * So the refusals are remembered and everything else still is not.
   */
  private async uploadPendingPhotos(): Promise<void> {
    let uploadedSomething = false;
    let refused: UploadRefusal | null = null;

    for (const photo of await this.store.listPhotosAwaitingUpload()) {
      try {
        const uploaded = await this.transport.uploadPhoto(photo);
        if (uploaded === null) continue;
        await this.store.putPhoto(markUploaded(photo, uploaded.storageKey, this.clock));
        uploadedSomething = true;
      } catch (error) {
        const reason = refusalReasonFor(httpStatusOf(error));
        // Offline, or storage is down. The photo stays local and the next sync tries again;
        // nothing is lost and the picture still shows on this device.
        if (reason === null) continue;
        // The first refusal of the batch is the one kept. A full account refuses every
        // photo behind it for the same reason, and the last one is no more informative than
        // the first while being a worse answer to "which photo is stuck".
        refused ??= { reason, photoId: photo.id, at: Date.now() };
      }
    }

    // A successful upload is the only proof there is room again, and it outranks a refusal
    // seen earlier in the same pass: an account that just freed space can take some photos
    // and still be full for the rest, and "full" is the honest reading only once nothing
    // gets through. This is also what makes the banner leave by itself (28e).
    if (uploadedSomething) {
      await clearUploadRefusal(this.store);
      return;
    }
    if (refused !== null) await writeUploadRefusal(this.store, refused);
  }

  /**
   * Fetches the catalogue entries for copies this device holds but cannot describe, and
   * re-asks about the ones it can describe but has no sleeve for.
   *
   * A pulled copy names a release; it does not carry it. The catalogue is a shared cache
   * that sync deliberately does not move, so on a device that has just signed in every
   * copy arrives pointing at metadata it has never seen — a shelf of records with no
   * title, no artist and no sleeve. This is what fills that in.
   *
   * Asked over the whole local collection rather than only the page just pulled: a device
   * that synced before this existed already has the copies and is still missing the
   * releases, and it should heal on its next sync rather than only on the next new record.
   * The store is asked first, so the steady state is one local read and no request at all.
   */
  private async cacheMissingReleases(): Promise<ReleaseRefill> {
    const copies = await this.store.listCopies();
    const wanted = [
      ...new Set(
        copies
          .map(catalogueKeyOf)
          // A hand-entered release is derived from the copy itself and is in no catalogue.
          .filter((id): id is string => id !== null && !isManualReleaseId(id)),
      ),
    ];
    if (wanted.length === 0) return { cached: 0, missing: 0, unreachable: false };

    const held = await this.store.getReleases(wanted);
    const missing = wanted.filter((releaseId) => !held.has(releaseId));
    /*
     * Held, but with no artwork — asked about once, ever.
     *
     * The catalogue cache used to be one-way lossy about covers. The server recorded a
     * cover probe that never came back as "this release has no cover", served that as a
     * null URL, and the client wrote the null over the URL it already had: a record lost
     * its sleeve on both sides at once, permanently, and pulling to refresh could not
     * bring it back. The server no longer answers that way and re-probes, and
     * `mergeCachedRelease` stops the client throwing a cover away — but neither of those
     * puts back a picture that is already gone. This does.
     *
     * Once and then never again, because a record that really has no cover would otherwise
     * be asked about on every sync for ever, and the steady state of this method is meant
     * to be one local read and no request at all.
     */
    const repairing = (await this.store.readSetting(COVER_REPAIR_KEY)) !== COVER_REPAIR_DONE;
    const sleeveless = !repairing
      ? []
      : wanted.filter((releaseId) => {
          const release = held.get(releaseId);
          return release !== undefined && release.coverArtUrl === null;
        });
    const asking = [...missing, ...sleeveless];

    let cached = 0;
    let unreachable = false;
    for (let from = 0; from < asking.length; from += RELEASE_BATCH) {
      const batch = asking.slice(from, from + RELEASE_BATCH);
      try {
        const releases = await this.transport.fetchReleases(batch);
        if (releases.length > 0) await this.store.cacheReleases(releases);
        // Only rows that were absent count towards closing the gap: a refreshed sleeve is
        // not a record the shelf could not describe.
        cached += releases.filter((release) => !held.has(release.id)).length;
      } catch {
        // Offline, the mirror is down, or this one page was rejected. Carry on with the
        // rest rather than abandoning them: the batches are independent, and giving up on
        // the first failure left a large collection with only the pages before it — the
        // shelf then healed a hundred records per sync at best, and never at all if the
        // very first page was the one that failed.
        unreachable = true;
      }
    }
    // The repair counts as done only when every page of it came back. A device that ran it
    // while offline would otherwise spend its one attempt on nothing.
    if (repairing && !unreachable) {
      await this.store.writeSetting(COVER_REPAIR_KEY, COVER_REPAIR_DONE);
    }
    // Recounted from what is actually held rather than subtracted from `cached`: the
    // mirror answers with the releases it has and stays silent about the rest, so a page
    // that returned fewer rows than it was asked for is a success and a shortfall at once.
    return { cached, missing: missing.length - cached, unreachable };
  }

  /**
   * The catalogue rows behind a batch of copies, as far as this device holds them.
   *
   * Hand-entered releases are left out -- they are derived from the copy itself and belong
   * in no shared cache -- and so is anything this device cannot describe either, which is
   * simply nothing to send.
   */
  private async catalogueFor(copies: readonly Copy[]): Promise<Release[]> {
    const wanted = [
      ...new Set(
        copies
          .map(catalogueKeyOf)
          .filter((id): id is string => id !== null && !isManualReleaseId(id)),
      ),
    ];
    if (wanted.length === 0) return [];
    return [...(await this.store.getReleases(wanted)).values()];
  }

  /** Which of these releases the mirror can answer for, by id. */
  private async mirrored(releases: readonly Release[]): Promise<Set<string>> {
    const answered = await this.transport.fetchReleases(releases.map((release) => release.id));
    return new Set(answered.map((release) => release.id));
  }

  /**
   * Hands the server the catalogue behind copies it already has, once per device.
   *
   * Pushing a copy carries its release from now on, but a collection pushed before that
   * existed left the mirror with nothing -- and those copies are not pending any more, so
   * no ordinary push will ever mention them again. Every *other* device is then looking at
   * a shelf it cannot fill and never will, because ids the mirror has never seen are
   * absent from its answer rather than fetched.
   *
   * So a device that holds the catalogue offers it up once: ask which ids the mirror can
   * answer for, send the ones it cannot. Marked done afterwards, because in the steady
   * state this would be a whole-collection round trip on every single sync.
   */
  private async uploadUnmirroredCatalogue(): Promise<number> {
    if ((await this.store.readSetting(CATALOGUE_OFFERED)) === "true") return 0;

    const held = await this.catalogueFor(await this.store.listCopies());
    if (held.length === 0) {
      // Nothing to offer, and nothing to keep re-checking for either.
      await this.store.writeSetting(CATALOGUE_OFFERED, "true");
      return 0;
    }

    let offered = 0;
    let landed = true;
    for (let from = 0; from < held.length; from += RELEASE_BATCH) {
      const batch = held.slice(from, from + RELEASE_BATCH);
      const alreadyMirrored = await this.mirrored(batch);
      const unmirrored = batch.filter((release) => !alreadyMirrored.has(release.id));
      if (unmirrored.length === 0) continue;
      await this.transport.push([], [], [], unmirrored);
      // Asked again rather than assumed: a server too old to know the field answers 200 and
      // stores nothing, and this device gets exactly one go at offering. Taking that as
      // success is how the one repair a collection needs gets spent on nothing at all.
      const after = await this.mirrored(unmirrored);
      const accepted = unmirrored.filter((release) => after.has(release.id)).length;
      offered += accepted;
      if (accepted < unmirrored.length) landed = false;
    }
    // Only once the mirror can actually answer for them. A pass that threw, or one the
    // server quietly ignored, has to be able to say the same thing again next sync.
    if (landed) await this.store.writeSetting(CATALOGUE_OFFERED, "true");
    return offered;
  }

  /**
   * Fetches the bytes for every photo this device knows about but has never held.
   *
   * Over the whole collection, not over the photos this pass happened to pull. Scoped to
   * the pull it could only ever try once: a row that arrived before its bytes existed, or
   * whose download failed, cannot appear in a later pull, so "try again next sync" had no
   * next attempt and the picture was gone for good.
   *
   * And a missing file does not look like a missing photo. The art component is handed an
   * address for bytes that are not there, the image fails, and the copy falls back to the
   * catalogue's cover — so a photo starred on another device silently shows the pressing's
   * sleeve instead, and a hand-entered record, which has no catalogue to fall back to,
   * shows its format silhouette for ever.
   */
  private async downloadMissingPhotoBytes(): Promise<void> {
    for (const photo of await this.store.listAllPhotos()) {
      if (photo.storageKey === null || photo.deletedAt !== null) continue;
      if (await this.store.hasPhotoBytes(photo.id)) continue;
      try {
        await this.transport.downloadPhoto(photo);
      } catch {
        // Try again next sync — and now there really is one. The strip shows a placeholder
        // until then rather than failing the whole reconciliation over one image.
      }
    }
  }

  private async pushPending(): Promise<number> {
    await this.uploadPendingPhotos();
    const pendingIds = await this.store.readPendingIds();
    if (pendingIds.length === 0) return 0;

    // One pending set covers both kinds, so a session that added a record and wished for
    // another sends a single request rather than racing two.
    const copies: Copy[] = [];
    const wishes: WishlistItem[] = [];
    const photos: Photo[] = [];
    // Photos this pass gives up on for good. Everything else left out of the batch stays
    // pending and goes up on a later pass.
    const dropped: string[] = [];
    for (const id of pendingIds) {
      const copy = await this.store.getCopyIncludingDeleted(id);
      if (copy !== undefined) {
        copies.push(copy);
        continue;
      }
      const wish = await this.store.getWishlistItemIncludingDeleted(id);
      if (wish !== undefined) {
        wishes.push(wish);
        continue;
      }
      const photo = await this.store.getPhotoIncludingDeleted(id);
      if (photo === undefined) continue;
      if (photo.storageKey !== null) {
        photos.push(photo);
      } else if (photo.deletedAt !== null) {
        dropped.push(id);
      }
      // A live photo whose bytes never uploaded is simply left pending: pushing it would
      // show every other device a record it can never fetch, so it waits for the upload.
      //
      // A *deleted* one with no key is dropped, and that is the whole of the fix for a
      // phone that could not push for days.
      //
      // It is a photo deleted before its upload finished. `listPhotosAwaitingUpload` skips
      // tombstones, so the upload is never retried and the key stays null for ever, while
      // the tombstone kept being pushed as a delete that had to replicate. But there is
      // nothing on the far side to delete: a photo reaches the server by being uploaded,
      // so one that never uploaded is a picture no other device has ever heard of. The
      // tombstone was carrying a message about a record only this device knows -- and the
      // server, whose storage_key column was NOT NULL, answered every push containing it
      // with a 500. Push is one transaction and pending is only cleared on success, so
      // that one row rolled back every copy and wish in the batch and came back a minute
      // later to do it again. Deleting a photo one second after taking it froze the whole
      // device's push.
    }
    if (copies.length === 0 && wishes.length === 0 && photos.length === 0) {
      await this.settlePending(dropped);
      return 0;
    }

    const response = await this.transport.push(
      copies,
      wishes,
      photos,
      await this.catalogueFor(copies),
    );
    // Adopt whatever the server decided, so the two sides are byte-identical afterwards
    // and the next push does not resend the same records.
    for (const merged of response.copies) {
      await this.store.adoptCopy(merged);
    }
    for (const merged of response.wishes) {
      await this.store.adoptWishlistItem(merged);
    }
    for (const merged of response.photos) {
      await this.store.adoptPhoto(merged);
    }
    if (response.cursor > 0) {
      await this.store.writeSyncCursor(response.cursor);
    }
    await this.settlePending([
      ...dropped,
      ...copies.map((copy) => copy.id),
      ...wishes.map((wish) => wish.id),
      ...photos.map((photo) => photo.id),
    ]);
    return copies.length + wishes.length + photos.length;
  }

  /**
   * Forgets exactly what this pass settled, and nothing else.
   *
   * <p>Re-read rather than cleared: a push is a network round trip, and a record written
   * while it was in flight was marked pending during it. Writing an empty set at the end
   * threw that record away -- and nothing ever marks it pending a second time, so it lived
   * on that device alone for ever while every screen showed it as saved.
   */
  private async settlePending(settled: readonly string[]): Promise<void> {
    const done = new Set(settled);
    const remaining = (await this.store.readPendingIds()).filter((id) => !done.has(id));
    await this.store.writePendingIds(remaining);
  }

  /** Everything the device holds, of both kinds — they share one pending set. */
  private async allCopyIds(): Promise<string[]> {
    const copies = await this.store.listCopies();
    const wishes = await this.store.listWishlist();
    return [...copies.map((copy) => copy.id), ...wishes.map((wish) => wish.id)];
  }
}
