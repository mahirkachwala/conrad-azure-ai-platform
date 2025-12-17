/**
 * Agent Workflow Graph - UPGRADED
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Supports TWO modes:
 * 1. LLM_MODE (default): Uses AI-powered agents with tool calling
 * 2. RULE_MODE: Uses procedural agents (fallback)
 * 
 * Implements the LangGraph-based orchestration of:
 * Master Agent (Orchestrator) ↔ Sales Agent → Technical Agent → Pricing Agent
 */

import { StateGraph, END } from "@langchain/langgraph";
import { v4 as uuid } from "uuid";
import { initialState } from "./state.js";

// Import procedural agents (fallback)
import { MasterAgent } from "./agents/master.js";
import { SalesAgent } from "./agents/sales.js";
import { TechnicalAgent } from "./agents/technical.js";
import { PricingAgent } from "./agents/pricing.js";

// Import LLM-powered agents
import { LLMSalesAgent } from "./agents/llm-sales.js";
import { LLMTechnicalAgent } from "./agents/llm-technical.js";
import { LLMPricingAgent } from "./agents/llm-pricing.js";

import { agentBroadcaster } from "../services/agent-broadcast.js";

// Agent mode configuration
const AGENT_MODE = process.env.AGENT_MODE || 'LLM'; // 'LLM' or 'RULE'

/**
 * Get the appropriate agent function based on mode
 */
function getAgent(agentType) {
  if (AGENT_MODE === 'LLM') {
    switch (agentType) {
      case 'sales': return LLMSalesAgent;
      case 'technical': return LLMTechnicalAgent;
      case 'pricing': return LLMPricingAgent;
      case 'master': return MasterAgent; // Master stays procedural (orchestration logic)
      default: return null;
    }
  } else {
    // Rule-based mode
    switch (agentType) {
      case 'sales': return SalesAgent;
      case 'technical': return TechnicalAgent;
      case 'pricing': return PricingAgent;
      case 'master': return MasterAgent;
      default: return null;
    }
  }
}

/**
 * Build the LangGraph workflow
 */
export function buildGraph() {
  const graph = new StateGraph({
    channels: {
      // Session & Input
      sessionId: { default: () => null },
      input: { default: () => null },
      startTime: { default: () => Date.now() },
      broadcast: { default: () => true },
      
      // Master Agent State
      masterSummary: { default: () => null },
      technicalContext: { default: () => null },
      pricingContext: { default: () => null },
      consolidatedResponse: { default: () => null },
      
      // Sales Agent State
      scannedPortals: { default: () => [] },
      identifiedRFPs: { default: () => [] },
      selectedRFP: { default: () => null },
      rfpData: { default: () => null },
      discoveredPDFs: { default: () => [] },
      filteredPDFs: { default: () => [] },
      parsedRFPs: { default: () => [] },
      
      // Technical Agent State
      specsData: { default: () => null },
      scopeOfSupply: { default: () => [] },
      skuMatchResults: { default: () => [] },
      comparisonTables: { default: () => [] },
      recommendedSKUs: { default: () => [] },
      
      // Pricing Agent State
      testRequirements: { default: () => [] },
      productPricingTable: { default: () => [] },
      servicesPricingTable: { default: () => [] },
      consolidatedPricing: { default: () => null },
      marketAnalysis: { default: () => [] },
      
      // Agent Communication
      logs: {
        reducer: (current, update) => current.concat(update),
        default: () => []
      },
      agentOutputs: { default: () => ({ master: null, sales: null, technical: null, pricing: null }) },
      
      // Workflow Control
      next: { default: () => "sales" },
      errors: { default: () => [] },
      completedAgents: { default: () => [] }
    }
  });

  // Add agent nodes with dynamic selection
  graph.addNode("master", getAgent('master'));
  graph.addNode("sales", getAgent('sales'));
  graph.addNode("technical", getAgent('technical'));
  graph.addNode("pricing", getAgent('pricing'));

  // Set entry point (Master Agent starts the workflow)
  graph.setEntryPoint("master");

  // Master Agent routing
  graph.addConditionalEdges(
    "master",
    (state) => state.next,
    {
      sales: "sales",
      technical: "technical",
      end: END
    }
  );

  // Sales Agent routing
  graph.addConditionalEdges(
    "sales",
    (state) => state.next,
    {
      master: "master",
      technical: "technical",
      end: END
    }
  );

  // Technical Agent routing
  graph.addConditionalEdges(
    "technical",
    (state) => state.next,
    {
      pricing: "pricing",
      master: "master",
      end: END
    }
  );

  // Pricing Agent routing
  graph.addConditionalEdges(
    "pricing",
    (state) => state.next,
    {
      master: "master",
      end: END
    }
  );

  return graph.compile();
}

/**
 * Run the complete agentic workflow
 * @param {Object} input - Optional input parameters
 * @returns {Object} Final state with all agent outputs
 */
export async function runGraphOnce(input = {}) {
  const app = buildGraph();
  const state = initialState();
  state.sessionId = input.sessionId || uuid();
  state.input = input;
  state.startTime = Date.now();
  state.broadcast = input.broadcast !== false;

  const agentModeLabel = AGENT_MODE === 'LLM' ? '🤖 LLM-POWERED' : '📋 RULE-BASED';
  
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║     EY TECHATHON 6.0 - AGENTIC AI RFP AUTOMATION                 ║');
  console.log(`║     ${agentModeLabel} Multi-Agent Workflow                        ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`\n🚀 Starting LangGraph Workflow | Session: ${state.sessionId}`);
  console.log(`   Agent Mode: ${AGENT_MODE}`);
  console.log('');

  // Start broadcast session
  if (state.broadcast) {
    agentBroadcaster.startSession(state.sessionId, {
      input: input.input || input.message || 'RFP Automation',
      timestamp: new Date().toISOString(),
      agentMode: AGENT_MODE
    });
    agentBroadcaster.log('System', `🚀 Starting ${agentModeLabel} Workflow`, { 
      sessionId: state.sessionId,
      mode: AGENT_MODE 
    });
  }

  try {
    const result = await app.invoke(state);
    
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║     WORKFLOW COMPLETE                                            ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log(`\n⏱️  Total Execution Time: ${Date.now() - state.startTime}ms`);
    console.log(`📊 Agents Completed: ${result.completedAgents?.join(' → ') || 'N/A'}`);
    console.log(`🤖 Agent Mode: ${AGENT_MODE}`);
    
    // End broadcast session
    if (state.broadcast) {
      agentBroadcaster.log('System', '✅ Workflow Complete', {
        duration: Date.now() - state.startTime,
        agents: result.completedAgents,
        mode: AGENT_MODE
      });
      agentBroadcaster.endSession(result);
    }
    
    return result;
  } catch (error) {
    console.error('\n❌ Workflow Error:', error.message);
    
    if (state.broadcast) {
      agentBroadcaster.log('System', `❌ Workflow Error: ${error.message}`, { error: true });
      agentBroadcaster.endSession({ error: error.message });
    }
    
    throw error;
  }
}

/**
 * Run the workflow with a specific RFP ID
 * @param {Object} options - Options including rfpId, sessionId, etc.
 */
export async function runAgenticPipeline(options = {}) {
  return runGraphOnce(options);
}

/**
 * Get workflow statistics
 */
export function getWorkflowStats(result) {
  return {
    session_id: result.sessionId,
    duration_ms: Date.now() - result.startTime,
    agent_mode: AGENT_MODE,
    agents_completed: result.completedAgents,
    logs_count: result.logs?.length || 0,
    
    sales: {
      portals_scanned: result.scannedPortals?.length || 0,
      rfps_identified: result.identifiedRFPs?.length || result.parsedRFPs?.length || 0,
      rfp_selected: result.selectedRFP?.tender_id || null
    },
    
    technical: {
      products_matched: result.recommendedSKUs?.length || 0,
      avg_spec_match: result.recommendedSKUs?.length > 0
        ? Math.round(result.recommendedSKUs.reduce((s, r) => s + (r.spec_match_percentage || 0), 0) / result.recommendedSKUs.length)
        : 0
    },
    
    pricing: {
      material_cost: result.consolidatedPricing?.total_material_cost || 0,
      services_cost: result.consolidatedPricing?.total_test_cost || 0,
      grand_total: result.consolidatedPricing?.grand_total || 0
    }
  };
}

/**
 * Get current agent mode
 */
export function getAgentMode() {
  return AGENT_MODE;
}

/**
 * Check if LLM mode is enabled
 */
export function isLLMMode() {
  return AGENT_MODE === 'LLM';
}

export default {
  buildGraph,
  runGraphOnce,
  runAgenticPipeline,
  getWorkflowStats,
  getAgentMode,
  isLLMMode
};
