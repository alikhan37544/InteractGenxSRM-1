import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Provider } from "@/store/settings-store";

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface AIResponse {
  content: string;
  model: string;
  provider: Provider;
}

export class AIService {
  private openai: OpenAI | null = null;
  private gemini: GoogleGenerativeAI | null = null;
  private provider: Provider = "openrouter";
  private isLocalProvider: boolean = false;

  async initialize(
    provider: Provider,
    config: {
      openRouterApiKey?: string;
      openRouterModel?: string;
      localBaseUrl?: string;
      localModelId?: string;
      geminiApiKey?: string;
      geminiModel?: string;
    }
  ) {
    this.provider = provider;

    // #region agent log
    if (typeof window !== 'undefined') {
      fetch('http://127.0.0.1:7242/ingest/4222f0ba-e057-4694-b3c2-20562b66010c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'lib/ai-service.ts:initialize', message: 'initialize start', data: { provider, hasApiKey: !!config.openRouterApiKey, localBaseUrl: config.localBaseUrl }, timestamp: Date.now() }) }).catch(() => { });
    }
    // #endregion

    if (provider === "gemini") {
      if (!config.geminiApiKey) {
        throw new Error("Gemini API key is required");
      }
      this.gemini = new GoogleGenerativeAI(config.geminiApiKey);
      this.openai = null;
      this.isLocalProvider = false;
      return;
    }

    this.gemini = null;

    if (provider === "openrouter") {
      if (!config.openRouterApiKey) {
        throw new Error("OpenRouter API key is required");
      }
      this.isLocalProvider = false;
      this.openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: config.openRouterApiKey,
        dangerouslyAllowBrowser: true,
        defaultHeaders: {
          "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "",
          "X-Title": "GEO Command Center",
        },
      });
    } else {
      // Local LM Studio
      let baseUrl = config.localBaseUrl || "http://localhost:1234/v1";
      if (!baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
      }
      this.isLocalProvider = true;
      this.openai = new OpenAI({
        baseURL: baseUrl,
        apiKey: "lm-studio",
        dangerouslyAllowBrowser: true,
      });
    }
  }

  async streamCompletion(
    prompt: string,
    model?: string
  ): Promise<ReadableStream<StreamChunk>> {
    if (this.provider === "gemini") {
      if (!this.gemini) throw new Error("Gemini service not initialized");

      const modelToUse = model || "gemini-1.5-flash";
      const generativeModel = this.gemini.getGenerativeModel({ model: modelToUse });

      try {
        const result = await generativeModel.generateContentStream(prompt);

        return new ReadableStream<StreamChunk>({
          async start(controller) {
            try {
              let buffer = "";
              for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                if (chunkText) {
                  buffer += chunkText;
                  controller.enqueue({
                    content: buffer,
                    done: false,
                  });
                }
              }
              controller.enqueue({ content: buffer, done: true });
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        });
      } catch (error: any) {
        throw new Error(`Gemini Error: ${error.message}`);
      }
    }

    if (!this.openai) {
      throw new Error("AI service not initialized. Please configure settings.");
    }

    const modelToUse = model || this.getDefaultModel();

    // Retry logic for OpenRouter 429 errors
    const makeRequest = async (retries = 3, delay = 1000) => {
      try {
        return await this.openai!.chat.completions.create({
          model: modelToUse,
          messages: [{ role: "user", content: prompt }], // User asked for role: system support in example, but interface only passes prompt string currently. Will stick to simple prompt for now unless chat history is passed.
          stream: true,
        });
      } catch (error: any) {
        if (error.status === 429 && retries > 0) {
          console.warn(`Rate limit hit, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return makeRequest(retries - 1, delay * 2);
        }
        throw error;
      }
    };

    try {
      let stream;
      try {
        stream = await makeRequest();
      } catch (streamError: any) {
        // Fallback for Local LM Studio if streaming fails
        if (this.isLocalProvider && (streamError.message?.includes("stream") || streamError.status === 400 || streamError.cause?.code === "ECONNREFUSED")) {
          // Try non-streaming as requested by user ("curl that works... stream: false")
          const response = await this.openai.chat.completions.create({
            model: modelToUse,
            messages: [{ role: "user", content: prompt }],
            stream: false,
          });
          const content = response.choices[0]?.message?.content || "";
          return new ReadableStream<StreamChunk>({
            start(controller) {
              controller.enqueue({ content, done: false });
              controller.enqueue({ content, done: true });
              controller.close();
            },
          });
        }
        throw streamError;
      }

      const readableStream = new ReadableStream<StreamChunk>({
        async start(controller) {
          try {
            let buffer = "";
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || "";
              if (content) {
                buffer += content;
                controller.enqueue({
                  content: buffer,
                  done: false,
                });
              }
            }
            controller.enqueue({
              content: buffer,
              done: true,
            });
            controller.close();
          } catch (error: any) {
            controller.error(error);
          }
        },
      });

      return readableStream;
    } catch (error: any) {
      if (error.code === "ECONNREFUSED" ||
        error.message?.includes("fetch failed") ||
        error.message?.includes("Connection error")) {
        throw new Error(
          "Connection Refused: Is LM Studio running on port 1234? Make sure:\n1. LM Studio server is started\n2. CORS is enabled in LM Studio settings\n3. The base URL is correct (should end with /v1)"
        );
      }
      if (error.status === 401 || error.status === 403) {
        throw new Error("Invalid API key. Please check your credentials.");
      }
      if (error.status === 429) {
        throw new Error("Rate limit exceeded (429). Please wait a moment and try again.");
      }
      throw new Error(`AI Service Error: ${error.message || 'Unknown error'} (Status: ${error.status || 'N/A'})`);
    }
  }

  async getCompletion(prompt: string, model?: string): Promise<AIResponse> {
    if (!this.openai && !this.gemini) {
      throw new Error("AI service not initialized. Please configure settings.");
    }

    const modelToUse = model || this.getDefaultModel();
    let content = "";

    const stream = await this.streamCompletion(prompt, modelToUse);
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (value) {
            content = value.content;
          }
          break;
        }
        if (value) {
          content = value.content;
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content,
      model: modelToUse,
      provider: this.provider,
    };
  }

  private getDefaultModel(): string {
    // This will be set by the caller based on provider
    return "gpt-3.5-turbo";
  }
}

export const aiService = new AIService();

