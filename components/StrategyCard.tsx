"use client";

import { Lightbulb, Target, TrendingUp, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import type { AnalysisResult, PersonaResponse } from "@/lib/analysis-engine";

interface StrategyCardProps {
  analysis: AnalysisResult;
  responses: PersonaResponse[];
  brand: string;
  competitor: string;
  category: string;
}

export function StrategyCard({
  analysis,
  responses,
  brand,
  competitor,
  category,
}: StrategyCardProps) {
  const generateStrategy = (): string[] => {
    const strategies: string[] = [];

    // Share of Voice analysis
    if (analysis.shareOfVoice.competitorFirst > analysis.shareOfVoice.brandFirst) {
      strategies.push(
        `⚠️ Your competitor is mentioned first in ${analysis.shareOfVoice.competitorFirst} out of ${responses.length} responses. Action: Update your homepage metadata to include "${category}" keywords to improve AI model recognition.`
      );
    }

    // Sentiment analysis
    if (analysis.sentiment.competitor === "positive" && analysis.sentiment.brand === "neutral") {
      strategies.push(
        `📊 Competitor receives more positive sentiment. Action: Enhance your content with specific feature highlights (e.g., "ISO 27001 certified", "Enterprise-grade security") to match competitor positioning.`
      );
    }

    if (analysis.sentiment.brand === "negative") {
      strategies.push(
        `🔴 Negative sentiment detected for ${brand}. Action: Review and update your public-facing content to address common concerns mentioned in AI responses.`
      );
    }

    // Citation analysis
    if (analysis.citations.competitor.length > analysis.citations.brand.length) {
      strategies.push(
        `🔗 Competitor has more citations. Action: Ensure your website has clear, accessible URLs and consider creating dedicated landing pages for key features that AI models can reference.`
      );
    }

    // Model-specific insights
    const hasDeepSeek = responses.some((r) => r.response.includes("deepseek") || r.response.length > 500);
    if (hasDeepSeek) {
      strategies.push(
        `🧠 Complex reasoning models (like DeepSeek R1) are analyzing your brand. Action: Include detailed technical specifications and use case scenarios in your content to appeal to reasoning-focused models.`
      );
    }

    // Win rate recommendations
    if (analysis.winRate < 50) {
      strategies.push(
        `📉 Current win rate: ${analysis.winRate}%. Action: Focus on improving first-mention positioning by optimizing for early keywords in product descriptions and meta tags.`
      );
    } else if (analysis.winRate >= 75) {
      strategies.push(
        `✅ Strong win rate of ${analysis.winRate}%! Action: Maintain this position by consistently updating content and monitoring competitor moves.`
      );
    } else {
      strategies.push(
        `📈 Win rate: ${analysis.winRate}%. Action: You're competitive but can improve. Consider A/B testing different messaging strategies to increase first-mention frequency.`
      );
    }

    // Category-specific recommendations
    strategies.push(
      `🎯 For "${category}" category: Ensure your brand messaging includes industry-standard terminology that AI models recognize. Update your "About" page and product descriptions with category-relevant keywords.`
    );

    return strategies;
  };

  const strategies = generateStrategy();

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          Strategic Action Plan
        </CardTitle>
        <CardDescription>
          AI-generated recommendations based on your brand visibility analysis
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {strategies.length > 0 ? (
            <ul className="space-y-3">
              {strategies.map((strategy, index) => (
                <li key={index} className="flex gap-3">
                  <div className="flex-shrink-0 mt-1">
                    {strategy.includes("⚠️") && (
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                    )}
                    {strategy.includes("📊") && (
                      <TrendingUp className="h-4 w-4 text-blue-500" />
                    )}
                    {strategy.includes("🔴") && (
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    )}
                    {strategy.includes("🔗") && (
                      <Target className="h-4 w-4 text-purple-500" />
                    )}
                    {strategy.includes("🧠") && (
                      <Lightbulb className="h-4 w-4 text-indigo-500" />
                    )}
                    {strategy.includes("📉") && (
                      <TrendingUp className="h-4 w-4 text-orange-500 rotate-180" />
                    )}
                    {strategy.includes("✅") && (
                      <Target className="h-4 w-4 text-green-500" />
                    )}
                    {strategy.includes("📈") && (
                      <TrendingUp className="h-4 w-4 text-green-500" />
                    )}
                    {strategy.includes("🎯") && (
                      <Target className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground flex-1">
                    {strategy.replace(/[⚠️📊🔴🔗🧠📉✅📈🎯]/g, "").trim()}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Run a simulation to generate strategic recommendations.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

