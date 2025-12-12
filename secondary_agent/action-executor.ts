// Secondary Agent: Action Executor
// Executes instructions using browser automation and database

import OpenAI from 'openai';
import { AgentInstruction, PageElement } from '../shared/types';
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

    constructor(model: string = 'google/gemma-3-1b-it', temperature: number = 0.2, maxRetries: number = 2) {
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
        contextAnalysis: ContextAnalysis
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
                        return await this.executeClick(instruction, contextAnalysis);
                    
                    case 'fill':
                        return await this.executeFill(instruction, contextAnalysis);
                    
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
                    const improvedSelector = await this.improveSelector(instruction, contextAnalysis);
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

        // Save to database
        await query(
            'INSERT INTO scraped_pages (url, title) VALUES (?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), last_scraped_at = CURRENT_TIMESTAMP',
            [newContext.currentUrl, newContext.currentPageTitle]
        );

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
        contextAnalysis: ContextAnalysis
    ): Promise<ExecutionResult> {
        if (!instruction.target) {
            throw new Error('Click action requires a target selector');
        }

        // Find the best selector
        const selector = await this.findBestSelector(instruction.target, contextAnalysis);
        
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
        contextAnalysis: ContextAnalysis
    ): Promise<ExecutionResult> {
        if (!instruction.target || !instruction.value) {
            throw new Error('Fill action requires both target selector and value');
        }

        const selector = await this.findBestSelector(instruction.target, contextAnalysis);
        
        await browserManager.fillElement(selector, instruction.value);
        
        const newContext = await this.contextManager.getCurrentContext();

        return {
            success: true,
            instructionId: instruction.id,
            action: instruction.action,
            result: { selector, value: instruction.value, filled: true },
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

        // Save to database
        await query(
            'INSERT INTO scraped_pages (url, title) VALUES (?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), last_scraped_at = CURRENT_TIMESTAMP',
            [pageContent.url, pageContent.title]
        );

        await query('DELETE FROM elements WHERE page_url = ?', [pageContent.url]);

        if (pageContent.elements.length > 0) {
            for (const el of pageContent.elements) {
                await query(
                    'INSERT INTO elements (page_url, type, content, selectors, attributes, geometry) VALUES (?, ?, ?, ?, ?, ?)',
                    [
                        pageContent.url,
                        el.type,
                        JSON.stringify(el.content),
                        JSON.stringify(el.selectors),
                        JSON.stringify(el.attributes || {}),
                        JSON.stringify(el.geometry)
                    ]
                );
            }
        }

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
        contextAnalysis: ContextAnalysis
    ): Promise<string> {
        // First, try exact match
        const exactMatch = contextAnalysis.availableElements.find(el =>
            el.selectors.css === target || el.selectors.id === target
        );
        if (exactMatch) {
            return exactMatch.selectors.css || exactMatch.selectors.id || target;
        }

        // Try to find by text content
        const textMatch = contextAnalysis.availableElements.find(el =>
            el.content.text.toLowerCase().includes(target.toLowerCase())
        );
        if (textMatch) {
            return textMatch.selectors.css || textMatch.selectors.id || target;
        }

        // Try relevant elements
        if (contextAnalysis.relevantElements.length > 0) {
            const bestMatch = contextAnalysis.relevantElements[0];
            return bestMatch.selectors.css || bestMatch.selectors.id || target;
        }

        // Use LLM to find better selector if available
        try {
            const improved = await this.improveSelector(
                { action: 'click', target } as AgentInstruction,
                contextAnalysis
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
        contextAnalysis: ContextAnalysis
    ): Promise<string | null> {
        if (contextAnalysis.availableElements.length === 0) {
            return null;
        }

        try {
            const prompt = `Given a target description "${instruction.target}" and available page elements, find the best CSS selector.

Available elements (first 10):
${JSON.stringify(contextAnalysis.availableElements.slice(0, 10).map(el => ({
    text: el.content.text,
    selector: el.selectors.css,
    id: el.selectors.id,
    type: el.type
})), null, 2)}

Return only the best CSS selector as a JSON string: {"selector": "..."}`;

            const completion = await openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: 'You are a CSS selector expert. Return only valid JSON with a selector field.' },
                    { role: 'user', content: prompt }
                ],
                temperature: this.temperature
            });

            const content = completion.choices[0].message.content;
            if (content) {
                try {
                    // Remove markdown code blocks if present
                    const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                    const parsed = JSON.parse(cleanedContent);
                    return parsed.selector || null;
                } catch (parseError) {
                    // Try to extract JSON from the response
                    const jsonMatch = content.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        return parsed.selector || null;
                    }
                }
            }

        } catch (error) {
            console.error('Error improving selector with LLM:', error);
        }

        return null;
    }
}
