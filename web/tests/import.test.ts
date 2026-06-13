import { describe, it, expect } from "vitest";
import { parseCsv, parseProductCsv, SAMPLE_CSV } from "@/lib/csv";
import { deriveTags, mapMfdsRow } from "@/lib/mfds";

describe("parseCsv", () => {
  it("따옴표 안의 쉼표를 한 필드로 처리한다", () => {
    const t = parseCsv('a,"b,c",d');
    expect(t[0]).toEqual(["a", "b,c", "d"]);
  });
  it("이스케이프된 따옴표를 처리한다", () => {
    const t = parseCsv('"he said ""hi""",x');
    expect(t[0]).toEqual(['he said "hi"', "x"]);
  });
});

describe("parseProductCsv", () => {
  it("샘플 CSV를 행으로 파싱한다", () => {
    const { rows, errors } = parseProductCsv(SAMPLE_CSV);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(3);
    expect(rows[0].name).toBe("종근당 락토핏 골드");
    expect(rows[0].price).toBe(12900);
    expect(rows[0].conditionTags).toEqual(["장건강", "소화"]);
  });
  it("price가 비거나 잘못되면 에러로 모은다", () => {
    const { rows, errors } = parseProductCsv("name,price\n비타민,abc\n오메가3,1000");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("오메가3");
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
  });
  it("필수 헤더가 없으면 에러를 반환한다", () => {
    const { errors } = parseProductCsv("foo,bar\n1,2");
    expect(errors.length).toBeGreaterThan(0);
  });
  it("가격의 콤마/원 표기를 정규화한다", () => {
    const { rows } = parseProductCsv("name,price\n비타민,\"18,000원\"");
    expect(rows[0].price).toBe(18000);
  });
});

describe("deriveTags", () => {
  it("기능성 문구에서 태그를 추론한다", () => {
    expect(deriveTags("눈 건강과 피로 개선에 도움")).toEqual(expect.arrayContaining(["눈건강", "피로"]));
  });
  it("관련 키워드가 없으면 빈 배열", () => {
    expect(deriveTags("기타 표시 없음")).toEqual([]);
  });
});

describe("mapMfdsRow", () => {
  it("C003 행을 상품으로 매핑한다 (가격0·비활성)", () => {
    const m = mapMfdsRow({
      PRDLST_NM: "프로바이오틱스",
      BSSH_NM: "헬스컴퍼니",
      RAWMTRL_NM: "유산균 100억",
      PRIMARY_FNCLTY: "장 건강에 도움을 줄 수 있음",
    });
    expect(m).not.toBeNull();
    expect(m!.name).toBe("프로바이오틱스");
    expect(m!.brand).toBe("헬스컴퍼니");
    expect(m!.price).toBe(0);
    expect(m!.isActive).toBe(false);
    expect(m!.conditionTags).toContain("장건강");
  });
  it("제품명이 없으면 null", () => {
    expect(mapMfdsRow({ BSSH_NM: "x" })).toBeNull();
  });
});
