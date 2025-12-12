// Types specific to the secondary agent (Action Execution Layer)

import { AgentInstruction, AgentContext, PageElement } from '../shared/types';

export interface SecondaryAgentConfig {
    model: string;
    temperature: number;
    maxRetries?: number;
}

export interface ExecutionResult {
    success: boolean;
    instructionId: string;
    action: string;
    result?: any;
    error?: string;
    newContext?: Partial<AgentContext>;
}

export interface ContextAnalysis {
    currentUrl: string;
    currentPageTitle: string;
    availableElements: PageElement[];
    relevantElements: PageElement[]; // Elements relevant to the instruction
    dbElementCount: number;
    hasContext: boolean;
}

export interface SecondaryAgentResponse {
    executionResults: ExecutionResult[];
    finalContext: AgentContext;
    success: boolean;
    message: string;
    errors?: string[];
}

