// Shared URL helpers for browser navigation.

/** True for localhost, *.localhost, bracketed IPv6 and IPv4 literals. */
function isLocalHost(host: string): boolean {
    return (
        /^(localhost|.*\.localhost)$/i.test(host) ||
        /^\[[0-9a-f:]+\]$/i.test(host) ||
        /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
    );
}

/** True for a dotted hostname like "example.com" or "en.wikipedia.org". */
function isDomain(host: string): boolean {
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host);
}

function searchUrl(query: string): string {
    return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

/**
 * True for template placeholders a model may emit instead of a real target,
 * e.g. "[extracted_url]", "<url>" or "{{link}}". These are not search phrases.
 */
export function isPlaceholderTarget(target: string): boolean {
    const t = (target || '').trim();
    if (!t) return false;
    return (
        /^[\[<{(].*[\]>})]$/.test(t) ||
        /\b(?:extracted_url|placeholder|your_url|url_here|insert_url|the_url)\b/i.test(t)
    );
}

/**
 * Normalize a navigation target coming from an LLM or the portal's URL bar:
 *
 * - "example.com"            -> "https://example.com"
 * - "en.wikipedia.org/wiki/X"-> "https://en.wikipedia.org/wiki/X"
 * - "example.com:8080/path"  -> "https://example.com:8080/path"
 * - "localhost:8899/x"       -> "http://localhost:8899/x"
 * - "127.0.0.1:3000"         -> "http://127.0.0.1:3000"
 * - "https://example.com"    -> unchanged
 * - "about:blank"            -> unchanged
 * - "google" / "my query"    -> DuckDuckGo search for the text
 *
 * Bare words that are not domains are treated as searches, so an accidental
 * single-word target never crashes navigation with an invalid-URL error.
 */
export function normalizeNavigationTarget(input: string): string {
    const target = (input || '').trim();
    if (!target) return target;

    // Absolute URL with a scheme (http://, https://, file://, ...) or a known
    // scheme that has no "//" (about:, data:, ...).
    if (
        /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ||
        /^(about|data|file|chrome|view-source|mailto|tel|javascript):/i.test(target)
    ) {
        return target;
    }

    // Anything with whitespace is a search phrase.
    if (/\s/.test(target)) {
        return searchUrl(target);
    }

    // A placeholder ("[extracted_url]", "<url>") is not a real target and must
    // not be turned into a web search: return it unchanged so navigation fails
    // with a clear "invalid URL" error instead of searching for garbage.
    if (isPlaceholderTarget(target)) {
        return target;
    }

    // Split off the authority (host[:port]) from any path/query/hash.
    const authority = target.split(/[/?#]/)[0];
    const hasPort = /:\d+$/.test(authority);
    const host = authority.replace(/:\d+$/, '');

    // A domain, a localhost/IP literal, or a bare hostname with an explicit port.
    if (isDomain(host) || isLocalHost(host) || (hasPort && /^[a-z0-9-]+$/i.test(host))) {
        return `${isLocalHost(host) ? 'http' : 'https'}://${target}`;
    }

    // Anything else (bare words, phrases) is a search.
    return searchUrl(target);
}
