// Secondary Agent Server
// Runs on port 3002

import express from 'express';
import cors from 'cors';
import { SecondaryAgent } from './agent';
import type { SecondaryAgentConfig } from './types';
import type { AgentInstruction } from '../shared/types';
import { StreamSession, AgentStreamHooks, StreamEvent, activityBus } from '../shared/streaming';
import { fetchLmStudioModelInfo, registerVisionModels, isVisionModel } from '../shared/vision';
import { isStopError, ResumeSignal } from '../shared/stop';
import { normalizeNavigationTarget } from '../shared/url';

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
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';

app.use(cors());
app.use(express.json());

const agent = new SecondaryAgent();
const DEFAULT_MODEL = agent.getConfig().model;

// All in-flight executions, aborted by /stop (or when an SSE client disconnects).
const activeExecutions = new Set<AbortController>();

// Resume flags for executions paused on a CAPTCHA / bot check.
const activeResumes = new Set<ResumeSignal>();

function abortAllExecutions(): number {
    for (const controller of activeExecutions) {
        controller.abort();
    }
    return activeExecutions.size;
}

// Refresh vision-model knowledge at startup (non-blocking) so the first
// execution already knows whether the loaded model can see screenshots.
fetchLmStudioModelInfo(LM_STUDIO_URL)
    .then(info => registerVisionModels(info.visionModels))
    .catch(() => { });

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', agent: 'secondary', port: PORT });
});

// Stop any running executions immediately
app.post('/stop', (req, res) => {
    const stopped = abortAllExecutions();
    console.log(`⏹ Stop requested: aborted ${stopped} running execution(s)`);
    res.json({
        success: true,
        stopped,
        message: stopped > 0
            ? `Stop signal sent to ${stopped} running execution(s)`
            : 'No executions were running'
    });
});

// Resume executions paused on a CAPTCHA (called after the user solves it)
app.post('/resume', (req, res) => {
    for (const resume of activeResumes) {
        resume.requested = true;
    }
    console.log(`▶ Resume requested for ${activeResumes.size} paused execution(s)`);
    res.json({
        success: true,
        resumed: activeResumes.size,
        message: activeResumes.size > 0
            ? 'Continuing paused execution(s)'
            : 'No executions were paused'
    });
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

// Screenshot of the current browser page (used by vision-capable models)
app.get('/screenshot', async (req, res) => {
    try {
        const browserModule = await import('../extraction-script/lib/browser');
        const screenshot = await browserModule.default.takeScreenshot();
        res.json({
            success: !!screenshot,
            screenshot
        });
    } catch (error: any) {
        console.error('Error taking screenshot:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to take screenshot'
        });
    }
});

// Multiple viewport screenshots (top-to-bottom) for vision-model understanding
app.get('/screenshots', async (req, res) => {
    try {
        const max = Math.min(6, Math.max(1, parseInt(String(req.query.max || '4'), 10) || 4));
        const browserModule = await import('../extraction-script/lib/browser');
        const screenshots = await browserModule.default.takeScreenshots(max);
        res.json({ success: screenshots.length > 0, screenshots });
    } catch (error: any) {
        console.error('Error taking screenshots:', error);
        res.status(500).json({ success: false, screenshots: [], error: error.message || 'Failed to take screenshots' });
    }
});

// Browser status — never launches a browser, safe to poll
app.get('/browser/status', async (req, res) => {
    try {
        const browserModule = await import('../extraction-script/lib/browser');
        const browser = browserModule.default;
        const info = await browser.getPageInfo();
        res.json({
            success: true,
            open: browser.isActive(),
            url: info?.url || '',
            title: info?.title || ''
        });
    } catch (error: any) {
        res.json({ success: false, open: false, url: '', title: '', error: error.message });
    }
});

// Open a browser window if none is running (recovers from a user-closed window)
app.post('/browser/open', async (req, res) => {
    try {
        const browserModule = await import('../extraction-script/lib/browser');
        await browserModule.default.init(false);
        const info = await browserModule.default.getPageInfo();
        console.log(`🌐 Browser open at ${info?.url || 'about:blank'}`);
        res.json({ success: true, open: true, url: info?.url || '', title: info?.title || '' });
    } catch (error: any) {
        console.error('Error opening browser:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to open browser' });
    }
});

// Direct navigation (or DuckDuckGo search) from the portal's URL bar
app.post('/navigate', async (req, res) => {
    const abort = new AbortController();
    const resume: ResumeSignal = { requested: false };
    activeExecutions.add(abort);
    activeResumes.add(resume);
    // A disconnected client must not leave a ghost navigation waiting on a
    // CAPTCHA for the full timeout.
    res.on('close', () => {
        if (!res.writableEnded) abort.abort();
    });
    try {
        const { url, query } = req.body || {};
        const raw = (typeof url === 'string' && url.trim())
            ? url.trim()
            : (typeof query === 'string' ? query.trim() : '');
        if (!raw) {
            return res.status(400).json({ success: false, error: 'Provide a url or a query' });
        }
        // Bare domains become https URLs; bare words/phrases become searches.
        const target = normalizeNavigationTarget(raw);

        const result = await agent.executeInstructions(
            [{ id: `nav_${Date.now()}`, action: 'navigate', target, reasoning: 'Manual navigation from the portal', priority: 'high' }],
            undefined,
            abort.signal,
            resume
        );

        if (!result.success) {
            const detail = (result.errors && result.errors[0]) || result.message || 'Navigation failed';
            return res.status(500).json({ success: false, error: detail });
        }

        const ctx = result.finalContext;
        res.json({
            success: true,
            open: true,
            url: ctx.currentUrl,
            title: ctx.currentPageTitle,
            elementCount: ctx.availableElements.length,
            pageTextLength: (ctx.pageText || '').length
        });
    } catch (error: any) {
        if (isStopError(error) || abort.signal.aborted) {
            return res.json({ success: false, stopped: true, error: 'Navigation stopped' });
        }
        console.error('Navigation error:', error);
        res.status(500).json({ success: false, error: error.message || 'Navigation failed' });
    } finally {
        activeExecutions.delete(abort);
        activeResumes.delete(resume);
    }
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
    const abort = new AbortController();
    const resume: ResumeSignal = { requested: false };
    activeExecutions.add(abort);
    activeResumes.add(resume);
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
            agent.updateConfig(config);
        }

        const result = await agent.executeInstructions(instructions as AgentInstruction[], undefined, abort.signal, resume);

        res.json({
            success: result.success,
            data: result
        });

    } catch (error: any) {
        if (isStopError(error) || abort.signal.aborted) {
            console.log('⏹ Execution stopped by user');
            return res.json({
                success: false,
                stopped: true,
                message: 'Execution stopped by user',
                data: null
            });
        }
        console.error('Secondary agent error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to execute instructions'
        });
    } finally {
        activeExecutions.delete(abort);
        activeResumes.delete(resume);
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
    let finished = false;
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
        onNotice: (kind, message, data) => session.notice(kind, message, data),
    };

    // Abort the run when the client (the primary agent) disconnects, so a
    // dropped browser tab or cancelled request never leaves a ghost execution
    // driving the browser.
    const abort = new AbortController();
    const resume: ResumeSignal = { requested: false };
    activeExecutions.add(abort);
    activeResumes.add(resume);

    const keepAlive = setInterval(() => {
        if (!closed) res.write(': ping\n\n');
    }, 15000);
    res.on('close', () => {
        closed = true;
        clearInterval(keepAlive);
        if (!finished) abort.abort();
    });

    try {
        const { instructions, config } = req.body;

        if (!instructions || !Array.isArray(instructions)) {
            session.error('instructions is required and must be an array');
            return;
        }

        if (config) {
            agent.updateConfig(config);
        }

        const result = await agent.executeInstructions(instructions as AgentInstruction[], hooks, abort.signal, resume);
        finished = true;
        session.done(result);

    } catch (error: any) {
        if (isStopError(error) || abort.signal.aborted) {
            console.log('⏹ Execution stopped by user');
            session.done({
                success: false,
                stopped: true,
                message: 'Execution stopped by user'
            });
            return;
        }
        console.error('Secondary agent streaming error:', error);
        session.error(error.message || 'Failed to execute instructions');
    } finally {
        finished = true;
        clearInterval(keepAlive);
        activeExecutions.delete(abort);
        activeResumes.delete(resume);
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
    console.log(`   Stop:    POST http://localhost:${PORT}/stop`);
    console.log(`   Screenshot: GET http://localhost:${PORT}/screenshot`);
    console.log(`   Activity: GET http://localhost:${PORT}/activity`);
});

