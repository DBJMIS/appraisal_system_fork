"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminPanelContext } from "./AdminPanelContext";
import { AdminTabs } from "./AdminTabs";
import type { Cycle, Category, Factor, RatingRow, Rule, FeedbackCycle, CycleForm } from "./admin-shared";
import {
  emptyCategoryForm,
  emptyFactorForm,
  emptyRuleForm,
  emptyCycleForm,
} from "./admin-shared";
import { CycleMidyearFields, midyearRequestFields, validateMidyearForm } from "./CycleMidyearFields";
import { LOCKED_CYCLE_STATUSES } from "@/lib/midyear-config";

const AlertIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

type CategoryForm = { name: string; category_type: string; applies_to: string };
type FactorForm = { category_id: string; name: string; description: string; display_order: number; weight: number };
type RuleForm = { rating_label: string; recommendation: string; description: string };

const REFERENCE_API = "/api/admin/reference-data";
const REFERENCE_LOAD_ERROR = "Could not load competencies, rating scale or recommendation rules. Please try again.";

type ReferenceData = { categories: Category[]; factors: Factor[]; ratingScale: RatingRow[]; rules: Rule[] };

/** Sends a reference-data write; resolves to a user-facing error message, or null on success. */
async function sendReferenceWrite(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(`${REFERENCE_API}/${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return typeof data.error === "string" && data.error ? data.error : "Request failed. Please try again.";
  } catch {
    return "Request failed. Please try again.";
  }
}

export function AdminPanel() {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [ratingScale, setRatingScale] = useState<RatingRow[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [feedbackCycles, setFeedbackCycles] = useState<FeedbackCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [referenceDataLoaded, setReferenceDataLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [cycleModal, setCycleModal] = useState<{ open: boolean; mode: "create" | "edit"; data: CycleForm; id?: string }>({ open: false, mode: "create", data: emptyCycleForm });
  const [categoryModal, setCategoryModal] = useState<{ open: boolean; mode: "create" | "edit"; data: CategoryForm; id?: string }>({ open: false, mode: "create", data: emptyCategoryForm });
  const [factorModal, setFactorModal] = useState<{ open: boolean; mode: "create" | "edit"; data: FactorForm; id?: string }>({ open: false, mode: "create", data: emptyFactorForm });
  const [ruleModal, setRuleModal] = useState<{ open: boolean; mode: "create" | "edit"; data: RuleForm; id?: string }>({ open: false, mode: "create", data: emptyRuleForm });
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; type: string; id: string; name: string }>({ open: false, type: "", id: "", name: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cyclesRes, feedbackCyclesRes, reference] = await Promise.all([
        fetch("/api/admin/cycles").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/admin/feedback/cycles").then((r) => (r.ok ? r.json() : [])),
        fetch(REFERENCE_API)
          .then(async (r) => (r.ok ? ((await r.json()) as Partial<ReferenceData>) : null))
          .catch(() => null),
      ]);
      setCycles(Array.isArray(cyclesRes) ? (cyclesRes as Cycle[]) : []);
      setFeedbackCycles(Array.isArray(feedbackCyclesRes) ? (feedbackCyclesRes as FeedbackCycle[]) : []);
      if (reference) {
        const cats = Array.isArray(reference.categories) ? reference.categories : [];
        setCategories(cats);
        const catMap = new Map(cats.map((c) => [c.id, c.name]));
        const facData = Array.isArray(reference.factors) ? reference.factors : [];
        setFactors(facData.map((f) => ({ ...f, category_name: catMap.get(f.category_id) ?? "—" })));
        setRatingScale(Array.isArray(reference.ratingScale) ? reference.ratingScale : []);
        setRules(Array.isArray(reference.rules) ? reference.rules : []);
        setReferenceDataLoaded(true);
      } else {
        setError(REFERENCE_LOAD_ERROR);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setError(null);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleVisibilityChange = async (
    cycleId: string,
    field: "peer_feedback_visible_to_reviewee" | "direct_report_feedback_visible_to_reviewee",
    value: boolean
  ) => {
    setError(null);
    const res = await fetch(`/api/admin/feedback/cycles/${cycleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Update failed");
      return;
    }
    setFeedbackCycles((prev) =>
      prev.map((c) => (c.id === cycleId ? { ...c, [field]: value } : c))
    );
    showSuccess("Visibility updated.");
  };

  const saveCycle = async () => {
    const { data, mode, id } = cycleModal;
    if (!data.fiscal_year.trim() || !data.start_date || !data.end_date) {
      setError("All fields are required.");
      return;
    }
    const midyearError = validateMidyearForm(data);
    if (midyearError) {
      setError(midyearError);
      return;
    }
    setError(null);
    if (mode === "create") {
      const res = await fetch("/api/admin/cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscal_year: data.fiscal_year, cycle_type: data.cycle_type, start_date: data.start_date, end_date: data.end_date, ...midyearRequestFields(data) }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) { setError(result.error ?? "Failed to create cycle"); return; }
      showSuccess("Cycle created.");
    } else if (id) {
      const res = await fetch(`/api/admin/cycles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(midyearRequestFields(data)),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) { setError(result.error ?? "Failed to update cycle"); return; }
      showSuccess("Cycle updated.");
    }
    setCycleModal({ open: false, mode: "create", data: emptyCycleForm });
    load();
  };

  const setCycleStatus = async (id: string, status: string) => {
    setError(null);
    if (status === "open") {
      const res = await fetch(`/api/cycles/${id}/open`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Failed to open cycle"); return; }
      const created = data.data?.appraisalsCreated ?? 0;
      showSuccess(created > 0 ? `Cycle opened (Planning Phase). ${created} appraisal(s) created.` : "Cycle opened (Planning Phase).");
    } else {
      const res = await fetch(`/api/admin/cycles/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Failed to update cycle"); return; }
      showSuccess(`Cycle ${status}.`);
    }
    load();
  };

  const openAssessmentPhase = async (cycleId: string) => {
    setError(null);
    const res = await fetch(`/api/cycles/${cycleId}/open-assessment`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to open assessment phase");
      return;
    }
    const stats = data.stats ?? {};
    showSuccess(`Assessment phase opened. ${stats.approved_workplans ?? 0} approved workplans ready for evaluation.`);
    load();
  };

  const saveCategory = async () => {
    const { data, mode, id } = categoryModal;
    if (!data.name.trim()) { setError("Name is required."); return; }
    setError(null);
    const fields = { name: data.name, category_type: data.category_type, applies_to: data.applies_to };
    if (mode === "create") {
      const e = await sendReferenceWrite("categories", "POST", fields);
      if (e) { setError(e); return; }
      showSuccess("Category created.");
    } else if (id) {
      const e = await sendReferenceWrite(`categories/${encodeURIComponent(id)}`, "PATCH", fields);
      if (e) { setError(e); return; }
      showSuccess("Category updated.");
    }
    setCategoryModal({ open: false, mode: "create", data: emptyCategoryForm });
    load();
  };

  const deleteCategory = async (id: string) => {
    const e = await sendReferenceWrite(`categories/${encodeURIComponent(id)}`, "DELETE");
    if (e) { setError(e); return; }
    showSuccess("Category deleted.");
    load();
  };

  const saveFactor = async () => {
    const { data, mode, id } = factorModal;
    if (!data.category_id || !data.name.trim()) { setError("Category and name are required."); return; }
    setError(null);
    const fields = { category_id: data.category_id, name: data.name, description: data.description || null, display_order: data.display_order, weight: data.weight || null };
    if (mode === "create") {
      const e = await sendReferenceWrite("factors", "POST", fields);
      if (e) { setError(e); return; }
      showSuccess("Factor created.");
    } else if (id) {
      const e = await sendReferenceWrite(`factors/${encodeURIComponent(id)}`, "PATCH", fields);
      if (e) { setError(e); return; }
      showSuccess("Factor updated.");
    }
    setFactorModal({ open: false, mode: "create", data: emptyFactorForm });
    load();
  };

  const toggleFactorActive = async (factor: Factor) => {
    const e = await sendReferenceWrite(`factors/${encodeURIComponent(factor.id)}`, "PATCH", { active: !factor.active });
    if (e) { setError(e); return; }
    showSuccess("Factor updated.");
    load();
  };

  const deleteFactor = async (id: string) => {
    const e = await sendReferenceWrite(`factors/${encodeURIComponent(id)}`, "DELETE");
    if (e) { setError(e); return; }
    showSuccess("Factor deleted.");
    load();
  };

  const saveRule = async () => {
    const { data, mode, id } = ruleModal;
    if (!data.rating_label.trim() || !data.recommendation.trim()) { setError("Rating label and recommendation are required."); return; }
    setError(null);
    const fields = { rating_label: data.rating_label, recommendation: data.recommendation, description: data.description || null };
    if (mode === "create") {
      const e = await sendReferenceWrite("rules", "POST", fields);
      if (e) { setError(e); return; }
      showSuccess("Rule created.");
    } else if (id) {
      const e = await sendReferenceWrite(`rules/${encodeURIComponent(id)}`, "PATCH", fields);
      if (e) { setError(e); return; }
      showSuccess("Rule updated.");
    }
    setRuleModal({ open: false, mode: "create", data: emptyRuleForm });
    load();
  };

  const toggleRuleActive = async (rule: Rule) => {
    const e = await sendReferenceWrite(`rules/${encodeURIComponent(rule.id)}`, "PATCH", { active: !rule.active });
    if (e) { setError(e); return; }
    showSuccess("Rule updated.");
    load();
  };

  const deleteRule = async (id: string) => {
    const e = await sendReferenceWrite(`rules/${encodeURIComponent(id)}`, "DELETE");
    if (e) { setError(e); return; }
    showSuccess("Rule deleted.");
    load();
  };

  const handleDeleteConfirm = async () => {
    const { type, id } = deleteConfirm;
    setDeleteConfirm({ open: false, type: "", id: "", name: "" });
    if (type === "category") await deleteCategory(id);
    else if (type === "factor") await deleteFactor(id);
    else if (type === "rule") await deleteRule(id);
  };

  const runSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/sync/employees", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      showSuccess(`Synced: ${data.employees_synced ?? 0} employees, ${data.reporting_lines_synced ?? 0} reporting lines.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <p style={{ color: "#646f79", padding: "16px 0" }}>Loading admin…</p>;

  // The cycle PATCH API updates status and Mid-Year settings only, so core fields are read-only when editing.
  const isEditingCycle = cycleModal.mode === "edit";
  const editingCycleStatus = isEditingCycle ? cycles.find((c) => c.id === cycleModal.id)?.status : undefined;
  const editingCycleLocked = editingCycleStatus != null && LOCKED_CYCLE_STATUSES.includes(editingCycleStatus);

  const contextValue = {
    cycles,
    categories,
    factors,
    ratingScale,
    rules,
    feedbackCycles,
    loading,
    referenceDataLoaded,
    syncing,
    error,
    success,
    cycleModal,
    setCycleModal,
    categoryModal,
    setCategoryModal,
    factorModal,
    setFactorModal,
    ruleModal,
    setRuleModal,
    deleteConfirm,
    setDeleteConfirm,
    load,
    handleVisibilityChange,
    saveCycle,
    setCycleStatus,
    openAssessmentPhase,
    saveCategory,
    deleteCategory,
    saveFactor,
    toggleFactorActive,
    deleteFactor,
    saveRule,
    toggleRuleActive,
    deleteRule,
    handleDeleteConfirm,
    runSync,
    emptyCycleForm,
    emptyCategoryForm,
    emptyFactorForm,
    emptyRuleForm,
  };

  return (
    <AdminPanelContext.Provider value={contextValue}>
      <div>
        {error && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "8px", background: "#fef2f2", border: "1px solid #fbd5d5", marginBottom: "20px" }}>
            <span style={{ color: "#b42318", marginTop: "2px" }}><AlertIcon /></span>
            <div>
              <div style={{ fontWeight: 600, fontSize: "13px", color: "#b42318" }}>Error</div>
              <div style={{ fontSize: "13px", color: "#b42318" }}>{error}</div>
            </div>
          </div>
        )}
        {success && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "8px", background: "#ecfdf5", border: "1px solid #bbf0d9", marginBottom: "20px" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "13px", color: "#2e7d4f" }}>Success</div>
              <div style={{ fontSize: "13px", color: "#2e7d4f" }}>{success}</div>
            </div>
          </div>
        )}

        <AdminTabs />
      </div>

      <Dialog open={cycleModal.open} onOpenChange={(open) => !open && setCycleModal({ ...cycleModal, open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cycleModal.mode === "create" ? "Create Cycle" : "Edit Cycle"}</DialogTitle>
            <DialogDescription>{cycleModal.mode === "create" ? "Add a new appraisal cycle." : "Update the appraisal cycle details."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" disabled={isEditingCycle} value={cycleModal.data.cycle_type} onChange={(e) => setCycleModal((p) => ({ ...p, data: { ...p.data, cycle_type: e.target.value } }))}>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="space-y-2"><Label>Fiscal Year</Label><Input placeholder="2026" disabled={isEditingCycle} value={cycleModal.data.fiscal_year} onChange={(e) => setCycleModal((p) => ({ ...p, data: { ...p.data, fiscal_year: e.target.value } }))} /></div>
            <div className="space-y-2"><Label>Start Date</Label><Input type="date" disabled={isEditingCycle} value={cycleModal.data.start_date} onChange={(e) => setCycleModal((p) => ({ ...p, data: { ...p.data, start_date: e.target.value } }))} /></div>
            <div className="space-y-2"><Label>End Date</Label><Input type="date" disabled={isEditingCycle} value={cycleModal.data.end_date} onChange={(e) => setCycleModal((p) => ({ ...p, data: { ...p.data, end_date: e.target.value } }))} /></div>
            <CycleMidyearFields
              value={cycleModal.data}
              locked={editingCycleLocked}
              onChange={(patch) => setCycleModal((p) => ({ ...p, data: { ...p.data, ...patch } }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCycleModal({ ...cycleModal, open: false })}>Cancel</Button>
            <Button onClick={saveCycle} disabled={editingCycleLocked}>{cycleModal.mode === "create" ? "Create" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={categoryModal.open} onOpenChange={(open) => !open && setCategoryModal({ ...categoryModal, open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{categoryModal.mode === "create" ? "Create Category" : "Edit Category"}</DialogTitle>
            <DialogDescription>{categoryModal.mode === "create" ? "Add a new competency category." : "Update the category details."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Name</Label><Input placeholder="Category name" value={categoryModal.data.name} onChange={(e) => setCategoryModal((p) => ({ ...p, data: { ...p.data, name: e.target.value } }))} /></div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={categoryModal.data.category_type} onChange={(e) => setCategoryModal((p) => ({ ...p, data: { ...p.data, category_type: e.target.value } }))}>
                <option value="core">Core</option>
                <option value="productivity">Productivity</option>
                <option value="leadership">Leadership</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Applies To</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={categoryModal.data.applies_to} onChange={(e) => setCategoryModal((p) => ({ ...p, data: { ...p.data, applies_to: e.target.value } }))}>
                <option value="both">Both</option>
                <option value="management">Management</option>
                <option value="non_management">Non-management</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryModal({ ...categoryModal, open: false })}>Cancel</Button>
            <Button onClick={saveCategory}>{categoryModal.mode === "create" ? "Create" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={factorModal.open} onOpenChange={(open) => !open && setFactorModal({ ...factorModal, open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{factorModal.mode === "create" ? "Create Factor" : "Edit Factor"}</DialogTitle>
            <DialogDescription>{factorModal.mode === "create" ? "Add a new competency factor." : "Update the factor details."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={factorModal.data.category_id} onChange={(e) => setFactorModal((p) => ({ ...p, data: { ...p.data, category_id: e.target.value } }))}>
                <option value="">Select category</option>
                {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
            </div>
            <div className="space-y-2"><Label>Name</Label><Input placeholder="Factor name" value={factorModal.data.name} onChange={(e) => setFactorModal((p) => ({ ...p, data: { ...p.data, name: e.target.value } }))} /></div>
            <div className="space-y-2"><Label>Description (optional)</Label><Input placeholder="Description" value={factorModal.data.description} onChange={(e) => setFactorModal((p) => ({ ...p, data: { ...p.data, description: e.target.value } }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Display Order</Label><Input type="number" value={factorModal.data.display_order} onChange={(e) => setFactorModal((p) => ({ ...p, data: { ...p.data, display_order: Number(e.target.value) || 0 } }))} /></div>
              <div className="space-y-2"><Label>Weight (optional)</Label><Input type="number" value={factorModal.data.weight || ""} onChange={(e) => setFactorModal((p) => ({ ...p, data: { ...p.data, weight: Number(e.target.value) || 0 } }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFactorModal({ ...factorModal, open: false })}>Cancel</Button>
            <Button onClick={saveFactor} disabled={!factorModal.data.category_id || !factorModal.data.name}>{factorModal.mode === "create" ? "Create" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ruleModal.open} onOpenChange={(open) => !open && setRuleModal({ ...ruleModal, open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ruleModal.mode === "create" ? "Create Rule" : "Edit Rule"}</DialogTitle>
            <DialogDescription>{ruleModal.mode === "create" ? "Add a new recommendation rule." : "Update the rule details."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Rating Label</Label><Input placeholder="e.g. Exceeds Expectations" value={ruleModal.data.rating_label} onChange={(e) => setRuleModal((p) => ({ ...p, data: { ...p.data, rating_label: e.target.value } }))} /></div>
            <div className="space-y-2"><Label>Recommendation</Label><Input placeholder="e.g. Pay Increment" value={ruleModal.data.recommendation} onChange={(e) => setRuleModal((p) => ({ ...p, data: { ...p.data, recommendation: e.target.value } }))} /></div>
            <div className="space-y-2"><Label>Description (optional)</Label><Input placeholder="Description" value={ruleModal.data.description} onChange={(e) => setRuleModal((p) => ({ ...p, data: { ...p.data, description: e.target.value } }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleModal({ ...ruleModal, open: false })}>Cancel</Button>
            <Button onClick={saveRule} disabled={!ruleModal.data.rating_label || !ruleModal.data.recommendation}>{ruleModal.mode === "create" ? "Create" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirm.open} onOpenChange={(open) => !open && setDeleteConfirm({ ...deleteConfirm, open: false })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteConfirm.type}?</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete &quot;{deleteConfirm.name}&quot;? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPanelContext.Provider>
  );
}
