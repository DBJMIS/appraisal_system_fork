/**
 * Known exceptions in the current migration chain, recorded during the database
 * baseline review. Tests in tests/db/ fail when the chain drifts from this register,
 * so any new exception has to be added here deliberately.
 */

/** Supabase versions shared by more than one file; schema_migrations can record only one file per version. */
export const KNOWN_DUPLICATE_VERSIONS = {
  "0049": ["0049_360_manager_and_audit.sql", "0049_5_reset_appraisal_data.sql"],
  "0063": ["0063_appraisal_delegations.sql", "0063_employee_sync_log.sql"],
};

/** Data-destroying statements permitted in active migrations, per file. */
export const DESTRUCTIVE_ALLOWLIST = {
  "0019_workplan_dbj_schema.sql": { "drop column": "actual_result converted from text to numeric" },
  "0020_full_appraisal_workflow.sql": { "drop column": "appraisals.status converted from enum to text" },
  "0049_5_reset_appraisal_data.sql": { truncate: "wipes all appraisal, workplan, 360 and cycle data; must leave the active chain" },
  "0050_annual_only_appraisal.sql": { "delete from": "deletes duplicate appraisals and non-annual cycle_review_types" },
  "0051_process_driven_workflow.sql": { "drop column": "appraisal_cycles.phase removed" },
  "0054_rating_scale_1_to_10.sql": { "delete from": "replaces A-E rating_scale and deletes A-E factor ratings" },
  "0062_eq_employee_id.sql": { "drop table": "eq_drafts and eq_results recreated keyed by employee_id" },
  "0064_development_profile_employees_employee_id.sql": {
    "delete from": "deletes development profiles that cannot be mapped to employee_id",
    "drop column": "uuid employee_id replaced by text employee_id",
  },
};

/** Files that fail when the chain is replayed as-is on an empty database. */
export const KNOWN_REPLAY_FAILURES = {
  "0042_operational_plan.sql": "user_roles.role is the user_role enum, so the policy literal 'super_admin' is rejected",
  "0043_workplan_objective_fks.sql": "depends on 0042 tables",
  "0048_achieveit_plan_id.sql": "depends on 0042 tables",
};

/**
 * In-memory correction that reproduces the live user_roles view (role exposed as text),
 * confirmed from live schema metadata. With it the whole chain applies.
 */
export function liveCompatibleTransform(file, sql) {
  if (file === "0041_user_roles_view_for_operational_plan.sql") {
    return sql.replace("role from app_users", "role::text as role from app_users");
  }
  return sql;
}

/** Columns the application references that the migration chain does not create. */
export const KNOWN_APP_SCHEMA_DRIFT = {
  "app_users.roles": "present in the live project as text[] NOT NULL; added outside the migration chain",
  "workplan_items.task": "renamed to major_task in 0019; lib/workplan-copy.ts is legacy",
  "workplan_items.output": "renamed to key_output in 0019; lib/workplan-copy.ts is legacy",
};

/** Objects the migrations create that the live project lacks (from live schema metadata; not asserted offline). */
export const KNOWN_LIVE_DRIFT = {
  "employees.department_head_system_user_id": "added by 0013 but absent live; lib/reporting-structure.ts select fails",
  "user_roles.role": "text live, user_role enum in 0041",
};

/**
 * Classification of every non-extension function in the public schema.
 * active | active_inconsistent | legacy_referenced | dead | unknown
 */
export const FUNCTION_REGISTER = {
  set_management_flag: { status: "active", note: "BEFORE INSERT/UPDATE trigger on appraisals" },
  set_initial_appraisal_status: { status: "active", note: "trigger on appraisals; defaults status to DRAFT" },
  appraisal_cycle_activate_360: { status: "active", note: "trigger on appraisal_cycles" },
  feedback_cycle_activate_participants: { status: "active", note: "trigger on feedback_cycle" },
  feedback_participant_generate_reviewers: { status: "active", note: "trigger on feedback_participant" },
  feedback_response_lock_after_submit: { status: "active", note: "trigger on feedback_response" },
  approve_workplan: {
    status: "active_inconsistent",
    note: "called by workplan/approve route; requires workplans.status='submitted', which no working path sets",
  },
  reject_workplan: {
    status: "active_inconsistent",
    note: "called by workplan/reject route; unreachable precondition and writes appraisal status 'workplan_draft' rejected by the status CHECK",
  },
  submit_workplan_for_approval: {
    status: "legacy_referenced",
    note: "called only by workplan/submit route (no UI caller); writes 'workplan_submitted', rejected by the status CHECK",
  },
  can_edit_workplan: { status: "dead", note: "no application, policy or trigger caller" },
  can_edit_assessment: { status: "dead", note: "no application, policy or trigger caller" },
  get_360_anonymous_report: {
    status: "unknown",
    note: "no application caller; exposed through PostgREST RPC; SECURITY INVOKER over a security_invoker view",
  },
  midyear_correction_enabled: { status: "active", note: "0074: true only when app.midyear_correction = 'on' in the transaction" },
  guard_completed_midyear_check_in: { status: "active", note: "0074: BEFORE UPDATE trigger on check_ins; locks COMPLETE formal reviews" },
  guard_completed_midyear_child: {
    status: "active",
    note: "0074: BEFORE INSERT/UPDATE trigger on check_in_responses and check_in_competency_ratings of COMPLETE formal reviews",
  },
  guard_midyear_score_revision: {
    status: "active",
    note: "0075: BEFORE UPDATE trigger on appraisal_score_snapshots; MIDYEAR revisions are immutable apart from being superseded once",
  },
  guard_midyear_review_revision: {
    status: "active",
    note: "0075: BEFORE UPDATE trigger on midyear_review_revisions; reopen facts are immutable, an open revision may be completed once",
  },
  reopen_midyear_review: {
    status: "active",
    note: "0075: called by the check-in PATCH route (REOPEN); service_role only; reopens a COMPLETE formal review while IN_PROGRESS",
  },
};
