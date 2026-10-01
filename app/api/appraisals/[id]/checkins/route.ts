import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";
import { hasOversightReadAccess } from "@/lib/appraisal-oversight";
import {
  isFormalReviewMode,
  loadCycleMidyearConfig,
  midyearReviewTitle,
  resolveCheckInReviewMode,
  type CheckInReviewMode,
} from "@/lib/midyear-config";
import { buildMidyearSnapshot, type MidyearSnapshot } from "@/lib/midyear-assessment";
import { resolveManagementTrack } from "@/lib/management-track";
import { calcMidyearCompleteness, canInitiateFormal, recordMidyearAudit } from "@/lib/midyear-lifecycle";
import { notifyMidyearReady } from "@/lib/midyear-notifications";
import { loadMidyearRevisions, loadOriginalManagerReviews } from "@/lib/midyear-revisions";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and service role key required");
  return createClient(url, key);
}

type RouteContext = { params: Promise<{ id: string }> };

function canAccessAppraisal(
  user: { roles?: string[]; employee_id?: string | null; division_id?: string | null },
  appraisal: { employee_id: string; manager_employee_id: string | null; division_id?: string | null },
  hasManagerAccess: boolean
) {
  return (
    user.roles?.some((r) => r === "hr" || r === "admin") ||
    appraisal.employee_id === user.employee_id ||
    hasManagerAccess ||
    (user.roles?.includes("gm") && appraisal.division_id === user.division_id)
  );
}

function isManagerOrHR(
  user: { roles?: string[]; employee_id?: string | null },
  hasManagerAccess: boolean
) {
  return (
    user.roles?.some((r) => r === "hr" || r === "admin") ||
    hasManagerAccess
  );
}

// GET — list all check-ins for this appraisal
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id, cycle_id, status")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const managerAccess = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: user.employee_id ?? null,
    });

    if (
      !canAccessAppraisal(user, appraisal, managerAccess.hasManagerAccess) &&
      !(await hasOversightReadAccess(user, appraisal))
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: checkIns, error: listErr } = await supabase
      .from("check_ins")
      .select("*")
      .eq("appraisal_id", appraisalId)
      .order("created_at", { ascending: false });

    if (listErr) {
      return NextResponse.json({ error: listErr.message }, { status: 500 });
    }

    const list = checkIns ?? [];
    const checkInIds = list.map((c: { id: string }) => c.id);

    // Load responses and workplan items for page payload
    let responsesByCheckIn: Record<string, unknown[]> = {};
    if (checkInIds.length > 0) {
      const { data: responses } = await supabase
        .from("check_in_responses")
        .select("*")
        .in("check_in_id", checkInIds)
        .order("created_at", { ascending: true });
      const respList = responses ?? [];
      for (const r of respList) {
        const cid = (r as { check_in_id: string }).check_in_id;
        if (!responsesByCheckIn[cid]) responsesByCheckIn[cid] = [];
        responsesByCheckIn[cid].push(r);
      }
      const itemIds = [...new Set(respList.map((r: { workplan_item_id: string }) => r.workplan_item_id))];
      const { data: wpItems } = await supabase
        .from("workplan_items")
        .select("id, major_task, corporate_objective, division_objective, key_output, performance_standard, metric_target, metric_type, metric_deadline, weight")
        .in("id", itemIds);
      const itemMap = (wpItems ?? []).reduce((acc: Record<string, unknown>, row: Record<string, unknown>) => {
        acc[row.id as string] = row;
        return acc;
      }, {});
      for (const cid of Object.keys(responsesByCheckIn)) {
        responsesByCheckIn[cid] = (responsesByCheckIn[cid] as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          workplan_item: itemMap[r.workplan_item_id as string]
            ? {
                id: (itemMap[r.workplan_item_id as string] as Record<string, unknown>).id,
                major_task: (itemMap[r.workplan_item_id as string] as Record<string, unknown>).major_task ?? "",
                corporate_objective: (itemMap[r.workplan_item_id as string] as Record<string, unknown>).corporate_objective ?? "",
                division_objective: (itemMap[r.workplan_item_id as string] as Record<string, unknown>).division_objective ?? "",
                key_output: (itemMap[r.workplan_item_id as string] as Record<string, unknown>).key_output ?? "",
                performance_standard: (itemMap[r.workplan_item_id as string] as Record<string, unknown>).performance_standard ?? "",
                metric_target: (itemMap[r.workplan_item_id as string] as Record<string, unknown>).metric_target ?? null,
                metric_type: (itemMap[r.workplan_item_id as string] as Record<string, unknown>).metric_type ?? null,
                metric_deadline: (itemMap[r.workplan_item_id as string] as Record<string, unknown>).metric_deadline ?? null,
                weight: Number((itemMap[r.workplan_item_id as string] as Record<string, unknown>).weight) ?? 0,
              }
            : undefined,
        }));
      }
    }

    // Mid-Year competency inputs, loaded only when a formal Mid-Year Review exists.
    const formalIds = list
      .filter((c: { review_mode?: string }) => isFormalReviewMode(c.review_mode))
      .map((c: { id: string }) => c.id);
    const competenciesByCheckIn: Record<string, unknown[]> = {};
    let ratingScale: Array<{ code: string; label: string }> = [];
    if (formalIds.length > 0) {
      const { data: compRows } = await supabase
        .from("check_in_competency_ratings")
        .select("*")
        .in("check_in_id", formalIds)
        .order("display_order", { ascending: true });
      for (const row of compRows ?? []) {
        const cid = (row as { check_in_id: string }).check_in_id;
        (competenciesByCheckIn[cid] ??= []).push(row);
      }
      const { data: scale } = await supabase.from("rating_scale").select("code, label, factor").order("factor", { ascending: true });
      ratingScale = (scale ?? []).map((s: { code: string; label: string }) => ({ code: String(s.code), label: s.label }));
    }
    const revisionsByCheckIn = await loadMidyearRevisions(supabase, formalIds);
    const originalManagerReviews = await loadOriginalManagerReviews(supabase, appraisalId, revisionsByCheckIn);

    const { data: emp } = await supabase
      .from("employees")
      .select("full_name")
      .eq("employee_id", appraisal.employee_id)
      .single();
    const cycleId = (appraisal as { cycle_id?: string }).cycle_id;
    let cycleData: { name?: string; fiscal_year?: string } | null = null;
    if (cycleId) {
      const { data: c } = await supabase.from("appraisal_cycles").select("name, fiscal_year").eq("id", cycleId).single();
      cycleData = c;
    }
    const { config: midyear } = await loadCycleMidyearConfig(supabase, cycleId);

    const initiatedByIds = [...new Set((list as Array<{ initiated_by?: string | null }>).map((c) => c.initiated_by).filter(Boolean))] as string[];
    let initiatedByNames: Record<string, string> = {};
    if (initiatedByIds.length > 0) {
      const { data: initEmps } = await supabase
        .from("employees")
        .select("id, full_name")
        .in("id", initiatedByIds);
      for (const e of initEmps ?? []) {
        initiatedByNames[e.id] = e.full_name ?? "—";
      }
    }

    const checkInsWithResponses = list.map((c: Record<string, unknown>) => ({
      ...c,
      responses: responsesByCheckIn[c.id as string] ?? [],
      ...(isFormalReviewMode(c.review_mode as string | undefined)
        ? {
            competency_ratings: competenciesByCheckIn[c.id as string] ?? [],
            midyear_completeness: calcMidyearCompleteness({
              reviewMode: c.review_mode as string,
              responses: (responsesByCheckIn[c.id as string] ?? []) as Record<string, unknown>[],
              competencies: (competenciesByCheckIn[c.id as string] ?? []) as { section: string }[],
              isManagementTrack: c.is_management_track as boolean | null | undefined,
            }),
            midyear_revisions: revisionsByCheckIn.get(c.id as string) ?? [],
            ...(originalManagerReviews.has(c.id as string) ? { original_manager_reviewed_at: originalManagerReviews.get(c.id as string) } : {}),
          }
        : {}),
      initiated_by_employee:
        c.initiated_by && initiatedByNames[c.initiated_by as string]
          ? { full_name: initiatedByNames[c.initiated_by as string] }
          : undefined,
    }));

    let workplanItems: Array<{ id: string; major_task: string; corporate_objective: string; division_objective: string; key_output: string; weight: number; metric_target: number | null }> = [];
    const { data: workplanApproved } = await supabase
      .from("workplans")
      .select("id")
      .eq("appraisal_id", appraisalId)
      .eq("status", "approved")
      .maybeSingle();
    let workplan = workplanApproved;
    if (!workplan && (appraisal as { status?: string }).status === "IN_PROGRESS") {
      const { data: workplanFallback } = await supabase
        .from("workplans")
        .select("id")
        .eq("appraisal_id", appraisalId)
        .maybeSingle();
      workplan = workplanFallback;
    }
    if (workplan) {
      const { data: items } = await supabase
        .from("workplan_items")
        .select("id, major_task, corporate_objective, division_objective, key_output, weight, metric_target")
        .eq("workplan_id", workplan.id)
        .order("created_at", { ascending: true });
      workplanItems = (items ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        major_task: (r.major_task as string) ?? "",
        corporate_objective: (r.corporate_objective as string) ?? "",
        division_objective: (r.division_objective as string) ?? "",
        key_output: (r.key_output as string) ?? "",
        weight: Number(r.weight) ?? 0,
        metric_target: r.metric_target != null ? Number(r.metric_target) : null,
      }));
    }

    return NextResponse.json({
      checkIns: checkInsWithResponses,
      appraisal: {
        id: appraisal.id,
        employee_id: appraisal.employee_id,
        manager_employee_id: appraisal.manager_employee_id ?? null,
        employeeName: emp?.full_name ?? "—",
        cycleLabel: cycleData?.name ? `${cycleData.name}${cycleData.fiscal_year ? ` · FY ${cycleData.fiscal_year}` : ""}` : "—",
        fiscalYear: cycleData?.fiscal_year ?? null,
        status: (appraisal as { status?: string }).status ?? "DRAFT",
      },
      workplanItems,
      currentUser: {
        employee_id: user.employee_id ?? null,
        roles: user.roles ?? [],
      },
      access: {
        isEmployee: appraisal.employee_id === user.employee_id,
        hasManagerAccess: managerAccess.hasManagerAccess,
        isDelegate: managerAccess.isDelegated,
        isHrAdmin: !!user.roles?.some((r) => r === "hr" || r === "admin"),
      },
      midyear,
      ...(formalIds.length > 0 ? { ratingScale } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — create a new check-in (manager or HR only)
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const { title, check_in_type, due_date, note_to_employee, review_mode: requestedMode } = body as {
      title?: string;
      check_in_type?: string;
      due_date?: string | null;
      note_to_employee?: string | null;
      review_mode?: string;
    };

    const hasTitle = typeof title === "string" && title.trim() !== "";
    // A Mid-Year check-in may be formal, in which case the title comes from the cycle.
    if (!hasTitle && check_in_type !== "MIDYEAR") {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    const validTypes = ["MIDYEAR", "QUARTERLY", "ADHOC"];
    if (!check_in_type || !validTypes.includes(check_in_type)) {
      return NextResponse.json({ error: "check_in_type must be MIDYEAR, QUARTERLY, or ADHOC" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, status, cycle_id, is_management")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const appraisalStatus = (appraisal as { status?: string }).status;
    if (appraisalStatus !== "IN_PROGRESS") {
      return NextResponse.json(
        { error: "Check-ins can only be created during the In progress stage. Start self-assessment to leave this stage." },
        { status: 400 }
      );
    }

    const managerAccess = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: user.employee_id ?? null,
    });
    const isEmployee = appraisal.employee_id === user.employee_id;
    const canCreate = isManagerOrHR(user, managerAccess.hasManagerAccess) || isEmployee || allowAppraisalTestBypass();
    if (!canCreate) {
      return NextResponse.json({ error: "Only the manager, HR, or the employee can create a check-in during In progress." }, { status: 403 });
    }

    let reviewMode: CheckInReviewMode = "INFORMAL";
    let checkInTitle = hasTitle ? (title as string).trim() : "";
    let checkInDueDate = due_date && String(due_date).trim() ? String(due_date).trim() : null;
    if (check_in_type === "MIDYEAR") {
      const { config, fiscalYear } = await loadCycleMidyearConfig(supabase, (appraisal as { cycle_id?: string | null }).cycle_id);
      if (isFormalReviewMode(requestedMode) && !config.enabled) {
        return NextResponse.json(
          { error: "Formal Mid-Year Review is not enabled for this appraisal cycle." },
          { status: 400 }
        );
      }
      reviewMode = resolveCheckInReviewMode(check_in_type, config);
      if (isFormalReviewMode(reviewMode)) {
        const mayInitiate = canInitiateFormal({
          isEmployee,
          hasManagerAccess: managerAccess.hasManagerAccess,
          isHrAdmin: !!user.roles?.some((r) => r === "hr" || r === "admin"),
          testBypass: allowAppraisalTestBypass(),
        });
        if (!mayInitiate) {
          return NextResponse.json(
            { error: "Only the manager, an active delegate or HR can start the Mid-Year Review." },
            { status: 403 }
          );
        }
        const { data: formalRows } = await supabase
          .from("check_ins")
          .select("id, status")
          .eq("appraisal_id", appraisalId)
          .in("review_mode", ["FORMAL", "FORMAL_SCORED"]);
        if ((formalRows ?? []).some((r: { status?: string }) => r.status !== "CANCELLED")) {
          return NextResponse.json(
            { error: "A Mid-Year Review already exists for this appraisal." },
            { status: 409 }
          );
        }
        checkInTitle = midyearReviewTitle(fiscalYear);
        checkInDueDate = config.dueDate ?? checkInDueDate;
      }
    }
    if (!checkInTitle) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    // Resolve initiated_by: employees.id (UUID) from user.employee_id (text)
    let initiatedBy: string | null = null;
    if (user.employee_id) {
      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("employee_id", user.employee_id)
        .single();
      if (emp?.id) initiatedBy = emp.id;
    }

    // Load approved workplan and its items; when IN_PROGRESS, fallback to workplan for this appraisal (any status)
    let workplan: { id: string } | null = null;
    const { data: workplanApproved, error: wpErr } = await supabase
      .from("workplans")
      .select("id")
      .eq("appraisal_id", appraisalId)
      .eq("status", "approved")
      .maybeSingle();
    if (wpErr) {
      return NextResponse.json(
        { error: "No approved workplan found for this appraisal. Approve the workplan before creating a check-in." },
        { status: 400 }
      );
    }
    workplan = workplanApproved;
    if (!workplan && appraisalStatus === "IN_PROGRESS") {
      const { data: workplanFallback } = await supabase
        .from("workplans")
        .select("id")
        .eq("appraisal_id", appraisalId)
        .maybeSingle();
      workplan = workplanFallback;
    }
    if (!workplan) {
      return NextResponse.json(
        { error: "No approved workplan found for this appraisal. Approve the workplan before creating a check-in." },
        { status: 400 }
      );
    }

    const { data: items, error: itemsErr } = await supabase
      .from("workplan_items")
      .select("id, weight")
      .eq("workplan_id", workplan.id)
      .order("created_at", { ascending: true });

    if (itemsErr) {
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    const workplanItems = items ?? [];
    if (workplanItems.length === 0) {
      return NextResponse.json(
        { error: "Workplan has no objectives. Add workplan items before creating a check-in." },
        { status: 400 }
      );
    }

    // A formal Mid-Year Review freezes its track, competencies and weights before anything is written.
    let snapshot: MidyearSnapshot | null = null;
    if (isFormalReviewMode(reviewMode)) {
      try {
        const isManagementTrack = await resolveManagementTrack({
          employee_id: appraisal.employee_id,
          is_management: (appraisal as { is_management?: boolean | null }).is_management,
        });
        snapshot = await buildMidyearSnapshot(supabase, { appraisalId, isManagementTrack, workplanItems });
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Could not prepare the Mid-Year Review" },
          { status: 500 }
        );
      }
    }

    const { data: checkIn, error: insertErr } = await supabase
      .from("check_ins")
      .insert({
        appraisal_id: appraisalId,
        title: checkInTitle,
        check_in_type,
        initiated_by: initiatedBy,
        due_date: checkInDueDate,
        note_to_employee: note_to_employee && String(note_to_employee).trim() ? String(note_to_employee).trim() : null,
        status: "OPEN",
        updated_at: new Date().toISOString(),
        // INFORMAL comes from the column default, so informal check-ins are written exactly as before.
        ...(snapshot ? { review_mode: reviewMode, is_management_track: snapshot.isManagementTrack } : {}),
      })
      .select("*")
      .single();

    if (insertErr || !checkIn) {
      // The partial unique index on check_ins is the database-level guard for concurrent creation.
      const duplicate = insertErr?.code === "23505" || /duplicate key|unique/i.test(insertErr?.message ?? "");
      if (snapshot && duplicate) {
        return NextResponse.json({ error: "A Mid-Year Review already exists for this appraisal." }, { status: 409 });
      }
      return NextResponse.json({ error: insertErr?.message ?? "Failed to create check-in" }, { status: 500 });
    }

    let initiatorName: string | null = null;
    if (initiatedBy) {
      const { data: initEmp } = await supabase
        .from("employees")
        .select("full_name")
        .eq("id", initiatedBy)
        .single();
      initiatorName = initEmp?.full_name ?? null;
    }
    const auditSummary =
      initiatorName ? `Check-in created: ${(checkIn as { title: string }).title} (by ${initiatorName})` : `Check-in created: ${(checkIn as { title: string }).title}`;
    const auditDetail = {
      check_in_type: (checkIn as { check_in_type: string }).check_in_type,
      initiated_by: initiatedBy,
    };
    if (!snapshot) {
      await supabase.from("appraisal_audit").insert({
        appraisal_id: appraisalId,
        action_type: "check_in_created",
        actor_id: user.id,
        summary: auditSummary,
        detail: { check_in_id: checkIn.id, ...auditDetail },
      });
    }

    const responseRows = workplanItems.map((wi: { id: string }) => ({
      check_in_id: checkIn.id,
      workplan_item_id: wi.id,
      updated_at: new Date().toISOString(),
      ...(snapshot ? { weight_snapshot: snapshot.workplanWeights[wi.id] ?? 0 } : {}),
    }));

    const { data: insertedResponses, error: respErr } = await supabase
      .from("check_in_responses")
      .insert(responseRows)
      .select("id, check_in_id, workplan_item_id");

    if (respErr) {
      if (snapshot) await supabase.from("check_ins").delete().eq("id", checkIn.id);
      return NextResponse.json({ error: respErr.message }, { status: 500 });
    }

    if (snapshot && snapshot.competencies.length > 0) {
      const { error: compErr } = await supabase
        .from("check_in_competency_ratings")
        .insert(snapshot.competencies.map((c) => ({ ...c, check_in_id: checkIn.id })));
      if (compErr) {
        // Removing the check-in cascades to its responses, so no partial Mid-Year Review remains.
        await supabase.from("check_ins").delete().eq("id", checkIn.id);
        return NextResponse.json({ error: compErr.message }, { status: 500 });
      }
    }
    if (snapshot) {
      await recordMidyearAudit(supabase, {
        appraisalId,
        actorId: user.id ?? null,
        action: "midyear_created",
        checkIn: { id: checkIn.id, title: checkIn.title, review_mode: reviewMode },
        detail: { ...auditDetail, is_management_track: snapshot.isManagementTrack, to_status: "OPEN" },
      });
    }

    // Enrich responses with workplan_item details
    const itemIds = workplanItems.map((wi: { id: string }) => wi.id);
    const { data: wpItems } = await supabase
      .from("workplan_items")
      .select("id, major_task, corporate_objective, division_objective, key_output, performance_standard, metric_target, metric_type, weight")
      .in("id", itemIds);

    type WpItem = { id: string; major_task: unknown; corporate_objective: unknown; division_objective: unknown; key_output: unknown; performance_standard: unknown; metric_target: unknown; metric_type: unknown; weight: unknown };
    const itemList: WpItem[] = Array.isArray(wpItems) ? wpItems : [];
    const itemMap = itemList.reduce<Record<string, WpItem>>((acc, r) => {
      if (r?.id) acc[r.id] = r;
      return acc;
    }, {});

    const responses = (insertedResponses ?? []).map((r: { id: string; check_in_id: string; workplan_item_id: string }) => ({
      id: r.id,
      check_in_id: r.check_in_id,
      workplan_item_id: r.workplan_item_id,
      employee_status: null,
      progress_pct: null,
      employee_comment: null,
      employee_updated_at: null,
      mgr_status_override: null,
      mgr_comment: null,
      mgr_acknowledged_at: null,
      workplan_item: itemMap[r.workplan_item_id]
        ? {
            id: itemMap[r.workplan_item_id].id,
            major_task: itemMap[r.workplan_item_id].major_task ?? "",
            corporate_objective: itemMap[r.workplan_item_id].corporate_objective ?? "",
            division_objective: itemMap[r.workplan_item_id].division_objective ?? "",
            key_output: itemMap[r.workplan_item_id].key_output ?? "",
            performance_standard: itemMap[r.workplan_item_id].performance_standard ?? "",
            metric_target: itemMap[r.workplan_item_id].metric_target ?? null,
            metric_type: itemMap[r.workplan_item_id].metric_type ?? null,
            weight: Number(itemMap[r.workplan_item_id].weight) ?? 0,
          }
        : undefined,
    }));

    if (snapshot) {
      await notifyMidyearReady(supabase, {
        appraisalId,
        checkInId: checkIn.id,
        appraisal: {
          employee_id: appraisal.employee_id,
          manager_employee_id: appraisal.manager_employee_id ?? null,
          cycle_id: (appraisal as { cycle_id?: string | null }).cycle_id ?? null,
        },
      });
    } else if (appraisal.employee_id !== user.employee_id) {
      try {
        const { createNotificationForEmployeeId } = await import("@/lib/notifications/create");
        await createNotificationForEmployeeId(appraisal.employee_id, {
          type: "checkin.requested",
          title: "New check-in",
          body: `You have a new check-in to complete: "${(checkIn as { title: string }).title}".`,
          link: `/appraisals/${appraisalId}`,
          metadata: { appraisal_id: appraisalId, check_in_id: checkIn.id },
        });
      } catch {
        /* non-blocking */
      }
    }

    return NextResponse.json({
      checkIn: {
        id: checkIn.id,
        appraisal_id: checkIn.appraisal_id,
        title: checkIn.title,
        check_in_type: checkIn.check_in_type,
        review_mode: checkIn.review_mode ?? reviewMode,
        is_management_track: checkIn.is_management_track ?? null,
        initiated_by: checkIn.initiated_by,
        due_date: checkIn.due_date,
        status: checkIn.status,
        employee_submitted_at: checkIn.employee_submitted_at,
        manager_reviewed_at: checkIn.manager_reviewed_at,
        manager_overall_notes: checkIn.manager_overall_notes,
        note_to_employee: checkIn.note_to_employee,
        created_at: checkIn.created_at,
        updated_at: checkIn.updated_at,
      },
      responses,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
