
## 2025-12-12 20:09:25 - Updated to use google/gemma-3-1b with LMStudio locally

Changed default local model ID from 'local-model' to 'google/gemma-3-1b' for LMStudio integration.
Users can still override this in Settings if their LMStudio model name differs.

## 2025-12-12 20:14:17 - Implemented LLM-based Sentiment Analysis

Replaced simple keyword-based sentiment analysis with LLM-as-judge approach:
- Updated `analyzeSentiment` function to use the configured LLM (same model used for responses)
- Created comprehensive sentiment analysis prompt that instructs the LLM to:
  * Analyze sentiment across all persona responses
  * Consider context, nuance, and comparative statements
  * Return structured JSON with sentiment classification (positive/negative/neutral)
- Made `analyzeResults` async to support LLM-based sentiment analysis
- Updated `app/page.tsx` to await the async analysis
- Removed unused keyword-based helper functions
- Added error handling with fallback to neutral sentiment if LLM analysis fails

The sentiment analysis now uses the same model (google/gemma-3-1b via LMStudio) as the main responses, ensuring consistency in analysis.

## 2025-12-12 20:25:47 - Comprehensive Metrics Dashboard & Advanced Visualizations

Implemented comprehensive metrics extraction and visualization system:

### Enhanced Analysis Engine:
- Expanded `AnalysisResult` interface with `detailedMetrics` object containing:
  * Mention frequency counts
  * Recommendation rates (percentage)
  * Feature mentions arrays
  * Strengths and weaknesses lists
  * Persona breakdown (sentiment per persona)
  * Competitive advantages
  * Market positioning statements
- Enhanced sentiment analysis to return scores (0-100) and detailed reasoning
- Created `extractDetailedMetrics` function with comprehensive LLM prompt that:
  * Extracts all competitive intelligence metrics
  * Analyzes sentiment per persona
  * Identifies features, strengths, weaknesses
  * Determines market positioning

### New Chart Components:
- `SentimentScoreChart`: Bar chart showing sentiment scores (0-100)
- `RecommendationRateChart`: Bar chart showing recommendation percentages
- `MentionFrequencyChart`: Bar chart showing total mention counts
- `PersonaBreakdownChart`: Radar chart showing sentiment by persona
- `ComprehensiveMetricsDashboard`: Main dashboard component displaying:
  * Key metrics cards (Win Rate, Sentiment, Recommendation Rate, Mentions)
  * All chart visualizations
  * Strengths & Weaknesses comparison
  * Feature mentions tags
  * Competitive advantages lists
  * Market positioning statements
  * Sentiment analysis reasoning

### UI Updates:
- Updated main page to display comprehensive metrics dashboard
- All metrics now visible with rich visualizations
- Enhanced user experience with multiple chart types and detailed insights
