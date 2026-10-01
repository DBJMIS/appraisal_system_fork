-- Per-run employee sync detail snapshot (added/reactivated/deactivated/no_appraisal/skipped).
-- Nullable: runs recorded before this column existed keep details = NULL ("not recorded").
alter table employee_sync_log
  add column if not exists details jsonb;
