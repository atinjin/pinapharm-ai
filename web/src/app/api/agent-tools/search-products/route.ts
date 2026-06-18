import { NextRequest, NextResponse } from "next/server";
import { searchProducts, parseTags } from "@/lib/products";

function csv(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const arr = v.split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}
function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// 에이전트 전용 내부 도구. 컨텍스트 기반 구조화 제품 검색(증상·키워드·성분·제형·용량·제외 알레르겐).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const products = await searchProducts({
    condition: sp.get("condition") ?? undefined,
    keyword: sp.get("keyword") ?? undefined,
    form: sp.get("form") ?? undefined,
    minDose: num(sp.get("minDose")),
    maxDose: num(sp.get("maxDose")),
    ingredients: csv(sp.get("ingredients")),
    excludeAllergens: csv(sp.get("excludeAllergens")),
  });
  return NextResponse.json(
    products.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      price: p.price,
      description: p.description,
      ingredients: p.ingredients,
      form: p.form,
      doseAmount: p.doseAmount,
      doseUnit: p.doseUnit,
      conditionTags: parseTags(p.conditionTags),
      stock: p.stock,
      imageUrl: p.imageUrl,
    }))
  );
}
