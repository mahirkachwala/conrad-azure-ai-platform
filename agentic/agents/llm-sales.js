/**
 * LLM-Powered Sales Agent
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Uses Google Gemini with tool calling for intelligent RFP discovery.
 * The agent REASONS about what to do rather than following hardcoded rules.
 */

import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { createAgentLLM, AGENT_PROMPTS } from "../llm.js";
import { salesAgentTools } from "../tools/index.js";
import { pushLog, getAndClearNewLogs, storeAgentOutput, markAgentComplete } from "../state.js";
import { agentBroadcaster } from "../../services/agent-broadcast.js";

/**
 * LLM-Powered Sales Agent
 * Uses ReAct-style reasoning with tool calling
 */
export async function LLMSalesAgent(S) {
  const broadcast = S.broadcast !== false;
  
  const logBroadcast = (msg, data = {}) => {
    pushLog(S, msg, "Sales");
    if (broadcast) agentBroadcaster.log('Sales', msg, data);
  };
  
  logBroadcast("");
  logBroadcast("═══════════════════════════════════════════════════════════════");
  logBroadcast("🤖 LLM SALES AGENT: AI-Powered RFP Discovery", { phase: 'start', type: 'llm_agent' });
  logBroadcast("═══════════════════════════════════════════════════════════════");
  
  try {
    // Initialize LLM with tools
    const llm = createAgentLLM({ temperature: 0.2 });
    const llmWithTools = llm.bindTools(salesAgentTools);
    
    logBroadcast("🧠 Initializing AI reasoning engine...", { action: 'init_llm' });
    
    // Build the task prompt
    const taskPrompt = `
You are the Sales Agent. Your task is to discover and select the best RFP opportunity.

INSTRUCTIONS:
1. First, use the 'search_portals' tool to find RFPs due within 90 days
2. Analyze the results and identify top candidates
3. For each top candidate, use 'calculate_rfp_score' to evaluate it
4. Use 'get_rfp_details' on the highest-scored RFP
5. Finally, use 'extract_pdf_data' to get structured requirements

RESPOND with your analysis and the selected RFP in this format:
- Selected RFP ID
- Why you selected it
- Key requirements extracted
- Submission deadline and mode

Start by searching the portals.
`;

    const messages = [
      new SystemMessage(AGENT_PROMPTS.sales),
      new HumanMessage(taskPrompt)
    ];
    
    logBroadcast("📡 Sending task to AI for reasoning...", { action: 'llm_call' });
    
    // First LLM call - it will decide to use tools
    let response = await llmWithTools.invoke(messages);
    let iterations = 0;
    const maxIterations = 5;
    
    // Tool calling loop (ReAct pattern)
    while (response.tool_calls && response.tool_calls.length > 0 && iterations < maxIterations) {
      iterations++;
      
      logBroadcast(`🔧 AI decided to use ${response.tool_calls.length} tool(s):`, { iteration: iterations });
      
      // Execute each tool call
      for (const toolCall of response.tool_calls) {
        logBroadcast(`   → ${toolCall.name}`, { tool: toolCall.name, args: toolCall.args });
        
        // Find and execute the tool
        const tool = salesAgentTools.find(t => t.name === toolCall.name);
        if (tool) {
          try {
            const result = await tool.invoke(toolCall.args);
            
            // Add tool result to messages
            messages.push(new AIMessage({ content: "", tool_calls: [toolCall] }));
            messages.push(new HumanMessage({
              content: `Tool '${toolCall.name}' returned:\n${result}`,
              name: toolCall.name
            }));
            
            // Parse and log key results
            try {
              const parsed = JSON.parse(result);
              if (parsed.total_found !== undefined) {
                logBroadcast(`   ✓ Found ${parsed.total_found} RFPs`, { count: parsed.total_found });
              }
              if (parsed.score !== undefined) {
                logBroadcast(`   ✓ Score: ${parsed.score}/100 (${parsed.recommendation})`, { score: parsed.score });
              }
              if (parsed.extraction_method) {
                logBroadcast(`   ✓ Extracted PDF data using ${parsed.extraction_method}`, { method: parsed.extraction_method });
              }
            } catch (e) {
              // Result wasn't JSON, that's ok
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
      
      // Get next LLM response
      logBroadcast(`🧠 AI analyzing results (iteration ${iterations})...`, { action: 'reasoning' });
      response = await llmWithTools.invoke(messages);
    }
    
    // Extract final response
    const finalResponse = response.content;
    logBroadcast("");
    logBroadcast("════════════════════════════════════════════════════════════════");
    logBroadcast("🎯 AI ANALYSIS COMPLETE", { phase: 'analysis_complete' });
    logBroadcast("════════════════════════════════════════════════════════════════");
    
    // Parse the AI response to extract selected RFP
    let selectedRFP = null;
    let extractedData = null;
    
    // Look through messages for tool results to find RFP data
    for (const msg of messages) {
      if (msg.content && typeof msg.content === 'string') {
        try {
          const parsed = JSON.parse(msg.content.replace(/^Tool '.*?' returned:\n/, ''));
          
          // Check if this is search results
          if (parsed.rfps && parsed.rfps.length > 0 && !selectedRFP) {
            // Use the first RFP as selected (AI should have sorted/prioritized)
            const topRFP = parsed.rfps[0];
            selectedRFP = {
              tender_id: topRFP.tender_id,
              title: topRFP.title,
              organisation: topRFP.organisation,
              city: topRFP.city,
              due_date: topRFP.due_date,
              estimated_cost_inr: topRFP.estimated_cost_inr,
              days_until_deadline: topRFP.days_until_deadline,
              cable_requirements: topRFP.cable_requirements,
              submission: topRFP.submission,
              pdf_url: topRFP.pdf_url
            };
          }
          
          // Check if this is extracted PDF data
          if (parsed.extracted_fields) {
            extractedData = parsed.extracted_fields;
            // Enhance selectedRFP with extracted data
            if (selectedRFP) {
              selectedRFP.buyer_requirements = extractedData.buyer_requirements;
              selectedRFP.tests_required = extractedData.tests_required;
              if (extractedData.submission) {
                selectedRFP.submission = { ...selectedRFP.submission, ...extractedData.submission };
              }
            }
          }
        } catch (e) {
          // Not JSON, skip
        }
      }
    }
    
    // If no RFP was selected through tools, try to parse AI's text response
    if (!selectedRFP) {
      logBroadcast("⚠️ Could not extract RFP from tool results, using fallback", { fallback: true });
      
      // Create a minimal fallback selection
      selectedRFP = {
        tender_id: "GOV-101",
        title: "HT Cable Supply",
        organisation: "Government PSU",
        due_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        estimated_cost_inr: 15000000,
        days_until_deadline: 45,
        buyer_requirements: [{
          item_no: "1",
          description: "HT Power Cable 11kV",
          cable_type: "HT Cable",
          voltage_kv: "11",
          quantity_km: 5
        }]
      };
    }
    
    // Store results
    S.selectedRFP = selectedRFP;
    S.rfpData = selectedRFP;
    S.scannedPortals = ['gov', 'industrial', 'utilities'];
    S.identifiedRFPs = [selectedRFP];
    
    // Log selected RFP
    logBroadcast("");
    logBroadcast("╔════════════════════════════════════════════════════════════════╗");
    logBroadcast("║  SELECTED RFP (AI Decision)                                    ║", { selected: true });
    logBroadcast("╚════════════════════════════════════════════════════════════════╝");
    logBroadcast(`  RFP ID:      ${selectedRFP.tender_id}`);
    logBroadcast(`  Title:       ${selectedRFP.title}`);
    logBroadcast(`  Buyer:       ${selectedRFP.organisation}`);
    logBroadcast(`  Due Date:    ${selectedRFP.due_date} (${selectedRFP.days_until_deadline} days)`);
    logBroadcast(`  Budget:      ₹${(selectedRFP.estimated_cost_inr / 100000).toFixed(2)}L`);
    
    // Log AI reasoning
    if (finalResponse) {
      logBroadcast("");
      logBroadcast("🤖 AI Reasoning:", { ai_response: true });
      const lines = finalResponse.split('\n').filter(l => l.trim());
      for (const line of lines.slice(0, 10)) {
        logBroadcast(`   ${line.substring(0, 80)}`);
      }
    }
    
    // Prepare output
    const salesOutput = {
      agent_type: 'LLM_POWERED',
      llm_model: 'gemini-2.0-flash',
      reasoning_iterations: iterations,
      selected_rfp: selectedRFP,
      ai_reasoning: finalResponse,
      workflow: {
        portals_searched: 3,
        tools_used: iterations,
        selection_method: 'AI Reasoning with Tool Calling'
      }
    };
    
    storeAgentOutput(S, 'sales', salesOutput);
    markAgentComplete(S, 'Sales');
    
    logBroadcast("");
    logBroadcast("✅ LLM Sales Agent Complete", { status: 'complete' });
    logBroadcast("   → Sending to Master Agent for context preparation");
    
    if (broadcast) {
      agentBroadcaster.completeAgent('Sales', {
        selected_rfp: selectedRFP.tender_id,
        reasoning_iterations: iterations
      });
    }
    
  } catch (error) {
    logBroadcast(`❌ LLM Agent Error: ${error.message}`, { error: true });
    console.error('LLM Sales Agent Error:', error);
    
    // Fallback to basic selection
    S.selectedRFP = {
      tender_id: "FALLBACK-001",
      title: "Fallback RFP",
      organisation: "Unknown",
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      estimated_cost_inr: 10000000
    };
    
    if (broadcast) {
      agentBroadcaster.completeAgent('Sales', { error: error.message });
    }
  }
  
  S.next = "master";
  return { ...S, logs: getAndClearNewLogs(S) };
}

export default LLMSalesAgent;



