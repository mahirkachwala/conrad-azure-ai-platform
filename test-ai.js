
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

async function testAI() {
    console.log('Testing AI Connectivity...');

    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    console.log(`Gemini Key Present: ${!!geminiKey}`);
    console.log(`OpenAI Key Present: ${!!openaiKey}`);

    if (geminiKey) {
        try {
            console.log('Testing Gemini...');
            const genAI = new GoogleGenAI({ apiKey: geminiKey });
            const result = await genAI.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: 'Hello, are you working?'
            });
            console.log('✅ Gemini Response:', result.text);
        } catch (error) {
            console.error('❌ Gemini Failed:', error.message);
        }
    }

    if (openaiKey) {
        try {
            console.log('Testing OpenAI...');
            const openai = new OpenAI({ apiKey: openaiKey });
            const result = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'Hello' }],
                max_tokens: 10
            });
            console.log('✅ OpenAI Response:', result.choices[0].message.content);
        } catch (error) {
            console.error('❌ OpenAI Failed:', error.message);
        }
    }
}

testAI();
