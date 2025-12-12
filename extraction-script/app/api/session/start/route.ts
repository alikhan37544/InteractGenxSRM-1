
import { NextResponse } from 'next/server';
import browserManager from '@/lib/browser';
import { query } from '@/lib/db';

export async function POST(req: Request) {
    try {
        const { url, headless, forceRefresh } = await req.json();

        if (!url) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        // 1. Check Cache (Database)
        if (!forceRefresh) {
            const cachedPages: any = await query('SELECT * FROM scraped_pages WHERE url = ?', [url]);
            if (cachedPages.length > 0) {
                console.log(`Cache hit for ${url}`);
                const elements = await query('SELECT * FROM elements WHERE page_url = ?', [url]);

                // Need to parse JSON fields back
                const parsedElements = (elements as any[]).map(el => ({
                    ...el,
                    content: typeof el.content === 'string' ? JSON.parse(el.content) : el.content,
                    selectors: typeof el.selectors === 'string' ? JSON.parse(el.selectors) : el.selectors,
                    attributes: typeof el.attributes === 'string' ? JSON.parse(el.attributes) : el.attributes,
                    geometry: typeof el.geometry === 'string' ? JSON.parse(el.geometry) : el.geometry,
                }));

                // Initialize browser in background if needed for interactions, but don't wait?
                // User wants persistent browser. We should ensure it's at the URL.
                // But if it's cached, maybe we don't *need* to load it yet until they click?
                // Actually, for "interactive mode", we probably should have it ready.
                // Let's lazily init without blocking response too much or just init it.
                await browserManager.init(headless !== undefined ? headless : false);
                // We might not navigate yet if we trust cache, but to be safe for interaction:
                // browserManager.navigate(url); // Fire and forget? Or wait? 
                // Let's async navigate so UI loads fast.
                browserManager.navigate(url).catch(e => console.error("Bg nav error", e));

                return NextResponse.json({
                    meta: { source_url: url, cached: true, timestamp: cachedPages[0].last_scraped_at },
                    elements: parsedElements
                });
            }
        }

        console.log(`Cache miss or force refresh for ${url}`);

        // 2. Browser Navigation & Extraction
        await browserManager.init(headless !== undefined ? headless : false);
        await browserManager.navigate(url);
        const data = await browserManager.getPageContent();

        // 3. Save to Database
        // Upsert Page
        await query(`
        INSERT INTO scraped_pages (url, title) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE title = VALUES(title), last_scraped_at = CURRENT_TIMESTAMP
    `, [data.url, data.title]);

        // Clear old elements for this URL to avoid duplicates/stale data
        await query('DELETE FROM elements WHERE page_url = ?', [data.url]);

        // Batch Insert Elements
        // Construct massive INSERT statement or look
        if (data.elements.length > 0) {
            // Prepare values for bulk insert
            const values = data.elements.map((el: any) => [
                data.url,
                el.type,
                JSON.stringify(el.content),
                JSON.stringify(el.selectors),
                JSON.stringify(el.attributes),
                JSON.stringify(el.geometry)
            ]);

            // Simple loop for now to be safe with escaping, optimized later if needed
            for (const val of values) {
                await query(`
                INSERT INTO elements (page_url, type, content, selectors, attributes, geometry)
                VALUES (?, ?, ?, ?, ?, ?)
            `, val);
            }
        }

        return NextResponse.json({
            meta: { source_url: data.url, cached: false, timestamp: new Date().toISOString() },
            elements: data.elements
        });

    } catch (error: any) {
        console.error("Session start error:", error);
        return NextResponse.json({ error: error.message || "Failed to start session" }, { status: 500 });
    }
}
