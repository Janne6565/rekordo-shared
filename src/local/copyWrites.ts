import { type Hlc, hlcEncode } from "../domain/hlc.js";
import { EMPTY_MANUAL_RELEASE } from "../domain/manualRelease.js";
import type { Copy, CopyMergeableField, ManualRelease, Release } from "../domain/types.js";
import { COPY_MERGEABLE_FIELDS, manualReleaseId } from "../domain/types.js";

export interface CopyDraft {
  readonly condition: Copy["condition"];
  readonly sleeveCondition: Copy["sleeveCondition"];
  readonly catalogArt: Copy["catalogArt"];
  readonly pricePaidCents: Copy["pricePaidCents"];
  readonly currency: string;
  readonly purchasedOn: Copy["purchasedOn"];
  readonly purchasedAt: Copy["purchasedAt"];
  readonly notes: Copy["notes"];
  readonly rating: Copy["rating"];
}

export interface ClockSource {
  /** Advances the device clock and returns the new stamp. */
  next(): Hlc;
}

/**
 * Creates a copy with every mergeable field stamped.
 *
 * Stamping all of them at creation — rather than leaving them unstamped until first edit —
 * means a merge never has to special-case "this field has no clock", which would otherwise
 * be indistinguishable from "this field is older than everything".
 */
export function createCopy(
  release: Release,
  draft: CopyDraft,
  clock: ClockSource,
  now: number,
  id: string,
): Copy {
  return stampedCopy(release.albumId, release.id, EMPTY_MANUAL_RELEASE, draft, clock, now, id);
}

/**
 * Creates a copy of a record whose pressing nobody has chosen.
 *
 * The common case, and the reason `Copy.releaseId` is nullable: someone searched for a
 * record, recognised it and put it on the shelf. Writing a pressing here anyway -- the one
 * the catalogue ranked first, say -- would record a guess as an answer, and the person
 * would have no way to tell later which of their copies they had actually chosen a pressing
 * for. Null says the honest thing, and the pressing can still be picked afterwards.
 */
export function createAlbumCopy(
  album: { readonly albumId: string },
  draft: CopyDraft,
  clock: ClockSource,
  now: number,
  id: string,
): Copy {
  return stampedCopy(album.albumId, null, EMPTY_MANUAL_RELEASE, draft, clock, now, id);
}

function stampedCopy(
  albumId: string | null,
  releaseId: string | null,
  manual: ManualRelease,
  draft: CopyDraft,
  clock: ClockSource,
  now: number,
  id: string,
  pendingBarcode: string | null = null,
): Copy {
  const stamp = hlcEncode(clock.next());
  const fieldClocks = Object.fromEntries(
    COPY_MERGEABLE_FIELDS.map((field) => [field, stamp]),
  ) as Copy["fieldClocks"];

  return {
    id,
    albumId,
    releaseId,
    ...manual,
    pendingBarcode,
    condition: draft.condition,
    sleeveCondition: draft.sleeveCondition,
    catalogArt: draft.catalogArt,
    pricePaidCents: draft.pricePaidCents,
    currency: draft.currency,
    purchasedOn: draft.purchasedOn,
    purchasedAt: draft.purchasedAt,
    notes: draft.notes,
    notesConflict: null,
    rating: draft.rating,
    hidden: false,
    // Unplaced, which is not position 0 -- a record filed onto a hand-arranged shelf
    // belongs where new records belong, not at the front of an order it was never part of.
    sortIndex: null,
    createdAt: now,
    deletedAt: null,
    fieldClocks,
  };
}

/**
 * Creates a copy of a pressing no catalogue has, described entirely by what was typed.
 *
 * The same shape as {@link createCopy} in every respect that matters — every mergeable
 * field stamped once, at creation — except that the release facts come from the person
 * instead of from a `Release`, and the release id is the copy's own (see
 * {@link manualReleaseId}).
 */
export function createManualCopy(
  manual: ManualRelease,
  draft: CopyDraft,
  clock: ClockSource,
  now: number,
  id: string,
): Copy {
  return stampedCopy(manualReleaseId(id), manualReleaseId(id), manual, draft, clock, now, id);
}

/**
 * Creates a copy from a barcode nobody could look up yet.
 *
 * A manual copy in every structural respect — its release id is its own, because until the
 * lookup succeeds no catalogue release exists to point at — but with none of the pressing
 * typed in, since nobody typed anything. What it does carry is the number and, when the
 * person set one on the confirm card, the format; both survive the resolution, the format
 * because {@link copyFormat} lets a copy disagree with the catalogue about the object in
 * hand.
 */
export function createScannedCopy(
  barcode: string,
  format: Copy["manualFormat"],
  draft: CopyDraft,
  clock: ClockSource,
  now: number,
  id: string,
): Copy {
  return stampedCopy(
    manualReleaseId(id),
    manualReleaseId(id),
    { ...EMPTY_MANUAL_RELEASE, manualFormat: format },
    draft,
    clock,
    now,
    id,
    barcode,
  );
}

/**
 * The write that turns an identified scan into an ordinary copy.
 *
 * One patch, so `releaseId` and `pendingBarcode` are restamped together: as two writes a
 * device could crash between them and leave a copy that points at a release while still
 * claiming to be waiting for one, and a merge with a peer mid-way through would make that
 * state durable.
 */
export function resolveScannedCopy(
  copy: Copy,
  releaseId: string,
  albumId: string,
  clock: ClockSource,
): Copy {
  return applyCopyPatch(copy, { albumId, releaseId, pendingBarcode: null }, clock);
}

/**
 * What an edit can change: the copy's own facts, and — on a manual copy — the pressing's.
 *
 * One patch type rather than two write paths, because the two are edited in the same form
 * and saved by the same press. `applyCopyPatch` restamps per key either way.
 */
export type CopyPatch = Partial<
  CopyDraft &
    ManualRelease &
    Pick<Copy, "hidden" | "albumId" | "releaseId" | "pendingBarcode" | "sortIndex">
>;

/**
 * Applies a patch, restamping only the fields whose value actually changed.
 *
 * This is the whole point of field-level merge: editing the condition on one device and
 * the price on another leaves each field carrying its own clock, so both edits survive.
 * Restamping untouched fields would destroy that — a no-op save on one device would start
 * winning conflicts against real edits made elsewhere.
 */
export function applyCopyPatch(copy: Copy, patch: CopyPatch, clock: ClockSource): Copy {
  const changed = (Object.keys(patch) as (keyof CopyPatch)[]).filter(
    (key) => patch[key] !== undefined && patch[key] !== copy[key],
  );
  if (changed.length === 0) {
    return copy;
  }

  const stamp = hlcEncode(clock.next());
  const fieldClocks = { ...copy.fieldClocks };
  const updated: Record<string, unknown> = { ...copy };
  if (changed.includes("notes")) {
    // Writing the notes is how a person resolves a conflict: they have seen both versions
    // and chosen what the text should say, so the other one stops being pending.
    updated.notesConflict = null;
  }
  for (const key of changed) {
    fieldClocks[key as CopyMergeableField] = stamp;
    // Assigned key by key rather than by spreading `patch`: a patch carrying an explicit
    // `undefined` for an untouched field would otherwise overwrite the real value with it.
    updated[key] = patch[key];
  }

  return { ...updated, fieldClocks } as Copy;
}

/**
 * Puts a tombstoned copy back.
 *
 * The mirror of {@link tombstoneCopy}, and stamped the same way for the same reason: the
 * restore has to be *newer* than the delete or the merge would keep choosing the delete
 * and the record would vanish again on the next sync. Nothing else about the copy is
 * touched — undoing a delete is not an edit, and restamping its fields would let a stale
 * value win somewhere it should not.
 */
export function restoreCopy(copy: Copy, clock: ClockSource): Copy {
  return {
    ...copy,
    deletedAt: null,
    fieldClocks: { ...copy.fieldClocks, deletedAt: hlcEncode(clock.next()) },
  };
}

/** Tombstones a copy. The delete is itself a stamped field, so it can lose a merge. */
export function tombstoneCopy(copy: Copy, clock: ClockSource, now: number): Copy {
  return {
    ...copy,
    deletedAt: now,
    fieldClocks: { ...copy.fieldClocks, deletedAt: hlcEncode(clock.next()) },
  };
}
