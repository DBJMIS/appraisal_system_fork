import type { SummaryCalcProps } from "@/lib/summary-calc";

/** Non-management inputs. Expected: cc 90/9.0, prod 72/7.2, technical 70/7.0, workplan 82/57.4, total 80.6 (C). */
export const NON_MGMT_INPUT: SummaryCalcProps = {
  workplanItems: [
    { weight: 60, actual_result: 90 },
    { weight: 40, actual_result: 70 },
  ],
  competencies: [
    { weight: 50, manager_rating: "8", self_rating: "9" },
    { weight: 50, manager_rating: "10", self_rating: "6" },
  ],
  technical: [{ weight: 100, manager_rating: null, self_rating: "7" }],
  productivity: [
    { weight: 40, manager_rating: "9", self_rating: null },
    { weight: 60, manager_rating: "6", self_rating: null },
  ],
  leadership: [],
  isManagementTrack: false,
};

/** Management inputs. Expected: leadership 50/5.0, workplan 82/49.2 (weight 60), total 77.4 (D). */
export const MGMT_INPUT: SummaryCalcProps = {
  ...NON_MGMT_INPUT,
  leadership: [{ weight: 100, manager_rating: "5", self_rating: "7" }],
  isManagementTrack: true,
};
