import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), sendFeedbackReviewRequest: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isPlaceholderUser: (u: { id?: string } | null) => u?.id === "placeholder-user-id",
}));
vi.mock("@/lib/feedback-email", () => ({ sendFeedbackReviewRequest: mocks.sendFeedbackReviewRequest }));

import { POST } from "@/app/api/feedback/test-notification/route";

const send = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/feedback/test-notification", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendFeedbackReviewRequest.mockResolvedValue(undefined);
  vi.stubEnv("AZURE_FROM_EMAIL", "dbjservices@dbankjm.com");
  vi.stubEnv("APPRAISAL_TEST_EMAIL_ALLOWED_DOMAINS", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/feedback/test-notification", () => {
  it("still sends the sample 360 email for HR to an allowed address", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "u-hr", roles: ["hr"] });
    const res = await send({ toEmail: "tester@dbankjm.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Test notification sent to tester@dbankjm.com" });
    expect(mocks.sendFeedbackReviewRequest).toHaveBeenCalledWith({
      toEmail: "tester@dbankjm.com",
      participantName: "Test Participant",
      cycleName: "Leadership Feedback 2026",
      deadline: "—",
    });
  });

  it.each([
    ["unauthenticated", null, 401],
    ["employee", { id: "e", roles: ["employee"] }, 403],
    ["manager", { id: "m", roles: ["manager"] }, 403],
  ])("rejects %s", async (_l, user, status) => {
    mocks.getCurrentUser.mockResolvedValue(user);
    expect((await send({ toEmail: "tester@dbankjm.com" })).status).toBe(status);
    expect(mocks.sendFeedbackReviewRequest).not.toHaveBeenCalled();
  });

  it.each(["someone@gmail.com", "a@dbankjm.com, b@gmail.com", "no-at-sign"])("rejects %s", async (toEmail) => {
    mocks.getCurrentUser.mockResolvedValue({ id: "u-admin", roles: ["admin"] });
    expect((await send({ toEmail })).status).toBe(400);
    expect(mocks.sendFeedbackReviewRequest).not.toHaveBeenCalled();
  });
});
