import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const url = searchParams.get('url');

        if (!url) {
            return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
        }

        const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;

        const pageResult = await query(`
            SELECT 
                sp.*,
                (SELECT COUNT(*) FROM elements e WHERE e.page_url = sp.url) as current_element_count,
                (SELECT COUNT(*) FROM elements e WHERE e.page_url = sp.url AND e.llm_context IS NOT NULL AND e.llm_context != '') as current_enriched_count
            FROM scraped_pages sp 
            WHERE sp.url = ? OR sp.url = ?
            LIMIT 1
        `, [normalizedUrl, normalizedUrl + '/']) as Array<Record<string, unknown>>;

        if (pageResult.length === 0) {
            return NextResponse.json({
                success: true,
                data: {
                    exists: false,
                    url: normalizedUrl
                }
            });
        }

        const page = pageResult[0];
        const totalElements = (page.current_element_count as number) || (page.element_count as number) || 0;
        const enrichedElements = (page.current_enriched_count as number) || (page.enriched_element_count as number) || 0;

        let enrichmentStatus = (page.ai_enrichment_status as string) || 'none';
        if (enrichmentStatus === 'none' && enrichedElements > 0) {
            enrichmentStatus = enrichedElements >= totalElements ? 'full' : 'partial';
        }

        return NextResponse.json({
            success: true,
            data: {
                exists: true,
                url: page.url,
                title: page.title || 'Untitled',
                lastScrapedAt: page.last_scraped_at,
                firstScrapedAt: page.first_scraped_at,
                aiEnrichmentStatus: enrichmentStatus,
                enrichedAt: page.enriched_at,
                elementCount: totalElements,
                enrichedElementCount: enrichedElements,
                scrapeCount: (page.scrape_count as number) || 1
            }
        });

    } catch (error) {
        console.error("URL check error:", error);
        return NextResponse.json({ error: "Failed to check URL" }, { status: 500 });
    }
}
