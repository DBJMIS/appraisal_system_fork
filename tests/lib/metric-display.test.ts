import { describe, expect, it } from "vitest";
import { formatMetricTarget } from "@/lib/metric-display";

describe("formatMetricTarget", () => {
  it("percentage metric shows the target as a percentage", () => {
    expect(formatMetricTarget({ metric_type: "PERCENT", metric_target: 100 })).toBe("100%");
    expect(formatMetricTarget({ metric_type: "PERCENT", metric_target: 99.5 })).toBe("99.5%");
  });

  it("numeric metric shows the number", () => {
    expect(formatMetricTarget({ metric_type: "NUMBER", metric_target: 12 })).toBe("12");
    expect(formatMetricTarget({ metric_type: "NUMBER", metric_target: "12" })).toBe("12");
  });

  it("date metric shows the deadline as stored, without a timezone shift", () => {
    expect(formatMetricTarget({ metric_type: "DATE", metric_target: null, metric_deadline: "2026-06-30" })).toBe("30 Jun 2026");
    expect(formatMetricTarget({ metric_type: "DATE", metric_deadline: "2026-01-01T00:00:00+00:00" })).toBe("1 Jan 2026");
  });

  it("a non-numeric target is displayed as entered", () => {
    expect(formatMetricTarget({ metric_type: "PERCENT", metric_target: "Board approval" })).toBe("Board approval");
  });

  it("follows the annual workplan rules for missing and untyped values", () => {
    expect(formatMetricTarget({ metric_type: "NUMBER", metric_target: null })).toBeNull();
    expect(formatMetricTarget({ metric_type: "PERCENT", metric_target: null })).toBeNull();
    expect(formatMetricTarget({ metric_type: null, metric_target: 80 })).toBe("80%");
    expect(formatMetricTarget({ metric_type: "DATE", metric_target: 50, metric_deadline: null })).toBe("50%");
    expect(formatMetricTarget({ metric_type: "NUMBER", metric_target: 0 })).toBe("0");
  });
});
