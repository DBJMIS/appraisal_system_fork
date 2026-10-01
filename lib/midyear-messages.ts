/**
 * Wording for the formal Mid-Year Review notifications. Pure (no I/O) so the email-template
 * registry can reuse the same subjects and bodies that lib/midyear-notifications.ts sends.
 */

export type MidyearNoticeKind =
  | "midyear_window_open"
  | "midyear_ready"
  | "midyear_submitted"
  | "midyear_completed"
  | "midyear_reopened"
  | "midyear_revision_completed";

export interface MidyearMessage {
  kind: MidyearNoticeKind;
  title: string;
  body: string;
  subject: string;
}

const forYear = (fy: string | null) => (fy ? ` for ${fy}` : "");

export const midyearMessages = {
  windowOpen: (p: { fiscalYear: string | null; employeeName: string; dueDate: string | null }): MidyearMessage => ({
    kind: "midyear_window_open",
    title: "Mid-Year Review due",
    body:
      `The Mid-Year Review${forYear(p.fiscalYear)} is now open for ${p.employeeName}. ` +
      (p.dueDate ? `Please initiate the review by ${p.dueDate}.` : "Please initiate the review."),
    subject: `Mid-Year Review now open for ${p.employeeName}`,
  }),
  ready: (p: { fiscalYear: string | null }): MidyearMessage => ({
    kind: "midyear_ready",
    title: "Mid-Year Review ready",
    body: `Your Mid-Year Review${forYear(p.fiscalYear)} is ready for your input.`,
    subject: "Your Mid-Year Review is ready for your input",
  }),
  submitted: (p: { fiscalYear: string | null; employeeName: string }): MidyearMessage => ({
    kind: "midyear_submitted",
    title: "Mid-Year Review submitted",
    body: `${p.employeeName} has submitted their Mid-Year Review${forYear(p.fiscalYear)}. Please complete your manager review.`,
    subject: `${p.employeeName} has submitted their Mid-Year Review`,
  }),
  completed: (p: { fiscalYear: string | null }): MidyearMessage => ({
    kind: "midyear_completed",
    title: "Mid-Year Review completed",
    body: `Your Mid-Year Review${forYear(p.fiscalYear)} has been completed by your manager. Log in to the appraisal portal to view the outcome.`,
    subject: "Your Mid-Year Review has been completed",
  }),
  reopened: (p: { fiscalYear: string | null; reason: string; audience: "manager" | "employee"; employeeName: string }): MidyearMessage => ({
    kind: "midyear_reopened",
    title: "Mid-Year Review reopened",
    body:
      `${p.audience === "manager" ? `${p.employeeName}'s` : "The"} Mid-Year Review${forYear(p.fiscalYear)} has been reopened for revision. ` +
      `Reason: ${p.reason}\n\n` +
      (p.audience === "manager"
        ? "Please review the manager assessment and complete the revised Mid-Year Review."
        : "Your submitted inputs are unchanged. You will be notified when the revised review is complete."),
    subject: "Mid-Year Review reopened for revision",
  }),
  revisionCompleted: (p: { fiscalYear: string | null }): MidyearMessage => ({
    kind: "midyear_revision_completed",
    title: "Revised Mid-Year Review completed",
    body: `Your revised Mid-Year Review${forYear(p.fiscalYear)} has been completed. Log in to the appraisal portal to view the outcome.`,
    subject: "Your revised Mid-Year Review has been completed",
  }),
};
