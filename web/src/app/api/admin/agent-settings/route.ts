import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAgentSettings, setAgentSettings } from "@/lib/agentConfig";

export async function GET() {
  return NextResponse.json(await getAgentSettings());
}

const updateSchema = z.object({
  persona: z.string().optional(),
  system_prompt: z.string().optional(),
  emergency_message: z.string().optional(),
  triage_prompt: z.string().optional(),
});

export async function PUT(req: NextRequest) {
  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json(await setAgentSettings(parsed.data));
}
