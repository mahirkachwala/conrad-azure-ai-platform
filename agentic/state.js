/**
 * Agent State Management
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Defines the shared state structure for all agents in the workflow.
 * State flows: Master → Sales → Technical → Pricing → Master (consolidation)
 */

export const initialState = () => ({
  // Session tracking
  sessionId: null,
  input: null,
  startTime: Date.now(),
  
  // ========================================
  // MASTER AGENT STATE
  // ========================================
  masterSummary: null,           // Overall RFP summary
  technicalContext: null,        // Contextual summary for Technical Agent (products)
  pricingContext: null,          // Contextual summary for Pricing Agent (tests)
  consolidatedResponse: null,    // Final consolidated RFP response
  
  // ========================================
  // SALES AGENT STATE
  // ========================================
  scannedPortals: [],            // URLs scanned by Sales Agent
  identifiedRFPs: [],            // All RFPs found (due in 3 months)
  selectedRFP: null,             // The one RFP selected for response
  rfpData: null,                 // Full RFP data
  
  // ========================================
  // TECHNICAL AGENT STATE
  // ========================================
  specsData: null,               // Parsed RFP specifications
  scopeOfSupply: [],             // Products in RFP scope of supply
  skuMatchResults: [],           // SKU matching results with Spec Match %
  comparisonTables: [],          // Comparison tables (RFP vs Top 3 OEM)
  recommendedSKUs: [],           // Final recommended SKUs for each product
  
  // ========================================
  // PRICING AGENT STATE
  // ========================================
  testRequirements: [],          // Tests required from RFP
  productPricingTable: [],       // Unit prices for products
  servicesPricingTable: [],      // Prices for tests/services
  consolidatedPricing: null,     // Total material + services pricing
  
  // ========================================
  // AGENT COMMUNICATION
  // ========================================
  logs: [],                      // Agent activity logs
  agentOutputs: {                // Structured outputs from each agent
    master: null,
    sales: null,
    technical: null,
    pricing: null
  },
  
  // Workflow control
  next: "sales",
  errors: [],
  completedAgents: []
});

/**
 * Push a log message to state
 */
export const pushLog = (S, msg, agent = null) => { 
  const logEntry = { 
    t: Date.now(), 
    msg,
    agent: agent || detectAgent(msg)
  };
  if (!S._newLogs) S._newLogs = [];
  S._newLogs.push(logEntry);
  console.log(`[${logEntry.agent || 'System'}] ${msg}`);
};

/**
 * Get and clear new logs
 */
export const getAndClearNewLogs = (S) => {
  const newLogs = S._newLogs || [];
  S._newLogs = [];
  return newLogs;
};

/**
 * Detect agent from log message prefix
 */
function detectAgent(msg) {
  if (msg.includes('MasterAgent')) return 'Master';
  if (msg.includes('SalesAgent')) return 'Sales';
  if (msg.includes('TechnicalAgent')) return 'Technical';
  if (msg.includes('PricingAgent')) return 'Pricing';
  return 'System';
}

/**
 * Mark agent as completed
 */
export const markAgentComplete = (S, agentName) => {
  if (!S.completedAgents.includes(agentName)) {
    S.completedAgents.push(agentName);
  }
};

/**
 * Store agent output
 */
export const storeAgentOutput = (S, agentName, output) => {
  S.agentOutputs[agentName.toLowerCase()] = {
    timestamp: new Date().toISOString(),
    ...output
  };
};
