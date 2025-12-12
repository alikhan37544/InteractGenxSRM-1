
import { chromium, Browser, BrowserContext, Page } from 'playwright';

class BrowserManager {
    private static instance: BrowserManager;
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private isInitialized = false;

    private constructor() { }

    public static getInstance(): BrowserManager {
        if (!BrowserManager.instance) {
            BrowserManager.instance = new BrowserManager();
        }
        return BrowserManager.instance;
    }

    public async init(headless: boolean = true) {
        if (this.isInitialized && this.browser) return;

        this.browser = await chromium.launch({ headless });
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(30000);
        this.isInitialized = true;
        console.log("Browser initialized.");
    }

    public isActive() {
        return !!this.page && !this.page.isClosed();
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

        try {
            await this.page.click(selector, { timeout: 5000 });
            await this.page.waitForLoadState('domcontentloaded').catch(() => { }); // Catch if no nav happens
            await this.page.waitForTimeout(1000); // Wait for potential dynamic updates
        } catch (e) {
            console.error(`Failed to click ${selector}:`, e);
            throw e;
        }
    }

    public async fillElement(selector: string, value: string) {
        if (!this.page) throw new Error("Browser not initialized.");
        console.log(`Filling element: ${selector} with "${value}"`);

        try {
            await this.page.fill(selector, value, { timeout: 5000 });
            await this.page.waitForTimeout(500); // Wait for potential validation/UI updates
        } catch (e) {
            console.error(`Failed to fill ${selector}:`, e);
            throw e;
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
            const isVisible = (el: Element) => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    el.getBoundingClientRect().width > 0 &&
                    el.getBoundingClientRect().height > 0;
            };
            const getCssSelector = (el: Element) => {
                if (el.id) return `#${el.id}`;
                let path: string[] = [];
                while (el.nodeType === Node.ELEMENT_NODE) {
                    let selector = el.nodeName.toLowerCase();
                    if (el.id) {
                        selector += '#' + el.id;
                        path.unshift(selector);
                        break;
                    } else {
                        let sib: Element | null = el;
                        let nth = 1;
                        while (sib = sib.previousElementSibling) {
                            if (sib.nodeName.toLowerCase() == selector)
                                nth++;
                        }
                        if (nth != 1)
                            selector += ":nth-of-type(" + nth + ")";
                    }
                    path.unshift(selector);
                    el = el.parentNode as Element;
                }
                return path.join(" > ");
            };

            const candidates = document.querySelectorAll('a, button, input, textarea, [role="button"]');
            candidates.forEach((el) => {
                if (!isVisible(el)) return;

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

                let placeholder = el.getAttribute('placeholder') || null;
                const rect = el.getBoundingClientRect();

                results.push({
                    type,
                    content: { text: text.substring(0, 100).trim(), placeholder },
                    selectors: { css: getCssSelector(el), id: el.id || null },
                    attributes: {
                        href: el.getAttribute('href') || null,
                        src: el.getAttribute('src') || null
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
                elements: results
            };
        });
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
