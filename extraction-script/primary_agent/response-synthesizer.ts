// Primary Agent: Response Synthesizer
// Turns execution results (extracted page content) into a direct, user-facing answer.

import OpenAI from 'openai';
import { AgentInstruction, UserIntent } from '@/shared/types';

const openai = new OpenAI({
    baseURL: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
});

export interface SynthesisInput {
    userInput: string;
    intent?: UserIntent;
    instructions?: AgentInstruction[];
    executionResult?: any;
}

export class ResponseSynthesizer {
    private model: string;
    private temperature: number;

    constructor(model: string = 'google/gemma-4-12b-qat', temperature: number = 0.3) {
        this.model = model;
        this.temperature = temperature;
    }

    private buildDigest(input: SynthesisInput): string {
        const { intent, instructions, executionResult } = input;
        const lines: string[] = [];

        if (intent) {
            lines.push(`Recognized intent: ${intent.intent} (confidence ${Math.round((intent.confidence || 0) * 100)}%)`);
            if (intent.entities && intent.entities.length > 0) {
                lines.push(`Entities: ${intent.entities.map(e => `${e.type}=${e.value}`).join(', ')}`);
            }
        }

        if (instructions && instructions.length > 0) {
            lines.push('Actions taken:');
            for (const inst of instructions) {
                lines.push(`- ${inst.action} ${inst.target ? `→ ${inst.target}` : ''}${inst.value ? ` = "${inst.value}"` : ''}`);
            }
        }

        if (!executionResult) {
            lines.push('Execution: not run (instructions were generated only).');
            return lines.join('\n');
        }

        lines.push(`Execution success: ${executionResult.success ? 'yes' : 'no'}`);
        if (executionResult.message) lines.push(`Execution message: ${executionResult.message}`);
        if (executionResult.error) lines.push(`Execution error: ${executionResult.error}`);

        const results = executionResult.executionResults || [];
        if (results.length > 0) {
            lines.push('Per-action results:');
            for (const r of results) {
                const detail = r.result?.url || r.result?.title || r.result?.selector || r.result?.elementCount || '';
                lines.push(`- ${r.action}: ${r.success ? 'ok' : 'FAILED'}${detail ? ` (${String(detail).slice(0, 160)})` : ''}${r.error ? ` error=${String(r.error).slice(0, 200)}` : ''}`);
            }
        }

        const ctx = executionResult.finalContext;
        if (ctx) {
            const url = ctx.currentUrl || ctx.url || '';
            const title = ctx.currentPageTitle || ctx.title || '';
            if (url || title) lines.push(`Final page: ${title} — ${url}`);

            const elements = ctx.availableElements || [];
            if (elements.length > 0) {
                const seen = new Set<string>();
                const texts: string[] = [];
                for (const el of elements) {
                    const raw = (el.content?.text || el.content?.placeholder || '').trim();
                    if (!raw || raw.length < 2) continue;
                    const key = raw.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    texts.push(raw.slice(0, 120));
                    if (texts.length >= 120) break;
                }
                if (texts.length > 0) {
                    lines.push('Visible page content (deduplicated):');
                    lines.push(texts.join(' | ').slice(0, 4000));
                }
            }
        }

        return lines.join('\n');
    }

    async synthesize(
        input: SynthesisInput,
        onToken?: (text: string) => void,
        onThinking?: (text: string) => void
    ): Promise<string> {
        const digest = this.buildDigest(input);

        const systemPrompt = 'You are a helpful browsing assistant. Answer the user directly and concisely based only on the data provided. Do not invent facts. If the data is insufficient or the action failed, say so plainly.';

        const userPrompt = `The user asked: "${input.userInput}"

Here is what the browsing agent did and found:
${digest}

Write the answer to the user's request.
Rules:
- Be direct and concise (2-6 sentences, or a short list when listing items).
- Use ONLY the information above; never invent prices, names, or facts.
- If execution failed or the data does not contain the answer, say what went wrong instead of guessing.
- Do not mention JSON, selectors, or internal tooling.`;

        const messages = [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt },
        ];

        let content = '';
        const stream = await openai.chat.completions.create({
            model: this.model,
            messages,
            temperature: this.temperature,
            max_tokens: 2048,
            stream: true,
        });

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            const reasoning = (chunk.choices[0]?.delta as any)?.reasoning_content || '';
            if (reasoning) onThinking?.(reasoning);
            if (delta) {
                content += delta;
                onToken?.(delta);
            }
        }

        return content.trim();
    }
}
