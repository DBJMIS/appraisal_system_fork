export type NotificationType =
  | "appraisal.submitted"
  | "appraisal.workplan_pending"
  | "appraisal.manager_reviewed"
  | "appraisal.sign_off_ready"
  | "appraisal.signed"
  | "appraisal.hr_closed"
  | "appraisal.reminder"
  | "checkin.requested"
  | "checkin.completed"
  | "feedback.assigned"
  | "feedback.reminder"
  | "feedback.cycle_completed"
  | "system.announcement";

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}
