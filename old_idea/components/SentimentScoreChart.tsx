"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

interface SentimentScoreChartProps {
  brandScore: number;
  competitorScore: number;
  brand: string;
  competitor: string;
}

const COLORS = {
  brand: "#8b5cf6",
  competitor: "#ef4444",
};

export function SentimentScoreChart({ brandScore, competitorScore, brand, competitor }: SentimentScoreChartProps) {
  const data = [
    {
      name: brand,
      score: brandScore,
      color: COLORS.brand,
    },
    {
      name: competitor,
      score: competitorScore,
      color: COLORS.competitor,
    },
  ];

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>Sentiment Scores</CardTitle>
        <CardDescription>Detailed sentiment analysis scores (0-100)</CardDescription>
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
              formatter={(value: number) => [`${value}%`, "Sentiment Score"]}
            />
            <Legend />
            <Bar dataKey="score" name="Sentiment Score" radius={[8, 8, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="text-center">
            <div className="text-2xl font-bold" style={{ color: COLORS.brand }}>
              {brandScore}%
            </div>
            <div className="text-muted-foreground">{brand}</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold" style={{ color: COLORS.competitor }}>
              {competitorScore}%
            </div>
            <div className="text-muted-foreground">{competitor}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

