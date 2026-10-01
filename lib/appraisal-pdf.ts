/**
 * Generate appraisal PDF via DBJ HTML template + Puppeteer.
 * Uses fetchAppraisalPDFData for server-side data; signoff/submit and other callers unchanged.
 */

import { createClient } from "@supabase/supabase-js";
import path from "path";
import fs from "fs";
import {
  fetchAppraisalPDFData,
  type AppraisalPDFData,
  type PDFScoreSource,
  type WorkplanItemRow,
  type FactorRatingRow,
} from "./pdf/fetch-appraisal-pdf-data";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

function getLogoDataUrl(): string {
  try {
    const p = path.join(process.cwd(), "public", "dbj-logo.png");
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      return `data:image/png;base64,${buf.toString("base64")}`;
    }
  } catch {
    // ignore
  }
  return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
}

function escapeHtml(s: string): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ratingColor(code: string | null): string {
  if (!code) return "#666";
  const n = parseInt(code, 10);
  if (!Number.isNaN(n)) {
    if (n >= 9) return "#059669";
    if (n >= 7) return "#0d9488";
    if (n >= 5) return "#3b82f6";
    if (n >= 3) return "#d97706";
    return "#dc2626";
  }
  if (["A", "B"].includes(code)) return "#059669";
  if (code === "C") return "#0d9488";
  if (code === "D") return "#d97706";
  return "#dc2626";
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function getInitials(fullName: string | null | undefined): string {
  if (!fullName || !String(fullName).trim()) return "—";
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getCycleFYBadge(cycle: { fiscal_year?: string | null; start_date?: string | null; end_date?: string | null; name?: string } | null): string {
  if (!cycle) return "—";
  if (cycle.fiscal_year) return `FY ${cycle.fiscal_year}`;
  if (cycle.start_date && cycle.end_date) {
    try {
      const y1 = new Date(cycle.start_date).getFullYear();
      const y2 = new Date(cycle.end_date).getFullYear();
      if (!Number.isNaN(y1) && !Number.isNaN(y2)) return y1 === y2 ? `FY ${y1}` : `FY ${y1} — FY ${y2}`;
    } catch {
      // ignore
    }
  }
  return cycle.name ?? "—";
}

function buildWorkplanRows(items: WorkplanItemRow[]): string {
  if (!items.length) return "<tr><td colspan='9'>No workplan items</td></tr>";
  return items
    .map(
      (i) =>
        `<tr>
  <td style="font-size:8.5pt">${escapeHtml(i.corporate_objective)}</td>
  <td style="font-size:8.5pt">${escapeHtml(i.division_objective)}</td>
  <td style="font-weight:500">${escapeHtml(i.major_task)}</td>
  <td>${escapeHtml(i.key_output)}</td>
  <td>${escapeHtml(i.performance_standard)}</td>
  <td style="text-align:center">${escapeHtml(i.metric_target ?? "")}</td>
  <td style="text-align:center;font-weight:bold">${i.weight}%</td>
  <td style="text-align:center">${escapeHtml(i.employee_actual_result ?? "—")}</td>
  <td style="text-align:center;font-weight:bold;color:#0d9488">${escapeHtml(i.actual_result ?? "—")}</td>
</tr>`
    )
    .join("\n");
}

const SECTION_F_LABELS: Record<string, string> = {
  workplan: "Section A — Workplan",
  cc: "Section B — Core",
  technical: "Section C — Technical",
  prod: "Section D — Productivity",
  leadership: "Section E — Leadership",
};

const SECTION_F_ORDER: (keyof typeof SECTION_F_LABELS)[] = ["workplan", "cc", "technical", "prod", "leadership"];

function buildSectionFTableRows(
  components: { key: string; name: string; weight: number; points: number }[],
  overallScore: number | string
): string {
  const byKey = Object.fromEntries(components.map((c) => [c.key, c]));
  const rows = SECTION_F_ORDER.filter((key) => byKey[key]).map((key) => {
    const c = byKey[key];
    const label = SECTION_F_LABELS[key] ?? c.name;
    const isWorkplan = key === "workplan";
    return `<tr><td>${escapeHtml(label)}</td><td style="text-align:center">${c.weight}%</td><td style="text-align:center${isWorkplan ? "; font-weight:bold" : ""}">${c.points}</td></tr>`;
  });
  rows.push(
    `<tr style="background:#0f1f3d; color:white; font-weight:bold;"><td>OVERALL SCORE</td><td style="text-align:center">100%</td><td style="text-align:center; color:#c9a84c;">${escapeHtml(String(overallScore))}%</td></tr>`
  );
  return rows.join("\n");
}

function buildFactorRows(items: FactorRatingRow[]): string {
  if (!items.length) return "<tr><td colspan='6'>—</td></tr>";
  return items
    .map(
      (r) =>
        `<tr>
  <td><strong>${escapeHtml(r.factor_name)}</strong>${r.description ? `<div style="font-size:8pt;color:#666;margin-top:2pt">${escapeHtml(r.description)}</div>` : ""}</td>
  <td style="text-align:center;font-weight:bold">${r.weight ?? "—"}</td>
  <td style="text-align:center;font-size:14pt;font-weight:bold;color:${ratingColor(r.self_rating_code)}">${escapeHtml(r.self_rating_code ?? "—")}</td>
  <td style="font-size:8.5pt">${escapeHtml(r.self_comments ?? "")}</td>
  <td style="text-align:center;font-size:14pt;font-weight:bold;color:${ratingColor(r.manager_rating_code)}">${escapeHtml(r.manager_rating_code ?? "—")}</td>
  <td style="font-size:8.5pt">${escapeHtml(r.manager_comments ?? "")}</td>
</tr>`
    )
    .join("\n");
}

/** Builds the full HTML for the appraisal PDF (for preview or PDF generation). */
export async function buildAppraisalPDFHTML(appraisalId: string): Promise<string> {
  const data = await fetchAppraisalPDFData(appraisalId, getSupabaseAdmin());
  return renderAppraisalPDFHTML(appraisalId, data);
}

function renderAppraisalPDFHTML(appraisalId: string, data: AppraisalPDFData): string {
  const templatePath = path.join(process.cwd(), "lib", "pdf", "appraisal-template.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  const cycleLabel = data.cycle ? `${data.cycle.name}${data.cycle.fiscal_year ? ` · FY ${data.cycle.fiscal_year}` : ""}` : "—";

  const cycleFYBadge = getCycleFYBadge(data.cycle);
  const employeeInitials = getInitials(data.employee.full_name);

  html = html
    .replace(/\{\{DBJ_LOGO_BASE64\}\}/g, getLogoDataUrl())
    .replace(/\{\{EMPLOYEE_NAME\}\}/g, escapeHtml(data.employee.full_name ?? "—"))
    .replace(/\{\{EMPLOYEE_INITIALS\}\}/g, escapeHtml(employeeInitials))
    .replace(/\{\{JOB_TITLE\}\}/g, escapeHtml(data.employee.job_title ?? "—"))
    .replace(/\{\{DIVISION_NAME\}\}/g, escapeHtml(data.employee.division_name ?? "—"))
    .replace(/\{\{DEPARTMENT_NAME\}\}/g, escapeHtml(data.employee.department_name ?? "—"))
    .replace(/\{\{CYCLE_FY_BADGE\}\}/g, escapeHtml(cycleFYBadge))
    .replace(/\{\{MANAGER_NAME\}\}/g, escapeHtml(data.manager?.full_name ?? "—"))
    .replace(/\{\{MANAGER_TITLE\}\}/g, escapeHtml(data.manager?.job_title ?? "—"))
    .replace(/\{\{HR_OFFICER_NAME\}\}/g, escapeHtml(data.hrOfficer?.full_name ?? "—"))
    .replace(/\{\{CYCLE_LABEL\}\}/g, escapeHtml(cycleLabel))
    .replace(/\{\{CYCLE_START_DATE\}\}/g, formatDate(data.cycle?.start_date))
    .replace(/\{\{CYCLE_END_DATE\}\}/g, formatDate(data.cycle?.end_date))
    .replace(/\{\{GENERATED_DATE\}\}/g, formatDate(new Date().toISOString()))
    .replace(/\{\{APPRAISAL_ID_SHORT\}\}/g, appraisalId.slice(0, 8).toUpperCase())
    .replace(/\{\{WORKPLAN_SCORE\}\}/g, String(data.scores.workplan))
    .replace(/\{\{COMPETENCY_SCORE\}\}/g, String(data.scores.competency))
    .replace(/\{\{OVERALL_SCORE\}\}/g, String(data.scores.overall))
    .replace(/\{\{RATING_LABEL\}\}/g, escapeHtml(data.scores.ratingLabel))
    .replace(/\{\{WORKPLAN_ROWS\}\}/g, buildWorkplanRows(data.workplanItems))
    .replace(/\{\{SELF_WORKPLAN_TOTAL\}\}/g, String(data.scores.selfWorkplanTotal))
    .replace(/\{\{WORKPLAN_TOTAL\}\}/g, String(data.scores.workplanTotal))
    .replace(/\{\{CORE_ROWS\}\}/g, buildFactorRows(data.coreRatings))
    .replace(/\{\{CORE_SELF_SCORE\}\}/g, String(data.scores.coreSelfScore))
    .replace(/\{\{CORE_MGR_SCORE\}\}/g, String(data.scores.coreMgrScore))
    .replace(/\{\{PRODUCTIVITY_ROWS\}\}/g, buildFactorRows(data.productivityRatings))
    .replace(/\{\{PRODUCTIVITY_SELF_SCORE\}\}/g, String(data.scores.productivitySelfScore))
    .replace(/\{\{PRODUCTIVITY_MGR_SCORE\}\}/g, String(data.scores.productivityMgrScore))
    .replace(/\{\{CORE_SCORE\}\}/g, String(data.scores.coreScore))
    .replace(/\{\{TECHNICAL_SCORE\}\}/g, String(data.scores.technicalScore))
    .replace(/\{\{PRODUCTIVITY_SCORE\}\}/g, String(data.scores.productivityScore))
    .replace(/\{\{LEADERSHIP_SCORE\}\}/g, String(data.scores.leadershipScore))
    .replace(/\{\{SECTION_F_TABLE_ROWS\}\}/g, buildSectionFTableRows(data.summaryComponents, data.scores.overall))
    .replace(/\{\{HR_RECOMMENDATION\}\}/g, escapeHtml(data.hrRecommendation.recommendation))
    .replace(/\{\{HR_COMMENTS\}\}/g, escapeHtml(data.hrRecommendation.comments));

  const technicalSection =
    data.technicalRatings.length > 0
      ? `<table>
<thead><tr><th style="width:22%">Competency</th><th style="width:8%">Weight</th><th style="width:7%">Self</th><th style="width:28%">Self Comments</th><th style="width:7%">Mgr</th><th style="width:28%">Manager Comments</th></tr></thead>
<tbody>${buildFactorRows(data.technicalRatings)}</tbody>
</table>`
      : `<p style="font-style:italic;color:#666;padding:10pt;">No technical competencies configured for this role.</p>`;
  html = html.replace(/\{\{TECHNICAL_SECTION\}\}/g, technicalSection);

  const leadershipSection = data.appraisal.showLeadership
    ? `<div class="page-break"></div>
<div class="section-header">SECTION E — LEADERSHIP ASSESSMENT</div>
<p style="font-size:9pt;color:#555;">Professional skills competencies for management roles. Total weight: 100 points.</p>
<table>
<thead><tr><th style="width:22%">Competency</th><th style="width:8%">Weight</th><th style="width:7%">Self</th><th style="width:28%">Self Comments</th><th style="width:7%">Mgr</th><th style="width:28%">Manager Comments</th></tr></thead>
<tbody>${buildFactorRows(data.leadershipRatings)}</tbody>
<tfoot><tr style="background:#f0f4f8;font-weight:bold;"><td>TOTAL</td><td style="text-align:center">100</td><td colspan="2" style="text-align:center">Self: ${data.scores.leadershipSelfScore ?? "—"}</td><td colspan="2" style="text-align:center;color:#0d9488">Manager: ${data.scores.leadershipMgrScore ?? "—"}</td></tr></tfoot>
</table>`
    : "";
  html = html.replace(/\{\{LEADERSHIP_SECTION\}\}/g, leadershipSection);

  return html;
}

export async function generateAppraisalPDF(appraisalId: string): Promise<Buffer> {
  return renderPDF(await buildAppraisalPDFHTML(appraisalId));
}

/**
 * Generates the PDF and returns the calcSummary input/result it printed, from the same data load,
 * so a stored score can match the document exactly.
 */
export async function generateAppraisalPDFWithScore(
  appraisalId: string
): Promise<{ pdf: Buffer; scoreSource: PDFScoreSource | null }> {
  const data = await fetchAppraisalPDFData(appraisalId, getSupabaseAdmin());
  const pdf = await renderPDF(renderAppraisalPDFHTML(appraisalId, data));
  return { pdf, scoreSource: data.scoreSource };
}

async function renderPDF(html: string): Promise<Buffer> {
  const isVercelRuntime = process.env.VERCEL === "1";
  const browser = isVercelRuntime
    ? await (async () => {
        const chromium = (await import("@sparticuz/chromium")).default;
        const puppeteerCore = await import("puppeteer-core");
        const executablePath = await chromium.executablePath();
        return puppeteerCore.default.launch({
          args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
          executablePath,
          headless: true,
        });
      })()
    : await (async () => {
        const puppeteer = await import("puppeteer");
        return puppeteer.default.launch({
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
          headless: true,
        });
      })();

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const headerHtml = `<div style="width:100%;font-size:7pt;color:#666;padding:0 15mm;border-bottom:1px solid #dde5f5;"><span style="color:#0f1f3d;font-weight:bold">DEVELOPMENT BANK OF JAMAICA — ANNUAL PERFORMANCE APPRAISAL</span></div>`;
    const footerHtml = `<div style="width:100%;font-size:7pt;color:#999;padding:0 15mm;display:flex;justify-content:space-between;"><span>CONFIDENTIAL</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
