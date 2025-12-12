
import { NextResponse } from 'next/server';
import { chromium } from 'playwright';

// Type definitions to match frontend
interface ExtractedElement {
    type: 'BUTTON' | 'LINK' | 'INPUT' | 'TEXT';
    content: { text: string; placeholder: string | null };
    selectors: { css: string; xpath: string; id: string | null };
    attributes: { href: string | null; src: string | null; name: string | null };
    geometry: { x: number; y: number };
}

export async function POST(req: Request) {
    let browser = null;
    try {
        const { url, headless } = await req.json();

        if (!url) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        browser = await chromium.launch({
            headless: headless !== undefined ? headless : true
        });

        const page = await browser.newPage();

        // Set a reasonable timeout
        page.setDefaultTimeout(30000);

        // Navigate to URL
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Allow some time for dynamic content to settle (simulating 'wait for DOM to settle')
        // In a real robust script we'd wait for network idle or specific selectors.
        await page.waitForTimeout(2000);

        // Extraction Logic
        const elements = await page.evaluate(() => {
            const results: any[] = [];

            // Helper to check visibility
            const isVisible = (el: Element) => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    el.getBoundingClientRect().width > 0 &&
                    el.getBoundingClientRect().height > 0;
            };

            // Helper to generate CSS selector
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

            // Helper to generate XPath
            const getXPath = (el: Element) => {
                if (el.id) return `//*[@id="${el.id}"]`;
                const paths: string[] = [];
                for (; el && el.nodeType == 1; el = el.parentNode as Element) {
                    let index = 0;
                    for (let sibling = el.previousSibling; sibling; sibling = sibling.previousSibling) {
                        if (sibling.nodeType == Node.ELEMENT_NODE && sibling.nodeName == el.nodeName)
                            index++;
                    }
                    const tagName = el.nodeName.toLowerCase();
                    const pathIndex = (index ? "[" + (index + 1) + "]" : "");
                    paths.splice(0, 0, tagName + pathIndex);
                }
                return paths.length ? "/" + paths.join("/") : null;
            };

            // Candidate Selection
            const candidates = document.querySelectorAll('a, button, input, textarea, [role="button"]');

            candidates.forEach((el) => {
                if (!isVisible(el)) return;

                let type = 'TEXT';
                const tagName = el.tagName.toLowerCase();
                const role = el.getAttribute('role');

                if (tagName === 'a') type = 'LINK';
                else if (tagName === 'button' || role === 'button') type = 'BUTTON';
                else if (tagName === 'input' || tagName === 'textarea') type = 'INPUT';

                // Refine text content
                let text = (el as HTMLElement).innerText || el.getAttribute('value') || '';
                // For inputs, check placeholder or label? 
                let placeholder = el.getAttribute('placeholder') || null;

                // Geometry
                const rect = el.getBoundingClientRect();

                results.push({
                    type,
                    content: {
                        text: text.substring(0, 100).trim(), // Truncate long text
                        placeholder
                    },
                    selectors: {
                        css: getCssSelector(el),
                        xpath: getXPath(el),
                        id: el.id || null
                    },
                    attributes: {
                        href: el.getAttribute('href') || null,
                        src: el.getAttribute('src') || null,
                        name: el.getAttribute('name') || null
                    },
                    geometry: {
                        x: Math.round(rect.x + window.scrollX),
                        y: Math.round(rect.y + window.scrollY)
                    }
                });
            });

            return results;
        });

        await browser.close();

        return NextResponse.json({
            meta: { source_url: url, timestamp: new Date().toISOString() },
            elements
        });

    } catch (error: any) {
        console.error("Extraction error:", error);
        if (browser) await browser.close();
        return NextResponse.json({ error: error.message || "Failed to extract" }, { status: 500 });
    }
}
