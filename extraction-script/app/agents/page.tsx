"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, Loader2, CheckCircle2, XCircle, Info, Settings, Play, Brain, Sparkles, RefreshCw, Cpu } from "lucide-react";
import LiveStreamPanel, { emptyStreamState, StreamState } from "@/components/LiveStreamPanel";
import LiveActivityPanel from "@/components/LiveActivityPanel";
import type { StreamEvent } from "@/shared/streaming";

interface AgentResponse {
  success: boolean;
  data?: {
    recognizedIntent?: {
      intent: string;
      confidence: number;
      entities: Array<{ type: string; value: string }>;
      context: string;
    };
    generatedInstructions?: Array<{
      id: string;
      action: string;
      target?: string;
      value?: string;
      reasoning?: string;
      priority?: string;
    }>;
    executed?: boolean;
    executionResult?: {
      success: boolean;
      executionResults?: Array<{
        success: boolean;
        instructionId: string;
        action: string;
        result?: any;
        error?: string;
      }>;
      finalContext?: {
        currentUrl: string;
        currentPageTitle: string;
      };
      message?: string;
      errors?: string[];
    };
    requiresClarification?: boolean;
    clarificationQuestions?: string[];
    finalResponse?: string;
  };
  error?: string;
}

export default function AgentsPage() {
  const [userInput, setUserInput] = useState("");
  const [autoExecute, setAutoExecute] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [primaryAgentUrl, setPrimaryAgentUrl] = useState("http://localhost:3001");
  const [history, setHistory] = useState<Array<{ input: string; response: AgentResponse; timestamp: Date }>>([]);
  const [stream, setStream] = useState<StreamState>(emptyStreamState());
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const modelsRequestId = useRef(0);

  const loadModels = async (agentUrl: string) => {
    const requestId = ++modelsRequestId.current;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch(`${agentUrl}/models`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      if (requestId !== modelsRequestId.current) return; // stale response
      const nextModels: string[] = payload.models || [];
      setModels(nextModels);
      setDefaultModel(payload.defaultModel || "");
      // Drop a saved selection that no longer exists in LM Studio.
      setSelectedModel((current) => {
        if (current && !nextModels.includes(current)) {
          if (typeof window !== "undefined") window.localStorage.removeItem("agent-model");
          return "";
        }
        return current;
      });
    } catch (error: any) {
      if (requestId !== modelsRequestId.current) return; // stale response
      setModels([]);
      setDefaultModel("");
      setModelsError(error.message || "Failed to load models");
    } finally {
      if (requestId === modelsRequestId.current) setModelsLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("agent-model");
    if (saved) setSelectedModel(saved);
  }, []);

  useEffect(() => {
    // Debounce so typing in the Agent URL field does not fire a request per keystroke.
    const timer = setTimeout(() => loadModels(primaryAgentUrl), 500);
    return () => clearTimeout(timer);
  }, [primaryAgentUrl]);

  const handleModelChange = (value: string) => {
    setSelectedModel(value);
    if (typeof window !== "undefined") {
      if (value) window.localStorage.setItem("agent-model", value);
      else window.localStorage.removeItem("agent-model");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isLoading) return;

    setIsLoading(true);
    setResponse(null);
    setStream(emptyStreamState());

    const applyEvent = (event: StreamEvent) => {
      setStream((prev) => {
        const next: StreamState = {
          ...prev,
          phases: { ...prev.phases },
          liveText: { ...prev.liveText },
          thinkingByPhase: { ...prev.thinkingByPhase },
          tokensByPhase: { ...prev.tokensByPhase },
        };

        if (event.type === "phase" && event.phase) {
          const phase = event.phase;
          if (event.status === "started") {
            next.phases[phase] = "started";
            next.currentPhase = phase;
            next.progress = 0;
            next.etaDeadline = event.etaMs != null ? Date.now() + event.etaMs : null;
            next.overallEtaDeadline = event.overallEtaMs != null ? Date.now() + event.overallEtaMs : null;
          } else if (event.status === "done") {
            next.phases[phase] = "done";
            if (next.currentPhase === phase) next.currentPhase = null;
            if (event.tokens != null) next.tokensByPhase[phase] = event.tokens;
            next.progress = 1;
            next.etaDeadline = null;
            next.overallEtaDeadline = null;
          }
        } else if (event.type === "token" && event.phase) {
          const phase = event.phase;
          next.phases[phase] = next.phases[phase] || "started";
          next.currentPhase = phase;
          next.liveText[phase] = (next.liveText[phase] || "") + (event.text || "");
          next.tokensByPhase[phase] = event.tokens ?? (next.tokensByPhase[phase] || 0) + 1;
          next.tokensPerSec = event.tokensPerSec ?? next.tokensPerSec;
          next.progress = event.progress ?? next.progress;
          next.etaDeadline = event.etaMs != null ? Date.now() + event.etaMs : null;
          next.overallEtaDeadline = event.overallEtaMs != null ? Date.now() + event.overallEtaMs : null;
        } else if (event.type === "thinking" && event.phase) {
          const phase = event.phase;
          next.phases[phase] = next.phases[phase] || "started";
          next.currentPhase = phase;
          next.thinkingByPhase[phase] = (next.thinkingByPhase[phase] || "") + (event.text || "");
          next.tokensPerSec = event.tokensPerSec ?? next.tokensPerSec;
          next.progress = event.progress ?? next.progress;
          next.etaDeadline = event.etaMs != null ? Date.now() + event.etaMs : null;
          next.overallEtaDeadline = event.overallEtaMs != null ? Date.now() + event.overallEtaMs : null;
        }

        return next;
      });
    };

    try {
      const response = await fetch(`${primaryAgentUrl}/process/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userInput: userInput.trim(),
          autoExecute,
          ...((selectedModel || defaultModel)
            ? {
                config: { model: selectedModel || defaultModel },
                secondaryConfig: { model: selectedModel || defaultModel },
              }
            : {}),
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to process request");
      }

      if (!response.body) {
        throw new Error("Streaming is not supported by this browser");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalData: AgentResponse | null = null;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const dataLine = part.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }

          if (event.type === "done") {
            finalData = { success: true, data: event.data };
          } else if (event.type === "error") {
            streamError = event.error || "An error occurred";
          } else {
            applyEvent(event);
          }
        }
      }

      if (streamError) {
        setResponse({ success: false, error: streamError });
      } else if (finalData) {
        setResponse(finalData);
        setHistory((prev) => [
          { input: userInput, response: finalData, timestamp: new Date() },
          ...prev.slice(0, 9), // Keep last 10 items
        ]);
        setUserInput(""); // Clear input after successful submission
      } else {
        setResponse({ success: false, error: "Stream ended without a result" });
      }
    } catch (error: any) {
      setResponse({
        success: false,
        error: error.message || "An error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const clearHistory = async () => {
    try {
      await fetch(`${primaryAgentUrl}/clear-history`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      setHistory([]);
    } catch (error) {
      console.error("Failed to clear history:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <Brain className="w-10 h-10 text-blue-400" />
            Agent Portal
          </h1>
          <p className="text-zinc-400">
            Interact with the Primary Agent to process natural language instructions
          </p>
        </div>

        {/* Settings Card */}
        <Card className="mb-6 bg-zinc-800/50 border-zinc-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Settings className="w-5 h-5" />
              Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Label htmlFor="agent-url" className="text-zinc-300 w-32">
                Agent URL:
              </Label>
              <Input
                id="agent-url"
                value={primaryAgentUrl}
                onChange={(e) => setPrimaryAgentUrl(e.target.value)}
                className="flex-1 bg-zinc-700 border-zinc-600 text-white"
                placeholder="http://localhost:3001"
              />
            </div>
            <div className="flex items-center gap-4">
              <Label htmlFor="model" className="text-zinc-300 w-32 flex items-center gap-2">
                <Cpu className="w-4 h-4" />
                Model:
              </Label>
              <select
                id="model"
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={modelsLoading}
                className="flex-1 bg-zinc-700 border border-zinc-600 text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <option value="">
                  {modelsLoading
                    ? "Loading models..."
                    : defaultModel
                      ? `Default (${defaultModel})`
                      : "Default (server model)"}
                </option>
                {selectedModel && !models.includes(selectedModel) && (
                  <option value={selectedModel}>{selectedModel} (not listed)</option>
                )}
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                onClick={() => loadModels(primaryAgentUrl)}
                disabled={modelsLoading}
                className="border-zinc-600 text-zinc-300 hover:bg-zinc-700"
                title="Refresh model list from LM Studio"
              >
                <RefreshCw className={`w-4 h-4 ${modelsLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            {modelsError ? (
              <p className="text-xs text-red-400 pl-36">
                Could not list LM Studio models: {modelsError}
              </p>
            ) : models.length > 0 ? (
              <p className="text-xs text-zinc-500 pl-36">
                {models.length} model{models.length === 1 ? "" : "s"} available in LM Studio
              </p>
            ) : null}
            <div className="flex items-center gap-4">
              <Label htmlFor="auto-execute" className="text-zinc-300 flex-1">
                Auto-execute instructions via Secondary Agent
              </Label>
              <Switch
                id="auto-execute"
                checked={autoExecute}
                onCheckedChange={setAutoExecute}
              />
            </div>
            {history.length > 0 && (
              <Button
                onClick={clearHistory}
                variant="outline"
                className="w-full border-zinc-600 text-zinc-300 hover:bg-zinc-700"
              >
                Clear History
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Card */}
          <Card className="bg-zinc-800/50 border-zinc-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Send className="w-5 h-5" />
                Enter Instructions
              </CardTitle>
              <CardDescription className="text-zinc-400">
                Type your natural language instructions (e.g., "Navigate to google.com", "Click on the search button")
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <textarea
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="Enter your instructions here..."
                    className="w-full min-h-[150px] p-3 bg-zinc-700 border border-zinc-600 rounded-md text-white placeholder-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isLoading}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!userInput.trim() || isLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Response Card */}
          <Card className="bg-zinc-800/50 border-zinc-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                {response?.success ? (
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                ) : response ? (
                  <XCircle className="w-5 h-5 text-red-400" />
                ) : (
                  <Info className="w-5 h-5" />
                )}
                Response
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <LiveStreamPanel stream={stream} />
              ) : !response ? (
                <p className="text-zinc-400 text-center py-8">
                  Enter instructions and click Send to see the response
                </p>
              ) : response.error ? (
                <div className="space-y-2">
                  <p className="text-red-400 font-semibold">Error:</p>
                  <p className="text-red-300">{response.error}</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px] pr-4">
                  {response.data?.finalResponse && (
                    <div className="mb-4 rounded-md border border-blue-700/60 bg-blue-900/20 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4 text-blue-300" />
                        <span className="text-blue-200 font-semibold text-sm">Answer</span>
                      </div>
                      <p className="text-zinc-100 whitespace-pre-wrap leading-relaxed">
                        {response.data.finalResponse}
                      </p>
                    </div>
                  )}
                  <Tabs defaultValue="intent" className="w-full">
                    <TabsList className="grid w-full grid-cols-3 bg-zinc-700">
                      <TabsTrigger value="intent">Intent</TabsTrigger>
                      <TabsTrigger value="instructions">Instructions</TabsTrigger>
                      <TabsTrigger value="execution">Execution</TabsTrigger>
                    </TabsList>

                    {/* Intent Tab */}
                    <TabsContent value="intent" className="mt-4 space-y-4">
                      {response.data?.recognizedIntent && (
                        <div className="space-y-3">
                          <div>
                            <Label className="text-zinc-300">Intent:</Label>
                            <Badge className="ml-2 bg-blue-600">{response.data.recognizedIntent.intent}</Badge>
                          </div>
                          <div>
                            <Label className="text-zinc-300">Confidence:</Label>
                            <span className="ml-2 text-white">
                              {(response.data.recognizedIntent.confidence * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div>
                            <Label className="text-zinc-300">Context:</Label>
                            <p className="mt-1 text-zinc-200">{response.data.recognizedIntent.context}</p>
                          </div>
                          {response.data.recognizedIntent.entities.length > 0 && (
                            <div>
                              <Label className="text-zinc-300">Entities:</Label>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {response.data.recognizedIntent.entities.map((entity, idx) => (
                                  <Badge key={idx} variant="outline" className="border-zinc-600 text-zinc-300">
                                    {entity.type}: {entity.value}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {response.data.requiresClarification && (
                            <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded-md">
                              <Label className="text-yellow-300">Clarification Needed:</Label>
                              <ul className="mt-2 list-disc list-inside text-yellow-200 space-y-1">
                                {response.data.clarificationQuestions?.map((q, idx) => (
                                  <li key={idx}>{q}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </TabsContent>

                    {/* Instructions Tab */}
                    <TabsContent value="instructions" className="mt-4">
                      {response.data?.generatedInstructions && response.data.generatedInstructions.length > 0 ? (
                        <div className="space-y-3">
                          {response.data.generatedInstructions.map((instruction, idx) => (
                            <Card key={instruction.id || idx} className="bg-zinc-700/50 border-zinc-600">
                              <CardContent className="p-4 space-y-2">
                                <div className="flex items-center justify-between">
                                  <Badge className="bg-purple-600">{instruction.action}</Badge>
                                  {instruction.priority && (
                                    <Badge variant="outline" className="border-zinc-500 text-zinc-300">
                                      {instruction.priority}
                                    </Badge>
                                  )}
                                </div>
                                {instruction.target && (
                                  <div>
                                    <Label className="text-zinc-300 text-sm">Target:</Label>
                                    <p className="text-white text-sm font-mono">{instruction.target}</p>
                                  </div>
                                )}
                                {instruction.value && (
                                  <div>
                                    <Label className="text-zinc-300 text-sm">Value:</Label>
                                    <p className="text-white text-sm">{instruction.value}</p>
                                  </div>
                                )}
                                {instruction.reasoning && (
                                  <div>
                                    <Label className="text-zinc-300 text-sm">Reasoning:</Label>
                                    <p className="text-zinc-200 text-sm italic">{instruction.reasoning}</p>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      ) : (
                        <p className="text-zinc-400 text-center py-4">No instructions generated</p>
                      )}
                    </TabsContent>

                    {/* Execution Tab */}
                    <TabsContent value="execution" className="mt-4">
                      {response.data?.executed && response.data.executionResult ? (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2">
                            <Badge className={response.data.executionResult.success ? "bg-green-600" : "bg-red-600"}>
                              {response.data.executionResult.success ? "Success" : "Failed"}
                            </Badge>
                            <span className="text-zinc-300">{response.data.executionResult.message}</span>
                          </div>

                          {response.data.executionResult.finalContext && (
                            <Card className="bg-zinc-700/50 border-zinc-600">
                              <CardContent className="p-4 space-y-2">
                                <Label className="text-zinc-300">Final Context:</Label>
                                <div className="text-sm space-y-1">
                                  <p className="text-white">
                                    <span className="text-zinc-400">URL:</span> {response.data.executionResult.finalContext.currentUrl}
                                  </p>
                                  <p className="text-white">
                                    <span className="text-zinc-400">Title:</span> {response.data.executionResult.finalContext.currentPageTitle}
                                  </p>
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {response.data.executionResult.executionResults && (
                            <div className="space-y-2">
                              <Label className="text-zinc-300">Execution Results:</Label>
                              {response.data.executionResult.executionResults.map((result, idx) => (
                                <Card
                                  key={idx}
                                  className={`bg-zinc-700/50 border ${result.success ? "border-green-700" : "border-red-700"}`}
                                >
                                  <CardContent className="p-3">
                                    <div className="flex items-center justify-between mb-2">
                                      <Badge className={result.success ? "bg-green-600" : "bg-red-600"}>
                                        {result.action}
                                      </Badge>
                                      {result.success ? (
                                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                                      ) : (
                                        <XCircle className="w-4 h-4 text-red-400" />
                                      )}
                                    </div>
                                    {result.error && (
                                      <p className="text-red-300 text-sm mt-2">{result.error}</p>
                                    )}
                                    {result.result && (
                                      <pre className="text-xs text-zinc-300 mt-2 bg-zinc-800 p-2 rounded overflow-auto">
                                        {JSON.stringify(result.result, null, 2)}
                                      </pre>
                                    )}
                                  </CardContent>
                                </Card>
                              ))}
                            </div>
                          )}

                          {response.data.executionResult.errors && response.data.executionResult.errors.length > 0 && (
                            <div className="p-3 bg-red-900/30 border border-red-700 rounded-md">
                              <Label className="text-red-300">Errors:</Label>
                              <ul className="mt-2 list-disc list-inside text-red-200 space-y-1">
                                {response.data.executionResult.errors.map((error, idx) => (
                                  <li key={idx} className="text-sm">{error}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ) : response.data?.executed === false ? (
                        <p className="text-zinc-400 text-center py-4">
                          Instructions generated but not executed. Enable auto-execute to run instructions.
                        </p>
                      ) : (
                        <p className="text-zinc-400 text-center py-4">No execution results</p>
                      )}
                    </TabsContent>
                  </Tabs>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Live Server Activity */}
        <div className="mt-6">
          <LiveActivityPanel url={primaryAgentUrl} />
        </div>

        {/* History */}
        {history.length > 0 && (
          <Card className="mt-6 bg-zinc-800/50 border-zinc-700">
            <CardHeader>
              <CardTitle className="text-white">Recent History</CardTitle>
              <CardDescription className="text-zinc-400">Last 10 interactions</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px]">
                <div className="space-y-2">
                  {history.map((item, idx) => (
                    <Card key={idx} className="bg-zinc-700/50 border-zinc-600">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-white text-sm font-medium">{item.input}</p>
                            <p className="text-zinc-400 text-xs mt-1">
                              {item.timestamp.toLocaleTimeString()} - Intent: {item.response.data?.recognizedIntent?.intent || "N/A"}
                            </p>
                          </div>
                          <Badge className={item.response.success ? "bg-green-600" : "bg-red-600"}>
                            {item.response.success ? "Success" : "Failed"}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

