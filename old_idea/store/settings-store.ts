import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Provider = "openrouter" | "local" | "gemini";

interface SettingsState {
  provider: Provider;
  openRouterApiKey: string;
  openRouterModel: string;
  localBaseUrl: string;
  localModelId: string;
  geminiApiKey: string;
  geminiModel: string;
  setProvider: (provider: Provider) => void;
  setOpenRouterApiKey: (key: string) => void;
  setOpenRouterModel: (model: string) => void;
  setLocalBaseUrl: (url: string) => void;

  setLocalModelId: (modelId: string) => void;
  setGeminiApiKey: (key: string) => void;
  setGeminiModel: (model: string) => void;
}

// Comprehensive list of free OpenRouter models
const FREE_MODELS = [
  // Google Models
  "google/gemini-2.0-flash-exp:free",
  "google/gemini-flash-1.5:free",
  "google/gemini-pro-1.5:free",

  // Meta Llama Models
  "meta-llama/llama-3.2-3b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "meta-llama/llama-3.2-1b-instruct:free",
  "meta-llama/llama-3.2-11b-vision-instruct:free",

  // DeepSeek Models
  "deepseek/deepseek-r1:free",
  "deepseek/deepseek-chat:free",

  // Mistral Models
  "mistralai/mistral-7b-instruct:free",
  "mistralai/mistral-tiny:free",

  // Microsoft Models
  "microsoft/phi-3-mini-128k-instruct:free",
  "microsoft/phi-3-medium-128k-instruct:free",

  // Qwen Models
  "qwen/qwen-2.5-7b-instruct:free",
  "qwen/qwen-2-7b-instruct:free",

  // Other Models
  "huggingface/zephyr-7b-beta:free",
  "openchat/openchat-7b:free",
  "perplexity/llama-3.1-sonar-small-128k-online:free",
] as const;

export const DEFAULT_OPENROUTER_MODEL = FREE_MODELS[0];
export const DEFAULT_LOCAL_BASE_URL = "http://localhost:1234/v1";
export const DEFAULT_LOCAL_MODEL_ID = "local-model";
export const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      provider: "openrouter",
      openRouterApiKey: "",
      openRouterModel: DEFAULT_OPENROUTER_MODEL,
      localBaseUrl: DEFAULT_LOCAL_BASE_URL,
      localModelId: DEFAULT_LOCAL_MODEL_ID,
      geminiApiKey: "",
      geminiModel: DEFAULT_GEMINI_MODEL,
      setProvider: (provider) => set({ provider }),
      setOpenRouterApiKey: (key) => set({ openRouterApiKey: key }),
      setOpenRouterModel: (model) => set({ openRouterModel: model }),
      setLocalBaseUrl: (url) => set({ localBaseUrl: url }),
      setLocalModelId: (modelId) => set({ localModelId: modelId }),
      setGeminiApiKey: (key) => set({ geminiApiKey: key }),
      setGeminiModel: (model) => set({ geminiModel: model }),
    }),
    {
      name: "geo-settings-storage",
    }
  )
);

export { FREE_MODELS };

