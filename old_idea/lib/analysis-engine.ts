export interface AnalysisResult {
  shareOfVoice: {
    brandFirst: number;
    competitorFirst: number;
    neither: number;
  };
  sentiment: {
    brand: "positive" | "negative" | "neutral";
    competitor: "positive" | "negative" | "neutral";
  };
  citations: {
    brand: string[];
    competitor: string[];
  };
  winRate: number;
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

export function analyzeSentiment(
  responses: PersonaResponse[],
  brand: string,
  competitor: string
): {
  brand: "positive" | "negative" | "neutral";
  competitor: "positive" | "negative" | "neutral";
} {
  const positiveWords = [
    "excellent",
    "great",
    "best",
    "outstanding",
    "superior",
    "innovative",
    "reliable",
    "fast",
    "efficient",
    "affordable",
    "powerful",
    "secure",
    "recommended",
    "top",
    "leading",
  ];
  const negativeWords = [
    "poor",
    "bad",
    "slow",
    "expensive",
    "unreliable",
    "outdated",
    "limited",
    "weak",
    "inferior",
    "problematic",
    "issues",
    "concerns",
    "lacks",
    "missing",
  ];

  let brandScore = 0;
  let competitorScore = 0;
  let brandMentions = 0;
  let competitorMentions = 0;

  const brandLower = brand.toLowerCase();
  const competitorLower = competitor.toLowerCase();

  for (const { response } of responses) {
    const responseLower = response.toLowerCase();
    const brandContext = extractContext(responseLower, brandLower);
    const competitorContext = extractContext(responseLower, competitorLower);

    if (brandContext) {
      brandMentions++;
      brandScore += calculateSentimentScore(brandContext, positiveWords, negativeWords);
    }

    if (competitorContext) {
      competitorMentions++;
      competitorScore += calculateSentimentScore(
        competitorContext,
        positiveWords,
        negativeWords
      );
    }
  }

  const brandSentiment =
    brandMentions === 0
      ? "neutral"
      : brandScore > 0
      ? "positive"
      : brandScore < 0
      ? "negative"
      : "neutral";

  const competitorSentiment =
    competitorMentions === 0
      ? "neutral"
      : competitorScore > 0
      ? "positive"
      : competitorScore < 0
      ? "negative"
      : "neutral";

  return {
    brand: brandSentiment,
    competitor: competitorSentiment,
  };
}

function extractContext(text: string, keyword: string, contextLength = 100): string {
  const index = text.indexOf(keyword);
  if (index === -1) return "";

  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + keyword.length + contextLength);
  return text.substring(start, end);
}

function calculateSentimentScore(
  text: string,
  positiveWords: string[],
  negativeWords: string[]
): number {
  let score = 0;
  const textLower = text.toLowerCase();

  for (const word of positiveWords) {
    if (textLower.includes(word)) score++;
  }

  for (const word of negativeWords) {
    if (textLower.includes(word)) score--;
  }

  return score;
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

export function analyzeResults(
  responses: PersonaResponse[],
  brand: string,
  competitor: string
): AnalysisResult {
  const shareOfVoice = analyzeShareOfVoice(responses, brand, competitor);
  const sentiment = analyzeSentiment(responses, brand, competitor);
  const citations = checkCitations(responses, brand, competitor);
  const winRate = calculateWinRate(shareOfVoice, sentiment, responses.length);

  return {
    shareOfVoice,
    sentiment,
    citations,
    winRate,
  };
}

