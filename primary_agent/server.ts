// Primary Agent Server
// Runs on port 3001

import express from 'express';
import cors from 'cors';
import { PrimaryAgent } from './agent';
import type { PrimaryAgentConfig, PrimaryAgentResponse } from './types';
import type { JudgeVerdict } from './answer-judge';
import type { AgentInstruction } from '../shared/types';
import { StreamSession, AgentStreamHooks, StreamEvent, activityBus } from '../shared/streaming';
import { fetchLmStudioModelInfo, registerVisionModels, isVisionModel } from '../shared/vision';
import { isStopError, StopError } from '../shared/stop';

// Mirror console output onto the ActivityBus so SSE subscribers (/activity)
// can watch what the server is doing in real time.
function hookConsoleToActivity() {
    const stamp = () => new Date().toLocaleTimeString();
    const methods = ['log', 'info', 'warn', 'error'] as const;
    for (const method of methods) {
        const original = console[method];
        console[method] = (...args: any[]) => {
            original(...args);
            try {
                const text = args.map(a =>
                    typeof a === 'string' ? a :
                        a instanceof Error ? (a.stack || a.message) :
                            JSON.stringify(a)
                ).join(' ');
                activityBus.publish(`[${stamp()}] [${method.toUpperCase()}] ${text}`);
            } catch {
                // never break the server because of the activity bus
            }
        };
    }
}
hookConsoleToActivity();

/**
 * Relay the secondary agent's activity stream into our own ActivityBus so
 * portal subscribers see the whole pipeline (browser actions included).
 * Reconnects automatically if the secondary agent is down or restarts.
 */
async function relaySecondaryActivity() {
    while (true) {
        try {
            const response = await fetch(`${SECONDARY_AGENT_URL}/activity`);
            if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop() || '';
                for (const part of parts) {
                    const line = part.split('\n').find(l => l.startsWith('data: '));
                    if (!line) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        if (event.type === 'log') {
                            activityBus.publish(`[secondary] ${event.text}`);
                        }
                    } catch {
                        // ignore malformed relayed events
                    }
                }
            }
        } catch (error) {
            // Secondary agent not reachable (or stream dropped) — retry shortly.
            console.warn('Activity relay disconnected from secondary, retrying...');
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}
relaySecondaryActivity();

const app = express();
const PORT = process.env.PORT || 3001;
const SECONDARY_AGENT_URL = process.env.SECONDARY_AGENT_URL || 'http://localhost:3002';
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';

app.use(cors());
app.use(express.json());

const agent = new PrimaryAgent();
const DEFAULT_MODEL = agent.getConfig().model;

// All in-flight processing sessions, aborted by /stop (or client disconnect).
const activeSessions = new Set<AbortController>();

function abortAllSessions(): number {
    for (const controller of activeSessions) {
        controller.abort();
    }
    return activeSessions.size;
}

// Refresh vision-model knowledge at startup (non-blocking).
fetchLmStudioModelInfo(LM_STUDIO_URL)
    .then(info => registerVisionModels(info.visionModels))
    .catch(() => { });

/**
 * Call secondary agent to execute instructions
 */
async function executeInstructions(instructions: AgentInstruction[], secondaryConfig?: any, signal?: AbortSignal) {
    try {
        const response = await fetch(`${SECONDARY_AGENT_URL}/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                instructions,
                config: secondaryConfig
            }),
            signal
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error: any) {
        if (isStopError(error) || signal?.aborted) {
            throw new StopError('Execution stopped by user');
        }
        console.error('Error calling secondary agent:', error);
        throw new Error(`Failed to execute instructions: ${error.message}`);
    }
}

/**
 * Get current context from secondary agent. Bounded by a timeout (and the
 * caller's abort signal) so an unresponsive browser can never hang the whole
 * request — the agent then simply plans without context.
 */
async function getSecondaryContext(signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(8000);
    try {
        const response = await fetch(`${SECONDARY_AGENT_URL}/context`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });

        if (!response.ok) {
            // If context fails, return undefined (agent will work without it)
            return undefined;
        }

        const result = await response.json();
        return result.success ? result.data : undefined;
    } catch (error) {
        // If secondary agent is not available, continue without context
        console.warn('Secondary agent context not available:', error);
        return undefined;
    }
}

/**
 * Execute instructions via the secondary agent's streaming endpoint,
 * relaying its SSE events back to the caller's session.
 */
async function executeInstructionsStreaming(
    instructions: AgentInstruction[],
    secondaryConfig: any,
    session: StreamSession,
    signal?: AbortSignal
): Promise<any> {
    try {
        const response = await fetch(`${SECONDARY_AGENT_URL}/execute/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                instructions,
                config: secondaryConfig
            }),
            signal
        });

        if (!response.ok || !response.body) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalData: any = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';

            for (const part of parts) {
                const dataLine = part.split('\n').find(line => line.startsWith('data: '));
                if (!dataLine) continue;

                let event: StreamEvent;
                try {
                    event = JSON.parse(dataLine.slice(6));
                } catch (parseError) {
                    continue;
                }

                if (event.type === 'done') {
                    finalData = event.data;
                } else if (event.type === 'error') {
                    throw new Error(event.error || 'Execution failed');
                } else {
                    session.forward(event);
                }
            }
        }

        return finalData;
    } catch (error: any) {
        if (isStopError(error) || signal?.aborted) {
            throw new StopError('Execution stopped by user');
        }
        console.error('Error streaming from secondary agent:', error);
        throw new Error(`Failed to execute instructions: ${error.message}`);
    }
}

/**
 * Fetch a screenshot of the secondary agent's current page (non-fatal), used
 * to ground the final answer when the loaded model is vision-capable.
 */
async function getSecondaryScreenshot(signal?: AbortSignal): Promise<string | null> {
    const timeout = AbortSignal.timeout(8000);
    try {
        const response = await fetch(`${SECONDARY_AGENT_URL}/screenshot`, {
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });
        if (!response.ok) return null;
        const payload: any = await response.json();
        return payload.success ? (payload.screenshot || null) : null;
    } catch (error) {
        console.warn('Screenshot not available:', error);
        return null;
    }
}

/**
 * Fetch several viewport screenshots (top to bottom) of the secondary agent's
 * current page, used to ground the final answer when the model is vision-capable.
 */
async function getSecondaryScreenshots(max = 4): Promise<string[]> {
    try {
        const response = await fetch(`${SECONDARY_AGENT_URL}/screenshots?max=${max}`, {
            signal: AbortSignal.timeout(25000)
        });
        if (!response.ok) return [];
        const payload: any = await response.json();
        return Array.isArray(payload.screenshots) ? payload.screenshots : [];
    } catch (error) {
        console.warn('Screenshots not available:', error);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

interface AgenticFlowOptions {
    userInput: string;
    context?: any;
    chatId?: string;
    signal: AbortSignal;
    hooks?: AgentStreamHooks;
    onNotice?: (kind: string, message: string, data?: any) => void;
    execute: (instructions: AgentInstruction[]) => Promise<any>;
    getPlanningScreenshot: () => Promise<string | null>;
    getAnswerScreenshots: () => Promise<string[]>;
}

interface AgenticFlowResult {
    result: PrimaryAgentResponse;
    executionResult: any;
    finalResponse?: string;
    iterations: number;
    judged: boolean;
    judgeVerdict?: JudgeVerdict;
    screenshots: string[];
    stopped?: boolean;
}

/**
 * Compact summary of a round's per-action outcomes (used to tell the next
 * round what failed, so it does not repeat the mistake).
 */
function summarizeRound(round: { instructions: AgentInstruction[]; executionResult: any }): string {
    const er = round.executionResult?.data || round.executionResult;
    const results = er?.executionResults || [];
    const insts = round.instructions || [];
    if (results.length === 0) return '';
    return results.map((r: any, i: number) => {
        const target = String(insts[i]?.target || '').slice(0, 60);
        const label = r.action === 'extract' ? 'extract' : `${r.action}${target ? ` "${target}"` : ''}`;
        return `- ${label}: ${r.success ? 'ok' : 'FAILED'}${r.error ? ` — ${String(r.error).slice(0, 140)}` : ''}`;
    }).join('\n');
}

/**
 * Run the explore → execute → answer → judge loop. The judge (an independent
 * sub-agent) decides whether the answer is complete; while it is not, the
 * agent plans another exploration round against what the judge found missing,
 * up to `config.maxIterations` rounds.
 */
async function runAgenticFlow(options: AgenticFlowOptions): Promise<AgenticFlowResult> {
    const {
        userInput, chatId, signal, hooks, onNotice,
        execute, getPlanningScreenshot, getAnswerScreenshots
    } = options;
    let context = options.context;

    const planningScreenshot = await getPlanningScreenshot();
    const result = await agent.processUserInput(userInput, context, hooks, signal, planningScreenshot, chatId);

    if (result.requiresUserClarification) {
        return { result, executionResult: null, iterations: 0, judged: false, screenshots: [] };
    }

    const maxIterations = Math.max(1, agent.getConfig().maxIterations || 1);
    const rounds: Array<{ instructions: AgentInstruction[]; executionResult: any }> = [];
    let instructions = result.generatedInstructions;
    let finalResponse = '';
    let answerScreenshots: string[] = [];
    let judgeVerdict: JudgeVerdict | undefined;
    let iterations = 0;

    try {
        while (iterations < maxIterations && instructions.length > 0) {
            iterations++;

            let executionResult: any;
            try {
                executionResult = await execute(instructions);
            } catch (error: any) {
                if (isStopError(error) || signal.aborted) throw error;
                console.error('Auto-execution failed:', error);
                executionResult = {
                    success: false,
                    error: error.message,
                    message: 'Instructions generated but execution failed'
                };
            }
            rounds.push({ instructions, executionResult });
            const accumulated = { rounds };

            answerScreenshots = await getAnswerScreenshots();
            finalResponse = await agent.synthesizeResponse(
                userInput, result, accumulated, hooks, signal, answerScreenshots, chatId, false
            );

            judgeVerdict = await agent.judgeAnswer(userInput, result, accumulated, finalResponse || '', hooks, signal);
            if (judgeVerdict.answered || iterations >= maxIterations) break;

            const missing = judgeVerdict.missing.join('; ') || judgeVerdict.nextStep || 'the requested information';
            console.log(`↻ Answer incomplete (round ${iterations}/${maxIterations}): ${missing}`);
            onNotice?.(
                'iteration',
                `Answer incomplete (round ${iterations}/${maxIterations}) — exploring more: ${missing}`,
                { iteration: iterations, maxIterations, missing: judgeVerdict.missing, nextStep: judgeVerdict.nextStep }
            );

            // Plan the next round against the page the browser is now on.
            const fresh = await getSecondaryContext(signal);
            if (fresh) {
                context = {
                    url: fresh.currentUrl,
                    pageTitle: fresh.currentPageTitle,
                    recentPages: fresh.recentPages,
                    availableElements: fresh.availableElements,
                    pageText: fresh.pageText
                };
            }
            const followUp = await agent.planFollowUp(
                userInput, finalResponse || '', judgeVerdict, context, hooks, signal,
                await getPlanningScreenshot(),
                summarizeRound(rounds[rounds.length - 1])
            );
            instructions = followUp.instructions;

            // Deterministic recovery: a failed in-page action means the target
            // is not on this page (e.g. we clicked into a detail page). Go back
            // to the previous page before retrying instead of repeating the
            // same failing click.
            const lastRound = rounds[rounds.length - 1];
            const lastEr = lastRound.executionResult?.data || lastRound.executionResult;
            const failedInPage = (lastEr?.executionResults || []).some(
                (r: any) => !r.success && (r.action === 'click' || r.action === 'fill')
            );
            if (failedInPage && !instructions.some(i => i.action === 'navigate') && context?.recentPages?.length) {
                const prev = context.recentPages.find((p: any) => p.url && p.url !== context?.url);
                if (prev?.url) {
                    console.log(`↩ Returning to previous page before retrying: ${prev.url}`);
                    instructions = [
                        {
                            id: `back_${Date.now()}`,
                            action: 'navigate',
                            target: prev.url,
                            reasoning: 'Return to the page that lists the missing item',
                            priority: 'high'
                        },
                        ...instructions
                    ];
                }
            }
        }
    } catch (error: any) {
        if (isStopError(error) || signal.aborted) {
            return { result, executionResult: { rounds }, finalResponse, iterations, judged: false, judgeVerdict, screenshots: answerScreenshots, stopped: true };
        }
        throw error;
    }

    // Only the final answer is remembered in the chat history.
    agent.recordAnswer(chatId, finalResponse);

    return {
        result,
        executionResult: { rounds },
        finalResponse,
        iterations,
        judged: !!judgeVerdict?.answered,
        judgeVerdict,
        screenshots: answerScreenshots
    };
}

// Stop any running processing sessions (and the secondary's executions)
app.post('/stop', async (req, res) => {
    const stoppedLocal = abortAllSessions();

    // Forward to the secondary agent so the actual browser execution stops.
    let stoppedRemote = 0;
    try {
        const response = await fetch(`${SECONDARY_AGENT_URL}/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(5000)
        });
        const payload: any = await response.json().catch(() => ({}));
        stoppedRemote = payload.stopped || 0;
    } catch (error) {
        console.warn('Could not reach secondary agent to stop execution:', error);
    }

    console.log(`⏹ Stop requested: aborted ${stoppedLocal} local session(s), ${stoppedRemote} remote execution(s)`);
    res.json({
        success: true,
        stoppedLocal,
        stoppedRemote,
        message: stoppedLocal + stoppedRemote > 0
            ? 'Stop signal sent to running executions'
            : 'No executions were running'
    });
});

/**
 * Forward a request to the secondary agent (used by the portal's browser
 * controls so the frontend only ever talks to the primary agent).
 */
async function forwardToSecondary(
    path: string,
    options: { method?: string; body?: any; timeoutMs?: number } = {}
) {
    const { method = 'GET', body, timeoutMs = 30000 } = options;
    const response = await fetch(`${SECONDARY_AGENT_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
    });
    const payload: any = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, payload };
}

// Browser status (open/closed + current URL), proxied from the secondary agent
app.get('/browser/status', async (req, res) => {
    try {
        const { payload } = await forwardToSecondary('/browser/status', { timeoutMs: 5000 });
        res.json(payload);
    } catch (error: any) {
        res.json({ success: false, open: false, url: '', title: '', error: error.message });
    }
});

// Open a browser window if none is running
app.post('/browser/open', async (req, res) => {
    try {
        const { ok, payload } = await forwardToSecondary('/browser/open', { method: 'POST', timeoutMs: 30000 });
        res.status(ok ? 200 : 502).json(payload);
    } catch (error: any) {
        res.status(502).json({ success: false, error: error.message || 'Failed to open browser' });
    }
});

// Directly navigate the browser (or run a search) from the portal's URL bar
app.post('/navigate', async (req, res) => {
    try {
        const { ok, payload } = await forwardToSecondary('/navigate', {
            method: 'POST',
            body: req.body || {},
            timeoutMs: 90000
        });
        res.status(ok ? 200 : 502).json(payload);
    } catch (error: any) {
        res.status(502).json({ success: false, error: error.message || 'Navigation failed' });
    }
});

// Continue executions paused on a CAPTCHA (user solved it manually)
app.post('/resume', async (req, res) => {
    try {
        const { ok, payload } = await forwardToSecondary('/resume', { method: 'POST', timeoutMs: 5000 });
        res.status(ok ? 200 : 502).json(payload);
    } catch (error: any) {
        res.status(502).json({ success: false, error: error.message || 'Failed to resume' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', agent: 'primary', port: PORT });
});

// List the models available in LM Studio (with loaded + vision detection)
app.get('/models', async (req, res) => {
    try {
        const info = await fetchLmStudioModelInfo(LM_STUDIO_URL);
        res.json({
            success: true,
            models: info.models,
            defaultModel: info.loadedModel || DEFAULT_MODEL,
            loadedModel: info.loadedModel,
            loadedModels: info.loadedModels,
            visionModels: info.visionModels
        });
    } catch (error: any) {
        console.error('Error listing LM Studio models:', error);
        res.status(502).json({
            success: false,
            error: `Failed to list models from LM Studio: ${error.message}`,
            models: [],
            defaultModel: DEFAULT_MODEL,
            loadedModel: null,
            loadedModels: [],
            visionModels: []
        });
    }
});

// Process user input and generate instructions
app.post('/process', async (req, res) => {
    const abort = new AbortController();
    activeSessions.add(abort);
    try {
        const { 
            userInput, 
            currentContext, 
            config, 
            autoExecute = false,  // Default: just generate instructions
            secondaryConfig,  // Config for secondary agent if autoExecute is true
            chatId  // Independent conversation this request belongs to
        } = req.body;

        if (!userInput || typeof userInput !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'userInput is required and must be a string'
            });
        }

        // Update agent config if provided (preserves conversation history)
        if (config) {
            agent.updateConfig(config);
        }

        // Get current context from secondary agent if not provided
        let context = currentContext;
        if (!context && autoExecute) {
            const secondaryContext = await getSecondaryContext(abort.signal);
            if (secondaryContext) {
                context = {
                    url: secondaryContext.currentUrl,
                    pageTitle: secondaryContext.currentPageTitle,
                    recentPages: secondaryContext.recentPages,
                    availableElements: secondaryContext.availableElements,
                    pageText: secondaryContext.pageText
                };
            }
        }

        // Step 1 + 2: recognize intent, plan, and (when autoExecute is on) run
        // the agentic explore→answer→judge loop. The flow does its own intent
        // recognition, so we must NOT call processUserInput here for
        // auto-executed requests (it would double-record the turn).
        let result: PrimaryAgentResponse;
        let executionResult = null;
        let finalResponse: string | undefined;
        let answerScreenshots: string[] = [];
        let iterations = 0;
        let judged = false;
        let judgeVerdict: JudgeVerdict | undefined;

        if (autoExecute) {
            const flow = await runAgenticFlow({
                userInput,
                context,
                chatId,
                signal: abort.signal,
                execute: (instructions) => executeInstructions(instructions, secondaryConfig, abort.signal),
                getPlanningScreenshot: () => isVisionModel(agent.getConfig().model)
                    ? getSecondaryScreenshot(abort.signal)
                    : Promise.resolve(null),
                getAnswerScreenshots: () => isVisionModel(agent.getConfig().model)
                    ? getSecondaryScreenshots(4)
                    : Promise.resolve([])
            });
            result = flow.result;

            if (flow.stopped) {
                return res.json({
                    success: false,
                    stopped: true,
                    data: {
                        ...result,
                        executionResult: undefined,
                        executed: false,
                        finalResponse: 'Execution stopped by user'
                    },
                    message: 'Execution stopped by user'
                });
            }

            executionResult = flow.executionResult;
            finalResponse = flow.finalResponse;
            answerScreenshots = flow.screenshots;
            iterations = flow.iterations;
            judged = flow.judged;
            judgeVerdict = flow.judgeVerdict;
        } else {
            // Non-executed requests plan without a screenshot (matches the
            // pre-agentic behaviour).
            result = await agent.processUserInput(userInput, context, undefined, abort.signal, null, chatId);
        }

        // If clarification is needed, return early
        if (result.requiresUserClarification) {
            return res.json({
                success: false,
                requiresClarification: true,
                data: {
                    recognizedIntent: result.recognizedIntent,
                    clarificationQuestions: result.clarificationQuestions,
                    message: 'User input requires clarification'
                }
            });
        }

        res.json({
            success: true,
            data: {
                ...result,
                executionResult: executionResult ? executionResult.data || executionResult : undefined,
                executed: autoExecute && result.generatedInstructions.length > 0,
                finalResponse,
                screenshots: answerScreenshots,
                iterations,
                judged,
                judgeVerdict
            }
        });

    } catch (error: any) {
        if (isStopError(error) || abort.signal.aborted) {
            console.log('⏹ Request stopped by user');
            return res.json({
                success: false,
                stopped: true,
                message: 'Execution stopped by user'
            });
        }
        console.error('Primary agent error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to process user input'
        });
    } finally {
        activeSessions.delete(abort);
    }
});

// Stream user input processing (SSE) with live token output and ETA
app.post('/process/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let finished = false;
    const send = (event: StreamEvent) => {
        if (!closed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const session = new StreamSession(send, () => { closed = true; res.end(); });
    const hooks: AgentStreamHooks = {
        onPhaseStart: (phase) => session.startPhase(phase),
        onToken: (phase, text) => session.token(phase, text),
        onThinking: (phase, text) => session.thinking(phase, text),
        onPhaseEnd: (phase) => session.endPhase(phase),
    };

    // Abort the whole pipeline when the client disconnects (tab closed, stop
    // button) so no ghost run keeps executing in the background.
    const abort = new AbortController();
    activeSessions.add(abort);

    const keepAlive = setInterval(() => {
        if (!closed) res.write(': ping\n\n');
    }, 15000);
    res.on('close', () => {
        closed = true;
        clearInterval(keepAlive);
        if (!finished) abort.abort();
    });

    try {
        const {
            userInput,
            currentContext,
            config,
            autoExecute = false,
            secondaryConfig,
            chatId
        } = req.body;

        if (!userInput || typeof userInput !== 'string') {
            session.error('userInput is required and must be a string');
            return;
        }

        console.log(`▶ Request: "${userInput.slice(0, 80)}"${autoExecute ? ' [auto-execute]' : ''}`);

        // Update agent config if provided (preserves conversation history)
        if (config) {
            agent.updateConfig(config);
        }

        let context = currentContext;
        if (!context && autoExecute) {
            const secondaryContext = await getSecondaryContext(abort.signal);
            if (secondaryContext) {
                context = {
                    url: secondaryContext.currentUrl,
                    pageTitle: secondaryContext.currentPageTitle,
                    recentPages: secondaryContext.recentPages,
                    availableElements: secondaryContext.availableElements,
                    pageText: secondaryContext.pageText
                };
            }
        }

        // Intent recognition, planning and (for autoExecute) the agentic loop
        // all happen inside runAgenticFlow — calling processUserInput here
        // too would double-record the turn in the chat history.
        let result: PrimaryAgentResponse;
        let executionResult = null;
        let finalResponse: string | undefined;
        let answerScreenshots: string[] = [];
        let iterations = 0;
        let judged = false;
        let judgeVerdict: JudgeVerdict | undefined;

        if (autoExecute) {
            const flow = await runAgenticFlow({
                userInput,
                context,
                chatId,
                signal: abort.signal,
                hooks,
                onNotice: (kind, message, data) => session.notice(kind, message, data),
                execute: (instructions) => executeInstructionsStreaming(instructions, secondaryConfig, session, abort.signal),
                getPlanningScreenshot: () => isVisionModel(agent.getConfig().model)
                    ? getSecondaryScreenshot(abort.signal)
                    : Promise.resolve(null),
                getAnswerScreenshots: () => isVisionModel(agent.getConfig().model)
                    ? getSecondaryScreenshots(4)
                    : Promise.resolve([])
            });
            result = flow.result;

            if (flow.stopped) {
                console.log('⏹ Execution stopped by user');
                session.done({
                    success: false,
                    stopped: true,
                    recognizedIntent: result.recognizedIntent,
                    generatedInstructions: result.generatedInstructions,
                    executed: false,
                    finalResponse: 'Execution stopped by user'
                });
                return;
            }

            executionResult = flow.executionResult;
            finalResponse = flow.finalResponse;
            answerScreenshots = flow.screenshots;
            iterations = flow.iterations;
            judged = flow.judged;
            judgeVerdict = flow.judgeVerdict;
        } else {
            // Non-executed requests plan without a screenshot (matches the
            // pre-agentic behaviour).
            result = await agent.processUserInput(userInput, context, hooks, abort.signal, null, chatId);
        }

        console.log(`✓ Intent: ${result.recognizedIntent.intent} (${Math.round(result.confidence * 100)}%) → ${result.generatedInstructions.length} instruction(s)`);

        if (result.requiresUserClarification) {
            session.done({
                success: false,
                requiresClarification: true,
                recognizedIntent: result.recognizedIntent,
                clarificationQuestions: result.clarificationQuestions,
                message: 'User input requires clarification'
            });
            return;
        }

        console.log(`✓ Request complete (${autoExecute ? 'executed' : 'instructions generated'})${iterations > 1 ? ` in ${iterations} exploration round(s)` : ''}${judged ? ', judge satisfied' : ''}`);
        session.done({
            success: true,
            recognizedIntent: result.recognizedIntent,
            generatedInstructions: result.generatedInstructions,
            confidence: result.confidence,
            reasoning: result.reasoning,
            executionResult: executionResult ? executionResult.data || executionResult : undefined,
            executed: autoExecute && result.generatedInstructions.length > 0,
            finalResponse,
            screenshots: answerScreenshots,
            iterations,
            judged,
            judgeVerdict
        });

    } catch (error: any) {
        if (isStopError(error) || abort.signal.aborted) {
            console.log('⏹ Request stopped by user');
            session.done({
                success: false,
                stopped: true,
                message: 'Execution stopped by user',
                finalResponse: 'Execution stopped by user'
            });
            return;
        }
        console.error('Primary agent streaming error:', error);
        session.error(error.message || 'Failed to process user input');
    } finally {
        finished = true;
        clearInterval(keepAlive);
        activeSessions.delete(abort);
    }
});

// Live activity stream (SSE) — broadcasts server console output
app.get('/activity', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    const send = (line: string) => {
        if (!closed) res.write(`data: ${JSON.stringify({ type: 'log', text: line, timestamp: Date.now() })}\n\n`);
    };
    const unsubscribe = activityBus.subscribe(send);
    send(`[${new Date().toLocaleTimeString()}] [INFO] connected to activity stream`);

    const keepAlive = setInterval(() => {
        if (!closed) res.write(': ping\n\n');
    }, 15000);
    res.on('close', () => {
        closed = true;
        unsubscribe();
        clearInterval(keepAlive);
    });
});

// Clear conversation history (one chat when chatId is given, otherwise all)
app.post('/clear-history', (req, res) => {
    try {
        const chatId = req.body?.chatId || req.query?.chatId;
        agent.clearHistory(chatId ? String(chatId) : undefined);
        res.json({
            success: true,
            message: chatId ? 'Chat history cleared' : 'All conversation history cleared'
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to clear history'
        });
    }
});

// Get conversation history (one chat when chatId is given, otherwise all chats)
app.get('/history', (req, res) => {
    try {
        const chatId = req.query?.chatId;
        const history = agent.getHistory(chatId ? String(chatId) : undefined);
        res.json({
            success: true,
            data: history
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get history'
        });
    }
});

app.listen(PORT, () => {
    console.log(`🤖 Primary Agent server running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Process: POST http://localhost:${PORT}/process`);
    console.log(`   Stream:  POST http://localhost:${PORT}/process/stream`);
    console.log(`   Stop:    POST http://localhost:${PORT}/stop`);
    console.log(`   Secondary Agent URL: ${SECONDARY_AGENT_URL}`);
    console.log(`   Auto-execution: Enable with "autoExecute: true" in request body`);
});

