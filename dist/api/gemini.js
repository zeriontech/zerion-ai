// app/api/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
let genAI = null;
function getClient() {
    if (!genAI) {
        if (!process.env.GEMINI_API_KEY)
            throw new Error('GEMINI_API_KEY not set');
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    return genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
}
// Ask Gemini which tokens have the strongest narrative momentum
export async function getMomentumPicks(tokens) {
    const model = getClient();
    const list = tokens.map(t => `${t.symbol} (${t.name})`).join(', ');
    const prompt = `
You are a crypto memecoin analyst focused on Base chain.
Given these tokens: ${list}

Pick the top 5 with strongest current narrative momentum based on:
- Community excitement and virality potential
- Recent catalysts or news
- Memetic strength and cultural resonance
- DeFi/onchain activity trends

Reply ONLY with a JSON array of symbols. Example: ["SYMBOL1","SYMBOL2","SYMBOL3"]
No explanation, no markdown, just the JSON array.
`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    try {
        return JSON.parse(text);
    }
    catch {
        // Try to extract array from response if it has extra text
        const match = text.match(/\[.*\]/);
        if (match)
            return JSON.parse(match[0]);
        return [];
    }
}
// Score a single token's narrative strength 0-100
export async function scoreNarrative(symbol, context) {
    const model = getClient();
    const prompt = `
Score this Base chain token's narrative strength from 0 to 100.
Token: ${symbol}
Context: ${context}

Score based on: clarity of use case, community excitement, recent momentum, meme potential.
Reply ONLY with a single integer 0-100. Nothing else.
`;
    const result = await model.generateContent(prompt);
    const score = parseInt(result.response.text().trim());
    return isNaN(score) ? 50 : Math.max(0, Math.min(100, score));
}
