
import { NextResponse } from 'next/server';
import browserManager from '@/lib/browser';
import { query } from '@/lib/db';

export async function POST(req: Request) {
    const { selector, action, value, url } = await req.json();

    if (!selector || !action) {
        return NextResponse.json({ error: "Selector and action are required" }, { status: 400 });
    }

    // Session Recovery: If browser is lost/closed, try to restart if we have the URL
    if (!browserManager.isActive() && url) {
        console.log("Session lost. Attempting to recover...");
        await browserManager.init(false); // Make sure to match headless setting if possible, default false
        await browserManager.navigate(url);
    }

    // Double check active
    if (!browserManager.isActive()) {
        return NextResponse.json({ error: "Browser session not active. Please refresh the page." }, { status: 500 });
    }

    try {
        if (action === 'click') {
            await browserManager.clickElement(selector);
        } else if (action === 'fill') {
            await browserManager.fillElement(selector, value || '');
        } else {
            return NextResponse.json({ error: "Invalid action" }, { status: 400 });
        }

        // Re-extract after interaction
        const { elements, url: currentUrl, title: currentTitle } = await browserManager.getPageContent();

        // Update DB
        const pageUrl = currentUrl || url;
        const pageTitle = currentTitle || "Untitled";

        // Update DB with new state
        await query(`
            INSERT INTO scraped_pages(url, title) VALUES(?, ?)
            ON DUPLICATE KEY UPDATE title = VALUES(title), last_scraped_at = CURRENT_TIMESTAMP
        `, [pageUrl, pageTitle]);

        await query('DELETE FROM elements WHERE page_url = ?', [pageUrl]);

        if (elements.length > 0) {
            for (const el of elements) {
                await query(`
                    INSERT INTO elements(page_url, type, content, selectors, attributes, geometry, llm_context)
                    VALUES(?, ?, ?, ?, ?, ?, ?)
                `, [
                    pageUrl,
                    el.type,
                    JSON.stringify(el.content),
                    JSON.stringify(el.selectors),
                    JSON.stringify(el.attributes),
                    JSON.stringify(el.geometry),
                    null // Reset LLM context on new interaction/scrape
                ]);
            }
        }

        // Return the clean elements array, not "data.elements"
        return NextResponse.json({
            meta: { source_url: pageUrl, action, timestamp: new Date().toISOString() },
            elements: elements
        });

    } catch (error: any) {
        console.error("Interaction error:", error);
        return NextResponse.json({ error: error.message || "Failed to interact" }, { status: 500 });
    }
}
