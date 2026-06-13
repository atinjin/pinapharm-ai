import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createManyProducts } from "@/lib/products";

const rowSchema = z.object({
  name: z.string().min(1),
  price: z.number().int().nonnegative(),
  brand: z.string().optional(),
  description: z.string().optional(),
  ingredients: z.string().optional(),
  conditionTags: z.array(z.string()).optional(),
  imageUrl: z.string().optional(),
  stock: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

const bodySchema = z.object({ products: z.array(rowSchema).min(1).max(2000) });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = await createManyProducts(parsed.data.products);
  return NextResponse.json(result, { status: 201 });
}
