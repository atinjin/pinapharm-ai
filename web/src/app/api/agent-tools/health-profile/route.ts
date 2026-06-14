import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveCustomer, getHealthProfile, saveHealthProfile } from "@/lib/customers";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });
  const customerId = await resolveCustomer(sessionId);
  return NextResponse.json(await getHealthProfile(customerId));
}

const saveSchema = z.object({
  session_id: z.string().min(1),
  ageBand: z.string().optional(),
  sex: z.string().optional(),
  conditions: z.array(z.string()).optional(),
  medications: z.array(z.string()).optional(),
  allergies: z.array(z.string()).optional(),
  pregnancy: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = saveSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { session_id, ...input } = parsed.data;
  const customerId = await resolveCustomer(session_id);
  return NextResponse.json(await saveHealthProfile(customerId, input));
}
