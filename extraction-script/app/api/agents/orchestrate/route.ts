// API Route for Agent Orchestration
// Combines primary and secondary agents for end-to-end execution

import { NextResponse } from 'next/server';
import { PrimaryAgent } from '@/primary_agent/agent';
import { SecondaryAgent } from '@/secondary_agent/agent';

export async function POST(req: Request) {
    try {
        const { userInput, primaryConfig, secondaryConfig } = await req.json();

        if (!userInput || typeof userInput !== 'string') {
            return NextResponse.json(
                { error: 'userInput is required and must be a string' },
                { status: 400 }
            );
        }

        // Step 1: Primary Agent - Process user input
        const primaryAgent = new PrimaryAgent(primaryConfig);
        
        // Get current context first
        const secondaryAgent = new SecondaryAgent(secondaryConfig);
        const currentContext = await secondaryAgent.getContext();
        
        const primaryResult = await primaryAgent.processUserInput(userInput, {
            url: currentContext.currentUrl,
            pageTitle: currentContext.currentPageTitle
        });

        // If clarification is needed, return early
        if (primaryResult.requiresUserClarification) {
            return NextResponse.json({
                success: false,
                requiresClarification: true,
                data: {
                    recognizedIntent: primaryResult.recognizedIntent,
                    clarificationQuestions: primaryResult.clarificationQuestions,
                    message: 'User input requires clarification'
                }
            });
        }

        // Step 2: Secondary Agent - Execute instructions
        if (primaryResult.generatedInstructions.length === 0) {
            return NextResponse.json({
                success: false,
                data: {
                    recognizedIntent: primaryResult.recognizedIntent,
                    message: 'No instructions were generated',
                    executionResults: []
                }
            });
        }

        const secondaryResult = await secondaryAgent.executeInstructions(
            primaryResult.generatedInstructions
        );

        // Step 3: Combine results
        return NextResponse.json({
            success: secondaryResult.success,
            data: {
                recognizedIntent: primaryResult.recognizedIntent,
                instructions: primaryResult.generatedInstructions,
                executionResults: secondaryResult.executionResults,
                finalContext: secondaryResult.finalContext,
                message: secondaryResult.message,
                errors: secondaryResult.errors
            }
        });

    } catch (error: any) {
        console.error('Agent orchestration error:', error);
        return NextResponse.json(
            { 
                success: false,
                error: error.message || 'Failed to orchestrate agents' 
            },
            { status: 500 }
        );
    }
}

