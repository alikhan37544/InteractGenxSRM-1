// Primary Agent: Main Orchestrator
// Coordinates intent recognition and instruction translation

import { IntentRecognizer } from './intent-recognizer';
import { InstructionTranslator } from './instruction-translator';
import { UserIntent, AgentInstruction } from '../shared/types';
import { PrimaryAgentConfig, PrimaryAgentResponse } from './types';

export class PrimaryAgent {
    private intentRecognizer: IntentRecognizer;
    private instructionTranslator: InstructionTranslator;
    private config: PrimaryAgentConfig;
    private conversationHistory: Array<{role: string, content: string}> = [];

    constructor(config?: Partial<PrimaryAgentConfig>) {
        this.config = {
            model: config?.model || 'google/gemma-3-1b-it',
            temperature: config?.temperature || 0.3,
            maxInstructions: config?.maxInstructions || 5
        };

        this.intentRecognizer = new IntentRecognizer(
            this.config.model,
            this.config.temperature
        );

        this.instructionTranslator = new InstructionTranslator(
            this.config.model,
            this.config.temperature,
            this.config.maxInstructions
        );
    }

    /**
     * Process user input and generate instructions for the secondary agent
     */
    async processUserInput(
        userInput: string,
        currentContext?: { url?: string; pageTitle?: string }
    ): Promise<PrimaryAgentResponse> {
        try {
            // Step 1: Recognize intent
            const intentResult = await this.intentRecognizer.recognizeIntent(
                userInput,
                this.conversationHistory
            );

            // Step 2: If clarification is needed, return early
            if (intentResult.requiresClarification) {
                return {
                    recognizedIntent: intentResult.intent,
                    generatedInstructions: [],
                    confidence: intentResult.intent.confidence,
                    reasoning: 'User input requires clarification',
                    requiresUserClarification: true,
                    clarificationQuestions: intentResult.clarificationQuestions
                };
            }

            // Step 3: Translate intent to instructions
            const instructionResult = await this.instructionTranslator.translateIntentToInstructions(
                intentResult.intent,
                currentContext
            );

            // Update conversation history
            this.conversationHistory.push(
                { role: 'user', content: userInput },
                { role: 'assistant', content: `Intent: ${intentResult.intent.intent}. Generated ${instructionResult.instructions.length} instructions.` }
            );

            // Keep history manageable (last 10 exchanges)
            if (this.conversationHistory.length > 20) {
                this.conversationHistory = this.conversationHistory.slice(-20);
            }

            return {
                recognizedIntent: intentResult.intent,
                generatedInstructions: instructionResult.instructions,
                confidence: Math.min(intentResult.intent.confidence, instructionResult.confidence),
                reasoning: instructionResult.reasoning,
                requiresUserClarification: false
            };

        } catch (error) {
            console.error('Primary agent error:', error);
            throw error;
        }
    }

    /**
     * Clear conversation history
     */
    clearHistory(): void {
        this.conversationHistory = [];
    }

    /**
     * Get current conversation history
     */
    getHistory(): Array<{role: string, content: string}> {
        return [...this.conversationHistory];
    }
}

