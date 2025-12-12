"use client";

import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import type { AnalysisResult } from "@/lib/analysis-engine";

interface PersonaBreakdownChartProps {
  personaBreakdown: AnalysisResult['detailedMetrics']['personaBreakdown'];
  brand: string;
  competitor: string;
}

const sentimentToScore = (sentiment: "positive" | "negative" | "neutral") => {
  switch (sentiment) {
    case "positive": return 100;
    case "negative": return 0;
    case "neutral": return 50;
    default: return 50;
  }
};

export function PersonaBreakdownChart({ personaBreakdown, brand, competitor }: PersonaBreakdownChartProps) {
  const personas = Object.keys(personaBreakdown);
  
  const data = personas.map(persona => {
    const breakdown = personaBreakdown[persona];
    return {
      persona: persona.replace("The ", ""),
      [brand]: breakdown ? sentimentToScore(breakdown.brandSentiment) : 50,
      [competitor]: breakdown ? sentimentToScore(breakdown.competitorSentiment) : 50,
    };
  });

  if (data.length === 0) {
    return (
      <Card className="glass">
        <CardHeader>
          <CardTitle>Persona Breakdown</CardTitle>
          <CardDescription>Sentiment analysis by persona</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No persona data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>Persona Breakdown</CardTitle>
        <CardDescription>Sentiment analysis by buyer persona</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <RadarChart data={data}>
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis 
              dataKey="persona" 
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            <PolarRadiusAxis 
              angle={90} 
              domain={[0, 100]} 
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            />
            <Radar
              name={brand}
              dataKey={brand}
              stroke="#8b5cf6"
              fill="#8b5cf6"
              fillOpacity={0.6}
            />
            <Radar
              name={competitor}
              dataKey={competitor}
              stroke="#ef4444"
              fill="#ef4444"
              fillOpacity={0.6}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "0.5rem",
              }}
            />
            <Legend />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

