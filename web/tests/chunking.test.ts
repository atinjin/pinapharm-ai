import { describe, it, expect } from "vitest";
import { chunk } from "@/lib/chunking";

describe("chunk", () => {
  it("returns [] for empty/whitespace", () => {
    expect(chunk("")).toEqual([]);
    expect(chunk("   \n  ")).toEqual([]);
  });

  it("returns single chunk when under maxChars", () => {
    expect(chunk("짧은 문장입니다.", { maxChars: 500 })).toEqual(["짧은 문장입니다."]);
  });

  it("packs paragraphs greedily up to maxChars", () => {
    const text = ["A".repeat(30), "B".repeat(30), "C".repeat(30)].join("\n\n");
    const out = chunk(text, { maxChars: 70, overlap: 10 });
    expect(out.length).toBe(2); // A+B(62) | C(30)
    out.forEach((c) => expect(c.length).toBeLessThanOrEqual(70));
    expect(out.join("")).toContain("A".repeat(30));
    expect(out.join("")).toContain("C".repeat(30));
  });

  it("hard-splits a long paragraph with overlap", () => {
    const body = Array.from({ length: 120 }, (_, i) => String(i % 10)).join(""); // distinct positions
    const out = chunk(body, { maxChars: 50, overlap: 10 });
    expect(out.length).toBe(3); // [0,50) [40,90) [80,120)
    out.forEach((c) => expect(c.length).toBeLessThanOrEqual(50));
    // consecutive chunks overlap by `overlap` chars
    expect(out[0].slice(-10)).toBe(out[1].slice(0, 10));
    expect(out[1].slice(-10)).toBe(out[2].slice(0, 10));
  });
});
