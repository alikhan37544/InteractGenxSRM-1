// Navigation-planning QA suite.
//
//   npx tsx qa/planning.qa.ts
//
// Covers the decision "act on the current page vs. go to a new page":
//   A. deriveNavigationPlan() classifies the request
//   B. applyNavigationGuardrails() repairs a plan that mixes the two
//   C. end-to-end /process planning against the live primary agent
//
// Exits non-zero when any check fails.

import { deriveNavigationPlan, applyNavigationGuardrails, NavigationPlan } from '../primary_agent/navigation-planner';
import { AgentInstruction } from '../shared/types';

const PRIMARY = process.env.QA_PRIMARY_URL || 'http://localhost:3001';
const WIKI = 'https://en.wikipedia.org/wiki/Smartphone';

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

function inst(action: string, target?: string, value?: string): AgentInstruction {
    return { id: `${action}_${Math.random().toString(36).slice(2, 7)}`, action: action as any, target, value, reasoning: '', priority: 'medium' };
}

// ---------------------------------------------------------------------------
// A. Strategy derivation
// ---------------------------------------------------------------------------

function sectionA() {
    console.log('\nA. deriveNavigationPlan');

    const cases: Array<[string, string, Partial<NavigationPlan>]> = [
        ['general search (about)', 'search about smartphones', { strategy: 'web_search', query: 'smartphones' }],
        ['general search (for)', 'search for the history of phones', { strategy: 'web_search', query: 'the history of phones' }],
        ['look up', 'look up Nothing phone', { strategy: 'web_search', query: 'Nothing phone' }],
        ['search the web', 'search the web for smartphones', { strategy: 'web_search', query: 'smartphones' }],
        ['site search (prefix)', 'search Wikipedia for smartphones', { strategy: 'site_search', site: 'Wikipedia', query: 'smartphones' }],
        ['site search (suffix)', 'search for smartphones on amazon', { strategy: 'site_search', site: 'amazon', query: 'smartphones' }],
        ['site search (leading)', 'on wikipedia, search for smartphones', { strategy: 'site_search', site: 'wikipedia', query: 'smartphones' }],
        ['brand homepage', 'take me to the nothing homepage. Nothing is a phone brand', { strategy: 'homepage', name: 'nothing' }],
        ['homepage word', 'go to the apple website', { strategy: 'homepage', name: 'apple' }],
        ['homepage with verb filler', 'go inside apple official india website', { strategy: 'homepage', name: 'apple india' }],
        ['homepage with go inside the', 'go inside the apple website', { strategy: 'homepage', name: 'apple' }],
        ['explicit url', 'go to https://example.com', { strategy: 'direct_url', url: 'https://example.com' }],
        ['bare domain', 'open example.com', { strategy: 'direct_url', url: 'https://example.com' }],
        ['click first result', 'click the first result', { strategy: 'in_page' }],
        ['click named link', 'click on the Smartphone link', { strategy: 'in_page' }],
        ['scroll', 'scroll down', { strategy: 'in_page' }],
        ['follow-up', 'tell me more', { strategy: 'read_current' }],
        ['follow-up (continue)', 'continue', { strategy: 'read_current' }],
        ['open-ended question', 'what is a smartphone', { strategy: 'unknown' }]
    ];

    for (const [name, input, expected] of cases) {
        const plan = deriveNavigationPlan(input, WIKI);
        const ok = (Object.keys(expected) as Array<keyof NavigationPlan>).every(k => {
            if (k === 'site' || k === 'query' || k === 'url') {
                return String(plan[k] || '').toLowerCase().includes(String(expected[k]).toLowerCase());
            }
            return plan[k] === expected[k];
        });
        check(name, ok, `got ${JSON.stringify(plan)}`);
    }
}

// ---------------------------------------------------------------------------
// B. Guardrails
// ---------------------------------------------------------------------------

function actions(list: AgentInstruction[]): string[] {
    return list.map(i => `${i.action}:${i.target ?? ''}`);
}

function sectionB() {
    console.log('\nB. applyNavigationGuardrails');

    const webPlan = deriveNavigationPlan('search about smartphones', WIKI);

    const b1 = applyNavigationGuardrails(
        [inst('click', 'Search'), inst('wait', '5000'), inst('extract'), inst('navigate', 'https://duckduckgo.com/?q=smartphones')],
        webPlan, WIKI
    );
    const b1nav = b1.find(i => i.action === 'navigate');
    check('B1 general search keeps a DuckDuckGo navigate', !!b1nav && /duckduckgo\.com\/\?q=smartphones/.test(b1nav.target || ''), JSON.stringify(actions(b1)));
    check('B1 general search drops in-page click before navigate', !b1.some(i => i.action === 'click'), JSON.stringify(actions(b1)));
    check('B1 general search still extracts', b1.some(i => i.action === 'extract'), JSON.stringify(actions(b1)));

    const b2 = applyNavigationGuardrails(
        [inst('click', 'Search'), inst('navigate', 'https://www.google.com/')],
        webPlan, WIKI
    );
    const b2nav = b2.find(i => i.action === 'navigate');
    check('B2 wrong search engine is replaced', !!b2nav && /duckduckgo\.com\/\?q=smartphones/.test(b2nav.target || ''), JSON.stringify(actions(b2)));
    check('B2 in-page click removed', !b2.some(i => i.action === 'click'), JSON.stringify(actions(b2)));

    const b3 = applyNavigationGuardrails(
        [inst('click', 'Search'), inst('navigate', 'https://www.nothing.com/'), inst('extract')],
        deriveNavigationPlan('take me to the nothing homepage', WIKI), WIKI
    );
    check('B3 homepage keeps the navigate', b3.some(i => i.action === 'navigate'), JSON.stringify(actions(b3)));
    check('B3 homepage drops the redundant in-page click', !b3.some(i => i.action === 'click'), JSON.stringify(actions(b3)));

    const b4 = applyNavigationGuardrails(
        [inst('navigate', 'https://example.com'), inst('extract')],
        deriveNavigationPlan('tell me more', WIKI), WIKI
    );
    check('B4 follow-up does not navigate away', !b4.some(i => i.action === 'navigate'), JSON.stringify(actions(b4)));
    check('B4 follow-up still extracts', b4.some(i => i.action === 'extract'), JSON.stringify(actions(b4)));

    const b4b = applyNavigationGuardrails(
        [inst('navigate', 'https://en.wikipedia.org/wiki/Greece'), inst('click', 'Gadget B'), inst('extract')],
        deriveNavigationPlan('tell me more', WIKI), WIKI
    );
    check('B4 same-site navigate survives follow-up', b4b.some(i => i.action === 'navigate' && /Greece/.test(i.target || '')), JSON.stringify(actions(b4b)));

    const inPage = [inst('click', '#link'), inst('extract')];
    const b5 = applyNavigationGuardrails(inPage, deriveNavigationPlan('click the first result', WIKI), WIKI);
    eq('B5 in-page plan is untouched', JSON.stringify(actions(b5)), JSON.stringify(actions(inPage)));

    const b6 = applyNavigationGuardrails([inst('extract')], webPlan, WIKI);
    check('B6 missing navigate is added for a web search', b6.some(i => i.action === 'navigate' && /duckduckgo\.com\/\?q=smartphones/.test(i.target || '')), JSON.stringify(actions(b6)));

    const b7 = applyNavigationGuardrails(
        [inst('navigate', '[extracted_url]'), inst('extract')],
        deriveNavigationPlan('take me to the nothing website', WIKI), WIKI
    );
    const b7nav = b7.find(i => i.action === 'navigate');
    check('B7 placeholder navigate is replaced with the brand search', !!b7nav && /duckduckgo\.com\/\?q=nothing%20official%20site/.test(b7nav.target || ''), JSON.stringify(actions(b7)));

    const b8 = applyNavigationGuardrails(
        [inst('navigate', 'https://duckduckgo.com/?q=go%20inside%20apple%20india%20official%20site'), inst('wait', '5000'), inst('click', 'apple official india website'), inst('extract')],
        deriveNavigationPlan('go inside apple official india website', WIKI), WIKI
    );
    const b8nav = b8.find(i => i.action === 'navigate');
    check('B8 homepage search query is cleaned', !!b8nav && /duckduckgo\.com\/\?q=apple%20india%20official%20site/.test(b8nav.target || ''), JSON.stringify(actions(b8)));
    const b8click = b8.find(i => i.action === 'click');
    check('B8 homepage click target is the brand', !!b8click && b8click.target === 'apple india', JSON.stringify(actions(b8)));

    const b9 = applyNavigationGuardrails(
        [inst('navigate', 'https://www.apple.com/in/'), inst('click', 'India'), inst('wait', '5000'), inst('extract')],
        deriveNavigationPlan('go inside apple official india website', WIKI), WIKI
    );
    check('B9 direct homepage keeps the navigate', b9.some(i => i.action === 'navigate' && /apple\.com\/in/.test(i.target || '')), JSON.stringify(actions(b9)));
    check('B9 direct homepage drops the derailing click', !b9.some(i => i.action === 'click'), JSON.stringify(actions(b9)));
    check('B9 direct homepage still extracts', b9.some(i => i.action === 'extract'), JSON.stringify(actions(b9)));

    // A model may mangle an explicit URL (https://www.localhost:8899) — the
    // guardrail must restore the URL the user actually asked for.
    const b10 = applyNavigationGuardrails(
        [inst('navigate', 'https://www.localhost:8899/products.html'), inst('extract')],
        deriveNavigationPlan('open http://localhost:8899/products.html and give me the price of every product', WIKI), WIKI
    );
    const b10nav = b10.find(i => i.action === 'navigate');
    check('B10 direct_url enforces the requested URL', !!b10nav && b10nav.target === 'http://localhost:8899/products.html', JSON.stringify(actions(b10)));
    check('B10 direct_url still extracts', b10.some(i => i.action === 'extract'), JSON.stringify(actions(b10)));

    const b11 = applyNavigationGuardrails(
        [inst('extract')],
        deriveNavigationPlan('open http://localhost:8899/products.html', WIKI), WIKI
    );
    const b11nav = b11.find(i => i.action === 'navigate');
    check('B11 missing direct_url navigate is inserted', !!b11nav && b11nav.target === 'http://localhost:8899/products.html', JSON.stringify(actions(b11)));
}

// ---------------------------------------------------------------------------
// C. End-to-end planning through the primary agent
// ---------------------------------------------------------------------------

async function plan(input: string, context?: any): Promise<any> {
    const res = await fetch(`${PRIMARY}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userInput: input,
            // Pin a small, fast model so this integration check is stable.
            config: { model: process.env.QA_MODEL || 'google/gemma-3-4b', temperature: 0 },
            currentContext: context || {
                url: WIKI,
                pageTitle: 'Smartphone - Wikipedia',
                pageText: 'Smartphone From Wikipedia, the free encyclopedia. A smartphone is a mobile device... Search Wikipedia',
                availableElements: [
                    { type: 'INPUT', content: { text: '', placeholder: 'Search Wikipedia' }, selectors: { css: '#searchInput', id: 'searchInput' }, attributes: { name: 'search', tagName: 'input', inputType: 'search' } },
                    { type: 'BUTTON', content: { text: 'Search' }, selectors: { css: '#searchButton' }, attributes: { tagName: 'button' } },
                    { type: 'LINK', content: { text: 'Smartphone' }, selectors: { css: '#mwXA' }, attributes: { href: '/wiki/Smartphone', tagName: 'a' } }
                ]
            }
        }),
        signal: AbortSignal.timeout(180000)
    });
    return res.json();
}

async function sectionC() {
    console.log('\nC. End-to-end planning (live primary agent)');

    try {
        const c1 = await plan('search about smartphones');
        const list1: AgentInstruction[] = c1?.data?.generatedInstructions || [];
        const nav1 = list1.find(i => i.action === 'navigate');
        check('C1 general search navigates to a search engine', !!nav1 && /duckduckgo\.com/.test(nav1.target || ''), JSON.stringify(actions(list1)));
        const navIdx = list1.findIndex(i => i.action === 'navigate');
        check('C1 no in-page action runs before the search navigate', list1.slice(0, navIdx === -1 ? 0 : navIdx).every(i => i.action !== 'click' && i.action !== 'fill'), JSON.stringify(actions(list1)));

        const c2 = await plan('take me to the nothing homepage. Nothing is a phone brand');
        const list2: AgentInstruction[] = c2?.data?.generatedInstructions || [];
        const nav2 = list2.findIndex(i => i.action === 'navigate');
        check('C2 homepage request navigates to a new page', nav2 !== -1, JSON.stringify(actions(list2)));
        check('C2 no in-page action runs before the navigate', nav2 !== -1 && list2.slice(0, nav2).every(i => i.action !== 'click' && i.action !== 'fill'), JSON.stringify(actions(list2)));

        // The "Apple India" regression: a verb-filled homepage request from the
        // Apple sitemap must produce a clean search, not a garbage query.
        const c3 = await plan('go inside apple official india website', {
            url: 'https://www.apple.com/sitemap/',
            pageTitle: 'Site Map - Apple',
            availableElements: [
                { type: 'LINK', content: { text: 'Site Map' }, selectors: { css: 'a[href="/sitemap/"]' }, attributes: { href: '/sitemap/', tagName: 'a' } },
                { type: 'LINK', content: { text: 'Store' }, selectors: { css: 'a[href="/store/"]' }, attributes: { href: '/store/', tagName: 'a' } }
            ]
        });
        const list3: AgentInstruction[] = c3?.data?.generatedInstructions || [];
        const nav3 = list3.find(i => i.action === 'navigate');
        check('C3 apple india searches with a clean query', !!nav3 && /duckduckgo\.com\/\?q=apple%20india%20official%20site/.test(nav3.target || ''), JSON.stringify(actions(list3)));
        const click3 = list3.find(i => i.action === 'click');
        check('C3 apple india click target is the brand', !!click3 && click3.target === 'apple india', JSON.stringify(actions(list3)));
    } catch (error: any) {
        check('C end-to-end planning', false, error?.message || String(error));
    }
}

(async () => {
    console.log('Navigation-planning QA suite');
    sectionA();
    sectionB();
    await sectionC();

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.log('Failures:');
        for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed > 0 ? 1 : 0);
})();
