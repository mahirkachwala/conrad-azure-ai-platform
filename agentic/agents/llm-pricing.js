/**
 * LLM-Powered Pricing Agent
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Uses Google Gemini with tool calling for intelligent pricing.
 */

import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { createAgentLLM, AGENT_PROMPTS } from "../llm.js";
import { pricingAgentTools } from "../tools/index.js";
import { pushLog, getAndClearNewLogs, storeAgentOutput, markAgentComplete } from "../state.js";
import { agentBroadcaster } from "../../services/agent-broadcast.js";

/**
 * LLM-Powered Pricing Agent
 * Uses AI reasoning for pricing calculations
 */
export async function LLMPricingAgent(S) {
  const broadcast = S.broadcast !== false;
  
  const logBroadcast = (msg, data = {}) => {
    pushLog(S, msg, "Pricing");
    if (broadcast) agentBroadcaster.log('Pricing', msg, data);
  };
  
  logBroadcast("");
  logBroadcast("═══════════════════════════════════════════════════════════════");
  logBroadcast("🤖 LLM PRICING AGENT: AI-Powered Quotation", { phase: 'start', type: 'llm_agent' });
  logBroadcast("═══════════════════════════════════════════════════════════════");
  
  // Verify inputs
  if (!S.pricingContext) {
    logBroadcast("⚠️ No pricing context received", { error: true });
    S.next = "master";
    return { ...S, logs: getAndClearNewLogs(S) };
  }
  
  if (!S.recommendedSKUs || S.recommendedSKUs.length === 0) {
    logBroadcast("⚠️ No product recommendations received", { error: true });
    S.next = "master";
    return { ...S, logs: getAndClearNewLogs(S) };
  }
  
  const context = S.pricingContext;
  const rfpValue = S.selectedRFP?.estimated_cost_inr || 10000000;
  
  logBroadcast(`📋 Processing RFP: ${context.rfp_id}`, { rfp_id: context.rfp_id });
  logBroadcast(`   Products to price: ${S.recommendedSKUs.length}`);
  logBroadcast(`   RFP Estimated Value: ₹${(rfpValue / 100000).toFixed(2)}L`);
  
  try {
    // Initialize LLM with tools
    const llm = createAgentLLM({ temperature: 0.1 });
    const llmWithTools = llm.bindTools(pricingAgentTools);
    
    // Build products list for pricing
    const productsForPricing = S.recommendedSKUs.map((r, i) => ({
      sku_id: r.sku_id,
      product_name: r.product_name,
      quantity_km: 5 + Math.floor(i * 2), // Estimated quantities
      unit_price: r.unit_price
    }));
    
    const productsList = productsForPricing.map((p, i) => 
      `${i + 1}. SKU: ${p.sku_id}, Qty: ${p.quantity_km}km`
    ).join('\n');
    
    const taskPrompt = `
You are the Pricing Agent generating a quotation for RFP ${context.rfp_id}.

PRODUCTS TO PRICE:
${productsList}

ESTIMATED PROJECT VALUE: ₹${rfpValue.toLocaleString('en-IN')}

YOUR TASK:
1. For each product SKU, use 'get_product_price' to get unit prices
2. Use 'calculate_line_item_price' for each item with quantity
3. Use 'get_test_prices' with the project value to get scaled test costs
4. Finally, use 'generate_quotation' to create the complete quotation

PRICING RULES:
- Counter offers should be AT or BELOW market value
- Apply quantity discounts where applicable
- Include GST @ 18%
- Test costs should be proportional to project value

Generate a professional quotation with:
- Material costs breakdown
- Test/services costs
- GST calculation
- Grand total

Start by getting prices for each product.
`;

    const messages = [
      new SystemMessage(AGENT_PROMPTS.pricing),
      new HumanMessage(taskPrompt)
    ];
    
    logBroadcast("🧠 AI calculating pricing...", { action: 'llm_call' });
    
    // LLM reasoning loop
    let response = await llmWithTools.invoke(messages);
    let iterations = 0;
    const maxIterations = 6;
    
    let quotationData = null;
    const pricingResults = [];
    
    while (response.tool_calls && response.tool_calls.length > 0 && iterations < maxIterations) {
      iterations++;
      
      logBroadcast(`🔧 AI calculating (iteration ${iterations}):`, { iteration: iterations });
      
      for (const toolCall of response.tool_calls) {
        logBroadcast(`   → ${toolCall.name}`, { tool: toolCall.name });
        
        const tool = pricingAgentTools.find(t => t.name === toolCall.name);
        if (tool) {
          try {
            const result = await tool.invoke(toolCall.args);
            
            messages.push(new AIMessage({ content: "", tool_calls: [toolCall] }));
            messages.push(new HumanMessage({
              content: `Tool '${toolCall.name}' returned:\n${result}`,
              name: toolCall.name
            }));
            
            // Parse and collect results
            try {
              const parsed = JSON.parse(result);
              
              if (parsed.quotation) {
                quotationData = parsed.quotation;
                logBroadcast(`   ✓ Generated quotation: ₹${(quotationData.summary.grand_total / 100000).toFixed(2)}L`, {
                  grand_total: quotationData.summary.grand_total
                });
              }
              
              if (parsed.unit_price_per_km) {
                pricingResults.push(parsed);
                logBroadcast(`   ✓ ${parsed.sku_id}: ₹${parsed.unit_price_per_km}/km`, {
                  sku: parsed.sku_id,
                  price: parsed.unit_price_per_km
                });
              }
              
              if (parsed.net_total) {
                logBroadcast(`   ✓ Line total: ₹${(parsed.net_total / 100000).toFixed(2)}L`, {
                  line_total: parsed.net_total
                });
              }
              
              if (parsed.total_scaled_price) {
                logBroadcast(`   ✓ Test costs: ₹${(parsed.total_scaled_price / 1000).toFixed(0)}K`, {
                  test_cost: parsed.total_scaled_price
                });
              }
            } catch (e) {
              // Not JSON
            }
          } catch (error) {
            logBroadcast(`   ✗ Tool error: ${error.message}`, { error: true });
            messages.push(new HumanMessage({
              content: `Tool '${toolCall.name}' failed: ${error.message}`,
              name: toolCall.name
            }));
          }
        }
      }
      
      response = await llmWithTools.invoke(messages);
    }
    
    // Build consolidated pricing from quotation or calculate manually
    logBroadcast("");
    logBroadcast("════════════════════════════════════════════════════════════════");
    logBroadcast("💰 PRICING SUMMARY", { phase: 'results' });
    logBroadcast("════════════════════════════════════════════════════════════════");
    
    if (quotationData) {
      // Use AI-generated quotation
      S.consolidatedPricing = {
        total_material_cost: quotationData.material?.total || 0,
        total_test_cost: quotationData.services?.total || 0,
        total_services_cost: quotationData.services?.total || 0,
        subtotal: quotationData.summary?.subtotal || 0,
        gst_rate: quotationData.summary?.gst_rate / 100 || 0.18,
        gst: quotationData.summary?.gst_amount || 0,
        grand_total: quotationData.summary?.grand_total || 0,
        currency: 'INR',
        product_pricing: quotationData.material?.items || [],
        services_pricing: quotationData.services?.items || [],
        tests_included: quotationData.services?.items || []
      };
      
      S.productPricingTable = quotationData.material?.items || [];
      S.servicesPricingTable = quotationData.services?.items || [];
    } else {
      // Fallback calculation
      logBroadcast("⚠️ Using fallback pricing calculation", { fallback: true });
      
      let totalMaterial = 0;
      const materialItems = [];
      
      for (const rec of S.recommendedSKUs) {
        const qty = 5;
        const unitPrice = rec.unit_price || 100000;
        const lineTotal = unitPrice * qty;
        totalMaterial += lineTotal;
        
        materialItems.push({
          sku_id: rec.sku_id,
          product_name: rec.product_name,
          unit_price: unitPrice,
          quantity_km: qty,
          line_total: lineTotal
        });
      }
      
      const totalTests = Math.round(rfpValue * 0.02); // 2% of project value
      const subtotal = totalMaterial + totalTests;
      const gst = Math.round(subtotal * 0.18);
      const grandTotal = subtotal + gst;
      
      S.consolidatedPricing = {
        total_material_cost: totalMaterial,
        total_test_cost: totalTests,
        total_services_cost: totalTests,
        subtotal: subtotal,
        gst_rate: 0.18,
        gst: gst,
        grand_total: grandTotal,
        currency: 'INR',
        product_pricing: materialItems,
        tests_included: [
          { test_name: 'Routine Tests Package', price: Math.round(totalTests * 0.5) },
          { test_name: 'Type Tests Package', price: Math.round(totalTests * 0.5) }
        ]
      };
      
      S.productPricingTable = materialItems;
      S.servicesPricingTable = S.consolidatedPricing.tests_included;
    }
    
    // Display consolidated pricing
    logBroadcast("");
    logBroadcast("╔════════════════════════════════════════════════════════════════╗");
    logBroadcast("║  CONSOLIDATED QUOTATION                                        ║");
    logBroadcast("╠════════════════════════════════════════════════════════════════╣");
    logBroadcast(`║  Material Cost:        ₹${(S.consolidatedPricing.total_material_cost / 100000).toFixed(2).padStart(10)}L                   ║`);
    logBroadcast(`║  Test/Services:        ₹${(S.consolidatedPricing.total_test_cost / 100000).toFixed(2).padStart(10)}L                   ║`);
    logBroadcast(`║  ──────────────────────────────────────────────────────────── ║`);
    logBroadcast(`║  Subtotal:             ₹${(S.consolidatedPricing.subtotal / 100000).toFixed(2).padStart(10)}L                   ║`);
    logBroadcast(`║  GST @ 18%:            ₹${(S.consolidatedPricing.gst / 100000).toFixed(2).padStart(10)}L                   ║`);
    logBroadcast(`║  ════════════════════════════════════════════════════════════ ║`);
    logBroadcast(`║  GRAND TOTAL:          ₹${(S.consolidatedPricing.grand_total / 100000).toFixed(2).padStart(10)}L                   ║`, {
      grand_total: S.consolidatedPricing.grand_total
    });
    logBroadcast("╚════════════════════════════════════════════════════════════════╝");
    
    // Store output
    const pricingOutput = {
      agent_type: 'LLM_POWERED',
      llm_model: 'gemini-2.0-flash',
      reasoning_iterations: iterations,
      material_pricing: {
        items: S.productPricingTable,
        total: S.consolidatedPricing.total_material_cost
      },
      services_pricing: {
        items: S.servicesPricingTable,
        total: S.consolidatedPricing.total_test_cost
      },
      consolidated: S.consolidatedPricing,
      ai_reasoning: response.content
    };
    
    storeAgentOutput(S, 'pricing', pricingOutput);
    markAgentComplete(S, 'Pricing');
    
    logBroadcast("");
    logBroadcast("✅ LLM Pricing Agent Complete", { status: 'complete' });
    logBroadcast(`   Grand Total: ₹${(S.consolidatedPricing.grand_total / 100000).toFixed(2)}L`);
    logBroadcast("   → Sending to Master Agent for consolidation");
    
    if (broadcast) {
      agentBroadcaster.completeAgent('Pricing', {
        grand_total: S.consolidatedPricing.grand_total
      });
    }
    
  } catch (error) {
    logBroadcast(`❌ LLM Agent Error: ${error.message}`, { error: true });
    console.error('LLM Pricing Agent Error:', error);
    
    // Fallback pricing
    S.consolidatedPricing = {
      total_material_cost: 500000,
      total_test_cost: 100000,
      subtotal: 600000,
      gst: 108000,
      grand_total: 708000,
      currency: 'INR'
    };
    
    if (broadcast) {
      agentBroadcaster.completeAgent('Pricing', { error: error.message });
    }
  }
  
  S.next = "master";
  return { ...S, logs: getAndClearNewLogs(S) };
}

export default LLMPricingAgent;



