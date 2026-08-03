import { describe, expect, it, vi } from "vitest";
import { chunksOf, loadAllSupabasePages } from "@/lib/supabase-pagination";

describe("Supabase pagination", () => {
  it("continues beyond the API row cap until a short page", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => index);
    const loadPage = vi.fn(async (from: number) => ({
      data: from === 0 ? firstPage : [500],
      error: null
    }));

    await expect(loadAllSupabasePages(loadPage)).resolves.toHaveLength(501);
    expect(loadPage).toHaveBeenNthCalledWith(1, 0, 499);
    expect(loadPage).toHaveBeenNthCalledWith(2, 500, 999);
  });

  it("chunks large student filters without issuing one query per student", () => {
    expect(chunksOf(Array.from({ length: 205 }, (_, index) => index))).toHaveLength(3);
  });
});
