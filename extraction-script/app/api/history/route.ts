import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const searchTerm = searchParams.get('search') || '';
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '20');
        const offset = (page - 1) * limit;
        const enrichmentFilter = searchParams.get('enrichment');

        let whereClause = 'WHERE 1=1';
        const params: unknown[] = [];

        if (searchTerm) {
            whereClause += ` AND (sp.url LIKE ? OR sp.title LIKE ?)`;
            params.push(`%${searchTerm}%`, `%${searchTerm}%`);
        }

        if (enrichmentFilter && ['none', 'partial', 'full'].includes(enrichmentFilter)) {
            whereClause += ` AND sp.ai_enrichment_status = ?`;
            params.push(enrichmentFilter);
        }

        const countResult = await query(
            `SELECT COUNT(*) as total FROM scraped_pages sp ${whereClause}`,
            params
        ) as Array<{ total: number }>;
        const total = countResult[0]?.total || 0;

        const historyResult = await query(
            `SELECT 
                sp.url,
                sp.title,
                sp.last_scraped_at,
                sp.first_scraped_at,
                sp.ai_enrichment_status,
                sp.enriched_at,
                sp.element_count,
                sp.enriched_element_count,
                sp.scrape_count,
                (SELECT COUNT(*) FROM elements e WHERE e.page_url = sp.url) as current_element_count,
                (SELECT COUNT(*) FROM elements e WHERE e.page_url = sp.url AND e.llm_context IS NOT NULL AND e.llm_context != '') as current_enriched_count
            FROM scraped_pages sp
            ${whereClause}
            ORDER BY sp.last_scraped_at DESC
            LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        ) as Array<Record<string, unknown>>;

        const analysisLogs = await query(`
            SELECT page_url, MAX(created_at) as last_analysis, success
            FROM ai_analysis_log
            GROUP BY page_url, success
            ORDER BY last_analysis DESC
        `) as Array<{ page_url: string; last_analysis: string; success: boolean }>;

        const analysisMap = new Map<string, { lastAnalysis: string; success: boolean }>();
        analysisLogs.forEach((log) => {
            if (!analysisMap.has(log.page_url)) {
                analysisMap.set(log.page_url, { lastAnalysis: log.last_analysis, success: log.success });
            }
        });

        const enrichedHistory = historyResult.map((item) => ({
            url: item.url,
            title: item.title || 'Untitled',
            lastScrapedAt: item.last_scraped_at,
            firstScrapedAt: item.first_scraped_at,
            aiEnrichmentStatus: item.ai_enrichment_status || 'none',
            enrichedAt: item.enriched_at,
            elementCount: (item.current_element_count as number) || (item.element_count as number) || 0,
            enrichedElementCount: (item.current_enriched_count as number) || (item.enriched_element_count as number) || 0,
            scrapeCount: (item.scrape_count as number) || 1,
            analysisInfo: analysisMap.get(item.url as string) || null
        }));

        return NextResponse.json({
            success: true,
            data: {
                history: enrichedHistory,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        console.error("History fetch error:", error);
        return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
    }
}
