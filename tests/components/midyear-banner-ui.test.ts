// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MidyearReviewBanner } from "@/components/appraisal/checkins/MidyearReviewBanner";
import type { CheckInStatus, CheckInWithResponses } from "@/types/checkins";
import type { MidyearConfig } from "@/lib/midyear-config";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const config: MidyearConfig = { enabled: true, scoringEnabled: true, windowStart: "2026-06-01", dueDate: "2026-06-30" };

const review = (status: CheckInStatus, review_mode: CheckInWithResponses["review_mode"] = "FORMAL_SCORED") =>
  ({ id: `ci-${status}`, status, review_mode, check_in_type: "MIDYEAR", responses: [] }) as unknown as CheckInWithResponses;

function render(checkIns: CheckInWithResponses[], midyear: MidyearConfig = config) {
  act(() => root.render(createElement(MidyearReviewBanner, { midyear, fiscalYear: "2026", checkIns })));
  const text = (attr: string) => container.querySelector(`[${attr}]`)?.textContent;
  return {
    title: text("data-midyear-banner-title"),
    mode: text("data-midyear-banner-mode"),
    window: text("data-midyear-banner-window"),
    due: text("data-midyear-banner-due"),
    status: text("data-midyear-banner-status"),
  };
}

describe("Mid-Year banner", () => {
  it("shows the window, due date, status and scored indicator before initiation", () => {
    expect(render([])).toEqual({
      title: "Mid-Year Review · FY 2026/27",
      mode: "Formal · Scored",
      window: "1 Jun 2026 – 30 Jun 2026",
      due: "30 Jun 2026",
      status: "Not started",
    });
  });

  it("tracks the formal review status and ignores informal check-ins", () => {
    const informal = { ...review("OPEN", "INFORMAL"), id: "q2" } as CheckInWithResponses;
    expect(render([informal]).status).toBe("Not started");
    expect(render([review("OPEN")]).status).toBe("Awaiting employee input");
    expect(render([review("EMPLOYEE_SUBMITTED")]).status).toBe("Awaiting manager review");
    expect(render([review("MANAGER_REVIEWED")]).status).toBe("Manager reviewed – awaiting completion");
    expect(render([review("COMPLETE")]).status).toBe("Complete");
    expect(render([review("CANCELLED")]).status).toBe("Cancelled – can be restarted");
  });

  it("uses the review's own mode once initiated", () => {
    expect(render([review("OPEN", "FORMAL")]).mode).toBe("Formal");
    expect(render([], { ...config, scoringEnabled: false }).mode).toBe("Formal");
  });
});
