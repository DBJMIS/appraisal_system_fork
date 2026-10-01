"use client";

import { useCallback, useEffect, useState } from "react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { CompetencyAssessmentGrid, type CompetencyGridRow } from "./CompetencyAssessmentGrid";

interface Factor {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  display_order: number;
}

interface Rating {
  factor_id: string;
  self_rating_code: string | null;
  manager_rating_code: string | null;
  self_comments: string | null;
  manager_comments: string | null;
  weight?: number | null;
}

interface RatingScale {
  code: string;
  label: string;
  factor: number;
}

interface ProductivitySectionProps {
  /** Appraisal status; only affects which comment fields are displayed. */
  appraisalStatus?: string | null;
  appraisalId: string;
  canEditSelfRatings: boolean;
  canEditManagerRatings: boolean;
  /** When true (e.g. draft), weight column is editable. */
  canEditWeights?: boolean;
  /** Optional: notify parent when dirty state changes (for tab navigation guard). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Optional: register save function for parent (e.g. unsaved-changes modal Save). */
  registerSave?: (save: (() => Promise<void>) | null) => void;
}

export function ProductivitySection({
  appraisalStatus,
  appraisalId,
  canEditSelfRatings,
  canEditManagerRatings,
  canEditWeights = false,
  onDirtyChange,
  registerSave,
}: ProductivitySectionProps) {
  const [isDirty, setIsDirty] = useState(false);
  useUnsavedChanges(isDirty);

  const [factors, setFactors] = useState<Factor[]>([]);
  const [ratings, setRatings] = useState<Map<string, Rating>>(new Map());
  const [ratingScale, setRatingScale] = useState<RatingScale[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/factor-ratings`);
      const data = await res.json();
      const factorData = res.ok && Array.isArray(data?.factors) ? data.factors : [];

      setFactors(
        factorData
          .filter((f: { category_type?: string | null }) => f.category_type === "productivity")
          .map((f: { id: string; name: string; description: string | null; display_order: number; weight?: number }) => ({
            id: f.id,
            name: f.name,
            description: f.description ?? null,
            display_order: f.display_order ?? 0,
            weight: Number(f.weight) || 0,
          }))
      );

      setRatingScale(res.ok && Array.isArray(data?.ratingScale) ? data.ratingScale : []);

      const ratingData = res.ok && Array.isArray(data?.ratings) ? data.ratings : [];
      const ratingsMap = new Map<string, Rating>();
      for (const r of ratingData) {
        ratingsMap.set(r.factor_id, {
          factor_id: r.factor_id,
          self_rating_code: r.self_rating_code ?? null,
          manager_rating_code: r.manager_rating_code ?? null,
          self_comments: r.self_comments ?? null,
          manager_comments: r.manager_comments ?? null,
          weight: r.weight != null ? Number(r.weight) : null,
        });
      }
      setRatings(ratingsMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [appraisalId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateRating = useCallback(
    (factorId: string, field: keyof Rating, value: string | null | number) => {
      setRatings((prev) => {
        const newMap = new Map(prev);
        const existing = newMap.get(factorId) ?? {
          factor_id: factorId,
          self_rating_code: null,
          manager_rating_code: null,
          self_comments: null,
          manager_comments: null,
        };
        newMap.set(factorId, { ...existing, [field]: value });
        return newMap;
      });
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
      const ratingsPayload = factors.map((factor) => {
        const r = ratings.get(factor.id);
        const effectiveWeight = r?.weight != null ? r.weight : factor.weight ?? null;
        return {
          factor_id: factor.id,
          self_rating_code: r?.self_rating_code ?? null,
          manager_rating_code: r?.manager_rating_code ?? null,
          self_comments: r?.self_comments ?? null,
          manager_comments: r?.manager_comments ?? null,
          ...(effectiveWeight !== undefined && effectiveWeight !== null ? { weight: effectiveWeight } : {}),
        };
      });
      const res = await fetch(`/api/appraisals/${appraisalId}/factor-ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratings: ratingsPayload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save ratings");
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
  }, [appraisalId, ratings, factors]);

  useEffect(() => {
    if (!registerSave) return;
    registerSave(saveRatings);
    return () => registerSave(null);
  }, [registerSave, saveRatings]);

  const canEdit = canEditSelfRatings || canEditManagerRatings || canEditWeights;
  const totalWeight = factors.reduce(
    (sum, factor) => sum + (ratings.get(factor.id)?.weight != null ? Number(ratings.get(factor.id)!.weight) : factor.weight ?? 0),
    0
  );
  const weightValid = !canEditWeights || Math.abs(totalWeight - 100) < 0.01;
  const saveDisabled = saving || (canEditWeights && !weightValid);

  const getEffectiveWeight = (factorId: string) => {
    const factor = factors.find((f) => f.id === factorId);
    const rating = ratings.get(factorId);
    return rating?.weight != null ? rating.weight : factor?.weight ?? 0;
  };

  const calculateScore = (factorId: string) => {
    const factor = factors.find((f) => f.id === factorId);
    const rating = ratings.get(factorId);
    const code = rating?.manager_rating_code ?? rating?.self_rating_code;
    if (!factor || !code) return null;

    const scale = ratingScale.find((s) => s.code === code);
    if (!scale) return null;

    const w = getEffectiveWeight(factorId);
    return (w * scale.factor).toFixed(1);
  };

  if (loading) {
    return <p className="py-4 text-[13px] text-ds-text-secondary">Loading productivity assessment…</p>;
  }

  const totalScore = factors
    .map((f) => calculateScore(f.id))
    .filter((s): s is string => s !== null)
    .reduce((sum, s) => sum + parseFloat(s), 0)
    .toFixed(1);

  const rows: CompetencyGridRow[] = factors.map((factor) => {
    const rating = ratings.get(factor.id);
    return {
      id: factor.id,
      name: factor.name,
      description: factor.description,
      weight: getEffectiveWeight(factor.id),
      selfRating: rating?.self_rating_code ?? null,
      managerRating: rating?.manager_rating_code ?? null,
      selfComments: rating?.self_comments ?? null,
      managerComments: rating?.manager_comments ?? null,
      score: calculateScore(factor.id) || null,
    };
  });

  return (
    <CompetencyAssessmentGrid
      workflowStatus={appraisalStatus}
      title="Productivity Assessment"
      subtitle={
        <>
          Productivity factors with weighted scoring. Total weight: {totalWeight} points
          {canEditWeights && factors.length > 0 && (
            <span className={`ml-2 ${weightValid ? "text-ds-success" : "text-ds-error"}`}>— Must equal 100%.</span>
          )}
        </>
      }
      factorLabel="Factor"
      emptyMessage="No productivity factors configured. Contact HR to set up evaluation factors."
      rows={rows}
      canEdit={canEdit}
      canEditSelfRatings={canEditSelfRatings}
      canEditManagerRatings={canEditManagerRatings}
      canEditWeights={canEditWeights}
      onChange={updateRating}
      onSave={saveRatings}
      saveDisabled={saveDisabled}
      saving={saving}
      error={error}
      saveSuccess={saveSuccess}
      totalWeight={totalWeight}
      totalScore={parseFloat(totalScore) > 0 ? totalScore : null}
    />
  );
}
