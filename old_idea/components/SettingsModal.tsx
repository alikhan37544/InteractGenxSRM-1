"use client";

import { useState } from "react";
import { Settings, Cloud, Server } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { useSettingsStore, FREE_MODELS, type Provider } from "@/store/settings-store";
import { useToast } from "./ui/toast";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const {
    provider,
    openRouterApiKey,
    openRouterModel,
    localBaseUrl,
    localModelId,
    setProvider,
    setOpenRouterApiKey,
    setOpenRouterModel,
    setLocalBaseUrl,
    setLocalModelId,
    geminiApiKey,
    geminiModel,
    setGeminiApiKey,
    setGeminiModel,
  } = useSettingsStore();

  const { addToast } = useToast();
  const [tempApiKey, setTempApiKey] = useState(openRouterApiKey);
  const [tempLocalUrl, setTempLocalUrl] = useState(localBaseUrl);
  const [tempLocalModel, setTempLocalModel] = useState(localModelId);
  const [tempGeminiKey, setTempGeminiKey] = useState(geminiApiKey);
  const [tempGeminiModel, setTempGeminiModel] = useState(geminiModel);

  const handleSave = () => {
    if (provider === "openrouter" && !tempApiKey.trim()) {
      addToast({
        title: "API Key Required",
        description: "Please enter your OpenRouter API key",
        variant: "destructive",
      });
      return;
    }

    if (provider === "gemini" && !tempGeminiKey.trim()) {
      addToast({
        title: "API Key Required",
        description: "Please enter your Gemini API key",
        variant: "destructive",
      });
      return;
    }

    setOpenRouterApiKey(tempApiKey);
    setLocalBaseUrl(tempLocalUrl);
    setLocalModelId(tempLocalModel);
    setGeminiApiKey(tempGeminiKey);
    setGeminiModel(tempGeminiModel);

    addToast({
      title: "Settings Saved",
      description: "Your settings have been saved successfully",
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Provider Settings
          </DialogTitle>
          <DialogDescription>
            Configure your AI provider settings. Switch between cloud (OpenRouter) and local (LM Studio) providers.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={provider}
          onValueChange={(value) => setProvider(value as Provider)}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="openrouter" className="flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              OpenRouter (Cloud)
            </TabsTrigger>
            <TabsTrigger value="local" className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              Local (LM Studio)
            </TabsTrigger>
            <TabsTrigger value="gemini" className="flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              Gemini
            </TabsTrigger>
          </TabsList>

          <TabsContent value="openrouter" className="space-y-4">
            <Card className="glass">
              <CardHeader>
                <CardTitle>OpenRouter Configuration</CardTitle>
                <CardDescription>
                  Use free models from OpenRouter. Get your API key from{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    openrouter.ai/keys
                  </a>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">API Key</label>
                  <input
                    type="password"
                    value={tempApiKey}
                    onChange={(e) => setTempApiKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Model</label>
                  <select
                    value={openRouterModel}
                    onChange={(e) => setOpenRouterModel(e.target.value)}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {FREE_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Free models available. You can also enter a custom model ID.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Custom Model (Optional)</label>
                  <input
                    type="text"
                    value={openRouterModel}
                    onChange={(e) => setOpenRouterModel(e.target.value)}
                    placeholder="Enter custom model ID"
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="gemini" className="space-y-4">
            <Card className="glass">
              <CardHeader>
                <CardTitle>Gemini Configuration</CardTitle>
                <CardDescription>
                  Use Google&apos;s Gemini models. Get your API key from Google AI Studio.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">API Key</label>
                  <input
                    type="password"
                    value={tempGeminiKey}
                    onChange={(e) => setTempGeminiKey(e.target.value)}
                    placeholder="AIza..."
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Model</label>
                  <input
                    type="text"
                    value={tempGeminiModel}
                    onChange={(e) => setTempGeminiModel(e.target.value)}
                    placeholder="gemini-1.5-flash"
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="local" className="space-y-4">
            <Card className="glass">
              <CardHeader>
                <CardTitle>LM Studio Configuration</CardTitle>
                <CardDescription>
                  Connect to a local LM Studio server. Make sure LM Studio is running and the server is started on port 1234.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Base URL</label>
                  <input
                    type="text"
                    value={tempLocalUrl}
                    onChange={(e) => setTempLocalUrl(e.target.value)}
                    placeholder="http://localhost:1234/v1"
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Model ID</label>
                  <input
                    type="text"
                    value={tempLocalModel}
                    onChange={(e) => setTempLocalModel(e.target.value)}
                    placeholder="local-model"
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground">
                    The model ID as shown in LM Studio. Usually the model name.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Settings</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

