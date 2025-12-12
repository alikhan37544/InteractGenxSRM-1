"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Play, Download, Terminal, Layers, Code, FileJson, Sparkles } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion, AnimatePresence } from "framer-motion";

interface ExtractedElement {
  type: string;
  content: { text: string; placeholder: string | null };
  selectors: { css: string; xpath: string; id: string | null };
  attributes: { href: string | null; src: string | null; name: string | null };
  geometry: { x: number; y: number };
}

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [isHeadless, setIsHeadless] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [elements, setElements] = useState<ExtractedElement[]>([]);
  const [activeTab, setActiveTab] = useState("table");

  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), message, type }]);
  };

  const handleExtract = async () => {
    if (!url) {
      addLog("Please enter a valid URL", "error");
      return;
    }

    setIsExtracting(true);
    setLogs([]);
    setElements([]);
    addLog(`Starting extraction for ${url}...`);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, headless: isHeadless }),
      });

      if (!response.body) {
        throw new Error("No response body");
      }

      const data = await response.json();

      if (data.error) throw new Error(data.error);

      setElements(data.elements);
      addLog(`Extraction complete. Found ${data.elements.length} elements.`, "success");

    } catch (error: any) {
      addLog(`Extraction failed: ${error.message}`, "error");
    } finally {
      setIsExtracting(false);
    }
  };

  const downloadJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ meta: { source_url: url, timestamp: new Date().toISOString() }, elements }, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "extracted_elements.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    addLog("JSON downloaded.", "success");
  };

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, staggerChildren: 0.1 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 p-8 font-sans selection:bg-indigo-500/30 overflow-x-hidden">
      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="max-w-6xl mx-auto space-y-8"
      >

        {/* Header */}
        <motion.header variants={itemVariants} className="flex items-center justify-between border-b border-neutral-800 pb-6 relative">
          <div className="absolute top-0 left-0 w-32 h-32 bg-indigo-500/10 blur-[50px] rounded-full pointer-events-none -z-10" />
          <div className="space-y-1">
            <h1 className="text-4xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                DOM Extractor
              </span>
            </h1>
            <p className="text-neutral-400 font-light">Automated content extraction & schema mapping engine</p>
          </div>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button variant="outline" className="border-neutral-700 hover:bg-neutral-800 hover:text-indigo-400 transition-colors" onClick={() => window.open('https://github.com', '_blank')}>
              <Code className="w-4 h-4 mr-2" />
              Documentation
            </Button>
          </motion.div>
        </motion.header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Left Column: Controls & Logs */}
          <div className="space-y-6 lg:col-span-1">
            {/* Control Panel */}
            <motion.div variants={itemVariants}>
              <Card className="bg-neutral-900/40 border-neutral-800 backdrop-blur-md shadow-2xl hover:shadow-indigo-500/10 transition-shadow duration-300">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Layers className="w-5 h-5 text-indigo-400" />
                    Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="url" className="text-neutral-300">Target URL</Label>
                    <div className="relative group">
                      <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-cyan-500 rounded-lg blur opacity-0 group-hover:opacity-30 transition duration-500"></div>
                      <Input
                        id="url"
                        placeholder="https://example.com"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        // FIX: Added text-neutral-50 explicitly and adjusted placeholder color
                        className="relative bg-neutral-950 border-neutral-800 text-neutral-50 placeholder:text-neutral-600 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 transition-all font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-neutral-950/50 border border-neutral-800/50 hover:border-neutral-700/50 transition-colors">
                    <Label htmlFor="headless" className="text-sm font-medium text-neutral-400 cursor-pointer">Headless Mode</Label>
                    <Switch
                      id="headless"
                      checked={isHeadless}
                      onCheckedChange={setIsHeadless}
                      className="data-[state=checked]:bg-indigo-500"
                    />
                  </div>

                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Button
                      className="w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20 font-semibold tracking-wide"
                      size="lg"
                      onClick={handleExtract}
                      disabled={isExtracting}
                    >
                      {isExtracting ? (
                        <div className="flex items-center gap-2">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                          />
                          Processing...
                        </div>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Start Extraction
                        </>
                      )}
                    </Button>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Live Logs */}
            <motion.div variants={itemVariants}>
              <Card className="bg-neutral-900/40 border-neutral-800 backdrop-blur-md h-[400px] flex flex-col shadow-2xl overflow-hidden relative group">
                <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/5 to-transparent pointer-events-none" />
                <CardHeader className="pb-3 border-b border-neutral-800/50">
                  <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-neutral-400">
                    <Terminal className="w-4 h-4 text-cyan-500" />
                    Live Logs
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <ScrollArea className="h-full p-4">
                    <div className="space-y-3 font-mono text-xs">
                      <AnimatePresence initial={false}>
                        {logs.length === 0 && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-neutral-600 italic text-center mt-10"
                          >
                            Waiting for input...
                          </motion.div>
                        )}
                        {logs.map((log, i) => (
                          <motion.div
                            key={`log-${i}`}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.2 }}
                            className="flex gap-3 group/log"
                          >
                            <span className="text-neutral-600 select-none group-hover/log:text-neutral-500 transition-colors">
                              {log.timestamp}
                            </span>
                            <span className={
                              log.type === 'error' ? 'text-red-400 font-bold' :
                                log.type === 'success' ? 'text-emerald-400 font-bold' :
                                  'text-neutral-300'
                            }>
                              {log.message}
                            </span>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Right Column: Results */}
          <motion.div variants={itemVariants} className="lg:col-span-2 h-full">
            <Card className="bg-neutral-900/40 border-neutral-800 backdrop-blur-md min-h-[600px] flex flex-col shadow-2xl h-full">
              <CardHeader className="pb-3 border-b border-neutral-800/50 flex flex-row items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileJson className="w-5 h-5 text-emerald-400" />
                    Extraction Results
                  </CardTitle>
                  <CardDescription className="text-neutral-400">
                    {elements.length > 0
                      ? `${elements.length} elements mapped to schema`
                      : "No data extracted yet"}
                  </CardDescription>
                </div>
                <AnimatePresence>
                  {elements.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                    >
                      <Button variant="secondary" size="sm" onClick={downloadJson} className="hover:bg-indigo-500 hover:text-white transition-colors">
                        <Download className="w-4 h-4 mr-2" />
                        Download JSON
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardHeader>
              <CardContent className="flex-1 p-0 flex flex-col h-full">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                  <div className="px-6 pt-4 pb-2">
                    <TabsList className="bg-neutral-950 border border-neutral-800">
                      <TabsTrigger value="table" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Table View</TabsTrigger>
                      <TabsTrigger value="json" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">JSON Schema</TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="table" className="flex-1 p-0 m-0 relative overflow-hidden flex flex-col">
                    <ScrollArea className="flex-1 h-0">
                      <Table>
                        <TableHeader className="bg-neutral-950/90 sticky top-0 backdrop-blur-md z-10 border-b border-neutral-800">
                          <TableRow className="border-neutral-800 hover:bg-transparent">
                            <TableHead className="w-[100px] text-neutral-300">Type</TableHead>
                            <TableHead className="text-neutral-300">Content</TableHead>
                            <TableHead className="text-neutral-300">Selector (CSS)</TableHead>
                            <TableHead className="text-right text-neutral-300">Attributes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <AnimatePresence mode='popLayout'>
                            {elements.map((el, i) => (
                              <motion.tr
                                key={`${i}-${el.selectors.css}`}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.05, duration: 0.3 }}
                                className="border-neutral-800 hover:bg-neutral-800/40 transition-colors group"
                                style={{ display: 'table-row' }} // Essential for table layout
                              >
                                <TableCell>
                                  <Badge variant="outline" className={`
                                    ${el.type === 'BUTTON' ? 'border-indigo-500/50 text-indigo-400 bg-indigo-500/10' :
                                      el.type === 'LINK' ? 'border-cyan-500/50 text-cyan-400 bg-cyan-500/10' :
                                        el.type === 'INPUT' ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' :
                                          'border-neutral-500 text-neutral-400'}
                                      backdrop-blur-sm
                                    `}>
                                    {el.type}
                                  </Badge>
                                </TableCell>
                                <TableCell className="max-w-[200px]" title={el.content.text || el.content.placeholder || ""}>
                                  <div className="truncate font-medium text-neutral-200">{el.content.text}</div>
                                  {el.content.placeholder && <div className="text-neutral-500 text-xs truncate">Ph: {el.content.placeholder}</div>}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-neutral-500 max-w-[200px]">
                                  <div className="truncate text-indigo-300/60 group-hover:text-indigo-300 transition-colors cursor-help" title={el.selectors.css}>{el.selectors.css}</div>
                                </TableCell>
                                <TableCell className="text-right text-xs text-neutral-400">
                                  {el.attributes.href && <div className="truncate max-w-[150px] ml-auto text-cyan-600/70 group-hover:text-cyan-400" title={el.attributes.href}>href: {el.attributes.href}</div>}
                                  {el.attributes.src && <div className="truncate max-w-[150px] ml-auto">src: {el.attributes.src}</div>}
                                </TableCell>
                              </motion.tr>
                            ))}
                          </AnimatePresence>
                          {elements.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={4} className="h-32 text-center text-neutral-500">
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="flex flex-col items-center gap-2"
                                >
                                  <Layers className="w-8 h-8 opacity-20" />
                                  <span>No elements extracted. Enter a URL and start extraction.</span>
                                </motion.div>
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="json" className="flex-1 relative overflow-hidden flex flex-col h-full">
                    <ScrollArea className="flex-1 h-0 w-full bg-neutral-950/80 p-4 font-mono text-sm text-neutral-300">
                      <motion.pre
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.5 }}
                      >
                        {JSON.stringify({ meta: { source_url: url }, elements }, null, 2)}
                      </motion.pre>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
