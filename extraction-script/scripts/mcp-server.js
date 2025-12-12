
const { McpServer, ResourceTemplate } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

// Configuration
const API_BASE = "http://localhost:3000/api";

// Helper to call API
async function callApi(endpoint, method, body) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`API Error ${response.status}: ${text}`);
        }
        return await response.json();
    } catch (err) {
        return { error: err.message };
    }
}

// Create MCP Server
const server = new McpServer({
    name: "InteractGen",
    version: "1.0.0",
});

// Tool: Browse Page
server.tool(
    "browse_page",
    "Navigate to a URL and extract interactive elements",
    {
        url: z.string().url().describe("The URL to visit"),
        headless: z.boolean().optional().default(true).describe("Run in headless mode"),
    },
    async ({ url, headless }) => {
        const data = await callApi("/session/start", "POST", { url, headless });
        if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }] };

        return {
            content: [{
                type: "text",
                text: `Navigated to ${data.meta?.title}\nFound ${data.elements?.length} elements.\n\nElements Sample:\n${JSON.stringify(data.elements?.slice(0, 5), null, 2)}`
            }]
        };
    }
);

// Tool: Interact
server.tool(
    "interact_element",
    "Click or fill an element on the current page",
    {
        selector: z.string().describe("CSS Selector of the element"),
        action: z.enum(["click", "fill"]).describe("Action to perform"),
        value: z.string().optional().describe("Value to fill (if action is fill)"),
        url: z.string().url().describe("Current URL (required for session recovery)"),
    },
    async ({ selector, action, value, url }) => {
        const data = await callApi("/session/interact", "POST", { selector, action, value, url });
        if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }] };

        return {
            content: [{
                type: "text",
                text: `Action '${action}' successful on '${selector}'.\nNew State: Found ${data.elements?.length} elements.`
            }]
        };
    }
);

// Tool: Enrich
server.tool(
    "enrich_context",
    "Analyze the current page elements with AI context",
    {
        url: z.string().url().describe("The URL of the page (must match current session)"),
    },
    async ({ url }) => {
        const data = await callApi("/ai/enrich", "POST", { url });
        if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }] };

        // Simply return success message or the mapped data
        // The API returns the list of enriched elements
        const enrichedCount = data.filter(e => e.llm_context).length;

        return {
            content: [{
                type: "text",
                text: `Enrichment Complete. ${enrichedCount} elements now have AI context.`
            }]
        };
    }
);

// Start Server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("InteractGen MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
