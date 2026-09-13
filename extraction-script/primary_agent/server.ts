// Primary Agent Server
// Runs on port 3001

import express from 'express';
import cors from 'cors';
import { PrimaryAgent } from './agent';
import type { PrimaryAgentConfig } from './types';
import type { AgentInstruction } from '@/shared/types';
import { StreamSession, AgentStreamHooks, StreamEvent, activityBus } from '@/shared/streaming';

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

app.use(cors());
app.use(express.json());

const agent = new PrimaryAgent();

/**
 * Call secondary agent to execute instructions
 */
async function executeInstructions(instructions: AgentInstruction[], secondaryConfig?: any) {
    try {
        const response = await fetch(`${SECONDARY_AGENT_URL}/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                instructions,
                config: secondaryConfig
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error: any) {
        console.error('Error calling secondary agent:', error);
        throw new Error(`Failed to execute instructions: ${error.message}`);
    }
}

/**
 * Get current context from secondary agent
 */
async function getSecondaryContext() {
    try {
        const response = await fetch(`${SECONDARY_AGENT_URL}/context`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
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
    session: StreamSession
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
            })
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
        console.error('Error streaming from secondary agent:', error);
        throw new Error(`Failed to execute instructions: ${error.message}`);
    }
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', agent: 'primary', port: PORT });
});

// Process user input and generate instructions
app.post('/process', async (req, res) => {
    try {
        const { 
            userInput, 
            currentContext, 
            config, 
            autoExecute = false,  // Default: just generate instructions
            secondaryConfig  // Config for secondary agent if autoExecute is true
        } = req.body;

        if (!userInput || typeof userInput !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'userInput is required and must be a string'
            });
        }

        // Update agent config if provided
        if (config) {
            Object.assign(agent, new PrimaryAgent(config));
        }

        // Get current context from secondary agent if not provided
        let context = currentContext;
        if (!context && autoExecute) {
            const secondaryContext = await getSecondaryContext();
            if (secondaryContext) {
                context = {
                    url: secondaryContext.currentUrl,
                    pageTitle: secondaryContext.currentPageTitle,
                    recentPages: secondaryContext.recentPages
                };
            }
        }

        // Step 1: Process user input and generate instructions
        const result = await agent.processUserInput(userInput, context);

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

        // Step 2: If autoExecute is enabled, execute instructions via secondary agent
        let executionResult = null;
        if (autoExecute && result.generatedInstructions.length > 0) {
            try {
                executionResult = await executeInstructions(result.generatedInstructions, secondaryConfig);
            } catch (error: any) {
                // If execution fails, still return the instructions
                console.error('Auto-execution failed:', error);
                executionResult = {
                    success: false,
                    error: error.message,
                    message: 'Instructions generated but execution failed'
                };
            }
        }

        // Step 3: Synthesize a direct answer from the execution results
        let finalResponse: string | undefined;
        if (autoExecute && result.generatedInstructions.length > 0) {
            try {
                finalResponse = await agent.synthesizeResponse(userInput, result, executionResult);
            } catch (error: any) {
                console.error('Response synthesis failed:', error);
            }
        }

        res.json({
            success: true,
            data: {
                ...result,
                executionResult: executionResult ? executionResult.data || executionResult : undefined,
                executed: autoExecute && result.generatedInstructions.length > 0,
                finalResponse
            }
        });

    } catch (error: any) {
        console.error('Primary agent error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to process user input'
        });
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

    const keepAlive = setInterval(() => {
        if (!closed) res.write(': ping\n\n');
    }, 15000);
    res.on('close', () => { closed = true; clearInterval(keepAlive); });

    try {
        const {
            userInput,
            currentContext,
            config,
            autoExecute = false,
            secondaryConfig
        } = req.body;

        if (!userInput || typeof userInput !== 'string') {
            session.error('userInput is required and must be a string');
            return;
        }

        console.log(`▶ Request: "${userInput.slice(0, 80)}"${autoExecute ? ' [auto-execute]' : ''}`);

        if (config) {
            Object.assign(agent, new PrimaryAgent(config));
        }

        let context = currentContext;
        if (!context && autoExecute) {
            const secondaryContext = await getSecondaryContext();
            if (secondaryContext) {
                context = {
                    url: secondaryContext.currentUrl,
                    pageTitle: secondaryContext.currentPageTitle,
                    recentPages: secondaryContext.recentPages
                };
            }
        }

        const result = await agent.processUserInput(userInput, context, hooks);

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

        let executionResult = null;
        if (autoExecute && result.generatedInstructions.length > 0) {
            console.log(`▶ Executing ${result.generatedInstructions.length} instruction(s) via secondary agent...`);
            try {
                executionResult = await executeInstructionsStreaming(result.generatedInstructions, secondaryConfig, session);
            } catch (error: any) {
                console.error('Auto-execution failed:', error);
                executionResult = {
                    success: false,
                    error: error.message,
                    message: 'Instructions generated but execution failed'
                };
            }
        }

        // Compose a direct answer for the user from what was found.
        let finalResponse: string | undefined;
        if (autoExecute && result.generatedInstructions.length > 0) {
            console.log('▶ Composing answer from results...');
            try {
                finalResponse = await agent.synthesizeResponse(userInput, result, executionResult, hooks);
            } catch (error: any) {
                console.error('Response synthesis failed:', error);
            }
        }

        console.log(`✓ Request complete (${autoExecute ? 'executed' : 'instructions generated'})`);
        session.done({
            success: true,
            recognizedIntent: result.recognizedIntent,
            generatedInstructions: result.generatedInstructions,
            confidence: result.confidence,
            reasoning: result.reasoning,
            executionResult: executionResult ? executionResult.data || executionResult : undefined,
            executed: autoExecute && result.generatedInstructions.length > 0,
            finalResponse
        });

    } catch (error: any) {
        console.error('Primary agent streaming error:', error);
        session.error(error.message || 'Failed to process user input');
    } finally {
        clearInterval(keepAlive);
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

// Clear conversation history
app.post('/clear-history', (req, res) => {
    try {
        agent.clearHistory();
        res.json({
            success: true,
            message: 'Conversation history cleared'
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to clear history'
        });
    }
});

// Get conversation history
app.get('/history', (req, res) => {
    try {
        const history = agent.getHistory();
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
    console.log(`   Secondary Agent URL: ${SECONDARY_AGENT_URL}`);
    console.log(`   Auto-execution: Enable with "autoExecute: true" in request body`);
});

