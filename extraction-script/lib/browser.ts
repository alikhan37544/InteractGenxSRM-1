
import { chromium, Browser, BrowserContext, Page } from 'playwright';

class BrowserManager {
    private static instance: BrowserManager;
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private isInitialized = false;
    private lastHeadless = true;

    private constructor() { }

    public static getInstance(): BrowserManager {
        if (!BrowserManager.instance) {
            BrowserManager.instance = new BrowserManager();
        }
        return BrowserManager.instance;
    }

    public async init(headless: boolean = true) {
        this.lastHeadless = headless;

        // Reuse the running browser only if it is genuinely still alive. A
        // window closed by the user leaves stale handles behind (browser
        // disconnected / page closed), so relaunch instead of failing later.
        if (this.isInitialized && this.isActive()) return;

        if (this.browser || this.isInitialized) {
            console.log("Previous browser session is gone; launching a new browser.");
        }
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isInitialized = false;

        this.browser = await chromium.launch({ headless });
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(30000);
        this.isInitialized = true;
        console.log("Browser initialized.");
    }

    public isActive() {
        return !!this.page && !this.page.isClosed() && !!this.browser && this.browser.isConnected();
    }

    /**
     * URL + title of the current page, or null when no browser is open.
     * Never launches a browser (safe to poll for status).
     */
    public async getPageInfo(): Promise<{ url: string; title: string } | null> {
        if (!this.isActive()) return null;
        try {
            return {
                url: this.page!.url(),
                title: await this.page!.title()
            };
        } catch {
            return null;
        }
    }

    public async navigate(url: string) {
        if (!this.page) throw new Error("Browser not initialized. Call init() first.");

        // Only navigate if URL is different
        if (this.page.url() !== url) {
            console.log(`Navigating to ${url}...`);
            await this.page.goto(url, { waitUntil: 'domcontentloaded' });
            await this.page.waitForTimeout(1000); // Allow settle
        } else {
            console.log(`Already on ${url}, refreshing content...`);
        }
    }

    public async clickElement(selector: string) {
        if (!this.page) throw new Error("Browser not initialized.");
        console.log(`Clicking element: ${selector}`);

        const context = this.page.context();
        const pagesBefore = new Set(context.pages());
        const urlBefore = this.page.url();

        try {
            await this.page.click(selector, { timeout: 5000 });
        } catch (e) {
            // A selector can match several elements where the first one is
            // disabled (e.g. a submit button that activates after the search box
            // is filled). Prefer an enabled match, waiting briefly in case the
            // element is about to become enabled.
            const enabledClicked = await this.clickEnabledMatch(selector).catch(() => false);
            if (!enabledClicked) {
                // The element may be hidden behind a toggle (e.g. a collapsed menu).
                // Try to reveal it by clicking a matching visible trigger, then retry.
                console.warn(`Click failed for ${selector}; attempting to reveal hidden element...`);
                const revealed = await this.tryReveal(selector);
                if (!revealed) {
                    console.error(`Failed to click ${selector}:`, e);
                    throw e;
                }
                await this.page.click(selector, { timeout: 5000 });
            }
        }

        await this.page.waitForLoadState('domcontentloaded').catch(() => { }); // Catch if no nav happens
        await this.page.waitForTimeout(1000); // Wait for potential dynamic updates

        // A link with target="_blank" opens a new tab and leaves the current
        // page untouched. Follow the new tab so "click a result" still counts
        // as navigation instead of silently doing nothing.
        if (this.page.url() === urlBefore) {
            const newPage = context.pages().filter(p => !pagesBefore.has(p));
            const next = newPage[newPage.length - 1];
            if (next) {
                console.log("Click opened a new tab; switching to it.");
                await next.waitForLoadState('domcontentloaded').catch(() => { });
                await next.waitForTimeout(500).catch(() => { });
                this.page = next;
            }
        }
    }

    /**
     * Click the first visible + enabled element matching the selector. Waits a
     * short while for a disabled match to become enabled (common for search
     * submit buttons that activate once their input has text).
     */
    private async clickEnabledMatch(selector: string): Promise<boolean> {
        if (!this.page) return false;
        const locator = this.page.locator(selector);
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
            // Re-query each pass: the page may add/remove matches while we wait.
            const count = await locator.count().catch(() => 0);
            if (count === 0) return false;
            for (let i = 0; i < count; i++) {
                const candidate = locator.nth(i);
                const visible = await candidate.isVisible().catch(() => false);
                if (!visible) continue;
                const enabled = await candidate.isEnabled().catch(() => false);
                if (!enabled) continue;
                try {
                    await candidate.click({ timeout: 3000 });
                    return true;
                } catch {
                    // Try the next match (overlay, animation, detached node, ...)
                }
            }
            await this.page.waitForTimeout(300);
        }
        return false;
    }

    /**
     * Fill an element and return the selector that was actually used. If the
     * provided selector does not match (e.g. the model guessed
     * `input[name='q']` but the site uses a textarea), falls back to the best
     * visible editable field on the page.
     */
    public async fillElement(selector: string, value: string): Promise<string> {
        if (!this.page) throw new Error("Browser not initialized.");
        console.log(`Filling element: ${selector} with "${value}"`);

        let usedSelector = selector;
        let filled = false;
        try {
            await this.page.fill(selector, value, { timeout: 5000 });
            filled = true;
        } catch (e) {
            // Hidden inputs (e.g. a collapsed search overlay) are a common pattern:
            // click the visible toggle that reveals them, then retry.
            console.warn(`Fill failed for ${selector}; attempting to reveal hidden element...`);
            const revealed = await this.tryReveal(selector);
            if (revealed) {
                try {
                    await this.page.fill(selector, value, { timeout: 5000 });
                    filled = true;
                } catch { /* fall through */ }
            }

            // If the selector does match elements but they are not actionable
            // (e.g. hidden behind an overlay), a force fill is the least
            // surprising recovery and keeps the caller's intent.
            if (!filled && await this.countMatches(selector) > 0) {
                console.warn(`Retrying fill with force for ${selector}...`);
                try {
                    await this.page.fill(selector, value, { force: true, timeout: 5000 });
                    filled = true;
                } catch { /* fall through to the editable-field fallback */ }
            }

            // Otherwise the selector matches nothing at all (wrong tag or a
            // guessed attribute). Fall back to the best visible editable field,
            // which is what the user almost always means.
            if (!filled) {
                const fallback = await this.findEditableField();
                if (fallback) {
                    console.warn(`Falling back to editable field: ${fallback}`);
                    await this.page.fill(fallback, value, { timeout: 5000 });
                    filled = true;
                    usedSelector = fallback;
                }
            }

            if (!filled) {
                console.error(`Fill failed: selector matches no elements: ${selector}`);
                throw e;
            }
        }

        // Submit search inputs with Enter so the search actually runs even when
        // the page has no separate (or not-yet-rendered) submit button.
        if (filled && await this.isSearchInput(usedSelector)) {
            console.log(`Submitting search input with Enter: ${usedSelector}`);
            await this.page.press(usedSelector, 'Enter', { timeout: 3000 }).catch((e) => {
                console.warn(`Enter submit failed for ${usedSelector}:`, e.message);
            });
        }

        await this.page.waitForTimeout(500); // Wait for potential validation/UI updates
        return usedSelector;
    }

    /**
     * Find the best visible, enabled editable field on the page (search boxes
     * first) and return a stable CSS selector for it. Skips credentials fields
     * so a wrong selector never types into a password box.
     */
    private async findEditableField(): Promise<string | null> {
        if (!this.page) return null;
        try {
            return await this.page.evaluate(() => {
                const nodes = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="searchbox"], [role="textbox"]'));
                let best: HTMLElement | null = null;
                let bestScore = -1;
                for (const n of nodes) {
                    const el = n as HTMLElement;
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' || r.width === 0 || r.height === 0) continue;
                    if ((el as HTMLInputElement).disabled === true) continue;
                    if ((el as HTMLInputElement).readOnly === true) continue;
                    const tag = el.tagName.toLowerCase();
                    if (tag === 'input') {
                        const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
                        if (['hidden', 'checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'range', 'color', 'image', 'password'].indexOf(t) !== -1) continue;
                    }
                    const hint = [
                        el.getAttribute('type'),
                        el.getAttribute('name'),
                        el.getAttribute('placeholder'),
                        el.getAttribute('aria-label'),
                        el.getAttribute('role'),
                        el.getAttribute('id'),
                        typeof el.className === 'string' ? el.className : ''
                    ].filter(Boolean).join(' ').toLowerCase();
                    let score = 0;
                    if (/search|query/.test(hint)) score += 3;
                    if (/private|privacy/.test(hint)) score += 1;
                    if (tag === 'textarea') score += 1;
                    const role = el.getAttribute('role');
                    if (role === 'searchbox' || role === 'combobox' || role === 'textbox') score += 1;
                    if (score > bestScore) { bestScore = score; best = el; }
                }
                if (!best) return null;
                // Build a stable CSS selector (mirrors getPageContent) so the
                // caller does not depend on a temporary marker attribute.
                if (best.id) return '#' + best.id;
                const path: string[] = [];
                let node: Element | null = best;
                while (node && node.nodeType === Node.ELEMENT_NODE) {
                    let selector = node.nodeName.toLowerCase();
                    if (node.id) {
                        selector += '#' + node.id;
                        path.unshift(selector);
                        break;
                    } else {
                        let sib: Element | null = node;
                        let nth = 1;
                        while (sib = sib.previousElementSibling) {
                            if (sib.nodeName.toLowerCase() == selector) nth++;
                        }
                        if (nth != 1) selector += ':nth-of-type(' + nth + ')';
                    }
                    path.unshift(selector);
                    node = node.parentNode as Element;
                }
                return path.join(' > ');
            });
        } catch {
            return null;
        }
    }

    private async isSearchInput(selector: string): Promise<boolean> {
        if (!this.page) return false;
        try {
            return await this.page.evaluate((sel: string) => {
                const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
                if (!el) return false;
                const tag = el.tagName.toLowerCase();
                if (tag !== 'input' && tag !== 'textarea') return false;
                const hint = `${el.getAttribute('type') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('name') || ''} ${el.getAttribute('role') || ''} ${typeof el.className === 'string' ? el.className : ''}`;
                return /search|query|private|privacy|\bq\b/i.test(hint);
            }, selector);
        } catch {
            return false;
        }
    }

    /**
     * Try to reveal a hidden element by clicking a visible trigger that shares a
     * keyword with it (e.g. a "search" icon toggling a hidden search input).
     * Returns true if the target is visible after the attempt.
     */
    private async tryReveal(selector: string): Promise<boolean> {
        if (!this.page) return false;
        try {
            const marker = `data-agents-reveal-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
            const outcome = await this.page.evaluate((args: { sel: string; marker: string }) => {
                const target = document.querySelector(args.sel);
                if (!target) return 'missing';
                const tStyle = window.getComputedStyle(target);
                const tRect = target.getBoundingClientRect();
                if (tStyle.display !== 'none' && tStyle.visibility !== 'hidden' && tStyle.opacity !== '0' && tRect.width > 0 && tRect.height > 0) return 'visible';

                const ignored = ['type', 'input', 'button', 'header', 'form', 'wrap', 'group', 'row', 'inner', 'overlay', 'block', 'flex', 'container', 'wrapper', 'main', 'body', 'html', 'nth-of-type'];
                const tokens: string[] = [];
                const sources = [
                    target.getAttribute('type'),
                    target.getAttribute('placeholder'),
                    target.getAttribute('aria-label'),
                    target.getAttribute('name'),
                    target.getAttribute('id'),
                    typeof (target as HTMLElement).className === 'string' ? (target as HTMLElement).className : ''
                ];
                sources.forEach(v => {
                    if (!v) return;
                    v.toLowerCase().split(/[^a-z0-9]+/).forEach(t => {
                        if (t.length >= 3 && ignored.indexOf(t) === -1 && tokens.indexOf(t) === -1) tokens.push(t);
                    });
                });

                const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
                let best: HTMLElement | null = null;
                let bestScore = 0;
                for (const c of candidates) {
                    const el = c as HTMLElement;
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' || r.width === 0 || r.height === 0) continue;
                    if (el === target || el.contains(target)) continue;
                    const hay = [el.getAttribute('aria-label'), el.getAttribute('title'), el.id, typeof el.className === 'string' ? el.className : '', el.innerText].filter(Boolean).join(' ').toLowerCase();
                    let score = 0;
                    // Match tokens at word boundaries so e.g. "enter" does not
                    // match "align-items-center".
                    tokens.forEach(t => { if (new RegExp('(^|[^a-z0-9])' + t).test(hay)) score++; });
                    if (score > bestScore) { bestScore = score; best = el; }
                }
                if (!best || bestScore === 0) return 'no-trigger';
                best.setAttribute(args.marker, '1');
                return 'trigger';
            }, { sel: selector, marker });

            if (outcome === 'visible') return true;
            if (outcome !== 'trigger') return false;

            // Click with Playwright so the page receives a trusted event; some
            // sites ignore synthetic el.click() for toggles.
            const triggerSelector = `[${marker}="1"]`;
            await this.page.click(triggerSelector, { timeout: 5000 });
            await this.page.evaluate((m: string) => {
                const el = document.querySelector(`[${m}="1"]`);
                if (el) el.removeAttribute(m);
            }, marker).catch(() => { });
            await this.page.waitForTimeout(800);

            const visible = await this.page.evaluate((sel: string) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                const s = window.getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
            }, selector).catch(() => false);
            return visible;
        } catch (e) {
            console.warn(`Reveal attempt failed for ${selector}:`, e);
            return false;
        }
    }

    public async countMatches(selector: string): Promise<number> {
        if (!this.page) return 0;
        try {
            return await this.page.locator(selector).count();
        } catch {
            return 0;
        }
    }

    /**
     * Count matches that are actually clickable/fillable (visible + enabled).
     * A selector that only matches disabled or hidden elements is not useful.
     */
    public async countActionableMatches(selector: string): Promise<number> {
        if (!this.page) return 0;
        try {
            const locator = this.page.locator(selector);
            const count = await locator.count();
            let actionable = 0;
            for (let i = 0; i < count; i++) {
                const candidate = locator.nth(i);
                const visible = await candidate.isVisible().catch(() => false);
                if (!visible) continue;
                const enabled = await candidate.isEnabled().catch(() => false);
                if (enabled) actionable++;
            }
            return actionable;
        } catch {
            return 0;
        }
    }

    public async getSimplifiedHtml() {
        if (!this.page) throw new Error("Browser not initialized.");

        return await this.page.evaluate(() => {
            // Clone body to not affect live page
            const clone = document.body.cloneNode(true) as HTMLElement;

            // Remove clutter
            const removeTags = ['script', 'style', 'svg', 'noscript', 'iframe', 'link', 'meta'];
            removeTags.forEach(tag => {
                const elements = clone.querySelectorAll(tag);
                elements.forEach(el => el.remove());
            });

            // Remove comments (optional, but good for saving tokens)
            const iterator = document.createNodeIterator(clone, NodeFilter.SHOW_COMMENT);
            let curNode;
            while (curNode = iterator.nextNode()) {
                curNode.parentNode?.removeChild(curNode);
            }

            // Aggressive Cleanup
            const allElements = clone.querySelectorAll('*');
            allElements.forEach(el => {
                // Keep only semantic/identifying attributes
                const allowedAttrs = ['id', 'class', 'role', 'type', 'name', 'aria-label', 'placeholder'];
                const attrs = el.attributes;
                for (let i = attrs.length - 1; i >= 0; i--) {
                    if (!allowedAttrs.includes(attrs[i].name)) {
                        el.removeAttribute(attrs[i].name);
                    }
                }

                // Truncate long text content
                // Note: This matches immediate text nodes
                el.childNodes.forEach(child => {
                    if (child.nodeType === Node.TEXT_NODE && child.textContent) {
                        if (child.textContent.length > 50) {
                            child.textContent = child.textContent.substring(0, 50) + '...';
                        }
                    }
                });
            });

            // Remove empty containers (optional, might break structure, safe to skip for now)

            return clone.outerHTML;
        });
    }

    public async getPageContent() {
        if (!this.page) throw new Error("Browser not initialized.");

        // Evaluate extraction logic (Same as before)
        return await this.page.evaluate(() => {
            const results: any[] = [];

            const candidates = document.querySelectorAll('a, button, input, textarea, [role="button"]');
            candidates.forEach((el) => {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    style.opacity === '0' ||
                    el.getBoundingClientRect().width === 0 ||
                    el.getBoundingClientRect().height === 0) return;

                let type = 'BUTTON'; // Default to BUTTON for candidates as they are likely interactive
                const tagName = el.tagName.toLowerCase();
                const role = el.getAttribute('role')?.toLowerCase();

                if (tagName === 'a') {
                    type = 'LINK';
                } else if (tagName === 'input') {
                    const inputType = (el as HTMLInputElement).type.toLowerCase();
                    if (['button', 'submit', 'reset'].includes(inputType)) {
                        type = 'BUTTON';
                    } else {
                        type = 'INPUT';
                    }
                } else if (tagName === 'textarea') {
                    type = 'INPUT';
                }
                // button, [role=button], and others fall through to default BUTTON

                // Get text or value depending on type
                let text = (el as HTMLElement).innerText || '';
                if (type === 'INPUT') {
                    text = (el as HTMLInputElement).value || el.getAttribute('value') || '';
                }

                const placeholder = el.getAttribute('placeholder') || null;
                const rect = el.getBoundingClientRect();

                // Build CSS selector (inlined to avoid esbuild __name helpers leaking
                // into the function that Playwright serializes into the page context)
                let css: string;
                if (el.id) {
                    css = `#${el.id}`;
                } else {
                    const path: string[] = [];
                    let node: Element | null = el;
                    while (node && node.nodeType === Node.ELEMENT_NODE) {
                        let selector = node.nodeName.toLowerCase();
                        if (node.id) {
                            selector += '#' + node.id;
                            path.unshift(selector);
                            break;
                        } else {
                            let sib: Element | null = node;
                            let nth = 1;
                            while (sib = sib.previousElementSibling) {
                                if (sib.nodeName.toLowerCase() == selector)
                                    nth++;
                            }
                            if (nth != 1)
                                selector += ":nth-of-type(" + nth + ")";
                        }
                        path.unshift(selector);
                        node = node.parentNode as Element;
                    }
                    css = path.join(" > ");
                }

                results.push({
                    type,
                    content: { text: text.substring(0, 100).trim(), placeholder },
                    selectors: { css, id: el.id || null },
                    attributes: {
                        href: el.getAttribute('href') || null,
                        name: el.getAttribute('name') || null,
                        src: el.getAttribute('src') || null,
                        ariaLabel: el.getAttribute('aria-label') || null,
                        title: el.getAttribute('title') || null,
                        className: typeof (el as HTMLElement).className === 'string' ? ((el as HTMLElement).className || null) : null,
                        tagName: tagName,
                        inputType: el.getAttribute('type') || null,
                        disabled: (el as HTMLInputElement).disabled === true
                    },
                    geometry: {
                        x: Math.round(rect.x + window.scrollX),
                        y: Math.round(rect.y + window.scrollY)
                    }
                });
            });
            return {
                url: window.location.href,
                title: document.title,
                // Visible page text (normalized) so the agent can actually read
                // the page, not just its interactive elements. Truncated to keep
                // prompts within a reasonable token budget.
                text: ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 10000),
                elements: results
            };
        });
    }

    /**
     * Capture a screenshot of the current page as a base64 PNG data URL.
     * Returns null when the browser is not initialized or the shot fails.
     */
    public async takeScreenshot(): Promise<string | null> {
        if (!this.page || this.page.isClosed()) return null;
        try {
            const buffer = await this.page.screenshot({ type: 'png' });
            return `data:image/png;base64,${buffer.toString('base64')}`;
        } catch (error) {
            console.warn('Screenshot failed:', error);
            return null;
        }
    }

    /**
     * Lightweight page signature (url/title/leading text) without extracting
     * elements — used for polling (e.g. waiting for a CAPTCHA to be solved).
     */
    public async getPageSummary(): Promise<{ url: string; title: string; text: string } | null> {
        if (!this.isActive()) return null;
        try {
            return await this.page!.evaluate(() => ({
                url: window.location.href,
                title: document.title,
                text: ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 2000)
            }));
        } catch {
            return null;
        }
    }

    /**
     * Capture up to `max` viewport screenshots while scrolling from the top of
     * the page to the bottom, so a vision model can see the whole page. Images
     * are JPEG to keep the payload small. The scroll position is restored.
     */
    public async takeScreenshots(max: number = 4): Promise<string[]> {
        if (!this.isActive()) return [];
        const shots: string[] = [];
        let originalY = 0;
        try {
            originalY = await this.page!.evaluate(() => window.scrollY).catch(() => 0);
            await this.page!.evaluate(() => window.scrollTo(0, 0)).catch(() => { });
            await this.page!.waitForTimeout(350);

            for (let i = 0; i < max; i++) {
                const buffer = await this.page!.screenshot({ type: 'jpeg', quality: 70 });
                shots.push(`data:image/jpeg;base64,${buffer.toString('base64')}`);

                const atBottom = await this.page!.evaluate(() =>
                    (window.scrollY + window.innerHeight) >= (document.body.scrollHeight - 20)
                ).catch(() => true);
                if (atBottom) break;

                await this.page!.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9))).catch(() => { });
                await this.page!.waitForTimeout(450);
            }
        } catch (error) {
            console.warn('Multi-screenshot failed:', error);
        } finally {
            if (this.page && !this.page.isClosed()) {
                await this.page.evaluate((y: number) => window.scrollTo(0, y), originalY).catch(() => { });
            }
        }
        return shots;
    }

    public async scrollPage(direction: 'up' | 'down' | 'top' | 'bottom') {
        if (!this.page) throw new Error("Browser not initialized.");

        await this.page.evaluate((dir: string) => {
            const scrollAmount = window.innerHeight * 0.8;
            if (dir === 'down') {
                window.scrollBy(0, scrollAmount);
            } else if (dir === 'up') {
                window.scrollBy(0, -scrollAmount);
            } else if (dir === 'top') {
                window.scrollTo(0, 0);
            } else if (dir === 'bottom') {
                window.scrollTo(0, document.body.scrollHeight);
            }
        }, direction);

        await this.page.waitForTimeout(500); // Allow scroll to complete
    }

    public async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
            this.isInitialized = false;
            console.log("Browser closed.");
        }
    }
}

// In Next.js dev mode, global instance is needed to prevent hot-reload from killing it
const globalForBrowser = global as unknown as { browserManager: BrowserManager };
const browserManager = globalForBrowser.browserManager || BrowserManager.getInstance();
if (process.env.NODE_ENV !== 'production') globalForBrowser.browserManager = browserManager;

export default browserManager;
