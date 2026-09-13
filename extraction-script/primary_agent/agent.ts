// Primary Agent: Main Orchestrator
// Coordinates intent recognition and instruction translation

import { IntentRecognizer } from './intent-recognizer';
import { InstructionTranslator } from './instruction-translator';
import { ResponseSynthesizer } from './response-synthesizer';
import { UserIntent, AgentInstruction } from '@/shared/types';
import { AgentStreamHooks } from '@/shared/streaming';
import { PrimaryAgentConfig, PrimaryAgentResponse } from './types';

export class PrimaryAgent {
    private intentRecognizer: IntentRecognizer;
    private instructionTranslator: InstructionTranslator;
    private responseSynthesizer: ResponseSynthesizer;
    private config: PrimaryAgentConfig;
    private conversationHistory: Array<{role: string, content: string}> = [];

    constructor(config?: Partial<PrimaryAgentConfig>) {
        this.config = {
            model: config?.model || 'google/gemma-4-12b-qat',
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

        this.responseSynthesizer = new ResponseSynthesizer(
            this.config.model,
            this.config.temperature
        );
    }

    /**
     * Update the model configuration in place. Unlike replacing the instance
     * (e.g. Object.assign with a new PrimaryAgent), this preserves the
     * conversation history.
     */
    updateConfig(config?: Partial<PrimaryAgentConfig>): void {
        this.config = {
            model: config?.model ?? this.config.model,
            temperature: config?.temperature ?? this.config.temperature,
            maxInstructions: config?.maxInstructions ?? this.config.maxInstructions
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

        this.responseSynthesizer = new ResponseSynthesizer(
            this.config.model,
            this.config.temperature
        );
    }

    /**
     * Get a copy of the current configuration
     */
    getConfig(): PrimaryAgentConfig {
        return { ...this.config };
    }

    /**
     * Process user input and generate instructions for the secondary agent
     */
    async processUserInput(
        userInput: string,
        currentContext?: { url?: string; pageTitle?: string },
        hooks?: AgentStreamHooks
    ): Promise<PrimaryAgentResponse> {
        try {
            // Step 1: Recognize intent
            hooks?.onPhaseStart?.('intent_recognition');
            const intentResult = await this.intentRecognizer.recognizeIntent(
                userInput,
                this.conversationHistory,
                (text) => hooks?.onToken?.('intent_recognition', text),
                (text) => hooks?.onThinking?.('intent_recognition', text)
            );
            hooks?.onPhaseEnd?.('intent_recognition');

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
            hooks?.onPhaseStart?.('instruction_generation');
            const instructionResult = await this.instructionTranslator.translateIntentToInstructions(
                intentResult.intent,
                currentContext,
                (text) => hooks?.onToken?.('instruction_generation', text),
                (text) => hooks?.onThinking?.('instruction_generation', text)
            );
            hooks?.onPhaseEnd?.('instruction_generation');

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
     * Synthesize a direct, user-facing answer from the execution results.
     */
    async synthesizeResponse(
        userInput: string,
        result: PrimaryAgentResponse,
        executionResult: any,
        hooks?: AgentStreamHooks
    ): Promise<string> {
        hooks?.onPhaseStart?.('response_synthesis');
        try {
            const answer = await this.responseSynthesizer.synthesize(
                {
                    userInput,
                    intent: result.recognizedIntent,
                    instructions: result.generatedInstructions,
                    executionResult
                },
                (text) => hooks?.onToken?.('response_synthesis', text),
                (text) => hooks?.onThinking?.('response_synthesis', text)
            );

            if (answer) {
                this.conversationHistory.push({ role: 'assistant', content: answer });
                if (this.conversationHistory.length > 20) {
                    this.conversationHistory = this.conversationHistory.slice(-20);
                }
            }

            return answer;
        } finally {
            hooks?.onPhaseEnd?.('response_synthesis');
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

