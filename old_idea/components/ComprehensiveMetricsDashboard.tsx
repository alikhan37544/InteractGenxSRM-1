"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { TrendingUp, TrendingDown, Target, Award, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import type { AnalysisResult } from "@/lib/analysis-engine";
import { SentimentScoreChart } from "./SentimentScoreChart";
import { RecommendationRateChart } from "./RecommendationRateChart";
import { PersonaBreakdownChart } from "./PersonaBreakdownChart";
import { MentionFrequencyChart } from "./MentionFrequencyChart";

interface ComprehensiveMetricsDashboardProps {
  analysis: AnalysisResult;
  brand: string;
  competitor: string;
}

export function ComprehensiveMetricsDashboard({ analysis, brand, competitor }: ComprehensiveMetricsDashboardProps) {
  const metrics = analysis.detailedMetrics;

  const getSentimentIcon = (sentiment: "positive" | "negative" | "neutral") => {
    switch (sentiment) {
      case "positive":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "negative":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{analysis.winRate}%</div>
            <div className="flex items-center gap-1 mt-1">
              {analysis.winRate >= 50 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
              <span className="text-xs text-muted-foreground">
                {analysis.winRate >= 50 ? "Leading" : "Behind"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Brand Sentiment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{analysis.sentiment.brandScore}%</div>
            <div className="flex items-center gap-1 mt-1">
              {getSentimentIcon(analysis.sentiment.brand)}
              <span className="text-xs text-muted-foreground capitalize">{analysis.sentiment.brand}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Recommendation Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{metrics.recommendationRate.brand}%</div>
            <div className="flex items-center gap-1 mt-1">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">of responses recommend {brand}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Mentions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{metrics.mentionFrequency.brand}</div>
            <div className="flex items-center gap-1 mt-1">
              <Award className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">across all responses</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SentimentScoreChart
          brandScore={analysis.sentiment.brandScore}
          competitorScore={analysis.sentiment.competitorScore}
          brand={brand}
          competitor={competitor}
        />
        <RecommendationRateChart
          brandRate={metrics.recommendationRate.brand}
          competitorRate={metrics.recommendationRate.competitor}
          brand={brand}
          competitor={competitor}
        />
        <MentionFrequencyChart
          brandMentions={metrics.mentionFrequency.brand}
          competitorMentions={metrics.mentionFrequency.competitor}
          brand={brand}
          competitor={competitor}
        />
        <PersonaBreakdownChart
          personaBreakdown={metrics.personaBreakdown}
          brand={brand}
          competitor={competitor}
        />
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              Strengths
            </CardTitle>
            <CardDescription>Identified strengths for each brand</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-sm" style={{ color: "#8b5cf6" }}>{brand}</h4>
              <ul className="space-y-1">
                {metrics.strengths.brand.length > 0 ? (
                  metrics.strengths.brand.map((strength, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 mt-1 text-green-500 flex-shrink-0" />
                      <span>{strength}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted-foreground">No strengths identified</li>
                )}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-sm" style={{ color: "#ef4444" }}>{competitor}</h4>
              <ul className="space-y-1">
                {metrics.strengths.competitor.length > 0 ? (
                  metrics.strengths.competitor.map((strength, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 mt-1 text-green-500 flex-shrink-0" />
                      <span>{strength}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted-foreground">No strengths identified</li>
                )}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-500" />
              Weaknesses
            </CardTitle>
            <CardDescription>Identified weaknesses for each brand</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-sm" style={{ color: "#8b5cf6" }}>{brand}</h4>
              <ul className="space-y-1">
                {metrics.weaknesses.brand.length > 0 ? (
                  metrics.weaknesses.brand.map((weakness, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                      <XCircle className="h-3 w-3 mt-1 text-red-500 flex-shrink-0" />
                      <span>{weakness}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted-foreground">No weaknesses identified</li>
                )}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-sm" style={{ color: "#ef4444" }}>{competitor}</h4>
              <ul className="space-y-1">
                {metrics.weaknesses.competitor.length > 0 ? (
                  metrics.weaknesses.competitor.map((weakness, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                      <XCircle className="h-3 w-3 mt-1 text-red-500 flex-shrink-0" />
                      <span>{weakness}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted-foreground">No weaknesses identified</li>
                )}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Features & Competitive Advantages */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-primary" />
              Feature Mentions
            </CardTitle>
            <CardDescription>Features mentioned for each brand</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-sm" style={{ color: "#8b5cf6" }}>{brand}</h4>
              <div className="flex flex-wrap gap-2">
                {metrics.featureMentions.brand.length > 0 ? (
                  metrics.featureMentions.brand.map((feature, idx) => (
                    <span key={idx} className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-md">
                      {feature}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">No features mentioned</span>
                )}
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-sm" style={{ color: "#ef4444" }}>{competitor}</h4>
              <div className="flex flex-wrap gap-2">
                {metrics.featureMentions.competitor.length > 0 ? (
                  metrics.featureMentions.competitor.map((feature, idx) => (
                    <span key={idx} className="px-2 py-1 bg-red-500/10 text-red-500 text-xs rounded-md">
                      {feature}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">No features mentioned</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Competitive Advantages
            </CardTitle>
            <CardDescription>Key competitive advantages identified</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-sm" style={{ color: "#8b5cf6" }}>{brand}</h4>
              <ul className="space-y-1">
                {metrics.competitiveAdvantages.brand.length > 0 ? (
                  metrics.competitiveAdvantages.brand.map((advantage, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                      <Award className="h-3 w-3 mt-1 text-primary flex-shrink-0" />
                      <span>{advantage}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted-foreground">No advantages identified</li>
                )}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-sm" style={{ color: "#ef4444" }}>{competitor}</h4>
              <ul className="space-y-1">
                {metrics.competitiveAdvantages.competitor.length > 0 ? (
                  metrics.competitiveAdvantages.competitor.map((advantage, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                      <Award className="h-3 w-3 mt-1 text-red-500 flex-shrink-0" />
                      <span>{advantage}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted-foreground">No advantages identified</li>
                )}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Market Positioning */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Market Positioning
          </CardTitle>
          <CardDescription>How each brand is positioned in the market</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2 text-sm" style={{ color: "#8b5cf6" }}>{brand}</h4>
            <p className="text-sm text-muted-foreground">{metrics.marketPositioning.brand}</p>
          </div>
          <div>
            <h4 className="font-semibold mb-2 text-sm" style={{ color: "#ef4444" }}>{competitor}</h4>
            <p className="text-sm text-muted-foreground">{metrics.marketPositioning.competitor}</p>
          </div>
        </CardContent>
      </Card>

      {/* Sentiment Reasoning */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-primary" />
            Sentiment Analysis Reasoning
          </CardTitle>
          <CardDescription>Detailed explanation of sentiment analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{analysis.sentiment.reasoning}</p>
        </CardContent>
      </Card>
    </div>
  );
}

