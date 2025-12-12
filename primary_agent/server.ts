// Primary Agent Server
// Runs on port 3001

import express from 'express';
import cors from 'cors';
import { PrimaryAgent } from './agent';
import type { PrimaryAgentConfig } from './types';
import type { AgentInstruction } from '../shared/types';

const app = express();
const PORT = process.env.PORT || 3001;
const SECONDARY_AGENT_URL = process.env.SECONDARY_AGENT_URL || 'http://localhost:3002';

app.use(cors());
app.use(express.json());

const agent = new PrimaryAgent();

/**
 * Call secondary agent to execute instructions
 */
async function executeInstructions(instructions: AgentInstruction[], secondaryConfig?: any) {
    try {
        const response = await fetch(`${SECONDARY_AGENT_URL}/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                instructions,
                config: secondaryConfig
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error: any) {
        console.error('Error calling secondary agent:', error);
        throw new Error(`Failed to execute instructions: ${error.message}`);
    }
}

/**
 * Get current context from secondary agent
 */
async function getSecondaryContext() {
    try {
        const response = await fetch(`${SECONDARY_AGENT_URL}/context`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            // If context fails, return undefined (agent will work without it)
            return undefined;
        }

        const result = await response.json();
        return result.success ? result.data : undefined;
    } catch (error) {
        // If secondary agent is not available, continue without context
        console.warn('Secondary agent context not available:', error);
        return undefined;
    }
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', agent: 'primary', port: PORT });
});

// Process user input and generate instructions
app.post('/process', async (req, res) => {
    try {
        const { 
            userInput, 
            currentContext, 
            config, 
            autoExecute = false,  // Default: just generate instructions
            secondaryConfig  // Config for secondary agent if autoExecute is true
        } = req.body;

        if (!userInput || typeof userInput !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'userInput is required and must be a string'
            });
        }

        // Update agent config if provided
        if (config) {
            Object.assign(agent, new PrimaryAgent(config));
        }

        // Get current context from secondary agent if not provided
        let context = currentContext;
        if (!context && autoExecute) {
            const secondaryContext = await getSecondaryContext();
            if (secondaryContext) {
                context = {
                    url: secondaryContext.currentUrl,
                    pageTitle: secondaryContext.currentPageTitle
                };
            }
        }

        // Step 1: Process user input and generate instructions
        const result = await agent.processUserInput(userInput, context);

        // If clarification is needed, return early
        if (result.requiresUserClarification) {
            return res.json({
                success: false,
                requiresClarification: true,
                data: {
                    recognizedIntent: result.recognizedIntent,
                    clarificationQuestions: result.clarificationQuestions,
                    message: 'User input requires clarification'
                }
            });
        }

        // Step 2: If autoExecute is enabled, execute instructions via secondary agent
        let executionResult = null;
        if (autoExecute && result.generatedInstructions.length > 0) {
            try {
                executionResult = await executeInstructions(result.generatedInstructions, secondaryConfig);
            } catch (error: any) {
                // If execution fails, still return the instructions
                console.error('Auto-execution failed:', error);
                executionResult = {
                    success: false,
                    error: error.message,
                    message: 'Instructions generated but execution failed'
                };
            }
        }

        res.json({
            success: true,
            data: {
                ...result,
                executionResult: executionResult ? executionResult.data || executionResult : undefined,
                executed: autoExecute && result.generatedInstructions.length > 0
            }
        });

    } catch (error: any) {
        console.error('Primary agent error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to process user input'
        });
    }
});

// Clear conversation history
app.post('/clear-history', (req, res) => {
    try {
        agent.clearHistory();
        res.json({
            success: true,
            message: 'Conversation history cleared'
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to clear history'
        });
    }
});

// Get conversation history
app.get('/history', (req, res) => {
    try {
        const history = agent.getHistory();
        res.json({
            success: true,
            data: history
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get history'
        });
    }
});

app.listen(PORT, () => {
    console.log(`🤖 Primary Agent server running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Process: POST http://localhost:${PORT}/process`);
    console.log(`   Secondary Agent URL: ${SECONDARY_AGENT_URL}`);
    console.log(`   Auto-execution: Enable with "autoExecute: true" in request body`);
});

