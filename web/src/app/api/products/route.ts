import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listProducts, createProduct } from "@/lib/products";

export async function GET() {
  return NextResponse.json(await listProducts());
}

const createSchema = z.object({
  name: z.string().min(1),
  price: z.number().int().nonnegative(),
  brand: z.string().optional(),
  description: z.string().optional(),
  ingredients: z.string().optional(),
  conditionTags: z.array(z.string()).optional(),
  imageUrl: z.string().optional(),
  stock: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const product = await createProduct({ ...parsed.data, pharmacistId: 1 });
  return NextResponse.json(product, { status: 201 });
}
