"use client";

import { createContext, useContext } from "react";
import type {
  Cycle,
  Category,
  Factor,
  RatingRow,
  Rule,
  FeedbackCycle,
  CategoryForm,
  FactorForm,
  RuleForm,
  CycleForm,
} from "./admin-shared";

export interface AdminPanelContextValue {
  cycles: Cycle[];
  categories: Category[];
  factors: Factor[];
  ratingScale: RatingRow[];
  rules: Rule[];
  feedbackCycles: FeedbackCycle[];
  loading: boolean;
  /** True once reference data (competencies, rating scale, rules) has loaded successfully. */
  referenceDataLoaded: boolean;
  syncing: boolean;
  error: string | null;
  success: string | null;
  cycleModal: { open: boolean; mode: "create" | "edit"; data: CycleForm; id?: string };
  setCycleModal: React.Dispatch<React.SetStateAction<{ open: boolean; mode: "create" | "edit"; data: CycleForm; id?: string }>>;
  categoryModal: { open: boolean; mode: "create" | "edit"; data: CategoryForm; id?: string };
  setCategoryModal: React.Dispatch<React.SetStateAction<{ open: boolean; mode: "create" | "edit"; data: CategoryForm; id?: string }>>;
  factorModal: { open: boolean; mode: "create" | "edit"; data: FactorForm; id?: string };
  setFactorModal: React.Dispatch<React.SetStateAction<{ open: boolean; mode: "create" | "edit"; data: FactorForm; id?: string }>>;
  ruleModal: { open: boolean; mode: "create" | "edit"; data: RuleForm; id?: string };
  setRuleModal: React.Dispatch<React.SetStateAction<{ open: boolean; mode: "create" | "edit"; data: RuleForm; id?: string }>>;
  deleteConfirm: { open: boolean; type: string; id: string; name: string };
  setDeleteConfirm: React.Dispatch<React.SetStateAction<{ open: boolean; type: string; id: string; name: string }>>;
  load: () => Promise<void>;
  handleVisibilityChange: (cycleId: string, field: "peer_feedback_visible_to_reviewee" | "direct_report_feedback_visible_to_reviewee", value: boolean) => Promise<void>;
  saveCycle: () => Promise<void>;
  setCycleStatus: (id: string, status: string) => Promise<void>;
  openAssessmentPhase: (cycleId: string) => Promise<void>;
  saveCategory: () => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  saveFactor: () => Promise<void>;
  toggleFactorActive: (factor: Factor) => Promise<void>;
  deleteFactor: (id: string) => Promise<void>;
  saveRule: () => Promise<void>;
  toggleRuleActive: (rule: Rule) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  handleDeleteConfirm: () => Promise<void>;
  runSync: () => Promise<void>;
  emptyCycleForm: CycleForm;
  emptyCategoryForm: CategoryForm;
  emptyFactorForm: FactorForm;
  emptyRuleForm: RuleForm;
}

const AdminPanelContext = createContext<AdminPanelContextValue | null>(null);

export function useAdminPanel(): AdminPanelContextValue {
  const ctx = useContext(AdminPanelContext);
  if (!ctx) throw new Error("useAdminPanel must be used within AdminPanel");
  return ctx;
}

export { AdminPanelContext };
