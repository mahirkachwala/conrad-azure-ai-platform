/**
 * Agentic Tools Index
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Central export for all LangChain tools used by agents.
 */

import { searchTools } from './search-tools.js';
import { analysisTools } from './analysis-tools.js';
import { pricingTools } from './pricing-tools.js';

// Re-export individual tool sets
export { searchTools } from './search-tools.js';
export { analysisTools } from './analysis-tools.js';
export { pricingTools } from './pricing-tools.js';

// Combined tools by agent role
export const salesAgentTools = [
  ...searchTools,
  // Include PDF extraction from analysis
  analysisTools.find(t => t.name === 'extract_pdf_data')
].filter(Boolean);

export const technicalAgentTools = [
  ...analysisTools
];

export const pricingAgentTools = [
  ...pricingTools
];

export const masterAgentTools = [
  // Master has access to high-level tools only
  searchTools.find(t => t.name === 'get_portal_stats'),
  pricingTools.find(t => t.name === 'format_currency')
].filter(Boolean);

// All tools combined
export const allTools = [
  ...searchTools,
  ...analysisTools,
  ...pricingTools
];

// Tool registry for dynamic lookup
export const toolRegistry = {
  // Search tools
  search_portals: searchTools.find(t => t.name === 'search_portals'),
  get_rfp_details: searchTools.find(t => t.name === 'get_rfp_details'),
  calculate_rfp_score: searchTools.find(t => t.name === 'calculate_rfp_score'),
  get_portal_stats: searchTools.find(t => t.name === 'get_portal_stats'),
  
  // Analysis tools
  extract_pdf_data: analysisTools.find(t => t.name === 'extract_pdf_data'),
  semantic_product_search: analysisTools.find(t => t.name === 'semantic_product_search'),
  match_specifications: analysisTools.find(t => t.name === 'match_specifications'),
  get_product_schema: analysisTools.find(t => t.name === 'get_product_schema'),
  find_top_matches: analysisTools.find(t => t.name === 'find_top_matches'),
  
  // Pricing tools
  get_product_price: pricingTools.find(t => t.name === 'get_product_price'),
  calculate_line_item_price: pricingTools.find(t => t.name === 'calculate_line_item_price'),
  get_test_prices: pricingTools.find(t => t.name === 'get_test_prices'),
  generate_quotation: pricingTools.find(t => t.name === 'generate_quotation'),
  format_currency: pricingTools.find(t => t.name === 'format_currency')
};

/**
 * Get tools for a specific agent
 * @param {string} agentName - Agent name (master, sales, technical, pricing)
 * @returns {Array} Array of tools for the agent
 */
export function getToolsForAgent(agentName) {
  switch (agentName.toLowerCase()) {
    case 'master':
      return masterAgentTools;
    case 'sales':
      return salesAgentTools;
    case 'technical':
      return technicalAgentTools;
    case 'pricing':
      return pricingAgentTools;
    default:
      return allTools;
  }
}

/**
 * Get tool by name
 * @param {string} toolName - Tool name
 * @returns {Object|null} Tool object or null if not found
 */
export function getToolByName(toolName) {
  return toolRegistry[toolName] || null;
}

/**
 * List all available tools
 * @returns {Array} Array of tool names and descriptions
 */
export function listTools() {
  return allTools.map(t => ({
    name: t.name,
    description: t.description
  }));
}

export default {
  searchTools,
  analysisTools,
  pricingTools,
  salesAgentTools,
  technicalAgentTools,
  pricingAgentTools,
  masterAgentTools,
  allTools,
  toolRegistry,
  getToolsForAgent,
  getToolByName,
  listTools
};



