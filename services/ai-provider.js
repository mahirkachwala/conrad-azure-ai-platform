/**
 * AI Provider Abstraction Layer
 * 
 * This abstraction allows you to switch between different AI providers:
 * - Gemini (current, via Google AI)
 * - Ollama (local open-source models)
 * - OpenAI (GPT-4, etc.)
 * - Custom models
 * 
 * Perfect for learning how different LLMs work!
 */

import { GoogleGenAI } from '@google/genai';

// Configuration - Change this to switch providers!
const AI_PROVIDER = process.env.AI_PROVIDER || 'gemini'; // Options: 'gemini', 'ollama', 'openai'
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

/**
 * Base AI Provider Interface
 * All providers must implement this interface
 */
class AIProvider {
  async generateStructuredJSON(systemPrompt, userMessage, schema) {
    throw new Error('Method not implemented');
  }
  
  async generateText(systemPrompt, userMessage) {
    throw new Error('Method not implemented');
  }
}

/**
 * Gemini Provider (Current implementation)
 */
class GeminiProvider extends AIProvider {
  constructor() {
    super();
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '' });
    this.maxRetries = 3;
    this.baseDelay = 1000;
  }
  
  async retryWithBackoff(fn, context = 'API call') {
    let lastError;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const isNetworkError = error.message?.includes('fetch failed') || 
                               error.message?.includes('ECONNREFUSED') ||
                               error.message?.includes('network');
        
        if (isNetworkError && attempt < this.maxRetries - 1) {
          const delay = this.baseDelay * Math.pow(2, attempt);
          console.log(`⚠️ ${context} failed (attempt ${attempt + 1}/${this.maxRetries}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else if (!isNetworkError) {
          throw error;
        }
      }
    }
    console.error(`❌ ${context} failed after ${this.maxRetries} attempts`);
    throw lastError;
  }
  
  async generateStructuredJSON(systemPrompt, userMessage, schema) {
    return await this.retryWithBackoff(async () => {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: userMessage,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: schema
        }
      });
      
      return JSON.parse(response.text);
    }, 'Structured JSON generation');
  }
  
  async generateText(systemPrompt, userMessage) {
    return await this.retryWithBackoff(async () => {
      const result = await this.ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: userMessage,
        config: {
          systemInstruction: systemPrompt
        }
      });
      
      return result.text;
    }, 'Text generation');
  }
}

/**
 * Ollama Provider (Local LLM execution)
 * 
 * Ollama lets you run models like Llama 3, Mistral, etc. locally
 * Install: curl -fsSL https://ollama.ai/install.sh | sh
 * Run model: ollama run llama3.1:8b
 */
class OllamaProvider extends AIProvider {
  constructor() {
    super();
    this.baseUrl = OLLAMA_BASE_URL;
    this.model = OLLAMA_MODEL;
  }
  
  async generateStructuredJSON(systemPrompt, userMessage, schema) {
    try {
      // Ollama doesn't have native JSON schema support like Gemini
      // So we add explicit JSON formatting instructions to the prompt
      const jsonPrompt = `${systemPrompt}

CRITICAL: You must respond with ONLY valid JSON matching this exact schema:
${JSON.stringify(schema, null, 2)}

No markdown, no code blocks, no explanations - just raw JSON.`;

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: `${jsonPrompt}\n\nUser: ${userMessage}\n\nAssistant (JSON only):`,
          stream: false,
          format: 'json' // Ollama's JSON mode
        })
      });
      
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const text = data.response.trim();
      
      // Parse and validate JSON
      try {
        return JSON.parse(text);
      } catch (parseError) {
        // If JSON parsing fails, try to extract JSON from markdown blocks or find first balanced braces
        const markdownMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (markdownMatch) {
          return JSON.parse(markdownMatch[1]);
        }
        
        // Try to extract first balanced JSON object
        const firstBrace = text.indexOf('{');
        if (firstBrace !== -1) {
          let depth = 0;
          let lastBrace = firstBrace;
          for (let i = firstBrace; i < text.length; i++) {
            if (text[i] === '{') depth++;
            if (text[i] === '}') {
              depth--;
              if (depth === 0) {
                lastBrace = i;
                break;
              }
            }
          }
          if (depth === 0) {
            try {
              const extracted = text.substring(firstBrace, lastBrace + 1);
              console.log('📝 Ollama learning note: Extracted JSON from text at chars', firstBrace, '-', lastBrace);
              return JSON.parse(extracted);
            } catch (e) {
              // Fall through to error
            }
          }
        }
        
        console.error('❌ Ollama JSON parsing failed. Sample response:', text.substring(0, 200));
        throw new Error(`Failed to parse JSON from Ollama response. This is a learning moment - check logs!`);
      }
    } catch (error) {
      console.error('Ollama error:', error.message);
      throw error;
    }
  }
  
  async generateText(systemPrompt, userMessage) {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: `${systemPrompt}\n\nUser: ${userMessage}\n\nAssistant:`,
          stream: false
        })
      });
      
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }
      
      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error('Ollama error:', error.message);
      throw error;
    }
  }
  
  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return false;
      const data = await response.json();
      return data.models && data.models.length > 0;
    } catch {
      return false;
    }
  }
}

/**
 * OpenAI Provider (for comparison/future use)
 */
class OpenAIProvider extends AIProvider {
  constructor() {
    super();
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }
  
  async generateStructuredJSON(systemPrompt, userMessage, schema) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3
        })
      });
      
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }
      
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);
    } catch (error) {
      console.error('OpenAI error:', error);
      throw error;
    }
  }
  
  async generateText(systemPrompt, userMessage) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7
      })
    });
    
    const data = await response.json();
    return data.choices[0].message.content;
  }
}

/**
 * Get the active AI provider based on configuration
 */
function getProvider() {
  switch (AI_PROVIDER.toLowerCase()) {
    case 'ollama':
      console.log(`🦙 Using Ollama provider with model: ${OLLAMA_MODEL}`);
      return new OllamaProvider();
    case 'openai':
      console.log('🤖 Using OpenAI provider');
      return new OpenAIProvider();
    case 'gemini':
    default:
      console.log('✨ Using Gemini provider');
      return new GeminiProvider();
  }
}

// Export singleton instance
export const aiProvider = getProvider();

// Export provider classes for testing/comparison
export { GeminiProvider, OllamaProvider, OpenAIProvider };

// Export config for status checks
export const providerConfig = {
  current: AI_PROVIDER,
  ollamaUrl: OLLAMA_BASE_URL,
  ollamaModel: OLLAMA_MODEL
};
