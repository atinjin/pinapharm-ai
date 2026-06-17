import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listDocuments } from "@/lib/knowledgeAdmin";
import { createDocument } from "@/lib/knowledge";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category") || undefined;
  const q = sp.get("q") || undefined;
  const reviewedParam = sp.get("reviewed");
  const reviewed = reviewedParam === null ? undefined : reviewedParam === "true";
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const take = 20;
  const { rows, total } = await listDocuments({ category, q, reviewed, skip: (page - 1) * take, take });
  return NextResponse.json({ rows, total, page, pageSize: take });
}

const createSchema = z.object({
  category: z.string().optional(),
  title: z.string().min(1),
  body: z.string().min(1),
  source: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const res = await createDocument(parsed.data);
  return NextResponse.json(res, { status: 201 });
}
