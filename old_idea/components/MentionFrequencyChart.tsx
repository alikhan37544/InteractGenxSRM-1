"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

interface MentionFrequencyChartProps {
  brandMentions: number;
  competitorMentions: number;
  brand: string;
  competitor: string;
}

const COLORS = {
  brand: "#8b5cf6",
  competitor: "#ef4444",
};

export function MentionFrequencyChart({ brandMentions, competitorMentions, brand, competitor }: MentionFrequencyChartProps) {
  const data = [
    {
      name: brand,
      mentions: brandMentions,
      color: COLORS.brand,
    },
    {
      name: competitor,
      mentions: competitorMentions,
      color: COLORS.competitor,
    },
  ];

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>Mention Frequency</CardTitle>
        <CardDescription>Total number of times each brand is mentioned across all responses</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
            <YAxis stroke="hsl(var(--muted-foreground))" />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "0.5rem",
              }}
            />
            <Legend />
            <Bar dataKey="mentions" name="Mentions" radius={[8, 8, 0, 0]}>
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

