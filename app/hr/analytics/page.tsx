import { getHRAnalyticsData, getHRAnalyticsCycleOptions } from "@/lib/hr-analytics-data";
import { HRAnalyticsCharts } from "@/components/hr-analytics-charts";
import { AnalyticsCycleFilter } from "@/components/analytics-cycle-filter";

interface PageProps {
  searchParams: Promise<{ cycle?: string }>;
}

export default async function HRAnalyticsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const cycleId = params.cycle ?? null;

  const [data, cycleOptions] = await Promise.all([
    getHRAnalyticsData({ cycleId, limit: 10 }),
    getHRAnalyticsCycleOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-ds-page-title text-ds-text-primary">
            HR Analytics
          </h1>
          <p className="text-muted-foreground">
            Insights into appraisal results: score distribution, division
            performance, and talent focus.
          </p>
        </div>
        <AnalyticsCycleFilter
          cycleId={cycleId}
          options={cycleOptions}
        />
      </div>
      <HRAnalyticsCharts
        scoreDistribution={data.scoreDistribution}
        divisionPerformance={data.divisionPerformance}
        topPerformers={data.topPerformers}
        improvementCandidates={data.improvementCandidates}
      />
    </div>
  );
}
