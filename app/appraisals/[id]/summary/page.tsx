import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser, isPlaceholderUser } from "@/lib/auth";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

type PageParams = { id: string } | Promise<{ id: string }>;

async function canViewSummary(appraisalId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || isPlaceholderUser(user)) return false;
  if (user.roles?.some((r) => r === "hr" || r === "admin")) return true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const supabase = createClient(url, key);

  const { data: appraisal } = await supabase
    .from("appraisals")
    .select("id, employee_id, manager_employee_id, division_id")
    .eq("id", appraisalId)
    .maybeSingle();
  if (!appraisal) return false;

  const employeeId = user.employee_id ?? null;
  if (employeeId && appraisal.employee_id === employeeId) return true;
  if (user.roles?.includes("gm") && user.division_id && appraisal.division_id === user.division_id) return true;

  const managerAccess = await resolveManagerAccessForAppraisal({
    supabase,
    appraisalId,
    appraisalEmployeeId: appraisal.employee_id,
    appraisalManagerEmployeeId: appraisal.manager_employee_id,
    currentEmployeeId: employeeId,
  });
  return managerAccess.hasManagerAccess;
}

async function getScoreSummary(appraisalId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { scores: null, recommendation: null };
  const supabase = createClient(url, key);

  const { data: scores, error: scoresError } = await supabase
    .from("appraisal_section_scores")
    .select(
      "competency_score, productivity_score, leadership_score, workplan_score, total_score, final_rating"
    )
    .eq("appraisal_id", appraisalId)
    .single();

  if (scoresError || !scores) {
    return { scores: null, recommendation: null };
  }

  const { data: rec } = await supabase
    .from("appraisal_recommendations")
    .select("system_recommendation")
    .eq("appraisal_id", appraisalId)
    .single();

  return {
    scores: {
      competency_score: scores.competency_score != null ? Number(scores.competency_score) : null,
      productivity_score: scores.productivity_score != null ? Number(scores.productivity_score) : null,
      leadership_score: scores.leadership_score != null ? Number(scores.leadership_score) : null,
      workplan_score: scores.workplan_score != null ? Number(scores.workplan_score) : null,
      total_score: scores.total_score != null ? Number(scores.total_score) : null,
      final_rating: scores.final_rating,
    },
    recommendation: rec?.system_recommendation ?? null,
  };
}

function ScoreRow({
  label,
  value,
  showProgress = true,
}: {
  label: string;
  value: number | null;
  showProgress?: boolean;
}) {
  const v = value ?? 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value != null ? Math.round(value) : "—"}</span>
      </div>
      {showProgress && (
        <Progress value={v} max={100} className="h-2" />
      )}
    </div>
  );
}

export default async function AppraisalSummaryPage({
  params,
}: {
  params: PageParams;
}) {
  const { id: appraisalId } = await Promise.resolve(params);
  if (!(await canViewSummary(appraisalId))) notFound();
  const { scores, recommendation } = await getScoreSummary(appraisalId);

  if (!scores) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/appraisals" className="flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back to Appraisals
          </Link>
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              No scores calculated yet for this appraisal. Run the score
              calculation to see the summary here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/appraisals" className="flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back to Appraisals
          </Link>
        </Button>
        <h1 className="mt-2 text-ds-page-title text-ds-text-primary">
          Score Summary
        </h1>
        <p className="text-muted-foreground">
          Calculated section scores and final rating for this appraisal.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Appraisal scores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <ScoreRow label="Competency Score" value={scores.competency_score} />
          <ScoreRow label="Productivity Score" value={scores.productivity_score} />
          <ScoreRow label="Leadership Score" value={scores.leadership_score} />
          <ScoreRow label="Workplan Score" value={scores.workplan_score} />

          <div className="border-t pt-6">
            <ScoreRow
              label="Total Score"
              value={scores.total_score}
              showProgress={true}
            />
          </div>

          <div className="border-t pt-6">
            <p className="text-sm text-muted-foreground mb-1">Final Rating</p>
            {scores.final_rating ? (
              <Badge variant="secondary" className="text-sm py-1.5 px-3">
                {scores.final_rating}
              </Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </CardContent>
      </Card>

      {recommendation && (
        <Card>
          <CardHeader>
            <CardTitle>System Recommendation</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className="text-sm py-2 px-3 font-normal">
              {recommendation}
            </Badge>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
