// 식품안전나라 건강기능식품 품목제조신고(C003) 응답 → 우리 Product 스키마 매핑.
// C003 주요 필드: PRDLST_NM(제품명), BSSH_NM(업소명), RAWMTRL_NM(원재료),
//                 PRIMARY_FNCLTY(주된 기능성), NTK_MTHD(섭취방법)

// foodsafetykorea(C003) / data.go.kr(HtfsInfoService03) 필드명이 다르므로 둘 다 수용한다.
export type MfdsRow = {
  [key: string]: unknown;
};

function pick(row: MfdsRow, names: string[]): string | undefined {
  for (const n of names) {
    const v = row[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

export type MappedProduct = {
  name: string;
  brand?: string;
  price: number;
  stock: number;
  ingredients?: string;
  conditionTags: string[];
  description?: string;
  isActive: boolean;
};

// 기능성 문구 → 증상 태그 키워드 사전
const TAG_RULES: { tag: string; keywords: string[] }[] = [
  { tag: "피로", keywords: ["피로", "에너지", "활력", "원기"] },
  { tag: "면역", keywords: ["면역", "항산화"] },
  { tag: "눈건강", keywords: ["눈", "시력", "황반", "루테인", "망막"] },
  { tag: "수면", keywords: ["수면", "스트레스", "긴장", "이완"] },
  { tag: "장건강", keywords: ["장", "배변", "유산균", "프로바이오틱스", "유익균"] },
  { tag: "소화", keywords: ["소화", "위"] },
  { tag: "관절", keywords: ["관절", "연골", "뼈와 관절"] },
  { tag: "뼈건강", keywords: ["뼈", "골밀도", "칼슘"] },
  { tag: "혈행", keywords: ["혈행", "혈중", "콜레스테롤", "중성지방", "혈압", "혈당"] },
  { tag: "간건강", keywords: ["간"] },
  { tag: "피부", keywords: ["피부", "콜라겐", "보습"] },
  { tag: "근육경련", keywords: ["근육", "마그네슘"] },
];

export function deriveTags(text?: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const { tag, keywords } of TAG_RULES) {
    if (keywords.some((k) => text.includes(k))) found.add(tag);
  }
  return Array.from(found);
}

function trunc(s: string | undefined, n: number): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length > n ? t.slice(0, n) + "…" : t;
}

/**
 * C003 한 행을 상품으로 변환. 가격/재고는 약사가 정해야 하므로 0,
 * isActive=false 로 두어 약사가 검토·활성화하기 전까지 진열에 노출되지 않게 한다.
 * 제품명이 없으면 null 을 반환한다.
 */
export function mapMfdsRow(row: MfdsRow): MappedProduct | null {
  const name = pick(row, ["PRDLST_NM", "PRDUCT", "PRODUCT"]);
  if (!name) return null;
  const fnclty = pick(row, ["PRIMARY_FNCLTY", "INDIV_RAWMTRL_NM", "MAIN_FNCLTY"]);
  const brand = pick(row, ["BSSH_NM", "ENTRPS", "ENTRPS_NM"]);
  const ingredients = pick(row, ["RAWMTRL_NM", "STDR_STND", "SUNGSANG", "RAWMTRL"]);
  return {
    name,
    brand: trunc(brand, 60),
    price: 0,
    stock: 0,
    ingredients: trunc(ingredients, 200),
    conditionTags: deriveTags(`${fnclty ?? ""} ${name}`),
    description: trunc(fnclty, 300),
    isActive: false,
  };
}
