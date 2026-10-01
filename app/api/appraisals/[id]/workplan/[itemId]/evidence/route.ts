import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { hasOversightReadAccess } from "@/lib/appraisal-oversight";

const BUCKET = "workplan-evidence";
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
];

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

function canAccessAppraisal(
  user: { roles?: string[]; employee_id?: string | null; division_id?: string | null },
  appraisal: { employee_id: string; manager_employee_id: string | null; division_id?: string | null }
) {
  return (
    user.roles?.some((r) => r === "hr" || r === "admin") ||
    appraisal.employee_id === user.employee_id ||
    appraisal.manager_employee_id === user.employee_id ||
    (user.roles?.includes("gm") && user.division_id != null && appraisal.division_id === user.division_id)
  );
}

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/** GET — list all evidence for a workplan item; returns signed URLs for FILE type */
export async function GET(_req: NextRequest, context: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user?.employee_id && !user?.roles?.some((r) => r === "hr" || r === "admin"))
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId, itemId: workplanItemId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal)
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    if (!canAccessAppraisal(user, appraisal) && !(await hasOversightReadAccess(user, appraisal)))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: rows, error } = await supabase
      .from("workplan_item_evidence")
      .select("*")
      .eq("appraisal_id", appraisalId)
      .eq("workplan_item_id", workplanItemId)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const list = (rows ?? []) as Array<{
      id: string;
      evidence_type: string;
      file_name: string | null;
      file_size: number | null;
      file_type: string | null;
      storage_path: string | null;
      storage_bucket: string | null;
      link_url: string | null;
      link_title: string | null;
      note_text: string | null;
      created_at: string;
    }>;

    const signed: Array<Record<string, unknown> & { signed_url?: string }> = [];

    const listWithUploadedBy = list as Array<{ uploaded_by?: string | null }>;
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const out = { ...row, can_delete: listWithUploadedBy[i]?.uploaded_by === user.employee_id } as Record<string, unknown>;
      if (
        row.evidence_type === "FILE" &&
        row.storage_bucket === BUCKET &&
        row.storage_path?.startsWith(`${appraisalId}/`)
      ) {
        const { data: signedData } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(row.storage_path, 3600);
        if (signedData?.signedUrl) (out as { signed_url?: string }).signed_url = signedData.signedUrl;
      }
      signed.push(out);
    }

    return NextResponse.json({ evidence: signed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST — upload new evidence (file, link, or note). Employee only in SELF_ASSESSMENT. */
export async function POST(req: NextRequest, context: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user?.employee_id && !user?.roles?.some((r) => r === "hr" || r === "admin"))
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId, itemId: workplanItemId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, status, employee_id, manager_employee_id, division_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal)
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    if (!canAccessAppraisal(user, appraisal))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const status = (appraisal.status as string)?.toUpperCase();
    const isEmployee = appraisal.employee_id === user.employee_id;
    if (status !== "SELF_ASSESSMENT" || !isEmployee)
      return NextResponse.json({ error: "Evidence can only be added during self-assessment by the employee" }, { status: 403 });

    const contentType = req.headers.get("content-type") ?? "";
    let evidenceType: "FILE" | "LINK" | "NOTE" = "NOTE";
    let file: File | null = null;
    let linkUrl: string | null = null;
    let linkTitle: string | null = null;
    let noteText: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      evidenceType = (formData.get("evidence_type") as "FILE" | "LINK" | "NOTE") || "NOTE";
      file = formData.get("file") as File | null;
      if (typeof formData.get("link_url") === "string") linkUrl = formData.get("link_url") as string;
      if (typeof formData.get("link_title") === "string") linkTitle = formData.get("link_title") as string;
      if (typeof formData.get("note_text") === "string") noteText = formData.get("note_text") as string;
    }

    if (evidenceType === "FILE") {
      if (!file || file.size === 0)
        return NextResponse.json({ error: "File is required for FILE evidence" }, { status: 400 });
      if (file.size > MAX_SIZE_BYTES)
        return NextResponse.json({ error: "File size must be 20MB or less" }, { status: 400 });
      const mime = file.type || "";
      if (!ALLOWED_MIMES.some((m) => mime === m || mime.startsWith(m.split("/")[0] + "/")))
        return NextResponse.json({ error: "File type not allowed" }, { status: 400 });

      const stamp = Date.now();
      const safeName = (file.name ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${appraisalId}/${workplanItemId}/${stamp}-${safeName}`;

      const buf = await file.arrayBuffer();
      const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

      if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 400 });

      const { data: inserted, error: insertErr } = await supabase
        .from("workplan_item_evidence")
        .insert({
          workplan_item_id: workplanItemId,
          appraisal_id: appraisalId,
          uploaded_by: user.employee_id,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type || null,
          storage_path: storagePath,
          storage_bucket: BUCKET,
          evidence_type: "FILE",
        })
        .select("id")
        .single();

      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 400 });
      return NextResponse.json({ success: true, id: inserted?.id });
    }

    if (evidenceType === "LINK") {
      const url = (linkUrl ?? "").trim();
      if (!url) return NextResponse.json({ error: "link_url is required for LINK evidence" }, { status: 400 });
      const { data: inserted, error: insertErr } = await supabase
        .from("workplan_item_evidence")
        .insert({
          workplan_item_id: workplanItemId,
          appraisal_id: appraisalId,
          uploaded_by: user.employee_id,
          link_url: url,
          link_title: (linkTitle ?? "").trim() || null,
          evidence_type: "LINK",
        })
        .select("id")
        .single();
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 400 });
      return NextResponse.json({ success: true, id: inserted?.id });
    }

    if (evidenceType === "NOTE") {
      const text = (noteText ?? "").trim();
      if (!text) return NextResponse.json({ error: "note_text is required for NOTE evidence" }, { status: 400 });
      const { data: inserted, error: insertErr } = await supabase
        .from("workplan_item_evidence")
        .insert({
          workplan_item_id: workplanItemId,
          appraisal_id: appraisalId,
          uploaded_by: user.employee_id,
          note_text: text,
          evidence_type: "NOTE",
        })
        .select("id")
        .single();
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 400 });
      return NextResponse.json({ success: true, id: inserted?.id });
    }

    return NextResponse.json({ error: "Invalid evidence_type" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
