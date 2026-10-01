/**
 * Appraisal email templates. The single renderer used by the admin preview, the admin test send
 * and (later) real reminders, so all three always produce the same subject, text and HTML.
 * Pure: no I/O. Templates carry review status and dates only, never scores or ratings.
 */

import { midyearMessages } from "@/lib/midyear-messages";

export const EMAIL_KINDS = [
  "MIDYEAR_WINDOW_OPEN",
  "MIDYEAR_READY",
  "MIDYEAR_DUE_SOON",
  "MIDYEAR_OVERDUE",
  "MIDYEAR_MANAGER_REVIEW_PENDING",
  "FINAL_REVIEW_AVAILABLE",
  "FINAL_REVIEW_DUE_SOON",
  "FINAL_REVIEW_OVERDUE",
  "MANAGER_REVIEW_PENDING",
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

export type EmailRecipientRole = "employee" | "manager";

/** Which configured date a template's "due date" refers to. */
export type EmailDueDateSource = "midyear" | "final";

export interface EmailContext {
  appraisalId: string;
  employeeName: string;
  managerName: string | null;
  cycleName: string | null;
  /** Display label, e.g. "FY 2026/27". */
  fiscalYear: string | null;
  /** Appraisal review type label, e.g. "Annual". */
  reviewType: string | null;
  /** Appraisal status label, e.g. "In progress". */
  status: string | null;
  /** Display date for this template's due date, e.g. "30 Oct 2026". */
  dueDate: string | null;
  /** Absolute application base URL without a trailing slash; null when not configured. */
  appUrl: string | null;
  /** Manager reminders sent after the due date use overdue wording. */
  isOverdue?: boolean;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

interface EmailContent {
  subject: string;
  /** Paragraphs; plain text, escaped when rendered as HTML. */
  body: string[];
  /** HTML heading shown under the review eyebrow. */
  heading: string;
  reviewLabel: string;
  ctaLabel: string;
  overdue?: boolean;
}

export interface EmailTemplateDefinition {
  label: string;
  recipientRole: EmailRecipientRole;
  dueDateSource: EmailDueDateSource;
  content: (ctx: EmailContext) => EmailContent;
}

const fyPhrase = (fy: string | null) => (fy ? `${fy} ` : "");

export const EMAIL_TEMPLATES: Record<EmailKind, EmailTemplateDefinition> = {
  MIDYEAR_WINDOW_OPEN: {
    label: "Mid-Year Review window open",
    recipientRole: "manager",
    dueDateSource: "midyear",
    content: (ctx) => {
      const m = midyearMessages.windowOpen({ fiscalYear: ctx.fiscalYear, employeeName: ctx.employeeName, dueDate: ctx.dueDate });
      return {
        subject: m.subject,
        body: [m.body],
        heading: "Mid-Year Review now open",
        reviewLabel: "Mid-Year Review",
        ctaLabel: "Open Mid-Year Review",
      };
    },
  },
  MIDYEAR_READY: {
    label: "Mid-Year Review ready for input",
    recipientRole: "employee",
    dueDateSource: "midyear",
    content: (ctx) => {
      const m = midyearMessages.ready({ fiscalYear: ctx.fiscalYear });
      return {
        subject: m.subject,
        body: [m.body],
        heading: "Mid-Year Review ready for your input",
        reviewLabel: "Mid-Year Review",
        ctaLabel: "Open Mid-Year Review",
      };
    },
  },
  MIDYEAR_DUE_SOON: {
    label: "Mid-Year Review due soon",
    recipientRole: "employee",
    dueDateSource: "midyear",
    content: (ctx) => ({
      subject: ctx.dueDate ? `Mid-Year Review due ${ctx.dueDate}` : "Mid-Year Review due soon",
      body: [
        ctx.dueDate
          ? `Your Mid-Year Review${ctx.fiscalYear ? ` for ${ctx.fiscalYear}` : ""} is due on ${ctx.dueDate}. Please complete your required input before the deadline.`
          : `Your Mid-Year Review${ctx.fiscalYear ? ` for ${ctx.fiscalYear}` : ""} is due soon. Please complete your required input before the deadline.`,
      ],
      heading: "Mid-Year Review due soon",
      reviewLabel: "Mid-Year Review",
      ctaLabel: "Open Mid-Year Review",
    }),
  },
  MIDYEAR_OVERDUE: {
    label: "Mid-Year Review overdue",
    recipientRole: "employee",
    dueDateSource: "midyear",
    content: (ctx) => ({
      subject: "Mid-Year Review overdue",
      body: [
        ctx.dueDate
          ? `Your Mid-Year Review${ctx.fiscalYear ? ` for ${ctx.fiscalYear}` : ""} was due on ${ctx.dueDate} and is now overdue. Please complete your required input as soon as possible.`
          : `Your Mid-Year Review${ctx.fiscalYear ? ` for ${ctx.fiscalYear}` : ""} is now overdue. Please complete your required input as soon as possible.`,
      ],
      heading: "Mid-Year Review overdue",
      reviewLabel: "Mid-Year Review",
      ctaLabel: "Open Mid-Year Review",
      overdue: true,
    }),
  },
  MIDYEAR_MANAGER_REVIEW_PENDING: {
    label: "Mid-Year manager review pending",
    recipientRole: "manager",
    dueDateSource: "midyear",
    content: (ctx) => {
      const m = midyearMessages.submitted({ fiscalYear: ctx.fiscalYear, employeeName: ctx.employeeName });
      const overdue = Boolean(ctx.isOverdue);
      const dueLine = ctx.dueDate
        ? overdue
          ? ` It was due on ${ctx.dueDate} and is now overdue.`
          : ` Please complete it by ${ctx.dueDate}.`
        : "";
      return {
        subject: overdue
          ? `Mid-Year manager review overdue: ${ctx.employeeName}`
          : `Mid-Year manager review pending: ${ctx.employeeName}`,
        body: [`${m.body}${dueLine}`],
        heading: overdue ? "Mid-Year manager review overdue" : "Mid-Year manager review pending",
        reviewLabel: "Mid-Year Review",
        ctaLabel: "Open Mid-Year Review",
        overdue,
      };
    },
  },
  FINAL_REVIEW_AVAILABLE: {
    label: "Final Review available",
    recipientRole: "employee",
    dueDateSource: "final",
    content: (ctx) => ({
      subject: "Your Final Review is ready",
      body: [
        `Your ${fyPhrase(ctx.fiscalYear)}Final Review is now available. ` +
          (ctx.dueDate ? `Please complete your self-assessment by ${ctx.dueDate}.` : "Please complete your self-assessment."),
      ],
      heading: "Your Final Review is ready",
      reviewLabel: "Final Review",
      ctaLabel: "Start Final Review",
    }),
  },
  FINAL_REVIEW_DUE_SOON: {
    label: "Final Review self-assessment due soon",
    recipientRole: "employee",
    dueDateSource: "final",
    content: (ctx) => ({
      subject: ctx.dueDate ? `Final Review self-assessment due ${ctx.dueDate}` : "Final Review self-assessment due soon",
      body: [
        `Your self-assessment for the ${fyPhrase(ctx.fiscalYear)}Final Review is due ` +
          (ctx.dueDate ? `on ${ctx.dueDate}. ` : "soon. ") +
          "Please complete and submit it before the deadline.",
      ],
      heading: "Final Review self-assessment due soon",
      reviewLabel: "Final Review",
      ctaLabel: "Open Final Review",
    }),
  },
  FINAL_REVIEW_OVERDUE: {
    label: "Final Review self-assessment overdue",
    recipientRole: "employee",
    dueDateSource: "final",
    content: (ctx) => ({
      subject: "Final Review self-assessment overdue",
      body: [
        `Your self-assessment for the ${fyPhrase(ctx.fiscalYear)}Final Review ` +
          (ctx.dueDate ? `was due on ${ctx.dueDate} and is now overdue. ` : "is now overdue. ") +
          "Please complete and submit it as soon as possible.",
      ],
      heading: "Final Review self-assessment overdue",
      reviewLabel: "Final Review",
      ctaLabel: "Open Final Review",
      overdue: true,
    }),
  },
  MANAGER_REVIEW_PENDING: {
    label: "Manager review pending",
    recipientRole: "manager",
    dueDateSource: "final",
    content: (ctx) =>
      ctx.isOverdue
        ? {
            subject: `Manager review overdue: ${ctx.employeeName}`,
            body: [
              `${ctx.employeeName} has submitted their ${fyPhrase(ctx.fiscalYear)}Final Review self-assessment. ` +
                (ctx.dueDate
                  ? `Your manager review was due on ${ctx.dueDate} and is now overdue.`
                  : "Your manager review is now overdue."),
            ],
            heading: "Manager review overdue",
            reviewLabel: "Final Review",
            ctaLabel: "Open Manager Review",
            overdue: true,
          }
        : {
            subject: `Manager review pending: ${ctx.employeeName}`,
            body: [
              `${ctx.employeeName} has submitted their ${fyPhrase(ctx.fiscalYear)}Final Review self-assessment. ` +
                (ctx.dueDate ? `Please complete your manager review by ${ctx.dueDate}.` : "Please complete your manager review."),
            ],
            heading: "Manager review pending",
            reviewLabel: "Final Review",
            ctaLabel: "Open Manager Review",
          },
  },
};

export function isEmailKind(value: unknown): value is EmailKind {
  return typeof value === "string" && (EMAIL_KINDS as readonly string[]).includes(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function appraisalLink(ctx: Pick<EmailContext, "appUrl" | "appraisalId">): string | null {
  return ctx.appUrl ? `${ctx.appUrl}/appraisals/${encodeURIComponent(ctx.appraisalId)}` : null;
}

const NO_LINK_TEXT = "Sign in to DBJ Ascend to continue.";
const FOOTER_LINES = [
  "This is an automated message from DBJ Ascend, the Development Bank of Jamaica appraisal system.",
  "Please do not reply to this email.",
];
const FOOTER_TEXT = FOOTER_LINES.join(" ");

function greeting(role: EmailRecipientRole, ctx: EmailContext): string {
  const name = role === "manager" ? ctx.managerName : ctx.employeeName;
  return name ? `Hello ${name},` : "Hello,";
}

function details(role: EmailRecipientRole, ctx: EmailContext, reviewLabel: string): [string, string][] {
  const rows: [string, string | null][] = [
    ["Employee", role === "manager" ? ctx.employeeName : null],
    ["Review", reviewLabel],
    ["Fiscal year", ctx.fiscalYear],
    ["Due date", ctx.dueDate],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

const C = {
  brand: "#646f79",
  ink: "#0d0e10",
  text: "#0d0d0d",
  body: "#3a4047",
  muted: "#6b7280",
  page: "#f3f3f3",
  card: "#ffffff",
  panel: "#fafafa",
  line: "#ececec",
  amberBg: "#fdf6e7",
  amberLine: "#f1dfb5",
  amberText: "#8a5a00",
  font: "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif",
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Escapes text and bolds the given values (e.g. employee name, due date) wherever they appear. */
function emphasise(raw: string, values: (string | null)[]): string {
  const list = [...new Set(values.filter((v): v is string => !!v && v.trim().length > 1))].sort((a, b) => b.length - a.length);
  if (!list.length) return escapeHtml(raw);
  const re = new RegExp(`(${list.map(escapeRegExp).join("|")})`, "g");
  return raw
    .split(re)
    .map((part, i) => (i % 2 === 1 ? `<strong style="font-weight:600;color:${C.text};">${escapeHtml(part)}</strong>` : escapeHtml(part)))
    .join("");
}

/** Outlook (VML) and standard versions of one button; both link to the same URL. */
function ctaButton(link: string, label: string): string {
  const href = escapeHtml(link);
  const text = escapeHtml(label);
  const width = Math.max(200, label.length * 8 + 56);
  return (
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" ` +
    `style="height:44px;v-text-anchor:middle;width:${width}px;" arcsize="14%" stroke="f" fillcolor="${C.ink}"><w:anchorlock/>` +
    `<center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">${text}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!-- --><a href="${href}" target="_blank" rel="noopener" ` +
    `style="display:inline-block;background:${C.ink};color:#ffffff;font-family:${C.font};font-size:14px;font-weight:600;line-height:20px;` +
    `text-decoration:none;padding:12px 26px;border-radius:6px;mso-hide:all;">${text}</a><!--<![endif]-->`
  );
}

function summaryCard(rows: [string, string][], amberValue: string | null): string {
  if (!rows.length) return "";
  const body = rows
    .map(([label, value], i) => {
      const top = i === 0 ? "" : `border-top:1px solid ${C.line};`;
      const shown =
        amberValue && label === "Due date"
          ? `<span style="display:inline-block;padding:2px 10px;background:${C.amberBg};border:1px solid ${C.amberLine};border-radius:999px;color:${C.amberText};font-weight:600;">${escapeHtml(value)}</span>`
          : escapeHtml(value);
      return (
        `<tr>` +
        `<td class="ea-label" style="${top}padding:13px 20px;font-family:${C.font};font-size:13px;line-height:20px;color:${C.muted};width:40%;vertical-align:middle;">${escapeHtml(label)}</td>` +
        `<td class="ea-value" align="right" style="${top}padding:13px 20px;font-family:${C.font};font-size:14px;line-height:20px;color:${C.text};font-weight:600;text-align:right;vertical-align:middle;">${shown}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="margin:0 0 28px;background:${C.panel};border:1px solid ${C.line};border-radius:8px;border-collapse:separate;">${body}</table>`
  );
}

const MOBILE_CSS =
  "@media only screen and (max-width:620px){" +
  ".ea-container{width:100% !important;}" +
  ".ea-pad{padding-left:22px !important;padding-right:22px !important;}" +
  ".ea-h1{font-size:20px !important;line-height:28px !important;}" +
  ".ea-label,.ea-value{display:block !important;width:auto !important;text-align:left !important;}" +
  ".ea-label{padding-bottom:2px !important;}" +
  ".ea-value{padding-top:0 !important;border-top:0 !important;}" +
  "}";

function renderHtml(
  subject: string,
  hello: string,
  content: EmailContent,
  rows: [string, string][],
  link: string | null,
  ctx: EmailContext
): string {
  const strong = [ctx.employeeName, ctx.dueDate];
  const paragraphs = content.body
    .flatMap((b) => b.split(/\n{2,}/))
    .map((p) => `<p style="margin:0 0 16px;font-family:${C.font};font-size:15px;line-height:24px;color:${C.body};">${emphasise(p, strong)}</p>`)
    .join("");
  const preheader = content.body.join(" ").replace(/\s+/g, " ").trim();
  const lead = content.overdue
    ? "This review is now overdue. Please complete it as soon as possible."
    : ctx.dueDate
      ? `Please complete this review by ${ctx.dueDate}.`
      : null;
  const cta = link
    ? (lead ? `<p style="margin:0 0 16px;font-family:${C.font};font-size:14px;line-height:22px;color:${C.body};">${emphasise(lead, [ctx.dueDate])}</p>` : "") +
      ctaButton(link, content.ctaLabel)
    : `<p style="margin:0;font-family:${C.font};font-size:14px;line-height:22px;color:${C.muted};">${escapeHtml(NO_LINK_TEXT)}</p>`;

  return [
    `<!DOCTYPE html><html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">`,
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">`,
    `<title>${escapeHtml(subject)}</title>`,
    `<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>`,
    `<style>body,table,td,p,a,span{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->`,
    `<style>${MOBILE_CSS}</style></head>`,
    `<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">`,
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};opacity:0;">${escapeHtml(preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};"><tr><td align="center" style="padding:32px 12px;">`,
    `<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`,
    `<table role="presentation" class="ea-container" width="100%" cellpadding="0" cellspacing="0" border="0" `,
    `style="width:100%;max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:12px;border-collapse:separate;overflow:hidden;">`,
    // Header
    `<tr><td style="height:4px;line-height:4px;font-size:0;background:${C.brand};">&nbsp;</td></tr>`,
    `<tr><td class="ea-pad" style="padding:26px 40px 22px;border-bottom:1px solid ${C.page};">`,
    `<div style="font-family:${C.font};font-size:18px;line-height:24px;font-weight:700;color:${C.ink};letter-spacing:-0.01em;">DBJ Ascend</div>`,
    `<div style="font-family:${C.font};font-size:12px;line-height:18px;color:${C.muted};padding-top:2px;">Development Bank of Jamaica · Performance appraisals</div>`,
    `</td></tr>`,
    // Main content
    `<tr><td class="ea-pad" style="padding:34px 40px 36px;">`,
    `<div style="font-family:${C.font};font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.12em;color:${C.brand};">${escapeHtml(content.reviewLabel.toUpperCase())}</div>`,
    `<h1 class="ea-h1" style="margin:8px 0 22px;font-family:${C.font};font-size:22px;line-height:30px;font-weight:600;color:${C.text};letter-spacing:-0.01em;">${escapeHtml(content.heading)}</h1>`,
    `<p style="margin:0 0 14px;font-family:${C.font};font-size:15px;line-height:24px;color:${C.text};">${escapeHtml(hello)}</p>`,
    paragraphs,
    `<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>`,
    summaryCard(rows, ctx.dueDate),
    cta,
    `</td></tr>`,
    // Footer
    `<tr><td class="ea-pad" style="padding:20px 40px 22px;background:${C.panel};border-top:1px solid ${C.line};">`,
    ...FOOTER_LINES.map(
      (line, i) =>
        `<p style="margin:${i === 0 ? 0 : "4px 0 0"};font-family:${C.font};font-size:12px;line-height:18px;color:${C.muted};">${escapeHtml(line)}</p>`
    ),
    `</td></tr>`,
    `</table>`,
    `<!--[if mso]></td></tr></table><![endif]-->`,
    `</td></tr></table></body></html>`,
  ].join("");
}

/** Renders one appraisal email. Every caller (preview, test send, future reminders) goes through here. */
export function renderEmail(kind: EmailKind, ctx: EmailContext): RenderedEmail {
  const template = EMAIL_TEMPLATES[kind];
  const content = template.content(ctx);
  const hello = greeting(template.recipientRole, ctx);
  const rows = details(template.recipientRole, ctx, content.reviewLabel);
  const link = appraisalLink(ctx);

  const text = [
    hello,
    ...content.body,
    rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
    link ? `${content.ctaLabel}: ${link}` : NO_LINK_TEXT,
    FOOTER_TEXT,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject: content.subject, text, html: renderHtml(content.subject, hello, content, rows, link, ctx) };
}
