"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, Terminal, Clock, Zap, Brain, ChevronDown } from "lucide-react";
import { PHASE_LABELS, formatEta, StreamPhase } from "@/shared/streaming";

const PHASE_ORDER: StreamPhase[] = [
  "intent_recognition",
  "instruction_generation",
  "execution",
  "selector_resolution",
  "response_synthesis",
];

export interface StreamState {
  phases: Partial<Record<StreamPhase, "started" | "done">>;
  currentPhase: StreamPhase | null;
  liveText: Partial<Record<StreamPhase, string>>;
  thinkingByPhase: Partial<Record<StreamPhase, string>>;
  etaDeadline: number | null;
  overallEtaDeadline: number | null;
  tokensPerSec: number | null;
  progress: number;
  tokensByPhase: Partial<Record<StreamPhase, number>>;
}

export const emptyStreamState = (): StreamState => ({
  phases: {},
  currentPhase: null,
  liveText: {},
  thinkingByPhase: {},
  etaDeadline: null,
  overallEtaDeadline: null,
  tokensPerSec: null,
  progress: 0,
  tokensByPhase: {},
});

export default function LiveStreamPanel({ stream }: { stream: StreamState }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  const [showThinking, setShowThinking] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [stream.liveText, stream.currentPhase]);

  useEffect(() => {
    if (thinkingScrollRef.current) {
      thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight;
    }
  }, [stream.thinkingByPhase]);

  const activePhases = PHASE_ORDER.filter((phase) => stream.phases[phase]);
  const currentLabel = stream.currentPhase ? PHASE_LABELS[stream.currentPhase] : null;
  const currentText = stream.currentPhase ? stream.liveText[stream.currentPhase] || "" : "";
  // Show the thinking stream of the most recent phase that produced reasoning.
  const thinkingPhase = [...PHASE_ORDER].reverse().find((phase) => stream.thinkingByPhase[phase]);
  const currentThinking = thinkingPhase ? stream.thinkingByPhase[thinkingPhase] || "" : "";
  const thinkingActive =
    thinkingPhase != null && stream.phases[thinkingPhase] === "started";
  const etaRemaining = stream.etaDeadline ? Math.max(0, stream.etaDeadline - now) : null;
  const overallRemaining = stream.overallEtaDeadline
    ? Math.max(0, stream.overallEtaDeadline - now)
    : null;

  return (
    <div className="space-y-4">
      {/* Phase Status */}
      <Card className="bg-zinc-700/50 border-zinc-600">
        <CardHeader className="pb-3">
          <CardTitle className="text-white text-sm flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            Live Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {activePhases.map((phase) => {
              const status = stream.phases[phase];
              const done = status === "done";
              const active = !done && stream.currentPhase === phase;
              return (
                <Badge
                  key={phase}
                  className={
                    done
                      ? "bg-green-600/20 text-green-400 border border-green-600"
                      : active
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-700 text-zinc-300 border border-zinc-600"
                  }
                >
                  {done ? (
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                  ) : active ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  {PHASE_LABELS[phase]}
                  {done && stream.tokensByPhase[phase] ? (
                    <span className="ml-1 opacity-70">({stream.tokensByPhase[phase]} tok)</span>
                  ) : null}
                </Badge>
              );
            })}
          </div>

          {/* Current Phase Summary */}
          {stream.currentPhase && stream.phases[stream.currentPhase] !== "done" && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-300">
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-zinc-400">Phase ETA:</span>
                <span className="font-mono text-white">{formatEta(etaRemaining)}</span>
              </span>
              {overallRemaining !== null && (
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-emerald-400" />
                  <span className="text-zinc-400">Overall ETA:</span>
                  <span className="font-mono text-white">{formatEta(overallRemaining)}</span>
                </span>
              )}
              {stream.tokensPerSec !== null && (
                <span className="flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  <span className="text-zinc-400">Speed:</span>
                  <span className="font-mono text-white">{stream.tokensPerSec.toFixed(1)} tok/s</span>
                </span>
              )}
            </div>
          )}

          {/* Progress Bar */}
          {stream.currentPhase && stream.phases[stream.currentPhase] !== "done" && (
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-300"
                style={{ width: `${Math.max(2, Math.round(stream.progress * 100))}%` }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Collapsible Thinking Stream */}
      {currentThinking && (
        <Card className="bg-zinc-900/70 border-zinc-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowThinking((s) => !s)}
                className="flex items-center gap-2 flex-1 text-left group"
              >
                <Brain className="w-4 h-4 text-amber-400" />
                <span>Thinking</span>
                {thinkingActive ? (
                  <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                ) : (
                  <CheckCircle2 className="w-3 h-3 text-green-400" />
                )}
                {thinkingPhase && (
                  <span className="text-zinc-400 font-normal">
                    {PHASE_LABELS[thinkingPhase]} · {currentThinking.split(/\s+/).filter(Boolean).length} tok
                  </span>
                )}
                <ChevronDown
                  className={`w-4 h-4 ml-auto transition-transform ${showThinking ? "rotate-180" : ""}`}
                />
              </button>
            </CardTitle>
          </CardHeader>
          {showThinking && (
            <CardContent className="p-0">
              <div
                ref={thinkingScrollRef}
                className="h-[180px] overflow-y-auto p-4 font-mono text-xs leading-relaxed bg-zinc-950/60"
              >
                <p className="text-amber-200/90 whitespace-pre-wrap break-words italic">
                  {currentThinking}
                </p>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Live Token Output */}
      <Card className="bg-zinc-800/70 border-zinc-600">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-sm flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500" />
            </span>
            Live Model Output
            {currentLabel && <span className="text-zinc-400 font-normal">— {currentLabel}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={scrollRef}
            className="h-[240px] overflow-y-auto p-4 font-mono text-xs leading-relaxed"
          >
            {currentText ? (
              <p className="text-emerald-200 whitespace-pre-wrap break-words">{currentText}</p>
            ) : (
              <p className="text-zinc-600 italic">Waiting for model output...</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}