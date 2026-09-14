// Navigation + URL-fixer QA suite.
//
//   npx tsx qa/navigation.qa.ts
//
// Exercises:
//   A. normalizeNavigationTarget() unit cases (shared/url.ts)
//   B. live /navigate through the secondary AND primary agents
//   C. in-page link clicks actually navigate the browser
//   D. resilience: navigation still works when the database is unavailable
//
// Exits non-zero when any check fails.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeNavigationTarget } from '../shared/url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIXTURES = path.join(HERE, 'fixtures');

const SECONDARY = process.env.QA_SECONDARY_URL || 'http://localhost:3002';
const PRIMARY = process.env.QA_PRIMARY_URL || 'http://localhost:3001';
const SITE_PORT = Number(process.env.QA_SITE_PORT || 8899);
const DB_DOWN_PORT = Number(process.env.QA_DB_DOWN_PORT || 3012);
const SITE = `http://localhost:${SITE_PORT}`;

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

async function postJson(url: string, body: any, timeoutMs = 90000): Promise<{ status: number; json: any }> {
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

async function waitFor(url: string, timeoutMs = 30000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
            if (res.ok) return true;
        } catch { /* keep waiting */ }
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

// ---------------------------------------------------------------------------
// Fixture web server
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
// A. URL fixer unit tests
// ---------------------------------------------------------------------------

function sectionA() {
    console.log('\nA. URL fixer (normalizeNavigationTarget)');
    const cases: Array<[string, string, string]> = [
        ['bare domain', 'example.com', 'https://example.com'],
        ['bare domain with path', 'en.wikipedia.org/wiki/Greece', 'https://en.wikipedia.org/wiki/Greece'],
        ['bare domain with query', 'example.com/path?q=1', 'https://example.com/path?q=1'],
        ['subdomain', 'sub.example.co.uk', 'https://sub.example.co.uk'],
        ['https scheme', 'https://example.com/path?q=1', 'https://example.com/path?q=1'],
        ['http scheme', 'http://example.com', 'http://example.com'],
        ['about scheme', 'about:blank', 'about:blank'],
        ['file scheme', 'file:///tmp/x.html', 'file:///tmp/x.html'],
        ['trims whitespace', '  example.com  ', 'https://example.com'],
        ['empty stays empty', '', ''],
        ['bare word is a search', 'google', 'https://duckduckgo.com/?q=google'],
        ['phrase is a search', 'what is the capital of France', 'https://duckduckgo.com/?q=what%20is%20the%20capital%20of%20France'],
        ['domain with port', 'example.com:8080/path', 'https://example.com:8080/path'],
        ['localhost with port', 'localhost:8899/index.html', 'http://localhost:8899/index.html'],
        ['localhost bare', 'localhost:3000', 'http://localhost:3000'],
        ['ipv4 with port', '127.0.0.1:3000', 'http://127.0.0.1:3000'],
        ['placeholder bracket is not searched', '[extracted_url]', '[extracted_url]'],
        ['placeholder angle is not searched', '<url>', '<url>'],
        ['placeholder brace is not searched', '{{link}}', '{{link}}']
    ];
    for (const [name, input, expected] of cases) {
        eq(name, normalizeNavigationTarget(input), expected);
    }
}

// ---------------------------------------------------------------------------
// B. Live /navigate
// ---------------------------------------------------------------------------

async function sectionB() {
    console.log('\nB. Live /navigate (secondary + primary proxy)');

    const b1 = await postJson(`${SECONDARY}/navigate`, { url: 'example.com' });
    check('B1 bare domain resolves to https', b1.json.success === true && String(b1.json.url).startsWith('https://example.com'), JSON.stringify(b1.json).slice(0, 200));

    const b2 = await postJson(`${SECONDARY}/navigate`, { query: 'openai' });
    check('B2 query becomes a DuckDuckGo search', b2.json.success === true && /duckduckgo\.com/.test(b2.json.url) && /q=openai/.test(b2.json.url), JSON.stringify(b2.json).slice(0, 200));

    const b3 = await postJson(`${SECONDARY}/navigate`, { url: `${SITE}/index.html` });
    check('B3 full URL loads', b3.json.success === true && b3.json.url === `${SITE}/index.html`, JSON.stringify(b3.json).slice(0, 200));

    const b4 = await postJson(`${SECONDARY}/navigate`, { url: `localhost:${SITE_PORT}/index.html` });
    check('B4 host:port URL is fixed, not searched', b4.json.success === true && b4.json.url === `${SITE}/index.html`, JSON.stringify(b4.json).slice(0, 200));

    const b5 = await postJson(`${SECONDARY}/navigate`, {});
    check('B5 empty request rejected with 400', b5.status === 400 && b5.json.success === false, `status ${b5.status}`);

    const b6 = await postJson(`${PRIMARY}/navigate`, { url: 'example.com' });
    check('B6 primary proxies /navigate', b6.json.success === true && String(b6.json.url).startsWith('https://example.com'), JSON.stringify(b6.json).slice(0, 200));
}

// ---------------------------------------------------------------------------
// C. In-page navigation (clicks)
// ---------------------------------------------------------------------------

async function clickAndGetUrl(instructionId: string, target: string): Promise<string> {
    await postJson(`${SECONDARY}/navigate`, { url: `${SITE}/index.html` });
    const r = await postJson(`${SECONDARY}/execute`, {
        instructions: [{ id: instructionId, action: 'click', target, reasoning: 'qa', priority: 'high' }]
    });
    return r.json?.data?.finalContext?.currentUrl || '';
}

async function sectionC() {
    console.log('\nC. In-page navigation (clicks)');
    const c1 = await clickAndGetUrl('c1', '#link-page2');
    eq('C1 click on same-tab link navigates', c1, `${SITE}/page2.html`);

    const c2 = await clickAndGetUrl('c2', '#link-page3');
    eq('C2 click on link wrapping a <span> navigates', c2, `${SITE}/page3.html`);

    const c3 = await clickAndGetUrl('c3', '#link-blank');
    eq('C3 target=_blank click follows the new tab', c3, `${SITE}/page2.html`);
}

// ---------------------------------------------------------------------------
// D. Database-down resilience
// ---------------------------------------------------------------------------

function killTree(child: ChildProcess | null) {
    if (!child?.pid) return;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

async function sectionD(): Promise<ChildProcess | null> {
    console.log('\nD. Navigation works when the database is unavailable');
    // detached: the tsx wrapper spawns the real server as a child; killing the
    // group ensures no orphan keeps holding the port.
    const child = spawn(
        path.join(ROOT, 'secondary_agent/node_modules/.bin/tsx'),
        ['server.ts'],
        {
            cwd: path.join(ROOT, 'secondary_agent'),
            env: { ...process.env, PORT: String(DB_DOWN_PORT), DB_HOST: '127.0.0.1', DB_PORT: '1' },
            stdio: 'ignore',
            detached: true
        }
    );

    const healthy = await waitFor(`http://localhost:${DB_DOWN_PORT}/health`, 30000);
    if (!healthy) {
        check('D0 secondary boots with a dead database', false, 'did not become healthy');
        killTree(child);
        return null;
    }
    check('D0 secondary boots with a dead database', true);

    try {
        const d1 = await postJson(`http://localhost:${DB_DOWN_PORT}/navigate`, { url: 'example.com' }, 60000);
        check('D1 navigate succeeds without a database', d1.json.success === true && String(d1.json.url).startsWith('https://example.com'), JSON.stringify(d1.json).slice(0, 200));
    } catch (error: any) {
        check('D1 navigate succeeds without a database', false, error?.message || String(error));
    }

    try {
        const d2 = await postJson(`http://localhost:${DB_DOWN_PORT}/execute`, {
            instructions: [{ id: 'd2', action: 'navigate', target: 'example.com', reasoning: 'qa', priority: 'high' }]
        }, 60000);
        const errs: string[] = d2.json?.data?.errors || [];
        check('D2 failures carry a non-empty message', d2.json?.data?.success === true || errs.every(e => e && !/:\s*$/.test(e)), JSON.stringify(errs).slice(0, 200));
    } catch (error: any) {
        check('D2 failures carry a non-empty message', false, error?.message || String(error));
    }

    return child;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

(async () => {
    console.log('Navigation QA suite');
    console.log(`  secondary=${SECONDARY}  primary=${PRIMARY}  site=${SITE}`);

    const site = await startFixtureServer();
    let dbDownChild: ChildProcess | null = null;

    try {
        sectionA();
        await sectionB();
        await sectionC();
        dbDownChild = await sectionD();
    } catch (error: any) {
        failed++;
        failures.push(`suite crashed: ${error?.stack || error}`);
        console.error('Suite error:', error);
    } finally {
        killTree(dbDownChild);
        site.close();
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.log('Failures:');
        for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed > 0 ? 1 : 0);
})();
