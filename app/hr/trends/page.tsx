import {
  getHRTrendsData,
  getHRTrendsFilterOptions,
} from "@/lib/hr-trends-data";
import { HRTrendsCharts } from "@/components/hr-trends-charts";
import { HRTrendsFilters } from "@/components/hr-trends-filters";

interface PageProps {
  searchParams: Promise<{ cycle?: string; division?: string; department?: string }>;
}

export default async function HRTrendsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = {
    cycleId: params.cycle ?? null,
    divisionId: params.division ?? null,
    departmentId: params.department ?? null,
  };

  const [data, filterOptions] = await Promise.all([
    getHRTrendsData(filters),
    getHRTrendsFilterOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-ds-page-title text-ds-text-primary">
            Performance Trends
          </h1>
          <p className="text-muted-foreground">
            Long-term score trends, division performance over cycles, and
            promotion readiness indicators.
          </p>
        </div>
        <HRTrendsFilters
          cycleId={filters.cycleId}
          divisionId={filters.divisionId}
          departmentId={filters.departmentId}
          options={filterOptions}
        />
      </div>
      <HRTrendsCharts
        employeeScoreTrend={data.employeeScoreTrend}
        divisionPerformanceTrend={data.divisionPerformanceTrend}
        promotionReadinessCounts={data.promotionReadinessCounts}
        promotionReadyEmployees={data.promotionReadyEmployees}
      />
    </div>
  );
}
