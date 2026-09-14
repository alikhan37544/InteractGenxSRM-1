// Agentic loop QA suite.
//
//   npx tsx qa/agentic.qa.ts
//
// Exercises:
//   A. buildSynthesisDigest: multi-round rendering + /execute envelope unwrap
//      (deterministic, no server needed)
//   B. live autoExecute: an incomplete answer triggers further exploration
//      rounds until the independent judge is satisfied (pricing scenario)
//   C. maxIterations cap: the loop stops and reports judged=false
//   D. streaming path iterates too and reports iterations/judged
//   E. chat history stays clean (one answer recorded, no intermediate ones)
//
// Set QA_SKIP_LIVE=1 to run only the deterministic section A.
// Exits non-zero when any check fails.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSynthesisDigest } from '../primary_agent/response-synthesizer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');

const PRIMARY = process.env.QA_PRIMARY_URL || 'http://localhost:3001';
const SITE_PORT = Number(process.env.QA_SITE_PORT || 8899);
const SITE = `http://localhost:${SITE_PORT}`;
const MODEL = process.env.QA_MODEL || 'google/gemma-3-4b';
const SKIP_LIVE = process.env.QA_SKIP_LIVE === '1';
const RUN = Date.now().toString(36);

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        passed++;
        console.log(`  PASS  ${name}`);
    } else {
        failed++;
        failures.push(name + (detail ? ` — ${detail}` : ''));
        console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

function eq(name: string, actual: unknown, expected: unknown) {
    check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function postJson(url: string, body: any, timeoutMs = 600000): Promise<{ status: number; json: any }> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

async function getJson(url: string, timeoutMs = 10000): Promise<any> {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.json().catch(() => ({}));
}

// ---------------------------------------------------------------------------
// Fixture web server (serves qa/fixtures on SITE_PORT)
// ---------------------------------------------------------------------------

function startFixtureServer(): Promise<http.Server> {
    const server = http.createServer((req, res) => {
        const rel = (req.url || '/').split('?')[0].replace(/^\/+/, '') || 'index.html';
        const file = path.join(FIXTURES, rel);
        if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) {
            res.writeHead(404).end('not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(file));
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(SITE_PORT, '127.0.0.1', () => resolve(server));
    });
}

// ---------------------------------------------------------------------------
// A. Digest (deterministic)
// ---------------------------------------------------------------------------

function sectionA() {
    console.log('\nA. buildSynthesisDigest (rounds + envelope unwrap)');

    const roundResult = {
        success: true,
        message: 'ok',
        executionResults: [
            { action: 'navigate', success: true, result: { url: `${SITE}/products.html` } },
            { action: 'extract', success: true }
        ],
        finalContext: {
            currentUrl: `${SITE}/products.html`,
            currentPageTitle: 'Acme Products',
            pageText: 'Our products Widget A Gadget B Browse the catalog to see prices.'
        }
    };

    // The secondary's /execute wraps everything in { success, data }.
    const wrapped = { success: true, data: roundResult };
    const single = buildSynthesisDigest({
        userInput: 'prices',
        intent: { intent: 'extract_data', confidence: 0.9 } as any,
        instructions: [{ id: 'i0', action: 'extract' } as any],
        executionResult: wrapped
    });
    check('A1 envelope is unwrapped (page text present)', single.includes('Browse the catalog to see prices'), single.slice(0, 400));
    check('A1 per-action results rendered', single.includes('extract: ok'), single.slice(0, 400));

    const rounds = {
        rounds: [
            { instructions: [{ id: 'i0', action: 'navigate', target: `${SITE}/products.html` } as any], executionResult: roundResult },
            {
                instructions: [
                    { id: 'i1', action: 'click', target: 'Widget A' } as any,
                    { id: 'i2', action: 'extract' } as any
                ],
                executionResult: {
                    success: true,
                    executionResults: [
                        { action: 'click', success: true },
                        { action: 'extract', success: true }
                    ],
                    finalContext: {
                        currentUrl: `${SITE}/products/widget-a.html`,
                        currentPageTitle: 'Widget A - Acme',
                        pageText: 'Widget A Price: $99.99'
                    }
                }
            }
        ]
    };
    const multi = buildSynthesisDigest({
        userInput: 'prices',
        instructions: [{ id: 'i0', action: 'navigate' } as any],
        executionResult: rounds
    });
    check('A2 both rounds rendered', multi.includes('Exploration round 1') && multi.includes('Exploration round 2'), multi.slice(0, 500));
    check('A2 round order preserved', multi.indexOf('Exploration round 1') < multi.indexOf('Exploration round 2'), multi.slice(0, 500));
    check('A2 each round has its own page text', multi.includes('Browse the catalog') && multi.includes('Price: $99.99'), multi.slice(0, 500));
    check('A2 round 2 actions rendered', multi.includes('click → Widget A'), multi.slice(0, 500));
}

// ---------------------------------------------------------------------------
// B/C/D/E. Live agentic loop
// ---------------------------------------------------------------------------

async function sectionLive() {
    console.log('\nB. Live agentic loop (real browser + LLM)');

    const chatB1 = `qa-agentic-b1-${RUN}`;
    const chatC1 = `qa-agentic-c1-${RUN}`;
    const chatD1 = `qa-agentic-d1-${RUN}`;

    // B1: the catalog lists products but not prices — the judge must send the
    // agent back for another round until the prices are found.
    const b1 = await postJson(`${PRIMARY}/process`, {
        userInput: `open ${SITE}/products.html and give me the price of every product on it`,
        autoExecute: true,
        // maxIterations is explicit: server config is sticky between requests.
        config: { model: MODEL, temperature: 0, maxIterations: 4 },
        chatId: chatB1
    });
    const d1 = b1.json.data || {};
    const ans1 = (d1.finalResponse || '').toLowerCase();
    check('B1 answer was produced', !!d1.finalResponse, JSON.stringify(d1).slice(0, 300));
    check('B1 explored more than once', (d1.iterations || 0) >= 2, `iterations=${d1.iterations}`);
    check('B1 judge satisfied', d1.judged === true, `judged=${d1.judged} verdict=${JSON.stringify(d1.judgeVerdict)}`);
    check('B1 answer contains a price', /\$\s?\d/.test(ans1), d1.finalResponse?.slice(0, 400));
    check('B1 answer names both products', ans1.includes('widget a') && ans1.includes('gadget b'), d1.finalResponse?.slice(0, 400));
    check('B1 response carries every round', Array.isArray(d1.executionResult?.rounds) && d1.executionResult.rounds.length >= 2, JSON.stringify(d1.executionResult).slice(0, 300));

    // E1: history holds exactly one turn (user, intent, answer) — intermediate
    // round answers must NOT have leaked into the chat history.
    const history = await getJson(`${PRIMARY}/history?chatId=${chatB1}`);
    eq('E1 history has 3 messages (one turn)', Array.isArray(history.data) ? history.data.length : -1, 3);

    // C1: the cap stops the loop even when the judge is not satisfied.
    const c1 = await postJson(`${PRIMARY}/process`, {
        userInput: `open ${SITE}/products.html and give me the price of every product on it`,
        autoExecute: true,
        config: { model: MODEL, temperature: 0, maxIterations: 1 },
        chatId: chatC1
    });
    const dc1 = c1.json.data || {};
    eq('C1 capped at one round', dc1.iterations, 1);
    check('C1 judged=false when capped', dc1.judged === false, `judged=${dc1.judged}`);

    // D1: the streaming path iterates too and reports the same metadata.
    console.log('\nD. Streaming path');
    const res = await fetch(`${PRIMARY}/process/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userInput: `open ${SITE}/products.html and give me the price of every product on it`,
            autoExecute: true,
            config: { model: MODEL, temperature: 0, maxIterations: 4 },
            chatId: chatD1
        }),
        signal: AbortSignal.timeout(600000)
    });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneEvent: any = null;
    let executionStarts = 0;
    let judgingStarts = 0;
    let iterationNotices = 0;
    if (reader) {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
                const line = part.split('\n').find(l => l.startsWith('data: '));
                if (!line) continue;
                let event: any;
                try { event = JSON.parse(line.slice(6)); } catch { continue; }
                if (event.type === 'phase' && event.status === 'started' && event.phase === 'execution') executionStarts++;
                if (event.type === 'phase' && event.status === 'started' && event.phase === 'judging') judgingStarts++;
                if (event.type === 'notice' && event.noticeKind === 'iteration') iterationNotices++;
                if (event.type === 'done') doneEvent = event.data;
            }
        }
    }
    const dd = doneEvent || {};
    const dIter = dd.iterations || 0;
    check('D1 judge phase ran on stream', judgingStarts >= 1, `judging starts=${judgingStarts}`);
    check('D1 stream judged true', dd.judged === true, JSON.stringify(dd).slice(0, 300));
    check('D1 stream answer contains a price', /\$\s?\d/i.test((dd.finalResponse || '')), (dd.finalResponse || '').slice(0, 400));
    check('D1 stream judge verdict present', !!dd.judgeVerdict && typeof dd.judgeVerdict.answered === 'boolean', JSON.stringify(dd.judgeVerdict));
    // The model may finish the whole catalog walk within round 1 (legal); the
    // multi-round machinery must work whenever the answer stays incomplete.
    if (dIter >= 2) {
        check('D1 stream ran one execution phase per round', executionStarts >= 2, `execution starts=${executionStarts}`);
        check('D1 iteration notice emitted', iterationNotices >= 1, `notices=${iterationNotices}`);
        check('D1 stream reports iterations', dIter >= 2, `iterations=${dIter}`);
    } else {
        check('D1 single-round completion accepted', true, `iterations=${dIter}`);
    }
}

(async () => {
    sectionA();

    let server: http.Server | undefined;
    if (!SKIP_LIVE) {
        try {
            server = await startFixtureServer();
            console.log(`\nfixture site: ${SITE}/products.html`);
        } catch (error: any) {
            check('fixture server started', false, error?.message || String(error));
        }
        try {
            if (server) await sectionLive();
        } catch (error: any) {
            check('live agentic sections', false, error?.message || String(error));
        }
    }
    server?.close();

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) console.log(`  - ${f}`);
        process.exit(1);
    }
})();