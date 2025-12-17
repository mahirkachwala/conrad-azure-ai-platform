/**
 * Unified Agent System
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * This module consolidates both the LangGraph-based and class-based
 * agent implementations into a single unified interface.
 * 
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────┐
 * │                    Master Agent                      │
 * │              (Orchestration & Control)              │
 * └─────────────────────────────────────────────────────┘
 *                          │
 *           ┌──────────────┼──────────────┐
 *           ▼              ▼              ▼
 *    ┌───────────┐  ┌───────────┐  ┌───────────┐
 *    │   Sales   │  │ Technical │  │  Pricing  │
 *    │   Agent   │→ │   Agent   │→ │   Agent   │
 *    └───────────┘  └───────────┘  └───────────┘
 */

// Export class-based agents (primary implementation)
export { BaseAgent } from '../services/agents/base-agent.js';
export { MasterAgent } from '../services/agents/master-agent.js';
export { SalesAgent } from '../services/agents/sales-agent.js';
export { TechnicalAgent } from '../services/agents/technical-agent.js';
export { PricingAgent } from '../services/agents/pricing-agent.js';

// Export LangGraph-based workflow (for graph visualization & streaming)
export { buildGraph, runGraphOnce } from '../agentic/graph.js';
export { initialState, pushLog, getAndClearNewLogs } from '../agentic/state.js';
export { Tools as AgentTools } from '../agentic/tools.js';

/**
 * Unified Agent Runner
 * Provides a single interface for running the complete RFP workflow
 */
export class AgentPipeline {
  constructor() {
    this.masterAgent = null;
  }
  
  /**
   * Initialize agents (lazy loading)
   */
  async init() {
    const { MasterAgent } = await import('../services/agents/master-agent.js');
    this.masterAgent = new MasterAgent();
    return this;
  }
  
  /**
   * Run complete RFP response workflow
   * @param {Array} tenders - List of tender objects
   * @returns {Object} Complete workflow result
   */
  async runRFPWorkflow(tenders) {
    if (!this.masterAgent) {
      await this.init();
    }
    return await this.masterAgent.executeRFPWorkflow(tenders);
  }
  
  /**
   * Get current workflow status
   */
  getStatus() {
    return this.masterAgent?.getWorkflowStatus() || null;
  }
  
  /**
   * Run using LangGraph (alternative execution mode)
   * Useful for streaming/real-time updates
   */
  async runWithLangGraph(input = {}) {
    const { runGraphOnce } = await import('../agentic/graph.js');
    return await runGraphOnce(input);
  }
}

// Export singleton for convenience
export const pipeline = new AgentPipeline();

export default {
  AgentPipeline,
  pipeline,
  // Re-export for backward compatibility
  MasterAgent: async () => (await import('../services/agents/master-agent.js')).MasterAgent,
  SalesAgent: async () => (await import('../services/agents/sales-agent.js')).SalesAgent,
  TechnicalAgent: async () => (await import('../services/agents/technical-agent.js')).TechnicalAgent,
  PricingAgent: async () => (await import('../services/agents/pricing-agent.js')).PricingAgent
};











