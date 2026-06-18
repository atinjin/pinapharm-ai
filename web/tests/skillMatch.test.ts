import { describe, it, expect } from "vitest";
import { scoreSkills } from "@/lib/skillMatch";

const skills = [
  { id: 1, name: "감기-초기-상담", description: "콧물·기침 등 초기 감기 상담" },
  { id: 2, name: "수면-상담", description: "불면·수면 문제 상담" },
];

describe("scoreSkills", () => {
  it("ranks by token overlap and reports matched tokens (handles 조사)", () => {
    const r = scoreSkills("콧물이 나고 기침이 심해요", skills);
    expect(r[0].id).toBe(1);
    expect(r[0].matched).toEqual(expect.arrayContaining(["콧물", "기침"]));
    expect(r[0].score).toBeGreaterThanOrEqual(2);
  });

  it("returns empty when nothing overlaps", () => {
    expect(scoreSkills("관절 통증", skills)).toEqual([]);
  });
});
