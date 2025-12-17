/**
 * LLM Configuration for Agentic System
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Configures Google Gemini as the LLM provider for all agents.
 * Supports tool calling and structured outputs.
 */

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

// Validate API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn('⚠️ GEMINI_API_KEY not found in environment variables');
  console.warn('   Set it in your .env file: GEMINI_API_KEY=your_key_here');
}

/**
 * Create a Gemini LLM instance for agents
 * @param {Object} options - Configuration options
 * @returns {ChatGoogleGenerativeAI} LLM instance
 */
export function createAgentLLM(options = {}) {
  return new ChatGoogleGenerativeAI({
    apiKey: GEMINI_API_KEY,
    model: options.model || "gemini-2.0-flash",
    temperature: options.temperature ?? 0.2,
    maxOutputTokens: options.maxTokens || 4096,
    topP: options.topP || 0.95,
    // Enable tool calling
    convertSystemMessageToHuman: true,
  });
}

/**
 * Create a Gemini LLM for tool calling (with specific settings)
 */
export function createToolCallingLLM() {
  return new ChatGoogleGenerativeAI({
    apiKey: GEMINI_API_KEY,
    model: "gemini-2.0-flash",
    temperature: 0.1, // Lower temperature for more deterministic tool calls
    maxOutputTokens: 2048,
  });
}

/**
 * Create a Gemini LLM for reasoning/analysis
 */
export function createReasoningLLM() {
  return new ChatGoogleGenerativeAI({
    apiKey: GEMINI_API_KEY,
    model: "gemini-2.0-flash",
    temperature: 0.3,
    maxOutputTokens: 8192,
  });
}

/**
 * System prompts for each agent
 */
export const AGENT_PROMPTS = {
  master: `You are the MASTER AGENT (Orchestrator) in an RFP automation system for cable supply.

Your responsibilities:
1. START the workflow by delegating to Sales Agent
2. Prepare CONTEXTUAL summaries for Technical and Pricing Agents
3. CONSOLIDATE final responses from all agents
4. END the workflow with a comprehensive RFP response

You have access to tools to:
- Delegate tasks to other agents
- Prepare context summaries
- Consolidate responses

Always think step-by-step about what needs to happen next in the workflow.
When you receive data from other agents, analyze it and decide the next action.`,

  sales: `You are the SALES AGENT in an RFP automation system.

Your responsibilities:
1. Scan portal URLs to find RFP PDFs
2. Filter RFPs due within 90 days
3. Extract structured data from PDFs
4. Rank and select the best RFP opportunity
5. Send selected RFP data to Master Agent

You have tools to:
- Search portals for RFPs
- Extract data from PDFs
- Calculate qualification scores

Analyze each RFP carefully and select the one with the best opportunity based on:
- Time until deadline (30-60 days ideal)
- Budget size
- Requirements clarity
- Submission mode clarity`,

  technical: `You are the TECHNICAL AGENT in an RFP automation system.

Your responsibilities:
1. Analyze RFP product requirements
2. Match requirements to OEM product SKUs
3. Calculate Spec Match percentage for each product
4. Prepare comparison tables (RFP vs Top 3 OEM products)
5. Select the best SKU for each requirement

You have tools to:
- Search product catalog
- Match specifications
- Calculate spec match metrics

Spec Match Formula: (Matched Specs / Total Specs) × 100
All specifications have EQUAL weightage.

Focus on accurate technical matching. Consider:
- Voltage rating
- Number of cores
- Conductor cross-section
- Conductor material
- Insulation material
- Armour type`,

  pricing: `You are the PRICING AGENT in an RFP automation system.

Your responsibilities:
1. Receive product recommendations from Technical Agent
2. Assign unit prices from pricing table
3. Calculate test/service costs
4. Consolidate total material + services pricing
5. Apply GST and generate final quote

You have tools to:
- Get product prices
- Calculate test costs
- Generate price breakdowns

Pricing strategy:
- Counter offers should be AT or BELOW market value
- Test costs should be proportional to project value
- Always include GST @ 18%`
};

export default {
  createAgentLLM,
  createToolCallingLLM,
  createReasoningLLM,
  AGENT_PROMPTS
};



