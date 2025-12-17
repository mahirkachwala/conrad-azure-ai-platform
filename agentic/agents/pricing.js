/**
 * Pricing Agent (Worker Agent)
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Responsibilities (per EY guidelines):
 * 1. Receives summary of tests and acceptance tests from Main Agent
 * 2. Receives product recommendation table from Technical Agent
 * 3. Assigns UNIT PRICE for each product from dummy pricing table
 * 4. Assigns PRICE for each test from dummy services price table
 * 5. Consolidates TOTAL MATERIAL PRICE and SERVICES PRICE
 * 6. Sends consolidated price table to Main Agent
 * 
 * Enhanced features:
 * - Market value benchmarks for realistic pricing
 * - Counter offers at or below market value (never above)
 * - Test costs scaled proportionally to project value
 * - Detailed pricing analysis with savings potential
 */

import { pushLog, getAndClearNewLogs, storeAgentOutput, markAgentComplete } from "../state.js";
import { SERVICES_PRICING_TABLE, getOEMProducts, getApplicableTests } from "../../services/oem-datasheets.js";
import { formatINR, formatLakhsCrores } from "../../services/table-formatter.js";
import { agentBroadcaster } from "../../services/agent-broadcast.js";
import { 
  getMarketValueBenchmark, 
  analyzeQuotedPrice, 
  calculateScaledTestCosts 
} from "../../services/pricing-analysis.js";

export async function PricingAgent(S) {
  const broadcast = S.broadcast !== false;
  
  // Helper to log and broadcast
  const logBroadcast = (msg, data = {}) => {
    pushLog(S, msg, "Pricing");
    if (broadcast) agentBroadcaster.log('Pricing', msg, data);
  };
  
  logBroadcast("");
  logBroadcast("═══════════════════════════════════════════════════════════════");
  logBroadcast("💰 PRICING AGENT: Material & Services Cost Calculation", { phase: 'start' });
  logBroadcast("═══════════════════════════════════════════════════════════════");

  // Verify we have required inputs
  if (!S.pricingContext) {
    logBroadcast("⚠️ PricingAgent: No pricing context received from Master Agent", { error: true });
    if (broadcast) agentBroadcaster.completeAgent('Pricing', { error: 'no_context' });
    S.next = "master";
    return { ...S, logs: getAndClearNewLogs(S) };
  }

  if (!S.recommendedSKUs || S.recommendedSKUs.length === 0) {
    logBroadcast("⚠️ PricingAgent: No product recommendations received from Technical Agent", { error: true });
    if (broadcast) agentBroadcaster.completeAgent('Pricing', { error: 'no_products' });
    S.next = "master";
    return { ...S, logs: getAndClearNewLogs(S) };
  }

  const context = S.pricingContext;
  logBroadcast("");
  logBroadcast(`📋 Received context for RFP: ${context.rfp_id}`, { rfp_id: context.rfp_id });
  logBroadcast(`   Products to price: ${S.recommendedSKUs.length}`);
  logBroadcast(`   Test requirements: ${context.test_requirements.length}`);
  logBroadcast(`   Acceptance tests: ${context.acceptance_tests.length}`);

  // ========================================
  // STEP 1: PRODUCT PRICING WITH MARKET ANALYSIS
  // ========================================
  logBroadcast("");
  logBroadcast("📦 Step 1: Analyzing product pricing against market benchmarks...", { step: 1, action: 'product_pricing' });
  
  const oemProducts = getOEMProducts();
  S.productPricingTable = [];
  S.marketAnalysis = [];
  
  // Estimate quantity based on RFP value
  const rfpValue = S.selectedRFP?.estimated_cost_inr || 10000000;
  const avgUnitPrice = S.recommendedSKUs.reduce((sum, r) => sum + (r.unit_price || 100000), 0) / S.recommendedSKUs.length;
  const estimatedTotalQty = Math.max(10, Math.round(rfpValue / avgUnitPrice / 1.5));
  const qtyPerProduct = Math.ceil(estimatedTotalQty / S.recommendedSKUs.length);
  
  logBroadcast("");
  logBroadcast("┌────────────────────────────────────────────────────────────────────────────┐");
  logBroadcast("│  PRODUCT PRICING TABLE WITH MARKET ANALYSIS                                │", { table: 'product_pricing' });
  logBroadcast("├──────────────────────┬────────────────┬────────────────┬──────┬────────────┤");
  logBroadcast("│ SKU ID               │ Market Value   │ Counter Offer  │ Qty  │ Line Total │");
  logBroadcast("├──────────────────────┼────────────────┼────────────────┼──────┼────────────┤");
  
  let totalMaterialCost = 0;
  let totalMarketValue = 0;
  let totalCounterOffer = 0;
  
  for (const rec of S.recommendedSKUs) {
    // Look up product details from OEM catalog
    const oemProduct = oemProducts.find(p => p.sku_id === rec.sku_id);
    const unitPrice = oemProduct?.unit_price_inr_per_km || rec.unit_price || 100000;
    const quantity = qtyPerProduct;
    
    // Get market value benchmark
    const marketBenchmark = getMarketValueBenchmark(oemProduct || rec);
    
    // Analyze quoted price and generate counter offer
    // Counter offer is ALWAYS at or below market value
    const priceAnalysis = analyzeQuotedPrice(unitPrice, marketBenchmark);
    
    // Use counter offer (at or below market value)
    const counterOfferPrice = priceAnalysis.counterOffer.amount;
    const lineTotal = counterOfferPrice * quantity;
    const marketLineTotal = marketBenchmark.avg * quantity;
    
    const pricingItem = {
      rfp_product: rec.rfp_product,
      sku_id: rec.sku_id,
      product_name: rec.product_name,
      spec_match: rec.spec_match_percentage,
      unit_price_inr: unitPrice,
      market_benchmark: marketBenchmark,
      counter_offer_price: counterOfferPrice,
      price_category: priceAnalysis.priceCategory,
      quantity_km: quantity,
      line_total_inr: lineTotal,
      market_line_total: marketLineTotal,
      savings_per_unit: unitPrice - counterOfferPrice,
      lead_time_days: rec.lead_time_days
    };
    
    S.productPricingTable.push(pricingItem);
    S.marketAnalysis.push({
      sku_id: rec.sku_id,
      analysis: priceAnalysis,
      recommendation: priceAnalysis.recommendation
    });
    
    totalMaterialCost += lineTotal;
    totalMarketValue += marketLineTotal;
    totalCounterOffer += lineTotal;
    
    // Display row with market analysis
    const sku = (rec.sku_id || '').substring(0, 20).padEnd(20);
    const market = formatLakhsCrores(marketBenchmark.avg).padStart(14);
    const counter = formatLakhsCrores(counterOfferPrice).padStart(14);
    const qty = String(quantity).padStart(4);
    const total = formatLakhsCrores(lineTotal).padStart(10);
    logBroadcast(`│ ${sku} │ ${market} │ ${counter} │ ${qty} │ ${total} │`, { 
      sku_id: rec.sku_id, 
      market_value: marketBenchmark.avg,
      counter_offer: counterOfferPrice,
      category: priceAnalysis.priceCategory
    });
  }
  
  logBroadcast("├──────────────────────┴────────────────┴────────────────┴──────┼────────────┤");
  logBroadcast(`│  TOTAL MATERIAL (at counter offer rates):                     │ ${formatLakhsCrores(totalMaterialCost).padStart(10)} │`, { total_material: totalMaterialCost });
  logBroadcast(`│  TOTAL MARKET VALUE (benchmark):                              │ ${formatLakhsCrores(totalMarketValue).padStart(10)} │`, { market_value: totalMarketValue });
  logBroadcast("└───────────────────────────────────────────────────────────────┴────────────┘");
  
  // Log pricing strategy
  logBroadcast("");
  logBroadcast("💡 Pricing Strategy: Counter offers are set AT or BELOW market value", { strategy: 'below_market' });
  const totalSavings = totalMarketValue - totalMaterialCost;
  if (totalSavings > 0) {
    logBroadcast(`   Negotiated savings: ${formatLakhsCrores(totalSavings)} below market value`, { savings: totalSavings });
  }

  // ========================================
  // STEP 2: SCALED TEST/SERVICES PRICING
  // Test costs are now proportional to project value
  // ========================================
  logBroadcast("");
  logBroadcast("🧪 Step 2: Calculating scaled test costs (proportional to project value)...", { step: 2, action: 'test_pricing' });
  
  S.servicesPricingTable = [];
  const allTests = SERVICES_PRICING_TABLE.tests;
  
  // Get required tests from context
  const requiredTests = [
    ...context.test_requirements,
    ...context.acceptance_tests
  ];
  
  // Calculate scaled test costs based on project value
  const scaledTestCosts = calculateScaledTestCosts(rfpValue, requiredTests);
  
  logBroadcast("");
  logBroadcast("┌──────────────────────────────────────────────────────────────────────────┐");
  logBroadcast("│  SCALED TEST PRICING TABLE (proportional to project value)              │", { table: 'services_pricing' });
  logBroadcast("├──────────┬─────────────────────────────────┬──────────────┬──────────────┤");
  logBroadcast("│ Test ID  │ Test Name                       │ Base Price   │ Scaled Price │");
  logBroadcast("├──────────┼─────────────────────────────────┼──────────────┼──────────────┤");
  
  let totalTestCost = 0;
  const testsIncluded = [];
  
  // Process routine tests
  if (scaledTestCosts.routine.length > 0) {
    logBroadcast("│          │ ROUTINE TESTS                   │              │              │");
    logBroadcast("├──────────┼─────────────────────────────────┼──────────────┼──────────────┤");
  }
  
  for (const test of scaledTestCosts.routine) {
    const testItem = {
      test_id: test.test_id,
      test_name: test.test_name,
      category: 'Routine',
      standard: test.standard,
      original_price: test.original_price,
      price_inr: test.scaled_price,
      scaling_factor: test.scaling_factor
    };
    
    S.servicesPricingTable.push(testItem);
    testsIncluded.push(testItem);
    totalTestCost += test.scaled_price;
    
    const id = (test.test_id || '').padEnd(8);
    const name = (test.test_name || '').substring(0, 31).padEnd(31);
    const base = formatINR(test.original_price).padStart(12);
    const scaled = formatINR(test.scaled_price).padStart(12);
    logBroadcast(`│ ${id} │ ${name} │ ${base} │ ${scaled} │`, { test_id: test.test_id });
  }
  
  // Process type tests
  if (scaledTestCosts.type.length > 0) {
    logBroadcast("├──────────┼─────────────────────────────────┼──────────────┼──────────────┤");
    logBroadcast("│          │ TYPE TESTS                      │              │              │");
    logBroadcast("├──────────┼─────────────────────────────────┼──────────────┼──────────────┤");
  }
  
  for (const test of scaledTestCosts.type) {
    const testItem = {
      test_id: test.test_id,
      test_name: test.test_name,
      category: 'Type',
      standard: test.standard,
      original_price: test.original_price,
      price_inr: test.scaled_price,
      scaling_factor: test.scaling_factor
    };
    
    S.servicesPricingTable.push(testItem);
    testsIncluded.push(testItem);
    totalTestCost += test.scaled_price;
    
    const id = (test.test_id || '').padEnd(8);
    const name = (test.test_name || '').substring(0, 31).padEnd(31);
    const base = formatINR(test.original_price).padStart(12);
    const scaled = formatINR(test.scaled_price).padStart(12);
    logBroadcast(`│ ${id} │ ${name} │ ${base} │ ${scaled} │`, { test_id: test.test_id });
  }
  
  // Process acceptance tests
  if (scaledTestCosts.acceptance.length > 0) {
    logBroadcast("├──────────┼─────────────────────────────────┼──────────────┼──────────────┤");
    logBroadcast("│          │ ACCEPTANCE TESTS                │              │              │");
    logBroadcast("├──────────┼─────────────────────────────────┼──────────────┼──────────────┤");
  }
  
  for (const test of scaledTestCosts.acceptance) {
    const testItem = {
      test_id: test.test_id,
      test_name: test.test_name,
      category: 'Acceptance',
      standard: test.standard,
      original_price: test.original_price,
      price_inr: test.scaled_price,
      scaling_factor: test.scaling_factor
    };
    
    S.servicesPricingTable.push(testItem);
    testsIncluded.push(testItem);
    totalTestCost += test.scaled_price;
    
    const id = (test.test_id || '').padEnd(8);
    const name = (test.test_name || '').substring(0, 31).padEnd(31);
    const base = formatINR(test.original_price).padStart(12);
    const scaled = formatINR(test.scaled_price).padStart(12);
    logBroadcast(`│ ${id} │ ${name} │ ${base} │ ${scaled} │`, { test_id: test.test_id });
  }
  
  logBroadcast("├──────────┴─────────────────────────────────┴──────────────┼──────────────┤");
  logBroadcast(`│                                  TOTAL TEST/SERVICES:    │ ${formatLakhsCrores(totalTestCost).padStart(12)} │`, { total_test: totalTestCost });
  logBroadcast("└──────────────────────────────────────────────────────────┴──────────────┘");
  
  // Show test cost as percentage of project
  const testPercentage = ((totalTestCost / rfpValue) * 100).toFixed(2);
  logBroadcast("");
  logBroadcast(`📊 Test costs represent ${testPercentage}% of project value (${formatLakhsCrores(rfpValue)})`, { 
    test_percentage: testPercentage,
    project_value: rfpValue 
  });

  // ========================================
  // STEP 3: CONSOLIDATE TOTAL PRICING WITH MARKET ANALYSIS
  // ========================================
  logBroadcast("");
  logBroadcast("📊 Step 3: Consolidating pricing with market benchmarks...", { step: 3, action: 'consolidate' });
  
  const subtotal = totalMaterialCost + totalTestCost;
  const gst = Math.round(subtotal * 0.18);
  const grandTotal = subtotal + gst;
  
  // Calculate savings from market value
  const savingsFromMarket = totalMarketValue - totalMaterialCost;
  const savingsPercentage = totalMarketValue > 0 
    ? ((savingsFromMarket / totalMarketValue) * 100).toFixed(1)
    : 0;
  
  S.consolidatedPricing = {
    total_material_cost: totalMaterialCost,
    total_market_value: totalMarketValue,
    total_test_cost: totalTestCost,
    total_services_cost: totalTestCost,
    subtotal: subtotal,
    gst_rate: 0.18,
    gst: gst,
    grand_total: grandTotal,
    currency: 'INR',
    
    // Market analysis summary
    market_analysis: {
      total_savings: savingsFromMarket,
      savings_percentage: parseFloat(savingsPercentage),
      pricing_strategy: 'Counter offers at or below market value',
      test_cost_percentage: parseFloat(testPercentage)
    },
    
    // Detailed breakdowns
    product_pricing: S.productPricingTable,
    services_pricing: S.servicesPricingTable,
    tests_included: testsIncluded,
    product_market_analysis: S.marketAnalysis,
    
    // Summary metrics
    products_priced: S.productPricingTable.length,
    tests_priced: S.servicesPricingTable.length,
    estimated_lead_time: Math.max(...S.productPricingTable.map(p => p.lead_time_days || 14))
  };

  // Display consolidated summary with market analysis
  logBroadcast("");
  logBroadcast("╔════════════════════════════════════════════════════════════════════╗");
  logBroadcast("║  CONSOLIDATED PRICING SUMMARY (WITH MARKET ANALYSIS)              ║", { table: 'consolidated_pricing' });
  logBroadcast("╠════════════════════════════════════════════════════════════════════╣");
  logBroadcast(`║  Market Value (benchmark):       ${formatLakhsCrores(totalMarketValue).padStart(22)}     ║`);
  logBroadcast(`║  Counter Offer Total:            ${formatLakhsCrores(totalMaterialCost).padStart(22)}     ║`);
  logBroadcast(`║  Savings from Market:            ${formatLakhsCrores(savingsFromMarket).padStart(22)}     ║`);
  logBroadcast("║  ────────────────────────────────────────────────────────────────  ║");
  logBroadcast(`║  Total Material Cost:            ${formatLakhsCrores(totalMaterialCost).padStart(22)}     ║`);
  logBroadcast(`║  Total Test/Services Cost:       ${formatLakhsCrores(totalTestCost).padStart(22)}     ║`);
  logBroadcast(`║  (Test cost = ${testPercentage}% of project)`.padEnd(65) + "║");
  logBroadcast("║  ────────────────────────────────────────────────────────────────  ║");
  logBroadcast(`║  Subtotal:                       ${formatLakhsCrores(subtotal).padStart(22)}     ║`);
  logBroadcast(`║  GST @ 18%:                      ${formatLakhsCrores(gst).padStart(22)}     ║`);
  logBroadcast("║  ════════════════════════════════════════════════════════════════  ║");
  logBroadcast(`║  GRAND TOTAL (incl GST):         ${formatLakhsCrores(grandTotal).padStart(22)}     ║`, { grand_total: grandTotal });
  logBroadcast("╠════════════════════════════════════════════════════════════════════╣");
  logBroadcast(`║  Products Priced:      ${String(S.consolidatedPricing.products_priced).padStart(5)}                                       ║`);
  logBroadcast(`║  Tests Included:       ${String(S.consolidatedPricing.tests_priced).padStart(5)}                                       ║`);
  logBroadcast(`║  Est. Lead Time:       ${String(S.consolidatedPricing.estimated_lead_time + ' days').padStart(10)}                                  ║`);
  logBroadcast(`║  Savings:              ${savingsPercentage}% below market value`.padEnd(44) + "║");
  logBroadcast("╚════════════════════════════════════════════════════════════════════╝");

  // ========================================
  // STEP 4: SEND TO MASTER AGENT
  // ========================================
  const pricingOutput = {
    material_pricing: {
      items: S.productPricingTable,
      total: totalMaterialCost
    },
    services_pricing: {
      items: S.servicesPricingTable,
      total: totalTestCost
    },
    consolidated: S.consolidatedPricing
  };
  
  storeAgentOutput(S, 'pricing', pricingOutput);
  markAgentComplete(S, 'Pricing');

  logBroadcast("");
  logBroadcast("✅ PricingAgent Complete:", { status: 'complete' });
  logBroadcast(`   • Material Cost: ${formatLakhsCrores(totalMaterialCost)}`);
  logBroadcast(`   • Services Cost: ${formatLakhsCrores(totalTestCost)}`);
  logBroadcast(`   • Grand Total: ${formatLakhsCrores(grandTotal)}`, { grand_total: grandTotal });
  logBroadcast("   → Sending consolidated pricing to Master Agent");
  
  if (broadcast) agentBroadcaster.completeAgent('Pricing', { grand_total: grandTotal });

  // Return to Master Agent for final consolidation
  S.next = "master";
  return { ...S, logs: getAndClearNewLogs(S) };
}
