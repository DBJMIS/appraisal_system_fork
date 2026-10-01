// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MetricTypePicker } from "@/components/appraisal/MetricTypePicker";
import type { MetricType } from "@/lib/metric-calc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();
const onClose = vi.fn();

async function open(current: MetricType) {
  await act(async () => root.render(createElement(MetricTypePicker, { current, onSelect, onClose })));
}

const dialog = () => document.querySelector<HTMLElement>("[data-metric-type-dialog]")!;
const option = (type: MetricType) => document.querySelector<HTMLButtonElement>(`[data-metric-option="${type}"]`)!;
const cancel = () => [...dialog().querySelectorAll("button")].find((b) => b.textContent === "Cancel")!;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MetricTypePicker", () => {
  it("renders a compact labelled dialog with the existing title and subtitle", async () => {
    await open("PERCENT");
    const d = dialog();
    expect(d.getAttribute("role")).toBe("dialog");
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.className).toContain("rounded-[10px]");
    expect(d.className).toContain("border-ds-border");
    expect(d.className).toContain("p-5");
    const title = d.querySelector("h3")!;
    expect(title.textContent).toBe("Select Metric Type");
    expect(title.className).toContain("text-[18px]");
    expect(title.className).toContain("font-medium");
    expect(d.textContent).toContain("This determines how the system calculates the % from your actual entry");
  });

  it("lists the same three metric types in order with line icons and no emoji", async () => {
    await open("PERCENT");
    const rows = [...document.querySelectorAll<HTMLButtonElement>("[data-metric-option]")];
    expect(rows.map((r) => r.dataset.metricOption)).toEqual(["NUMBER", "DATE", "PERCENT"]);
    expect(rows.map((r) => r.querySelector(".font-medium")!.textContent)).toEqual([
      "Number — Fraction",
      "Date — Deadline Based",
      "Percentage — Direct Entry",
    ]);
    for (const r of rows) {
      expect(r.getAttribute("role")).toBe("radio");
      expect(r.querySelector("svg")).not.toBeNull();
      expect(r.className).toContain("w-full");
      expect(r.className).toContain("focus-visible:ring-2");
    }
    expect(dialog().textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(option("NUMBER").textContent).toContain("4 ÷ 5 = 80%");
    expect(option("DATE").textContent).toContain("reduced by days overdue");
    expect(option("PERCENT").textContent).toContain("already a percentage");
  });

  it("uses lavender, amber and mint accents for Number, Date and Percentage", async () => {
    await open("PERCENT");
    const tile = (t: MetricType) => option(t).querySelector("span")!.className;
    expect(tile("NUMBER")).toContain("bg-ds-lavender-subtle");
    expect(tile("DATE")).toContain("bg-ds-amber-subtle");
    expect(tile("PERCENT")).toContain("bg-ds-mint-subtle");
  });

  it.each<[MetricType, string]>([
    ["NUMBER", "border-ds-lavender"],
    ["DATE", "border-ds-amber"],
    ["PERCENT", "border-ds-mint"],
  ])("marks %s as selected with border, tint, check and aria-checked", async (type, border) => {
    await open(type);
    for (const t of ["NUMBER", "DATE", "PERCENT"] as MetricType[]) {
      const row = option(t);
      const indicator = row.querySelector("[data-metric-indicator]")!;
      if (t === type) {
        expect(row.getAttribute("aria-checked")).toBe("true");
        expect(row.className).toContain(border);
        expect(indicator.querySelector("svg")).not.toBeNull();
      } else {
        expect(row.getAttribute("aria-checked")).toBe("false");
        expect(row.className).toContain("border-ds-border");
        expect(indicator.querySelector("svg")).toBeNull();
      }
    }
  });

  it("focuses the current type when opened", async () => {
    await open("DATE");
    expect(document.activeElement).toBe(option("DATE"));
  });

  it("selects immediately when a row is clicked", async () => {
    await open("PERCENT");
    await act(async () => option("NUMBER").click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("NUMBER");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clicking inside the row text still selects that type", async () => {
    await open("PERCENT");
    await act(async () => option("DATE").querySelector<HTMLElement>("[data-metric-detail]")!.click());
    expect(onSelect).toHaveBeenCalledWith("DATE");
  });

  it("Cancel closes without selecting", async () => {
    await open("PERCENT");
    expect(cancel().className).not.toContain("w-full");
    await act(async () => cancel().click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Escape closes without selecting", async () => {
    await open("PERCENT");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
