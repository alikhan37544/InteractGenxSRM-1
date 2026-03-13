"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, X, ExternalLink, Brain, Clock, Layers, Trash2, 
  ChevronLeft, ChevronRight, Filter, RefreshCw, Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface HistoryItem {
  url: string;
  title: string;
  lastScrapedAt: string;
  firstScrapedAt: string;
  aiEnrichmentStatus: 'none' | 'partial' | 'full';
  enrichedAt: string | null;
  elementCount: number;
  enrichedElementCount: number;
  scrapeCount: number;
  analysisInfo: { lastAnalysis: string; success: boolean } | null;
}

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPage: (url: string) => void;
}

export function HistoryPanel({ isOpen, onClose, onSelectPage }: HistoryPanelProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [enrichmentFilter, setEnrichmentFilter] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      params.set('page', page.toString());
      params.set('limit', '10');
      if (enrichmentFilter) params.set('enrichment', enrichmentFilter);

      const response = await fetch(`/api/history?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        setHistory(data.data.history);
        setTotalPages(data.data.pagination.totalPages);
      }
    } catch (error) {
      console.error("Failed to fetch history:", error);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, page, enrichmentFilter]);

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen, fetchHistory]);

  const enrichmentLabels = {
    none: { text: "Not Analyzed", color: "bg-neutral-600", textColor: "text-neutral-300" },
    partial: { text: "Partial", color: "bg-amber-600", textColor: "text-amber-300" },
    full: { text: "Full", color: "bg-emerald-600", textColor: "text-emerald-300" }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={onClose}
            onWheel={(e) => e.stopPropagation()}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-neutral-900 border-l border-neutral-800 z-50 flex flex-col overflow-hidden"
            onWheel={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900/95">
              <div className="flex items-center gap-3">
                <Clock className="w-6 h-6 text-indigo-400" />
                <h2 className="text-xl font-bold text-white">Scraping History</h2>
              </div>
              <button
                onClick={onClose}
                className="text-neutral-400 hover:text-white transition-colors p-2 hover:bg-neutral-800 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search & Filters */}
            <div className="p-4 border-b border-neutral-800 space-y-3 bg-neutral-900/95">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by URL or title..."
                  className="pl-10 bg-neutral-800 border-neutral-700 text-white placeholder-neutral-500 focus:border-indigo-500"
                />
              </div>

              {/* Filter Pills */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={() => setEnrichmentFilter(null)}
                  variant={enrichmentFilter === null ? "default" : "outline"}
                  size="sm"
                  className={enrichmentFilter === null ? "bg-indigo-600" : "border-neutral-700 text-neutral-400"}
                >
                  All
                </Button>
                <Button
                  onClick={() => setEnrichmentFilter('full')}
                  variant={enrichmentFilter === 'full' ? "default" : "outline"}
                  size="sm"
                  className={enrichmentFilter === 'full' ? "bg-emerald-600" : "border-neutral-700 text-neutral-400"}
                >
                  <Brain className="w-3 h-3 mr-1" />
                  Fully Analyzed
                </Button>
                <Button
                  onClick={() => setEnrichmentFilter('partial')}
                  variant={enrichmentFilter === 'partial' ? "default" : "outline"}
                  size="sm"
                  className={enrichmentFilter === 'partial' ? "bg-amber-600" : "border-neutral-700 text-neutral-400"}
                >
                  Partial
                </Button>
                <Button
                  onClick={() => setEnrichmentFilter('none')}
                  variant={enrichmentFilter === 'none' ? "default" : "outline"}
                  size="sm"
                  className={enrichmentFilter === 'none' ? "bg-neutral-600" : "border-neutral-700 text-neutral-400"}
                >
                  Not Analyzed
                </Button>
              </div>
            </div>

            {/* History List */}
            <ScrollArea className="flex-1 h-0">
              <div className="p-4 space-y-3">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                  </div>
                ) : history.length === 0 ? (
                  <div className="text-center py-12 text-neutral-500">
                    <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No scraping history found</p>
                  </div>
                ) : (
                  history.map((item, index) => (
                    <motion.div
                      key={item.url}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card className="bg-neutral-800/50 border-neutral-700 hover:border-indigo-500/50 transition-all cursor-pointer group"
                        onClick={() => onSelectPage(item.url)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              {/* Title */}
                              <h3 className="font-medium text-white truncate group-hover:text-indigo-400 transition-colors" title={item.title}>
                                {item.title}
                              </h3>
                              
                              {/* URL */}
                              <p className="text-sm text-neutral-500 font-mono truncate mt-1" title={item.url}>
                                {item.url}
                              </p>

                              {/* Stats Row */}
                              <div className="flex items-center gap-4 mt-3 text-xs">
                                <div className="flex items-center gap-1 text-neutral-400">
                                  <Layers className="w-3 h-3" />
                                  <span>{item.elementCount} elements</span>
                                </div>
                                <div className="flex items-center gap-1 text-emerald-400">
                                  <Brain className="w-3 h-3" />
                                  <span>{item.enrichedElementCount} analyzed</span>
                                </div>
                                <div className="flex items-center gap-1 text-neutral-400">
                                  <RefreshCw className="w-3 h-3" />
                                  <span>{item.scrapeCount}x scraped</span>
                                </div>
                              </div>

                              {/* Timestamp */}
                              <div className="flex items-center gap-1 text-xs text-neutral-500 mt-2">
                                <Clock className="w-3 h-3" />
                                <span>Last: {new Date(item.lastScrapedAt).toLocaleString()}</span>
                              </div>
                            </div>

                            {/* Actions & Status */}
                            <div className="flex flex-col items-end gap-2">
                              <Badge className={`${enrichmentLabels[item.aiEnrichmentStatus].color} text-white text-xs`}>
                                {enrichmentLabels[item.aiEnrichmentStatus].text}
                              </Badge>
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(item.url, '_blank');
                                }}
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-neutral-400 hover:text-white hover:bg-neutral-700"
                              >
                                <Globe className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))
                )}
              </div>
            </ScrollArea>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-4 border-t border-neutral-800 flex items-center justify-center gap-4 bg-neutral-900/95">
                <Button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  variant="outline"
                  size="sm"
                  className="border-neutral-700 text-neutral-400"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-neutral-400">
                  Page {page} of {totalPages}
                </span>
                <Button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  variant="outline"
                  size="sm"
                  className="border-neutral-700 text-neutral-400"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
