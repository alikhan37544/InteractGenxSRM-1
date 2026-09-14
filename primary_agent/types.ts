// Types specific to the primary agent (User Interaction Layer)

import { UserIntent, AgentInstruction } from '../shared/types';

export interface PrimaryAgentConfig {
    model: string;
    temperature: number;
    maxInstructions?: number;
    /** Max explore→answer→judge rounds for auto-executed requests (default 4). */
    maxIterations?: number;
}

export interface IntentRecognitionResult {
    intent: UserIntent;
    requiresClarification: boolean;
    clarificationQuestions?: string[];
}

export interface InstructionGenerationResult {
    instructions: AgentInstruction[];
    confidence: number;
    reasoning: string;
}

export interface PrimaryAgentResponse {
    recognizedIntent: UserIntent;
    generatedInstructions: AgentInstruction[];
    confidence: number;
    reasoning: string;
    requiresUserClarification?: boolean;
    clarificationQuestions?: string[];
}

