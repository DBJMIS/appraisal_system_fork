"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ScoreDistributionBucket,
  DivisionPerformance,
  PerformerRow,
} from "@/lib/hr-analytics-data";

const DISTRIBUTION_COLORS = ["#b42318", "#8a5a00", "#8a5a00", "#2e7d4f", "#2e7d4f"];

interface HRAnalyticsChartsProps {
  scoreDistribution: ScoreDistributionBucket[];
  divisionPerformance: DivisionPerformance[];
  topPerformers: PerformerRow[];
  improvementCandidates: PerformerRow[];
}

export function HRAnalyticsCharts({
  scoreDistribution,
  divisionPerformance,
  topPerformers,
  improvementCandidates,
}: HRAnalyticsChartsProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Score distribution</CardTitle>
          <p className="text-sm text-muted-foreground">
            Number of appraisals by total score band
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={scoreDistribution}
                margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="band"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number | undefined) => [value ?? 0, "Count"]}
                  labelFormatter={(label) => `Score band: ${label}`}
                />
                <Bar dataKey="count" name="Count" radius={[4, 4, 0, 0]}>
                  {scoreDistribution.map((_, index) => (
                    <Cell
                      key={index}
                      fill={DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Division performance</CardTitle>
          <p className="text-sm text-muted-foreground">
            Average total score by division
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={divisionPerformance}
                layout="vertical"
                margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="divisionName"
                  width={100}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number | undefined) => [value ?? 0, "Avg score"]}
                  labelFormatter={(label) => label}
                />
                <Bar
                  dataKey="avgScore"
                  name="Avg score"
                  fill="hsl(var(--primary))"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Top performers</CardTitle>
          <p className="text-sm text-muted-foreground">
            Highest total scores in selected cycle(s)
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={topPerformers}
                margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="employeeName"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number | undefined) => [value ?? 0, "Score"]}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload
                      ? `${(payload[0].payload as PerformerRow).employeeName} · ${(payload[0].payload as PerformerRow).divisionName ?? "—"}`
                      : ""
                  }
                />
                <Bar
                  dataKey="totalScore"
                  name="Score"
                  fill="hsl(var(--chart-1, var(--primary)))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Improvement candidates</CardTitle>
          <p className="text-sm text-muted-foreground">
            Lowest total scores; consider development or support
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={improvementCandidates}
                margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="employeeName"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number | undefined) => [value ?? 0, "Score"]}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload
                      ? `${(payload[0].payload as PerformerRow).employeeName} · ${(payload[0].payload as PerformerRow).divisionName ?? "—"}`
                      : ""
                  }
                />
                <Bar
                  dataKey="totalScore"
                  name="Score"
                  fill="hsl(var(--chart-2, 25 5% 45%))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
