// Secondary Agent: Context Manager
// Understands database structure, current page context, and available elements

// Note: When used in extraction-script, these imports resolve via @/ aliases
// Root-level agents use relative paths that need to be adjusted when copied to extraction-script
import { query } from '@/lib/db';
import { AgentContext, DBSchemaInfo, PageElement } from '@/shared/types';
import { ContextAnalysis } from './types';
import browserManager from '@/lib/browser';

export class ContextManager {
    /**
     * Get current page context from browser and database
     */
    async getCurrentContext(): Promise<AgentContext> {
        try {
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

            return {
                currentUrl: pageContent.url,
                currentPageTitle: pageContent.title,
                availableElements,
                dbSchema,
                sessionContext: {}
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
     * Get database schema information
     */
    private async getDBSchemaInfo(): Promise<DBSchemaInfo> {
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

