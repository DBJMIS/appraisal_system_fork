import { NextRequest, NextResponse } from "next/server";
import { requireHrOrAdmin } from "@/lib/route-guards";

/**
 * Proxies GET Export Plan Items to AchieveIt so the browser can receive plan data (avoids CORS).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;

  const apiKey = process.env.ACHIEVEIT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AchieveIt is not configured" }, { status: 503 });
  }

  const { planId } = await params;
  if (!planId) {
    return NextResponse.json({ error: "planId required" }, { status: 400 });
  }
  const url = `https://api.achieveit.com/exports/plans/${encodeURIComponent(planId)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `API-KEY ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
    const text = await res.text();
    try {
      const data = text ? JSON.parse(text) : {};
      return NextResponse.json(data, { status: res.status });
    } catch {
      return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("Content-Type") || "text/plain" },
      });
    }
  } catch (err) {
    console.error("[api/achieveit/plans/[planId]]", err);
    return NextResponse.json({ error: "Request failed" }, { status: 502 });
  }
}
