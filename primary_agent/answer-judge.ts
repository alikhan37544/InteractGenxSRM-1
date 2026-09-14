// Primary Agent: Answer Judge
//
// An independent "sub-agent" that reviews the browsing agent's answer against
// the user's question and decides whether it is complete. When it is not, it
// says what is missing and suggests the next exploration step, which drives
// the agentic loop in the server.
//
// Uses structured output (json_schema) so the verdict is machine-readable.

import OpenAI from 'openai';
import { throwIfAborted, isStopError, StopError } from '../shared/stop';

const openai = new OpenAI({
    baseURL: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
});

export interface JudgeVerdict {
    /** Whether the current answer fully answers the user's question. */
    answered: boolean;
    /** Short human explanation of the verdict. */
    verdict: string;
    /** Specific pieces of information still missing. */
    missing: string[];
    /** One concrete next action for the browser to gather the missing data. */
    nextStep: string;
}

const RESPONSE_FORMAT = {
    type: 'json_schema' as const,
    json_schema: {
        name: 'answer_verdict',
        strict: true,
        schema: {
            type: 'object',
            properties: {
                answered: { type: 'string', enum: ['yes', 'no'] },
                verdict: { type: 'string' },
                missing: { type: 'array', items: { type: 'string' } },
                nextStep: { type: 'string' }
            },
            required: ['answered', 'verdict', 'missing', 'nextStep'],
            additionalProperties: false
        }
    }
};

const SYSTEM_PROMPT = `You are a strict, independent judge for a web-browsing agent. The user asked a question, the agent browsed the web and produced an answer based on the evidence it gathered. Decide whether that answer FULLY answers the user's question.

Be strict about MISSING data, lenient about extra detail:
- answered = yes when the answer contains the specific data the user asked for (for example each requested price or item), even if it also includes extra descriptions, links or commentary.
- answered = no ONLY when a requested piece of data is genuinely absent from the answer and could still plausibly be found by further browsing.
- If the user asked to go to a specific page and the agent arrived there and described it, answered = yes.
- If the answer states the data is unavailable and the page genuinely lacks it, answered = yes; there is nothing more to explore.
- An answer that only describes what is on the current page but omits the requested data is answered = no.
- IMPORTANT: in the evidence below, the 'Actions taken' targets are the agent's descriptions and guesses — they are NOT page content and must never be treated as facts. Only 'Per-action results', element content and page text count as evidence.
- If the answer contains specific data (prices, numbers) that is NOT present in the evidence, treat it as unverifiable and answered = no — the agent must re-gather it from the actual page.

Examples:
- User asks for "the price of every product"; the answer lists a price for each product → answered = yes, even if it adds extra product descriptions.
- User asks for "the price of every product"; the answer lists the products but no prices → answered = no; missing = the prices; nextStep = "Click each product link and extract its price".
- User asks for "the price of every product"; the answer has only one product's price → answered = no; missing = the other prices; nextStep = "Go back to the catalog page, open each remaining product and extract its price".

When answered = no, list exactly what is still missing and give one concrete next step the browser should take. The next step must be executable by a browser agent.`;

export class AnswerJudge {
    private model: string;
    private temperature: number;

    constructor(model: string = 'google/gemma-4-12b-qat', temperature: number = 0.3) {
        this.model = model;
        this.temperature = temperature;
    }

    async judge(
        userInput: string,
        digest: string,
        currentAnswer: string,
        onToken?: (text: string) => void,
        onThinking?: (text: string) => void,
        signal?: AbortSignal
    ): Promise<JudgeVerdict> {
        const userPrompt = `The user asked: "${userInput}"

Here is what the browsing agent did and found:
${digest}

Here is the answer the agent produced:
"""
${currentAnswer}
"""

Is this answer complete? Respond with JSON only.`;

        try {
            throwIfAborted(signal);

            let content: string;
            if (onToken) {
                const stream = await openai.chat.completions.create({
                    model: this.model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: this.temperature,
                    max_tokens: 2048,
                    response_format: RESPONSE_FORMAT,
                    stream: true
                }, { signal });
                content = '';
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
            } else {
                const completion = await openai.chat.completions.create({
                    model: this.model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: this.temperature,
                    max_tokens: 2048,
                    response_format: RESPONSE_FORMAT
                }, { signal });
                content = completion.choices[0].message.content || '';
            }

            if (!content) throw new Error('No response from judge');

            let parsed: any;
            try {
                const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                parsed = JSON.parse(cleanedContent);
            } catch (parseError) {
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
                else throw new Error(`Failed to parse judge verdict: ${parseError}`);
            }

            const answered = parsed.answered === 'yes' || parsed.answered === true;
            return {
                answered,
                verdict: String(parsed.verdict || '').trim(),
                missing: Array.isArray(parsed.missing)
                    ? parsed.missing.map((m: any) => String(m)).filter(Boolean)
                    : answered ? [] : ['The requested information'],
                nextStep: answered ? '' : String(parsed.nextStep || '').trim()
            };
        } catch (error) {
            if (isStopError(error) || signal?.aborted) {
                throw error instanceof StopError ? error : new StopError();
            }
            // A judge failure must not hang the pipeline: assume the answer is
            // acceptable and stop exploring.
            console.error('Answer judge error (treating answer as complete):', error);
            return {
                answered: true,
                verdict: `Judge unavailable (${error instanceof Error ? error.message : String(error)})`,
                missing: [],
                nextStep: ''
            };
        }
    }
}