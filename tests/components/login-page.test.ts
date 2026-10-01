// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  params: new URLSearchParams("callbackUrl=%2Fappraisals"),
}));

vi.mock("next-auth/react", () => ({ signIn: mocks.signIn }));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }));
vi.mock("next/image", () => ({
  default: ({ priority: _priority, ...props }: Record<string, unknown>) => createElement("img", props),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function renderLogin(uatEnabled: boolean) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_ENABLE_UAT_CREDENTIALS", uatEnabled ? "true" : "false");
  const { default: LoginPage } = await import("@/app/login/page");
  await act(async () => root.render(createElement(LoginPage)));
}

function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe("login page", () => {
  it("keeps Microsoft sign-in as the primary action with the same call", async () => {
    await renderLogin(false);
    const card = container.querySelector("[data-login-card]")!;
    expect(card.querySelector("header")?.textContent).toContain("Development Bank of Jamaica");
    expect(card.querySelector("h1")?.textContent).toBe("Welcome back");
    expect(card.querySelector("footer")?.textContent).toContain("Azure AD (Entra ID)");
    expect(card.querySelector("footer")?.textContent).toContain("FY 2026 – 2027");
    expect(container.querySelector("[data-uat-section]")).toBeNull();

    const ms = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sign in with Microsoft")!;
    expect(ms.className).toContain("bg-ds-accent");
    await act(async () => ms.click());
    expect(mocks.signIn).toHaveBeenCalledWith("azure-ad", { callbackUrl: "/appraisals" });
  });

  it("renders the UAT block as a secondary section and submits the same credentials call", async () => {
    mocks.signIn.mockResolvedValue({ ok: false });
    await renderLogin(true);
    const uat = container.querySelector("[data-uat-section]")!;
    expect(uat.textContent).toContain("UAT testing");
    expect(uat.textContent).toContain("For HR UAT only. Production staff should use Microsoft sign-in above.");

    const submit = [...uat.querySelectorAll("button")].find((b) => b.textContent === "Sign in with test account")!;
    expect(submit.className).not.toContain("bg-ds-accent");

    await act(async () => setNativeValue(uat.querySelector("#uat-email") as HTMLInputElement, "  hr@example.com "));
    await act(async () => setNativeValue(uat.querySelector("#uat-password") as HTMLInputElement, "secret"));
    await act(async () => (uat.querySelector("form") as HTMLFormElement).requestSubmit());

    expect(mocks.signIn).toHaveBeenCalledWith("uat-credentials", {
      email: "hr@example.com",
      password: "secret",
      callbackUrl: "/appraisals",
      redirect: false,
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Sign in failed. Please check your email and password.");
  });
});
