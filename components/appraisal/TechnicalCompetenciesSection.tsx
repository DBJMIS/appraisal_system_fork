"use client";

import { useCallback, useEffect, useState } from "react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CompetencyAssessmentGrid, type CompetencyGridField, type CompetencyGridRow } from "./CompetencyAssessmentGrid";
import { AppraisalSectionSkeleton } from "./AppraisalSectionSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TechnicalCompetency {
  id: string;
  name: string;
  required_level: string;
  weight: number;
  self_rating: string | null;
  manager_rating: string | null;
  self_comments: string | null;
  manager_comments: string | null;
  display_order: number;
}

interface RatingScaleRow {
  code: string;
  label: string;
  factor?: number;
}

interface TechnicalCompetenciesSectionProps {
  /** Appraisal status; only affects which comment fields are displayed. */
  appraisalStatus?: string | null;
  appraisalId: string;
  canEditSetup: boolean;
  /** If false, delete (trash) buttons are hidden. Set false once appraisal is approved (e.g. SELF_ASSESSMENT or later). */
  canDeleteCompetencies: boolean;
  canEditSelfRatings: boolean;
  canEditManagerRatings: boolean;
  /** Optional: notify parent when dirty state changes (for tab navigation guard). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Optional: register save function for parent (e.g. unsaved-changes modal Save). */
  registerSave?: (save: (() => Promise<void>) | null) => void;
}

const GRID_FIELD: Record<CompetencyGridField, keyof TechnicalCompetency> = {
  self_rating_code: "self_rating",
  manager_rating_code: "manager_rating",
  self_comments: "self_comments",
  manager_comments: "manager_comments",
  weight: "weight",
};

const controlClass =
  "h-8 rounded-ds-control border border-ds-border-control bg-ds-background px-2 text-[13px] text-ds-text-primary transition-colors duration-100 hover:border-ds-text-secondary focus:border-ds-focus focus:outline-none focus:ring-1 focus:ring-ds-focus";

function getFactorFromScale(code: string | null, scale: RatingScaleRow[]): number {
  if (!code) return 0;
  const row = scale.find((s) => s.code === code);
  return row?.factor != null ? Number(row.factor) : 0;
}

export function TechnicalCompetenciesSection({
  appraisalStatus,
  appraisalId,
  canEditSetup,
  canDeleteCompetencies,
  canEditSelfRatings,
  canEditManagerRatings,
  onDirtyChange,
  registerSave,
}: TechnicalCompetenciesSectionProps) {
  const [isDirty, setIsDirty] = useState(false);
  useUnsavedChanges(isDirty);

  const [competencies, setCompetencies] = useState<TechnicalCompetency[]>([]);
  const [ratingScale, setRatingScale] = useState<RatingScaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCompName, setNewCompName] = useState("");
  const [newCompLevel, setNewCompLevel] = useState("6");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/technical-competencies`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load competencies");
      }
      const data = await res.json();
      const raw = data.competencies ?? [];
      setCompetencies(raw.map((c: TechnicalCompetency & { weight?: number }) => ({
        ...c,
        weight: c.weight != null ? Number(c.weight) : 0,
      })));

      const scaleRes = await fetch(`/api/appraisals/${appraisalId}/factor-ratings`).catch(() => null);
      const scaleBody = scaleRes?.ok ? await scaleRes.json().catch(() => null) : null;
      setRatingScale(Array.isArray(scaleBody?.ratingScale) ? scaleBody.ratingScale : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [appraisalId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addCompetency = useCallback(async () => {
    if (!newCompName.trim()) return;

    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/technical-competencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCompName.trim(),
          required_level: newCompLevel,
          display_order: competencies.length,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add competency");
      }

      setShowAddModal(false);
      setNewCompName("");
      setNewCompLevel("6");
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add competency");
    }
  }, [appraisalId, newCompName, newCompLevel, competencies.length, loadData]);

  const deleteCompetency = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(
          `/api/appraisals/${appraisalId}/technical-competencies?competencyId=${id}`,
          { method: "DELETE" }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to delete competency");
        }

        loadData();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete competency");
      }
    },
    [appraisalId, loadData]
  );

  const updateCompetency = useCallback(
    (id: string, field: keyof TechnicalCompetency, value: string | null | number) => {
      setCompetencies((prev) =>
        prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
      );
      setIsDirty(true);
      onDirtyChange?.(true);
    },
    [onDirtyChange]
  );

  const saveRatings = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/technical-competencies`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competencies: competencies.map((c) => ({
            id: c.id,
            name: c.name,
            required_level: c.required_level,
            self_rating: c.self_rating,
            manager_rating: c.manager_rating,
            self_comments: c.self_comments,
            manager_comments: c.manager_comments,
            weight: c.weight,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save ratings");
      }

      setIsDirty(false);
      onDirtyChange?.(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
      window.dispatchEvent(new CustomEvent("appraisal-completion-invalidate"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save ratings");
    } finally {
      setSaving(false);
    }
  }, [appraisalId, competencies, onDirtyChange]);

  useEffect(() => {
    if (!registerSave) return;
    registerSave(saveRatings);
    return () => registerSave(null);
  }, [registerSave, saveRatings]);

  const canEdit = canEditSelfRatings || canEditManagerRatings;
  const canEditOrSetup = canEdit || canEditSetup;
  const totalWeight = competencies.reduce((sum, c) => sum + (c.weight ?? 0), 0);
  const weightValid = !canEditSetup || competencies.length === 0 || Math.abs(totalWeight - 100) < 0.01;
  const saveDisabled = saving || (canEditSetup && competencies.length > 0 && !weightValid);

  if (loading) {
    return <AppraisalSectionSkeleton variant="competency" label="Loading technical competencies…" rows={4} />;
  }

  const rows: CompetencyGridRow[] = competencies.map((comp, index) => {
    const code = comp.manager_rating ?? comp.self_rating;
    const levelLabel = ratingScale.find((s) => s.code === comp.required_level)?.label;
    return {
      id: comp.id,
      name: comp.name,
      description: null,
      weight: comp.weight,
      selfRating: comp.self_rating ?? null,
      managerRating: comp.manager_rating ?? null,
      selfComments: comp.self_comments,
      managerComments: comp.manager_comments,
      score: code != null ? (comp.weight * getFactorFromScale(comp.manager_rating ?? comp.self_rating ?? null, ratingScale)).toFixed(1) : null,
      nameCell: canEditSetup ? (
        <input
          type="text"
          aria-label={`Competency ${index + 1} name`}
          value={comp.name}
          onChange={(e) => updateCompetency(comp.id, "name", e.target.value)}
          className={`${controlClass} w-full min-w-[160px] font-medium`}
        />
      ) : undefined,
      requiredLevelCell: canEditSetup ? (
        <select
          aria-label={`Competency ${index + 1} required level`}
          value={comp.required_level}
          onChange={(e) => updateCompetency(comp.id, "required_level", e.target.value)}
          className={`${controlClass} w-16 cursor-pointer tabular-nums`}
        >
          {ratingScale.map((s) => (
            <option key={s.code} value={s.code}>{s.code}</option>
          ))}
        </select>
      ) : (
        <span data-required-level title={levelLabel} className="text-[12.5px] tabular-nums text-ds-text-secondary">
          {comp.required_level}
        </span>
      ),
      actionsCell: canDeleteCompetencies ? (
        <button
          type="button"
          onClick={() => deleteCompetency(comp.id)}
          aria-label={`Remove ${comp.name || `competency ${index + 1}`}`}
          className="inline-flex h-7 items-center rounded-ds-button px-2 text-xs font-medium text-ds-text-secondary transition-colors duration-100 hover:bg-ds-error-subtle hover:text-ds-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus"
        >
          Remove
        </button>
      ) : undefined,
    };
  });

  const techTotal = competencies.reduce(
    (sum, comp) => {
      const code = comp.manager_rating ?? comp.self_rating;
      return sum + (code != null ? comp.weight * getFactorFromScale(code, ratingScale) : 0);
    },
    0
  );

  return (
    <div>
      <CompetencyAssessmentGrid
      workflowStatus={appraisalStatus}
        draftSaveLabel="Save"
        title="Technical Competencies"
        subtitle={
          <>
            Critical functional and technical competencies specific to this role
            {canEditSetup && competencies.length > 0 && (
              <span className={`ml-2 ${weightValid ? "text-ds-success" : "text-ds-error"}`}>
                — Total weight: {totalWeight}%. Must equal 100%.
              </span>
            )}
          </>
        }
        factorLabel="Competency"
        emptyMessage={`No technical competencies defined yet.${canDeleteCompetencies ? ' Click "Add Technical Competency" to add one.' : ""}`}
        rows={rows}
        canEdit={canEditOrSetup && competencies.length > 0}
        canEditSelfRatings={canEditSelfRatings}
        canEditManagerRatings={canEditManagerRatings}
        canEditWeights={canEditSetup}
        onChange={(id, field, value) => updateCompetency(id, GRID_FIELD[field], value)}
        onSave={saveRatings}
        saveDisabled={saveDisabled}
        saving={saving}
        error={error}
        saveSuccess={saveSuccess}
        totalWeight={totalWeight}
        totalScore={techTotal > 0 ? techTotal.toFixed(1) : null}
        showRequiredLevel
        showRowActions={canDeleteCompetencies}
        headerActions={
          canDeleteCompetencies ? (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex h-8 w-full shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-ds-border bg-ds-background px-3.5 text-[12px] font-medium text-ds-text-secondary transition-colors duration-100 hover:border-ds-text-primary hover:text-ds-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-2 sm:w-auto"
            >
              Add Technical Competency
            </button>
          ) : undefined
        }
      />

      {/* Add Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Technical Competency</DialogTitle>
            <DialogDescription>
              Define a technical competency that will be evaluated for this appraisal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="comp-name">Competency Name</Label>
              <Input
                id="comp-name"
                value={newCompName}
                onChange={(e) => setNewCompName(e.target.value)}
                placeholder="e.g., Software Development"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="comp-level">Required Level</Label>
              <Select value={newCompLevel} onValueChange={setNewCompLevel}>
                <SelectTrigger id="comp-level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ratingScale.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.code} - {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button onClick={addCompetency} disabled={!newCompName.trim()}>
              Add Competency
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
