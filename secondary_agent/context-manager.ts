// Secondary Agent: Context Manager
// Understands database structure, current page context, and available elements

import { AgentContext, DBSchemaInfo, PageElement, RecentPage } from '../shared/types';
import { ContextAnalysis } from './types';

// Dynamic imports for extraction-script modules
let query: any;
let browserManager: any;

// Initialize extraction-script dependencies
async function initExtractionScript() {
    if (!query) {
        const dbModule = await import('../extraction-script/lib/db');
        query = dbModule.query;
    }
    if (!browserManager) {
        const browserModule = await import('../extraction-script/lib/browser');
        browserManager = browserModule.default;
    }
}

export class ContextManager {
    private initialized = false;

    private async ensureInitialized() {
        if (!this.initialized) {
            await initExtractionScript();
            this.initialized = true;
        }
    }

    /**
     * Get current page context from browser and database
     */
    async getCurrentContext(): Promise<AgentContext> {
        await this.ensureInitialized();

        try {
            // Initialize browser if not already initialized
            // The browser manager's init method checks if already initialized
            if (browserManager && typeof browserManager.init === 'function') {
                try {
                    await browserManager.init(false); // Use non-headless mode (false = visible browser)
                } catch (error) {
                    // Browser might already be initialized or init failed
                    console.warn('Browser initialization attempt:', error);
                }
            }

            // Get current page state from browser
            const pageContent = await browserManager.getPageContent();
            
            // Get database schema info
            const dbSchema = await this.getDBSchemaInfo();

            // Get elements for current page from database
            const dbElements = await this.getPageElementsFromDB(pageContent.url);

            // Merge browser elements with DB elements (prefer browser if available)
            const availableElements = pageContent.elements.length > 0 
                ? pageContent.elements 
                : dbElements;

            const recentPages = await this.getRecentPages();

            return {
                currentUrl: pageContent.url,
                currentPageTitle: pageContent.title,
                availableElements,
                dbSchema,
                sessionContext: {},
                recentPages
            };

        } catch (error) {
            console.error('Error getting context:', error);
            throw error;
        }
    }

    /**
     * Analyze context for a specific instruction
     */
    async analyzeContextForInstruction(
        instruction: { action: string; target?: string; value?: string }
    ): Promise<ContextAnalysis> {
        const context = await this.getCurrentContext();

        // Find relevant elements based on instruction target
        let relevantElements: PageElement[] = [];
        
        if (instruction.target) {
            // Try to match elements by various criteria
            relevantElements = context.availableElements.filter(el => {
                const targetLower = instruction.target!.toLowerCase();
                const textLower = el.content.text.toLowerCase();
                const selectorLower = el.selectors.css.toLowerCase();
                const idLower = el.selectors.id?.toLowerCase() || '';

                return (
                    textLower.includes(targetLower) ||
                    selectorLower.includes(targetLower) ||
                    idLower.includes(targetLower) ||
                    el.selectors.css === instruction.target ||
                    el.selectors.id === instruction.target
                );
            });
        }

        // Get element count from DB
        await this.ensureInitialized();
        const dbElementCount = await query(
            'SELECT COUNT(*) as count FROM elements WHERE page_url = ?',
            [context.currentUrl]
        ) as Array<{ count: number }>;

        return {
            currentUrl: context.currentUrl,
            currentPageTitle: context.currentPageTitle,
            availableElements: context.availableElements,
            relevantElements,
            dbElementCount: dbElementCount[0]?.count || 0,
            hasContext: context.availableElements.length > 0
        };
    }

    /**
     * Get the most recently visited/scraped pages (newest first).
     */
    private async getRecentPages(): Promise<RecentPage[]> {
        await this.ensureInitialized();
        try {
            const rows = await query(
                'SELECT url, title, last_scraped_at FROM scraped_pages ORDER BY last_scraped_at DESC LIMIT 5'
            ) as Array<{ url: string; title: string | null; last_scraped_at: any }>;
            return rows.map(row => ({
                url: row.url,
                title: row.title || '',
                lastScrapedAt: row.last_scraped_at ? String(row.last_scraped_at) : undefined
            }));
        } catch (error) {
            console.error('Error getting recent pages:', error);
            return [];
        }
    }

    /**
     * Get database schema information
     */
    private async getDBSchemaInfo(): Promise<DBSchemaInfo> {
        await this.ensureInitialized();

        try {
            // Get table structures
            const tables = {
                scraped_pages: {
                    columns: ['url', 'full_url', 'title', 'last_scraped_at'],
                    sampleData: await query('SELECT * FROM scraped_pages LIMIT 1')
                },
                elements: {
                    columns: ['id', 'page_url', 'type', 'content', 'selectors', 'attributes', 'geometry'],
                    sampleData: await query('SELECT * FROM elements LIMIT 1')
                },
                context: {
                    columns: ['id', 'name', 'data', 'created_at'],
                    sampleData: await query('SELECT * FROM context LIMIT 1')
                }
            };

            // Get current page data if available
            const currentPageData = await query(
                'SELECT url, title, (SELECT COUNT(*) FROM elements WHERE elements.page_url = scraped_pages.url) as element_count FROM scraped_pages ORDER BY last_scraped_at DESC LIMIT 1'
            ) as Array<{ url: string; title: string; element_count: number }>;

            return {
                tables,
                currentPageData: currentPageData[0] ? {
                    url: currentPageData[0].url,
                    title: currentPageData[0].title,
                    elementCount: currentPageData[0].element_count || 0
                } : undefined
            };

        } catch (error) {
            console.error('Error getting DB schema:', error);
            return {
                tables: {
                    scraped_pages: { columns: [] },
                    elements: { columns: [] },
                    context: { columns: [] }
                }
            };
        }
    }

    /**
     * Get elements for a specific page from database
     */
    private async getPageElementsFromDB(url: string): Promise<PageElement[]> {
        await this.ensureInitialized();

        try {
            const results = await query(
                'SELECT type, content, selectors, attributes, geometry FROM elements WHERE page_url = ?',
                [url]
            ) as Array<{
                type: string;
                content: string;
                selectors: string;
                attributes: string;
                geometry: string;
            }>;

            return results.map(row => ({
                type: row.type as PageElement['type'],
                content: JSON.parse(row.content),
                selectors: JSON.parse(row.selectors),
                attributes: JSON.parse(row.attributes),
                geometry: JSON.parse(row.geometry)
            }));

        } catch (error) {
            console.error('Error getting page elements from DB:', error);
            return [];
        }
    }

    /**
     * Update context in database
     */
    async updateContext(name: string, data: any): Promise<void> {
        await this.ensureInitialized();

        try {
            await query(
                'INSERT INTO context (name, data) VALUES (?, ?)',
                [name, JSON.stringify(data)]
            );
        } catch (error) {
            console.error('Error updating context:', error);
            throw error;
        }
    }
}
