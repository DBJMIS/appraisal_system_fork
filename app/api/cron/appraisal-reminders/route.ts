import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireHrOrAdmin } from "@/lib/route-guards";
import { runAppraisalReminders } from "@/lib/appraisal-reminder-delivery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CronAuth = "valid" | "invalid" | "absent";

/**
 * Checks the scheduler secret (CRON_SECRET) from `Authorization: Bearer <secret>` (Vercel Cron) or
 * `x-cron-secret` (the header the app's other scheduled jobs use). Constant-time comparison.
 */
function cronAuth(req: NextRequest): CronAuth {
  const auth = req.headers.get("authorization");
  const provided = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : req.headers.get("x-cron-secret")?.trim();
  if (!provided) return "absent";
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return "invalid";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) ? "valid" : "invalid";
}

const unauthorized = () => NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });

async function run(dryRun: boolean, source: "cron" | "manual", actor?: string) {
  try {
    const summary = await runAppraisalReminders(createClient(), { dryRun });
    if (source === "manual") {
      console.info("[appraisal-reminders] manual run", { actor, dryRun, date: summary.date });
    }
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[appraisal-reminders] run failed:", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ error: "The reminder check could not be completed.", code: "RUN_FAILED" }, { status: 500 });
  }
}

/** GET /api/cron/appraisal-reminders: the daily scheduled run (Vercel Cron). Scheduler secret only. */
export async function GET(req: NextRequest) {
  if (cronAuth(req) !== "valid") return unauthorized();
  return run(false, "cron");
}

/**
 * POST /api/cron/appraisal-reminders: scheduler (secret) or HR/Admin manual run.
 * Body (optional): { dryRun: true } previews the run without creating deliveries, emails or notifications.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { dryRun?: unknown };
  const dryRun = body?.dryRun === true;

  const cron = cronAuth(req);
  if (cron === "valid") return run(dryRun, "cron");
  if (cron === "invalid") return unauthorized();

  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;
  return run(dryRun, "manual", guard.user.id);
}
