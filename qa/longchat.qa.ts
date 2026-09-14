// Long continuous-chat QA suite.
//
//   npx tsx qa/longchat.qa.ts
//
// Covers multi-turn conversations and the per-chat memory model:
//   A. History mechanics (deterministic, in-process, LLM stubbed):
//      growth, trimming, isolation, config updates, clear, MAX_CHATS eviction
//   B. Live long chats against the primary agent (real LLM, pinned fast model):
//      an 11-turn research conversation, follow-up continuity, chat isolation,
//      config changes mid-chat, streaming, and clearing.
//
// Exits non-zero when any check fails.

import { PrimaryAgent } from '../primary_agent/agent';
import { AgentInstruction } from '../shared/types';

const PRIMARY = process.env.QA_PRIMARY_URL || 'http://localhost:3001';
const MODEL = process.env.QA_MODEL || 'google/gemma-3-4b';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        passed++;
        console.log(`  PASS  ${name}`);
    } else {
        failed++;
        failures.push(name + (detail ? ` — ${detail}` : ''));
        console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

function eq(name: string, actual: unknown, expected: unknown) {
    check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function actions(list: AgentInstruction[]): string[] {
    return (list || []).map(i => `${i.action}:${i.target ?? ''}`);
}

// ---------------------------------------------------------------------------
// Deterministic agent with the LLM modules stubbed out, so history mechanics
// can be exercised thousands of times without a model.
// ---------------------------------------------------------------------------

function stubAgent(): any {
    const agent: any = new PrimaryAgent({ model: 'stub', temperature: 0 });
    agent.intentRecognizer = {
        recognizeIntent: async (input: string) => ({
            intent: { rawInput: input, intent: 'stub', confidence: 1, entities: [], context: '' },
            requiresClarification: false,
            clarificationQuestions: []
        })
    };
    agent.instructionTranslator = {
        translateIntentToInstructions: async () => ({ instructions: [], confidence: 1, reasoning: 'stub' })
    };
    agent.responseSynthesizer = {
        synthesize: async () => 'stub answer'
    };
    return agent;
}

async function stubTurn(agent: any, input: string, chatId: string) {
    await agent.processUserInput(input, undefined, undefined, undefined, null, chatId);
    await agent.synthesizeResponse(input, {} as any, {}, undefined, undefined, null, chatId);
}

async function sectionA() {
    console.log('\nA. History mechanics (deterministic)');

    // A1: a brand new chat starts empty.
    {
        const agent = stubAgent();
        eq('A1 fresh chat is empty', agent.getHistory('fresh').length, 0);
    }

    // A2: one turn records the user message, an assistant summary and the answer.
    {
        const agent = stubAgent();
        await stubTurn(agent, 'hello there', 'c1');
        const h = agent.getHistory('c1');
        eq('A2 one turn stores 3 messages', h.length, 3);
        eq('A2 first message is the user input', h[0]?.role === 'user' && h[0]?.content === 'hello there', true);
        check('A2 middle message is an assistant summary', h[1]?.role === 'assistant' && /Generated/.test(h[1]?.content || ''), JSON.stringify(h[1]));
        eq('A2 last message is the synthesized answer', h[2]?.content, 'stub answer');
    }

    // A3: history is trimmed to MAX_MESSAGES (20), keeping the newest messages.
    // 11 turns = 33 messages, so the oldest 13 are dropped; trimming may split a
    // turn, so the first retained entry can be an assistant summary.
    {
        const agent = stubAgent();
        for (let i = 1; i <= 11; i++) await stubTurn(agent, `turn ${i}`, 'c2');
        const h = agent.getHistory('c2');
        const contents = h.map((m: any) => m.content);
        eq('A3 long chat is trimmed to 20 messages', h.length, 20);
        check('A3 newest turn is retained', h.some((m: any) => m.content === 'turn 11'), JSON.stringify(contents));
        eq('A3 last message is the newest answer', h[h.length - 1]?.content, 'stub answer');
        check('A3 dropped turns are gone', !['turn 1', 'turn 2', 'turn 3', 'turn 4', 'turn 5'].some(t => contents.includes(t)), JSON.stringify(contents));
        check('A3 a recent user message is retained', contents.includes('turn 6'), JSON.stringify(contents));
    }

    // A4: chats are isolated from each other.
    {
        const agent = stubAgent();
        await stubTurn(agent, 'alpha only', 'iso-a');
        await stubTurn(agent, 'beta only', 'iso-b');
        const a = agent.getHistory('iso-a');
        const b = agent.getHistory('iso-b');
        eq('A4 chat A has 3 messages', a.length, 3);
        eq('A4 chat B has 3 messages', b.length, 3);
        check('A4 chat A does not see chat B', !a.some((m: any) => /beta/.test(m.content)), JSON.stringify(a));
        check('A4 chat B does not see chat A', !b.some((m: any) => /alpha/.test(m.content)), JSON.stringify(b));
    }

    // A5: updateConfig preserves history (the Object.assign regression).
    {
        const agent = stubAgent();
        await stubTurn(agent, 'keep me', 'cfg');
        agent.updateConfig({ model: 'other-model', temperature: 0.9 });
        const h = agent.getHistory('cfg');
        eq('A5 updateConfig preserves history length', h.length, 3);
        eq('A5 updateConfig keeps the first message', h[0]?.content, 'keep me');
        eq('A5 updateConfig applied the model', agent.getConfig().model, 'other-model');
    }

    // A6: clearHistory targets one chat, or all when no id is given.
    {
        const agent = stubAgent();
        await stubTurn(agent, 'a', 'clear-a');
        await stubTurn(agent, 'b', 'clear-b');
        agent.clearHistory('clear-a');
        eq('A6 clearing one chat empties it', agent.getHistory('clear-a').length, 0);
        eq('A6 clearing one chat keeps the other', agent.getHistory('clear-b').length, 3);
        agent.clearHistory();
        eq('A6 clearing all empties every chat', Object.keys(agent.getHistory()).length, 0);
    }

    // A7: blank/whitespace chat ids collapse to the default chat.
    {
        const agent = stubAgent();
        await stubTurn(agent, 'defaulted', '   ');
        eq('A7 blank chat id maps to default', agent.getHistory('default').length, 3);
        eq('A7 blank chat id has no separate chat', Object.keys(agent.getHistory()).length, 1);
    }

    // A8: the chat map is capped at MAX_CHATS (50), evicting the oldest.
    {
        const agent = stubAgent();
        for (let i = 0; i <= 50; i++) await stubTurn(agent, `c${i}`, `qa-c${i}`);
        const all = agent.getHistory();
        eq('A8 chat map is capped at 50', Object.keys(all).length, 50);
        check('A8 the oldest chat was evicted', !('qa-c0' in all), 'qa-c0 still present');
        check('A8 the newest chat is retained', 'qa-c50' in all, 'qa-c50 missing');
    }
}

// ---------------------------------------------------------------------------
// Live helpers
// ---------------------------------------------------------------------------

interface Turn {
    status: number;
    body: any;
    instructions: AgentInstruction[];
}

async function liveTurn(chatId: string, userInput: string, autoExecute = false, timeoutMs = 180000): Promise<Turn> {
    const res = await fetch(`${PRIMARY}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userInput,
            autoExecute,
            chatId,
            config: { model: MODEL, temperature: 0 }
        }),
        signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body, instructions: body?.data?.generatedInstructions || [] };
}

async function history(chatId: string): Promise<Array<{ role: string; content: string }>> {
    const res = await fetch(`${PRIMARY}/history?chatId=${encodeURIComponent(chatId)}`, {
        signal: AbortSignal.timeout(10000)
    });
    const body = await res.json().catch(() => null);
    return body?.data || [];
}

async function clear(chatId?: string): Promise<void> {
    await fetch(`${PRIMARY}/clear-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatId ? { chatId } : {}),
        signal: AbortSignal.timeout(10000)
    });
}

async function streamTurn(chatId: string, userInput: string, timeoutMs = 180000): Promise<any> {
    const res = await fetch(`${PRIMARY}/process/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userInput,
            autoExecute: true,
            chatId,
            config: { model: MODEL, temperature: 0 }
        }),
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok || !res.body) return { error: `HTTP ${res.status}` };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done: any = null;
    let error: any = null;

    while (true) {
        const { done: eof, value } = await reader.read();
        if (eof) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
            const line = part.split('\n').find(l => l.startsWith('data: '));
            if (!line) continue;
            let event: any;
            try { event = JSON.parse(line.slice(6)); } catch { continue; }
            if (event.type === 'done') done = event.data;
            else if (event.type === 'error') error = event.error;
        }
    }
    return { done, error };
}

// ---------------------------------------------------------------------------
// B. Live long continuous chats
// ---------------------------------------------------------------------------

const CHAT = 'qa-long-1';

async function sectionB() {
    console.log('\nB. Live long continuous chats (real model)');

    // Make sure we start from a clean slate for the QA chats.
    await clear(CHAT);
    await clear('qa-iso-A');
    await clear('qa-iso-B');
    await clear('qa-cfg');
    await clear('qa-stream');

    // B1: an 11-turn research conversation with searches, follow-ups and clicks.
    const plan: Array<{ input: string; expect?: 'navigate' | 'no_navigate' | 'click'; contains?: string }> = [
        { input: 'search the web for the history of the smartphone', expect: 'navigate', contains: 'history' },
        { input: 'tell me more', expect: 'no_navigate' },
        { input: 'click the first result', expect: 'click' },
        { input: 'scroll down' },
        { input: 'search the web for the first iPhone release date', expect: 'navigate', contains: 'iphone' },
        { input: 'click the third result', expect: 'click' },
        { input: 'search the web for smartphone history', expect: 'navigate', contains: 'smartphone' },
        { input: 'tell me more', expect: 'no_navigate' },
        { input: 'click the second result', expect: 'click' },
        { input: 'scroll to top' },
        { input: 'search the web for smartphone cameras', expect: 'navigate', contains: 'cameras' }
    ];

    const turns: Turn[] = [];
    try {
        for (let i = 0; i < plan.length; i++) {
            const turn = await liveTurn(CHAT, plan[i].input, false);
            turns.push(turn);
            check(`B1 turn ${i + 1} succeeded ("${plan[i].input.slice(0, 40)}")`,
                turn.status === 200 && turn.body?.success !== false,
                `status ${turn.status} ${JSON.stringify(turn.body?.error || turn.body?.message || '')}`);
        }
    } catch (error: any) {
        check('B1 long chat completed', false, error?.message || String(error));
    }

    check('B1 all 11 turns ran', turns.length === 11, `ran ${turns.length}`);

    if (turns.length === 11) {
        const nav1 = turns[0].instructions.find(i => i.action === 'navigate');
        check('B1 turn 1 searches the web', !!nav1 && /duckduckgo\.com/.test(nav1.target || '') && /history/i.test(nav1.target || ''), JSON.stringify(actions(turns[0].instructions)));

        check('B1 turn 2 follow-up does not navigate away', !turns[1].instructions.some(i => i.action === 'navigate'), JSON.stringify(actions(turns[1].instructions)));

        check('B1 turn 3 clicks the first result', turns[2].instructions.some(i => i.action === 'click') && !turns[2].instructions.some(i => i.action === 'navigate'), JSON.stringify(actions(turns[2].instructions)));

        const nav5 = turns[4].instructions.find(i => i.action === 'navigate');
        check('B1 turn 5 searches for the iPhone', !!nav5 && /iphone/i.test(nav5.target || ''), JSON.stringify(actions(turns[4].instructions)));

        check('B1 turn 6 clicks a result', turns[5].instructions.some(i => i.action === 'click') && !turns[5].instructions.some(i => i.action === 'navigate'), JSON.stringify(actions(turns[5].instructions)));

        check('B1 turn 8 follow-up does not navigate away', !turns[7].instructions.some(i => i.action === 'navigate'), JSON.stringify(actions(turns[7].instructions)));
    }

    // B2: history is bounded and holds the newest turns.
    const h = await history(CHAT);
    check('B2 history is bounded by MAX_MESSAGES', h.length <= 20, `length ${h.length}`);
    check('B2 history is non-trivial after 11 turns', h.length >= 18, `length ${h.length}`);
    check('B2 newest turn is in history', h.some(m => m.content === 'search the web for smartphone cameras'), JSON.stringify(h.map(m => m.content).slice(-4)));
    console.log(`  INFO  ${CHAT} history length = ${h.length}`);

    // B3: chat isolation over HTTP.
    try {
        const a = await liveTurn('qa-iso-A', 'search the web for bananas', false);
        const b = await liveTurn('qa-iso-B', 'search the web for bicycles', false);
        check('B3 chat A turn succeeded', a.status === 200 && a.body?.success !== false, `status ${a.status}`);
        check('B3 chat B turn succeeded', b.status === 200 && b.body?.success !== false, `status ${b.status}`);

        const ha = await history('qa-iso-A');
        const hb = await history('qa-iso-B');
        check('B3 chat A remembers only its own input', ha.some(m => /bananas/.test(m.content)) && !ha.some(m => /bicycles/.test(m.content)), JSON.stringify(ha));
        check('B3 chat B remembers only its own input', hb.some(m => /bicycles/.test(m.content)) && !hb.some(m => /bananas/.test(m.content)), JSON.stringify(hb));
    } catch (error: any) {
        check('B3 chat isolation', false, error?.message || String(error));
    }

    // B4: a config change mid-chat must not reset the conversation.
    try {
        await liveTurn('qa-cfg', 'go to example.com', false);
        const before = (await history('qa-cfg')).length;
        await liveTurn('qa-cfg', 'search the web for cats', false);
        const after = await history('qa-cfg');
        check('B4 config change preserved the earlier turn', after.some(m => m.content === 'go to example.com'), JSON.stringify(after));
        check('B4 history grew across the config change', after.length > before, `before ${before}, after ${after.length}`);
    } catch (error: any) {
        check('B4 config change mid-chat', false, error?.message || String(error));
    }

    // B5: the streaming path records history too.
    try {
        const result = await streamTurn('qa-stream', 'search the web for penguins');
        check('B5 streaming turn produced a done event', !!result.done && result.error == null, `error ${JSON.stringify(result.error)}`);
        const hs = await history('qa-stream');
        check('B5 streaming turn recorded the user input', hs.some(m => /penguins/.test(m.content)), JSON.stringify(hs));
        check('B5 streaming turn recorded an answer', hs.some(m => m.role === 'assistant' && !/Generated/.test(m.content)), JSON.stringify(hs));
    } catch (error: any) {
        check('B5 streaming records history', false, error?.message || String(error));
    }

    // B6: clearing one chat leaves the others intact.
    try {
        await clear('qa-iso-A');
        const ha = await history('qa-iso-A');
        const hb = await history('qa-iso-B');
        eq('B6 cleared chat is empty', ha.length, 0);
        check('B6 other chat survives the clear', hb.some(m => /bicycles/.test(m.content)), JSON.stringify(hb));
    } catch (error: any) {
        check('B6 clear one chat', false, error?.message || String(error));
    }

    // B7: switch topics, then ask to return to the first one — the planner has
    // to resolve "the first topic" from the conversation history.
    try {
        await clear('qa-mem');
        await liveTurn('qa-mem', 'search the web for the history of smartphones', false);
        await liveTurn('qa-mem', 'search the web for chocolate cake recipes', false);
        const back = await liveTurn('qa-mem', 'go back to the first topic I searched for', false);
        check('B7 topic-return turn succeeded', back.status === 200 && back.body?.success !== false,
            `status ${back.status} ${JSON.stringify(back.body?.error || '')}`);
        const blob = JSON.stringify(back.instructions) + ' ' + JSON.stringify(back.body?.data?.recognizedIntent || {});
        check('B7 topic return resolves to the earlier topic', /smartphone/i.test(blob), blob.slice(0, 400));
    } catch (error: any) {
        check('B7 topic switch and return', false, error?.message || String(error));
    }

    // B8: two chats processed concurrently must not cross-contaminate.
    try {
        await clear('qa-con-A');
        await clear('qa-con-B');
        const [x, y] = await Promise.all([
            liveTurn('qa-con-A', 'search the web for dolphins', false),
            liveTurn('qa-con-B', 'search the web for mountains', false)
        ]);
        const navA = x.instructions.find(i => i.action === 'navigate');
        const navB = y.instructions.find(i => i.action === 'navigate');
        check('B8 concurrent chat A searched dolphins', !!navA && /dolphins/.test(navA.target || ''), JSON.stringify(actions(x.instructions)));
        check('B8 concurrent chat B searched mountains', !!navB && /mountains/.test(navB.target || ''), JSON.stringify(actions(y.instructions)));
        const ha = await history('qa-con-A');
        const hb = await history('qa-con-B');
        check('B8 concurrent histories did not cross',
            ha.some(m => /dolphins/.test(m.content)) && !ha.some(m => /mountains/.test(m.content)) &&
            hb.some(m => /mountains/.test(m.content)) && !hb.some(m => /dolphins/.test(m.content)),
            JSON.stringify({ ha, hb }));
    } catch (error: any) {
        check('B8 concurrent interleaved chats', false, error?.message || String(error));
    }

    // B9: aborting a streaming turn mid-flight must not leave a partial turn,
    // and the chat must still be usable afterwards.
    try {
        await clear('qa-abort');
        const controller = new AbortController();
        try {
            const res = await fetch(`${PRIMARY}/process/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userInput: 'search the web for a detailed history of the ancient roman empire',
                    autoExecute: true,
                    chatId: 'qa-abort',
                    config: { model: MODEL, temperature: 0 }
                }),
                signal: controller.signal
            });
            if (res.body) {
                const reader = res.body.getReader();
                await reader.read();
                controller.abort();
                await reader.cancel().catch(() => { });
            }
        } catch { /* abort expected */ }
        await new Promise(r => setTimeout(r, 1500));

        const h = await history('qa-abort');
        check('B9 aborted stream leaves no partial answer',
            h.length <= 2 && !h.some(m => m.role === 'assistant' && !/Generated/.test(m.content)),
            `length ${h.length} ${JSON.stringify(h)}`);

        const ok = await liveTurn('qa-abort', 'search the web for volcanoes', false);
        check('B9 chat is usable after an abort', ok.status === 200 && ok.body?.success !== false, `status ${ok.status}`);
        check('B9 post-abort turn is recorded', (await history('qa-abort')).some(m => /volcanoes/.test(m.content)), JSON.stringify(await history('qa-abort')));
    } catch (error: any) {
        check('B9 abort does not corrupt history', false, error?.message || String(error));
    }

    // Clean up the QA chats.
    for (const id of [CHAT, 'qa-iso-A', 'qa-iso-B', 'qa-cfg', 'qa-stream', 'qa-mem', 'qa-con-A', 'qa-con-B', 'qa-abort']) await clear(id);
}

(async () => {
    console.log('Long continuous-chat QA suite');
    await sectionA();
    if (process.env.QA_SKIP_LIVE === '1') {
        console.log('\n(skipping live section B: QA_SKIP_LIVE=1)');
    } else {
        await sectionB();
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.log('Failures:');
        for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed > 0 ? 1 : 0);
})();
