import type { LocalStore } from "./LocalStore.js";
import type { ClockSource } from "./copyWrites.js";
import { tombstonePhoto } from "./photoWrites.js";

/**
 * How long a removed record's photos are left alone before they are put down too.
 *
 * Well past `UNDO_HOLD`: Undo restores the record and nothing else, so a photo deleted
 * inside that window would not come back with it -- the server removes the bytes as soon
 * as a photo's tombstone syncs. Two minutes also covers a device whose clock runs a little
 * ahead of the one that removed the record.
 */
export const ORPHAN_PHOTO_GRACE_MS = 2 * 60 * 1000;

/**
 * Puts down every live photo whose copy or wish was removed more than the grace ago.
 *
 * Removing a copy has only ever tombstoned the copy, so its photos stayed live: still
 * counted against the storage allowance, still in the bucket, reachable by nothing. A wish
 * held its picture back for the length of the undo bar, and lost it for good if the app
 * died in between. Both now end here, on every client, through the stamped write path, so
 * the deletes sync like any other edit and the server removes the bytes.
 *
 * A photo whose owner this device has never seen is left alone: an owner missing locally
 * is a pull still under way, not a removal, and deleting there would be deleting blind.
 *
 * @returns how many photos were put down
 */
export async function sweepOrphanPhotos(
  store: LocalStore,
  clock: ClockSource,
  now: number,
): Promise<number> {
  const photos = await store.listAllPhotos();
  const removedAt = new Map<string, number | null | undefined>();

  const ownerRemovedAt = async (kind: "copy" | "wish", id: string) => {
    const key = `${kind}:${id}`;
    if (!removedAt.has(key)) {
      const owner =
        kind === "copy"
          ? await store.getCopyIncludingDeleted(id)
          : await store.getWishlistItemIncludingDeleted(id);
      removedAt.set(key, owner?.deletedAt);
    }
    return removedAt.get(key);
  };

  let swept = 0;
  for (const photo of photos) {
    if (photo.deletedAt !== null) continue;
    const at =
      photo.copyId !== null
        ? await ownerRemovedAt("copy", photo.copyId)
        : photo.wishId !== null
          ? await ownerRemovedAt("wish", photo.wishId)
          : undefined;
    if (at === undefined || at === null || now - at < ORPHAN_PHOTO_GRACE_MS) continue;

    await store.putPhoto(tombstonePhoto(photo, clock, now));
    // The bytes on this device go too, as they do when a pulled tombstone arrives.
    await store.deletePhotoBytes(photo.id);
    swept += 1;
  }
  return swept;
}
