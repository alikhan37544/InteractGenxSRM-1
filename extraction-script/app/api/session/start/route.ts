
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
            const cachedPages: any = await query(`
                SELECT *, 
                    (SELECT COUNT(*) FROM elements WHERE page_url = scraped_pages.url AND llm_context IS NOT NULL AND llm_context != '') as enriched_elements
                FROM scraped_pages WHERE url = ?
            `, [url]);
            
            if (cachedPages.length > 0) {
                console.log(`Cache hit for ${url}`);
                const cachedPage = cachedPages[0];
                const elements = await query('SELECT * FROM elements WHERE page_url = ?', [url]);

                // Need to parse JSON fields back
                const parsedElements = (elements as any[]).map(el => ({
                    ...el,
                    content: typeof el.content === 'string' ? JSON.parse(el.content) : el.content,
                    selectors: typeof el.selectors === 'string' ? JSON.parse(el.selectors) : el.selectors,
                    attributes: typeof el.attributes === 'string' ? JSON.parse(el.attributes) : el.attributes,
                    geometry: typeof el.geometry === 'string' ? JSON.parse(el.geometry) : el.geometry,
                }));

                // Calculate enrichment status
                const totalElements = parsedElements.length;
                const enrichedCount = parseInt(cachedPage.enriched_elements) || 0;
                let enrichmentStatus = 'none';
                if (enrichedCount > 0) {
                    enrichmentStatus = enrichedCount >= totalElements ? 'full' : 'partial';
                }

                // Initialize browser in background if needed for interactions
                await browserManager.init(headless !== undefined ? headless : false);
                browserManager.navigate(url).catch(e => console.error("Bg nav error", e));

                return NextResponse.json({
                    meta: { 
                        source_url: url, 
                        cached: true, 
                        timestamp: cachedPage.last_scraped_at,
                        title: cachedPage.title,
                        aiEnrichmentStatus: enrichmentStatus,
                        enrichedCount,
                        totalElements,
                        firstScrapedAt: cachedPage.first_scraped_at,
                        scrapeCount: cachedPage.scrape_count
                    },
                    elements: parsedElements
                });
            }
        }

        console.log(`Cache miss or force refresh for ${url}`);

        // 2. Browser Navigation & Extraction
        await browserManager.init(headless !== undefined ? headless : false);
        await browserManager.navigate(url);
        const data = await browserManager.getPageContent();

        // 3. Check if page existed before (for scrape_count)
        const existingPage: any = await query('SELECT scrape_count FROM scraped_pages WHERE url = ?', [data.url]);
        const newScrapeCount = existingPage.length > 0 ? (existingPage[0].scrape_count + 1) : 1;

        // 4. Save to Database with enhanced tracking
        // Upsert Page with element count
        await query(`
            INSERT INTO scraped_pages (url, title, element_count, scrape_count, ai_enrichment_status) 
            VALUES (?, ?, ?, ?, 'none')
            ON DUPLICATE KEY UPDATE 
                title = VALUES(title), 
                last_scraped_at = CURRENT_TIMESTAMP,
                element_count = VALUES(element_count),
                scrape_count = VALUES(scrape_count)
        `, [data.url, data.title, data.elements.length, newScrapeCount]);

        // Log to history
        await query(`
            INSERT INTO scraping_history (page_url, action, element_count, notes)
            VALUES (?, 'scrape', ?, ?)
        `, [data.url, data.elements.length, forceRefresh ? 'Force refresh' : 'Initial scrape']);

        // Clear old elements for this URL to avoid duplicates/stale data
        await query('DELETE FROM elements WHERE page_url = ?', [data.url]);

        // Batch Insert Elements
        if (data.elements.length > 0) {
            for (const el of data.elements) {
                await query(`
                    INSERT INTO elements (page_url, type, content, selectors, attributes, geometry)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    data.url,
                    el.type,
                    JSON.stringify(el.content),
                    JSON.stringify(el.selectors),
                    JSON.stringify(el.attributes),
                    JSON.stringify(el.geometry)
                ]);
            }
        }

        return NextResponse.json({
            meta: { 
                source_url: data.url, 
                cached: false, 
                timestamp: new Date().toISOString(),
                title: data.title,
                aiEnrichmentStatus: 'none',
                enrichedCount: 0,
                totalElements: data.elements.length,
                firstScrapedAt: new Date().toISOString(),
                scrapeCount: newScrapeCount
            },
            elements: data.elements
        });

    } catch (error: any) {
        console.error("Session start error:", error);
        return NextResponse.json({ error: error.message || "Failed to start session" }, { status: 500 });
    }
}
