import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../helpers/fake-supabase";
import { EMAIL_KINDS, EMAIL_TEMPLATES, escapeHtml, isEmailKind, renderEmail, type EmailContext } from "@/lib/email-templates";
import { loadEmailContext, resolveAppBaseUrl } from "@/lib/email-context";
import { midyearMessages } from "@/lib/midyear-messages";
import { midyearMessages as reExported } from "@/lib/midyear-notifications";

const CTX: EmailContext = {
  appraisalId: "a-1",
  employeeName: "Jane Employee",
  managerName: "Mark Manager",
  cycleName: "FY 2026",
  fiscalYear: "FY 2026/27",
  reviewType: "Annual",
  status: "In progress",
  dueDate: "30 Oct 2026",
  appUrl: "https://ascend.example.test",
};

afterEach(() => vi.unstubAllEnvs());

describe("renderEmail", () => {
  it.each(EMAIL_KINDS)("%s renders a subject, text and a mobile-friendly HTML shell", (kind) => {
    const email = renderEmail(kind, CTX);
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.text).toContain("https://ascend.example.test/appraisals/a-1");
    expect(email.html).toContain("<!DOCTYPE html>");
    expect(email.html).toContain('name="viewport"');
    expect(email.html).toContain("DBJ Ascend");
    expect(email.html).toContain('href="https://ascend.example.test/appraisals/a-1"');
    expect(email.html).toContain("max-width:600px");
    expect(email.html).not.toMatch(/<script/i);
  });

  it.each(EMAIL_KINDS)("%s uses the email-safe layout: eyebrow, heading, Outlook button and footer", (kind) => {
    const email = renderEmail(kind, CTX);
    const content = EMAIL_TEMPLATES[kind].content(CTX);
    expect(email.html).toContain(`>${content.reviewLabel.toUpperCase()}</div>`);
    expect(email.html).toContain(`>${escapeHtml(content.heading)}</h1>`);
    expect(email.html).toContain('<!--[if mso]><v:roundrect');
    expect(email.html).toContain('<!--[if mso]><table role="presentation" width="600"');
    expect(email.html.match(/href="https:\/\/ascend\.example\.test\/appraisals\/a-1"/g)).toHaveLength(2);
    expect(email.html).toContain("Development Bank of Jamaica · Performance appraisals");
    expect(email.html).toContain(">This is an automated message from DBJ Ascend, the Development Bank of Jamaica appraisal system.</p>");
    expect(email.html).toContain(">Please do not reply to this email.</p>");
    expect(email.html).toContain("@media only screen and (max-width:620px)");
  });

  it("Mid-Year window open matches the design: heading, emphasised name and date, summary card and CTA lead", () => {
    const email = renderEmail("MIDYEAR_WINDOW_OPEN", CTX);
    expect(email.html).toContain(">MID-YEAR REVIEW</div>");
    expect(email.html).toContain(">Mid-Year Review now open</h1>");
    expect(email.html).toContain(">Hello Mark Manager,</p>");
    expect(email.html).toMatch(/is now open for <strong[^>]*>Jane Employee<\/strong>\. Please initiate the review by <strong[^>]*>30 Oct 2026<\/strong>\./);
    for (const [label, value] of [["Employee", "Jane Employee"], ["Review", "Mid-Year Review"], ["Fiscal year", "FY 2026/27"]]) {
      expect(email.html).toMatch(new RegExp(`>${label}</td><td class="ea-value"[^>]*>${value}</td>`));
    }
    expect(email.html).toMatch(/>Due date<\/td><td class="ea-value"[^>]*><span[^>]*#8a5a00[^>]*>30 Oct 2026<\/span>/);
    expect(email.html).toMatch(/Please complete this review by <strong[^>]*>30 Oct 2026<\/strong>\./);
    expect(email.html).toContain(">Open Mid-Year Review</a>");
    expect(email.html).toContain(">Open Mid-Year Review</center>");
  });

  it("overdue templates use an overdue CTA lead", () => {
    expect(renderEmail("MIDYEAR_OVERDUE", CTX).html).toContain("This review is now overdue. Please complete it as soon as possible.");
    expect(renderEmail("FINAL_REVIEW_OVERDUE", CTX).html).toContain("This review is now overdue. Please complete it as soon as possible.");
  });

  it("keeps the plain-text version unchanged in structure", () => {
    expect(renderEmail("MIDYEAR_WINDOW_OPEN", CTX).text).toBe(
      [
        "Hello Mark Manager,",
        "The Mid-Year Review for FY 2026/27 is now open for Jane Employee. Please initiate the review by 30 Oct 2026.",
        "Employee: Jane Employee\nReview: Mid-Year Review\nFiscal year: FY 2026/27\nDue date: 30 Oct 2026",
        "Open Mid-Year Review: https://ascend.example.test/appraisals/a-1",
        "This is an automated message from DBJ Ascend, the Development Bank of Jamaica appraisal system. Please do not reply to this email.",
      ].join("\n\n")
    );
  });

  it("Mid-Year due soon uses the agreed wording", () => {
    const email = renderEmail("MIDYEAR_DUE_SOON", CTX);
    expect(email.subject).toBe("Mid-Year Review due 30 Oct 2026");
    expect(email.text).toContain(
      "Your Mid-Year Review for FY 2026/27 is due on 30 Oct 2026. Please complete your required input before the deadline."
    );
    expect(email.text).toContain("Open Mid-Year Review: https://ascend.example.test/appraisals/a-1");
    expect(email.text.startsWith("Hello Jane Employee,")).toBe(true);
    expect(email.html).toContain(">Open Mid-Year Review</a>");
  });

  it("Final Review available uses the agreed wording", () => {
    const email = renderEmail("FINAL_REVIEW_AVAILABLE", { ...CTX, dueDate: "31 Mar 2027" });
    expect(email.subject).toBe("Your Final Review is ready");
    expect(email.text).toContain("Your FY 2026/27 Final Review is now available. Please complete your self-assessment by 31 Mar 2027.");
    expect(email.html).toContain(">Start Final Review</a>");
  });

  it("manager-facing templates greet the manager and name the employee", () => {
    const email = renderEmail("MANAGER_REVIEW_PENDING", CTX);
    expect(EMAIL_TEMPLATES.MANAGER_REVIEW_PENDING.recipientRole).toBe("manager");
    expect(email.subject).toBe("Manager review pending: Jane Employee");
    expect(email.text.startsWith("Hello Mark Manager,")).toBe(true);
    expect(email.text).toContain("Employee: Jane Employee");
  });

  it("the Mid-Year manager reminder reuses the submitted wording and adds the due date", () => {
    const submitted = midyearMessages.submitted({ fiscalYear: CTX.fiscalYear, employeeName: CTX.employeeName });
    const email = renderEmail("MIDYEAR_MANAGER_REVIEW_PENDING", CTX);
    expect(EMAIL_TEMPLATES.MIDYEAR_MANAGER_REVIEW_PENDING.recipientRole).toBe("manager");
    expect(EMAIL_TEMPLATES.MIDYEAR_MANAGER_REVIEW_PENDING.dueDateSource).toBe("midyear");
    expect(email.subject).toBe("Mid-Year manager review pending: Jane Employee");
    expect(email.text).toContain(`${submitted.body} Please complete it by 30 Oct 2026.`);
    expect(email.text.startsWith("Hello Mark Manager,")).toBe(true);
  });

  it("manager reminders switch to overdue wording only when flagged overdue", () => {
    const mid = renderEmail("MIDYEAR_MANAGER_REVIEW_PENDING", { ...CTX, isOverdue: true });
    expect(mid.subject).toBe("Mid-Year manager review overdue: Jane Employee");
    expect(mid.text).toContain("It was due on 30 Oct 2026 and is now overdue.");
    expect(mid.html).toContain("This review is now overdue.");

    const final = renderEmail("MANAGER_REVIEW_PENDING", { ...CTX, isOverdue: true });
    expect(final.subject).toBe("Manager review overdue: Jane Employee");
    expect(final.text).toContain("Your manager review was due on 30 Oct 2026 and is now overdue.");
    expect(final.html).toContain("This review is now overdue.");

    expect(renderEmail("MANAGER_REVIEW_PENDING", { ...CTX, isOverdue: false })).toEqual(renderEmail("MANAGER_REVIEW_PENDING", CTX));
  });

  it("reuses the existing Mid-Year event wording for window-open and ready", () => {
    const open = midyearMessages.windowOpen({ fiscalYear: CTX.fiscalYear, employeeName: CTX.employeeName, dueDate: CTX.dueDate });
    const ready = midyearMessages.ready({ fiscalYear: CTX.fiscalYear });
    expect(renderEmail("MIDYEAR_WINDOW_OPEN", CTX).subject).toBe(open.subject);
    expect(renderEmail("MIDYEAR_WINDOW_OPEN", CTX).text).toContain(open.body);
    expect(renderEmail("MIDYEAR_READY", CTX).subject).toBe(ready.subject);
    expect(renderEmail("MIDYEAR_READY", CTX).text).toContain(ready.body);
    expect(reExported).toBe(midyearMessages);
  });

  it("omits the due date cleanly when none is configured", () => {
    const email = renderEmail("MIDYEAR_DUE_SOON", { ...CTX, dueDate: null });
    expect(email.subject).toBe("Mid-Year Review due soon");
    expect(email.text).not.toContain("Due date:");
    expect(email.text).not.toContain("null");
    expect(email.html).not.toContain(">Due date</td>");
    expect(email.html).not.toContain("Please complete this review by");
    expect(email.html).not.toContain("null");
  });

  it("never renders a relative or localhost link when the app URL is missing", () => {
    const email = renderEmail("MIDYEAR_DUE_SOON", { ...CTX, appUrl: null });
    expect(email.html).not.toContain("href=");
    expect(email.text).not.toContain("/appraisals/");
    expect(email.text).toContain("Sign in to DBJ Ascend to continue.");
  });

  it("escapes names in the HTML", () => {
    const email = renderEmail("MANAGER_REVIEW_PENDING", { ...CTX, employeeName: `<img src=x onerror="alert(1)"> & Co` });
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Co");
    expect(escapeHtml(`'"<>&`)).toBe("&#39;&quot;&lt;&gt;&amp;");
  });

  it("contains no scores or ratings", () => {
    for (const kind of EMAIL_KINDS) {
      const { text, html } = renderEmail(kind, CTX);
      expect(`${text} ${html}`).not.toMatch(/\bscores?\b|\bratings?\b/i);
    }
  });

  it("validates kinds", () => {
    expect(isEmailKind("MIDYEAR_DUE_SOON")).toBe(true);
    expect(isEmailKind("midyear_due_soon")).toBe(false);
    expect(isEmailKind(undefined)).toBe(false);
  });
});

describe("resolveAppBaseUrl", () => {
  it("flags a missing URL instead of producing a relative link", () => {
    expect(resolveAppBaseUrl("")).toMatchObject({ url: null, warning: expect.stringContaining("NEXT_PUBLIC_APP_URL is not set") });
    expect(resolveAppBaseUrl(undefined).url).toBeNull();
  });

  it("rejects non-absolute and non-http URLs", () => {
    expect(resolveAppBaseUrl("/appraisals").url).toBeNull();
    expect(resolveAppBaseUrl("ftp://ascend.example.test").url).toBeNull();
  });

  it("accepts https URLs and trims trailing slashes", () => {
    expect(resolveAppBaseUrl("https://ascend.example.test/")).toEqual({ url: "https://ascend.example.test", warning: null });
  });

  it("warns about localhost", () => {
    const r = resolveAppBaseUrl("http://localhost:3000");
    expect(r.url).toBe("http://localhost:3000");
    expect(r.warning).toContain("local address");
  });
});

describe("loadEmailContext", () => {
  function seed(overrides: { manager?: string | null } = {}) {
    return new FakeSupabase({
      appraisals: [
        {
          id: "a-1",
          employee_id: "emp-1",
          manager_employee_id: overrides.manager === undefined ? "mgr-1" : overrides.manager,
          cycle_id: "c-1",
          review_type: "annual",
          status: "IN_PROGRESS",
        },
      ],
      appraisal_cycles: [{ id: "c-1", name: "FY 2026", fiscal_year: "2026", end_date: "2027-03-31", midyear_due_date: "2026-10-30" }],
      employees: [
        { employee_id: "emp-1", full_name: "Jane Employee", email: "jane@example.test" },
        { employee_id: "mgr-1", full_name: "Mark Manager", email: "mark@example.test" },
      ],
    });
  }

  it("builds the template context without emails or scores", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ascend.example.test");
    const db = seed();
    const selects: string[] = [];
    const realFrom = db.from.bind(db);
    vi.spyOn(db, "from").mockImplementation((table: string) => {
      const q = realFrom(table);
      const realSelect = q.select.bind(q);
      q.select = (cols?: string) => {
        selects.push(`${table}:${cols}`);
        return realSelect(cols);
      };
      return q;
    });

    const r = await loadEmailContext(db as never, "a-1", "MIDYEAR_DUE_SOON");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.context).toEqual({
      appraisalId: "a-1",
      employeeName: "Jane Employee",
      managerName: "Mark Manager",
      cycleName: "FY 2026",
      fiscalYear: "FY 2026/27",
      reviewType: "Annual",
      status: "In progress",
      dueDate: "30 Oct 2026",
      appUrl: "https://ascend.example.test",
    });
    expect(r.recipientRole).toBe("employee");
    expect(r.warnings).toEqual([]);
    expect(selects.join(" ")).not.toMatch(/email|score|rating/);
    expect(JSON.stringify(r)).not.toContain("@example.test");
    expect(db.writes).toHaveLength(0);
  });

  it("uses the cycle end date for Final Review templates", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ascend.example.test");
    const r = await loadEmailContext(seed() as never, "a-1", "FINAL_REVIEW_DUE_SOON");
    expect(r.ok && r.context.dueDate).toBe("31 Mar 2027");
  });

  it("warns when the app URL is missing or a manager template has no manager", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const r = await loadEmailContext(seed({ manager: null }) as never, "a-1", "MANAGER_REVIEW_PENDING");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.context.appUrl).toBeNull();
    expect(r.warnings.join(" ")).toContain("NEXT_PUBLIC_APP_URL is not set");
    expect(r.warnings.join(" ")).toContain("no manager assigned");
  });

  it("returns NOT_FOUND for an unknown appraisal", async () => {
    expect(await loadEmailContext(seed() as never, "missing", "MIDYEAR_READY")).toEqual({ ok: false, reason: "NOT_FOUND" });
  });
});
