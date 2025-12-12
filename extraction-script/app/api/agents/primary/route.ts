// API Route for Primary Agent
// Handles user input and generates instructions

import { NextResponse } from 'next/server';
import { PrimaryAgent } from '@/primary_agent/agent';

export async function POST(req: Request) {
    try {
        const { userInput, currentContext, config } = await req.json();

        if (!userInput || typeof userInput !== 'string') {
            return NextResponse.json(
                { error: 'userInput is required and must be a string' },
                { status: 400 }
            );
        }

        const agent = new PrimaryAgent(config);
        const result = await agent.processUserInput(userInput, currentContext);

        return NextResponse.json({
            success: true,
            data: result
        });

    } catch (error: any) {
        console.error('Primary agent API error:', error);
        return NextResponse.json(
            { 
                success: false,
                error: error.message || 'Failed to process user input' 
            },
            { status: 500 }
        );
    }
}

