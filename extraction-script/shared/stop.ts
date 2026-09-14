// Shared cancellation utilities for stopping agent executions.
//
// Each agent server keeps AbortControllers for the executions it is running.
// `/stop` aborts them; the pipeline checks the signal between steps and races
// long-running operations (browser actions, LLM calls, waits) against it, so
// stopping unwinds within milliseconds instead of waiting for timeouts.

/**
 * Shared flag used to resume a paused execution (e.g. after the user solves a
 * CAPTCHA manually). Servers keep a set of these and `/resume` flips them.
 */
export interface ResumeSignal {
    requested: boolean;
}

export class StopError extends Error {
    constructor(message = 'Execution stopped by user') {
        super(message);
        this.name = 'StopError';
    }
}

/**
 * Throw a StopError if the signal has been aborted.
 */
export function throwIfAborted(signal?: AbortSignal | null, message = 'Execution stopped by user'): void {
    if (signal?.aborted) {
        throw new StopError(message);
    }
}

/**
 * True when an error came from an aborted stop/cancellation.
 */
export function isStopError(error: unknown): boolean {
    return (
        error instanceof StopError ||
        (error instanceof Error && error.name === 'AbortError')
    );
}

/**
 * Race a promise against an abort signal. When the signal fires, the returned
 * promise rejects with StopError immediately; the underlying operation keeps
 * running on its own (Playwright/LLM timeouts bound it) but nothing awaits it.
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new StopError());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new StopError());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            }
        );
    });
}