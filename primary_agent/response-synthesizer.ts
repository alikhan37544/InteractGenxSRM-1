// Primary Agent: Response Synthesizer
// Turns execution results (extracted page content) into a direct, user-facing answer.

import OpenAI from 'openai';
import { AgentInstruction, UserIntent } from '../shared/types';
import { isVisionModel } from '../shared/vision';
import { throwIfAborted, isStopError, StopError } from '../shared/stop';

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

/**
 * Unwrap the secondary agent's response envelope ({ success, data: {...} })
 * so evidence lives on the object regardless of which transport produced it
 * (/execute wraps in .data, /execute/stream does not).
 */
function unwrapExecutionResult(executionResult: any): any {
    if (
        executionResult &&
        typeof executionResult === 'object' &&
        'data' in executionResult &&
        executionResult.data &&
        typeof executionResult.data === 'object'
    ) {
        return executionResult.data;
    }
    return executionResult;
}

interface DigestRound {
    instructions?: AgentInstruction[];
    executionResult?: any;
}

/**
 * Render what the browsing agent did and found into a plain-text digest.
 * Handles multi-round explorations (agentic loop): when executionResult has a
 * `rounds` array, each round's actions + findings are included in order.
 */
export function buildSynthesisDigest(input: SynthesisInput): string {
    const { intent, instructions, executionResult } = input;
    const lines: string[] = [];

    if (intent) {
        lines.push(`Recognized intent: ${intent.intent} (confidence ${Math.round((intent.confidence || 0) * 100)}%)`);
        if (intent.entities && intent.entities.length > 0) {
            lines.push(`Entities: ${intent.entities.map(e => `${e.type}=${e.value}`).join(', ')}`);
        }
    }

    if (!executionResult) {
        lines.push('Execution: not run (instructions were generated only).');
        return lines.join('\n');
    }

    const er = unwrapExecutionResult(executionResult);
    const rounds: DigestRound[] =
        Array.isArray(er?.rounds) && er.rounds.length > 0
            ? er.rounds
            : [{ instructions, executionResult: er }];

    for (let r = 0; r < rounds.length; r++) {
        const round = rounds[r];
        const roundInstructions = round.instructions || [];
        const roundResult = unwrapExecutionResult(round.executionResult);

        lines.push(rounds.length > 1 ? `--- Exploration round ${r + 1} ---` : 'Exploration findings:');

        if (roundInstructions.length > 0) {
            lines.push('Actions taken:');
            for (const inst of roundInstructions) {
                // extract targets are optional and often contaminated with
                // invented content (e.g. a price the model hopes to find) —
                // they are never evidence, so render extract without a target.
                const target = inst.action === 'extract' ? '' : inst.target;
                lines.push(`- ${inst.action}${target ? ` → ${target}` : ''}${inst.value ? ` = "${inst.value}"` : ''}`);
            }
        }

        if (!roundResult) continue;

        lines.push(`Execution success: ${roundResult.success ? 'yes' : 'no'}`);
        if (roundResult.message) lines.push(`Execution message: ${roundResult.message}`);
        if (roundResult.error) lines.push(`Execution error: ${roundResult.error}`);

        const results = roundResult.executionResults || [];
        if (results.length > 0) {
            lines.push('Per-action results:');
            for (const res of results) {
                const detail = res.result?.url || res.result?.title || res.result?.selector || res.result?.elementCount || '';
                lines.push(`- ${res.action}: ${res.success ? 'ok' : 'FAILED'}${detail ? ` (${String(detail).slice(0, 160)})` : ''}${res.error ? ` error=${String(res.error).slice(0, 200)}` : ''}`);
            }
        }

        const ctx = roundResult.finalContext;
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

            // The actual readable page text — this is what the user asked about.
            const pageText = String(ctx.pageText || '').trim();
            if (pageText) {
                lines.push('Page text (visible content):');
                lines.push(pageText.slice(0, 8000));
            }
        }
    }

    return lines.join('\n');
}

export class ResponseSynthesizer {
    private model: string;
    private temperature: number;

    constructor(model: string = 'google/gemma-4-12b-qat', temperature: number = 0.3) {
        this.model = model;
        this.temperature = temperature;
    }

    async synthesize(
        input: SynthesisInput,
        onToken?: (text: string) => void,
        onThinking?: (text: string) => void,
        signal?: AbortSignal,
        screenshots?: string[] | null
    ): Promise<string> {
        const digest = buildSynthesisDigest(input);
        const shots = (screenshots || []).filter(Boolean);
        const useImages = shots.length > 0 && isVisionModel(this.model);

        const systemPrompt = 'You are a helpful browsing assistant. Answer the user directly and concisely based only on the data provided. Do not invent facts. If the data is insufficient or the action failed, say so plainly.';

        const userPrompt = `The user asked: "${input.userInput}"

Here is what the browsing agent did and found:
${digest}

${useImages ? `${shots.length} screenshot${shots.length === 1 ? '' : 's'} of the final page (taken from top to bottom) ${shots.length === 1 ? 'is' : 'are'} attached; use ${shots.length === 1 ? 'it' : 'them'} to ground your answer in what is actually visible.\n` : ''}
Write the answer to the user's request.
Rules:
- Be direct and concise (2-6 sentences, or a short list when listing items).
- Use ONLY the information above; never invent prices, names, or facts.
- IMPORTANT: the 'Actions taken' targets are the agent's descriptions and guesses — they are NOT page content. Only 'Per-action results', element content and page text are real evidence.
- If execution failed or the data does not contain the answer, say what went wrong instead of guessing.
- Do not mention JSON, selectors, or internal tooling.`;

        let userContent: OpenAI.ChatCompletionContentPart[] | string = userPrompt;
        if (useImages) {
            userContent = [
                { type: 'text', text: userPrompt },
                ...shots.map(url => ({ type: 'image_url' as const, image_url: { url } })),
            ];
        }

        const messages = [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userContent },
        ];

        let content = '';
        const stream = await openai.chat.completions.create({
            model: this.model,
            messages,
            temperature: this.temperature,
            max_tokens: 2048,
            stream: true,
        }, { signal });

        for await (const chunk of stream) {
            throwIfAborted(signal);
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
