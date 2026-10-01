import { NextResponse } from "next/server";
import { requireHrOrAdmin } from "@/lib/route-guards";

/**
 * Proxies GET to AchieveIt exports/plans (no planId) to list plans the API key can access.
 * AchieveIt may or may not support this; response is passed through as-is.
 */
export async function GET() {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;

  const apiKey = process.env.ACHIEVEIT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AchieveIt is not configured" }, { status: 503 });
  }

  const url = "https://api.achieveit.com/exports/plans";
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
    console.error("[api/achieveit/plans]", err);
    return NextResponse.json({ error: "Request failed" }, { status: 502 });
  }
}
