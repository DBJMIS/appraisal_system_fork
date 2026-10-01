import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { MIDYEAR_FIELD_DEFAULTS, parseMidyearFields, resolveMidyearChange } from "@/lib/midyear-config";
import {
  changedCycleReminderFields,
  parseCycleReminderFields,
  reminderSettingsWriteError,
} from "@/lib/appraisal-reminder-policy";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function requireHrAdmin() {
  const user = await getCurrentUser();
  if (!user?.roles?.length) return null;
  const isAdmin = user.roles.some((r) => r === "hr" || r === "admin");
  return isAdmin ? user : null;
}

/**
 * GET /api/admin/cycles
 * List all appraisal cycles. Uses service role so hr/admin see all cycles (including new ones with no appraisals).
 */
export async function GET() {
  try {
    const user = await requireHrAdmin();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }
    const { data, error } = await supabase
      .from("appraisal_cycles")
      .select("*")
      .order("end_date", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : "List cycles failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/cycles
 * Create a new appraisal cycle and its review types. Uses service role to bypass RLS.
 * Requires current user to have hr or admin role.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireHrAdmin();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const fiscal_year = typeof body.fiscal_year === "string" ? body.fiscal_year.trim() : "";
    const name = fiscal_year ? `FY ${fiscal_year}` : body.name;
    const cycle_type = "annual";
    const quarter = body.quarter?.trim() || null;
    const start_date = body.start_date?.trim() || null;
    const end_date = body.end_date?.trim() || null;

    if (!fiscal_year || !start_date || !end_date) {
      return NextResponse.json(
        { error: "fiscal_year, start_date, and end_date are required" },
        { status: 400 }
      );
    }

    const parsed = parseMidyearFields(body);
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const midyear = resolveMidyearChange(null, parsed.fields);
    if (midyear.error) return NextResponse.json({ error: midyear.error }, { status: 400 });
    // Defaults come from the column defaults, so only non-default settings are written.
    const midyearInsert = Object.fromEntries(
      Object.entries(midyear.merged).filter(
        ([k, v]) => v !== MIDYEAR_FIELD_DEFAULTS[k as keyof typeof MIDYEAR_FIELD_DEFAULTS]
      )
    );
    const reminders = parseCycleReminderFields(body);
    if (reminders.error) return NextResponse.json({ error: reminders.error }, { status: 400 });
    const reminderInsert = changedCycleReminderFields(null, reminders.fields);

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const { data: existing } = await supabase
      .from("appraisal_cycles")
      .select("id")
      .eq("fiscal_year", fiscal_year)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      return NextResponse.json(
        {
          error: `A cycle for fiscal year ${fiscal_year} already exists. Only one cycle per fiscal year is allowed.`,
        },
        { status: 400 }
      );
    }

    const { data: created, error: insertError } = await supabase
      .from("appraisal_cycles")
      .insert({
        name: name || `FY ${fiscal_year}`,
        cycle_type,
        fiscal_year,
        quarter,
        start_date,
        end_date,
        status: "draft",
        ...midyearInsert,
        ...reminderInsert,
      })
      .select("id")
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: (Object.keys(reminderInsert).length > 0 && reminderSettingsWriteError(insertError)) || insertError.message },
        { status: 500 }
      );
    }

    if (created?.id) {
      await supabase.from("cycle_review_types").insert([
        { cycle_id: created.id, review_type: "annual" },
      ]);

      const feedbackCycleName = `${fiscal_year} Leadership Feedback`;
      const { error: fcError } = await supabase.from("feedback_cycle").upsert(
        {
          cycle_name: feedbackCycleName,
          description: null,
          linked_appraisal_cycle_id: created.id,
          start_date: start_date || null,
          end_date: end_date || null,
          status: "Draft",
          created_by: user.id,
        },
        { onConflict: "linked_appraisal_cycle_id" }
      );
      if (fcError) {
        console.error("[admin/cycles] feedback_cycle upsert failed:", fcError);
      }
    }

    return NextResponse.json({ id: created?.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Create cycle failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
