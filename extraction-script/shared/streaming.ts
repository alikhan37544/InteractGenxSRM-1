// Shared streaming + ETA utilities for agent servers
// Used by both primary and secondary agents to emit Server-Sent Events (SSE)
// carrying live LLM token output and an estimated time to completion.

export type StreamPhase =
    | 'intent_recognition'
    | 'instruction_generation'
    | 'execution'
    | 'selector_resolution'
    | 'response_synthesis';

export const PHASE_LABELS: Record<StreamPhase, string> = {
    intent_recognition: 'Understanding intent',
    instruction_generation: 'Generating instructions',
    execution: 'Executing actions',
    selector_resolution: 'Resolving element selector',
    response_synthesis: 'Composing answer',
};

export interface StreamEvent {
    type: 'phase' | 'token' | 'thinking' | 'done' | 'error' | 'notice';
    phase?: StreamPhase;
    status?: 'started' | 'done';
    label?: string;
    text?: string;
    /** For `notice` events: what the notice is about (e.g. "captcha"). */
    noticeKind?: string;
    tokens?: number;
    tokensPerSec?: number;
    etaMs?: number;
    overallEtaMs?: number;
    progress?: number;
    durationMs?: number;
    data?: any;
    error?: string;
    timestamp: number;
}

// Hooks the agent orchestrators call into as they progress through phases.
export interface AgentStreamHooks {
    onPhaseStart?: (phase: StreamPhase) => void;
    onToken?: (phase: StreamPhase, text: string) => void;
    /** Reasoning/thinking tokens emitted by the model before its answer. */
    onThinking?: (phase: StreamPhase, text: string) => void;
    onPhaseEnd?: (phase: StreamPhase) => void;
    /** Out-of-band notice (e.g. a CAPTCHA appearing or being solved). */
    onNotice?: (kind: string, message: string, data?: any) => void;
}

// Seed estimates (tokens) used before enough real samples have been collected.
const DEFAULT_EXPECTED_TOKENS: Record<StreamPhase, number> = {
    intent_recognition: 320,
    instruction_generation: 480,
    execution: 0,
    selector_resolution: 120,
    response_synthesis: 260,
};

// Fallback generation rate (tokens/sec) used before any tokens have arrived.
const FALLBACK_TOKENS_PER_SEC = 22;

// Rolling per-phase stats so ETAs self-calibrate as the server is used.
const phaseStats: Partial<Record<StreamPhase, { totalTokens: number; samples: number }>> = {};

export function recordPhaseSample(phase: StreamPhase, tokens: number): void {
    if (tokens <= 0) return;
    const stats = phaseStats[phase] || (phaseStats[phase] = { totalTokens: 0, samples: 0 });
    stats.totalTokens += tokens;
    stats.samples += 1;
}

export function expectedTokens(phase: StreamPhase): number {
    const stats = phaseStats[phase];
    if (stats && stats.samples > 0) {
        return stats.totalTokens / stats.samples;
    }
    return DEFAULT_EXPECTED_TOKENS[phase] || 0;
}

// ETA is clamped so early (rough) estimates never render absurd values.
const MIN_ETA_MS = 250;
const MAX_ETA_MS = 180000;

function clampEta(ms: number): number {
    return Math.max(MIN_ETA_MS, Math.min(MAX_ETA_MS, Math.round(ms)));
}

interface PhaseState {
    start: number;
    tokens: number;
    thinkingTokens: number;
    expected: number;
    lastTokenAt: number;
    rateEma: number;
}

/**
 * Tracks streaming phases and emits StreamEvents through a transport callback.
 * The transport (Express `res.write`) is injected so this stays framework-free.
 *
 * ETA is computed from an exponentially-weighted moving average of the
 * inter-token arrival rate (seeded at a fallback), so it is immune to
 * time-to-first-token spikes and converges smoothly.
 */
export class StreamSession {
    private phases = new Map<StreamPhase, PhaseState>();
    private sequence: StreamPhase[];

    constructor(
        private emit: (event: StreamEvent) => void,
        private onClose?: () => void,
        sequence: StreamPhase[] = ['intent_recognition', 'instruction_generation', 'execution'],
    ) {
        this.sequence = sequence;
    }

    startPhase(phase: StreamPhase): void {
        this.phases.set(phase, this.newState(phase));
        this.emit({
            type: 'phase',
            phase,
            status: 'started',
            label: PHASE_LABELS[phase],
            etaMs: this.phaseEta(phase),
            overallEtaMs: this.overallEta(phase),
            progress: 0,
            timestamp: Date.now(),
        });
    }

    token(phase: StreamPhase, text: string): void {
        let state = this.phases.get(phase);
        if (!state) {
            // Lazy start: a phase may emit tokens without an explicit start event.
            state = this.newState(phase);
            this.phases.set(phase, state);
        }

        // Update the smoothed rate from the inter-token gap (not from phase start,
        // which includes time-to-first-token and would spike the ETA).
        const now = Date.now();
        const gapSec = Math.max(0.001, (now - state.lastTokenAt) / 1000);
        state.lastTokenAt = now;
        state.tokens += 1;
        const instant = 1 / gapSec;
        const alpha = 0.3;
        state.rateEma = alpha * instant + (1 - alpha) * state.rateEma;
        state.rateEma = Math.max(1, Math.min(200, state.rateEma));

        this.emit({
            type: 'token',
            phase,
            text,
            tokens: state.tokens,
            tokensPerSec: Math.round(state.rateEma * 10) / 10,
            etaMs: this.phaseEta(phase),
            overallEtaMs: this.overallEta(phase),
            progress: state.expected > 0
                ? Math.min(0.99, (state.tokens + state.thinkingTokens) / state.expected)
                : undefined,
            timestamp: now,
        });
    }

    /** Emit a reasoning/thinking token for the given phase. */
    thinking(phase: StreamPhase, text: string): void {
        let state = this.phases.get(phase);
        if (!state) {
            // Lazy start: a phase may emit thinking without an explicit start event.
            state = this.newState(phase);
            this.phases.set(phase, state);
        }

        // Thinking tokens consume the same generation bandwidth as content
        // tokens, so they feed the same smoothed rate / ETA machinery. This keeps
        // the phase ETA meaningful while the model is still reasoning.
        const now = Date.now();
        const gapSec = Math.max(0.001, (now - state.lastTokenAt) / 1000);
        state.lastTokenAt = now;
        state.thinkingTokens += 1;
        const instant = 1 / gapSec;
        const alpha = 0.3;
        state.rateEma = alpha * instant + (1 - alpha) * state.rateEma;
        state.rateEma = Math.max(1, Math.min(200, state.rateEma));

        this.emit({
            type: 'thinking',
            phase,
            text,
            tokens: state.thinkingTokens,
            tokensPerSec: Math.round(state.rateEma * 10) / 10,
            etaMs: this.phaseEta(phase),
            overallEtaMs: this.overallEta(phase),
            progress: state.expected > 0
                ? Math.min(0.99, (state.tokens + state.thinkingTokens) / state.expected)
                : undefined,
            timestamp: now,
        });
    }

    endPhase(phase: StreamPhase): void {
        const state = this.phases.get(phase);
        if (!state) return;
        recordPhaseSample(phase, state.tokens + state.thinkingTokens);
        this.emit({
            type: 'phase',
            phase,
            status: 'done',
            durationMs: Date.now() - state.start,
            tokens: state.tokens,
            timestamp: Date.now(),
        });
        this.phases.delete(phase);
    }

    /** Re-emit an event received from another agent (used when relaying streams). */
    forward(event: StreamEvent): void {
        this.emit(event);
    }

    /** Out-of-band notice (CAPTCHA appeared/solved, etc.). */
    notice(kind: string, message: string, data?: any): void {
        this.emit({ type: 'notice', noticeKind: kind, text: message, data, timestamp: Date.now() });
    }

    done(data: any): void {
        this.emit({ type: 'done', data, timestamp: Date.now() });
        this.onClose?.();
    }

    error(message: string): void {
        this.emit({ type: 'error', error: message, timestamp: Date.now() });
        this.onClose?.();
    }

    private newState(phase: StreamPhase): PhaseState {
        return {
            start: Date.now(),
            tokens: 0,
            thinkingTokens: 0,
            expected: expectedTokens(phase),
            lastTokenAt: Date.now(),
            rateEma: FALLBACK_TOKENS_PER_SEC,
        };
    }

    private phaseEta(phase: StreamPhase): number | undefined {
        const state = this.phases.get(phase);
        if (!state || state.expected <= 0) return undefined;
        const done = state.tokens + state.thinkingTokens;
        const remaining = Math.max(0, state.expected - done);
        return clampEta((remaining / state.rateEma) * 1000);
    }

    /** ETA across the current phase and all remaining LLM phases in the sequence. */
    private overallEta(phase: StreamPhase): number | undefined {
        const state = this.phases.get(phase);
        if (!state) return undefined;
        const done = state.tokens + state.thinkingTokens;
        let tokensRemaining = Math.max(0, state.expected - done);

        const index = this.sequence.indexOf(phase);
        if (index !== -1) {
            for (let i = index + 1; i < this.sequence.length; i++) {
                const next = this.sequence[i];
                if (next === 'execution') continue;
                tokensRemaining += expectedTokens(next);
            }
        }

        if (tokensRemaining <= 0) return undefined;
        return clampEta((tokensRemaining / state.rateEma) * 1000);
    }
}

/**
 * Minimal pub/sub bus used to broadcast server-side activity (e.g. console
 * output) to SSE subscribers. Each process owns its own instance.
 */
export class ActivityBus {
    private listeners = new Set<(line: string) => void>();

    subscribe(fn: (line: string) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    publish(line: string): void {
        for (const fn of this.listeners) {
            try {
                fn(line);
            } catch {
                // A slow/disconnecting subscriber must not break the bus.
            }
        }
    }
}

export const activityBus = new ActivityBus();

/** Format a millisecond duration into a short human string (e.g. "4.2s"). */
export function formatEta(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || ms < 0) return '--';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}