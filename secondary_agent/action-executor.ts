// Secondary Agent: Action Executor
// Executes instructions using browser automation and database

import OpenAI from 'openai';
import { AgentInstruction, PageElement } from '../shared/types';
import { AgentStreamHooks } from '../shared/streaming';
import { ContextAnalysis, ExecutionResult } from './types';
import { ContextManager } from './context-manager';

const openai = new OpenAI({
    baseURL: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
});

// Dynamic import for extraction-script modules
let query: any;
let browserManager: any;

async function initExtractionScript() {
    if (!query) {
        const dbModule = await import('../extraction-script/lib/db');
        query = dbModule.query;
    }
    if (!browserManager) {
        const browserModule = await import('../extraction-script/lib/browser');
        browserManager = browserModule.default;
    }
}

export class ActionExecutor {
    private contextManager: ContextManager;
    private model: string;
    private temperature: number;
    private maxRetries: number;
    private initialized = false;

    constructor(model: string = 'google/gemma-4-12b-qat', temperature: number = 0.2, maxRetries: number = 2) {
        this.contextManager = new ContextManager();
        this.model = model;
        this.temperature = temperature;
        this.maxRetries = maxRetries;
    }

    private async ensureInitialized() {
        if (!this.initialized) {
            await initExtractionScript();
            this.initialized = true;
        }
    }

    /**
     * Execute a single instruction
     */
    async executeInstruction(
        instruction: AgentInstruction,
        contextAnalysis: ContextAnalysis,
        hooks?: AgentStreamHooks
    ): Promise<ExecutionResult> {
        await this.ensureInitialized();

        let attempts = 0;
        let lastError: Error | null = null;

        while (attempts < this.maxRetries) {
            try {
                attempts++;

                switch (instruction.action) {
                    case 'navigate':
                        return await this.executeNavigate(instruction, contextAnalysis);
                    
                    case 'click':
                        return await this.executeClick(instruction, contextAnalysis, hooks);
                    
                    case 'fill':
                        return await this.executeFill(instruction, contextAnalysis, hooks);
                    
                    case 'extract':
                        return await this.executeExtract(instruction, contextAnalysis);
                    
                    case 'wait':
                        return await this.executeWait(instruction, contextAnalysis);
                    
                    case 'scroll':
                        return await this.executeScroll(instruction, contextAnalysis);
                    
                    default:
                        throw new Error(`Unknown action: ${instruction.action}`);
                }

            } catch (error) {
                lastError = error as Error;
                console.error(`Execution attempt ${attempts} failed:`, error);

                // If we have retries left and it's a selector issue, try to find better selector
                if (attempts < this.maxRetries && (instruction.action === 'click' || instruction.action === 'fill')) {
                    const improvedSelector = await this.improveSelector(instruction, contextAnalysis, hooks);
                    if (improvedSelector) {
                        instruction.target = improvedSelector;
                    }
                }
            }
        }

        return {
            success: false,
            instructionId: instruction.id,
            action: instruction.action,
            error: lastError?.message || 'Execution failed after retries',
            newContext: undefined
        };
    }

    /**
     * Execute navigate action
     */
    private async executeNavigate(
        instruction: AgentInstruction,
        contextAnalysis: ContextAnalysis
    ): Promise<ExecutionResult> {
        if (!instruction.target) {
            throw new Error('Navigate action requires a target URL');
        }

        await browserManager.navigate(instruction.target);
        
        // Wait for page to load
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get updated context
        const newContext = await this.contextManager.getCurrentContext();

        // Remember the visited page so the agent can reference it later.
        // Recording must never break navigation, so failures are non-fatal.
        try {
            const dbUrl = (newContext.currentUrl || '').slice(0, 2048);
            const dbTitle = (newContext.currentPageTitle || '').slice(0, 512);
            await query(
                'INSERT INTO scraped_pages (url, title, full_url) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), full_url = VALUES(full_url), last_scraped_at = CURRENT_TIMESTAMP',
                [dbUrl, dbTitle, newContext.currentUrl]
            );
            await query(
                'INSERT INTO scraping_history (page_url, action, element_count, notes) VALUES (?, ?, ?, ?)',
                [dbUrl, 'navigate', newContext.availableElements.length, 'Visited by agent']
            );
        } catch (dbError) {
            console.warn('Failed to record visited page:', dbError);
        }

        return {
            success: true,
            instructionId: instruction.id,
            action: instruction.action,
            result: { url: newContext.currentUrl, title: newContext.currentPageTitle },
            newContext
        };
    }

    /**
     * Execute click action
     */
    private async executeClick(
        instruction: AgentInstruction,
        contextAnalysis: ContextAnalysis,
        hooks?: AgentStreamHooks
    ): Promise<ExecutionResult> {
        if (!instruction.target) {
            throw new Error('Click action requires a target selector');
        }

        // Find the best selector
        const selector = await this.findBestSelector(instruction.target, contextAnalysis, hooks);
        
        await browserManager.clickElement(selector);
        
        // Wait for potential navigation or content update
        await new Promise(resolve => setTimeout(resolve, 1500));

        const newContext = await this.contextManager.getCurrentContext();

        return {
            success: true,
            instructionId: instruction.id,
            action: instruction.action,
            result: { selector, clicked: true },
            newContext
        };
    }

    /**
     * Execute fill action
     */
    private async executeFill(
        instruction: AgentInstruction,
        contextAnalysis: ContextAnalysis,
        hooks?: AgentStreamHooks
    ): Promise<ExecutionResult> {
        if (!instruction.target || !instruction.value) {
            throw new Error('Fill action requires both target selector and value');
        }

        const selector = await this.findBestSelector(instruction.target, contextAnalysis, hooks);
        
        // fillElement returns the selector actually used: it falls back to the
        // best visible editable field when the provided selector matches
        // nothing (e.g. input[name='q'] on a site that uses a textarea).
        const usedSelector = await browserManager.fillElement(selector, instruction.value);
        
        const newContext = await this.contextManager.getCurrentContext();

        return {
            success: true,
            instructionId: instruction.id,
            action: instruction.action,
            result: { selector: usedSelector, requestedSelector: selector, value: instruction.value, filled: true },
            newContext
        };
    }

    /**
     * Execute extract action
     */
    private async executeExtract(
        instruction: AgentInstruction,
        contextAnalysis: ContextAnalysis
    ): Promise<ExecutionResult> {
        const pageContent = await browserManager.getPageContent();

        // Keep values within their column limits while preserving the
        // original URL in full_url.
        const dbUrl = pageContent.url.slice(0, 2048);
        const dbTitle = (pageContent.title || '').slice(0, 512);

        // Save to database
        await query(
            'INSERT INTO scraped_pages (url, title, full_url) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), full_url = VALUES(full_url), last_scraped_at = CURRENT_TIMESTAMP',
            [dbUrl, dbTitle, pageContent.url]
        );

        await query('DELETE FROM elements WHERE page_url = ?', [dbUrl]);

        if (pageContent.elements.length > 0) {
            const rows = pageContent.elements.map((el: PageElement) => [
                dbUrl,
                el.type,
                JSON.stringify(el.content),
                JSON.stringify(el.selectors),
                JSON.stringify(el.attributes || {}),
                JSON.stringify(el.geometry)
            ]);
            const chunkSize = 100;
            for (let i = 0; i < rows.length; i += chunkSize) {
                const chunk = rows.slice(i, i + chunkSize);
                const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
                await query(
                    `INSERT INTO elements (page_url, type, content, selectors, attributes, geometry) VALUES ${placeholders}`,
                    chunk.flat()
                );
            }
        }

        await query('UPDATE scraped_pages SET element_count = ? WHERE url = ?', [pageContent.elements.length, dbUrl]);

        const newContext = await this.contextManager.getCurrentContext();

        return {
            success: true,
            instructionId: instruction.id,
            action: instruction.action,
            result: {
                url: pageContent.url,
                title: pageContent.title,
                elementCount: pageContent.elements.length
            },
            newContext
        };
    }

    /**
     * Execute wait action
     */
    private async executeWait(
        instruction: AgentInstruction,
        contextAnalysis: ContextAnalysis
    ): Promise<ExecutionResult> {
        const timeout = instruction.target 
            ? parseInt(instruction.target) || 2000 
            : 2000;

        await new Promise(resolve => setTimeout(resolve, timeout));

        return {
            success: true,
            instructionId: instruction.id,
            action: instruction.action,
            result: { waited: timeout }
        };
    }

    /**
     * Execute scroll action
     */
    private async executeScroll(
        instruction: AgentInstruction,
        contextAnalysis: ContextAnalysis
    ): Promise<ExecutionResult> {
        const direction = (instruction.target || 'down') as 'up' | 'down' | 'top' | 'bottom';
        
        await browserManager.scrollPage(direction);

        return {
            success: true,
            instructionId: instruction.id,
            action: instruction.action,
            result: { scrolled: direction }
        };
    }

    /**
     * Find the best selector for a given target description
     */
    private async findBestSelector(
        target: string,
        contextAnalysis: ContextAnalysis,
        hooks?: AgentStreamHooks
    ): Promise<string> {
        const targetLower = target.toLowerCase();

        // First, try exact match
        const exactMatch = contextAnalysis.availableElements.find(el =>
            el.selectors.css === target || el.selectors.id === target
        );
        if (exactMatch) {
            return exactMatch.selectors.css || exactMatch.selectors.id || target;
        }

        // If the target is already a CSS selector that matches an actionable
        // (visible + enabled) element, use it as-is. Selectors that only match
        // disabled/hidden elements (e.g. a submit button that activates after
        // the search box is filled) are not good enough — resolve instead.
        const looksLikeSelector = /[#\[\].>:]/.test(target) && !/\s/.test(target.trim());
        if (looksLikeSelector) {
            const actionable = await browserManager.countActionableMatches(target);
            if (actionable > 0) {
                return target;
            }
        }

        // Try to find by text content or semantic attributes (aria-label, class,
        // placeholder, name, tag)
        const textMatch = contextAnalysis.availableElements.find(el => {
            const haystack = [
                el.content?.text,
                el.content?.placeholder,
                el.attributes?.ariaLabel,
                el.attributes?.className,
                el.attributes?.title,
                el.attributes?.name,
                el.attributes?.tagName,
                el.selectors?.id
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(targetLower);
        });
        if (textMatch) {
            return textMatch.selectors.css || textMatch.selectors.id || target;
        }

        // Try relevant elements, but only if their selector still matches an
        // actionable element on the live page (the page may have changed since
        // the context snapshot). Cap the scan to bound the round-trips.
        for (const candidate of contextAnalysis.relevantElements.slice(0, 20)) {
            const selector = candidate.selectors.css || candidate.selectors.id;
            if (selector && await browserManager.countActionableMatches(selector) > 0) {
                return selector;
            }
        }

        // Use LLM to find better selector if available
        try {
            const improved = await this.improveSelector(
                { action: 'click', target } as AgentInstruction,
                contextAnalysis,
                hooks
            );
            if (improved) return improved;
        } catch (error) {
            console.error('Error improving selector:', error);
        }

        // Fallback to original target
        return target;
    }

    /**
     * Use LLM to improve selector
     */
    private async improveSelector(
        instruction: AgentInstruction,
        contextAnalysis: ContextAnalysis,
        hooks?: AgentStreamHooks
    ): Promise<string | null> {
        if (contextAnalysis.availableElements.length === 0) {
            return null;
        }

        try {
            hooks?.onPhaseStart?.('selector_resolution');

            // Rank elements by keyword overlap with the target so the most likely
            // candidates make it into the prompt, then pad with the page's leading
            // (usually header/nav) elements.
            const targetTokens = (instruction.target || '')
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter(t => t.length >= 3);
            const scored = contextAnalysis.availableElements.map((el, index) => {
                const haystack = [
                    el.content?.text,
                    el.content?.placeholder,
                    el.attributes?.ariaLabel,
                    el.attributes?.className,
                    el.attributes?.title,
                    el.attributes?.name,
                    el.attributes?.tagName,
                    el.selectors?.id
                ].filter(Boolean).join(' ').toLowerCase();
                let score = 0;
                for (const token of targetTokens) {
                    if (haystack.includes(token)) score++;
                }
                return { el, index, score };
            });
            const ordered = [
                ...scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).map(s => s.el),
                ...scored.map(s => s.el)
            ];
            const unique: PageElement[] = [];
            const seen = new Set<string>();
            for (const el of ordered) {
                const key = el.selectors?.css || '';
                if (key && !seen.has(key)) {
                    seen.add(key);
                    unique.push(el);
                }
                if (unique.length >= 25) break;
            }

            const prompt = `Given a target description "${instruction.target}" and available page elements, find the best CSS selector.

Available page elements:
${JSON.stringify(unique.map(el => ({
    text: el.content?.text || '',
    selector: el.selectors?.css || '',
    id: el.selectors?.id || null,
    type: el.type,
    tag: el.attributes?.tagName || null,
    name: el.attributes?.name || null,
    inputType: el.attributes?.inputType || null,
    disabled: el.attributes?.disabled || false,
    placeholder: el.content?.placeholder || null,
    ariaLabel: el.attributes?.ariaLabel || null,
    className: el.attributes?.className || null
})), null, 2)}

Rules:
- Prefer a selector from the list above that matches the target description.
- Prefer visible, enabled elements. Never return a selector that only matches a disabled element.
- Match the element kind to the action: use an input/textarea for filling, and a button/link for clicking.
- The target element may be hidden behind a toggle (e.g. a collapsed search box). If no listed element matches, return a standard CSS selector that matches it (for example "input[type='search']" for a search box).
- Return only the selector, never "none".`;

            const messages: OpenAI.ChatCompletionMessageParam[] = [
                { role: 'system', content: 'You are a CSS selector expert. Pick a selector that matches the target. Respond with JSON only.' },
                { role: 'user', content: prompt }
            ];

            const responseFormat = {
                type: 'json_schema' as const,
                json_schema: {
                    name: 'selector_result',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: { selector: { type: 'string' } },
                        required: ['selector'],
                        additionalProperties: false
                    }
                }
            };

            let content: string | null = null;
            if (hooks?.onToken) {
                const stream = await openai.chat.completions.create({
                    model: this.model,
                    messages,
                    temperature: this.temperature,
                    max_tokens: 2048,
                    response_format: responseFormat,
                    stream: true
                });
                content = '';
                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta?.content || '';
                    const reasoning = (chunk.choices[0]?.delta as any)?.reasoning_content || '';
                    if (reasoning) {
                        hooks?.onThinking?.('selector_resolution', reasoning);
                    }
                    if (delta) {
                        content += delta;
                        hooks.onToken('selector_resolution', delta);
                    }
                }
            } else {
                const completion = await openai.chat.completions.create({
                    model: this.model,
                    messages,
                    temperature: this.temperature,
                    max_tokens: 2048,
                    response_format: responseFormat
                });
                content = completion.choices[0].message.content;
            }

            hooks?.onPhaseEnd?.('selector_resolution');

            if (content) {
                let selector: string | null = null;
                try {
                    // Remove markdown code blocks if present
                    const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                    const parsed = JSON.parse(cleanedContent);
                    selector = parsed.selector || null;
                } catch (parseError) {
                    // Try to extract JSON from the response
                    const jsonMatch = content.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        try {
                            const parsed = JSON.parse(jsonMatch[0]);
                            selector = parsed.selector || null;
                        } catch { /* ignore */ }
                    }
                }

                const cleaned = (selector || '').trim();
                if (!cleaned || /^(none|null|undefined|n\/a)$/i.test(cleaned)) {
                    console.warn(`Selector resolution returned unusable selector: "${cleaned}"`);
                    return null;
                }

                // Verify the selector actually matches something on the page.
                const matches = await browserManager.countMatches(cleaned);
                if (matches === 0) {
                    console.warn(`Selector resolution returned a selector with no matches: "${cleaned}"`);
                    return null;
                }

                return cleaned;
            }

        } catch (error) {
            console.error('Error improving selector with LLM:', error);
        }

        return null;
    }
}
