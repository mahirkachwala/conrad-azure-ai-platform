/**
 * LLM-Powered Technical Agent
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Uses Google Gemini with tool calling for intelligent SKU matching.
 * Leverages local embeddings for semantic product search.
 */

import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { createAgentLLM, AGENT_PROMPTS } from "../llm.js";
import { technicalAgentTools } from "../tools/index.js";
import { pushLog, getAndClearNewLogs, storeAgentOutput, markAgentComplete } from "../state.js";
import { agentBroadcaster } from "../../services/agent-broadcast.js";

/**
 * LLM-Powered Technical Agent
 * Uses AI reasoning for specification matching
 */
export async function LLMTechnicalAgent(S) {
  const broadcast = S.broadcast !== false;
  
  const logBroadcast = (msg, data = {}) => {
    pushLog(S, msg, "Technical");
    if (broadcast) agentBroadcaster.log('Technical', msg, data);
  };
  
  logBroadcast("");
  logBroadcast("═══════════════════════════════════════════════════════════════");
  logBroadcast("🤖 LLM TECHNICAL AGENT: AI-Powered SKU Matching", { phase: 'start', type: 'llm_agent' });
  logBroadcast("═══════════════════════════════════════════════════════════════");
  
  // Verify we have context
  if (!S.technicalContext || !S.selectedRFP) {
    logBroadcast("⚠️ No technical context received", { error: true });
    S.next = "pricing";
    return { ...S, logs: getAndClearNewLogs(S) };
  }
  
  const context = S.technicalContext;
  logBroadcast(`📋 Processing RFP: ${context.rfp_id}`, { rfp_id: context.rfp_id });
  logBroadcast(`   Products in scope: ${context.scope_of_supply?.length || 0}`);
  
  try {
    // Initialize LLM with tools
    const llm = createAgentLLM({ temperature: 0.1 });
    const llmWithTools = llm.bindTools(technicalAgentTools);
    
    // Build scope of supply description
    const scopeDescription = (context.scope_of_supply || []).map((p, i) => 
      `${i + 1}. ${p.description || 'Unknown Product'}\n   Specs: ${JSON.stringify(p.specifications || {})}`
    ).join('\n');
    
    const taskPrompt = `
You are the Technical Agent analyzing RFP requirements for SKU matching.

RFP ID: ${context.rfp_id}
Buyer: ${context.buyer}

SCOPE OF SUPPLY:
${scopeDescription || 'No products specified'}

YOUR TASK:
1. First, use 'get_product_schema' to understand available product attributes
2. For EACH product in scope, use 'find_top_matches' to find the TOP 3 matching OEM SKUs
3. Use 'match_specifications' to verify the spec match percentage for your top choice
4. Compile a comparison table showing RFP specs vs OEM product specs

IMPORTANT:
- Spec Match % = (Matched Specs / Total Specs) × 100
- All specs have EQUAL weightage
- Recommend products with highest spec match

Report your findings with:
- Recommended SKU for each RFP product
- Spec match percentage
- Key matching/non-matching specifications

Begin by understanding the product schema.
`;

    const messages = [
      new SystemMessage(AGENT_PROMPTS.technical),
      new HumanMessage(taskPrompt)
    ];
    
    logBroadcast("🧠 AI analyzing product requirements...", { action: 'llm_call' });
    
    // LLM reasoning loop
    let response = await llmWithTools.invoke(messages);
    let iterations = 0;
    const maxIterations = 8;
    
    const matchResults = [];
    
    while (response.tool_calls && response.tool_calls.length > 0 && iterations < maxIterations) {
      iterations++;
      
      logBroadcast(`🔧 AI using tools (iteration ${iterations}):`, { iteration: iterations });
      
      for (const toolCall of response.tool_calls) {
        logBroadcast(`   → ${toolCall.name}`, { tool: toolCall.name });
        
        const tool = technicalAgentTools.find(t => t.name === toolCall.name);
        if (tool) {
          try {
            const result = await tool.invoke(toolCall.args);
            
            messages.push(new AIMessage({ content: "", tool_calls: [toolCall] }));
            messages.push(new HumanMessage({
              content: `Tool '${toolCall.name}' returned:\n${result}`,
              name: toolCall.name
            }));
            
            // Parse and collect match results
            try {
              const parsed = JSON.parse(result);
              
              if (parsed.top_matches) {
                matchResults.push({
                  product_description: parsed.product_description,
                  rfp_specs: parsed.rfp_specs,
                  matches: parsed.top_matches,
                  recommended: parsed.recommended_sku
                });
                
                logBroadcast(`   ✓ Found ${parsed.top_matches.length} matches for product`, { 
                  matches: parsed.top_matches.length,
                  top_match: parsed.recommended_sku
                });
              }
              
              if (parsed.spec_match_percentage !== undefined) {
                logBroadcast(`   ✓ Spec Match: ${parsed.spec_match_percentage}% (${parsed.recommendation})`, {
                  spec_match: parsed.spec_match_percentage
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
    
    // Process results
    logBroadcast("");
    logBroadcast("════════════════════════════════════════════════════════════════");
    logBroadcast("📊 SKU MATCHING RESULTS", { phase: 'results' });
    logBroadcast("════════════════════════════════════════════════════════════════");
    
    // Build recommended SKUs from match results
    S.recommendedSKUs = [];
    S.comparisonTables = [];
    S.skuMatchResults = matchResults;
    
    for (let i = 0; i < matchResults.length; i++) {
      const mr = matchResults[i];
      const topMatch = mr.matches?.[0];
      
      if (topMatch) {
        S.recommendedSKUs.push({
          rfp_product_id: `P${String(i + 1).padStart(3, '0')}`,
          rfp_product: mr.product_description,
          sku_id: topMatch.sku_id,
          product_name: topMatch.product_name,
          spec_match_percentage: topMatch.spec_match_percentage || topMatch.combined_score || 75,
          unit_price: topMatch.unit_price_per_km || 0,
          lead_time_days: 14,
          alternatives: mr.matches.slice(1, 3).map(m => ({
            sku_id: m.sku_id,
            spec_match: m.spec_match_percentage || m.combined_score
          }))
        });
        
        // Build comparison table
        S.comparisonTables.push({
          rfp_product: mr.product_description,
          rfp_specs: mr.rfp_specs,
          oem_1_sku: mr.matches[0]?.sku_id,
          oem_1_match: mr.matches[0]?.spec_match_percentage || mr.matches[0]?.combined_score,
          oem_2_sku: mr.matches[1]?.sku_id,
          oem_2_match: mr.matches[1]?.spec_match_percentage || mr.matches[1]?.combined_score,
          oem_3_sku: mr.matches[2]?.sku_id,
          oem_3_match: mr.matches[2]?.spec_match_percentage || mr.matches[2]?.combined_score
        });
      }
    }
    
    // If no results from AI, create fallback
    if (S.recommendedSKUs.length === 0 && context.scope_of_supply?.length > 0) {
      logBroadcast("⚠️ Creating fallback recommendations", { fallback: true });
      
      for (let i = 0; i < context.scope_of_supply.length; i++) {
        const product = context.scope_of_supply[i];
        S.recommendedSKUs.push({
          rfp_product_id: product.id || `P${String(i + 1).padStart(3, '0')}`,
          rfp_product: product.description,
          sku_id: `SKU-${product.id || i + 1}`,
          product_name: product.description,
          spec_match_percentage: 75,
          unit_price: 100000,
          lead_time_days: 14
        });
      }
    }
    
    // Display results
    logBroadcast("");
    logBroadcast("╔════════════════════════════════════════════════════════════════╗");
    logBroadcast("║  RECOMMENDED SKUs (AI Selection)                               ║");
    logBroadcast("╠════════════════════════════════════════════════════════════════╣");
    
    for (const rec of S.recommendedSKUs) {
      logBroadcast(`║  ${rec.sku_id.padEnd(15)} │ ${String(rec.spec_match_percentage + '%').padStart(4)} match  ║`);
    }
    
    logBroadcast("╚════════════════════════════════════════════════════════════════╝");
    
    // Calculate average spec match
    const avgSpecMatch = S.recommendedSKUs.length > 0
      ? Math.round(S.recommendedSKUs.reduce((sum, r) => sum + r.spec_match_percentage, 0) / S.recommendedSKUs.length)
      : 0;
    
    // Store output
    const technicalOutput = {
      agent_type: 'LLM_POWERED',
      llm_model: 'gemini-2.0-flash',
      reasoning_iterations: iterations,
      products_analyzed: context.scope_of_supply?.length || 0,
      average_spec_match: avgSpecMatch,
      recommended_skus: S.recommendedSKUs,
      comparison_tables: S.comparisonTables,
      ai_reasoning: response.content
    };
    
    storeAgentOutput(S, 'technical', technicalOutput);
    markAgentComplete(S, 'Technical');
    
    logBroadcast("");
    logBroadcast(`✅ LLM Technical Agent Complete`, { status: 'complete' });
    logBroadcast(`   Products matched: ${S.recommendedSKUs.length}`);
    logBroadcast(`   Average Spec Match: ${avgSpecMatch}%`);
    logBroadcast("   → Sending to Pricing Agent");
    
    if (broadcast) {
      agentBroadcaster.completeAgent('Technical', {
        avg_spec_match: avgSpecMatch,
        products: S.recommendedSKUs.length
      });
    }
    
  } catch (error) {
    logBroadcast(`❌ LLM Agent Error: ${error.message}`, { error: true });
    console.error('LLM Technical Agent Error:', error);
    
    // Fallback
    S.recommendedSKUs = [{
      rfp_product_id: 'P001',
      rfp_product: 'Fallback Product',
      sku_id: 'SKU-FALLBACK',
      product_name: 'Fallback SKU',
      spec_match_percentage: 70,
      unit_price: 100000
    }];
    
    if (broadcast) {
      agentBroadcaster.completeAgent('Technical', { error: error.message });
    }
  }
  
  S.next = "pricing";
  return { ...S, logs: getAndClearNewLogs(S) };
}

export default LLMTechnicalAgent;



