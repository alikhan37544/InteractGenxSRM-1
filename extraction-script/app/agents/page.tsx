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
import { Send, Loader2, CheckCircle2, XCircle, Info, Settings, Play, Brain, Sparkles, RefreshCw, Cpu, Square, Camera, Globe, Search, ExternalLink, Power, MessageSquare, Plus, Trash2, AlertTriangle } from "lucide-react";
import LiveStreamPanel, { emptyStreamState, StreamState } from "@/components/LiveStreamPanel";
import LiveActivityPanel from "@/components/LiveActivityPanel";
import type { StreamEvent } from "@/shared/streaming";

interface AgentResponse {
  success: boolean;
  stopped?: boolean;
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
    /** Screenshots of the final page that were shown to a vision model. */
    screenshots?: string[];
  };
  error?: string;
}

interface ChatTurn {
  input: string;
  response: AgentResponse;
  timestamp: number;
}

interface Chat {
  id: string;
  title: string;
  createdAt: number;
  turns: ChatTurn[];
}

export default function AgentsPage() {
  const [userInput, setUserInput] = useState("");
  const [autoExecute, setAutoExecute] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [primaryAgentUrl, setPrimaryAgentUrl] = useState("http://localhost:3001");
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [captchaNotice, setCaptchaNotice] = useState<{ active: boolean; message: string } | null>(null);
  const [stream, setStream] = useState<StreamState>(emptyStreamState());
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadedModel, setLoadedModel] = useState<string | null>(null);
  const [loadedModels, setLoadedModels] = useState<string[]>([]);
  const [visionModels, setVisionModels] = useState<string[]>([]);
  const [browserUrl, setBrowserUrl] = useState("");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserTitle, setBrowserTitle] = useState("");
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserMessage, setBrowserMessage] = useState<string | null>(null);
  const modelsRequestId = useRef(0);
  const streamAbortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);

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
      setLoadedModel(payload.loadedModel || null);
      setLoadedModels(payload.loadedModels || []);
      setVisionModels(payload.visionModels || []);
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
      setLoadedModel(null);
      setLoadedModels([]);
      setVisionModels([]);
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

  // --- Chats (independent conversation histories) -------------------------

  const activeChat = chats.find((c) => c.id === activeChatId) || null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem("agent-chats");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setChats(parsed);
          const savedActive = window.localStorage.getItem("agent-active-chat");
          const active = parsed.some((c: Chat) => c.id === savedActive) ? savedActive! : parsed[0].id;
          setActiveChatId(active);
          const chat = parsed.find((c: Chat) => c.id === active);
          if (chat && chat.turns.length > 0) setResponse(chat.turns[0].response);
          return;
        }
      }
    } catch {
      // ignore corrupt storage and start fresh
    }
    const fresh: Chat = { id: `chat_${Date.now()}`, title: "New chat", createdAt: Date.now(), turns: [] };
    setChats([fresh]);
    setActiveChatId(fresh.id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || chats.length === 0) return;
    try {
      // Never persist screenshots (hundreds of KB each) — they would blow the
      // localStorage quota after a few turns. They stay in memory for the
      // current session.
      const serializable = chats.map((chat) => ({
        ...chat,
        turns: chat.turns.map((turn) => {
          const shots = turn.response.data?.screenshots;
          if (!shots || shots.length === 0) return turn;
          return {
            ...turn,
            response: {
              ...turn.response,
              data: { ...turn.response.data, screenshots: undefined },
            },
          };
        }),
      }));
      window.localStorage.setItem("agent-chats", JSON.stringify(serializable));
    } catch {
      // storage full/unavailable — chats still work in memory
    }
  }, [chats]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeChatId) return;
    window.localStorage.setItem("agent-active-chat", activeChatId);
  }, [activeChatId]);

  const selectChat = (id: string) => {
    setActiveChatId(id);
    const chat = chats.find((c) => c.id === id);
    setResponse(chat && chat.turns.length > 0 ? chat.turns[0].response : null);
    setStream(emptyStreamState());
    setCaptchaNotice(null);
    stopRequestedRef.current = false;
  };

  const createChat = () => {
    const fresh: Chat = { id: `chat_${Date.now()}`, title: "New chat", createdAt: Date.now(), turns: [] };
    setChats((prev) => [fresh, ...prev]);
    setActiveChatId(fresh.id);
    setResponse(null);
    setStream(emptyStreamState());
    setCaptchaNotice(null);
    setUserInput("");
  };

  const deleteActiveChat = () => {
    const remaining = chats.filter((c) => c.id !== activeChatId);
    const next = remaining.length > 0
      ? remaining
      : [{ id: `chat_${Date.now()}`, title: "New chat", createdAt: Date.now(), turns: [] }];
    setChats(next);
    setActiveChatId(next[0].id);
    setResponse(next[0].turns.length > 0 ? next[0].turns[0].response : null);
    setStream(emptyStreamState());
    setCaptchaNotice(null);
  };

  const handleResume = async () => {
    try {
      await fetch(`${primaryAgentUrl}/resume`, { method: "POST" });
      setCaptchaNotice((prev) => (prev ? { ...prev, active: false, message: "Continuing..." } : prev));
    } catch {
      // the captcha polling will pick it up anyway
    }
  };

  const handleStopExecution = () => {
    stopRequestedRef.current = true;
    // Stop the server-side pipeline first (it also forwards to the secondary
    // agent so browser actions halt), then cut the local SSE connection.
    fetch(`${primaryAgentUrl}/stop`, { method: "POST" }).catch(() => {});
    streamAbortRef.current?.abort();
    setIsLoading(false);
    setResponse({ success: false, stopped: true, error: "Execution stopped by user" });
  };

  const refreshBrowserStatus = async (prefill = false) => {
    try {
      const res = await fetch(`${primaryAgentUrl}/browser/status`);
      const payload = await res.json().catch(() => ({}));
      if (!payload.success) return;
      setBrowserOpen(!!payload.open);
      setBrowserTitle(payload.title || "");
      // Prefill the URL field with the page the browser is on (only on first load,
      // so it never overwrites what the user is typing).
      if (prefill && payload.url && payload.url !== "about:blank") {
        setBrowserUrl(payload.url);
      }
    } catch {
      // secondary agent not reachable — leave the last known status
    }
  };

  useEffect(() => {
    refreshBrowserStatus(true);
    const timer = setInterval(() => refreshBrowserStatus(false), 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryAgentUrl]);

  const handleBrowserNavigate = async (mode: "url" | "search") => {
    const value = browserUrl.trim();
    if (!value || browserBusy) return;
    setBrowserBusy(true);
    setBrowserMessage(null);
    try {
      const res = await fetch(`${primaryAgentUrl}/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "search" ? { query: value } : { url: value }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      setBrowserOpen(true);
      setBrowserTitle(payload.title || "");
      if (payload.url) setBrowserUrl(payload.url);
      setBrowserMessage(`Loaded: ${payload.title || payload.url}`);
    } catch (error: any) {
      setBrowserMessage(`Failed: ${error.message || "navigation failed"}`);
    } finally {
      setBrowserBusy(false);
    }
  };

  const handleOpenBrowser = async () => {
    if (browserBusy) return;
    setBrowserBusy(true);
    setBrowserMessage(null);
    try {
      const res = await fetch(`${primaryAgentUrl}/browser/open`, { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      setBrowserOpen(true);
      if (payload.url && payload.url !== "about:blank") setBrowserUrl(payload.url);
      setBrowserMessage("Browser window opened");
    } catch (error: any) {
      setBrowserMessage(`Failed: ${error.message || "could not open browser"}`);
    } finally {
      setBrowserBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isLoading) return;

    stopRequestedRef.current = false;
    setIsLoading(true);
    setResponse(null);
    setStream(emptyStreamState());
    setCaptchaNotice(null);

    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    const chatIdForRequest = activeChatId;

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

      // Out-of-band notices (CAPTCHA appeared / solved) are handled outside the
      // stream state so they render as a banner.
      if (event.type === "notice") {
        const kind = event.noticeKind;
        const message = event.text || "";
        if (kind === "captcha") {
          setCaptchaNotice({ active: true, message: message || "A bot check appeared. Solve it in the browser window." });
        } else if (kind === "captcha_cleared") {
          setCaptchaNotice({ active: false, message: message || "Bot check solved — continuing." });
        } else if (kind === "captcha_timeout") {
          setCaptchaNotice({ active: false, message: message || "The bot check was not solved in time." });
        }
      }
    };

    try {
      const response = await fetch(`${primaryAgentUrl}/process/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: abortController.signal,
        body: JSON.stringify({
          userInput: userInput.trim(),
          autoExecute,
          chatId: chatIdForRequest,
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
        const turn: ChatTurn = { input: userInput, response: finalData, timestamp: Date.now() };
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === chatIdForRequest
              ? {
                  ...chat,
                  title: chat.turns.length === 0 ? userInput.trim().slice(0, 40) : chat.title,
                  turns: [turn, ...chat.turns].slice(0, 20),
                }
              : chat
          )
        );
        setUserInput(""); // Clear input after successful submission
      } else {
        setResponse({ success: false, error: "Stream ended without a result" });
      }
    } catch (error: any) {
      if (stopRequestedRef.current) {
        setResponse({
          success: false,
          stopped: true,
          error: "Execution stopped by user",
        });
      } else {
        setResponse({
          success: false,
          error: error.message || "An error occurred",
        });
      }
    } finally {
      streamAbortRef.current = null;
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
        body: JSON.stringify({ chatId: activeChatId }),
      });
      setChats((prev) =>
        prev.map((chat) => (chat.id === activeChatId ? { ...chat, turns: [] } : chat))
      );
      setResponse(null);
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
                    {loadedModels.includes(m) ? " (loaded)" : ""}
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
            {loadedModel ? (
              <div className="flex items-center gap-4">
                <Label className="text-zinc-300 w-32">Currently loaded:</Label>
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-green-300 font-mono text-sm">{loadedModel}</span>
                  {visionModels.includes(loadedModel) && (
                    <Badge className="bg-purple-600">
                      <Camera className="w-3 h-3 mr-1" />
                      Vision
                    </Badge>
                  )}
                </div>
              </div>
            ) : null}
            {modelsError ? (
              <p className="text-xs text-red-400 pl-36">
                Could not list LM Studio models: {modelsError}
              </p>
            ) : models.length > 0 ? (
              <p className="text-xs text-zinc-500 pl-36">
                {models.length} model{models.length === 1 ? "" : "s"} available in LM Studio
                {visionModels.length > 0 ? ` (${visionModels.length} vision-capable)` : ""}
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
            {(activeChat?.turns.length ?? 0) > 0 && (
              <Button
                onClick={clearHistory}
                variant="outline"
                className="w-full border-zinc-600 text-zinc-300 hover:bg-zinc-700"
              >
                Clear This Chat
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Browser Card */}
        <Card className="mb-6 bg-zinc-800/50 border-zinc-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Globe className="w-5 h-5" />
              Browser
              <Badge className={browserOpen ? "bg-green-600 ml-1" : "bg-zinc-600 ml-1"}>
                {browserOpen ? "Open" : "Closed"}
              </Badge>
            </CardTitle>
            <CardDescription className="text-zinc-400">
              Go to a URL or search the web directly. The browser reopens automatically if its window was closed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                value={browserUrl}
                onChange={(e) => setBrowserUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleBrowserNavigate("url");
                  }
                }}
                placeholder="https://example.com — or type a search query"
                className="flex-1 bg-zinc-700 border-zinc-600 text-white"
                disabled={browserBusy}
              />
              <Button
                type="button"
                onClick={() => handleBrowserNavigate("url")}
                disabled={browserBusy || !browserUrl.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                title="Navigate to this URL"
              >
                {browserBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                <span className="ml-2">Go</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleBrowserNavigate("search")}
                disabled={browserBusy || !browserUrl.trim()}
                className="border-zinc-600 text-zinc-300 hover:bg-zinc-700"
                title="Search DuckDuckGo for this text"
              >
                <Search className="w-4 h-4" />
                <span className="ml-2">Search</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleOpenBrowser}
                disabled={browserBusy}
                className="border-zinc-600 text-zinc-300 hover:bg-zinc-700"
                title="Open a browser window if none is running"
              >
                <Power className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-400 min-h-[16px]">
              <span>Current page:</span>
              <span className="font-mono text-zinc-300 truncate max-w-[60%]">
                {browserTitle || browserUrl || "—"}
              </span>
              {browserMessage && <span className="text-zinc-500 truncate">· {browserMessage}</span>}
            </div>
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
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-zinc-400 shrink-0" />
                  <select
                    value={activeChatId}
                    onChange={(e) => selectChat(e.target.value)}
                    disabled={isLoading}
                    className="flex-1 min-w-0 bg-zinc-700 border border-zinc-600 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    title="Switch chat — each chat has its own conversation history"
                  >
                    {chats.map((chat) => (
                      <option key={chat.id} value={chat.id}>
                        {chat.title} ({chat.turns.length})
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={createChat}
                    disabled={isLoading}
                    className="border-zinc-600 text-zinc-300 hover:bg-zinc-700"
                    title="Start a new chat"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={deleteActiveChat}
                    disabled={isLoading || chats.length <= 1}
                    className="border-zinc-600 text-zinc-300 hover:bg-zinc-700"
                    title="Delete this chat"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
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
                {isLoading && (
                  <Button
                    type="button"
                    onClick={handleStopExecution}
                    className="w-full bg-red-600 hover:bg-red-700 text-white"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    Stop Execution
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Response Card */}
          <Card className="bg-zinc-800/50 border-zinc-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                {response?.success ? (
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                ) : response?.stopped ? (
                  <Square className="w-5 h-5 text-red-400" />
                ) : response ? (
                  <XCircle className="w-5 h-5 text-red-400" />
                ) : (
                  <Info className="w-5 h-5" />
                )}
                Response
              </CardTitle>
            </CardHeader>
            <CardContent>
              {captchaNotice && (
                <div
                  className={`mb-4 rounded-md border p-3 ${
                    captchaNotice.active
                      ? "border-amber-600 bg-amber-900/30"
                      : "border-zinc-600 bg-zinc-700/40"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      className={`w-5 h-5 shrink-0 ${captchaNotice.active ? "text-amber-400" : "text-zinc-400"}`}
                    />
                    <div className="flex-1">
                      <p className="text-sm text-zinc-100">{captchaNotice.message}</p>
                      {captchaNotice.active && (
                        <div className="mt-2 flex gap-2">
                          <Button
                            type="button"
                            onClick={handleResume}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                          >
                            Continue
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setCaptchaNotice(null)}
                            className="border-zinc-600 text-zinc-300 hover:bg-zinc-700"
                          >
                            Dismiss
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {isLoading ? (
                <LiveStreamPanel stream={stream} />
              ) : !response ? (
                <p className="text-zinc-400 text-center py-8">
                  Enter instructions and click Send to see the response
                </p>
              ) : response.error ? (
                <div className="space-y-2">
                  <p className={response.stopped ? "text-red-400 font-semibold" : "text-red-400 font-semibold"}>
                    {response.stopped ? "Stopped:" : "Error:"}
                  </p>
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
                      {response.data.screenshots && response.data.screenshots.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs text-zinc-400 mb-1">
                            Page screenshots shown to the model ({response.data.screenshots.length}):
                          </p>
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {response.data.screenshots.map((shot, idx) => (
                              <a key={idx} href={shot} target="_blank" rel="noreferrer" className="shrink-0">
                                <img
                                  src={shot}
                                  alt={`Page screenshot ${idx + 1}`}
                                  className="h-24 rounded border border-zinc-600 hover:border-blue-400"
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
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

        {/* History for the active chat */}
        {(activeChat?.turns.length ?? 0) > 0 && (
          <Card className="mt-6 bg-zinc-800/50 border-zinc-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                {activeChat?.title || "Chat"}
              </CardTitle>
              <CardDescription className="text-zinc-400">
                {activeChat?.turns.length} interaction{(activeChat?.turns.length ?? 0) === 1 ? "" : "s"} in this chat
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px]">
                <div className="space-y-2">
                  {activeChat?.turns.map((item, idx) => (
                    <Card key={idx} className="bg-zinc-700/50 border-zinc-600">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">{item.input}</p>
                            {item.response.data?.finalResponse && (
                              <p className="text-zinc-300 text-xs mt-1 line-clamp-2">
                                {item.response.data.finalResponse}
                              </p>
                            )}
                            <p className="text-zinc-400 text-xs mt-1">
                              {new Date(item.timestamp).toLocaleTimeString()} - Intent: {item.response.data?.recognizedIntent?.intent || "N/A"}
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

