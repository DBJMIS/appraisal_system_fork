// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UserAdministrationTable } from "@/app/admin/users/user-administration-table";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USERS = [
  {
    id: "u-1",
    email: "ann.hr@example.test",
    display_name: "Ann",
    roles: [],
    employee_id: "e-1",
    division_id: "d-1",
    division_name: "Finance",
    is_active: true,
    created_at: "2026-01-01",
  },
  {
    id: "u-2",
    email: "ben.admin@example.test",
    display_name: "Ben",
    roles: ["admin"],
    employee_id: "e-2",
    division_id: null,
    division_name: null,
    is_active: true,
    created_at: "2026-01-02",
  },
];

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderTable() {
  await act(async () => root.render(createElement(UserAdministrationTable)));
  await act(async () => {});
}

const row = (id: string) => container.querySelector<HTMLTableRowElement>(`[data-user-row="${id}"]`)!;
const saveButton = (id: string) => row(id).querySelector<HTMLButtonElement>("[data-row-save]")!;
const roleBox = (id: string, role: string) =>
  row(id).querySelector<HTMLButtonElement>(`[data-role-option="${role}"] button[role="checkbox"]`)!;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/users" && !init) return jsonResponse(USERS.map((u) => ({ ...u })));
    if (url.startsWith("/api/admin/users/") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      return jsonResponse({ ok: true, user: { ...body } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("User administration table", () => {
  it("renders a visible Save button in every row, disabled until something changes", async () => {
    await renderTable();
    for (const id of ["u-1", "u-2"]) {
      const btn = saveButton(id);
      expect(btn).not.toBeNull();
      expect(btn.textContent).toBe("Save");
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute("aria-label")).toMatch(/^Save changes for /);
      expect(btn.className).toContain("disabled:opacity-100");
      expect(btn.className).toContain("disabled:text-ds-text-secondary");
      expect(btn.className).toContain("focus-visible:ring-2");
      expect(btn.className).toContain("h-7");
    }
  });

  it("keeps the Save button inside the Actions column without clipping", async () => {
    await renderTable();
    const actionsCol = container.querySelector<HTMLTableColElement>('col[data-col="actions"]')!;
    const colWidth = parseInt(actionsCol.style.width, 10);
    const btn = saveButton("u-1");
    const btnWidth = Number(/w-\[(\d+)px\]/.exec(btn.className)![1]);
    const cell = btn.closest("td")!;
    expect(cell.className).toContain("px-3");
    expect(btnWidth).toBeLessThanOrEqual(colWidth - 2 * 12);

    let el: HTMLElement | null = btn;
    while (el && el !== container) {
      expect(el.className).not.toMatch(/\b(overflow-hidden|overflow-clip|truncate)\b/);
      el = el.parentElement;
    }
    expect(container.querySelector("table")!.className).toContain("table-fixed");
  });

  it("gives Roles the remaining width and keeps the other columns sized", async () => {
    await renderTable();
    const width = (name: string) => container.querySelector<HTMLTableColElement>(`col[data-col="${name}"]`)!.style.width;
    expect(width("roles")).toBe("");
    expect(width("email")).toBe("22%");
    expect(width("display-name")).toBe("20%");
    expect(width("division")).toBe("14%");
    expect(width("active")).toBe("64px");
    expect(width("actions")).toBe("104px");
  });

  it("renders roles compactly with the checkbox and label on one line", async () => {
    await renderTable();
    const list = row("u-1").querySelector("[data-role-list]")!;
    expect(list.className).toBe("space-y-1.5");

    for (const role of ["hr", "admin"]) {
      const option = row("u-1").querySelector(`[data-role-option="${role}"]`)!;
      expect(option.className).toContain("flex");
      expect(option.className).toContain("gap-2");
      const [box, text] = Array.from(option.children);
      expect(box.getAttribute("role")).toBe("checkbox");
      expect(text.querySelector("span")!.className).toContain("text-[11px]");
      const desc = text.querySelector("[data-role-desc]")!;
      expect(desc.className).toContain("text-[11px]");
      expect(desc.className).toContain("text-ds-text-secondary");
    }
    expect(row("u-1").querySelector("[data-role-desc]")!.textContent).toBe(
      "All appraisals, 360 reviews, HR administration"
    );
    expect(row("u-1").textContent).not.toContain("No roles selected");
    const hints = container.querySelectorAll("[data-roles-hint]");
    expect(hints).toHaveLength(1);
    expect(hints[0].closest("th")).not.toBeNull();
    expect(hints[0].textContent).toBe("No roles selected = standard employee access");
  });

  it("saves a role change with the same PATCH payload as before", async () => {
    await renderTable();
    await act(async () => roleBox("u-1", "hr").click());
    expect(roleBox("u-1", "hr").getAttribute("aria-checked")).toBe("true");
    expect(saveButton("u-1").disabled).toBe(false);
    expect(saveButton("u-2").disabled).toBe(true);

    await act(async () => saveButton("u-1").click());
    await act(async () => {});

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patch[0]).toBe("/api/admin/users/u-1");
    expect(JSON.parse(String(patch[1].body))).toEqual({ roles: ["hr"] });
    expect(saveButton("u-1").disabled).toBe(true);
    expect(roleBox("u-1", "hr").getAttribute("aria-checked")).toBe("true");
  });

  it("enables Save for display name and active changes and disables it when reverted", async () => {
    await renderTable();
    const input = row("u-2").querySelector<HTMLInputElement>("input[aria-label^='Display name']")!;
    await act(async () => setNativeValue(input, "Benjamin"));
    expect(saveButton("u-2").disabled).toBe(false);
    await act(async () => setNativeValue(input, "Ben"));
    expect(saveButton("u-2").disabled).toBe(true);

    const activeBox = row("u-2").querySelectorAll<HTMLButtonElement>('td button[role="checkbox"]');
    const active = activeBox[activeBox.length - 1];
    await act(async () => active.click());
    expect(saveButton("u-2").disabled).toBe(false);

    await act(async () => saveButton("u-2").click());
    await act(async () => {});
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patch[0]).toBe("/api/admin/users/u-2");
    expect(JSON.parse(String(patch[1].body))).toEqual({ is_active: false });
  });

  it("removing a role still sends the reduced role list", async () => {
    await renderTable();
    await act(async () => roleBox("u-2", "admin").click());
    await act(async () => saveButton("u-2").click());
    await act(async () => {});
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1].body))).toEqual({ roles: [] });
  });

  it("only calls the existing user admin endpoints", async () => {
    await renderTable();
    await act(async () => roleBox("u-1", "admin").click());
    await act(async () => saveButton("u-1").click());
    await act(async () => {});
    const urls = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
    expect(urls).toEqual(["GET /api/admin/users", "PATCH /api/admin/users/u-1"]);
  });
});
