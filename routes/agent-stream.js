/**
 * Agent Stream API Routes
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Provides workflow simulation and state endpoints for agent visualization.
 */

import express from 'express';

export const agentStreamRouter = express.Router();

// Simple in-memory state
const logs = [];
let currentSession = null;

/**
 * Add a log entry
 */
function addLog(agent, message, data = {}) {
  const entry = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    agent,
    message,
    data
  };
  logs.push(entry);
  return entry;
}

/**
 * GET /api/agent-stream/state
 */
agentStreamRouter.get('/state', (req, res) => {
  res.json({
    ok: true,
    session: currentSession,
    logsCount: logs.length,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/agent-stream/logs
 */
agentStreamRouter.get('/logs', (req, res) => {
  res.json({
    ok: true,
    logs: logs.slice(-50),
    count: logs.length,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/agent-stream/run
 * Run agent workflow simulation
 */
agentStreamRouter.post('/run', async (req, res) => {
  const { query = 'RFP Analysis', mode = 'auto' } = req.body || {};
  const sessionId = `session-${Date.now()}`;
  
  try {
    currentSession = sessionId;
    logs.length = 0; // Clear logs for new session
    
    // Simulate the agentic workflow with real steps
    addLog('System', `🚀 Starting workflow for query: "${query}"`, { sessionId });
    
    // Master Agent
    addLog('Master', '═══════════════════════════════════════════════════════════════');
    addLog('Master', '🎯 MASTER AGENT: Initiating RFP Response Workflow');
    addLog('Master', '═══════════════════════════════════════════════════════════════');
    addLog('Master', '📋 Step 1: Delegating to Sales Agent for RFP identification...');
    
    await delay(300);
    
    // Sales Agent
    addLog('Sales', '═══════════════════════════════════════════════════════════════');
    addLog('Sales', '📊 SALES AGENT: Scanning Tender Portals for RFPs');
    addLog('Sales', '═══════════════════════════════════════════════════════════════');
    addLog('Sales', '🔍 Scanning predefined portal URLs...');
    addLog('Sales', '   ✓ Scanned: Government Procurement Portal');
    addLog('Sales', '   ✓ Scanned: Industrial Supply Network');
    addLog('Sales', '   ✓ Scanned: Utilities & Infrastructure Hub');
    
    await delay(300);
    
    addLog('Sales', '📅 Filtering RFPs due within 90 days...');
    addLog('Sales', '✅ SalesAgent: RFP selected and summarized');
    
    await delay(300);
    
    // Technical Agent
    addLog('Technical', '═══════════════════════════════════════════════════════════════');
    addLog('Technical', '🔧 TECHNICAL AGENT: SKU Matching & Spec Analysis');
    addLog('Technical', '═══════════════════════════════════════════════════════════════');
    addLog('Technical', '📦 Summarizing products in Scope of Supply...');
    addLog('Technical', '🎯 Matching RFP products to OEM SKUs...');
    addLog('Technical', '✅ TechnicalAgent Complete');
    
    await delay(300);
    
    // Pricing Agent
    addLog('Pricing', '═══════════════════════════════════════════════════════════════');
    addLog('Pricing', '💰 PRICING AGENT: Material & Services Cost Calculation');
    addLog('Pricing', '═══════════════════════════════════════════════════════════════');
    addLog('Pricing', '📦 Assigning unit prices from Product Pricing Table...');
    addLog('Pricing', '🧪 Assigning test prices from Services Pricing Table...');
    addLog('Pricing', '✅ PricingAgent Complete');
    
    await delay(300);
    
    // Final consolidation
    addLog('Master', '═══════════════════════════════════════════════════════════════');
    addLog('Master', '🎯 MASTER AGENT: Consolidating Final RFP Response');
    addLog('Master', '═══════════════════════════════════════════════════════════════');
    addLog('Master', '✅ MASTER AGENT: RFP Response Workflow Complete');
    
    res.json({
      ok: true,
      sessionId,
      result: {
        rfp_id: 'WORKFLOW-COMPLETE',
        spec_match: 87,
        grand_total: 50200000,
        products_matched: 1
      }
    });
    
  } catch (err) {
    console.error('Agent stream run error:', err);
    addLog('System', `❌ Error: ${err.message}`, { error: true });
    
    res.status(500).json({
      ok: false,
      error: err.message,
      sessionId
    });
  }
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default agentStreamRouter;
