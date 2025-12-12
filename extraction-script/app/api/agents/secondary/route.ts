// API Route for Secondary Agent
// Executes instructions and returns results

import { NextResponse } from 'next/server';
import { SecondaryAgent } from '@/secondary_agent/agent';
import { AgentInstruction } from '@/shared/types';

export async function POST(req: Request) {
    try {
        const { instructions, config } = await req.json();

        if (!instructions || !Array.isArray(instructions)) {
            return NextResponse.json(
                { error: 'instructions is required and must be an array' },
                { status: 400 }
            );
        }

        const agent = new SecondaryAgent(config);
        const result = await agent.executeInstructions(instructions as AgentInstruction[]);

        return NextResponse.json({
            success: true,
            data: result
        });

    } catch (error: any) {
        console.error('Secondary agent API error:', error);
        return NextResponse.json(
            { 
                success: false,
                error: error.message || 'Failed to execute instructions' 
            },
            { status: 500 }
        );
    }
}

