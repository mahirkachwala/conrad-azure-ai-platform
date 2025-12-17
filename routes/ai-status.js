import express from 'express';
import { aiProvider, providerConfig, GeminiProvider, OllamaProvider, OpenAIProvider } from '../services/ai-provider.js';

const router = express.Router();

/**
 * ⚠️  WARNING: These endpoints are for LEARNING purposes only!
 * For production use, add authentication and rate limiting.
 * Anyone who accesses these endpoints can trigger AI API calls.
 */

/**
 * GET /api/ai/status
 * Check the status of all AI providers
 */
router.get('/status', async (req, res) => {
  const status = {
    current: providerConfig.current,
    timestamp: new Date().toISOString(),
    providers: {}
  };

  // Check Ollama
  try {
    const ollama = new OllamaProvider();
    const isHealthy = await ollama.checkHealth();
    status.providers.ollama = {
      available: isHealthy,
      url: providerConfig.ollamaUrl,
      model: providerConfig.ollamaModel,
      status: isHealthy ? 'ready' : 'not running'
    };
  } catch (error) {
    status.providers.ollama = {
      available: false,
      error: error.message,
      status: 'error'
    };
  }

  // Check Gemini
  try {
    const hasKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    status.providers.gemini = {
      available: hasKey,
      status: hasKey ? 'ready' : 'no API key',
      model: 'gemini-2.5-flash'
    };
  } catch (error) {
    status.providers.gemini = {
      available: false,
      error: error.message,
      status: 'error'
    };
  }

  // Check OpenAI
  try {
    const hasKey = !!process.env.OPENAI_API_KEY;
    status.providers.openai = {
      available: hasKey,
      status: hasKey ? 'ready' : 'no API key',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    };
  } catch (error) {
    status.providers.openai = {
      available: false,
      error: error.message,
      status: 'error'
    };
  }

  res.json(status);
});

/**
 * GET /api/ai/models
 * List available Ollama models
 */
router.get('/models', async (req, res) => {
  try {
    const response = await fetch(`${providerConfig.ollamaUrl}/api/tags`);
    if (!response.ok) {
      return res.status(500).json({ error: 'Ollama not running' });
    }
    
    const data = await response.json();
    res.json({
      models: data.models || [],
      recommendations: [
        { name: 'llama3.1:8b', size: '4.7GB', speed: 'fast', accuracy: 'good', recommended: true },
        { name: 'mistral:7b', size: '4.1GB', speed: 'fast', accuracy: 'good', recommended: true },
        { name: 'phi3:mini', size: '2.3GB', speed: 'very fast', accuracy: 'fair', recommended: false },
        { name: 'llama3.1:70b', size: '40GB', speed: 'slow', accuracy: 'excellent', recommended: false }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ai/test
 * Test the current AI provider with a sample query
 * 
 * ⚠️  LEARNING MODE: No rate limiting - add auth for production!
 */
router.post('/test', async (req, res) => {
  // Simple rate limiting for learning (max 10 chars to prevent abuse)
  const { query = 'find copper cables in Mumbai' } = req.body;
  
  if (query.length > 500) {
    return res.status(400).json({ error: 'Query too long (max 500 chars)' });
  }
  
  try {
    const startTime = Date.now();
    
    // Simple test prompt
    const testPrompt = `You are a tender search assistant. Extract information from this query and respond with JSON.`;
    
    const schema = {
      type: 'object',
      properties: {
        keyword: { type: 'string', nullable: true },
        city: { type: 'string', nullable: true },
        category: { type: 'string', nullable: true }
      }
    };
    
    const result = await aiProvider.generateStructuredJSON(testPrompt, query, schema);
    const responseTime = Date.now() - startTime;
    
    res.json({
      success: true,
      provider: providerConfig.current,
      query,
      result,
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      provider: providerConfig.current,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/ai/compare
 * Compare responses from different providers
 * 
 * ⚠️  LEARNING MODE: This can trigger multiple paid API calls!
 */
router.post('/compare', async (req, res) => {
  const { query = 'find copper cables in Mumbai under 50 lakhs' } = req.body;
  
  if (query.length > 500) {
    return res.status(400).json({ error: 'Query too long (max 500 chars)' });
  }
  
  const results = {
    query,
    timestamp: new Date().toISOString(),
    providers: {}
  };
  
  const testPrompt = `You are a tender search assistant. Extract filters from this query.`;
  const schema = {
    type: 'object',
    properties: {
      keyword: { type: 'string', nullable: true },
      city: { type: 'string', nullable: true },
      category: { type: 'string', nullable: true },
      maxCost: { type: 'number', nullable: true }
    }
  };
  
  // Test each provider
  const providers = [
    { name: 'gemini', class: GeminiProvider },
    { name: 'ollama', class: OllamaProvider }
  ];
  
  for (const { name, class: ProviderClass } of providers) {
    try {
      const provider = new ProviderClass();
      const startTime = Date.now();
      const result = await provider.generateStructuredJSON(testPrompt, query, schema);
      const responseTime = Date.now() - startTime;
      
      results.providers[name] = {
        success: true,
        result,
        responseTime: `${responseTime}ms`
      };
    } catch (error) {
      results.providers[name] = {
        success: false,
        error: error.message
      };
    }
  }
  
  res.json(results);
});

export default router;
