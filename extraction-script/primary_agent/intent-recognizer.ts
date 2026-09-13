// Primary Agent: Intent Recognition Module
// Understands user input (text or voice) and extracts intent

import OpenAI from 'openai';
import { UserIntent, IntentEntity } from '@/shared/types';
import { IntentRecognitionResult } from './types';

const openai = new OpenAI({
    baseURL: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
});

export class IntentRecognizer {
    private model: string;
    private temperature: number;

    constructor(model: string = 'google/gemma-4-12b-qat', temperature: number = 0.3) {
        this.model = model;
        this.temperature = temperature;
    }

    async recognizeIntent(
        userInput: string,
        conversationHistory?: Array<{role: string, content: string}>,
        onToken?: (text: string) => void,
        onThinking?: (text: string) => void
    ): Promise<IntentRecognitionResult> {
        const systemPrompt = `You are an expert intent recognition system. Your job is to understand what the user wants to do on a website.

Analyze the user's input and extract:
1. The primary intent (what they want to accomplish)
2. Key entities (URLs, button text, form fields, input values, etc.)
3. The context and any implicit requirements

Common intents include:
- navigate_to_page: User wants to go to a specific URL or page
- click_element: User wants to click a button, link, or interactive element
- fill_form: User wants to fill out a form field
- extract_data: User wants to extract or view information
- search: User wants to search for something
- wait: User wants to wait for something to load
- scroll: User wants to scroll the page

Return your analysis as JSON with this structure:
{
    "intent": "intent_name",
    "confidence": 0.0-1.0,
    "entities": [
        {
            "type": "entity_type (url|button_text|input_value|form_field|search_query|etc)",
            "value": "extracted_value",
            "confidence": 0.0-1.0
        }
    ],
    "context": "brief explanation of the user's goal",
    "requiresClarification": false,
    "clarificationQuestions": []
}`;

        const userPrompt = `User input: "${userInput}"

${conversationHistory ? `\nConversation history:\n${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}` : ''}

Analyze this input and extract the intent, entities, and context.`;

        try {
            const messages: any[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ];

            // Add conversation history if provided
            if (conversationHistory && conversationHistory.length > 0) {
                // Insert history before the final user message
                messages.splice(-1, 0, ...conversationHistory);
            }

            let content: string;
            if (onToken) {
                const stream = await openai.chat.completions.create({
                    model: this.model,
                    messages,
                    temperature: this.temperature,
                    stream: true
                });
                content = '';
                for await (const chunk of stream) {
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
                });
                content = completion.choices[0].message.content || '';
            }

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
            
            const intent: UserIntent = {
                rawInput: userInput,
                intent: parsed.intent || 'unknown',
                confidence: parsed.confidence || 0.5,
                entities: parsed.entities || [],
                context: parsed.context || ''
            };

            return {
                intent,
                requiresClarification: parsed.requiresClarification || false,
                clarificationQuestions: parsed.clarificationQuestions || []
            };

        } catch (error) {
            console.error('Intent recognition error:', error);
            // Fallback to basic intent recognition
            return {
                intent: {
                    rawInput: userInput,
                    intent: this.fallbackIntentRecognition(userInput),
                    confidence: 0.5,
                    entities: [],
                    context: 'Fallback intent recognition used'
                },
                requiresClarification: true,
                clarificationQuestions: ['Could you clarify what you want to do?']
            };
        }
    }

    private fallbackIntentRecognition(input: string): string {
        const lower = input.toLowerCase();
        if (lower.includes('click') || lower.includes('press') || lower.includes('tap')) {
            return 'click_element';
        }
        if (lower.includes('go to') || lower.includes('navigate') || lower.includes('visit') || lower.match(/https?:\/\//)) {
            return 'navigate_to_page';
        }
        if (lower.includes('fill') || lower.includes('enter') || lower.includes('type')) {
            return 'fill_form';
        }
        if (lower.includes('search') || lower.includes('find')) {
            return 'search';
        }
        return 'unknown';
    }
}

