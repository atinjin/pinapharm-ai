import { describe, it, expect } from "vitest";
import { parseTags, stringifyTags, matchesQuery } from "@/lib/products";

describe("conditionTags 직렬화", () => {
  it("JSON 문자열을 배열로 파싱한다", () => {
    expect(parseTags('["피로","눈건강"]')).toEqual(["피로", "눈건강"]);
  });
  it("잘못된 JSON은 빈 배열로 처리한다", () => {
    expect(parseTags("not-json")).toEqual([]);
  });
  it("배열을 JSON 문자열로 직렬화한다", () => {
    expect(stringifyTags(["피로"])).toBe('["피로"]');
  });
});

describe("matchesQuery", () => {
  const product = {
    name: "비타민C 1000",
    description: "피로 회복에 도움",
    conditionTags: '["피로","면역"]',
  };
  it("이름에 키워드가 포함되면 매칭", () => {
    expect(matchesQuery(product, "비타민")).toBe(true);
  });
  it("태그에 키워드가 포함되면 매칭", () => {
    expect(matchesQuery(product, "면역")).toBe(true);
  });
  it("관련 없는 키워드는 비매칭", () => {
    expect(matchesQuery(product, "관절")).toBe(false);
  });
});
