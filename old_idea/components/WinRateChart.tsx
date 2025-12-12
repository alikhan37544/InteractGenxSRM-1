"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

interface WinRateChartProps {
  winRate: number;
  brand: string;
  competitor: string;
}

const COLORS = {
  brand: "#8b5cf6", // Purple
  competitor: "#ef4444", // Red
  neutral: "#6b7280", // Gray
};

export function WinRateChart({ winRate, brand, competitor }: WinRateChartProps) {
  const competitorRate = 100 - winRate;

  const data = [
    { name: brand, value: winRate, color: COLORS.brand },
    { name: competitor, value: competitorRate, color: COLORS.competitor },
  ].filter((item) => item.value > 0);

  const renderLabel = (entry: any) => {
    return `${entry.name}: ${entry.value}%`;
  };

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>Share of Voice - Win Rate</CardTitle>
        <CardDescription>
          Percentage of AI responses where each brand was mentioned first
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl font-bold text-primary">{winRate}%</div>
              <div className="text-sm text-muted-foreground">Win Rate</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={renderLabel}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                }}
              />
              <Legend
                formatter={(value, entry: any) => (
                  <span style={{ color: entry.color }}>{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: COLORS.brand }}
              />
              <span>{brand}: {winRate}%</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: COLORS.competitor }}
              />
              <span>{competitor}: {competitorRate}%</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

