import { aiService } from "./ai-service";

export interface AnalysisResult {
  shareOfVoice: {
    brandFirst: number;
    competitorFirst: number;
    neither: number;
  };
  sentiment: {
    brand: "positive" | "negative" | "neutral";
    competitor: "positive" | "negative" | "neutral";
    brandScore: number; // 0-100
    competitorScore: number; // 0-100
    reasoning: string;
  };
  citations: {
    brand: string[];
    competitor: string[];
  };
  winRate: number;
  detailedMetrics: {
    mentionFrequency: {
      brand: number;
      competitor: number;
    };
    recommendationRate: {
      brand: number; // percentage
      competitor: number; // percentage
    };
    featureMentions: {
      brand: string[];
      competitor: string[];
    };
    strengths: {
      brand: string[];
      competitor: string[];
    };
    weaknesses: {
      brand: string[];
      competitor: string[];
    };
    personaBreakdown: {
      [persona: string]: {
        brandSentiment: "positive" | "negative" | "neutral";
        competitorSentiment: "positive" | "negative" | "neutral";
        recommendation: "brand" | "competitor" | "neither";
      };
    };
    competitiveAdvantages: {
      brand: string[];
      competitor: string[];
    };
    marketPositioning: {
      brand: string;
      competitor: string;
    };
  };
}

export interface PersonaResponse {
  persona: string;
  query: string;
  response: string;
}

export function analyzeShareOfVoice(
  responses: PersonaResponse[],
  brand: string,
  competitor: string
): { brandFirst: number; competitorFirst: number; neither: number } {
  let brandFirst = 0;
  let competitorFirst = 0;
  let neither = 0;

  const brandLower = brand.toLowerCase();
  const competitorLower = competitor.toLowerCase();

  for (const { response } of responses) {
    const responseLower = response.toLowerCase();
    const brandIndex = responseLower.indexOf(brandLower);
    const competitorIndex = responseLower.indexOf(competitorLower);

    if (brandIndex === -1 && competitorIndex === -1) {
      neither++;
    } else if (brandIndex === -1) {
      competitorFirst++;
    } else if (competitorIndex === -1) {
      brandFirst++;
    } else if (brandIndex < competitorIndex) {
      brandFirst++;
    } else {
      competitorFirst++;
    }
  }

  return { brandFirst, competitorFirst, neither };
}

export async function analyzeSentiment(
  responses: PersonaResponse[],
  brand: string,
  competitor: string,
  model: string
): Promise<{
  brand: "positive" | "negative" | "neutral";
  competitor: "positive" | "negative" | "neutral";
  brandScore: number;
  competitorScore: number;
  reasoning: string;
}> {
  // Use LLM as a judge for sentiment analysis
  const sentimentPrompt = `You are an expert sentiment analysis judge. Your task is to analyze the sentiment expressed about two brands in a series of AI-generated responses.

BRAND 1: "${brand}"
BRAND 2: "${competitor}"

Below are the AI responses that mention these brands. Analyze the sentiment (positive, negative, or neutral) expressed about each brand across all responses.

RESPONSES TO ANALYZE:
${responses.map((r, idx) => `\n--- Response ${idx + 1} (${r.persona}) ---\n${r.response}`).join("\n\n")}

CRITICAL INSTRUCTIONS:
1. Read each response carefully and identify mentions of "${brand}" and "${competitor}"
2. For each brand, determine the overall sentiment across ALL responses combined
3. Consider:
   - Explicit praise or criticism
   - Implied recommendations or warnings
   - Comparative statements (which brand is favored)
   - Tone and language used when discussing each brand
   - Context and nuance - not just keywords
4. Sentiment categories:
   - POSITIVE: Brand is recommended, praised, described favorably, or presented as superior
   - NEGATIVE: Brand is criticized, described unfavorably, presented as inferior, or has concerns raised
   - NEUTRAL: Brand is mentioned factually without clear positive or negative sentiment, or balanced pros/cons

5. Calculate sentiment scores (0-100):
   - 80-100: Strongly positive
   - 60-79: Moderately positive
   - 40-59: Neutral
   - 20-39: Moderately negative
   - 0-19: Strongly negative

6. You must respond EXACTLY in this JSON format (no markdown, no code blocks, just pure JSON):
{
  "brand": "positive" | "negative" | "neutral",
  "competitor": "positive" | "negative" | "neutral",
  "brandScore": 0-100,
  "competitorScore": 0-100,
  "reasoning": "Detailed explanation of your analysis"
}

Be thorough and accurate. Consider the full context of each response, not just individual words.`;

  try {
    const llmResponse = await aiService.getCompletion(sentimentPrompt, model);
    const content = llmResponse.content.trim();

    // Try to extract JSON from the response (handle cases where LLM wraps it in markdown)
    let jsonStr = content;
    
    // Remove markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      // Try to find JSON object in the response
      const jsonObjectMatch = content.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) {
        jsonStr = jsonObjectMatch[0];
      }
    }

    const parsed = JSON.parse(jsonStr);
    
    // Validate and normalize the response
    const brandSentiment = ["positive", "negative", "neutral"].includes(parsed.brand?.toLowerCase())
      ? (parsed.brand.toLowerCase() as "positive" | "negative" | "neutral")
      : "neutral";
    
    const competitorSentiment = ["positive", "negative", "neutral"].includes(parsed.competitor?.toLowerCase())
      ? (parsed.competitor.toLowerCase() as "positive" | "negative" | "neutral")
      : "neutral";

    const brandScore = typeof parsed.brandScore === 'number' ? Math.max(0, Math.min(100, parsed.brandScore)) : 50;
    const competitorScore = typeof parsed.competitorScore === 'number' ? Math.max(0, Math.min(100, parsed.competitorScore)) : 50;

    return {
      brand: brandSentiment,
      competitor: competitorSentiment,
      brandScore,
      competitorScore,
      reasoning: parsed.reasoning || "Analysis completed",
    };
  } catch (error: any) {
    // Fallback to neutral if LLM analysis fails
    console.error("Sentiment analysis error:", error);
    return {
      brand: "neutral",
      competitor: "neutral",
      brandScore: 50,
      competitorScore: 50,
      reasoning: "Analysis failed, using default values",
    };
  }
}

export async function extractDetailedMetrics(
  responses: PersonaResponse[],
  brand: string,
  competitor: string,
  model: string
): Promise<AnalysisResult['detailedMetrics']> {
  const detailedPrompt = `You are an expert competitive intelligence analyst. Analyze the following AI responses to extract comprehensive metrics about two competing brands.

BRAND 1: "${brand}"
BRAND 2: "${competitor}"

RESPONSES TO ANALYZE:
${responses.map((r, idx) => `\n=== Response ${idx + 1}: ${r.persona} ===\nQuery: ${r.query}\nResponse: ${r.response}`).join("\n\n")}

YOUR TASK: Extract detailed competitive intelligence metrics. Be extremely thorough and analytical.

CRITICAL INSTRUCTIONS:
1. Count total mentions of each brand across all responses
2. Calculate recommendation rate: What percentage of responses explicitly or implicitly recommend each brand?
3. Extract specific features mentioned for each brand
4. Identify strengths and weaknesses mentioned for each brand
5. Analyze sentiment per persona (how each persona views each brand)
6. Determine which brand each persona would recommend
7. Identify competitive advantages mentioned for each brand
8. Summarize market positioning (how each brand is positioned in the market)

You must respond EXACTLY in this JSON format (no markdown, no code blocks, just pure JSON):
{
  "mentionFrequency": {
    "brand": number,
    "competitor": number
  },
  "recommendationRate": {
    "brand": number (0-100 percentage),
    "competitor": number (0-100 percentage)
  },
  "featureMentions": {
    "brand": ["feature1", "feature2", ...],
    "competitor": ["feature1", "feature2", ...]
  },
  "strengths": {
    "brand": ["strength1", "strength2", ...],
    "competitor": ["strength1", "strength2", ...]
  },
  "weaknesses": {
    "brand": ["weakness1", "weakness2", ...],
    "competitor": ["weakness1", "weakness2", ...]
  },
  "personaBreakdown": {
    "The Skeptical CTO": {
      "brandSentiment": "positive" | "negative" | "neutral",
      "competitorSentiment": "positive" | "negative" | "neutral",
      "recommendation": "brand" | "competitor" | "neither"
    },
    "The Budget Buyer": {
      "brandSentiment": "positive" | "negative" | "neutral",
      "competitorSentiment": "positive" | "negative" | "neutral",
      "recommendation": "brand" | "competitor" | "neither"
    },
    "The Feature Hunter": {
      "brandSentiment": "positive" | "negative" | "neutral",
      "competitorSentiment": "positive" | "negative" | "neutral",
      "recommendation": "brand" | "competitor" | "neither"
    }
  },
  "competitiveAdvantages": {
    "brand": ["advantage1", "advantage2", ...],
    "competitor": ["advantage1", "advantage2", ...]
  },
  "marketPositioning": {
    "brand": "brief positioning statement",
    "competitor": "brief positioning statement"
  }
}

Be extremely detailed and thorough. Extract every possible insight from the responses.`;

  try {
    const llmResponse = await aiService.getCompletion(detailedPrompt, model);
    const content = llmResponse.content.trim();

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      const jsonObjectMatch = content.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) {
        jsonStr = jsonObjectMatch[0];
      }
    }

    const parsed = JSON.parse(jsonStr);

    // Validate and normalize
    return {
      mentionFrequency: {
        brand: typeof parsed.mentionFrequency?.brand === 'number' ? parsed.mentionFrequency.brand : 0,
        competitor: typeof parsed.mentionFrequency?.competitor === 'number' ? parsed.mentionFrequency.competitor : 0,
      },
      recommendationRate: {
        brand: typeof parsed.recommendationRate?.brand === 'number' ? Math.max(0, Math.min(100, parsed.recommendationRate.brand)) : 0,
        competitor: typeof parsed.recommendationRate?.competitor === 'number' ? Math.max(0, Math.min(100, parsed.recommendationRate.competitor)) : 0,
      },
      featureMentions: {
        brand: Array.isArray(parsed.featureMentions?.brand) ? parsed.featureMentions.brand : [],
        competitor: Array.isArray(parsed.featureMentions?.competitor) ? parsed.featureMentions.competitor : [],
      },
      strengths: {
        brand: Array.isArray(parsed.strengths?.brand) ? parsed.strengths.brand : [],
        competitor: Array.isArray(parsed.strengths?.competitor) ? parsed.strengths.competitor : [],
      },
      weaknesses: {
        brand: Array.isArray(parsed.weaknesses?.brand) ? parsed.weaknesses.brand : [],
        competitor: Array.isArray(parsed.weaknesses?.competitor) ? parsed.weaknesses.competitor : [],
      },
      personaBreakdown: parsed.personaBreakdown || {},
      competitiveAdvantages: {
        brand: Array.isArray(parsed.competitiveAdvantages?.brand) ? parsed.competitiveAdvantages.brand : [],
        competitor: Array.isArray(parsed.competitiveAdvantages?.competitor) ? parsed.competitiveAdvantages.competitor : [],
      },
      marketPositioning: {
        brand: typeof parsed.marketPositioning?.brand === 'string' ? parsed.marketPositioning.brand : "Not specified",
        competitor: typeof parsed.marketPositioning?.competitor === 'string' ? parsed.marketPositioning.competitor : "Not specified",
      },
    };
  } catch (error: any) {
    console.error("Detailed metrics extraction error:", error);
    // Return default structure
    return {
      mentionFrequency: { brand: 0, competitor: 0 },
      recommendationRate: { brand: 0, competitor: 0 },
      featureMentions: { brand: [], competitor: [] },
      strengths: { brand: [], competitor: [] },
      weaknesses: { brand: [], competitor: [] },
      personaBreakdown: {},
      competitiveAdvantages: { brand: [], competitor: [] },
      marketPositioning: { brand: "Not available", competitor: "Not available" },
    };
  }
}

export function checkCitations(
  responses: PersonaResponse[],
  brand: string,
  competitor: string
): { brand: string[]; competitor: string[] } {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const brandUrls: string[] = [];
  const competitorUrls: string[] = [];

  const brandLower = brand.toLowerCase();
  const competitorLower = competitor.toLowerCase();

  for (const { response } of responses) {
    const urls = response.match(urlRegex) || [];
    const responseLower = response.toLowerCase();

    for (const url of urls) {
      const urlLower = url.toLowerCase();
      const brandIndex = responseLower.indexOf(brandLower);
      const competitorIndex = responseLower.indexOf(competitorLower);
      const urlIndex = responseLower.indexOf(urlLower);

      if (urlIndex !== -1) {
        if (brandIndex !== -1 && Math.abs(urlIndex - brandIndex) < 200) {
          if (!brandUrls.includes(url)) brandUrls.push(url);
        } else if (competitorIndex !== -1 && Math.abs(urlIndex - competitorIndex) < 200) {
          if (!competitorUrls.includes(url)) competitorUrls.push(url);
        }
      }
    }
  }

  return { brand: brandUrls, competitor: competitorUrls };
}

export function calculateWinRate(
  shareOfVoice: { brandFirst: number; competitorFirst: number; neither: number },
  sentiment: {
    brand: "positive" | "negative" | "neutral";
    competitor: "positive" | "negative" | "neutral";
  },
  totalResponses: number
): number {
  if (totalResponses === 0) return 0;

  const shareWeight = 0.6;
  const sentimentWeight = 0.4;

  const shareScore = (shareOfVoice.brandFirst / totalResponses) * 100;

  const sentimentMap = { positive: 1, neutral: 0.5, negative: 0 };
  const brandSentimentScore = sentimentMap[sentiment.brand] * 100;
  const competitorSentimentScore = sentimentMap[sentiment.competitor] * 100;
  const sentimentScore =
    brandSentimentScore > competitorSentimentScore
      ? 100
      : brandSentimentScore < competitorSentimentScore
      ? 0
      : 50;

  const winRate = shareScore * shareWeight + sentimentScore * sentimentWeight;

  return Math.round(winRate);
}

export async function analyzeResults(
  responses: PersonaResponse[],
  brand: string,
  competitor: string,
  model: string
): Promise<AnalysisResult> {
  const shareOfVoice = analyzeShareOfVoice(responses, brand, competitor);
  const sentiment = await analyzeSentiment(responses, brand, competitor, model);
  const citations = checkCitations(responses, brand, competitor);
  const detailedMetrics = await extractDetailedMetrics(responses, brand, competitor, model);
  const winRate = calculateWinRate(shareOfVoice, sentiment, responses.length);

  return {
    shareOfVoice,
    sentiment,
    citations,
    winRate,
    detailedMetrics,
  };
}

