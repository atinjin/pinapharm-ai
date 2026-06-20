import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "체크아웃은 준비 중입니다." }, { status: 501 });
}
