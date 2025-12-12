// Secondary Agent Server
// Runs on port 3002

import express from 'express';
import cors from 'cors';
import { SecondaryAgent } from './agent';
import type { SecondaryAgentConfig } from './types';
import type { AgentInstruction } from '../shared/types';

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

const agent = new SecondaryAgent();

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', agent: 'secondary', port: PORT });
});

// Get current context
app.get('/context', async (req, res) => {
    try {
        const context = await agent.getContext();
        res.json({
            success: true,
            data: context
        });
    } catch (error: any) {
        console.error('Error getting context:', error);
        // Return empty context instead of error if browser is not initialized
        if (error.message && error.message.includes('Browser not initialized')) {
            res.json({
                success: true,
                data: {
                    currentUrl: '',
                    currentPageTitle: '',
                    availableElements: [],
                    dbSchema: {
                        tables: {
                            scraped_pages: { columns: [] },
                            elements: { columns: [] },
                            context: { columns: [] }
                        }
                    },
                    sessionContext: {}
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get context'
            });
        }
    }
});

// Execute instructions
app.post('/execute', async (req, res) => {
    try {
        const { instructions, config } = req.body;

        if (!instructions || !Array.isArray(instructions)) {
            return res.status(400).json({
                success: false,
                error: 'instructions is required and must be an array'
            });
        }

        // Update agent config if provided
        if (config) {
            Object.assign(agent, new SecondaryAgent(config));
        }

        const result = await agent.executeInstructions(instructions as AgentInstruction[]);

        res.json({
            success: result.success,
            data: result
        });

    } catch (error: any) {
        console.error('Secondary agent error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to execute instructions'
        });
    }
});

app.listen(PORT, () => {
    console.log(`🤖 Secondary Agent server running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Context: GET http://localhost:${PORT}/context`);
    console.log(`   Execute: POST http://localhost:${PORT}/execute`);
});

