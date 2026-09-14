// Secondary Agent: Main Orchestrator
// Coordinates context understanding and action execution

import { AgentInstruction, AgentContext } from '../shared/types';
import { AgentStreamHooks } from '../shared/streaming';
import { throwIfAborted, isStopError, StopError, abortable, ResumeSignal } from '../shared/stop';
import { detectCaptcha, CaptchaDetection } from '../shared/captcha';
import { ContextManager } from './context-manager';
import { ActionExecutor } from './action-executor';
import { SecondaryAgentConfig, SecondaryAgentResponse, ExecutionResult } from './types';

/**
 * Human-readable message for any thrown value. Some driver errors (e.g. a
 * failed MySQL connection) carry an empty `message`, which previously surfaced
 * as "Error executing instruction X: " — fall back to the error code/name.
 */
function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message || (error as any).code || error.name || 'Unknown error';
    }
    return typeof error === 'string' && error ? error : 'Unknown error';
}

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
     * Update the model configuration in place (recreates the action executor
     * with the new model while keeping the context manager).
     */
    updateConfig(config?: Partial<SecondaryAgentConfig>): void {
        this.config = {
            model: config?.model ?? this.config.model,
            temperature: config?.temperature ?? this.config.temperature,
            maxRetries: config?.maxRetries ?? this.config.maxRetries
        };

        this.actionExecutor = new ActionExecutor(
            this.config.model,
            this.config.temperature,
            this.config.maxRetries
        );
    }

    /**
     * Get a copy of the current configuration
     */
    getConfig(): SecondaryAgentConfig {
        return { ...this.config };
    }

    /**
     * Execute a sequence of instructions
     */
    async executeInstructions(
        instructions: AgentInstruction[],
        hooks?: AgentStreamHooks,
        signal?: AbortSignal,
        resume?: ResumeSignal
    ): Promise<SecondaryAgentResponse> {
        const executionResults: ExecutionResult[] = [];
        const errors: string[] = [];
        let currentContext: AgentContext;
        let stopped = false;
        // URL of a captcha the user already chose to continue past, so the same
        // challenge does not block every subsequent instruction.
        let captchaHandledUrl: string | null = null;

        try {
            // Get initial context
            currentContext = await abortable(this.contextManager.getCurrentContext(), signal);

            // The browser may already be sitting on a challenge page (e.g. from
            // a previous run): wait for it to be solved before starting.
            const initialCaptcha = await this.pauseForCaptchaIfNeeded(currentContext, captchaHandledUrl, hooks, signal, resume);
            captchaHandledUrl = initialCaptcha.handledUrl;
            if (!initialCaptcha.ok) {
                return {
                    executionResults,
                    finalContext: currentContext,
                    success: false,
                    captcha: true,
                    message: 'A bot check is showing and was not solved in time',
                    errors: ['Bot check was not solved in time']
                };
            }

            hooks?.onPhaseStart?.('execution');

            // Execute each instruction sequentially
            for (const instruction of instructions) {
                throwIfAborted(signal);

                try {
                    // Analyze context for this instruction
                    const contextAnalysis = await abortable(
                        this.contextManager.analyzeContextForInstruction(instruction),
                        signal
                    );

                    // Execute the instruction
                    const result = await this.actionExecutor.executeInstruction(instruction, contextAnalysis, hooks, signal);

                    executionResults.push(result);

                    // Update context if instruction succeeded
                    if (result.success && result.newContext) {
                        currentContext = result.newContext as AgentContext;

                        // A bot check is not a failure: pause, let the user solve
                        // it, then continue where we left off.
                        const captcha = await this.pauseForCaptchaIfNeeded(currentContext, captchaHandledUrl, hooks, signal, resume);
                        captchaHandledUrl = captcha.handledUrl;
                        if (!captcha.ok) {
                            hooks?.onPhaseEnd?.('execution');
                            return {
                                executionResults,
                                finalContext: currentContext,
                                success: false,
                                captcha: true,
                                message: 'A bot check appeared and was not solved in time',
                                errors: [...errors, 'Bot check was not solved in time']
                            };
                        }
                    }

                    // If instruction failed, log error but continue
                    if (!result.success) {
                        errors.push(`Instruction ${instruction.id} failed: ${result.error}`);
                    }

                } catch (error) {
                    if (isStopError(error) || signal?.aborted) {
                        stopped = true;
                        console.log('⏹ Execution stopped by user');
                        break;
                    }
                    const errorMessage = describeError(error);
                    errors.push(`Error executing instruction ${instruction.id}: ${errorMessage}`);
                    
                    executionResults.push({
                        success: false,
                        instructionId: instruction.id,
                        action: instruction.action,
                        error: errorMessage
                    });
                }
            }

            if (stopped) {
                hooks?.onPhaseEnd?.('execution');
                return {
                    executionResults,
                    finalContext: await this.contextManager.getCurrentContext().catch(() => ({
                        currentUrl: '',
                        currentPageTitle: '',
                        availableElements: [],
                        dbSchema: { tables: { scraped_pages: { columns: [] }, elements: { columns: [] }, context: { columns: [] } } }
                    })),
                    success: false,
                    stopped: true,
                    message: 'Execution stopped by user',
                    errors: [...errors, 'Execution stopped by user']
                };
            }

            // Final context update
            currentContext = await abortable(this.contextManager.getCurrentContext(), signal);

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
            const errorMessage = describeError(error);
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
                stopped: isStopError(error) || signal?.aborted,
                message: isStopError(error) || signal?.aborted
                    ? 'Execution stopped by user'
                    : `Execution failed: ${errorMessage}`,
                errors: [errorMessage]
            };
        }
    }

    /**
     * Detect a bot check on the given context and pause for the user when one
     * appears. Returns whether execution may continue, plus the URL that has
     * been handled (so the same challenge does not block later instructions).
     */
    private async pauseForCaptchaIfNeeded(
        context: AgentContext,
        handledUrl: string | null,
        hooks?: AgentStreamHooks,
        signal?: AbortSignal,
        resume?: ResumeSignal
    ): Promise<{ ok: boolean; handledUrl: string | null }> {
        const detection = detectCaptcha({
            url: context.currentUrl,
            title: context.currentPageTitle,
            text: context.pageText
        });
        if (!detection.detected) {
            return { ok: true, handledUrl };
        }
        if (context.currentUrl && context.currentUrl === handledUrl) {
            // The user already chose to continue past this challenge.
            return { ok: true, handledUrl };
        }
        const solved = await this.waitForCaptchaResolution(detection, hooks, signal, resume);
        return { ok: solved, handledUrl: context.currentUrl || handledUrl };
    }

    /**
     * Wait for a CAPTCHA / bot check to be solved manually. Polls a lightweight
     * page signature until the challenge disappears, the user explicitly asks
     * to continue, or the timeout elapses.
     */
    private async waitForCaptchaResolution(
        detection: CaptchaDetection,
        hooks?: AgentStreamHooks,
        signal?: AbortSignal,
        resume?: ResumeSignal
    ): Promise<boolean> {
        const timeoutMs = 10 * 60 * 1000;
        const deadline = Date.now() + timeoutMs;
        console.log(`🤖 Bot check detected (${detection.provider || 'unknown'}); waiting for manual solve...`);
        hooks?.onNotice?.(
            'captcha',
            'A bot check (CAPTCHA) appeared. Solve it in the browser window — the agent will continue automatically once it clears, or click Continue.',
            { provider: detection.provider, reason: detection.reason, timeoutMs }
        );

        while (Date.now() < deadline) {
            throwIfAborted(signal);

            if (resume?.requested) {
                // Consume this Continue click so a later challenge waits again.
                resume.requested = false;
                console.log('▶ Continue requested by user after bot check.');
                hooks?.onNotice?.('captcha_cleared', 'Continuing after manual confirmation.');
                return true;
            }

            await abortable(new Promise(resolve => setTimeout(resolve, 2000)), signal);

            let summary: { url: string; title: string; text: string } | null = null;
            try {
                summary = await abortable(this.contextManager.getPageSummary(), signal);
            } catch (error) {
                if (isStopError(error) || signal?.aborted) throw error;
                // Transient page error — keep polling.
            }

            if (summary && !detectCaptcha({ url: summary.url, title: summary.title, text: summary.text }).detected) {
                console.log('✅ Bot check cleared; continuing execution.');
                hooks?.onNotice?.('captcha_cleared', 'Bot check solved — continuing.');
                return true;
            }
        }

        console.warn('⌛ Bot check was not solved in time.');
        hooks?.onNotice?.('captcha_timeout', 'The bot check was not solved in time.');
        return false;
    }

    /**
     * Get current context
     */
    async getContext(): Promise<AgentContext> {
        return await this.contextManager.getCurrentContext();
    }
}

