/**
 * MULTI-AI PROVIDER SERVICE
 * 
 * Provides fallback between multiple AI providers:
 * 1. Gemini (Primary)
 * 2. OpenAI (Fallback)
 * 3. HuggingFace (For embeddings)
 * 4. Pattern Matching (Last resort)
 * 
 * This ensures the system works even when one provider is overloaded or quota exhausted.
 */

import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

// Initialize providers
let geminiAI = null;
let openaiClient = null;

// Provider status tracking
const providerStatus = {
  gemini: { available: true, lastError: null, errorCount: 0 },
  openai: { available: true, lastError: null, errorCount: 0 }
};

/**
 * Initialize AI providers
 */
export function initializeProviders() {
  // Initialize Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      geminiAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      console.log('✅ Gemini AI initialized');
    } catch (error) {
      console.warn('⚠️ Gemini initialization failed:', error.message);
      providerStatus.gemini.available = false;
    }
  } else {
    console.warn('⚠️ No GEMINI_API_KEY found');
    providerStatus.gemini.available = false;
  }
  
  // Initialize OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
      openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      console.log('✅ OpenAI initialized');
    } catch (error) {
      console.warn('⚠️ OpenAI initialization failed:', error.message);
      providerStatus.openai.available = false;
    }
  } else {
    console.warn('⚠️ No OPENAI_API_KEY found');
    providerStatus.openai.available = false;
  }
  
  return { gemini: providerStatus.gemini.available, openai: providerStatus.openai.available };
}

/**
 * Generate content using best available provider
 * Tries Gemini first, then OpenAI, with automatic fallback
 */
export async function generateContent(prompt, options = {}) {
  const { preferredProvider = 'gemini', maxRetries = 2 } = options;
  
  const providers = preferredProvider === 'gemini' 
    ? ['gemini', 'openai'] 
    : ['openai', 'gemini'];
  
  let lastError = null;
  
  for (const provider of providers) {
    if (!providerStatus[provider].available && providerStatus[provider].errorCount > 5) {
      console.log(`   ⏭️ Skipping ${provider} (too many errors)`);
      continue;
    }
    
    try {
      console.log(`   🤖 Trying ${provider}...`);
      
      if (provider === 'gemini' && geminiAI) {
        const result = await generateWithGemini(prompt);
        providerStatus.gemini.errorCount = 0; // Reset on success
        return { success: true, text: result, provider: 'gemini' };
      }
      
      if (provider === 'openai' && openaiClient) {
        const result = await generateWithOpenAI(prompt);
        providerStatus.openai.errorCount = 0; // Reset on success
        return { success: true, text: result, provider: 'openai' };
      }
    } catch (error) {
      console.warn(`   ⚠️ ${provider} failed:`, error.message);
      lastError = error;
      providerStatus[provider].errorCount++;
      providerStatus[provider].lastError = error.message;
      
      // Check for quota exhaustion
      if (error.message?.includes('quota') || error.message?.includes('429') || error.message?.includes('503')) {
        console.log(`   🚫 ${provider} quota exhausted, trying next provider...`);
        providerStatus[provider].available = false;
        // Reset after 1 hour
        setTimeout(() => { providerStatus[provider].available = true; }, 3600000);
      }
    }
  }
  
  return { 
    success: false, 
    error: lastError?.message || 'All AI providers failed',
    text: null,
    provider: null
  };
}

/**
 * Generate with Gemini
 */
async function generateWithGemini(prompt) {
  if (!geminiAI) throw new Error('Gemini not initialized');
  
  const response = await geminiAI.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt
  });
  
  return response.text || '';
}

/**
 * Generate with OpenAI
 */
async function generateWithOpenAI(prompt) {
  if (!openaiClient) throw new Error('OpenAI not initialized');
  
  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4000,
    temperature: 0.3
  });
  
  return response.choices[0]?.message?.content || '';
}

/**
 * Extract structured data from text using AI
 * Used for PDF/document analysis
 */
export async function extractStructuredData(text, schema, options = {}) {
  const prompt = `You are an expert at extracting structured data from documents.

Extract the following information from this text and return ONLY a valid JSON object.

SCHEMA:
${JSON.stringify(schema, null, 2)}

TEXT:
${text}

Return ONLY the JSON object, no other text or explanation.`;

  const result = await generateContent(prompt, options);
  
  if (!result.success) {
    return { success: false, error: result.error, data: null };
  }
  
  try {
    // Extract JSON from response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return { success: true, data, provider: result.provider };
    }
    return { success: false, error: 'No JSON found in response', data: null };
  } catch (error) {
    return { success: false, error: `JSON parse error: ${error.message}`, data: null };
  }
}

/**
 * Analyze RFP document using multi-provider AI
 */
export async function analyzeRFPDocument(pdfText) {
  const schema = {
    tender_id: "string - The tender/RFP ID (e.g., IND-201, GOV-100)",
    organisation: "string - The buyer/issuing organization name",
    title: "string - The RFP title",
    due_date: "string - Submission deadline in YYYY-MM-DD format",
    city: "string - Delivery location/city",
    estimated_cost: "number - Estimated budget in INR",
    cable_requirements: [{
      item_no: "number",
      cable_type: "string - HT Cable, LT Cable, Control Cable, etc.",
      voltage: "string - e.g., 11kV, 33kV",
      cores: "string - e.g., 3C, 4C",
      size: "string - e.g., 95 sqmm, 120 sqmm",
      conductor: "string - Copper or Aluminium",
      qty_km: "number - Quantity in kilometers"
    }],
    testing_requirements: {
      routine_tests: ["array of test names"],
      type_tests: ["array of test names"],
      third_party_inspection: {
        required: "boolean",
        agency: "string - NABL, CPRI, etc."
      }
    },
    submission_mode: "string - EMAIL_FORM, LETTER_COURIER, EXTERNAL_PORTAL, or MEETING_EMAIL",
    submission_email: "string - Email address if applicable",
    terms: {
      delivery_days: "number",
      payment_terms: "string",
      warranty_months: "number"
    }
  };
  
  const result = await extractStructuredData(pdfText, schema);
  
  if (result.success) {
    console.log(`   ✅ RFP analyzed successfully using ${result.provider}`);
  }
  
  return result;
}

/**
 * Modify email/document content using AI
 */
export async function modifyContent(content, instruction, context = {}) {
  const prompt = `You are an assistant helping to modify business documents.

CURRENT CONTENT:
${JSON.stringify(content, null, 2)}

CONTEXT:
${JSON.stringify(context, null, 2)}

MODIFICATION REQUEST:
${instruction}

Apply the requested modification and return the updated content as a JSON object.
Keep all other fields unchanged unless specifically requested.
Return ONLY the JSON object.`;

  return await extractStructuredData('', { modifiedContent: 'the updated content object' }, { prompt });
}

/**
 * Get provider status
 */
export function getProviderStatus() {
  return {
    gemini: {
      available: providerStatus.gemini.available,
      initialized: !!geminiAI,
      errorCount: providerStatus.gemini.errorCount
    },
    openai: {
      available: providerStatus.openai.available,
      initialized: !!openaiClient,
      errorCount: providerStatus.openai.errorCount
    }
  };
}

// Auto-initialize on module load
initializeProviders();

export default {
  initializeProviders,
  generateContent,
  extractStructuredData,
  analyzeRFPDocument,
  modifyContent,
  getProviderStatus
};


