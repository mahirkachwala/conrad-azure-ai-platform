/**
 * Master Agent (Main Orchestrator)
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Responsibilities (per EY guidelines):
 * 1. Prepares a summary of identified RFP to share with Technical and Pricing Agents
 * 2. The summary shared needs to be CONTEXTUAL to their roles
 * 3. Receives responses from Technical and Pricing Agents to consolidate
 * 4. Overall response contains: OEM SKUs, prices, and test costs
 * 5. Starts and ends the conversation
 */

import { pushLog, getAndClearNewLogs, storeAgentOutput, markAgentComplete } from "../state.js";
import { formatLakhsCrores, generateConsolidatedTable, tableToASCII } from "../../services/table-formatter.js";
import { agentBroadcaster } from "../../services/agent-broadcast.js";

export async function MasterAgent(S) {
  const broadcast = S.broadcast !== false;
  
  // Helper to log and broadcast
  const logBroadcast = (msg, data = {}) => {
    pushLog(S, msg, "Master");
    if (broadcast) agentBroadcaster.log('Master', msg, data);
  };
  
  // ========================================
  // PHASE 1: START - Initiate workflow
  // ========================================
  if (!S.selectedRFP && !S.consolidatedResponse) {
    logBroadcast("═══════════════════════════════════════════════════════════════");
    logBroadcast("🎯 MASTER AGENT: Initiating RFP Response Workflow", { phase: 'start' });
    logBroadcast("═══════════════════════════════════════════════════════════════");
    logBroadcast("📋 Step 1: Delegating to Sales Agent for RFP identification...", { action: 'delegate_to_sales' });
    
    S.next = "sales";
    return { ...S, logs: getAndClearNewLogs(S) };
  }
  
  // ========================================
  // PHASE 2: PREPARE CONTEXTUAL SUMMARIES
  // After Sales Agent returns with selected RFP
  // ========================================
  if (S.selectedRFP && !S.technicalContext && !S.pricingContext) {
    logBroadcast("");
    logBroadcast("═══════════════════════════════════════════════════════════════");
    logBroadcast("🎯 MASTER AGENT: Preparing Contextual Summaries for Worker Agents", { phase: 'prepare_context' });
    logBroadcast("═══════════════════════════════════════════════════════════════");
    
    const rfp = S.selectedRFP;
    
    // ----------------------------------------
    // MASTER SUMMARY (Overall RFP understanding)
    // ----------------------------------------
    S.masterSummary = {
      rfp_id: rfp.tender_id || rfp.rfp_id,
      buyer_organization: rfp.organisation || rfp.buyer,
      project_title: rfp.title,
      submission_deadline: rfp.due_date,
      estimated_value: rfp.estimated_cost_inr,
      source_portal: rfp.source_type || 'government',
      material_category: rfp.material || rfp.product_category,
      location: rfp.city
    };
    
    logBroadcast(`📄 RFP Summary Prepared:`, { rfp: S.masterSummary });
    logBroadcast(`   • RFP ID: ${S.masterSummary.rfp_id}`);
    logBroadcast(`   • Buyer: ${S.masterSummary.buyer_organization}`);
    logBroadcast(`   • Project: ${S.masterSummary.project_title}`);
    logBroadcast(`   • Deadline: ${S.masterSummary.submission_deadline}`);
    logBroadcast(`   • Est. Value: ${formatLakhsCrores(S.masterSummary.estimated_value)}`);
    
    // ----------------------------------------
    // TECHNICAL CONTEXT (Products in scope)
    // For Technical Agent - CONTEXTUAL to their role
    // ----------------------------------------
    S.technicalContext = {
      task: "Match RFP product requirements to OEM SKUs",
      rfp_id: S.masterSummary.rfp_id,
      buyer: S.masterSummary.buyer_organization,
      
      // Products in scope of supply (extracted from RFP)
      scope_of_supply: extractScopeOfSupply(rfp),
      
      // Technical specifications to match
      specifications_to_match: [
        "Voltage Rating",
        "Number of Cores", 
        "Conductor Cross-Section (mm²)",
        "Conductor Material (Cu/Al)",
        "Insulation Material (XLPE/PVC)",
        "Armour Type",
        "Temperature Rating",
        "Standard Compliance (IS/IEC)"
      ],
      
      // Instructions
      instructions: [
        "For each product in scope of supply, recommend TOP 3 matching OEM SKUs",
        "Calculate Spec Match metric (%) for each recommendation",
        "Spec Match = (Matched Specs / Total Specs) × 100",
        "All specs have EQUAL weightage in matching",
        "Prepare comparison table: RFP Specs vs Top 3 OEM recommendations",
        "Select final recommended SKU based on highest Spec Match"
      ]
    };
    
    logBroadcast("");
    logBroadcast("📦 TECHNICAL CONTEXT (for Technical Agent):", { context: 'technical' });
    logBroadcast(`   • Products in scope: ${S.technicalContext.scope_of_supply.length} items`);
    S.technicalContext.scope_of_supply.forEach((product, idx) => {
      logBroadcast(`   ${idx + 1}. ${product.description}`);
    });
    
    // ----------------------------------------
    // PRICING CONTEXT (Tests & Acceptance)
    // For Pricing Agent - CONTEXTUAL to their role
    // ----------------------------------------
    S.pricingContext = {
      task: "Calculate pricing for products and required tests",
      rfp_id: S.masterSummary.rfp_id,
      buyer: S.masterSummary.buyer_organization,
      
      // Test requirements from RFP
      test_requirements: extractTestRequirements(rfp),
      
      // Acceptance test requirements
      acceptance_tests: extractAcceptanceTests(rfp),
      
      // Instructions
      instructions: [
        "Receive product recommendations from Technical Agent",
        "Assign unit price for each recommended SKU from pricing table",
        "Assign price for each required test from services pricing table",
        "Calculate total material price per product",
        "Calculate total services/test price per product",
        "Consolidate total pricing: Material + Services + Tests"
      ]
    };
    
    logBroadcast("");
    logBroadcast("🧪 PRICING CONTEXT (for Pricing Agent):", { context: 'pricing' });
    logBroadcast(`   • Routine Tests Required: ${S.pricingContext.test_requirements.filter(t => t.category === 'Routine').length}`);
    logBroadcast(`   • Type Tests Required: ${S.pricingContext.test_requirements.filter(t => t.category === 'Type').length}`);
    logBroadcast(`   • Acceptance Tests Required: ${S.pricingContext.acceptance_tests.length}`);
    
    logBroadcast("");
    logBroadcast("📋 Step 2: Delegating to Technical Agent for SKU matching...", { action: 'delegate_to_technical' });
    
    if (broadcast) agentBroadcaster.completeAgent('Master', { phase: 'context_prepared' });
    
    S.next = "technical";
    return { ...S, logs: getAndClearNewLogs(S) };
  }
  
  // ========================================
  // PHASE 3: CONSOLIDATE FINAL RESPONSE
  // After Technical and Pricing Agents complete
  // ========================================
  if (S.recommendedSKUs && S.recommendedSKUs.length > 0 && S.consolidatedPricing) {
    logBroadcast("");
    logBroadcast("═══════════════════════════════════════════════════════════════");
    logBroadcast("🎯 MASTER AGENT: Consolidating Final RFP Response", { phase: 'consolidate' });
    logBroadcast("═══════════════════════════════════════════════════════════════");
    
    // Build consolidated response (EY required format)
    S.consolidatedResponse = {
      rfp_info: S.masterSummary,
      
      // OEM Product SKUs suggested
      recommended_skus: S.recommendedSKUs.map(sku => ({
        rfp_product: sku.rfp_product,
        sku_id: sku.sku_id,
        sku_name: sku.product_name,
        spec_match_percentage: sku.spec_match_percentage,
        unit_price_inr: sku.unit_price
      })),
      
      // Prices (from Pricing Agent)
      pricing: {
        total_material_cost: S.consolidatedPricing.total_material_cost,
        total_test_cost: S.consolidatedPricing.total_test_cost,
        total_services_cost: S.consolidatedPricing.total_services_cost || 0,
        subtotal: S.consolidatedPricing.subtotal,
        gst_18_percent: S.consolidatedPricing.gst,
        grand_total: S.consolidatedPricing.grand_total
      },
      
      // Test costs (from Pricing Agent)
      tests_included: S.consolidatedPricing.tests_included || [],
      
      // Summary metrics
      summary: {
        total_products: S.recommendedSKUs.length,
        average_spec_match: Math.round(
          S.recommendedSKUs.reduce((sum, s) => sum + s.spec_match_percentage, 0) / S.recommendedSKUs.length
        ),
        lead_time_days: Math.max(...S.recommendedSKUs.map(s => s.lead_time_days || 14)),
        bid_value: S.consolidatedPricing.grand_total
      },
      
      // Timestamps
      generated_at: new Date().toISOString(),
      workflow_duration_ms: Date.now() - S.startTime
    };
    
    // ----------------------------------------
    // PRINT FINAL CONSOLIDATED TABLE
    // ----------------------------------------
    logBroadcast("");
    logBroadcast("╔══════════════════════════════════════════════════════════════╗");
    logBroadcast("║         CONSOLIDATED RFP RESPONSE - FINAL OUTPUT             ║", { output: 'final' });
    logBroadcast("╚══════════════════════════════════════════════════════════════╝");
    
    // RFP Details
    logBroadcast("");
    logBroadcast(`📋 RFP: ${S.consolidatedResponse.rfp_info.rfp_id}`, { rfp_id: S.consolidatedResponse.rfp_info.rfp_id });
    logBroadcast(`   Buyer: ${S.consolidatedResponse.rfp_info.buyer_organization}`);
    logBroadcast(`   Project: ${S.consolidatedResponse.rfp_info.project_title}`);
    logBroadcast(`   Deadline: ${S.consolidatedResponse.rfp_info.submission_deadline}`);
    
    // SKU Recommendations Table
    logBroadcast("");
    logBroadcast("┌────────────────────────────────────────────────────────────────┐");
    logBroadcast("│  RECOMMENDED OEM PRODUCT SKUs                                   │", { table: 'sku_recommendations' });
    logBroadcast("├─────────────────────────┬───────────────────┬──────────┬────────┤");
    logBroadcast("│ RFP Product             │ Recommended SKU   │ Spec %   │ Price  │");
    logBroadcast("├─────────────────────────┼───────────────────┼──────────┼────────┤");
    
    S.consolidatedResponse.recommended_skus.forEach(sku => {
      const product = (sku.rfp_product || '').substring(0, 22).padEnd(22);
      const skuId = (sku.sku_id || '').substring(0, 16).padEnd(16);
      const specMatch = `${sku.spec_match_percentage}%`.padStart(6);
      const price = formatLakhsCrores(sku.unit_price_inr).padStart(8);
      logBroadcast(`│ ${product} │ ${skuId} │ ${specMatch} │${price}│`, { sku: sku.sku_id, spec_match: sku.spec_match_percentage });
    });
    
    logBroadcast("└─────────────────────────┴───────────────────┴──────────┴────────┘");
    
    // Pricing Summary
    logBroadcast("");
    logBroadcast("┌────────────────────────────────────────────────────────────────┐");
    logBroadcast("│  PRICING SUMMARY                                               │", { table: 'pricing_summary' });
    logBroadcast("├────────────────────────────────────────────────────────────────┤");
    logBroadcast(`│  Material Cost:          ${formatLakhsCrores(S.consolidatedResponse.pricing.total_material_cost).padStart(20)} │`);
    logBroadcast(`│  Test/Services Cost:     ${formatLakhsCrores(S.consolidatedResponse.pricing.total_test_cost).padStart(20)} │`);
    logBroadcast(`│  ──────────────────────────────────────────────────────────── │`);
    logBroadcast(`│  Subtotal:               ${formatLakhsCrores(S.consolidatedResponse.pricing.subtotal).padStart(20)} │`);
    logBroadcast(`│  GST (18%):              ${formatLakhsCrores(S.consolidatedResponse.pricing.gst_18_percent).padStart(20)} │`);
    logBroadcast(`│  ════════════════════════════════════════════════════════════ │`);
    logBroadcast(`│  GRAND TOTAL:            ${formatLakhsCrores(S.consolidatedResponse.pricing.grand_total).padStart(20)} │`, { grand_total: S.consolidatedResponse.pricing.grand_total });
    logBroadcast("└────────────────────────────────────────────────────────────────┘");
    
    // Summary Metrics
    logBroadcast("");
    logBroadcast("📊 RESPONSE SUMMARY:", { summary: S.consolidatedResponse.summary });
    logBroadcast(`   • Products Matched: ${S.consolidatedResponse.summary.total_products}`);
    logBroadcast(`   • Average Spec Match: ${S.consolidatedResponse.summary.average_spec_match}%`);
    logBroadcast(`   • Max Lead Time: ${S.consolidatedResponse.summary.lead_time_days} days`);
    logBroadcast(`   • Recommended Bid: ${formatLakhsCrores(S.consolidatedResponse.summary.bid_value)}`);
    logBroadcast(`   • Workflow Duration: ${S.consolidatedResponse.workflow_duration_ms}ms`);
    
    logBroadcast("");
    logBroadcast("═══════════════════════════════════════════════════════════════");
    logBroadcast("✅ MASTER AGENT: RFP Response Workflow Complete", { status: 'complete' });
    logBroadcast("═══════════════════════════════════════════════════════════════");
    
    if (broadcast) agentBroadcaster.completeAgent('Master', S.consolidatedResponse);
    
    // Store output
    storeAgentOutput(S, 'master', S.consolidatedResponse);
    markAgentComplete(S, 'Master');
    
    S.next = "end";
    return { ...S, logs: getAndClearNewLogs(S) };
  }
  
  // Default: continue to next agent
  S.next = "sales";
  return { ...S, logs: getAndClearNewLogs(S) };
}

/**
 * Extract products in scope of supply from RFP
 * NEW: Now uses buyer_requirements from Sales Agent's PDF extraction
 */
function extractScopeOfSupply(rfp) {
  const products = [];
  
  // ========================================
  // NEW: Check for buyer_requirements from PDF extraction
  // This is the structured data from Sales Agent
  // ========================================
  if (rfp.buyer_requirements && Array.isArray(rfp.buyer_requirements) && rfp.buyer_requirements.length > 0) {
    rfp.buyer_requirements.forEach((req, idx) => {
      products.push({
        id: `P${String(idx + 1).padStart(3, '0')}`,
        item_no: req.item_no || String(idx + 1),
        description: req.description || buildDescription(req),
        cable_type: req.cable_type || 'Power Cable',
        quantity_km: req.quantity_km || req.qty_km || 5,
        specifications: {
          voltage_rating_v: parseVoltage(req.voltage_kv || req.voltage),
          no_of_cores: parseInt(req.no_of_cores || req.cores) || 4,
          conductor_cross_section_mm2: parseFloat(req.cross_section_sqmm || req.size) || 95,
          conductor_material: req.conductor_material || req.conductor || 'Aluminium',
          insulation_material: req.insulation || 'XLPE',
          armoured: req.armoured === true || (req.armoured || '').toString().toLowerCase().includes('armour'),
          standard: req.standard || 'IS 7098'
        }
      });
    });
    
    return products;
  }
  
  // ========================================
  // Fallback: Parse from title and material fields (legacy format)
  // ========================================
  const title = rfp.title || rfp.project_name || '';
  const material = rfp.material || '';
  
  // Try to extract from material description
  if (material) {
    products.push({
      id: 'P001',
      description: material,
      quantity_km: 50,
      specifications: parseProductSpecs(material)
    });
  }
  
  // If no products extracted, create from title
  if (products.length === 0 && title) {
    products.push({
      id: 'P001',
      description: title,
      quantity_km: 50,
      specifications: parseProductSpecs(title)
    });
  }
  
  // Add default test product if still empty
  if (products.length === 0) {
    products.push({
      id: 'P001',
      description: '3 Core 95 sq.mm Copper XLPE 11kV HT Cable Armoured',
      quantity_km: 50,
      specifications: {
        voltage_rating_v: 11000,
        no_of_cores: 3,
        conductor_cross_section_mm2: 95,
        conductor_material: 'Copper',
        insulation_material: 'XLPE',
        armoured: true
      }
    });
  }
  
  return products;
}

/**
 * Build description from requirement object
 */
function buildDescription(req) {
  const parts = [];
  if (req.cable_type) parts.push(req.cable_type);
  if (req.no_of_cores || req.cores) parts.push(`${req.no_of_cores || req.cores}C`);
  if (req.cross_section_sqmm || req.size) parts.push(`${req.cross_section_sqmm || req.size}`);
  if (req.conductor_material || req.conductor) parts.push(req.conductor_material || req.conductor);
  if (req.insulation) parts.push(req.insulation);
  if (req.voltage_kv || req.voltage) parts.push(req.voltage_kv || req.voltage);
  return parts.join(' x ') || 'Power Cable';
}

/**
 * Parse voltage string to volts
 */
function parseVoltage(voltageStr) {
  if (!voltageStr) return 1100;
  const str = String(voltageStr).toLowerCase();
  const match = str.match(/([\d.]+)/);
  if (match) {
    const val = parseFloat(match[1]);
    if (str.includes('kv')) return val * 1000;
    return val;
  }
  return 1100;
}

/**
 * Parse product specifications from description text
 */
function parseProductSpecs(text) {
  const specs = {};
  const lower = text.toLowerCase();
  
  // Voltage
  const kvMatch = lower.match(/(\d+(?:\.\d+)?)\s*kv/);
  if (kvMatch) specs.voltage_rating = `${kvMatch[1]}kV`;
  
  // Cores
  const coreMatch = lower.match(/(\d+)\s*(?:core|c\b)/);
  if (coreMatch) specs.no_of_cores = parseInt(coreMatch[1]);
  
  // Cross-section
  const areaMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*mm|sqmm|mm2)/);
  if (areaMatch) specs.conductor_cross_section = parseFloat(areaMatch[1]);
  
  // Material
  if (lower.includes('copper') || lower.includes(' cu ')) specs.conductor_material = 'Copper';
  if (lower.includes('aluminium') || lower.includes('aluminum')) specs.conductor_material = 'Aluminium';
  
  // Insulation
  if (lower.includes('xlpe')) specs.insulation_material = 'XLPE';
  if (lower.includes('pvc')) specs.insulation_material = 'PVC';
  
  // Armour
  if (lower.includes('armoured') || lower.includes('armored') || lower.includes('swa')) {
    specs.armoured = true;
  }
  
  return specs;
}

/**
 * Extract test requirements from RFP
 * NEW: Uses tests_required from Sales Agent's PDF extraction
 */
function extractTestRequirements(rfp) {
  // ========================================
  // NEW: Check for tests_required from PDF extraction
  // ========================================
  if (rfp.tests_required && Array.isArray(rfp.tests_required) && rfp.tests_required.length > 0) {
    return rfp.tests_required.map((test, idx) => ({
      test_id: `T${String(idx + 1).padStart(3, '0')}`,
      name: test.name || test,
      category: test.type || test.category || 'Routine',
      mandatory: test.mandatory !== false,
      standard: test.standard || ''
    }));
  }
  
  // ========================================
  // Fallback: Standard tests required for cables
  // ========================================
  return [
    { test_id: 'RT-001', name: 'Conductor Resistance Test', category: 'Routine', standard: 'IS 8130' },
    { test_id: 'RT-002', name: 'High Voltage Test', category: 'Routine', standard: 'IS 7098' },
    { test_id: 'RT-003', name: 'Insulation Resistance Test', category: 'Routine', standard: 'IS 10810' },
    { test_id: 'TT-001', name: 'Partial Discharge Test', category: 'Type', standard: 'IEC 60885' },
    { test_id: 'TT-003', name: 'Bending Test', category: 'Type', standard: 'IS 7098' },
    { test_id: 'TT-004', name: 'Tensile Strength Test', category: 'Type', standard: 'IS 5831' }
  ];
}

/**
 * Extract acceptance test requirements from RFP
 */
function extractAcceptanceTests(rfp) {
  // Standard acceptance tests at project site
  return [
    { test_id: 'AT-001', name: 'Drum Test (Site)', category: 'Acceptance' },
    { test_id: 'AT-002', name: 'Continuity Test (Site)', category: 'Acceptance' },
    { test_id: 'AT-003', name: 'IR Test After Laying', category: 'Acceptance' },
    { test_id: 'AT-004', name: 'HV Test After Laying', category: 'Acceptance' }
  ];
}
