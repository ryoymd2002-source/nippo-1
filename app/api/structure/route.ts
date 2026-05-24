import { NextRequest, NextResponse } from "next/server";
import { structureReport } from "@/lib/ai-structure";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      transcript: string;
      site_hint?: string;
      report_date?: string;
    };
    const transcript = (body.transcript ?? "").trim();
    if (!transcript) {
      return NextResponse.json({ error: "transcript が空です" }, { status: 400 });
    }
    
    const result = await structureReport(transcript, body.site_hint, body.report_date);
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "サーバーエラー" }, { status: 500 });
  }
}
