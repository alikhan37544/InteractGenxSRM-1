"use client";

import { useState, useEffect } from "react";
import { Settings, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsModal } from "@/components/SettingsModal";
import { WarRoomInput } from "@/components/WarRoomInput";
import { WarRoomResults } from "@/components/WarRoomResults";
import { WinRateChart } from "@/components/WinRateChart";
import { StrategyCard } from "@/components/StrategyCard";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { useSettingsStore } from "@/store/settings-store";
import { aiService } from "@/lib/ai-service";
import { analyzeResults, type PersonaResponse } from "@/lib/analysis-engine";
import { rateLimiter } from "@/lib/rate-limiter";

const PERSONAS = [
  {
    name: "The Skeptical CTO",
    queryTemplate: (brand: string, competitor: string, category: string) =>
      `I'm evaluating ${category} solutions. Compare ${brand} and ${competitor} focusing on security, compliance, and enterprise readiness. Which would you recommend for a security-conscious organization?`,
  },
  {
    name: "The Budget Buyer",
    queryTemplate: (brand: string, competitor: string, category: string) =>
      `I need a ${category} solution but have a tight budget. How do ${brand} and ${competitor} compare in terms of pricing, value, and total cost of ownership?`,
  },
  {
    name: "The Feature Hunter",
    queryTemplate: (brand: string, competitor: string, category: string) =>
      `I'm looking for the best ${category} with the most features. Can you compare ${brand} vs ${competitor} and highlight their key features and capabilities?`,
  },
];

function DashboardContent() {
  // #region agent log
  if (typeof window !== 'undefined') {
    fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:34', message: 'DashboardContent render start', data: { timestamp: Date.now() }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
  }
  // #endregion
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [responses, setResponses] = useState<PersonaResponse[]>([]);
  const [analysis, setAnalysis] = useState<any>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamingPersona, setStreamingPersona] = useState<string | undefined>();
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [simulationData, setSimulationData] = useState<{
    brand: string;
    competitor: string;
    category: string;
  } | null>(null);

  // #region agent log
  if (typeof window !== 'undefined') {
    fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:48', message: 'Before useToast call', timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });
  }
  // #endregion
  const { addToast } = useToast();
  // #region agent log
  if (typeof window !== 'undefined') {
    fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:50', message: 'useToast success', data: { hasAddToast: !!addToast }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });
  }
  // #endregion

  // #region agent log
  if (typeof window !== 'undefined') {
    fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:55', message: 'Before useSettingsStore call', timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
  }
  // #endregion
  const {
    provider,
    openRouterApiKey,
    openRouterModel,
    localBaseUrl,
    localModelId,
  } = useSettingsStore();
  // #region agent log
  if (typeof window !== 'undefined') {
    fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:62', message: 'useSettingsStore success', data: { provider, hasApiKey: !!openRouterApiKey, model: openRouterModel }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
  }
  // #endregion

  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:68', message: 'Component mounted', data: { isClient: true }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });

    const errorHandler = (event: ErrorEvent) => {
      fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:71', message: 'Global error caught', data: { error: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno, stack: event.error?.stack }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
    };
    const unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
      fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:74', message: 'Unhandled promise rejection', data: { reason: event.reason?.toString(), stack: event.reason?.stack }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
    };
    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', unhandledRejectionHandler);
    return () => {
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', unhandledRejectionHandler);
    };
  }, []);
  // #endregion

  const handleRunSimulation = async (data: {
    brand: string;
    competitor: string;
    category: string;
  }) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:68', message: 'handleRunSimulation start', data: { brand: data.brand, competitor: data.competitor, category: data.category, provider }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
    // #endregion
    setSimulationData(data);
    setResponses([]);
    setAnalysis(null);
    setIsLoading(true);
    setStreaming(true);

    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:77', message: 'Before aiService.initialize', data: { provider, hasApiKey: !!openRouterApiKey, localBaseUrl, localModelId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
      // #endregion
      // Initialize AI service
      await aiService.initialize(provider, {
        openRouterApiKey,
        openRouterModel,
        localBaseUrl,
        localModelId,
      });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:85', message: 'aiService.initialize success', timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
      // #endregion

      const modelToUse =
        provider === "openrouter" ? openRouterModel : localModelId;

      // #region agent log
      if (typeof window !== 'undefined') {
        fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:100', message: 'Model selection', data: { provider, modelToUse, openRouterModel, localModelId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
      }
      // #endregion

      // Generate queries for each persona
      const queries = PERSONAS.map((persona) => ({
        persona: persona.name,
        query: persona.queryTemplate(data.brand, data.competitor, data.category),
      }));

      // Execute requests with rate limiting for OpenRouter
      // For local LLM, we can still do parallel
      const results: PersonaResponse[] = [];
      if (provider === "openrouter") {
        // Sequential execution with rate limiting
        for (const { persona, query } of queries) {
          try {
            await rateLimiter.waitForRateLimit();
            setStreamingPersona(persona);
            setStreamingContent("");

            const stream = await aiService.streamCompletion(query, modelToUse);
            const reader = stream.getReader();
            let fullContent = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              if (value) {
                fullContent = value.content;
                setStreamingContent(fullContent);
              }
            }

            reader.releaseLock();

            results.push({
              persona,
              query,
              response: fullContent,
            });
          } catch (error: any) {
            addToast({
              title: "Error",
              description: error.message || "Failed to get response",
              variant: "destructive",
            });
            results.push({
              persona,
              query,
              response: `Error: ${error.message}`,
            });
          }
        }
      } else {
        // For local LLM and Gemini, execute sequentially to avoid UI race conditions and resource contention
        for (const { persona, query } of queries) {
          try {
            setStreamingPersona(persona);
            setStreamingContent("");

            const stream = await aiService.streamCompletion(query, modelToUse);
            const reader = stream.getReader();
            let fullContent = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              if (value) {
                fullContent = value.content;
                setStreamingContent(fullContent);
              }
            }

            reader.releaseLock();

            // Push result and update state immediately so UI shows completed response
            const result = {
              persona,
              query,
              response: fullContent,
            };
            results.push(result);

            // Update responses state incrementally
            setResponses((prev) => [...prev, result]);
          } catch (error: any) {
            addToast({
              title: "Error",
              description: error.message || "Failed to get response",
              variant: "destructive",
            });
            const result = {
              persona,
              query,
              response: `Error: ${error.message}`,
            };
            results.push(result);
            setResponses((prev) => [...prev, result]);
          }
        }
      }

      setResponses(results);
      setStreaming(false);
      setStreamingPersona(undefined);
      setStreamingContent("");

      // Analyze results
      const analysisResult = analyzeResults(
        results,
        data.brand,
        data.competitor
      );
      setAnalysis(analysisResult);
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:149', message: 'handleRunSimulation error', data: { error: error?.message, stack: error?.stack, name: error?.name }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
      // #endregion
      addToast({
        title: "Simulation Failed",
        description: error.message || "An error occurred during simulation",
        variant: "destructive",
      });
      setStreaming(false);
      setStreamingPersona(undefined);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
              GEO Command Center
            </h1>
            <p className="text-muted-foreground mt-1">
              Bloomberg Terminal for Brand Visibility in AI
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setSettingsOpen(true)}
            className="glass"
          >
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Input */}
          <div className="lg:col-span-1">
            <WarRoomInput
              onRunSimulation={handleRunSimulation}
              isLoading={isLoading}
            />
          </div>

          {/* Right Column - Results */}
          <div className="lg:col-span-2 space-y-6">
            {(responses.length > 0 || streaming || isLoading) && (
              <>
                <WarRoomResults
                  responses={responses}
                  streaming={streaming}
                  streamingPersona={streamingPersona}
                  streamingContent={streamingContent}
                />
                {analysis && simulationData && (
                  <>
                    <WinRateChart
                      winRate={analysis.winRate}
                      brand={simulationData.brand}
                      competitor={simulationData.competitor}
                    />
                    <StrategyCard
                      analysis={analysis}
                      responses={responses}
                      brand={simulationData.brand}
                      competitor={simulationData.competitor}
                      category={simulationData.category}
                    />
                  </>
                )}
              </>
            )}
            {responses.length === 0 && !isLoading && !streaming && (
              <div className="glass rounded-lg p-12 text-center">
                <Zap className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">
                  Ready to Analyze
                </h3>
                <p className="text-sm text-muted-foreground">
                  Enter your brand, competitor, and category above to run a
                  simulation and see how you appear across AI models.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

export default function Page() {
  // #region agent log
  if (typeof window !== 'undefined') {
    fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:234', message: 'Page component render', data: { isClient: true }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
  }
  // #endregion
  return (
    <ToastProvider>
      <DashboardContent />
    </ToastProvider>
  );
}

