import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, introspect, replayMigrations } from "@/scripts/db/replay-migrations.mjs";
import { extractUsage } from "@/scripts/db/extract-app-schema-usage.mjs";
import {
  FUNCTION_REGISTER,
  KNOWN_APP_SCHEMA_DRIFT,
  KNOWN_REPLAY_FAILURES,
  liveCompatibleTransform,
} from "@/scripts/db/baseline-register.mjs";
import { APPRAISAL_STATUS } from "@/types/appraisal";

type Replay = Awaited<ReturnType<typeof replayMigrations>>;
type Schema = Awaited<ReturnType<typeof introspect>>;

const RESET_FILE = "0049_5_reset_appraisal_data.sql";

let asIs: Replay;
let live: Replay;
let liveSchema: Schema;
let liveSchemaWithoutReset: Schema;

beforeAll(async () => {
  asIs = await replayMigrations();
  live = await replayMigrations({ transform: liveCompatibleTransform });
  liveSchema = await introspect(live.db);
  const withoutReset = await replayMigrations({ transform: liveCompatibleTransform, exclude: [RESET_FILE] });
  liveSchemaWithoutReset = await introspect(withoutReset.db);
  await withoutReset.db.close();
}, 180_000);

afterAll(async () => {
  await asIs?.db.close();
  await live?.db.close();
});

function columnsOf(schema: Schema, table: string): Set<string> {
  return new Set(schema.columns.filter((c) => c.table_name === table).map((c) => c.column_name));
}

describe("fresh replay of the migration chain", () => {
  it("fails only in the registered files when replayed as-is", () => {
    const failed = asIs.results.filter((r) => r.status === "failed").map((r) => r.file);
    expect(failed).toEqual(Object.keys(KNOWN_REPLAY_FAILURES));
  });

  it("applies every file once user_roles exposes role as text, as in the live project", () => {
    const failed = live.results.filter((r) => r.status !== "applied").map((r) => r.file);
    expect(failed).toEqual([]);
  });

  it("the reset migration contributes no schema objects", () => {
    expect(liveSchemaWithoutReset).toEqual(liveSchema);
  });
});

describe("core schema produced by the chain", () => {
  it("appraisals.status CHECK allows exactly the application statuses plus CANCELLED", () => {
    const check = liveSchema.constraints.find((c) => c.table_name === "appraisals" && c.name === "appraisals_status_check");
    expect(check).toBeDefined();
    const allowed = [...String(check!.definition).matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(allowed).toEqual([...APPRAISAL_STATUS, "CANCELLED"].sort());
  });

  it.each([
    ["app_users", ["id", "aad_object_id", "email", "role", "employee_id", "is_active"]],
    ["employees", ["employee_id", "email", "full_name", "division_id", "is_active"]],
    ["reporting_lines", ["employee_id", "manager_employee_id", "is_primary"]],
    ["appraisals", ["id", "cycle_id", "employee_id", "manager_employee_id", "status", "review_type", "is_active"]],
    [
      "appraisal_cycles",
      ["id", "status", "cycle_type", "fiscal_year", "midyear_review_enabled", "midyear_scoring_enabled", "midyear_window_start", "midyear_due_date"],
    ],
    ["check_ins", ["id", "appraisal_id", "check_in_type", "status", "review_mode", "is_management_track"]],
    [
      "check_in_responses",
      [
        "id", "check_in_id", "workplan_item_id", "employee_status", "progress_pct", "employee_comment", "mgr_status_override",
        "mgr_comment", "employee_actual_raw", "employee_completion_date", "employee_result", "mgr_actual_raw",
        "mgr_completion_date", "mgr_result", "weight_snapshot",
      ],
    ],
    [
      "check_in_competency_ratings",
      [
        "id", "check_in_id", "section", "factor_id", "technical_competency_id", "name_snapshot", "weight_snapshot",
        "employee_rating_code", "manager_rating_code", "employee_comment", "manager_comment", "created_at", "updated_at",
      ],
    ],
    ["workplans", ["id", "appraisal_id", "status", "locked_at"]],
    ["workplan_items", ["id", "workplan_id", "major_task", "key_output", "weight", "actual_result"]],
    ["appraisal_approvals", ["appraisal_id", "role"]],
    ["appraisal_signoffs", ["appraisal_id", "role", "stage", "signed_by"]],
    ["appraisal_agreements", ["appraisal_id", "adobe_agreement_id", "status", "signed_pdf_path"]],
    ["appraisal_delegations", ["appraisal_id"]],
    ["appraisal_audit", ["appraisal_id", "actor_id"]],
    ["uat_login_credentials", ["app_user_id", "password_hash"]],
    [
      "appraisal_score_snapshots",
      [
        "id", "appraisal_id", "score_type", "check_in_id", "is_management_track", "total_points", "overall_grade",
        "grade_label", "cc_actual", "cc_points", "prod_actual", "prod_points", "technical_actual", "technical_points",
        "leadership_actual", "leadership_points", "workplan_actual", "workplan_points", "components", "inputs",
        "engine_version", "calculated_at", "calculated_by", "revision", "superseded_at", "superseded_by",
      ],
    ],
    [
      "midyear_review_revisions",
      [
        "id", "check_in_id", "appraisal_id", "revision_number", "reopened_at", "reopened_by", "reopened_by_name", "reopen_reason",
        "previous_score_revision", "completed_at", "completed_by", "score_revision",
      ],
    ],
  ])("%s has its required columns", (table, required) => {
    const cols = columnsOf(liveSchema, table);
    expect(required.filter((c) => !cols.has(c))).toEqual([]);
  });

  it.each([
    ["appraisals", /UNIQUE INDEX idx_appraisals_one_per_employee_per_cycle .*\(employee_id, cycle_id\) WHERE \(status <> 'CANCELLED'::text\)/],
    ["appraisal_approvals", /UNIQUE INDEX .*\(appraisal_id, role\)/],
    ["appraisal_agreements", /UNIQUE INDEX .*\(adobe_agreement_id\)/],
    ["appraisal_delegations", /UNIQUE INDEX .*\(appraisal_id\)/],
    ["workplans", /UNIQUE INDEX .*\(appraisal_id\)/],
    ["appraisal_factor_ratings", /UNIQUE INDEX .*\(appraisal_id, factor_id\)/],
    ["employees", /UNIQUE INDEX .*\(employee_id\)/],
    ["app_users", /UNIQUE INDEX .*\(aad_object_id\)/],
    ["appraisal_score_snapshots", /UNIQUE INDEX appraisal_score_snapshots_revision_key .*\(appraisal_id, score_type, revision\)/],
    ["appraisal_score_snapshots", /UNIQUE INDEX idx_appraisal_score_snapshots_one_current .*\(appraisal_id, score_type\) WHERE \(superseded_at IS NULL\)/],
    ["midyear_review_revisions", /UNIQUE INDEX midyear_review_revisions_check_in_number_key .*\(check_in_id, revision_number\)/],
    ["midyear_review_revisions", /UNIQUE INDEX idx_midyear_review_revisions_one_open .*\(check_in_id\) WHERE \(completed_at IS NULL\)/],
    ["check_ins", /UNIQUE INDEX idx_check_ins_one_formal_midyear_per_appraisal .*\(appraisal_id\) WHERE/],
    ["check_in_competency_ratings", /UNIQUE INDEX check_in_competency_ratings_factor_key .*\(check_in_id, factor_id\)/],
    ["check_in_competency_ratings", /UNIQUE INDEX check_in_competency_ratings_technical_key .*\(check_in_id, technical_competency_id\)/],
  ])("%s has unique index %s", (table, pattern) => {
    const defs = liveSchema.indexes.filter((i) => i.table_name === table).map((i) => String(i.definition));
    expect(defs.some((d) => pattern.test(d))).toBe(true);
  });

  it("every public function is classified in the function register", () => {
    const names = [...new Set(liveSchema.functions.map((f) => String(f.name)))].sort();
    expect(names).toEqual(Object.keys(FUNCTION_REGISTER).sort());
  });
});

describe("application schema usage against the replayed chain", () => {
  const usage = extractUsage();

  it("every table the application queries exists", () => {
    const relations = new Set([...liveSchema.tables.map((t) => t.table_name), ...liveSchema.views.map((v) => v.view_name)]);
    expect(Object.keys(usage.tables).filter((t) => !relations.has(t))).toEqual([]);
  });

  it("every column the application references exists, apart from registered drift", () => {
    const missing: string[] = [];
    for (const [table, info] of Object.entries(usage.tables)) {
      const cols = columnsOf(liveSchema, table);
      for (const col of Object.keys(info.columns)) if (!cols.has(col)) missing.push(`${table}.${col}`);
    }
    expect(missing.sort()).toEqual(Object.keys(KNOWN_APP_SCHEMA_DRIFT).sort());
  });

  it("every RPC the application calls exists", () => {
    const fns = new Set(liveSchema.functions.map((f) => String(f.name)));
    expect(Object.keys(usage.rpcs).filter((r) => !fns.has(r))).toEqual([]);
  });

  it("every storage bucket the application names exists", () => {
    const buckets = new Set(liveSchema.buckets.map((b) => String(b.id)));
    expect(Object.keys(usage.buckets).filter((b) => !buckets.has(b))).toEqual([]);
  });
});

describe("known defects characterised on synthetic rows", () => {
  let appraisalId: string;
  let workplanId: string;

  beforeAll(async () => {
    const db = live.db;
    await db.exec(`
      insert into employees (employee_id, full_name) values ('T-EMP', 'Test Employee'), ('T-MGR', 'Test Manager');
      insert into appraisal_cycles (name, cycle_type, fiscal_year, start_date, end_date, status)
        values ('Test cycle', 'annual', '2026', '2026-01-01', '2026-12-31', 'open');
    `);
    const appraisal = await db.query<{ id: string }>(`
      insert into appraisals (cycle_id, employee_id, manager_employee_id, review_type)
      select id, 'T-EMP', 'T-MGR', 'annual' from appraisal_cycles where name = 'Test cycle' returning id`);
    appraisalId = appraisal.rows[0].id;
    const workplan = await db.query<{ id: string }>(`insert into workplans (appraisal_id) values ($1) returning id`, [appraisalId]);
    workplanId = workplan.rows[0].id;
    await db.query(`insert into workplan_items (workplan_id, major_task, weight) values ($1, 'Task', 100)`, [workplanId]);
  });

  it("submit_workplan_for_approval aborts because it writes a status the CHECK rejects", async () => {
    await expect(
      live.db.query(`select submit_workplan_for_approval($1, 'T-EMP')`, [workplanId])
    ).rejects.toThrow(/appraisals_status_check/);
  });

  it("appraisal_agreements rejects the COMPLETED status written by the v2 Adobe webhook", async () => {
    await live.db.query(`insert into appraisal_agreements (appraisal_id, adobe_agreement_id) values ($1, 'agr-test')`, [appraisalId]);
    await expect(
      live.db.query(`update appraisal_agreements set status = 'COMPLETED' where adobe_agreement_id = 'agr-test'`)
    ).rejects.toThrow(/check constraint/);
  });
});

describe("appraisal_score_snapshots on synthetic rows", () => {
  let appraisalId: string;
  const insertSnapshot = (scoreType: string, total = 80.6) =>
    live.db.query(
      `insert into appraisal_score_snapshots
         (appraisal_id, score_type, is_management_track, total_points, overall_grade, grade_label,
          cc_actual, cc_points, workplan_actual, workplan_points, components, inputs, engine_version)
       values ($1, $2, false, $3, 'C', 'Meets Expectations', 90, 9, 82, 57.4,
               '[{"key":"cc","points":9}]'::jsonb, '{"isManagementTrack":false}'::jsonb, 'summary-calc/v1')
       on conflict (appraisal_id, score_type, revision) do update set total_points = excluded.total_points`,
      [appraisalId, scoreType, total]
    );

  beforeAll(async () => {
    await live.db.exec(`
      insert into employees (employee_id, full_name) values ('S-EMP', 'Snapshot Employee'), ('S-MGR', 'Snapshot Manager');
      insert into appraisal_cycles (name, cycle_type, fiscal_year, start_date, end_date, status)
        values ('Snapshot cycle', 'annual', '2026', '2026-01-01', '2026-12-31', 'open');
    `);
    const appraisal = await live.db.query<{ id: string }>(`
      insert into appraisals (cycle_id, employee_id, manager_employee_id, review_type)
      select id, 'S-EMP', 'S-MGR', 'annual' from appraisal_cycles where name = 'Snapshot cycle' returning id`);
    appraisalId = appraisal.rows[0].id;
  });

  it("accepts MIDYEAR and FINAL", async () => {
    await insertSnapshot("FINAL");
    await insertSnapshot("MIDYEAR", 72.4);
    const rows = await live.db.query<{ score_type: string }>(
      `select score_type from appraisal_score_snapshots where appraisal_id = $1 order by score_type`,
      [appraisalId]
    );
    expect(rows.rows.map((r) => r.score_type)).toEqual(["FINAL", "MIDYEAR"]);
  });

  it.each(["INTERIM", "final", ""])("rejects score_type %j", async (scoreType) => {
    await expect(insertSnapshot(scoreType)).rejects.toThrow(/appraisal_score_snapshots_score_type_check/);
  });

  it("allows only one FINAL per appraisal; upsert replaces it", async () => {
    await expect(
      live.db.query(
        `insert into appraisal_score_snapshots (appraisal_id, score_type, is_management_track, total_points, components, inputs, engine_version)
         values ($1, 'FINAL', false, 1, '[]'::jsonb, '{}'::jsonb, 'summary-calc/v1')`,
        [appraisalId]
      )
    ).rejects.toThrow(/appraisal_score_snapshots_revision_key|idx_appraisal_score_snapshots_one_current/);

    await insertSnapshot("FINAL", 81.6);
    const finals = await live.db.query<{ total_points: string }>(
      `select total_points from appraisal_score_snapshots where appraisal_id = $1 and score_type = 'FINAL'`,
      [appraisalId]
    );
    expect(finals.rows.map((r) => Number(r.total_points))).toEqual([81.6]);
  });

  it("stores section values and JSON exactly", async () => {
    const row = await live.db.query<Record<string, unknown>>(
      `select cc_actual, cc_points, workplan_points, overall_grade, grade_label, is_management_track, components, inputs
       from appraisal_score_snapshots where appraisal_id = $1 and score_type = 'FINAL'`,
      [appraisalId]
    );
    expect(row.rows[0]).toMatchObject({
      overall_grade: "C",
      grade_label: "Meets Expectations",
      is_management_track: false,
      components: [{ key: "cc", points: 9 }],
      inputs: { isManagementTrack: false },
    });
    expect(Number(row.rows[0].workplan_points)).toBe(57.4);
  });

  it.each(["is_management_track", "total_points", "components", "inputs", "engine_version"])(
    "requires %s",
    async (column) => {
      const cols = ["appraisal_id", "score_type", "is_management_track", "total_points", "components", "inputs", "engine_version"];
      const values = ["$1", "'MIDYEAR'", "false", "1", "'[]'::jsonb", "'{}'::jsonb", "'v'"];
      const keep = cols.map((c, i) => [c, values[i]]).filter(([c]) => c !== column);
      await expect(
        live.db.query(
          `insert into appraisal_score_snapshots (${keep.map(([c]) => c).join(", ")}) values (${keep.map(([, v]) => v).join(", ")})`,
          [appraisalId]
        )
      ).rejects.toThrow(/null value/);
    }
  );

  it("rejects an unknown appraisal", async () => {
    await expect(
      live.db.query(
        `insert into appraisal_score_snapshots (appraisal_id, score_type, is_management_track, total_points, components, inputs, engine_version)
         values (gen_random_uuid(), 'FINAL', false, 1, '[]'::jsonb, '{}'::jsonb, 'v')`
      )
    ).rejects.toThrow(/foreign key/);
  });

  it("has row level security enabled", async () => {
    const rls = await live.db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'appraisal_score_snapshots'`
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });
});

describe("Mid-Year cycle configuration on synthetic rows", () => {
  let cycleId: string;
  let appraisalId: string;
  const insertCheckIn = (type: string, mode: string | null, status = "OPEN") =>
    live.db.query<{ id: string; review_mode: string }>(
      mode === null
        ? `insert into check_ins (appraisal_id, title, check_in_type, status) values ($1, 't', $2, $3) returning id, review_mode`
        : `insert into check_ins (appraisal_id, title, check_in_type, status, review_mode, is_management_track)
           values ($1, 't', $2, $3, $4, case when $4 = 'INFORMAL' then null else false end) returning id, review_mode`,
      mode === null ? [appraisalId, type, status] : [appraisalId, type, status, mode]
    );

  beforeAll(async () => {
    await live.db.exec(`
      insert into employees (employee_id, full_name) values ('M-EMP', 'Mid-Year Employee'), ('M-MGR', 'Mid-Year Manager');
      insert into appraisal_cycles (name, cycle_type, fiscal_year, start_date, end_date, status)
        values ('Mid-Year cycle', 'annual', '2027', '2027-01-01', '2027-12-31', 'open');
    `);
    const cycle = await live.db.query<{ id: string }>(`select id from appraisal_cycles where name = 'Mid-Year cycle'`);
    cycleId = cycle.rows[0].id;
    const appraisal = await live.db.query<{ id: string }>(
      `insert into appraisals (cycle_id, employee_id, manager_employee_id, review_type) values ($1, 'M-EMP', 'M-MGR', 'annual') returning id`,
      [cycleId]
    );
    appraisalId = appraisal.rows[0].id;
  });

  it("new cycles default to Mid-Year off", async () => {
    const row = await live.db.query<Record<string, unknown>>(
      `select midyear_review_enabled, midyear_scoring_enabled, midyear_window_start, midyear_due_date from appraisal_cycles where id = $1`,
      [cycleId]
    );
    expect(row.rows[0]).toEqual({
      midyear_review_enabled: false,
      midyear_scoring_enabled: false,
      midyear_window_start: null,
      midyear_due_date: null,
    });
  });

  it("rejects scoring while the review is off", async () => {
    await expect(
      live.db.query(`update appraisal_cycles set midyear_scoring_enabled = true where id = $1`, [cycleId])
    ).rejects.toThrow(/appraisal_cycles_midyear_scoring_requires_review/);
  });

  it("rejects a due date before the window start", async () => {
    await expect(
      live.db.query(
        `update appraisal_cycles set midyear_review_enabled = true, midyear_window_start = '2027-07-01', midyear_due_date = '2027-06-01' where id = $1`,
        [cycleId]
      )
    ).rejects.toThrow(/appraisal_cycles_midyear_dates_order/);
  });

  it("accepts a valid configuration", async () => {
    await live.db.query(
      `update appraisal_cycles set midyear_review_enabled = true, midyear_scoring_enabled = true,
         midyear_window_start = '2027-06-01', midyear_due_date = '2027-06-30' where id = $1`,
      [cycleId]
    );
    const row = await live.db.query<{ midyear_scoring_enabled: boolean }>(
      `select midyear_scoring_enabled from appraisal_cycles where id = $1`,
      [cycleId]
    );
    expect(row.rows[0].midyear_scoring_enabled).toBe(true);
  });

  it("check-ins default to INFORMAL", async () => {
    const r = await insertCheckIn("QUARTERLY", null);
    expect(r.rows[0].review_mode).toBe("INFORMAL");
  });

  it("rejects an unknown review_mode", async () => {
    await expect(insertCheckIn("MIDYEAR", "SCORED")).rejects.toThrow(/check_ins_review_mode_check/);
  });

  it.each(["QUARTERLY", "ADHOC"])("rejects a formal %s check-in", async (type) => {
    await expect(insertCheckIn(type, "FORMAL")).rejects.toThrow(/check_ins_formal_only_midyear/);
  });

  it("allows one formal Mid-Year per appraisal; cancelled ones do not count", async () => {
    await insertCheckIn("MIDYEAR", "FORMAL", "CANCELLED");
    await insertCheckIn("MIDYEAR", "FORMAL_SCORED");
    await expect(insertCheckIn("MIDYEAR", "FORMAL")).rejects.toThrow(/idx_check_ins_one_formal_midyear_per_appraisal/);
    await insertCheckIn("MIDYEAR", "INFORMAL");
  });

  it("a COMPLETE formal Mid-Year still blocks a second formal review", async () => {
    await live.db.query(
      `update check_ins set status = 'COMPLETE' where appraisal_id = $1 and review_mode = 'FORMAL_SCORED'`,
      [appraisalId]
    );
    await expect(insertCheckIn("MIDYEAR", "FORMAL")).rejects.toThrow(/idx_check_ins_one_formal_midyear_per_appraisal/);
  });
});

describe("Mid-Year assessment inputs on synthetic rows", () => {
  let appraisalId: string;
  let checkInId: string;
  let factorId: string;
  let techId: string;
  const insertRating = (cols: Record<string, string>) => {
    const names = ["check_in_id", ...Object.keys(cols)];
    const values = ["$1", ...Object.values(cols)];
    return live.db.query(`insert into check_in_competency_ratings (${names.join(", ")}) values (${values.join(", ")}) returning id`, [checkInId]);
  };

  beforeAll(async () => {
    await live.db.exec(`
      insert into employees (employee_id, full_name) values ('I-EMP', 'Input Employee'), ('I-MGR', 'Input Manager');
      insert into appraisal_cycles (name, cycle_type, fiscal_year, start_date, end_date, status)
        values ('Input cycle', 'annual', '2028', '2028-01-01', '2028-12-31', 'open');
    `);
    const appraisal = await live.db.query<{ id: string }>(`
      insert into appraisals (cycle_id, employee_id, manager_employee_id, review_type)
      select id, 'I-EMP', 'I-MGR', 'annual' from appraisal_cycles where name = 'Input cycle' returning id`);
    appraisalId = appraisal.rows[0].id;
    const tech = await live.db.query<{ id: string }>(
      `insert into appraisal_technical_competencies (appraisal_id, name, required_level, weight) values ($1, 'SQL', '6', 100) returning id`,
      [appraisalId]
    );
    techId = tech.rows[0].id;
    const factor = await live.db.query<{ id: string }>(`select id from evaluation_factors limit 1`);
    if (factor.rows[0]) {
      factorId = factor.rows[0].id;
    } else {
      const cat = await live.db.query<{ id: string }>(`insert into evaluation_categories (name, category_type) values ('Core', 'core') returning id`);
      const f = await live.db.query<{ id: string }>(
        `insert into evaluation_factors (category_id, name, weight) values ($1, 'Integrity', 100) returning id`,
        [cat.rows[0].id]
      );
      factorId = f.rows[0].id;
    }
    const ci = await live.db.query<{ id: string }>(
      `insert into check_ins (appraisal_id, title, check_in_type, review_mode, is_management_track)
       values ($1, 'Mid-Year Review – 2028', 'MIDYEAR', 'FORMAL', true) returning id`,
      [appraisalId]
    );
    checkInId = ci.rows[0].id;
  });

  it("a formal check-in must have its management track frozen", async () => {
    await live.db.query(`update check_ins set status = 'CANCELLED' where id = $1`, [checkInId]);
    await expect(
      live.db.query(`insert into check_ins (appraisal_id, title, check_in_type, review_mode) values ($1, 't', 'MIDYEAR', 'FORMAL')`, [appraisalId])
    ).rejects.toThrow(/check_ins_formal_track_frozen/);
    await live.db.query(`update check_ins set status = 'OPEN' where id = $1`, [checkInId]);
  });

  it("informal check-ins leave the track and every new response column NULL", async () => {
    const ci = await live.db.query<{ id: string; is_management_track: boolean | null }>(
      `insert into check_ins (appraisal_id, title, check_in_type) values ($1, 'Q', 'QUARTERLY') returning id, is_management_track`,
      [appraisalId]
    );
    expect(ci.rows[0].is_management_track).toBeNull();
    const wp = await live.db.query<{ id: string }>(`insert into workplans (appraisal_id) values ($1) returning id`, [appraisalId]);
    const item = await live.db.query<{ id: string }>(
      `insert into workplan_items (workplan_id, major_task, weight) values ($1, 'Task', 100) returning id`,
      [wp.rows[0].id]
    );
    const r = await live.db.query<Record<string, unknown>>(
      `insert into check_in_responses (check_in_id, workplan_item_id) values ($1, $2)
       returning employee_actual_raw, employee_completion_date, employee_result, mgr_actual_raw, mgr_completion_date, mgr_result, weight_snapshot`,
      [ci.rows[0].id, item.rows[0].id]
    );
    expect(Object.values(r.rows[0]).every((v) => v === null)).toBe(true);
    await expect(
      live.db.query(`update check_in_responses set employee_result = 101 where check_in_id = $1`, [ci.rows[0].id])
    ).rejects.toThrow(/check_in_responses_employee_result_range/);
    await expect(
      live.db.query(`update check_in_responses set mgr_result = -1 where check_in_id = $1`, [ci.rows[0].id])
    ).rejects.toThrow(/check_in_responses_mgr_result_range/);
  });

  it("stores factor and technical rows once per check-in", async () => {
    await insertRating({ section: "'CORE'", factor_id: `'${factorId}'`, name_snapshot: "'Integrity'", weight_snapshot: "100" });
    await insertRating({ section: "'TECHNICAL'", technical_competency_id: `'${techId}'`, name_snapshot: "'SQL'", weight_snapshot: "100" });
    await expect(
      insertRating({ section: "'CORE'", factor_id: `'${factorId}'`, name_snapshot: "'Integrity'" })
    ).rejects.toThrow(/check_in_competency_ratings_factor_key/);
    await expect(
      insertRating({ section: "'TECHNICAL'", technical_competency_id: `'${techId}'`, name_snapshot: "'SQL'" })
    ).rejects.toThrow(/check_in_competency_ratings_technical_key/);
  });

  it.each([
    [{ section: "'OTHER'", name_snapshot: "'x'" }, /check_in_competency_ratings_section_check/],
    [{ section: "'CORE'", technical_competency_id: "'TECH'", name_snapshot: "'x'" }, /check_in_competency_ratings_source_check/],
    [{ section: "'TECHNICAL'", factor_id: "'FACTOR'", name_snapshot: "'x'" }, /check_in_competency_ratings_source_check/],
    [{ section: "'CORE'", name_snapshot: "'x'", employee_rating_code: "'11'" }, /check_in_competency_ratings_employee_rating_check/],
    [{ section: "'CORE'", name_snapshot: "'x'", manager_rating_code: "'A'" }, /check_in_competency_ratings_manager_rating_check/],
    [{ section: "'CORE'", name_snapshot: "'x'", weight_snapshot: "-1" }, /check_in_competency_ratings_weight_check/],
    [{ section: "'CORE'" }, /null value/],
  ])("rejects invalid competency row %#", async (cols, message) => {
    const resolved = Object.fromEntries(
      Object.entries(cols).map(([k, v]) => [k, v === "'TECH'" ? `'${techId}'` : v === "'FACTOR'" ? `'${factorId}'` : v])
    );
    await expect(insertRating(resolved)).rejects.toThrow(message);
  });

  it("deleting the check-in removes its competency rows; the annual rows are untouched", async () => {
    await live.db.query(`delete from check_ins where id = $1`, [checkInId]);
    const left = await live.db.query<{ n: number }>(`select count(*)::int as n from check_in_competency_ratings where check_in_id = $1`, [checkInId]);
    expect(left.rows[0].n).toBe(0);
    const tech = await live.db.query<{ n: number }>(`select count(*)::int as n from appraisal_technical_competencies where id = $1`, [techId]);
    expect(tech.rows[0].n).toBe(1);
  });

  it("has row level security enabled", async () => {
    const rls = await live.db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'check_in_competency_ratings'`
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });
});

describe("Mid-Year window notices on synthetic rows", () => {
  let appraisalId: string;

  beforeAll(async () => {
    await live.db.exec(`
      insert into employees (employee_id, full_name) values ('W-EMP', 'Window Employee'), ('W-MGR', 'Window Manager');
      insert into appraisal_cycles (name, cycle_type, fiscal_year, start_date, end_date, status)
        values ('Window cycle', 'annual', '2029', '2029-01-01', '2029-12-31', 'open');
    `);
    const appraisal = await live.db.query<{ id: string }>(`
      insert into appraisals (cycle_id, employee_id, manager_employee_id, review_type)
      select id, 'W-EMP', 'W-MGR', 'annual' from appraisal_cycles where name = 'Window cycle' returning id`);
    appraisalId = appraisal.rows[0].id;
  });

  it("records one notice per appraisal and recipient", async () => {
    await live.db.query(`insert into midyear_window_notices (appraisal_id, recipient_employee_id) values ($1, 'W-MGR')`, [appraisalId]);
    await expect(
      live.db.query(`insert into midyear_window_notices (appraisal_id, recipient_employee_id) values ($1, 'W-MGR')`, [appraisalId])
    ).rejects.toThrow(/midyear_window_notices_appraisal_recipient_key/);
    await live.db.query(`insert into midyear_window_notices (appraisal_id, recipient_employee_id) values ($1, 'W-DELEGATE')`, [appraisalId]);
  });

  it("has row level security enabled", async () => {
    const rls = await live.db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = 'midyear_window_notices'`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });
});

describe("check-in RLS hardening and Mid-Year locks (0074)", () => {
  const MIDYEAR_TABLES = ["check_ins", "check_in_responses", "check_in_competency_ratings", "appraisal_score_snapshots", "midyear_window_notices"];
  let appraisalId: string;
  let formalId: string;
  let informalId: string;
  let itemId: string;

  const asRole = async <T,>(role: "anon" | "authenticated" | "service_role", sql: string, params: unknown[] = []) => {
    await live.db.exec(`set role ${role}`);
    try {
      return await live.db.query<T>(sql, params);
    } finally {
      await live.db.exec(`reset role`);
    }
  };

  beforeAll(async () => {
    await live.db.exec(`
      insert into employees (employee_id, full_name) values ('R-EMP', 'RLS Employee'), ('R-MGR', 'RLS Manager');
      insert into appraisal_cycles (name, cycle_type, fiscal_year, start_date, end_date, status)
        values ('RLS cycle', 'annual', '2030', '2030-01-01', '2030-12-31', 'open');
    `);
    const appraisal = await live.db.query<{ id: string }>(`
      insert into appraisals (cycle_id, employee_id, manager_employee_id, review_type)
      select id, 'R-EMP', 'R-MGR', 'annual' from appraisal_cycles where name = 'RLS cycle' returning id`);
    appraisalId = appraisal.rows[0].id;
    const wp = await live.db.query<{ id: string }>(`insert into workplans (appraisal_id) values ($1) returning id`, [appraisalId]);
    const item = await live.db.query<{ id: string }>(
      `insert into workplan_items (workplan_id, major_task, weight) values ($1, 'Task', 100) returning id`,
      [wp.rows[0].id]
    );
    itemId = item.rows[0].id;
    const formal = await live.db.query<{ id: string }>(
      `insert into check_ins (appraisal_id, title, check_in_type, review_mode, is_management_track, status)
       values ($1, 'Mid-Year Review – 2030', 'MIDYEAR', 'FORMAL_SCORED', false, 'MANAGER_REVIEWED') returning id`,
      [appraisalId]
    );
    formalId = formal.rows[0].id;
    await live.db.query(`insert into check_in_responses (check_in_id, workplan_item_id, weight_snapshot) values ($1, $2, 100)`, [formalId, itemId]);
    const informal = await live.db.query<{ id: string }>(
      `insert into check_ins (appraisal_id, title, check_in_type, status) values ($1, 'Q1', 'QUARTERLY', 'COMPLETE') returning id`,
      [appraisalId]
    );
    informalId = informal.rows[0].id;
  });

  it("no check-in or score table keeps a policy open to every role", async () => {
    const rows = await live.db.query<{ table_name: string; name: string; roles: string; qual: string | null }>(
      `select tablename as table_name, policyname as name, roles::text as roles, qual from pg_policies
       where schemaname = 'public' and tablename = any($1)`,
      [MIDYEAR_TABLES]
    );
    const open = rows.rows.filter((p) => p.qual === "true" && p.roles !== "{service_role}");
    expect(open).toEqual([]);
    expect(rows.rows.map((p) => p.name)).not.toContain("check_ins_access");
    expect(rows.rows.map((p) => p.name)).not.toContain("check_in_responses_access");
    for (const t of MIDYEAR_TABLES) {
      expect(rows.rows.some((p) => p.table_name === t && p.name === "service_role_full_access" && p.roles === "{service_role}")).toBe(true);
    }
  });

  it.each(["check_ins", "check_in_responses", "check_in_competency_ratings", "appraisal_score_snapshots", "midyear_window_notices"])(
    "anon cannot read or write %s",
    async (table) => {
      await expect(asRole("anon", `select * from ${table} limit 1`)).rejects.toThrow(/permission denied/);
      await expect(asRole("anon", `delete from ${table}`)).rejects.toThrow(/permission denied/);
    }
  );

  it("an authenticated (non-service) session sees no check-ins and cannot write them", async () => {
    expect((await asRole<{ n: number }>("authenticated", `select count(*)::int as n from check_ins`)).rows[0].n).toBe(0);
    expect((await asRole<{ n: number }>("authenticated", `select count(*)::int as n from check_in_responses`)).rows[0].n).toBe(0);
    await expect(
      asRole("authenticated", `insert into check_ins (appraisal_id, title, check_in_type) values ($1, 'x', 'ADHOC')`, [appraisalId])
    ).rejects.toThrow(/row-level security/);
    await asRole("authenticated", `update check_ins set title = 'hacked' where id = $1`, [formalId]);
    await asRole("authenticated", `delete from check_in_responses where check_in_id = $1`, [formalId]);
    const row = await live.db.query<{ title: string }>(`select title from check_ins where id = $1`, [formalId]);
    expect(row.rows[0].title).toBe("Mid-Year Review – 2030");
    const n = await live.db.query<{ n: number }>(`select count(*)::int as n from check_in_responses where check_in_id = $1`, [formalId]);
    expect(n.rows[0].n).toBe(1);
  });

  it("the service role (used by the API) keeps full access", async () => {
    const r = await asRole<{ n: number }>("service_role", `select count(*)::int as n from check_ins where appraisal_id = $1`, [appraisalId]);
    expect(r.rows[0].n).toBe(2);
  });

  it("a COMPLETE formal review and its rows are locked", async () => {
    await live.db.query(`update check_ins set status = 'COMPLETE' where id = $1`, [formalId]);
    await expect(live.db.query(`update check_ins set status = 'OPEN' where id = $1`, [formalId])).rejects.toThrow(/midyear_review_locked/);
    await expect(live.db.query(`update check_ins set manager_overall_notes = 'x' where id = $1`, [formalId])).rejects.toThrow(/midyear_review_locked/);
    await expect(live.db.query(`update check_in_responses set mgr_result = 10 where check_in_id = $1`, [formalId])).rejects.toThrow(
      /midyear_review_locked/
    );
    await expect(
      live.db.query(`insert into check_in_competency_ratings (check_in_id, section, name_snapshot) values ($1, 'CORE', 'Late')`, [formalId])
    ).rejects.toThrow(/midyear_review_locked/);
  });

  it("the explicit correction path can change a completed review", async () => {
    await live.db.exec(`begin`);
    try {
      await live.db.exec(`set local app.midyear_correction = 'on'`);
      await live.db.query(`update check_in_responses set mgr_result = 55 where check_in_id = $1`, [formalId]);
      await live.db.query(`update check_ins set manager_overall_notes = 'Corrected' where id = $1`, [formalId]);
      await live.db.exec(`commit`);
    } catch (err) {
      await live.db.exec(`rollback`);
      throw err;
    }
    const r = await live.db.query<{ mgr_result: number }>(`select mgr_result from check_in_responses where check_in_id = $1`, [formalId]);
    expect(Number(r.rows[0].mgr_result)).toBe(55);
    await expect(live.db.query(`update check_ins set manager_overall_notes = 'again' where id = $1`, [formalId])).rejects.toThrow(
      /midyear_review_locked/
    );
  });

  it("informal check-ins and deletions are not affected", async () => {
    await live.db.query(`update check_ins set title = 'Q1 renamed' where id = $1`, [informalId]);
    await live.db.query(`delete from check_ins where id = $1`, [formalId]);
    const left = await live.db.query<{ n: number }>(`select count(*)::int as n from check_in_responses where check_in_id = $1`, [formalId]);
    expect(left.rows[0].n).toBe(0);
  });
});

describe("Mid-Year review revisions (0075)", () => {
  let appraisalId: string;
  let checkInId: string;
  const reopen = (reason = "Wrong target used", actor = "u-hr") =>
    live.db.query<{ r: { revision_number: number; previous_score_revision: number | null } }>(
      `select reopen_midyear_review($1, $2, 'Helen HR', $3) as r`,
      [checkInId, actor, reason]
    );
  const insertMidyear = (revision: number, total: number) =>
    live.db.query(
      `insert into appraisal_score_snapshots (appraisal_id, score_type, revision, check_in_id, is_management_track, total_points, components, inputs, engine_version)
       values ($1, 'MIDYEAR', $2, $3, false, $4, '[]'::jsonb, '{}'::jsonb, 'summary-calc/v1')`,
      [appraisalId, revision, checkInId, total]
    );
  const asRole = async <T,>(role: "anon" | "authenticated", sql: string, params: unknown[] = []) => {
    await live.db.exec(`set role ${role}`);
    try {
      return await live.db.query<T>(sql, params);
    } finally {
      await live.db.exec(`reset role`);
    }
  };
  const status = async () => (await live.db.query<{ status: string }>(`select status from check_ins where id = $1`, [checkInId])).rows[0].status;
  const snapshots = async () =>
    (
      await live.db.query<{ revision: number; total_points: string; superseded: boolean }>(
        `select revision, total_points, superseded_at is not null as superseded from appraisal_score_snapshots
         where appraisal_id = $1 and score_type = 'MIDYEAR' order by revision`,
        [appraisalId]
      )
    ).rows.map((r) => [r.revision, Number(r.total_points), r.superseded]);

  beforeAll(async () => {
    await live.db.exec(`
      insert into employees (employee_id, full_name) values ('V-EMP', 'Revision Employee'), ('V-MGR', 'Revision Manager');
      insert into appraisal_cycles (name, cycle_type, fiscal_year, start_date, end_date, status)
        values ('Revision cycle', 'annual', '2031', '2031-01-01', '2031-12-31', 'open');
    `);
    const appraisal = await live.db.query<{ id: string }>(`
      insert into appraisals (cycle_id, employee_id, manager_employee_id, review_type, status)
      select id, 'V-EMP', 'V-MGR', 'annual', 'IN_PROGRESS' from appraisal_cycles where name = 'Revision cycle' returning id`);
    appraisalId = appraisal.rows[0].id;
    const wp = await live.db.query<{ id: string }>(`insert into workplans (appraisal_id) values ($1) returning id`, [appraisalId]);
    const item = await live.db.query<{ id: string }>(`insert into workplan_items (workplan_id, major_task, weight) values ($1, 'Task', 100) returning id`, [
      wp.rows[0].id,
    ]);
    const ci = await live.db.query<{ id: string }>(
      `insert into check_ins (appraisal_id, title, check_in_type, review_mode, is_management_track, status)
       values ($1, 'Mid-Year Review – 2031', 'MIDYEAR', 'FORMAL_SCORED', false, 'MANAGER_REVIEWED') returning id`,
      [appraisalId]
    );
    checkInId = ci.rows[0].id;
    await live.db.query(
      `insert into check_in_responses (check_in_id, workplan_item_id, weight_snapshot, employee_actual_raw, mgr_result) values ($1, $2, 100, 8, 60)`,
      [checkInId, item.rows[0].id]
    );
    await insertMidyear(1, 72.4);
    await live.db.query(`update check_ins set status = 'COMPLETE' where id = $1`, [checkInId]);
  });

  it("only the service role can reopen or read revisions", async () => {
    await expect(asRole("anon", `select reopen_midyear_review($1, 'x', 'x', 'reason')`, [checkInId])).rejects.toThrow(/permission denied/);
    await expect(asRole("authenticated", `select reopen_midyear_review($1, 'x', 'x', 'reason')`, [checkInId])).rejects.toThrow(/permission denied/);
    await expect(asRole("anon", `select * from midyear_review_revisions`)).rejects.toThrow(/permission denied/);
    expect((await asRole<{ n: number }>("authenticated", `select count(*)::int as n from midyear_review_revisions`)).rows[0].n).toBe(0);
    expect(await status()).toBe("COMPLETE");
  });

  it("requires an actor and a reason, and an In progress appraisal", async () => {
    await expect(reopen("   ")).rejects.toThrow(/midyear_reopen_reason_required/);
    await expect(reopen("Reason", "")).rejects.toThrow(/midyear_reopen_actor_required/);
    await live.db.query(`update appraisals set status = 'SELF_ASSESSMENT' where id = $1`, [appraisalId]);
    await expect(reopen()).rejects.toThrow(/midyear_reopen_appraisal_locked/);
    await live.db.query(`update appraisals set status = 'IN_PROGRESS' where id = $1`, [appraisalId]);
    expect(await status()).toBe("COMPLETE");
  });

  it("reopens atomically: status, revision record and superseded score", async () => {
    const r = await reopen();
    expect(r.rows[0].r).toMatchObject({ revision_number: 2, previous_score_revision: 1 });
    expect(await status()).toBe("EMPLOYEE_SUBMITTED");
    const appraisal = await live.db.query<{ status: string }>(`select status from appraisals where id = $1`, [appraisalId]);
    expect(appraisal.rows[0].status).toBe("IN_PROGRESS");
    const rev = await live.db.query<Record<string, unknown>>(
      `select revision_number, reopened_by, reopened_by_name, reopen_reason, previous_score_revision, completed_at from midyear_review_revisions where check_in_id = $1`,
      [checkInId]
    );
    expect(rev.rows).toEqual([
      { revision_number: 2, reopened_by: "u-hr", reopened_by_name: "Helen HR", reopen_reason: "Wrong target used", previous_score_revision: 1, completed_at: null },
    ]);
    expect(await snapshots()).toEqual([[1, 72.4, true]]);
  });

  it("an open review cannot be reopened again, and the superseded score cannot change", async () => {
    await expect(reopen()).rejects.toThrow(/midyear_reopen_not_complete/);
    await expect(
      live.db.query(`update appraisal_score_snapshots set total_points = 99 where appraisal_id = $1 and revision = 1`, [appraisalId])
    ).rejects.toThrow(/midyear_score_revision_immutable/);
    await expect(
      live.db.query(`update appraisal_score_snapshots set superseded_at = now() where appraisal_id = $1 and revision = 1`, [appraisalId])
    ).rejects.toThrow(/midyear_score_revision_immutable/);
  });

  it("the manager portion is editable during the revision without the correction flag", async () => {
    await live.db.query(`update check_in_responses set mgr_result = 80 where check_in_id = $1`, [checkInId]);
    await live.db.query(`update check_ins set status = 'MANAGER_REVIEWED' where id = $1`, [checkInId]);
  });

  it("re-completion adds revision 2 as the only current score, then the lock applies again", async () => {
    await insertMidyear(2, 75.1);
    await expect(insertMidyear(3, 50)).rejects.toThrow(/idx_appraisal_score_snapshots_one_current/);
    await live.db.query(`update check_ins set status = 'COMPLETE' where id = $1`, [checkInId]);
    await live.db.query(`update midyear_review_revisions set completed_at = now(), completed_by = 'u-mgr', score_revision = 2 where check_in_id = $1`, [checkInId]);
    expect(await snapshots()).toEqual([
      [1, 72.4, true],
      [2, 75.1, false],
    ]);
    await expect(live.db.query(`update check_in_responses set mgr_result = 10 where check_in_id = $1`, [checkInId])).rejects.toThrow(/midyear_review_locked/);
    await expect(
      live.db.query(`update midyear_review_revisions set reopen_reason = 'rewritten' where check_in_id = $1`, [checkInId])
    ).rejects.toThrow(/midyear_revision_immutable/);
    await expect(
      live.db.query(`update midyear_review_revisions set completed_at = now() where check_in_id = $1`, [checkInId])
    ).rejects.toThrow(/midyear_revision_immutable/);
  });

  it("a second reopen creates revision 3 and keeps revisions 1 and 2", async () => {
    const r = await reopen("Second correction");
    expect(r.rows[0].r).toMatchObject({ revision_number: 3, previous_score_revision: 2 });
    expect(await snapshots()).toEqual([
      [1, 72.4, true],
      [2, 75.1, true],
    ]);
  });

  it("FINAL stays a single revision that is never superseded", async () => {
    const final = (revision: number, superseded: boolean) =>
      live.db.query(
        `insert into appraisal_score_snapshots (appraisal_id, score_type, revision, superseded_at, is_management_track, total_points, components, inputs, engine_version)
         values ($1, 'FINAL', $2, ${superseded ? "now()" : "null"}, false, 80, '[]'::jsonb, '{}'::jsonb, 'v')`,
        [appraisalId, revision]
      );
    await expect(final(2, false)).rejects.toThrow(/appraisal_score_snapshots_final_single_revision/);
    await expect(final(1, true)).rejects.toThrow(/appraisal_score_snapshots_final_single_revision/);
    await final(1, false);
  });

  it("rejects a blank reason written directly", async () => {
    await expect(
      live.db.query(
        `insert into midyear_review_revisions (check_in_id, appraisal_id, revision_number, reopened_by, reopen_reason) values ($1, $2, 9, 'u', '  ')`,
        [checkInId, appraisalId]
      )
    ).rejects.toThrow(/midyear_review_revisions_reason_check/);
  });

  it("deleting the check-in removes its revisions and keeps the score history", async () => {
    await live.db.query(`delete from check_ins where id = $1`, [checkInId]);
    const left = await live.db.query<{ n: number }>(`select count(*)::int as n from midyear_review_revisions where check_in_id = $1`, [checkInId]);
    expect(left.rows[0].n).toBe(0);
    expect((await snapshots()).map(([rev]) => rev)).toEqual([1, 2]);
  });

  it("has row level security enabled", async () => {
    const rls = await live.db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = 'midyear_review_revisions'`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });
});

describe("appraisal notification deliveries (0076) on synthetic rows", () => {
  let appraisalId: string;

  const insert = (cols: Record<string, unknown>) => {
    const row = {
      appraisal_id: appraisalId,
      recipient_employee_id: "N-EMP",
      recipient_role: "employee",
      notification_kind: "MIDYEAR_DUE_SOON",
      reminder_key: "MIDYEAR_DUE_SOON:-7:2031-10-30",
      scheduled_for: "2031-10-23",
      ...cols,
    };
    const keys = Object.keys(row);
    return live.db.query<{ id: string; status: string; attempt_count: number }>(
      `insert into appraisal_notification_deliveries (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})
       returning id, status, attempt_count`,
      Object.values(row)
    );
  };

  beforeAll(async () => {
    await live.db.exec(`
      insert into employees (employee_id, full_name) values ('N-EMP', 'Notice Employee'), ('N-MGR', 'Notice Manager');
      insert into appraisal_cycles (name, cycle_type, fiscal_year, start_date, end_date, status)
        values ('Notice cycle', 'annual', '2031', '2031-01-01', '2031-12-31', 'open');
    `);
    const appraisal = await live.db.query<{ id: string }>(`
      insert into appraisals (cycle_id, employee_id, manager_employee_id, review_type)
      select id, 'N-EMP', 'N-MGR', 'annual' from appraisal_cycles where name = 'Notice cycle' returning id`);
    appraisalId = appraisal.rows[0].id;
  });

  it("starts PENDING with no attempts", async () => {
    const r = await insert({});
    expect(r.rows[0]).toMatchObject({ status: "PENDING", attempt_count: 0 });
  });

  it("records each occurrence once per appraisal, recipient and reminder key", async () => {
    await expect(insert({})).rejects.toThrow(/appraisal_notification_deliveries_occurrence_key/);
    await insert({ reminder_key: "MIDYEAR_DUE_SOON:-3:2031-10-30", scheduled_for: "2031-10-27" });
    await insert({
      recipient_employee_id: "N-MGR",
      recipient_role: "manager",
      notification_kind: "MIDYEAR_MANAGER_REVIEW_PENDING",
      reminder_key: "MIDYEAR_DUE_SOON:-7:2031-10-30",
    });
  });

  it("only allows the delivery statuses and recipient roles", async () => {
    await expect(insert({ reminder_key: "k1", status: "DONE" })).rejects.toThrow(/appraisal_notification_deliveries_status_check/);
    await expect(insert({ reminder_key: "k2", recipient_role: "hr" })).rejects.toThrow(/appraisal_notification_deliveries_role_check/);
    await expect(insert({ reminder_key: "k3", attempt_count: -1 })).rejects.toThrow(/appraisal_notification_deliveries_attempts_check/);
  });

  it("stores only a short sanitised error code, never raw provider text", async () => {
    await insert({ reminder_key: "k4", status: "FAILED", error_code: "GRAPH_503", attempt_count: 1 });
    await expect(
      insert({ reminder_key: "k5", status: "FAILED", error_code: "Graph sendMail failed (503): mailbox unavailable" })
    ).rejects.toThrow(/appraisal_notification_deliveries_error_code_check/);
  });

  it("cannot be marked SENT without a sent time", async () => {
    await expect(insert({ reminder_key: "k6", status: "SENT" })).rejects.toThrow(/appraisal_notification_deliveries_sent_at_check/);
    await insert({ reminder_key: "k7", status: "SENT", sent_at: "2031-10-23T13:00:00Z", attempt_count: 1 });
  });

  it("has no columns for message content", async () => {
    const cols = columnsOf(liveSchema, "appraisal_notification_deliveries");
    for (const forbidden of ["subject", "body", "html", "text_content", "score", "token", "error_message"]) {
      expect(cols.has(forbidden)).toBe(false);
    }
  });

  it("is service-role only apart from an HR/admin read policy, and anon has no access", async () => {
    const rls = await live.db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'appraisal_notification_deliveries'`
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const anon = await live.db.query<{ ok: boolean }>(
      `select has_table_privilege('anon', 'public.appraisal_notification_deliveries', 'select') as ok`
    );
    expect(anon.rows[0].ok).toBe(false);
    const policies = await live.db.query<{ name: string; cmd: string; roles: string }>(
      `select policyname as name, cmd, roles::text as roles from pg_policies where tablename = 'appraisal_notification_deliveries' order by 1`
    );
    expect(policies.rows).toEqual([
      { name: "appraisal_notification_deliveries_select_hr_admin", cmd: "SELECT", roles: "{authenticated}" },
      { name: "service_role_full_access", cmd: "ALL", roles: "{service_role}" },
    ]);
  });

  it("is removed with its appraisal", async () => {
    await live.db.query(`delete from appraisals where id = $1`, [appraisalId]);
    const left = await live.db.query<{ n: number }>(
      `select count(*)::int as n from appraisal_notification_deliveries where appraisal_id = $1`,
      [appraisalId]
    );
    expect(left.rows[0].n).toBe(0);
  });
});

describe("scratch database isolation", () => {
  it("runs in memory with the Supabase shim roles", async () => {
    const db = await createScratchDb();
    const roles = await db.query<{ rolname: string }>(
      `select rolname from pg_roles where rolname in ('anon','authenticated','service_role') order by 1`
    );
    expect(roles.rows.map((r) => r.rolname)).toEqual(["anon", "authenticated", "service_role"]);
    await db.close();
  });
});
