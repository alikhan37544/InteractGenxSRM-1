// Primary Agent: Instruction Translation Module
// Converts recognized intent into clear, actionable instructions for the secondary agent

import OpenAI from 'openai';
import { UserIntent, AgentInstruction } from '@/shared/types';
import { InstructionGenerationResult } from './types';

const openai = new OpenAI({
    baseURL: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
});

export class InstructionTranslator {
    private model: string;
    private temperature: number;
    private maxInstructions: number;

    constructor(model: string = 'google/gemma-3-1b-it', temperature: number = 0.2, maxInstructions: number = 5) {
        this.model = model;
        this.temperature = temperature;
        this.maxInstructions = maxInstructions;
    }

    async translateIntentToInstructions(
        intent: UserIntent,
        currentContext?: { url?: string; pageTitle?: string }
    ): Promise<InstructionGenerationResult> {
        const systemPrompt = `You are an instruction generator for a web automation agent. Your job is to convert user intents into clear, step-by-step instructions that another agent can execute.

The secondary agent has access to:
- Browser automation (navigate, click, fill, scroll)
- Current page context (URL, title, available elements)
- Database (scraped pages, elements, context)

Available actions:
1. navigate: Navigate to a URL (target = URL)
2. click: Click an element (target = CSS selector or element description)
3. fill: Fill a form field (target = selector, value = text to fill)
4. extract: Extract page content (target = optional selector)
5. wait: Wait for something (target = timeout in ms or condition)
6. scroll: Scroll the page (target = direction: "up"|"down"|"top"|"bottom")

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

Keep instructions clear, specific, and actionable. Maximum ${this.maxInstructions} instructions.`;

        const userPrompt = `User Intent:
- Intent: ${intent.intent}
- Confidence: ${intent.confidence}
- Context: ${intent.context}
- Entities: ${JSON.stringify(intent.entities, null, 2)}

${currentContext ? `Current Context:\n- URL: ${currentContext.url || 'unknown'}\n- Page: ${currentContext.pageTitle || 'unknown'}` : 'No current context available.'}

Generate clear, actionable instructions for the secondary agent to execute this intent.`;

        try {
            const completion = await openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: this.temperature
            });

            const content = completion.choices[0].message.content;
            if (!content) {
                throw new Error('No response from LLM');
            }

            // Try to parse JSON - handle cases where response might be wrapped in markdown code blocks
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
            const instructions: AgentInstruction[] = (parsed.instructions || []).map((inst: any, index: number) => ({
                id: `inst_${Date.now()}_${index}`,
                action: inst.action,
                target: inst.target,
                value: inst.value,
                reasoning: inst.reasoning || '',
                priority: inst.priority || 'medium',
                metadata: inst.metadata || {}
            }));

            return {
                instructions: instructions.slice(0, this.maxInstructions),
                confidence: parsed.confidence || 0.5,
                reasoning: parsed.reasoning || 'Generated instructions based on intent'
            };

        } catch (error) {
            console.error('Instruction translation error:', error);
            // Fallback to basic instruction generation
            return {
                instructions: this.fallbackInstructionGeneration(intent),
                confidence: 0.3,
                reasoning: 'Fallback instruction generation used due to error'
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

