"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";
import { Loader2, CheckCircle2 } from "lucide-react";
import type { PersonaResponse } from "@/lib/analysis-engine";

interface WarRoomResultsProps {
  responses: PersonaResponse[];
  streaming: boolean;
  streamingPersona?: string;
  streamingContent?: string;
}

export function WarRoomResults({
  responses,
  streaming,
  streamingPersona,
  streamingContent,
}: WarRoomResultsProps) {
  const personas = [
    "The Skeptical CTO",
    "The Budget Buyer",
    "The Feature Hunter",
  ];

  const getPersonaIcon = (persona: string) => {
    if (persona.includes("CTO")) return "🔒";
    if (persona.includes("Budget")) return "💰";
    if (persona.includes("Feature")) return "🔍";
    return "👤";
  };

  return (
    <div className="space-y-4">
      <Card className="glass">
        <CardHeader>
          <CardTitle>AI Responses by Persona</CardTitle>
          <CardDescription>
            Real-time streaming responses from the selected AI provider
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {personas.map((persona) => {
              const response = responses.find((r) => r.persona === persona);
              const isStreaming = streaming && streamingPersona === persona;
              const displayContent = isStreaming
                ? streamingContent || ""
                : response?.response || "";

              return (
                <div key={persona} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2">
                      <span>{getPersonaIcon(persona)}</span>
                      {persona}
                    </h3>
                    {isStreaming ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : response ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : null}
                  </div>
                  {isStreaming && (
                    <Progress value={66} className="h-1" />
                  )}
                  <div className="glass rounded-lg p-4 min-h-[100px]">
                    {displayContent ? (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {displayContent}
                        {isStreaming && (
                          <span className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse" />
                        )}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        Waiting for response...
                      </p>
                    )}
                  </div>
                  {response?.query && (
                    <p className="text-xs text-muted-foreground italic">
                      Query: &quot;{response.query}&quot;
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {responses.length > 0 && (
        <Card className="glass">
          <CardHeader>
            <CardTitle>Side-by-Side Comparison</CardTitle>
            <CardDescription>
              Compare how each brand appears in the responses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left p-2">Persona</th>
                    <th className="text-left p-2">Response Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((response) => (
                    <tr key={response.persona} className="border-b border-zinc-800/50">
                      <td className="p-2 font-medium">{response.persona}</td>
                      <td className="p-2 text-muted-foreground">
                        {response.response.substring(0, 200)}
                        {response.response.length > 200 && "..."}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

