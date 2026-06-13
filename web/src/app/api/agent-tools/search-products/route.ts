import { NextRequest, NextResponse } from "next/server";
import { searchProducts, parseTags } from "@/lib/products";

// 에이전트 전용 내부 도구. 증상/키워드로 활성 영양제를 검색해 반환.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const condition = sp.get("condition") ?? undefined;
  const keyword = sp.get("keyword") ?? undefined;
  const products = await searchProducts({ condition, keyword });
  return NextResponse.json(
    products.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      price: p.price,
      description: p.description,
      ingredients: p.ingredients,
      conditionTags: parseTags(p.conditionTags),
      stock: p.stock,
    }))
  );
}
