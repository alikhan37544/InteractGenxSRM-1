// Primary Agent: Instruction Translation Module
// Converts recognized intent into clear, actionable instructions for the secondary agent

import OpenAI from 'openai';
import { UserIntent, AgentInstruction, PageElement } from '../shared/types';
import { isStopError, StopError, throwIfAborted } from '../shared/stop';
import { isVisionModel } from '../shared/vision';
import { deriveNavigationPlan, buildNavigationDirective, applyNavigationGuardrails } from './navigation-planner';
import { JudgeVerdict } from './answer-judge';
import { InstructionGenerationResult } from './types';

const openai = new OpenAI({
    baseURL: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
});

export interface TranslatorContext {
    url?: string;
    pageTitle?: string;
    recentPages?: Array<{ url: string; title?: string }>;
    /** Interactive elements on the current page (refreshed before planning). */
    availableElements?: PageElement[];
    /** Visible text of the current page (truncated). */
    pageText?: string;
}

/**
 * Render the current page's interactive elements compactly for the planner.
 * Links/buttons are targeted by their exact visible text; inputs by
 * placeholder/name. Noisy hrefs are skipped so the list stays useful.
 */
function formatElements(elements: PageElement[] = [], limit = 100): string {
    const lines: string[] = [];
    for (const el of elements) {
        if (lines.length >= limit) break;
        const text = (el.content?.text || '').trim();
        const placeholder = (el.content?.placeholder || '').trim();
        const href = (el.attributes?.href || '').trim();
        if (!text && !placeholder) continue;
        if (href.startsWith('javascript:') || href === '#') continue;

        const label = text ? `"${text.slice(0, 90)}"` : `[placeholder="${placeholder.slice(0, 60)}"]`;
        const parts = [`[${el.type}] ${label}`];
        if (href) parts.push(`href=${href.slice(0, 140)}`);
        if (el.attributes?.name) parts.push(`name=${el.attributes.name}`);
        if (el.attributes?.inputType) parts.push(`type=${el.attributes.inputType}`);
        if (el.attributes?.disabled) parts.push('disabled');
        lines.push(parts.join(' '));
    }
    return lines.join('\n');
}

/**
 * Render the tail of the conversation so follow-up requests ("tell me more")
 * can be resolved against what was already said.
 */
function formatHistory(history?: Array<{ role: string; content: string }>): string {
    if (!history || history.length === 0) return '';
    return history
        .slice(-6)
        .map(msg => `${msg.role}: ${(msg.content || '').slice(0, 400)}`)
        .join('\n');
}

export class InstructionTranslator {
    private model: string;
    private temperature: number;
    private maxInstructions: number;

    constructor(model: string = 'google/gemma-4-12b-qat', temperature: number = 0.2, maxInstructions: number = 5) {
        this.model = model;
        this.temperature = temperature;
        this.maxInstructions = maxInstructions;
    }

    private buildSystemPrompt(): string {
        return `You are an instruction generator for a web automation agent. Your job is to convert user intents into clear, step-by-step instructions that another agent can execute.

The secondary agent has access to:
- Browser automation (navigate, click, fill, scroll)
- Current page context (URL, title, available elements)
- Database (scraped pages, elements, context)

Available actions:
1. navigate: Navigate to a URL (target = a full URL including the scheme, e.g. https://www.google.com — never a bare word like "google")
2. click: Click an element (target = short element description such as "search button", or a CSS selector)
3. fill: Fill a form field (target = short description such as "search box", or a CSS selector; value = text to fill)
4. extract: Extract page content (target = optional selector)
5. wait: Wait for something (target = timeout in ms or condition)
6. scroll: Scroll the page (target = direction: "up"|"down"|"top"|"bottom")

Element targeting rules:
- The executing agent resolves short descriptions to real page elements. Prefer descriptions like "search box" or "search button".
- When the current page's interactive elements are listed below, target them by their exact visible text (for links/buttons) or their placeholder/name (for inputs). Those elements exist right now — use them.
- Do NOT invent site-specific CSS selectors (e.g. input[name='q'], button[type='submit']) for a page the browser is not on yet: you do not know that site's markup, and guessed selectors fail.
- Only use a CSS selector when it is present in the current page context below.
- Never copy selectors from previous conversations or other sites.
- NEVER embed data you expect to find (prices, numbers, names, page text) inside an instruction target — targets describe elements to act on, they are not content. For example target "price of Widget A" or "Gadget B Price: $149.99" is wrong; "the Widget A price link" or just "Widget A" is right.

Follow-up and reading rules:
- If the user asks for more detail, elaboration, or to continue a topic ("tell me more", "explain further", "what else", "continue"), do NOT search again and do NOT navigate to a guessed URL. Click the most authoritative link about the current topic from the interactive elements list (prefer Wikipedia, Britannica, an official site, or the site's own article page), then extract the page so its text can be read.
- If the user refers to something from a previous step ("the first result", "that article", "it"), resolve it from the conversation history and the element list.
- When the current page already lists results for the topic, prefer clicking one of those links over running a new search.
- After clicking a link that opens an article or detail page, always add an extract action to capture the page content.

Generate a sequence of instructions as JSON:
{
    "instructions": [
        {
            "action": "action_name",
            "target": "selector_or_url",
            "value": "optional_value",
            "reasoning": "why this action is needed",
            "priority": "high|medium|low"
        }
    ],
    "confidence": 0.0-1.0,
    "reasoning": "overall strategy explanation"
}

Search and navigation guidance:
- A \`navigate\` goes to a NEW page/site. A \`click\`/\`fill\` acts on the CURRENT page. Decide which one the user wants, and do not mix them: never click or fill the current page before navigating to a different site.
- General web search ("search for X", "search about X", "look up X", "google X") with no site named is a NEW-PAGE navigation: navigate to https://duckduckgo.com/?q=<query>, wait for results, then extract. Do NOT use the search box of whatever site the browser happens to be on. Google frequently blocks automated browsers with a CAPTCHA, so prefer DuckDuckGo.
- Only use a site's own search box when the user explicitly scopes the search to that site ("search Wikipedia for X", "search for X on amazon").
- Homepage/website requests ("take me to the <brand> homepage/website", "open the <brand> site") are NEW-PAGE navigations: navigate to the brand's official URL. If you are not certain of the exact domain, navigate to https://duckduckgo.com/?q=<brand>+official+site and click the official result — do not guess an unrelated domain and do not search the current site.
- Always write navigate targets as complete URLs including https:// (e.g. https://duckduckgo.com/?q=greece). Never use a bare word as a URL.
- Search fields submit automatically with Enter; a separate click on the search button is optional.

Keep instructions clear, specific, and actionable. Maximum ${this.maxInstructions} instructions.`;
    }

    /** Parse the model's JSON and normalise it into AgentInstructions. */
    private parseInstructions(content: string): { instructions: AgentInstruction[]; confidence: number; reasoning: string } {
        let parsed;
        try {
            // Remove markdown code blocks if present
            const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            parsed = JSON.parse(cleanedContent);
        } catch (parseError) {
            // If JSON parsing fails, try to extract JSON from the response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error(`Failed to parse JSON response: ${parseError}`);
            }
        }

        // Generate unique IDs for instructions
        const generated: AgentInstruction[] = (parsed.instructions || []).map((inst: any, index: number) => ({
            id: `inst_${Date.now()}_${index}`,
            action: inst.action,
            target: inst.target === undefined || inst.target === null ? undefined : String(inst.target),
            value: inst.value === undefined || inst.value === null ? undefined : String(inst.value),
            reasoning: typeof inst.reasoning === 'string' ? inst.reasoning : '',
            priority: inst.priority || 'medium',
            metadata: inst.metadata || {}
        }));

        return {
            instructions: generated,
            confidence: parsed.confidence || 0.5,
            reasoning: parsed.reasoning || 'Generated instructions based on intent'
        };
    }

    /** Call the LLM for an instruction plan, honouring streaming + abort. */
    private async requestPlan(
        systemPrompt: string,
        userContent: OpenAI.ChatCompletionContentPart[] | string,
        onToken?: (text: string) => void,
        onThinking?: (text: string) => void,
        signal?: AbortSignal
    ): Promise<string> {
        throwIfAborted(signal);

        const messages: any[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
        ];

        let content: string;
        if (onToken) {
            const stream = await openai.chat.completions.create({
                model: this.model,
                messages,
                temperature: this.temperature,
                stream: true
            }, { signal });
            content = '';
            for await (const chunk of stream) {
                throwIfAborted(signal);
                const delta = chunk.choices[0]?.delta?.content || '';
                const reasoning = (chunk.choices[0]?.delta as any)?.reasoning_content || '';
                if (reasoning) {
                    onThinking?.(reasoning);
                }
                if (delta) {
                    content += delta;
                    onToken(delta);
                }
            }
        } else {
            const completion = await openai.chat.completions.create({
                model: this.model,
                messages,
                temperature: this.temperature
            }, { signal });
            content = completion.choices[0].message.content || '';
        }

        if (!content) {
            throw new Error('No response from LLM');
        }
        return content;
    }

    async translateIntentToInstructions(
        intent: UserIntent,
        currentContext?: TranslatorContext,
        onToken?: (text: string) => void,
        onThinking?: (text: string) => void,
        signal?: AbortSignal,
        history?: Array<{ role: string; content: string }>,
        screenshot?: string | null
    ): Promise<InstructionGenerationResult> {
        const systemPrompt = this.buildSystemPrompt();
        const elementList = formatElements(currentContext?.availableElements);
        const historyText = formatHistory(history);
        const pageText = (currentContext?.pageText || '').trim();

        // Decide "same page vs. new page" from the user's words and make it
        // explicit to the planner, then enforce it on the produced plan.
        const navigationPlan = deriveNavigationPlan(intent.rawInput || '', currentContext?.url);
        const navigationDirective = buildNavigationDirective(navigationPlan, currentContext?.url);

        const userPrompt = `User Intent:
- Intent: ${intent.intent}
- Confidence: ${intent.confidence}
- Context: ${intent.context}
- Entities: ${JSON.stringify(intent.entities, null, 2)}
${navigationDirective ? `\n${navigationDirective}\n` : ''}
${currentContext ? `Current Context:\n- URL: ${currentContext.url || 'unknown'}\n- Page: ${currentContext.pageTitle || 'unknown'}` : 'No current context available.'}
${elementList ? `\nInteractive elements on the current page (use these exact targets):\n${elementList}` : ''}
${pageText ? `\nVisible page text (excerpt):\n${pageText.slice(0, 1500)}` : ''}
${currentContext?.recentPages?.length ? `\nRecently visited pages (already in memory):\n${currentContext.recentPages.map(p => `- ${p.title || p.url} (${p.url})`).join('\n')}` : ''}
${historyText ? `\nRecent conversation:\n${historyText}` : ''}

Generate clear, actionable instructions for the secondary agent to execute this intent.`;

        try {
            throwIfAborted(signal);

            // Ground the plan in what is actually on screen when the model can see.
            let userContent: OpenAI.ChatCompletionContentPart[] | string = userPrompt;
            if (screenshot && isVisionModel(this.model)) {
                userContent = [
                    { type: 'text', text: userPrompt },
                    { type: 'image_url', image_url: { url: screenshot } },
                ];
            }

            const content = await this.requestPlan(systemPrompt, userContent, onToken, onThinking, signal);
            const { instructions: generated, confidence, reasoning } = this.parseInstructions(content);

            // Enforce the same-page / new-page decision on the produced plan.
            const instructions = applyNavigationGuardrails(generated, navigationPlan, currentContext?.url);

            return {
                instructions: instructions.slice(0, this.maxInstructions),
                confidence,
                reasoning
            };

        } catch (error) {
            // A user-initiated stop must propagate, not fall back to heuristics.
            if (isStopError(error) || signal?.aborted) {
                throw error instanceof StopError ? error : new StopError();
            }
            console.error('Instruction translation error:', error);
            // Fallback to basic instruction generation
            return {
                instructions: this.fallbackInstructionGeneration(intent),
                confidence: 0.3,
                reasoning: 'Fallback instruction generation used due to error'
            };
        }
    }

    /**
     * Generate the next exploration round after the judge found the answer
     * incomplete. The plan stays on the current page unless the judge's
     * suggested next step names an explicit URL.
     */
    async generateFollowUpInstructions(
        userInput: string,
        currentAnswer: string,
        verdict: JudgeVerdict,
        currentContext?: TranslatorContext,
        onToken?: (text: string) => void,
        onThinking?: (text: string) => void,
        signal?: AbortSignal,
        screenshot?: string | null,
        lastRoundSummary?: string
    ): Promise<InstructionGenerationResult> {
        const systemPrompt = this.buildSystemPrompt();
        const elementList = formatElements(currentContext?.availableElements);
        const pageText = (currentContext?.pageText || '').trim();

        // Follow-ups continue the task on the page the agent reached; only an
        // explicit URL in the judge's next step justifies leaving it.
        const derived = deriveNavigationPlan(verdict.nextStep || '', currentContext?.url);
        const navigationPlan = derived.strategy === 'direct_url'
            ? derived
            : { strategy: 'read_current' as const, reason: 'Continue exploring the current page for the missing data' };
        const navigationDirective = buildNavigationDirective(navigationPlan, currentContext?.url);

        const missing = verdict.missing.length > 0 ? verdict.missing.map(m => `- ${m}`).join('\n') : '- The requested information';

        const userPrompt = `The user asked: "${userInput}"

A previous exploration produced this answer:
"""
${(currentAnswer || '').slice(0, 2000)}
"""

An independent judge reviewed the answer and found it INCOMPLETE. Still missing:
${missing}

Suggested next step: ${verdict.nextStep || 'Find the missing information on the current page.'}

${lastRoundSummary ? `\nWhat happened in the LAST round (learn from its failures):\n${lastRoundSummary}\n` : ''}
${navigationDirective ? `\n${navigationDirective}\n` : ''}
${currentContext ? `Current Context:\n- URL: ${currentContext.url || 'unknown'}\n- Page: ${currentContext.pageTitle || 'unknown'}` : 'No current context available.'}
${elementList ? `\nInteractive elements on the current page (use these exact targets):\n${elementList}` : ''}
${pageText ? `\nVisible page text (excerpt):\n${pageText.slice(0, 1500)}` : ''}
${currentContext?.recentPages?.length ? `\nRecently visited pages (already in memory):\n${currentContext.recentPages.map(p => `- ${p.title || p.url} (${p.url})`).join('\n')}` : ''}

Generate the next sequence of instructions to gather the missing information. Prefer clicking a relevant link on the current page and extracting its content.
Rules for continuing:
- If an action FAILED in the last round, do NOT repeat it — do something different.
- If the link you need is not in the 'Interactive elements' list of the current page (for example you clicked into a detail page and now need another item), the FIRST instruction must be a navigate back to the catalog page that lists it (use a URL from 'Recently visited pages'). Never click a link that is not on the current page.
- After each page change, extract so the new page's content is captured.`;

        try {
            throwIfAborted(signal);

            let userContent: OpenAI.ChatCompletionContentPart[] | string = userPrompt;
            if (screenshot && isVisionModel(this.model)) {
                userContent = [
                    { type: 'text', text: userPrompt },
                    { type: 'image_url', image_url: { url: screenshot } },
                ];
            }

            const content = await this.requestPlan(systemPrompt, userContent, onToken, onThinking, signal);
            const { instructions: generated, confidence, reasoning } = this.parseInstructions(content);
            const instructions = applyNavigationGuardrails(generated, navigationPlan, currentContext?.url);

            return {
                instructions: instructions.slice(0, this.maxInstructions),
                confidence,
                reasoning
            };
        } catch (error) {
            if (isStopError(error) || signal?.aborted) {
                throw error instanceof StopError ? error : new StopError();
            }
            console.error('Follow-up instruction generation error:', error);
            return {
                instructions: [],
                confidence: 0,
                reasoning: `Follow-up generation failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    private fallbackInstructionGeneration(intent: UserIntent): AgentInstruction[] {
        const instructions: AgentInstruction[] = [];

        if (intent.intent === 'navigate_to_page') {
            const urlEntity = intent.entities.find(e => e.type === 'url');
            if (urlEntity) {
                instructions.push({
                    id: `inst_${Date.now()}_0`,
                    action: 'navigate',
                    target: urlEntity.value,
                    reasoning: `Navigate to ${urlEntity.value} as requested`,
                    priority: 'high'
                });
            }
        } else if (intent.intent === 'click_element') {
            const buttonEntity = intent.entities.find(e => e.type === 'button_text');
            if (buttonEntity) {
                instructions.push({
                    id: `inst_${Date.now()}_0`,
                    action: 'click',
                    target: buttonEntity.value,
                    reasoning: `Click on ${buttonEntity.value} as requested`,
                    priority: 'high'
                });
            }
        } else if (intent.intent === 'fill_form') {
            const fieldEntity = intent.entities.find(e => e.type === 'form_field');
            const valueEntity = intent.entities.find(e => e.type === 'input_value');
            if (fieldEntity && valueEntity) {
                instructions.push({
                    id: `inst_${Date.now()}_0`,
                    action: 'fill',
                    target: fieldEntity.value,
                    value: valueEntity.value,
                    reasoning: `Fill ${fieldEntity.value} with ${valueEntity.value}`,
                    priority: 'high'
                });
            }
        }

        return instructions.length > 0 ? instructions : [{
            id: `inst_${Date.now()}_0`,
            action: 'extract',
            reasoning: 'Extract current page content to understand available actions',
            priority: 'medium'
        }];
    }
}

