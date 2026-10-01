// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { AuditTrailTab } from "@/components/appraisal/AuditTrailTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENTS = [
  { id: "e2", action_type: "approval", acted_at: "2026-03-02T10:00:00Z", summary: "Workplan approved", actor_id: "u2", actor_name: "Morgan Manager" },
  { id: "e1", action_type: "status_change", acted_at: "2026-03-01T09:00:00Z", summary: "Status changed from DRAFT to PENDING_APPROVAL", actor_id: "u1", actor_name: "Pat Employee" },
  { id: "e0", action_type: "custom_event_type", acted_at: "2026-02-28T08:00:00Z", summary: "", actor_id: null, actor_name: "System" },
];

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

async function renderTab(body: unknown, ok = true) {
  fetchMock = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(createElement(AuditTrailTab, { appraisalId: "a-1" }));
  });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Audit trail tab", () => {
  it("loads from the same endpoint and keeps the API order", async () => {
    await renderTab({ events: EVENTS });
    expect(fetchMock).toHaveBeenCalledWith("/api/appraisals/a-1/audit");
    const rows = [...container.querySelectorAll("ol > li")];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Workplan approved");
    expect(rows[0].textContent).toContain("Morgan Manager");
    expect(rows[0].textContent).toContain("Approval");
    expect(rows[0].querySelector("time")?.getAttribute("dateTime")).toBe("2026-03-02T10:00:00Z");
    expect(rows[1].textContent).toContain("Status change");
    expect(rows[2].textContent).toContain("Custom event type");
  });

  it("shows the plain empty state when there are no events or the request fails", async () => {
    await renderTab({ events: [] });
    expect(container.textContent).toContain("No activity recorded yet.");
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderTab(null, false);
    expect(container.textContent).toContain("No activity recorded yet.");
  });

  it("uses compact rows without per-event icons or coloured dots", async () => {
    await renderTab({ events: EVENTS });
    expect(container.querySelector("svg")).toBeNull();
    const src = fs.readFileSync(path.join(process.cwd(), "components/appraisal/AuditTrailTab.tsx"), "utf8");
    expect(src).not.toMatch(/lucide-react|rounded-full|Sora|#[0-9a-f]{6}/i);
  });
});
