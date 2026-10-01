// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReviewTypeBadge } from "@/components/ui/review-type-badge";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CycleChip } from "@/components/ui/cycle-chip";
import { EmployeeCell } from "@/components/ui/employee-cell";
import { cn } from "@/utils/cn";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(element);
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Button", () => {
  it("keeps every variant and size, and caller classes still win", () => {
    for (const variant of ["default", "destructive", "outline", "secondary", "ghost", "link"] as const) {
      for (const size of ["default", "sm", "lg", "icon"] as const) {
        expect(buttonVariants({ variant, size })).toContain("rounded-ds-button");
      }
    }
    const merged = cn(buttonVariants({ className: "rounded-full bg-red-500" }));
    expect(merged).toContain("rounded-full");
    expect(merged).not.toContain("rounded-ds-button");
    expect(merged.split(" ")).not.toContain("bg-ds-primary");
  });

  it("still fires onClick and respects disabled", async () => {
    const onClick = vi.fn();
    await render(
      createElement("div", null,
        createElement(Button, { onClick }, "Save"),
        createElement(Button, { onClick, disabled: true }, "Blocked"),
      ),
    );
    const [save, blocked] = Array.from(container.querySelectorAll("button"));
    await act(async () => save.click());
    await act(async () => blocked.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(blocked.disabled).toBe(true);
  });
});

describe("form primitives", () => {
  it("Input forwards value/onChange/type unchanged", async () => {
    await render(createElement(Input, { type: "number", defaultValue: "5", "aria-label": "Weight" }));
    const input = container.querySelector("input")!;
    expect(input.type).toBe("number");
    expect(input.value).toBe("5");
  });

  it("Checkbox toggles through onCheckedChange", async () => {
    const onCheckedChange = vi.fn();
    await render(createElement(Checkbox, { checked: false, onCheckedChange }));
    const box = container.querySelector('[role="checkbox"]') as HTMLButtonElement;
    await act(async () => box.click());
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("Tabs switches panels via onValueChange", async () => {
    const onValueChange = vi.fn();
    await render(
      createElement(Tabs, {
        value: "a",
        onValueChange,
        children: [
          createElement(TabsList, {
            key: "list",
            children: [
              createElement(TabsTrigger, { key: "a", value: "a", children: "A" }),
              createElement(TabsTrigger, { key: "b", value: "b", children: "B" }),
            ],
          }),
          createElement(TabsContent, { key: "pa", value: "a", children: "Panel A" }),
          createElement(TabsContent, { key: "pb", value: "b", children: "Panel B" }),
        ],
      }),
    );
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.textContent).toContain("Panel A");
    expect(container.textContent).not.toContain("Panel B");
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    await act(async () => (tabs[1] as HTMLButtonElement).click());
    expect(onValueChange).toHaveBeenCalledWith("b");
  });
});

describe("status and label components", () => {
  it("StatusBadge keeps every workflow label", async () => {
    const expected: Record<string, string> = {
      DRAFT: "Draft",
      PENDING_APPROVAL: "Pending Approval",
      SELF_ASSESSMENT: "Self Assessment",
      SUBMITTED: "Submitted",
      MANAGER_REVIEW: "Manager Review",
      PENDING_SIGNOFF: "Pending Sign-off",
      HOD_REVIEW: "HOD Review",
      HR_REVIEW: "HR Review",
      COMPLETE: "Complete",
      manager_in_review: "In Review",
      employee_acknowledged: "Acknowledged",
      SOMETHING_NEW: "SOMETHING NEW",
      awaiting_hr: "Awaiting Hr",
    };
    for (const [status, label] of Object.entries(expected)) {
      await render(createElement(StatusBadge, { status }));
      expect(container.textContent).toBe(label);
    }
  });

  it("StatusBadge uses semantic tones only", async () => {
    await render(createElement(StatusBadge, { status: "COMPLETE" }));
    expect(container.innerHTML).toContain("text-ds-success");
    await render(createElement(StatusBadge, { status: "PENDING_APPROVAL" }));
    expect(container.innerHTML).toContain("text-ds-warning");
    await render(createElement(StatusBadge, { status: "DRAFT" }));
    expect(container.innerHTML).toContain("text-ds-text-secondary");
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("ReviewTypeBadge keeps labels and drops decorative icons", async () => {
    for (const [type, label] of [["mid_year", "Mid Year"], ["Annual", "Annual"], ["q3", "Q3"], ["special_review", "Special Review"]]) {
      await render(createElement(ReviewTypeBadge, { type }));
      expect(container.textContent).toBe(label);
      expect(container.querySelector("svg")).toBeNull();
    }
  });

  it("Badge accepts the original and new semantic variants", async () => {
    for (const variant of ["default", "secondary", "destructive", "outline", "success", "warning", "info"] as const) {
      await render(createElement(Badge, { variant }, variant));
      expect(container.textContent).toBe(variant);
    }
  });
});

describe("page structure components", () => {
  it("PageHeader renders title, subtitle and action, but not the decorative icon", async () => {
    await render(
      createElement(PageHeader, {
        icon: createElement("svg", { "data-testid": "icon" }),
        title: "Appraisals",
        subtitle: "All cycles",
        action: createElement("button", null, "New"),
      }),
    );
    expect(container.querySelector("h1")?.textContent).toBe("Appraisals");
    expect(container.querySelector("h1")?.className).toContain("text-ds-page-title");
    expect(container.textContent).toContain("All cycles");
    expect(container.querySelector("button")?.textContent).toBe("New");
    expect(container.querySelector('[data-testid="icon"]')).toBeNull();
  });

  it("SectionHeader renders title and count without icon", async () => {
    await render(
      createElement(SectionHeader, { icon: createElement("svg", { "data-testid": "icon" }), title: "Pending", count: 3, variant: "gold" }),
    );
    expect(container.querySelector("h2")?.textContent).toBe("Pending");
    expect(container.textContent).toContain("3");
    expect(container.querySelector('[data-testid="icon"]')).toBeNull();
  });

  it("EmptyState, CycleChip and EmployeeCell keep their content", async () => {
    await render(
      createElement("div", null,
        createElement(EmptyState, { icon: createElement("svg"), title: "No appraisals", description: "Nothing yet" }),
        createElement(CycleChip, { year: "FY 2026" }),
        createElement(EmployeeCell, { name: "Jane Doe", email: "jane@example.test" }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("No appraisals");
    expect(text).toContain("Nothing yet");
    expect(text).toContain("FY 2026");
    expect(text).toContain("JD");
    expect(text).toContain("Jane Doe");
    expect(text).toContain("jane@example.test");
  });
});
