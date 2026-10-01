"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, Save, Send, CheckCircle2 } from "lucide-react";
import { cn } from "@/utils/cn";

type PageParams = { appraisalId: string } | Promise<{ appraisalId: string }>;

interface RatingOption {
  code: string;
  label: string;
}

interface Category {
  id: string;
  name: string;
  category_type: string;
  applies_to: string;
}

interface Factor {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  display_order: number;
}

interface FactorRatingRow {
  self_rating_code: string | null;
  self_comments: string | null;
  manager_rating_code: string | null;
  manager_comments: string | null;
}

const CATEGORY_ORDER = ["core", "productivity", "leadership"];

export default function ManagerReviewPage({
  params,
}: {
  params: PageParams;
}) {
  const [appraisalId, setAppraisalId] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState<string>("");
  const [appraisalStatus, setAppraisalStatus] = useState<string | null>(null);
  const [isManagement, setIsManagement] = useState<boolean>(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [factorsByCategory, setFactorsByCategory] = useState<
    Record<string, Factor[]>
  >({});
  const [ratingScale, setRatingScale] = useState<RatingOption[]>([]);
  const [ratings, setRatings] = useState<Record<string, FactorRatingRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveParams = useCallback(async (): Promise<string> => {
    const p = await Promise.resolve(params);
    setAppraisalId(p.appraisalId);
    return p.appraisalId;
  }, [params]);

  const loadData = useCallback(async (appraisalIdParam: string) => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: appraisal, error: appError } = await supabase
      .from("appraisals")
      .select("id, status, is_management, employee_id")
      .eq("id", appraisalIdParam)
      .single();

    if (appError || !appraisal) {
      setError("Appraisal not found.");
      setLoading(false);
      return;
    }

    setAppraisalStatus(appraisal.status ?? "draft");

    let hasDirectReports = false;
    try {
      const res = await fetch(`/api/appraisals/${appraisalIdParam}/has-direct-reports`);
      if (res.ok) {
        const data = await res.json();
        hasDirectReports = !!data.hasDirectReports;
      }
    } catch {
      // use is_management only if API fails
    }
    setIsManagement(!!appraisal.is_management || hasDirectReports);

    const { data: emp } = await supabase
      .from("employees")
      .select("full_name")
      .eq("employee_id", appraisal.employee_id)
      .single();
    setEmployeeName(emp?.full_name ?? "Employee");

    const { data: categoriesData, error: catError } = await supabase
      .from("evaluation_categories")
      .select("id, name, category_type, applies_to")
      .eq("active", true);

    if (catError) {
      setError(catError.message);
      setLoading(false);
      return;
    }

    const cats = (categoriesData ?? []) as Category[];
    setCategories(
      cats.sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category_type) -
          CATEGORY_ORDER.indexOf(b.category_type)
      )
    );

    const { data: factorsData, error: facError } = await supabase
      .from("evaluation_factors")
      .select("id, category_id, name, description, display_order")
      .eq("active", true)
      .order("display_order", { ascending: true });

    if (facError) {
      setError(facError.message);
      setLoading(false);
      return;
    }

    const factors = (factorsData ?? []) as Factor[];
    const byCategory: Record<string, Factor[]> = {};
    for (const f of factors) {
      if (!byCategory[f.category_id]) byCategory[f.category_id] = [];
      byCategory[f.category_id].push(f);
    }
    setFactorsByCategory(byCategory);

    const { data: scaleData, error: scaleError } = await supabase
      .from("rating_scale")
      .select("code, label")
      .order("factor", { ascending: false });

    if (scaleError) {
      setError(scaleError.message);
      setLoading(false);
      return;
    }

    setRatingScale(
      (scaleData ?? []).map((r) => ({ code: r.code, label: r.label }))
    );

    const { data: ratingsData, error: ratError } = await supabase
      .from("appraisal_factor_ratings")
      .select(
        "factor_id, self_rating_code, self_comments, manager_rating_code, manager_comments"
      )
      .eq("appraisal_id", appraisalIdParam);

    if (ratError) {
      setError(ratError.message);
      setLoading(false);
      return;
    }

    const ratingMap: Record<string, FactorRatingRow> = {};
    for (const r of ratingsData ?? []) {
      ratingMap[r.factor_id] = {
        self_rating_code: r.self_rating_code ?? null,
        self_comments: r.self_comments ?? null,
        manager_rating_code: r.manager_rating_code ?? null,
        manager_comments: r.manager_comments ?? null,
      };
    }
    for (const f of factors) {
      if (!ratingMap[f.id]) {
        ratingMap[f.id] = {
          self_rating_code: null,
          self_comments: null,
          manager_rating_code: null,
          manager_comments: null,
        };
      }
    }
    setRatings(ratingMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    resolveParams().then((id) => {
      if (mounted && id) loadData(id);
    });
    return () => {
      mounted = false;
    };
  }, [resolveParams, loadData]);

  const setManagerRating = useCallback(
    (
      factorId: string,
      field: "manager_rating_code" | "manager_comments",
      value: string | null
    ) => {
      setRatings((prev) => ({
        ...prev,
        [factorId]: {
          ...prev[factorId],
          [field]: value,
        },
      }));
    },
    []
  );

  const isCompleted =
    appraisalStatus !== null &&
    appraisalStatus !== "draft" &&
    appraisalStatus !== "self_submitted" &&
    appraisalStatus !== "manager_in_review";
  const canEdit =
    appraisalStatus === "self_submitted" || appraisalStatus === "manager_in_review";

  const saveReview = useCallback(async () => {
    if (!appraisalId || !canEdit) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    const supabase = createClient();

    try {
      const rows = Object.entries(ratings).map(([factor_id, r]) => ({
        appraisal_id: appraisalId,
        factor_id,
        self_rating_code: r.self_rating_code || null,
        self_comments: r.self_comments || null,
        manager_rating_code: r.manager_rating_code || null,
        manager_comments: r.manager_comments || null,
      }));

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from("appraisal_factor_ratings")
          .upsert(rows, { onConflict: "appraisal_id,factor_id" });
        if (upsertError) throw new Error(upsertError.message);
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [appraisalId, canEdit, ratings]);

  const submitReview = useCallback(async () => {
    if (!appraisalId || !canEdit) return;
    setSubmitting(true);
    setError(null);
    const supabase = createClient();

    try {
      const { error: updateError } = await supabase
        .from("appraisals")
        .update({ status: "manager_completed" })
        .eq("id", appraisalId);

      if (updateError) throw new Error(updateError.message);
      setAppraisalStatus("manager_completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }, [appraisalId, canEdit]);

  const appliesToCurrentUser = useCallback(
    (appliesTo: string) => {
      if (appliesTo === "both") return true;
      if (appliesTo === "management") return isManagement;
      if (appliesTo === "non_management") return !isManagement;
      return true;
    },
    [isManagement]
  );

  const labelForCode = useCallback(
    (code: string | null) => {
      if (!code) return "—";
      const opt = ratingScale.find((o) => o.code === code);
      return opt ? `${opt.code} — ${opt.label}` : code;
    },
    [ratingScale]
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Loading review…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link
              href="/manager/reviews"
              className="flex items-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Team Reviews
            </Link>
          </Button>
          <h1 className="mt-2 text-ds-page-title text-ds-text-primary">
            Manager Review
          </h1>
          <p className="text-muted-foreground">
            Review self-assessment for {employeeName}. Enter your ratings and
            comments, then submit when complete.
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveReview} variant="outline" disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
            <Button onClick={submitReview} disabled={submitting}>
              <Send className="mr-2 h-4 w-4" />
              Submit Review
            </Button>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {saveSuccess && (
        <Alert className="border-ds-success-border bg-ds-success-subtle text-ds-success dark:border-green-900 dark:bg-green-950/30 dark:text-green-100">
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>Your review has been saved.</AlertDescription>
        </Alert>
      )}

      {isCompleted && (
        <Alert className="border-ds-info-border bg-ds-info-subtle text-ds-info dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Review completed</AlertTitle>
          <AlertDescription>
            You have submitted your review. This appraisal is marked manager
            completed. Employee may acknowledge next.
          </AlertDescription>
        </Alert>
      )}

      {categories
        .filter((cat) => appliesToCurrentUser(cat.applies_to))
        .map((category) => {
          const factors = factorsByCategory[category.id] ?? [];
          if (factors.length === 0) return null;

          return (
            <Card key={category.id}>
              <CardHeader>
                <CardTitle className="capitalize">
                  {category.name || category.category_type}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {factors.map((factor) => {
                  const r = ratings[factor.id] ?? {
                    self_rating_code: null,
                    self_comments: null,
                    manager_rating_code: null,
                    manager_comments: null,
                  };
                  return (
                    <div
                      key={factor.id}
                      className="space-y-3 rounded-lg border p-4"
                    >
                      <div className="font-medium">{factor.name}</div>
                      {factor.description && (
                        <p className="text-sm text-muted-foreground">
                          {factor.description}
                        </p>
                      )}
                      <div className="grid gap-4 border-t pt-4 sm:grid-cols-1 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground">
                            Employee self rating
                          </Label>
                          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                            {labelForCode(r.self_rating_code)}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-muted-foreground">
                            Employee comments
                          </Label>
                          <p className="min-h-[60px] rounded-md border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">
                            {r.self_comments || "—"}
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-4 border-t pt-4 sm:grid-cols-1 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor={`mgr-rating-${factor.id}`}>
                            Your rating
                          </Label>
                          <select
                            id={`mgr-rating-${factor.id}`}
                            className={cn(
                              "flex h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            )}
                            value={r.manager_rating_code ?? ""}
                            onChange={(e) =>
                              setManagerRating(
                                factor.id,
                                "manager_rating_code",
                                e.target.value || null
                              )
                            }
                            disabled={!canEdit}
                          >
                            <option value="">Select rating…</option>
                            {ratingScale.map((opt) => (
                              <option key={opt.code} value={opt.code}>
                                {opt.code} — {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`mgr-comments-${factor.id}`}>
                            Your comments
                          </Label>
                          <textarea
                            id={`mgr-comments-${factor.id}`}
                            className={cn(
                              "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            )}
                            value={r.manager_comments ?? ""}
                            onChange={(e) =>
                              setManagerRating(
                                factor.id,
                                "manager_comments",
                                e.target.value || null
                              )
                            }
                            disabled={!canEdit}
                            placeholder="Optional comments…"
                            rows={3}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
}
