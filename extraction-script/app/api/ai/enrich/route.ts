
import { NextResponse } from 'next/server';
import browserManager from '@/lib/browser';
import { enrichElements } from '@/lib/llm';
import { query } from '@/lib/db';

export async function POST(req: Request) {
    try {
        const { url } = await req.json();

        if (!url) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        // 1. Get Elements from DB
        const results = await query('SELECT * FROM elements WHERE page_url = ?', [url]);
        const elements: any[] = Array.isArray(results) ? results : [];

        // Parse JSON fields
        const parsedElements = elements.map(el => ({
            ...el,
            content: typeof el.content === 'string' ? JSON.parse(el.content) : el.content,
            Selectors: typeof el.selectors === 'string' ? JSON.parse(el.selectors) : el.selectors,
            selectors: typeof el.selectors === 'string' ? JSON.parse(el.selectors) : el.selectors,
            attributes: typeof el.attributes === 'string' ? JSON.parse(el.attributes) : el.attributes,
            geometry: typeof el.geometry === 'string' ? JSON.parse(el.geometry) : el.geometry,
        }));

        if (parsedElements.length === 0) {
            return NextResponse.json({ error: "No elements found to enrich. Extract first." }, { status: 404 });
        }

        // 2. Get Simplified HTML
        const html = await browserManager.getSimplifiedHtml();

        // 3. Call LLM
        console.log("Sending to LLM for enrichment...");
        const enrichmentMap = await enrichElements(html, parsedElements);

        // 4. Update DB
        console.log("LLM Response Keys:", Object.keys(enrichmentMap));

        let updateCount = 0;
        for (const [key, context] of Object.entries(enrichmentMap)) {
            if (!context) continue;
            const val = context as string;

            let el = parsedElements.find(e => e.selectors.css === key || e.selectors.id === key);

            // Fallback: If key has '#' it might be an ID
            if (!el && key.startsWith('#')) {
                const cleanId = key.substring(1);
                el = parsedElements.find(e => e.selectors.id === cleanId);
            }

            // Fallback: If key is numeric (0, 1, 2...), treat as index
            if (!el && !isNaN(parseInt(key))) {
                const index = parseInt(key);
                if (index >= 0 && index < parsedElements.length) {
                    el = parsedElements[index];
                }
            }

            if (el) {
                console.log(`Updating Element ID ${el.id} with context: ${val.substring(0, 20)}...`);
                await query('UPDATE elements SET llm_context = ? WHERE id = ?', [val, el.id]);
                updateCount++;
            } else {
                console.warn(`Could not match LLM key '${key}' to any element.`);
            }
        }

        console.log(`Enriched ${updateCount} elements.`);

        // 5. Update page enrichment status
        const totalElements = parsedElements.length;
        const enrichmentStatus = updateCount >= totalElements ? 'full' : (updateCount > 0 ? 'partial' : 'none');
        
        await query(`
            UPDATE scraped_pages 
            SET ai_enrichment_status = ?, 
                enriched_at = CURRENT_TIMESTAMP,
                enriched_element_count = ?
            WHERE url = ?
        `, [enrichmentStatus, updateCount, url]);

        // 6. Log the AI analysis
        await query(`
            INSERT INTO ai_analysis_log (page_url, elements_processed, elements_enriched, model_used, success)
            VALUES (?, ?, ?, ?, ?)
        `, [url, parsedElements.length, updateCount, 'google/gemma-4-12b-qat', true]);

        // 7. Return updated elements
        const updatedElements = await query('SELECT * FROM elements WHERE page_url = ?', [url]);
        const finalElements = (updatedElements as any[]).map(el => ({
            ...el,
            content: typeof el.content === 'string' ? JSON.parse(el.content) : el.content,
            selectors: typeof el.selectors === 'string' ? JSON.parse(el.selectors) : el.selectors,
            attributes: typeof el.attributes === 'string' ? JSON.parse(el.attributes) : el.attributes,
            geometry: typeof el.geometry === 'string' ? JSON.parse(el.geometry) : el.geometry,
        }));

        return NextResponse.json({
            meta: { 
                source_url: url, 
                enriched: true,
                aiEnrichmentStatus: enrichmentStatus,
                enrichedCount: updateCount,
                totalElements
            },
            elements: finalElements
        });

    } catch (error: any) {
        console.error("Enrichment error:", error);
        
        // Log failed attempt
        try {
            const { url } = await req.json();
            if (url) {
                await query(`
                    INSERT INTO ai_analysis_log (page_url, elements_processed, elements_enriched, model_used, success, error_message)
                    VALUES (?, 0, 0, 'google/gemma-4-12b-qat', false, ?)
                `, [url, error.message || 'Unknown error']);
            }
        } catch (logError) {
            console.error("Failed to log error:", logError);
        }
        
        return NextResponse.json({ error: error.message || "Failed to enrich" }, { status: 500 });
    }
}
