// Primary Agent: navigation strategy.
//
// Decides whether a request means "act on the current page" (click/fill) or
// "go to a new page" (navigate), so the planner does not, for example, search
// the site the browser happens to be on when the user asked for a general web
// search.
//
// The decision is derived deterministically from the user's words, then:
//   - injected into the planner prompt as an explicit strategy, and
//   - enforced afterwards by applyNavigationGuardrails().

import { AgentInstruction } from '../shared/types';
import { normalizeNavigationTarget, isPlaceholderTarget } from '../shared/url';

export type NavigationStrategy =
    | 'web_search'    // general search on a search engine
    | 'site_search'   // search within a named site
    | 'homepage'      // go to a brand's official site
    | 'direct_url'    // go to an explicit URL/domain
    | 'in_page'       // click/fill on the current page
    | 'read_current'  // follow-up about the current page/topic
    | 'unknown';

export interface NavigationPlan {
    strategy: NavigationStrategy;
    /** Search query for web_search / site_search. */
    query?: string;
    /** Site name for site_search. */
    site?: string;
    /** Brand/site name for homepage. */
    name?: string;
    /** Absolute URL for direct_url. */
    url?: string;
    reason: string;
}

const FOLLOW_UP = /^\s*(?:tell\s+me\s+more|more(?:\s+please)?|continue|go\s+on|keep\s+going|elaborate|explain(?:\s+(?:more|further))?|what\s+else|and\?|why\?|how\?|yes\s+please)\s*[.!?]*\s*$/i;

// An explicit URL or bare domain anywhere in the request.
const URL_TOKEN = /(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/i;

// "search the web for X" / "look up X on the internet"
const WEB_FOR = /\b(?:search|look\s+up)\s+(?:the\s+)?(?:web|internet|online)\s+for\s+(.+)/i;

// "search <site> for <query>" / "search for <query> on <site>" / "on <site>, search for <query>"
const SITE_SEARCH_A = /\bsearch\s+(?:on\s+)?(?:the\s+)?([a-z0-9][\w.&'’-]*)\s+for\s+(.+)/i;
const SITE_SEARCH_B = /\bsearch\s+for\s+(.+?)\s+(?:on|in)\s+([a-z0-9][\w.&'’-]*)/i;
const SITE_SEARCH_C = /\b(?:on|in)\s+(?:the\s+)?([a-z0-9][\w.&'’-]*)\s*,?\s+search\s+(?:for\s+)?(.+)/i;

const GENERAL_SEARCH = /\b(?:search|look\s+up|google)\b\s+(?:about\s+|for\s+)?(.+)/i;

const HOMEPAGE = /\b(?:home\s?page|homepage|official\s+(?:site|website|page)|website|web\s?site)\b/i;
const NAV_VERB = /\b(?:go\s+to|navigate\s+to|take\s+me\s+to|bring\s+me\s+to|open|visit)\b\s+(.+)/i;

// Leading filler before a brand name, e.g. "go inside the apple website" or
// "check out apple's site" — stripped so the brand name is not polluted.
const LEADING_VERB = /^\s*(?:(?:go|get|head|navigate|take|bring|open|visit|enter|jump|check\s+out|let'?s)\b\s*)+/i;
const LEADING_PARTICLE = /^\s*(?:inside|into|to)\b\s*/i;

const IN_PAGE_VERB = /\b(?:click|press|tap|select|check|uncheck|submit|scroll|fill|type\s+into)\b/i;
const RESULT_REF = /\b(?:first|second|third|fourth|fifth|top|next|previous|that|this|the)\s+(?:result|link|article|item|headline|entry|one)\b/i;

const GENERIC_SEARCH_TARGET = /^(?:the\s+)?(?:web|internet|online|google|duckduckgo|bing|search\s+engine)$/i;

function siteSearch(site: string, query: string): NavigationPlan {
    return {
        strategy: 'site_search',
        site: site.trim(),
        query: query.trim(),
        reason: `Search "${query.trim()}" on ${site.trim()}`
    };
}

/** Extract the brand/site name from a homepage request. */
function extractTargetName(text: string): string {
    const nav = text.match(NAV_VERB);
    let candidate = nav ? nav[1] : text;
    candidate = candidate.split(/[.!?]/)[0];
    candidate = candidate
        .replace(LEADING_VERB, '')
        .replace(LEADING_PARTICLE, '')
        .replace(HOMEPAGE, ' ')
        .replace(/\b(?:official|the|a|an|please|me|my)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return candidate;
}

/**
 * Decide what kind of navigation the user's request implies.
 */
export function deriveNavigationPlan(input: string, _currentUrl?: string): NavigationPlan {
    const text = (input || '').trim();
    if (!text) return { strategy: 'unknown', reason: 'Empty request' };

    if (FOLLOW_UP.test(text)) {
        return { strategy: 'read_current', reason: 'Follow-up about the current topic' };
    }

    const urlMatch = text.match(URL_TOKEN);
    if (urlMatch) {
        return {
            strategy: 'direct_url',
            url: normalizeNavigationTarget(urlMatch[0]),
            reason: 'Request contains an explicit URL'
        };
    }

    const webFor = text.match(WEB_FOR);
    if (webFor) {
        return { strategy: 'web_search', query: webFor[1].trim(), reason: 'General web search' };
    }

    const siteA = text.match(SITE_SEARCH_A);
    if (siteA && !GENERIC_SEARCH_TARGET.test(siteA[1].trim())) {
        return siteSearch(siteA[1], siteA[2]);
    }
    const siteB = text.match(SITE_SEARCH_B);
    if (siteB && !GENERIC_SEARCH_TARGET.test(siteB[2].trim())) {
        return siteSearch(siteB[2], siteB[1]);
    }
    const siteC = text.match(SITE_SEARCH_C);
    if (siteC && !GENERIC_SEARCH_TARGET.test(siteC[1].trim())) {
        return siteSearch(siteC[1], siteC[2]);
    }

    if (HOMEPAGE.test(text)) {
        return { strategy: 'homepage', name: extractTargetName(text), reason: 'Request for a brand/site homepage' };
    }

    const general = text.match(GENERAL_SEARCH);
    if (general) {
        return { strategy: 'web_search', query: general[1].trim(), reason: 'General web search' };
    }

    if (RESULT_REF.test(text) || IN_PAGE_VERB.test(text)) {
        return { strategy: 'in_page', reason: 'Interact with an element on the current page' };
    }

    return { strategy: 'unknown', reason: 'No clear navigation intent' };
}

/**
 * Render the derived strategy as an explicit instruction for the planner LLM.
 */
export function buildNavigationDirective(plan: NavigationPlan, _currentUrl?: string): string {
    switch (plan.strategy) {
        case 'web_search':
            return `NAVIGATION STRATEGY (decided for you): GENERAL WEB SEARCH for "${plan.query}". This is a NEW-PAGE navigation: navigate to https://duckduckgo.com/?q=${encodeURIComponent(plan.query || '')}, wait for the results, then extract. Do NOT click or fill the current page's search box, and do NOT use the current site's own search.`;
        case 'site_search':
            return `NAVIGATION STRATEGY (decided for you): SITE SEARCH on ${plan.site} for "${plan.query}". If the browser is not already on ${plan.site}, navigate to it first; then use that site's own search box for the query.`;
        case 'homepage':
            return `NAVIGATION STRATEGY (decided for you): GO TO THE OFFICIAL SITE of "${plan.name || 'the requested brand'}". This is a NEW-PAGE navigation. If you know the exact official URL — including a country/locale path such as /in/ for India — navigate directly to it; otherwise navigate to https://duckduckgo.com/?q=${encodeURIComponent((plan.name || '') + ' official site')} and click the official result. Do NOT use the current page's search, and do NOT add extra clicks once you are on the official site.`;
        case 'direct_url':
            return `NAVIGATION STRATEGY (decided for you): GO TO ${plan.url}. This is a NEW-PAGE navigation: navigate to that URL and extract the page. Do not click or fill anything on the current page first.`;
        case 'read_current':
            return `NAVIGATION STRATEGY (decided for you): READ THE CURRENT PAGE. The user is following up on the current topic. Do NOT navigate to a new site and do NOT run a new search: click an authoritative link already on the page if needed, then extract.`;
        case 'in_page':
            return `NAVIGATION STRATEGY (decided for you): ACT ON THE CURRENT PAGE. Use click/fill on elements that exist on the current page; do not navigate to a new site unless the user explicitly asks.`;
        default:
            return '';
    }
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

const IN_PAGE_ACTIONS = new Set(['click', 'fill', 'scroll']);

function makeInstruction(action: AgentInstruction['action'], target: string | undefined, reasoning: string): AgentInstruction {
    return {
        id: `guard_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        action,
        target,
        reasoning,
        priority: 'high'
    };
}

function originOf(url?: string): string | null {
    if (!url) return null;
    try {
        return new URL(normalizeNavigationTarget(url)).origin;
    } catch {
        return null;
    }
}

/** True when navigating to `target` leaves the current site. */
function isCrossSite(target: string | undefined, currentUrl?: string): boolean {
    if (!target) return false;
    const targetOrigin = originOf(target);
    const currentOrigin = originOf(currentUrl);
    if (!targetOrigin || !currentOrigin) return true;
    return targetOrigin !== currentOrigin;
}

/**
 * Repair a plan that mixes "same page" and "new page" actions:
 *  - drop in-page actions that would run before navigating away,
 *  - force a general web search onto a search engine with the query,
 *  - keep follow-ups on the current page.
 */
export function applyNavigationGuardrails(
    instructions: AgentInstruction[],
    plan: NavigationPlan,
    currentUrl?: string
): AgentInstruction[] {
    if (!Array.isArray(instructions) || instructions.length === 0) return instructions;
    let result = instructions.map(i => ({ ...i }));

    // 1. A navigate to another site makes any in-page action before it
    //    meaningless (it would run on the page we are leaving).
    const crossSiteIndex = result.findIndex(i => i.action === 'navigate' && isCrossSite(i.target, currentUrl));
    if (crossSiteIndex > 0) {
        result = result.filter((i, idx) => idx >= crossSiteIndex || !IN_PAGE_ACTIONS.has(i.action));
    }

    // 2. A general web search must land on a search engine with the query.
    if (plan.strategy === 'web_search' && plan.query) {
        const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(plan.query)}`;
        let navIndex = result.findIndex(i => i.action === 'navigate');
        if (navIndex === -1) {
            result.unshift(makeInstruction('navigate', searchUrl, `Search the web for "${plan.query}"`));
            navIndex = 0;
        } else {
            // Always search with DuckDuckGo: Google blocks automated browsers.
            result[navIndex] = { ...result[navIndex], action: 'navigate', target: searchUrl, value: undefined };
        }
        // Drop any in-page action still scheduled before the search.
        result = result.filter((i, idx) => idx >= navIndex || !IN_PAGE_ACTIONS.has(i.action));
        if (!result.some(i => i.action === 'extract')) {
            result.push(makeInstruction('extract', undefined, 'Capture the search results'));
        }
    }

    // 2b. An explicit URL request must land on exactly that URL: the model may
    //     mangle the scheme or host (e.g. https://www.localhost:8899). Enforce
    //     the normalized URL from the user's words.
    if (plan.strategy === 'direct_url' && plan.url) {
        const navIndex = result.findIndex(i => i.action === 'navigate');
        if (navIndex === -1) {
            result.unshift(makeInstruction('navigate', plan.url, `Navigate to ${plan.url}`));
        } else {
            result[navIndex] = { ...result[navIndex], action: 'navigate', target: plan.url, value: undefined };
        }
        result = result.filter((i, idx) => idx >= navIndex || !IN_PAGE_ACTIONS.has(i.action));
        if (!result.some(i => i.action === 'extract')) {
            result.push(makeInstruction('extract', undefined, 'Read the page'));
        }
    }

    // 3. A follow-up about the current topic must not jump to a new site.
    //    Same-site navigations (e.g. back to a catalog to open another item)
    //    are allowed so multi-round explorations can move around the site.
    if (plan.strategy === 'read_current') {
        result = result.filter(i => i.action !== 'navigate' || !isCrossSite(i.target, currentUrl));
        if (!result.some(i => i.action === 'extract')) {
            result.push(makeInstruction('extract', undefined, 'Read the current page'));
        }
    }

    // 4. Homepage requests: when the exact URL is unknown the agent searches
    //    for the official site. Force a clean query (a model may emit a
    //    placeholder, a garbage query, or a wrong search engine) and give the
    //    follow-up click a resolvable target instead of an invented phrase.
    if (plan.strategy === 'homepage' && plan.name) {
        const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(`${plan.name} official site`)}`;
        let navIndex = result.findIndex(i => i.action === 'navigate');
        const navTarget = navIndex !== -1 ? (result[navIndex].target || '') : '';
        const navIsSearch = /duckduckgo\.com|google\.|bing\.com/i.test(navTarget);
        let usedSearch = false;

        if (navIndex === -1) {
            result.unshift(makeInstruction('navigate', searchUrl, `Search for the official ${plan.name} site`));
            navIndex = 0;
            usedSearch = true;
        } else if (isPlaceholderTarget(navTarget) || navIsSearch) {
            result[navIndex] = {
                ...result[navIndex],
                action: 'navigate',
                target: searchUrl,
                value: undefined,
                reasoning: `Search for the official ${plan.name} site`
            };
            usedSearch = true;
        }

        if (usedSearch) {
            const clickIndex = result.findIndex((i, idx) => i.action === 'click' && idx > navIndex);
            if (clickIndex !== -1) {
                result[clickIndex] = { ...result[clickIndex], target: plan.name };
            } else {
                result.push(makeInstruction('click', plan.name, `Open the official ${plan.name} result`));
            }
            if (!result.some(i => i.action === 'extract')) {
                result.push(makeInstruction('extract', undefined, 'Capture the official site'));
            }
        } else {
            // The agent knows the official URL: arrive and read it. Extra clicks
            // (e.g. a country/region selector on the site) can navigate away.
            result = result.filter((i, idx) => idx <= navIndex || (i.action !== 'click' && i.action !== 'fill'));
            if (!result.some(i => i.action === 'extract')) {
                result.push(makeInstruction('extract', undefined, 'Capture the official site'));
            }
        }
    }

    return result;
}
