"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Radio, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface LogLine {
  id: number;
  text: string;
}

const MAX_LINES = 200;

export default function LiveActivityPanel({ url }: { url: string }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  useEffect(() => {
    setLines([]);
    setConnected(false);
    const source = new EventSource(`${url}/activity`);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "log") {
          idRef.current += 1;
          setLines((prev) => {
            const next = [...prev, { id: idRef.current, text: payload.text }];
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
          });
        }
      } catch {
        // ignore malformed events
      }
    };

    return () => source.close();
  }, [url]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <Card className="bg-zinc-800/50 border-zinc-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-white text-sm flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          Live Server Activity
          <Badge
            className={`ml-auto ${connected ? "bg-green-600" : "bg-red-600"}`}
          >
            <Radio className="w-3 h-3 mr-1" />
            {connected ? "Live" : "Reconnecting..."}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div
          ref={scrollRef}
          className="h-[160px] overflow-y-auto p-3 font-mono text-[11px] leading-relaxed bg-black/30"
        >
          {lines.length === 0 ? (
            <p className="text-zinc-600 italic">Waiting for server activity...</p>
          ) : (
            lines.map((line) => (
              <p key={line.id} className="text-zinc-400 whitespace-pre-wrap break-words">
                {line.text}
              </p>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}