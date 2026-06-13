import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateProduct, deleteProduct } from "@/lib/products";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  price: z.number().int().nonnegative().optional(),
  brand: z.string().optional(),
  description: z.string().optional(),
  ingredients: z.string().optional(),
  conditionTags: z.array(z.string()).optional(),
  imageUrl: z.string().optional(),
  stock: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json(await updateProduct(Number(id), parsed.data));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteProduct(Number(id));
  return NextResponse.json({ ok: true });
}
