import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Copy } from "../domain/types.js";
import { useCopyEditorLogic } from "./useCopyEditorLogic.js";

function copy(overrides: Partial<Copy> = {}): Copy {
  return {
    id: "copy-1",
    releaseId: "rel-1",
    pendingBarcode: null,
    manualTitle: null,
    manualArtist: null,
    manualYear: null,
    manualLabel: null,
    manualCatalogNumber: null,
    manualFormat: null,
    condition: "VG_PLUS",
    sleeveCondition: "NM",
    catalogArt: "AUTO",
    pricePaidCents: 2800,
    currency: "EUR",
    purchasedOn: "2026-08-14",
    purchasedAt: "Concerto, Amsterdam",
    notes: "Gatefold.",
    notesConflict: null,
    rating: 4,
    hidden: false,
    sortIndex: null,
    createdAt: 1000,
    deletedAt: null,
    fieldClocks: {} as Copy["fieldClocks"],
    ...overrides,
  };
}

describe("useCopyEditorLogic", () => {
  it("starts from what the copy already holds", () => {
    const { result } = renderHook(() => useCopyEditorLogic(copy(), vi.fn()));

    expect(result.current.fields).toEqual({
      condition: "VG_PLUS",
      sleeveCondition: "NM",
      price: "28.00",
      purchasedOn: "2026-08-14",
      purchasedAt: "Concerto, Amsterdam",
      rating: 4,
      notes: "Gatefold.",
      // The pressing fields exist on every copy and stay blank on a matched one — the
      // form only offers them where they are the copy's to answer.
      title: "",
      artist: "",
      year: "",
      label: "",
      catalogNumber: "",
      format: "",
    });
  });

  it("saves what was typed", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useCopyEditorLogic(copy(), onSave));

    act(() => result.current.set("price", "34,50"));
    act(() => result.current.set("condition", "NM"));
    act(() => result.current.submit());

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ pricePaidCents: 3450, condition: "NM" }),
    );
  });

  it("turns cleared fields into nulls rather than empty strings", () => {
    // "Not recorded" has to be null, or the detail screen shows a blank where it should
    // show an em dash, and sync stores an empty string as a real value.
    const onSave = vi.fn();
    const { result } = renderHook(() => useCopyEditorLogic(copy(), onSave));

    act(() => result.current.set("price", ""));
    act(() => result.current.set("purchasedAt", "   "));
    act(() => result.current.set("notes", ""));
    act(() => result.current.set("condition", ""));
    act(() => result.current.submit());

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        pricePaidCents: null,
        purchasedAt: null,
        notes: null,
        condition: null,
      }),
    );
  });

  it("refuses to save an unparseable price and says so", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useCopyEditorLogic(copy(), onSave));

    act(() => result.current.set("price", "about thirty quid"));
    act(() => result.current.submit());

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.priceInvalid).toBe(true);
  });

  it("refuses a date that is not a date", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useCopyEditorLogic(copy(), onSave));

    act(() => result.current.set("purchasedOn", "2026-02-30"));
    act(() => result.current.submit());

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.dateInvalid).toBe(true);
  });

  it("clears the error once the field is edited again", () => {
    const { result } = renderHook(() => useCopyEditorLogic(copy(), vi.fn()));

    act(() => result.current.set("price", "nonsense"));
    act(() => result.current.submit());
    expect(result.current.priceInvalid).toBe(true);

    act(() => result.current.set("price", "12.00"));
    expect(result.current.priceInvalid).toBe(false);
  });

  it("restores the original values on reset", () => {
    const { result } = renderHook(() => useCopyEditorLogic(copy(), vi.fn()));

    act(() => result.current.set("notes", "something else"));
    act(() => result.current.reset());

    expect(result.current.fields.notes).toBe("Gatefold.");
  });

  it("can record a free record without it looking unrecorded", () => {
    // Zero and "not recorded" are different facts about a record.
    const onSave = vi.fn();
    const { result } = renderHook(() => useCopyEditorLogic(copy(), onSave));

    act(() => result.current.set("price", "0"));
    act(() => result.current.submit());

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ pricePaidCents: 0 }));
  });

  it("starts blank for a copy that has nothing recorded yet", () => {
    const { result } = renderHook(() =>
      useCopyEditorLogic(
        copy({
          condition: null,
          sleeveCondition: null,
          pricePaidCents: null,
          purchasedOn: null,
          purchasedAt: null,
          notes: null,
          rating: null,
        }),
        vi.fn(),
      ),
    );

    expect(result.current.fields).toEqual({
      condition: "",
      sleeveCondition: "",
      price: "",
      purchasedOn: "",
      purchasedAt: "",
      rating: null,
      notes: "",
      title: "",
      artist: "",
      year: "",
      label: "",
      catalogNumber: "",
      format: "",
    });
  });

  describe("a hand-entered copy", () => {
    const manual = () =>
      copy({
        releaseId: "local:copy-1",
        manualTitle: "Untitled live tape",
        manualArtist: "Sun Ra Arkestra",
        manualYear: 1978,
        manualFormat: "CASSETTE",
      });

    it("offers the pressing's own fields, and says so", () => {
      const { result } = renderHook(() => useCopyEditorLogic(manual(), vi.fn()));

      expect(result.current.manual).toBe(true);
      expect(result.current.fields.title).toBe("Untitled live tape");
      expect(result.current.fields.year).toBe("1978");
    });

    it("saves a corrected year as a number, not the string that was typed", () => {
      const onSave = vi.fn();
      const { result } = renderHook(() => useCopyEditorLogic(manual(), onSave));

      act(() => result.current.set("year", "1979"));
      act(() => result.current.submit());

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ manualYear: 1979 }));
    });

    it("will not save itself out of a name", () => {
      const onSave = vi.fn();
      const { result } = renderHook(() => useCopyEditorLogic(manual(), onSave));

      act(() => result.current.set("title", "  "));

      expect(result.current.canSave).toBe(false);
      act(() => result.current.submit());
      expect(onSave).not.toHaveBeenCalled();
    });

    it("sends no pressing fields at all for a copy matched to a release", () => {
      // Stamping six fields nobody edited would let this save start winning conflicts
      // against another device's real edits.
      const onSave = vi.fn();
      const { result } = renderHook(() => useCopyEditorLogic(copy(), onSave));

      act(() => result.current.submit());

      expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("manualTitle");
    });
  });

  describe("the format of a matched copy", () => {
    it("starts at what the catalogue says", () => {
      const { result } = renderHook(() => useCopyEditorLogic(copy(), vi.fn(), "VINYL"));

      expect(result.current.fields.format).toBe("VINYL");
    });

    it("starts at the copy's own answer once it has one", () => {
      const { result } = renderHook(() =>
        useCopyEditorLogic(copy({ manualFormat: "CASSETTE" }), vi.fn(), "VINYL"),
      );

      expect(result.current.fields.format).toBe("CASSETTE");
    });

    it("saves a format the catalogue does not claim", () => {
      // The tape of a record MusicBrainz only knows as vinyl.
      const onSave = vi.fn();
      const { result } = renderHook(() => useCopyEditorLogic(copy(), onSave, "VINYL"));

      act(() => result.current.set("format", "CASSETTE"));
      act(() => result.current.submit());

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ manualFormat: "CASSETTE" }));
      // Still only the format: the other five pressing fields belong to the archive here.
      expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("manualTitle");
    });

    it("takes the override off again when the catalogue's own format is picked", () => {
      const onSave = vi.fn();
      const { result } = renderHook(() =>
        useCopyEditorLogic(copy({ manualFormat: "CASSETTE" }), onSave, "VINYL"),
      );

      act(() => result.current.set("format", "VINYL"));
      act(() => result.current.submit());

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ manualFormat: null }));
    });

    it("sends no format at all when it was not touched", () => {
      // Restamping an untouched field would let this save win a merge it never fought.
      const onSave = vi.fn();
      const { result } = renderHook(() =>
        useCopyEditorLogic(copy({ manualFormat: "CASSETTE" }), onSave, "VINYL"),
      );

      act(() => result.current.set("notes", "Still a tape."));
      act(() => result.current.submit());

      expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("manualFormat");
    });
  });
});
