// Primary Agent: Main Orchestrator
// Coordinates intent recognition and instruction translation

import { IntentRecognizer } from './intent-recognizer';
import { InstructionTranslator, TranslatorContext } from './instruction-translator';
import { ResponseSynthesizer, buildSynthesisDigest } from './response-synthesizer';
import { AnswerJudge, JudgeVerdict } from './answer-judge';
import { UserIntent, AgentInstruction } from '../shared/types';
import { AgentStreamHooks } from '../shared/streaming';
import { PrimaryAgentConfig, PrimaryAgentResponse, InstructionGenerationResult } from './types';

/** Maximum number of independent chat histories kept in memory. */
const MAX_CHATS = 50;
/** Maximum messages retained per chat. */
const MAX_MESSAGES = 20;
/** Default explore→answer→judge rounds for auto-executed requests. */
const DEFAULT_MAX_ITERATIONS = 4;

export class PrimaryAgent {
    private intentRecognizer: IntentRecognizer;
    private instructionTranslator: InstructionTranslator;
    private responseSynthesizer: ResponseSynthesizer;
    private answerJudge: AnswerJudge;
    private config: PrimaryAgentConfig;
    /**
     * Conversation history per chat. Each chat is independent, so a follow-up
     * in one chat never sees another chat's context.
     */
    private chats = new Map<string, Array<{role: string, content: string}>>();

    constructor(config?: Partial<PrimaryAgentConfig>) {
        this.config = {
            model: config?.model || 'google/gemma-4-12b-qat',
            temperature: config?.temperature || 0.3,
            maxInstructions: config?.maxInstructions || 5,
            maxIterations: config?.maxIterations || DEFAULT_MAX_ITERATIONS
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

        this.answerJudge = new AnswerJudge(
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
            maxInstructions: config?.maxInstructions ?? this.config.maxInstructions,
            maxIterations: config?.maxIterations ?? this.config.maxIterations
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

        this.answerJudge = new AnswerJudge(
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
     * Get (creating if needed) the message history for a chat. Evicts the
     * oldest chat once the map grows beyond MAX_CHATS.
     */
    private getChatHistory(chatId?: string): Array<{role: string, content: string}> {
        const key = (chatId || 'default').trim() || 'default';
        let history = this.chats.get(key);
        if (!history) {
            history = [];
            this.chats.set(key, history);
            if (this.chats.size > MAX_CHATS) {
                const oldest = this.chats.keys().next().value;
                if (oldest && oldest !== key) this.chats.delete(oldest);
            }
        }
        return history;
    }

    private trimHistory(history: Array<{role: string, content: string}>): void {
        if (history.length > MAX_MESSAGES) {
            history.splice(0, history.length - MAX_MESSAGES);
        }
    }

    /**
     * Process user input and generate instructions for the secondary agent
     */
    async processUserInput(
        userInput: string,
        currentContext?: TranslatorContext,
        hooks?: AgentStreamHooks,
        signal?: AbortSignal,
        screenshot?: string | null,
        chatId?: string
    ): Promise<PrimaryAgentResponse> {
        const history = this.getChatHistory(chatId);
        try {
            // Step 1: Recognize intent
            hooks?.onPhaseStart?.('intent_recognition');
            const intentResult = await this.intentRecognizer.recognizeIntent(
                userInput,
                history,
                (text) => hooks?.onToken?.('intent_recognition', text),
                (text) => hooks?.onThinking?.('intent_recognition', text),
                signal
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
                (text) => hooks?.onThinking?.('instruction_generation', text),
                signal,
                history,
                screenshot
            );
            hooks?.onPhaseEnd?.('instruction_generation');

            // Update this chat's conversation history
            history.push(
                { role: 'user', content: userInput },
                { role: 'assistant', content: `Intent: ${intentResult.intent.intent}. Generated ${instructionResult.instructions.length} instructions.` }
            );
            this.trimHistory(history);

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
     * `recordInHistory` is false for intermediate rounds of the agentic loop,
     * so only the final answer is remembered.
     */
    async synthesizeResponse(
        userInput: string,
        result: PrimaryAgentResponse,
        executionResult: any,
        hooks?: AgentStreamHooks,
        signal?: AbortSignal,
        screenshots?: string[] | null,
        chatId?: string,
        recordInHistory: boolean = true
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
                (text) => hooks?.onThinking?.('response_synthesis', text),
                signal,
                screenshots
            );

            if (answer && recordInHistory) {
                this.recordAnswer(chatId, answer);
            }

            return answer;
        } finally {
            hooks?.onPhaseEnd?.('response_synthesis');
        }
    }

    /**
     * Ask the independent judge sub-agent whether the current answer fully
     * answers the user's question, based on the evidence gathered so far.
     */
    async judgeAnswer(
        userInput: string,
        result: PrimaryAgentResponse,
        executionResult: any,
        currentAnswer: string,
        hooks?: AgentStreamHooks,
        signal?: AbortSignal
    ): Promise<JudgeVerdict> {
        hooks?.onPhaseStart?.('judging');
        try {
            const digest = buildSynthesisDigest({
                userInput,
                intent: result.recognizedIntent,
                instructions: result.generatedInstructions,
                executionResult
            });
            return await this.answerJudge.judge(
                userInput,
                digest,
                currentAnswer,
                (text) => hooks?.onToken?.('judging', text),
                (text) => hooks?.onThinking?.('judging', text),
                signal
            );
        } finally {
            hooks?.onPhaseEnd?.('judging');
        }
    }

    /**
     * Plan another exploration round targeting the information the judge
     * found missing. `lastRoundSummary` tells the planner what failed last
     * round so it does not repeat the mistake.
     */
    async planFollowUp(
        userInput: string,
        currentAnswer: string,
        verdict: JudgeVerdict,
        currentContext?: TranslatorContext,
        hooks?: AgentStreamHooks,
        signal?: AbortSignal,
        screenshot?: string | null,
        lastRoundSummary?: string
    ): Promise<InstructionGenerationResult> {
        hooks?.onPhaseStart?.('instruction_generation');
        try {
            return await this.instructionTranslator.generateFollowUpInstructions(
                userInput,
                currentAnswer,
                verdict,
                currentContext,
                (text) => hooks?.onToken?.('instruction_generation', text),
                (text) => hooks?.onThinking?.('instruction_generation', text),
                signal,
                screenshot,
                lastRoundSummary
            );
        } finally {
            hooks?.onPhaseEnd?.('instruction_generation');
        }
    }

    /** Append a final answer to a chat's history (used once per turn). */
    recordAnswer(chatId: string | undefined, answer: string): void {
        if (!answer) return;
        const history = this.getChatHistory(chatId);
        history.push({ role: 'assistant', content: answer });
        this.trimHistory(history);
    }

    /**
     * Clear one chat's history (or every chat when no id is given).
     */
    clearHistory(chatId?: string): void {
        if (chatId) {
            this.chats.delete(chatId.trim() || 'default');
        } else {
            this.chats.clear();
        }
    }

    /**
     * Get one chat's history, or a map of every chat's history.
     */
    getHistory(chatId?: string): any {
        if (chatId) {
            return [...(this.chats.get(chatId.trim() || 'default') || [])];
        }
        return Object.fromEntries([...this.chats.entries()].map(([id, history]) => [id, [...history]]));
    }
}

