
import OpenAI from 'openai';

const openai = new OpenAI({
    baseURL: 'http://localhost:1234/v1',
    apiKey: 'lm-studio', // Any string works for LM Studio
});

export async function enrichElements(html: string, elements: any[]) {
    // We can't feed ALL elements at once if there are hundreds. 
    // But Gemma 3 1B has decent context window. Let's try batching or sending all if small.
    // For this prototype, we'll try to send the simplified DOM and ask for a JSON map.

    // Construct a prompt
    const prompt = `
    You are an AI web accessibility and context engine.
    I will provide you with the SIMPLIFIED HTML of a webpage and a list of extracted interactive elements.
    
    Your task is to analyze the HTML to understand the context of each element (e.g., what does this button do? what input is expected here?).
    Return a JSON object where the **KEYS are the numeric index** of the element from the list below (0, 1, 2...), and the VALUES are the description.

    HTML Context:
    \`\`\`html
    ${html.substring(0, 3000)} 
    \`\`\` 
    (HTML truncated if too long)

    Elements to Analyze:
    ${JSON.stringify(elements.map((e: any, idx: number) => ({
        index: idx,
        id: e.selectors.id,
        selector: e.selectors.css,
        type: e.type,
        text: e.content.text
    })), null, 2)}

    Format your response STRICTLY as a raw JSON object. Do not use Markdown code blocks. Return ONLY the JSON string.
    {
        "0": "Description for element at index 0",
        "1": "Description for element at index 1",
        ...
    }
    `;

    try {
        const completion = await openai.chat.completions.create({
            model: "google/gemma-3-1b-it", // Adjust model name to match what's loaded in LM Studio
            messages: [
                { role: "system", content: "You are a helpful AI that analyzes web UIs. Output valid JSON only." },
                { role: "user", content: prompt }
            ],
            temperature: 0.2,
            // response_format: { type: "json_object" } // Removed to fix 400 error in LM Studio
        });

        const content = completion.choices[0].message.content;
        if (!content) return {};

        try {
            // Cleanup potential markdown code blocks if LLM ignores instruction
            const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleanContent);
        } catch (e) {
            console.error("Failed to parse LLM JSON:", content);
            return {};
        }

    } catch (error) {
        console.error("LLM Enrichment failed:", error);
        return {};
    }
}
