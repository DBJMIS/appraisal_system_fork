import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireHrOrAdmin } from "@/lib/route-guards";

/**
 * Server-only access to HR admin reference data (competency categories/factors, rating scale,
 * recommendation rules). These tables are RLS-restricted to service_role, so the browser must go
 * through these HR/admin routes. Database error text is logged server-side, never returned.
 */

type Row = Record<string, unknown>;
type Parsed = { ok: true; row: Row } | { ok: false; error: string };

export interface ReferenceEntity {
  table: "evaluation_categories" | "evaluation_factors" | "recommendation_rules";
  label: string;
  parseCreate: (body: Row) => Parsed;
  parseUpdate: (body: Row) => Parsed;
  inUseMessage: string;
}

function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const textOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const numberOr = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const isToggle = (body: Row) => typeof body.active === "boolean" && Object.keys(body).every((k) => k === "active");

function parseCategory(body: Row): Parsed {
  if (!nonEmpty(body.name)) return { ok: false, error: "Name is required." };
  if (!nonEmpty(body.category_type)) return { ok: false, error: "Type is required." };
  return {
    ok: true,
    row: { name: body.name, category_type: body.category_type, applies_to: textOrNull(body.applies_to) },
  };
}

function parseFactor(body: Row): Parsed {
  if (!nonEmpty(body.category_id) || !nonEmpty(body.name)) {
    return { ok: false, error: "Category and name are required." };
  }
  return {
    ok: true,
    row: {
      category_id: body.category_id,
      name: body.name,
      description: textOrNull(body.description),
      display_order: numberOr(body.display_order, 0),
      weight: numberOr(body.weight, 0) || null,
    },
  };
}

function parseRule(body: Row): Parsed {
  if (!nonEmpty(body.rating_label) || !nonEmpty(body.recommendation)) {
    return { ok: false, error: "Rating label and recommendation are required." };
  }
  return {
    ok: true,
    row: {
      rating_label: body.rating_label,
      recommendation: body.recommendation,
      description: textOrNull(body.description),
    },
  };
}

const withToggle = (parse: (body: Row) => Parsed) => (body: Row): Parsed =>
  isToggle(body) ? { ok: true, row: { active: body.active } } : parse(body);

export const CATEGORY: ReferenceEntity = {
  table: "evaluation_categories",
  label: "Category",
  parseCreate: parseCategory,
  parseUpdate: parseCategory,
  inUseMessage: "Cannot delete category: It has related factors. Delete the factors first.",
};

export const FACTOR: ReferenceEntity = {
  table: "evaluation_factors",
  label: "Factor",
  parseCreate: parseFactor,
  parseUpdate: withToggle(parseFactor),
  inUseMessage: "Cannot delete factor: It has related appraisal ratings. Deactivate it instead.",
};

export const RULE: ReferenceEntity = {
  table: "recommendation_rules",
  label: "Rule",
  parseCreate: parseRule,
  parseUpdate: withToggle(parseRule),
  inUseMessage: "Cannot delete rule: It has related records. Deactivate it instead.",
};

const json = (body: Row, status: number) => NextResponse.json(body, { status });
const configError = () => json({ error: "Server configuration error.", code: "CONFIG_ERROR" }, 500);

function logDbError(op: string, table: string, error: { code?: string; message?: string }) {
  console.error(`[admin-reference-data] ${op} ${table} failed`, error.code ?? "", error.message ?? "");
}

async function readBody(req: Request): Promise<Row | null> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Row) : null;
}

export async function getReferenceData(): Promise<Response> {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;
  const supabase = getServiceClient();
  if (!supabase) return configError();

  const [categories, factors, ratingScale, rules] = await Promise.all([
    supabase.from("evaluation_categories").select("*").order("category_type"),
    supabase
      .from("evaluation_factors")
      .select("id, category_id, name, description, display_order, weight, active")
      .order("display_order"),
    supabase.from("rating_scale").select("id, code, factor, label").order("factor", { ascending: false }),
    supabase.from("recommendation_rules").select("*").order("rating_label"),
  ]);

  const failed = (
    [
      ["evaluation_categories", categories],
      ["evaluation_factors", factors],
      ["rating_scale", ratingScale],
      ["recommendation_rules", rules],
    ] as const
  ).filter(([, r]) => r.error);
  if (failed.length > 0) {
    for (const [table, r] of failed) logDbError("read", table, r.error!);
    return json({ error: "Could not load reference data. Please try again.", code: "DB_ERROR" }, 500);
  }

  return json(
    {
      categories: categories.data ?? [],
      factors: factors.data ?? [],
      ratingScale: ratingScale.data ?? [],
      rules: rules.data ?? [],
    },
    200
  );
}

export async function createReferenceRow(entity: ReferenceEntity, req: Request): Promise<Response> {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;
  const body = await readBody(req);
  if (!body) return json({ error: "Invalid request body.", code: "VALIDATION_ERROR" }, 400);
  const parsed = entity.parseCreate(body);
  if (!parsed.ok) return json({ error: parsed.error, code: "VALIDATION_ERROR" }, 400);
  const supabase = getServiceClient();
  if (!supabase) return configError();

  const { error } = await supabase.from(entity.table).insert(parsed.row);
  if (error) {
    logDbError("insert", entity.table, error);
    return json({ error: `Could not create ${entity.label.toLowerCase()}. Please try again.`, code: "DB_ERROR" }, 500);
  }
  return json({ ok: true }, 201);
}

export async function updateReferenceRow(entity: ReferenceEntity, req: Request, id: string): Promise<Response> {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;
  if (!nonEmpty(id)) return json({ error: `${entity.label} id is required.`, code: "VALIDATION_ERROR" }, 400);
  const body = await readBody(req);
  if (!body) return json({ error: "Invalid request body.", code: "VALIDATION_ERROR" }, 400);
  const parsed = entity.parseUpdate(body);
  if (!parsed.ok) return json({ error: parsed.error, code: "VALIDATION_ERROR" }, 400);
  const supabase = getServiceClient();
  if (!supabase) return configError();

  const { data, error } = await supabase.from(entity.table).update(parsed.row).eq("id", id).select("id");
  if (error) {
    logDbError("update", entity.table, error);
    return json({ error: `Could not update ${entity.label.toLowerCase()}. Please try again.`, code: "DB_ERROR" }, 500);
  }
  if (!data || data.length === 0) {
    return json({ error: `${entity.label} not found. It may have been deleted.`, code: "NOT_FOUND" }, 404);
  }
  return json({ ok: true }, 200);
}

export async function deleteReferenceRow(entity: ReferenceEntity, id: string): Promise<Response> {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;
  if (!nonEmpty(id)) return json({ error: `${entity.label} id is required.`, code: "VALIDATION_ERROR" }, 400);
  const supabase = getServiceClient();
  if (!supabase) return configError();

  const { data, error } = await supabase.from(entity.table).delete().eq("id", id).select("id");
  if (error) {
    if (error.code === "23503" || error.message?.includes("violates foreign key")) {
      return json({ error: entity.inUseMessage, code: "IN_USE" }, 409);
    }
    logDbError("delete", entity.table, error);
    return json({ error: `Could not delete ${entity.label.toLowerCase()}. Please try again.`, code: "DB_ERROR" }, 500);
  }
  if (!data || data.length === 0) {
    return json({ error: `${entity.label} not found. It may have been deleted.`, code: "NOT_FOUND" }, 404);
  }
  return json({ ok: true }, 200);
}
