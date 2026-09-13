// Secondary Agent Server
// Runs on port 3002

import express from 'express';
import cors from 'cors';
import { SecondaryAgent } from './agent';
import type { SecondaryAgentConfig } from './types';
import type { AgentInstruction } from '@/shared/types';
import { StreamSession, AgentStreamHooks, StreamEvent, activityBus } from '@/shared/streaming';

// Mirror console output onto the ActivityBus so the primary agent's relay (and
// any direct subscriber) can watch what this agent is doing in real time.
const ACTIVITY_METHODS = ['log', 'info', 'warn', 'error'] as const;
for (const method of ACTIVITY_METHODS) {
    const original = console[method];
    console[method] = (...args: any[]) => {
        original(...args);
        try {
            const text = args.map(a =>
                typeof a === 'string' ? a :
                    a instanceof Error ? (a.stack || a.message) :
                        JSON.stringify(a)
            ).join(' ');
            activityBus.publish(`[${new Date().toLocaleTimeString()}] [${method.toUpperCase()}] ${text}`);
        } catch {
            // never break the agent because of the activity bus
        }
    };
}

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

const agent = new SecondaryAgent();

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', agent: 'secondary', port: PORT });
});

// Get current context
app.get('/context', async (req, res) => {
    try {
        const context = await agent.getContext();
        res.json({
            success: true,
            data: context
        });
    } catch (error: any) {
        console.error('Error getting context:', error);
        // Return empty context instead of error if browser is not initialized
        if (error.message && error.message.includes('Browser not initialized')) {
            res.json({
                success: true,
                data: {
                    currentUrl: '',
                    currentPageTitle: '',
                    availableElements: [],
                    dbSchema: {
                        tables: {
                            scraped_pages: { columns: [] },
                            elements: { columns: [] },
                            context: { columns: [] }
                        }
                    },
                    sessionContext: {}
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get context'
            });
        }
    }
});

// Execute instructions
app.post('/execute', async (req, res) => {
    try {
        const { instructions, config } = req.body;

        if (!instructions || !Array.isArray(instructions)) {
            return res.status(400).json({
                success: false,
                error: 'instructions is required and must be an array'
            });
        }

        // Update agent config if provided
        if (config) {
            Object.assign(agent, new SecondaryAgent(config));
        }

        const result = await agent.executeInstructions(instructions as AgentInstruction[]);

        res.json({
            success: result.success,
            data: result
        });

    } catch (error: any) {
        console.error('Secondary agent error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to execute instructions'
        });
    }
});

// Execute instructions with live streaming (SSE)
app.post('/execute/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    const send = (event: StreamEvent) => {
        if (!closed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const session = new StreamSession(
        send,
        () => { closed = true; res.end(); },
        ['execution', 'selector_resolution']
    );
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
        const { instructions, config } = req.body;

        if (!instructions || !Array.isArray(instructions)) {
            session.error('instructions is required and must be an array');
            return;
        }

        if (config) {
            Object.assign(agent, new SecondaryAgent(config));
        }

        const result = await agent.executeInstructions(instructions as AgentInstruction[], hooks);
        session.done(result);

    } catch (error: any) {
        console.error('Secondary agent streaming error:', error);
        session.error(error.message || 'Failed to execute instructions');
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

app.listen(PORT, () => {
    console.log(`🤖 Secondary Agent server running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Context: GET http://localhost:${PORT}/context`);
    console.log(`   Execute: POST http://localhost:${PORT}/execute`);
    console.log(`   Stream:  POST http://localhost:${PORT}/execute/stream`);
    console.log(`   Activity: GET http://localhost:${PORT}/activity`);
});

