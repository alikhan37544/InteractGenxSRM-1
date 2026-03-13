"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Database, Brain, Sparkles, Clock, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface CachePopupProps {
  isVisible: boolean;
  data: {
    url: string;
    title: string;
    lastScrapedAt: string;
    aiEnrichmentStatus: 'none' | 'partial' | 'full';
    elementCount: number;
    enrichedElementCount: number;
    scrapeCount: number;
  } | null;
  onDismiss: () => void;
  onForceRefresh: () => void;
  onViewHistory: () => void;
}

export function CachePopup({ isVisible, data, onDismiss, onForceRefresh, onViewHistory }: CachePopupProps) {
  if (!data) return null;

  const enrichmentLabels = {
    none: { text: "Not Analyzed", color: "bg-neutral-600" },
    partial: { text: "Partially Analyzed", color: "bg-amber-600" },
    full: { text: "Fully Analyzed", color: "bg-emerald-600" }
  };

  const enrichmentInfo = enrichmentLabels[data.aiEnrichmentStatus];

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed top-4 right-4 z-50 max-w-md"
        >
          <div className="bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 border border-indigo-500/30 rounded-xl shadow-2xl shadow-indigo-500/20 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600/20 to-purple-600/20 px-4 py-3 flex items-center justify-between border-b border-indigo-500/20">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-indigo-400" />
                <span className="font-semibold text-white">Page in Memory</span>
              </div>
              <button
                onClick={onDismiss}
                className="text-neutral-400 hover:text-white transition-colors p-1 hover:bg-neutral-700 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
              {/* Title */}
              <div>
                <p className="text-sm text-neutral-400">Title</p>
                <p className="text-white font-medium truncate" title={data.title}>
                  {data.title}
                </p>
              </div>

              {/* URL */}
              <div>
                <p className="text-sm text-neutral-400">URL</p>
                <p className="text-indigo-400 text-sm font-mono truncate" title={data.url}>
                  {data.url}
                </p>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-2 pt-2">
                <div className="bg-neutral-800/50 rounded-lg p-2 text-center">
                  <div className="text-xl font-bold text-white">{data.elementCount}</div>
                  <div className="text-xs text-neutral-400">Elements</div>
                </div>
                <div className="bg-neutral-800/50 rounded-lg p-2 text-center">
                  <div className="text-xl font-bold text-emerald-400">{data.enrichedElementCount}</div>
                  <div className="text-xs text-neutral-400">AI Analyzed</div>
                </div>
                <div className="bg-neutral-800/50 rounded-lg p-2 text-center">
                  <div className="text-xl font-bold text-cyan-400">{data.scrapeCount}</div>
                  <div className="text-xs text-neutral-400">Scrapes</div>
                </div>
              </div>

              {/* Enrichment Status */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-purple-400" />
                  <span className="text-sm text-neutral-300">AI Status:</span>
                </div>
                <Badge className={`${enrichmentInfo.color} text-white text-xs`}>
                  {enrichmentInfo.text}
                </Badge>
              </div>

              {/* Last Scraped */}
              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <Clock className="w-4 h-4" />
                <span>Last scraped: {new Date(data.lastScrapedAt).toLocaleString()}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="px-4 pb-4 flex gap-2">
              <Button
                onClick={onViewHistory}
                variant="outline"
                size="sm"
                className="flex-1 border-neutral-700 hover:bg-neutral-800 text-neutral-300"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View History
              </Button>
              <Button
                onClick={onForceRefresh}
                size="sm"
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Force Refresh
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Dismissable Toast-style notification for quick feedback
export function CacheNotification({ isVisible, onDismiss, onViewDetails }: {
  isVisible: boolean;
  onDismiss: () => void;
  onViewDetails: () => void;
}) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 100 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-4 right-4 z-50"
        >
          <div className="bg-gradient-to-r from-indigo-900/90 to-purple-900/90 backdrop-blur-sm border border-indigo-500/30 rounded-lg shadow-xl px-4 py-3 flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <span className="text-white text-sm">This page is already in memory</span>
            <button
              onClick={onViewDetails}
              className="text-indigo-300 hover:text-white text-sm underline"
            >
              View
            </button>
            <button
              onClick={onDismiss}
              className="text-neutral-400 hover:text-white ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
