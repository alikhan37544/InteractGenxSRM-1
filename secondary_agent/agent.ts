// Secondary Agent: Main Orchestrator
// Coordinates context understanding and action execution

import { AgentInstruction, AgentContext } from '../shared/types';
import { AgentStreamHooks } from '../shared/streaming';
import { ContextManager } from './context-manager';
import { ActionExecutor } from './action-executor';
import { SecondaryAgentConfig, SecondaryAgentResponse, ExecutionResult } from './types';

export class SecondaryAgent {
    private contextManager: ContextManager;
    private actionExecutor: ActionExecutor;
    private config: SecondaryAgentConfig;

    constructor(config?: Partial<SecondaryAgentConfig>) {
        this.config = {
            model: config?.model || 'google/gemma-4-12b-qat',
            temperature: config?.temperature || 0.2,
            maxRetries: config?.maxRetries || 2
        };

        this.contextManager = new ContextManager();
        this.actionExecutor = new ActionExecutor(
            this.config.model,
            this.config.temperature,
            this.config.maxRetries
        );
    }

    /**
     * Execute a sequence of instructions
     */
    async executeInstructions(
        instructions: AgentInstruction[],
        hooks?: AgentStreamHooks
    ): Promise<SecondaryAgentResponse> {
        const executionResults: ExecutionResult[] = [];
        const errors: string[] = [];
        let currentContext: AgentContext;

        try {
            // Get initial context
            currentContext = await this.contextManager.getCurrentContext();

            hooks?.onPhaseStart?.('execution');

            // Execute each instruction sequentially
            for (const instruction of instructions) {
                try {
                    // Analyze context for this instruction
                    const contextAnalysis = await this.contextManager.analyzeContextForInstruction(instruction);

                    // Execute the instruction
                    const result = await this.actionExecutor.executeInstruction(instruction, contextAnalysis, hooks);

                    executionResults.push(result);

                    // Update context if instruction succeeded
                    if (result.success && result.newContext) {
                        currentContext = result.newContext as AgentContext;
                    }

                    // If instruction failed, log error but continue
                    if (!result.success) {
                        errors.push(`Instruction ${instruction.id} failed: ${result.error}`);
                    }

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    errors.push(`Error executing instruction ${instruction.id}: ${errorMessage}`);
                    
                    executionResults.push({
                        success: false,
                        instructionId: instruction.id,
                        action: instruction.action,
                        error: errorMessage
                    });
                }
            }

            // Final context update
            currentContext = await this.contextManager.getCurrentContext();

            hooks?.onPhaseEnd?.('execution');

            const allSuccessful = executionResults.every(r => r.success);

            return {
                executionResults,
                finalContext: currentContext,
                success: allSuccessful,
                message: allSuccessful 
                    ? `Successfully executed ${executionResults.length} instruction(s)`
                    : `Executed ${executionResults.length} instruction(s) with ${errors.length} error(s)`,
                errors: errors.length > 0 ? errors : undefined
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('Secondary agent execution error:', error);

            return {
                executionResults,
                finalContext: await this.contextManager.getCurrentContext().catch(() => ({
                    currentUrl: '',
                    currentPageTitle: '',
                    availableElements: [],
                    dbSchema: { tables: { scraped_pages: { columns: [] }, elements: { columns: [] }, context: { columns: [] } } }
                })),
                success: false,
                message: `Execution failed: ${errorMessage}`,
                errors: [errorMessage]
            };
        }
    }

    /**
     * Get current context
     */
    async getContext(): Promise<AgentContext> {
        return await this.contextManager.getCurrentContext();
    }
}

