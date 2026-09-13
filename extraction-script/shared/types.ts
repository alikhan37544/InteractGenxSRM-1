// Shared types for agent communication

export interface AgentInstruction {
    id: string;
    action: 'navigate' | 'click' | 'fill' | 'extract' | 'wait' | 'scroll';
    target?: string; // selector or URL
    value?: string; // for fill actions
    reasoning?: string; // why this action is being taken
    priority?: 'high' | 'medium' | 'low';
    metadata?: Record<string, any>;
}

export interface RecentPage {
    url: string;
    title: string;
    lastScrapedAt?: string;
}

export interface AgentContext {
    currentUrl: string;
    currentPageTitle: string;
    availableElements: PageElement[];
    dbSchema: DBSchemaInfo;
    sessionContext?: Record<string, any>;
    /** Pages the agent has visited before (most recent first). */
    recentPages?: RecentPage[];
}

export interface PageElement {
    type: 'BUTTON' | 'LINK' | 'INPUT' | 'TEXT';
    content: {
        text: string;
        placeholder?: string | null;
    };
    selectors: {
        css: string;
        id: string | null;
    };
    attributes?: {
        href?: string | null;
        name?: string | null;
        src?: string | null;
        ariaLabel?: string | null;
        title?: string | null;
        className?: string | null;
    };
    geometry?: {
        x: number;
        y: number;
    };
}

export interface DBSchemaInfo {
    tables: {
        scraped_pages: {
            columns: string[];
            sampleData?: any;
        };
        elements: {
            columns: string[];
            sampleData?: any;
        };
        context: {
            columns: string[];
            sampleData?: any;
        };
    };
    currentPageData?: {
        url: string;
        title: string;
        elementCount: number;
    };
}

export interface UserIntent {
    rawInput: string;
    intent: string; // e.g., "fill_form", "navigate_to_page", "click_button"
    confidence: number; // 0-1
    entities: IntentEntity[];
    context: string;
}

export interface IntentEntity {
    type: string; // e.g., "url", "button_text", "input_value", "form_field"
    value: string;
    confidence: number;
}

export interface AgentResponse {
    success: boolean;
    message: string;
    data?: any;
    nextActions?: AgentInstruction[];
    error?: string;
}

