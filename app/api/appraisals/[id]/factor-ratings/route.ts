import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";
import { hasOversightReadAccess } from "@/lib/appraisal-oversight";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

function canAccessAppraisal(
  user: { roles?: string[]; employee_id?: string | null; division_id?: string | null },
  appraisal: { employee_id: string; manager_employee_id: string | null; division_id?: string | null }
): boolean {
  const roles = user.roles ?? [];
  const empId = user.employee_id ?? null;
  const divId = user.division_id ?? null;
  return (
    roles.includes("hr") ||
    roles.includes("admin") ||
    appraisal.employee_id === empId ||
    appraisal.manager_employee_id === empId ||
    (roles.includes("gm") && divId != null && appraisal.division_id === divId)
  );
}

/**
 * GET: return factor ratings for this appraisal plus the active master factors and rating scale
 * (so client can load without RLS). Rating rows are optional; factors come from master configuration.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    if (!canAccessAppraisal(user, appraisal) && !(await hasOversightReadAccess(user, appraisal))) {
      return NextResponse.json({ error: "You do not have access to this appraisal" }, { status: 403 });
    }

    const { data: ratingData, error: rateErr } = await supabase
      .from("appraisal_factor_ratings")
      .select("factor_id, self_rating_code, manager_rating_code, self_comments, manager_comments, weight")
      .eq("appraisal_id", appraisalId);

    if (rateErr) return NextResponse.json({ error: rateErr.message }, { status: 400 });

    const { data: categories } = await supabase
      .from("evaluation_categories")
      .select("id, category_type")
      .in("category_type", ["core", "productivity", "leadership"])
      .eq("active", true);

    const catIds = (categories ?? []).map((c: { id: string }) => c.id);
    type FactorRow = {
      id: string;
      category_id: string;
      name: string;
      description: string | null;
      display_order: number | null;
      weight: number | null;
    };
    let factorRows: FactorRow[] = [];
    if (catIds.length > 0) {
      const { data: factors } = await supabase
        .from("evaluation_factors")
        .select("id, category_id, name, description, display_order, weight")
        .in("category_id", catIds)
        .eq("active", true)
        .order("display_order");
      factorRows = (factors ?? []) as FactorRow[];
    }

    const factorMeta: Record<string, { category_id: string; weight: number | null }> = Object.fromEntries(
      factorRows.map((f) => [f.id, { category_id: f.category_id, weight: f.weight }])
    );
    const categoryTypes: Record<string, string> = Object.fromEntries(
      (categories ?? []).map((c: { id: string; category_type: string }) => [c.id, c.category_type])
    );
    const factors = factorRows.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      display_order: f.display_order,
      weight: f.weight,
      category_id: f.category_id,
      category_type: categoryTypes[f.category_id] ?? null,
    }));

    const { data: ratingScale } = await supabase
      .from("rating_scale")
      .select("code, label, factor")
      .order("factor", { ascending: false });

    return NextResponse.json({
      ratings: ratingData ?? [],
      factorMeta,
      categoryTypes,
      factors,
      ratingScale: ratingScale ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type OwnedField = "self_rating_code" | "self_comments" | "manager_rating_code" | "manager_comments";
type FieldOwner = "employee" | "manager";

const OWNED_FIELDS: { field: OwnedField; owner: FieldOwner; label: string }[] = [
  { field: "self_rating_code", owner: "employee", label: "self rating" },
  { field: "self_comments", owner: "employee", label: "self comments" },
  { field: "manager_rating_code", owner: "manager", label: "manager rating" },
  { field: "manager_comments", owner: "manager", label: "manager comments" },
];

/** The only status in which each kind of field may change. All other statuses are read-only for it. */
const EDITABLE_STATUS: Record<FieldOwner | "weight", string> = {
  employee: "SELF_ASSESSMENT",
  manager: "MANAGER_REVIEW",
  weight: "DRAFT",
};

type StoredRating = {
  id: string;
  factor_id: string;
  self_rating_code: string | null;
  manager_rating_code: string | null;
  self_comments: string | null;
  manager_comments: string | null;
  weight: number | string | null;
};

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value);
  return s === "" ? null : s;
}

function sameWeight(a: number, b: number | string | null | undefined): boolean {
  return Math.abs(a - (Number(b) || 0)) < 1e-6;
}

/**
 * Body: { ratings: Array<{ factor_id: string; self_rating_code?; manager_rating_code?; self_comments?; manager_comments?; weight? }> }
 * Only fields that are present in the body AND differ from the stored row are treated as changes; every change must be
 * owned by the caller and allowed in the current status. Fields that are not changed are never written.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, status, employee_id, manager_employee_id, division_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const roles = user.roles ?? [];
    const currentEmployeeId = user.employee_id ?? null;
    const isEmployee = currentEmployeeId != null && appraisal.employee_id === currentEmployeeId;
    const isHrOrAdmin = roles.includes("hr") || roles.includes("admin");
    const managerAccess = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId,
    });

    if (!canAccessAppraisal(user, appraisal) && !managerAccess.hasManagerAccess) {
      return NextResponse.json({ error: "You do not have access to this appraisal" }, { status: 403 });
    }

    const body = await req.json();
    const ratings = Array.isArray(body?.ratings) ? body.ratings : [];
    if (ratings.length === 0) {
      return NextResponse.json({ success: true });
    }

    const status = (appraisal.status as string)?.toUpperCase();

    const ownsField: Record<FieldOwner | "weight", boolean> = {
      employee: isEmployee,
      manager: managerAccess.hasManagerAccess || (allowAppraisalTestBypass() && status === "MANAGER_REVIEW"),
      weight: isEmployee || managerAccess.hasManagerAccess || isHrOrAdmin,
    };
    const mayWrite = (kind: FieldOwner | "weight") => ownsField[kind] && EDITABLE_STATUS[kind] === status;

    const { data: storedRows, error: storedErr } = await supabase
      .from("appraisal_factor_ratings")
      .select("id, factor_id, self_rating_code, manager_rating_code, self_comments, manager_comments, weight")
      .eq("appraisal_id", appraisalId);
    if (storedErr) return NextResponse.json({ error: storedErr.message }, { status: 400 });
    const storedByFactor = new Map<string, StoredRating>(
      ((storedRows ?? []) as StoredRating[]).map((row) => [row.factor_id, row])
    );

    const submittedFactorIds = ratings
      .map((r: { factor_id?: unknown }) => r?.factor_id)
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
    const masterWeightByFactor = new Map<string, number | string | null>();
    if (submittedFactorIds.length > 0) {
      const { data: masterFactors } = await supabase
        .from("evaluation_factors")
        .select("id, weight")
        .in("id", submittedFactorIds);
      for (const f of (masterFactors ?? []) as { id: string; weight: number | string | null }[]) {
        masterWeightByFactor.set(f.id, f.weight);
      }
    }

    type PlannedWrite = { factorId: string; existingId: string | null; values: Record<string, unknown> };
    const planned: PlannedWrite[] = [];

    for (const r of ratings) {
      const factorId = r?.factor_id;
      if (!factorId || typeof factorId !== "string") continue;
      const stored = storedByFactor.get(factorId) ?? null;
      const values: Record<string, unknown> = {};

      for (const { field, owner, label } of OWNED_FIELDS) {
        if (!(field in r)) continue;
        if (normalizeText(r[field]) === normalizeText(stored?.[field])) continue;
        if (!ownsField[owner]) {
          return NextResponse.json({ error: `You are not allowed to change the ${label}.` }, { status: 403 });
        }
        if (EDITABLE_STATUS[owner] !== status) {
          return NextResponse.json(
            { error: `The ${label} cannot be changed while the appraisal is in ${status}.` },
            { status: 409 }
          );
        }
        values[field] = r[field] ?? null;
      }

      if (r.weight !== undefined && r.weight !== null) {
        const submittedWeight = Number(r.weight);
        // Matches the sections' display: the row weight, else the master weight, with a missing weight shown as 0.
        const displayedWeight = stored?.weight ?? masterWeightByFactor.get(factorId) ?? 0;
        if (!sameWeight(submittedWeight, displayedWeight)) {
          if (!ownsField.weight) {
            return NextResponse.json({ error: "You are not allowed to change factor weights." }, { status: 403 });
          }
          if (EDITABLE_STATUS.weight !== status) {
            return NextResponse.json(
              { error: `Factor weights cannot be changed while the appraisal is in ${status}.` },
              { status: 409 }
            );
          }
          values.weight = submittedWeight;
        } else if (!stored || (stored.weight == null && mayWrite("weight"))) {
          // The displayed (master) weight is still stored on the row because completion checks read row weights.
          values.weight = submittedWeight;
        }
      }

      const alreadyPlanned = planned.find((p) => p.factorId === factorId);
      if (alreadyPlanned) {
        Object.assign(alreadyPlanned.values, values);
      } else if (stored) {
        if (Object.keys(values).length > 0) planned.push({ factorId, existingId: stored.id, values });
      } else if (mayWrite("employee") || mayWrite("manager") || mayWrite("weight")) {
        planned.push({ factorId, existingId: null, values });
      }
    }

    const hasWeightInPayload = ratings.some((r: { weight?: number }) => r.weight !== undefined && r.weight !== null);
    if (status === "DRAFT" && hasWeightInPayload) {
      const { data: coreCategory } = await supabase
        .from("evaluation_categories")
        .select("id")
        .eq("category_type", "core")
        .limit(1)
        .maybeSingle();
      if (coreCategory?.id) {
        const { data: coreFactors } = await supabase
          .from("evaluation_factors")
          .select("id")
          .eq("category_id", coreCategory.id)
          .eq("active", true);
        const coreFactorIds = new Set((coreFactors ?? []).map((f: { id: string }) => f.id));
        const coreInPayload = ratings.filter((r: { factor_id: string }) => coreFactorIds.has(r.factor_id));
        if (coreInPayload.length > 0) {
          const coreTotal = coreInPayload.reduce((s: number, r: { weight?: number }) => s + (Number(r.weight) || 0), 0);
          if (Math.abs(coreTotal - 100) >= 0.01) {
            return NextResponse.json(
              { error: "Core competency weights must total 100%." },
              { status: 400 }
            );
          }
        }
      }
      const { data: prodCategory } = await supabase
        .from("evaluation_categories")
        .select("id")
        .eq("category_type", "productivity")
        .limit(1)
        .maybeSingle();
      if (prodCategory?.id) {
        const { data: prodFactors } = await supabase
          .from("evaluation_factors")
          .select("id")
          .eq("category_id", prodCategory.id)
          .eq("active", true);
        const prodFactorIds = new Set((prodFactors ?? []).map((f: { id: string }) => f.id));
        const prodInPayload = ratings.filter((r: { factor_id: string }) => prodFactorIds.has(r.factor_id));
        if (prodInPayload.length > 0) {
          const prodTotal = prodInPayload.reduce((s: number, r: { weight?: number }) => s + (Number(r.weight) || 0), 0);
          if (Math.abs(prodTotal - 100) >= 0.01) {
            return NextResponse.json(
              { error: "Productivity factor weights must total 100%." },
              { status: 400 }
            );
          }
        }
      }
      const { data: leadCategory } = await supabase
        .from("evaluation_categories")
        .select("id")
        .eq("category_type", "leadership")
        .limit(1)
        .maybeSingle();
      if (leadCategory?.id) {
        const { data: leadFactors } = await supabase
          .from("evaluation_factors")
          .select("id")
          .eq("category_id", leadCategory.id)
          .eq("active", true);
        const leadFactorIds = new Set((leadFactors ?? []).map((f: { id: string }) => f.id));
        const leadInPayload = ratings.filter((r: { factor_id: string }) => leadFactorIds.has(r.factor_id));
        if (leadInPayload.length > 0) {
          const leadTotal = leadInPayload.reduce((s: number, r: { weight?: number }) => s + (Number(r.weight) || 0), 0);
          if (Math.abs(leadTotal - 100) >= 0.01) {
            return NextResponse.json(
              { error: "Leadership factor weights must total 100%." },
              { status: 400 }
            );
          }
        }
      }
    }

    for (const write of planned) {
      if (write.existingId) {
        const { error: upErr } = await supabase
          .from("appraisal_factor_ratings")
          .update(write.values)
          .eq("id", write.existingId);
        if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
      } else {
        const { error: insErr } = await supabase
          .from("appraisal_factor_ratings")
          .insert({ appraisal_id: appraisalId, factor_id: write.factorId, ...write.values });
        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
