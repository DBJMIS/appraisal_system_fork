import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { hasOversightReadAccess } from "@/lib/appraisal-oversight";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL and service role key required");
  }
  return createClient(url, key);
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: appraisalId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const isHrOrAdmin = user.roles?.some((r) => r === "hr" || r === "admin");
    const isEmployee = appraisal.employee_id === user.employee_id;
    const isManager = appraisal.manager_employee_id === user.employee_id;

    if (!isHrOrAdmin && !isEmployee && !isManager && !(await hasOversightReadAccess(user, appraisal))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("appraisal_technical_competencies")
      .select("*")
      .eq("appraisal_id", appraisalId)
      .order("display_order");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ competencies: data ?? [] });
  } catch (err) {
    console.error("GET technical-competencies error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: appraisalId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const isHrOrAdmin = user.roles?.some((r) => r === "hr" || r === "admin");
    const isEmployee = appraisal.employee_id === user.employee_id;
    const isManager = appraisal.manager_employee_id === user.employee_id;

    if (!isHrOrAdmin && !isEmployee && !isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { name, required_level, display_order, weight } = body;

    if (!name || !required_level) {
      return NextResponse.json({ error: "Name and required level are required" }, { status: 400 });
    }

    const insertPayload: Record<string, unknown> = {
      appraisal_id: appraisalId,
      name,
      required_level,
      display_order: display_order ?? 0,
    };
    if (weight !== undefined && weight !== null) insertPayload.weight = Number(weight);

    const { data, error } = await supabase
      .from("appraisal_technical_competencies")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ competency: data });
  } catch (err) {
    console.error("POST technical-competencies error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: appraisalId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, status, employee_id, manager_employee_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const isHrOrAdmin = user.roles?.some((r) => r === "hr" || r === "admin");
    const isEmployee = !!user.employee_id && appraisal.employee_id === user.employee_id;
    const isManager = !!user.employee_id && appraisal.manager_employee_id === user.employee_id;

    if (!isHrOrAdmin && !isEmployee && !isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (["PENDING_SIGNOFF", "HOD_REVIEW", "HR_REVIEW", "COMPLETE"].includes(String(appraisal.status ?? "").toUpperCase())) {
      return NextResponse.json(
        { error: "Technical competencies can no longer be changed at this stage.", code: "COMPETENCIES_LOCKED" },
        { status: 409 }
      );
    }

    const body = await req.json();
    const { competencies } = body;

    if (!Array.isArray(competencies)) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const errors: string[] = [];

    for (const comp of competencies) {
      const updateData: Record<string, unknown> = {};

      if (isEmployee || isHrOrAdmin) {
        if (comp.self_rating !== undefined) updateData.self_rating = comp.self_rating;
        if (comp.self_comments !== undefined) updateData.self_comments = comp.self_comments;
      }
      if (isManager || isHrOrAdmin) {
        if (comp.manager_rating !== undefined) updateData.manager_rating = comp.manager_rating;
        if (comp.manager_comments !== undefined) updateData.manager_comments = comp.manager_comments;
      }
      if (isEmployee || isManager || isHrOrAdmin) {
        if (comp.weight !== undefined && comp.weight !== null) updateData.weight = Number(comp.weight);
        if (comp.name !== undefined && comp.name !== null) updateData.name = String(comp.name).trim();
        if (comp.required_level !== undefined && comp.required_level !== null) updateData.required_level = String(comp.required_level).trim();
      }

      if (Object.keys(updateData).length > 0) {
        const { error } = await supabase
          .from("appraisal_technical_competencies")
          .update(updateData)
          .eq("id", comp.id)
          .eq("appraisal_id", appraisalId);

        if (error) errors.push(error.message);
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(", ") }, { status: 500 });
    }

    const hasWeightInPayload = competencies.some((c: { weight?: number }) => c.weight !== undefined && c.weight !== null);
    if (hasWeightInPayload) {
      const { data: list } = await supabase
        .from("appraisal_technical_competencies")
        .select("weight")
        .eq("appraisal_id", appraisalId);
      const total = (list ?? []).reduce((s, row) => s + (Number(row.weight) || 0), 0);
      if (Math.abs(total - 100) >= 0.01) {
        return NextResponse.json(
          { error: "Technical competency weights must total 100%." },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PUT technical-competencies error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: appraisalId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, status, employee_id, manager_employee_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    if ((appraisal.status as string) !== "DRAFT") {
      return NextResponse.json(
        { error: "Technical competencies can only be deleted when the appraisal is in Draft." },
        { status: 400 }
      );
    }

    const isHrOrAdmin = user.roles?.some((r) => r === "hr" || r === "admin");
    const isEmployee = appraisal.employee_id === user.employee_id;
    const isManager = appraisal.manager_employee_id === user.employee_id;

    if (!isHrOrAdmin && !isEmployee && !isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const competencyId = searchParams.get("competencyId");

    if (!competencyId) {
      return NextResponse.json({ error: "Competency ID required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("appraisal_technical_competencies")
      .delete()
      .eq("id", competencyId)
      .eq("appraisal_id", appraisalId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE technical-competencies error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
