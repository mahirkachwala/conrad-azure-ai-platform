/**
 * Technical Agent (Worker Agent)
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Responsibilities (per EY guidelines):
 * 1. Receives summary RFP and RFP document from Main Agent
 * 2. Summarizes products in SCOPE OF SUPPLY
 * 3. Recommends TOP THREE OEM products for each RFP product
 * 4. Shows "Spec Match" metric (%) for each recommendation
 * 5. Recommendations come from repository of product datasheets
 * 6. Spec Match = closeness of OEM product to RFP specs (equal weightage)
 * 7. Prepares COMPARISON TABLE: RFP specs vs Top 1, 2, 3 OEM products
 * 8. Selects TOP OEM product for all items in scope
 * 9. Sends final table to Main Agent AND Pricing Agent
 */

import { pushLog, getAndClearNewLogs, storeAgentOutput, markAgentComplete } from "../state.js";
import { OEM_PRODUCT_CATALOG, getOEMProducts } from "../../services/oem-datasheets.js";
import { agentBroadcaster } from "../../services/agent-broadcast.js";

export async function TechnicalAgent(S) {
  const broadcast = S.broadcast !== false;
  
  // Helper to log and broadcast
  const logBroadcast = (msg, data = {}) => {
    pushLog(S, msg, "Technical");
    if (broadcast) agentBroadcaster.log('Technical', msg, data);
  };
  
  logBroadcast("");
  logBroadcast("═══════════════════════════════════════════════════════════════");
  logBroadcast("🔧 TECHNICAL AGENT: SKU Matching & Spec Analysis", { phase: 'start' });
  logBroadcast("═══════════════════════════════════════════════════════════════");

  // Verify we have context from Master Agent
  if (!S.technicalContext || !S.selectedRFP) {
    logBroadcast("⚠️ TechnicalAgent: No technical context received from Master Agent", { error: true });
    if (broadcast) agentBroadcaster.completeAgent('Technical', { error: 'no_context' });
    S.next = "end";
    return { ...S, logs: getAndClearNewLogs(S) };
  }

  const context = S.technicalContext;
  logBroadcast("");
  logBroadcast(`📋 Received context for RFP: ${context.rfp_id}`, { rfp_id: context.rfp_id });
  logBroadcast(`   Buyer: ${context.buyer}`);
  logBroadcast(`   Products in scope: ${context.scope_of_supply.length}`, { product_count: context.scope_of_supply.length });

  // ========================================
  // STEP 1: SUMMARIZE PRODUCTS IN SCOPE
  // ========================================
  logBroadcast("");
  logBroadcast("📦 Step 1: Summarizing products in Scope of Supply...", { step: 1 });
  
  S.scopeOfSupply = context.scope_of_supply;
  
  logBroadcast("");
  logBroadcast("┌────────────────────────────────────────────────────────────────┐");
  logBroadcast("│  SCOPE OF SUPPLY                                               │", { table: 'scope' });
  logBroadcast("├──────┬─────────────────────────────────────────────────────────┤");
  logBroadcast("│ Item │ Product Description                                     │");
  logBroadcast("├──────┼─────────────────────────────────────────────────────────┤");
  
  S.scopeOfSupply.forEach((product, idx) => {
    const itemNo = String(idx + 1).padStart(4);
    const desc = (product.description || '').substring(0, 55).padEnd(55);
    logBroadcast(`│ ${itemNo} │ ${desc} │`);
  });
  
  logBroadcast("└──────┴─────────────────────────────────────────────────────────┘");

  // ========================================
  // STEP 2: MATCH EACH PRODUCT TO TOP 3 SKUs
  // ========================================
  logBroadcast("");
  logBroadcast("🎯 Step 2: Matching RFP products to OEM SKUs (Top 3 recommendations)...", { step: 2, action: 'sku_matching' });
  
  const oemProducts = getOEMProducts();
  S.skuMatchResults = [];
  S.comparisonTables = [];
  
  for (const rfpProduct of S.scopeOfSupply) {
    logBroadcast("");
    logBroadcast(`   Processing: "${rfpProduct.description.substring(0, 50)}..."`, { product_id: rfpProduct.id });
    
    // Parse RFP product specifications
    const rfpSpecs = parseRFPSpecs(rfpProduct.description, rfpProduct.specifications);
    
    // Calculate Spec Match for all OEM products
    const matchedProducts = oemProducts.map(oem => {
      const specMatch = calculateSpecMatchMetric(rfpSpecs, oem.specifications);
      return {
        ...oem,
        spec_match_percentage: specMatch.percentage,
        spec_match_details: specMatch.details,
        matched_specs: specMatch.matched,
        unmatched_specs: specMatch.unmatched
      };
    });
    
    // Sort by Spec Match (descending) and take Top 3
    matchedProducts.sort((a, b) => b.spec_match_percentage - a.spec_match_percentage);
    const top3 = matchedProducts.slice(0, 3);
    
    // Store results
    const matchResult = {
      rfp_product_id: rfpProduct.id,
      rfp_product: rfpProduct.description,
      rfp_specs: rfpSpecs,
      top_3_matches: top3.map((match, rank) => ({
        rank: rank + 1,
        sku_id: match.sku_id,
        product_name: match.product_name,
        spec_match_percentage: match.spec_match_percentage,
        matched_specs: match.matched_specs,
        unmatched_specs: match.unmatched_specs,
        unit_price: match.unit_price_inr_per_km,
        lead_time_days: match.lead_time_days
      })),
      recommended_sku: top3[0]?.sku_id || null,
      recommended_spec_match: top3[0]?.spec_match_percentage || 0
    };
    
    S.skuMatchResults.push(matchResult);
    
    // Log top match
    if (top3.length > 0) {
      logBroadcast(`   ✓ Top match: ${top3[0].sku_id} (${top3[0].spec_match_percentage}% Spec Match)`, { 
        sku_id: top3[0].sku_id, 
        spec_match: top3[0].spec_match_percentage 
      });
    }
    
    // ========================================
    // STEP 3: PREPARE COMPARISON TABLE
    // ========================================
    const comparisonTable = generateComparisonTable(rfpProduct, rfpSpecs, top3);
    S.comparisonTables.push(comparisonTable);
  }

  // ========================================
  // STEP 4: DISPLAY COMPARISON TABLES
  // ========================================
  logBroadcast("");
  logBroadcast("📊 Step 3: Generating Spec Comparison Tables...", { step: 3, action: 'comparison_tables' });
  
  S.comparisonTables.forEach((table, idx) => {
    logBroadcast("");
    logBroadcast(`┌────────────────────────────────────────────────────────────────┐`);
    logBroadcast(`│  COMPARISON TABLE - Product ${idx + 1}                                 │`, { table: `comparison_${idx + 1}` });
    logBroadcast(`│  RFP: ${table.rfp_product.substring(0, 56).padEnd(56)} │`);
    logBroadcast(`├──────────────────┬──────────┬──────────┬──────────┬──────────┤`);
    logBroadcast(`│ Specification    │ RFP Req  │ OEM #1   │ OEM #2   │ OEM #3   │`);
    logBroadcast(`├──────────────────┼──────────┼──────────┼──────────┼──────────┤`);
    
    table.comparison_rows.forEach(row => {
      const spec = row.spec_name.substring(0, 16).padEnd(16);
      const rfpVal = String(row.rfp_value || '-').substring(0, 8).padEnd(8);
      const oem1 = String(row.oem_1_value || '-').substring(0, 8).padEnd(8);
      const oem2 = String(row.oem_2_value || '-').substring(0, 8).padEnd(8);
      const oem3 = String(row.oem_3_value || '-').substring(0, 8).padEnd(8);
      logBroadcast(`│ ${spec} │ ${rfpVal} │ ${oem1} │ ${oem2} │ ${oem3} │`);
    });
    
    logBroadcast(`├──────────────────┼──────────┼──────────┼──────────┼──────────┤`);
    logBroadcast(`│ SPEC MATCH %     │   ---    │ ${String(table.oem_1_match + '%').padStart(6).padEnd(8)} │ ${String(table.oem_2_match + '%').padStart(6).padEnd(8)} │ ${String(table.oem_3_match + '%').padStart(6).padEnd(8)} │`, {
      oem1_match: table.oem_1_match,
      oem2_match: table.oem_2_match,
      oem3_match: table.oem_3_match
    });
    logBroadcast(`└──────────────────┴──────────┴──────────┴──────────┴──────────┘`);
  });

  // ========================================
  // STEP 5: SELECT FINAL RECOMMENDED SKUs
  // ========================================
  logBroadcast("");
  logBroadcast("🏆 Step 4: Selecting final recommended SKUs (highest Spec Match)...", { step: 4, action: 'final_selection' });
  
  S.recommendedSKUs = S.skuMatchResults.map(result => {
    const topMatch = result.top_3_matches[0];
    return {
      rfp_product_id: result.rfp_product_id,
      rfp_product: result.rfp_product,
      sku_id: topMatch?.sku_id,
      product_name: topMatch?.product_name,
      spec_match_percentage: topMatch?.spec_match_percentage || 0,
      unit_price: topMatch?.unit_price || 0,
      lead_time_days: topMatch?.lead_time_days || 14,
      matched_specs: topMatch?.matched_specs || [],
      alternatives: result.top_3_matches.slice(1).map(m => ({
        sku_id: m.sku_id,
        spec_match: m.spec_match_percentage
      }))
    };
  });

  // Display final recommendations
  logBroadcast("");
  logBroadcast("╔════════════════════════════════════════════════════════════════╗");
  logBroadcast("║  FINAL SKU RECOMMENDATIONS                                     ║", { table: 'final_recommendations' });
  logBroadcast("╠═════════════════════════════╦═══════════════════╦══════════════╣");
  logBroadcast("║ RFP Product                 ║ Recommended SKU   ║ Spec Match   ║");
  logBroadcast("╠═════════════════════════════╬═══════════════════╬══════════════╣");
  
  S.recommendedSKUs.forEach(rec => {
    const product = (rec.rfp_product || '').substring(0, 27).padEnd(27);
    const sku = (rec.sku_id || 'N/A').padEnd(17);
    const match = `${rec.spec_match_percentage}%`.padStart(10);
    logBroadcast(`║ ${product} ║ ${sku} ║ ${match}   ║`, { sku_id: rec.sku_id, spec_match: rec.spec_match_percentage });
  });
  
  logBroadcast("╚═════════════════════════════╩═══════════════════╩══════════════╝");

  // Calculate average spec match
  const avgSpecMatch = S.recommendedSKUs.length > 0
    ? Math.round(S.recommendedSKUs.reduce((sum, r) => sum + r.spec_match_percentage, 0) / S.recommendedSKUs.length)
    : 0;

  // ========================================
  // STEP 6: PREPARE OUTPUT FOR MASTER & PRICING
  // ========================================
  const technicalOutput = {
    products_analyzed: S.scopeOfSupply.length,
    average_spec_match: avgSpecMatch,
    spec_match_methodology: "Equal weightage for all specifications",
    recommended_skus: S.recommendedSKUs,
    comparison_tables: S.comparisonTables,
    full_match_results: S.skuMatchResults
  };
  
  storeAgentOutput(S, 'technical', technicalOutput);
  markAgentComplete(S, 'Technical');

  logBroadcast("");
  logBroadcast(`✅ TechnicalAgent Complete:`, { status: 'complete' });
  logBroadcast(`   • Products matched: ${S.recommendedSKUs.length}`);
  logBroadcast(`   • Average Spec Match: ${avgSpecMatch}%`, { avg_spec_match: avgSpecMatch });
  logBroadcast(`   → Sending recommendations to Pricing Agent`);
  
  if (broadcast) agentBroadcaster.completeAgent('Technical', { avg_spec_match: avgSpecMatch, products: S.recommendedSKUs.length });

  S.next = "pricing";
  return { ...S, logs: getAndClearNewLogs(S) };
}

/**
 * Parse RFP product specifications from description
 */
function parseRFPSpecs(description, existingSpecs = {}) {
  const specs = { ...existingSpecs };
  const lower = description.toLowerCase();
  
  // Voltage Rating
  const kvMatch = lower.match(/(\d+(?:\.\d+)?)\s*kv/);
  if (kvMatch) {
    const kv = parseFloat(kvMatch[1]);
    specs.voltage_rating_v = kv >= 1 ? kv * 1000 : kv; // Convert to V
    specs.voltage_rating = kvMatch[0].toUpperCase();
  }
  
  // Number of Cores
  const coreMatch = lower.match(/(\d+)\s*(?:core|c\b)/);
  if (coreMatch) specs.no_of_cores = parseInt(coreMatch[1]);
  
  // Cross-section area
  const areaMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*mm|sqmm|mm2|mm²)/);
  if (areaMatch) specs.conductor_cross_section_mm2 = parseFloat(areaMatch[1]);
  
  // Conductor Material
  if (lower.includes('copper') || lower.includes(' cu ')) {
    specs.conductor_material = 'Copper';
  } else if (lower.includes('aluminium') || lower.includes('aluminum') || lower.includes(' al ')) {
    specs.conductor_material = 'Aluminium';
  }
  
  // Insulation Material
  if (lower.includes('xlpe')) specs.insulation_material = 'XLPE';
  else if (lower.includes('pvc')) specs.insulation_material = 'PVC';
  
  // Armour
  if (lower.includes('armoured') || lower.includes('armored') || lower.includes('swa')) {
    specs.armoured = true;
    specs.armour_type = 'Steel Wire Armoured (SWA)';
  } else if (lower.includes('unarmoured') || lower.includes('unarmored')) {
    specs.armoured = false;
  }
  
  // Temperature Rating
  const tempMatch = lower.match(/(\d+)\s*°?c/);
  if (tempMatch) specs.temperature_rating_c = parseInt(tempMatch[1]);
  
  return specs;
}

/**
 * Calculate Spec Match Metric
 * Formula: (Matched Specs / Total Specs) × 100
 * All specs have EQUAL WEIGHTAGE
 */
function calculateSpecMatchMetric(rfpSpecs, oemSpecs) {
  const specChecks = [
    {
      name: 'Voltage Rating',
      rfpKey: 'voltage_rating_v',
      oemKey: 'voltage_rating_v',
      match: (rfp, oem) => {
        if (!rfp || !oem) return null;
        if (rfp === oem) return true;
        // Allow ±10% tolerance
        return Math.abs(rfp - oem) / rfp <= 0.1;
      }
    },
    {
      name: 'Number of Cores',
      rfpKey: 'no_of_cores',
      oemKey: 'no_of_cores',
      match: (rfp, oem) => rfp === oem
    },
    {
      name: 'Cross-Section (mm²)',
      rfpKey: 'conductor_cross_section_mm2',
      oemKey: 'conductor_cross_section_mm2',
      match: (rfp, oem) => {
        if (!rfp || !oem) return null;
        if (rfp === oem) return true;
        // Allow ±15% tolerance for nearby sizes
        return Math.abs(rfp - oem) / rfp <= 0.15;
      }
    },
    {
      name: 'Conductor Material',
      rfpKey: 'conductor_material',
      oemKey: 'conductor_material',
      match: (rfp, oem) => {
        if (!rfp || !oem) return null;
        return rfp.toLowerCase() === oem.toLowerCase();
      }
    },
    {
      name: 'Insulation Material',
      rfpKey: 'insulation_material',
      oemKey: 'insulation_material',
      match: (rfp, oem) => {
        if (!rfp || !oem) return null;
        return rfp.toLowerCase() === oem.toLowerCase();
      }
    },
    {
      name: 'Armour Type',
      rfpKey: 'armoured',
      oemKey: 'armour_type',
      match: (rfp, oem) => {
        if (rfp === undefined) return null;
        const oemArmoured = oem && oem.toLowerCase().includes('armour');
        return rfp === oemArmoured;
      }
    },
    {
      name: 'Temperature Rating',
      rfpKey: 'temperature_rating_c',
      oemKey: 'temperature_rating_c',
      match: (rfp, oem) => {
        if (!rfp || !oem) return null;
        return oem >= rfp; // OEM should meet or exceed
      }
    }
  ];
  
  let totalSpecs = 0;
  let matchedSpecs = 0;
  const matched = [];
  const unmatched = [];
  const details = [];
  
  for (const check of specChecks) {
    const rfpValue = rfpSpecs[check.rfpKey];
    const oemValue = oemSpecs[check.oemKey];
    
    // Only count if RFP specifies this requirement
    if (rfpValue === undefined || rfpValue === null) continue;
    
    totalSpecs++;
    const result = check.match(rfpValue, oemValue);
    
    details.push({
      spec: check.name,
      rfp_value: rfpValue,
      oem_value: oemValue,
      matched: result === true
    });
    
    if (result === true) {
      matchedSpecs++;
      matched.push(check.name);
    } else {
      unmatched.push(check.name);
    }
  }
  
  // Calculate percentage (equal weightage)
  const percentage = totalSpecs > 0 ? Math.round((matchedSpecs / totalSpecs) * 100) : 0;
  
  return {
    percentage,
    matched_count: matchedSpecs,
    total_count: totalSpecs,
    matched,
    unmatched,
    details
  };
}

/**
 * Generate comparison table for RFP product vs Top 3 OEM products
 */
function generateComparisonTable(rfpProduct, rfpSpecs, top3OEM) {
  const specNames = [
    { key: 'voltage_rating_v', name: 'Voltage (V)', format: v => v ? `${v}V` : '-' },
    { key: 'no_of_cores', name: 'No. of Cores', format: v => v || '-' },
    { key: 'conductor_cross_section_mm2', name: 'Cross-Sec (mm²)', format: v => v ? `${v}` : '-' },
    { key: 'conductor_material', name: 'Conductor', format: v => v || '-' },
    { key: 'insulation_material', name: 'Insulation', format: v => v || '-' },
    { key: 'temperature_rating_c', name: 'Temp Rating', format: v => v ? `${v}°C` : '-' },
    { key: 'armour_type', name: 'Armour', format: v => v ? 'Yes' : 'No' }
  ];
  
  const rows = specNames.map(spec => ({
    spec_name: spec.name,
    rfp_value: spec.format(rfpSpecs[spec.key]),
    oem_1_value: spec.format(top3OEM[0]?.specifications?.[spec.key]),
    oem_2_value: spec.format(top3OEM[1]?.specifications?.[spec.key]),
    oem_3_value: spec.format(top3OEM[2]?.specifications?.[spec.key])
  }));
  
  return {
    rfp_product: rfpProduct.description,
    rfp_specs: rfpSpecs,
    oem_1_sku: top3OEM[0]?.sku_id || 'N/A',
    oem_1_match: top3OEM[0]?.spec_match_percentage || 0,
    oem_2_sku: top3OEM[1]?.sku_id || 'N/A',
    oem_2_match: top3OEM[1]?.spec_match_percentage || 0,
    oem_3_sku: top3OEM[2]?.sku_id || 'N/A',
    oem_3_match: top3OEM[2]?.spec_match_percentage || 0,
    comparison_rows: rows
  };
}
