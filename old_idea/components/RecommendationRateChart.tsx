"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

interface RecommendationRateChartProps {
  brandRate: number;
  competitorRate: number;
  brand: string;
  competitor: string;
}

const COLORS = {
  brand: "#8b5cf6",
  competitor: "#ef4444",
};

export function RecommendationRateChart({ brandRate, competitorRate, brand, competitor }: RecommendationRateChartProps) {
  const data = [
    {
      name: brand,
      rate: brandRate,
      color: COLORS.brand,
    },
    {
      name: competitor,
      rate: competitorRate,
      color: COLORS.competitor,
    },
  ];

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>Recommendation Rate</CardTitle>
        <CardDescription>Percentage of responses that recommend each brand</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
            <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "0.5rem",
              }}
              formatter={(value: number) => [`${value}%`, "Recommendation Rate"]}
            />
            <Legend />
            <Bar dataKey="rate" name="Recommendation Rate" radius={[8, 8, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

