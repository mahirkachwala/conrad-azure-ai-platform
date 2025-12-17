/**
 * Sales Agent (Worker Agent)
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * NEW WORKFLOW (PDF → JSON → Analyze):
 * 1. Scans portal URLs to find RFP PDFs
 * 2. Downloads each PDF and extracts structured JSON
 * 3. Identifies RFPs due in next 90 days
 * 4. Selects ONE RFP for response
 * 5. Sends selected RFP JSON to Master Agent
 * 
 * This workflow is displayed in the orchestration page showing:
 * - Original PDF link
 * - Extracted JSON data
 * - Selection rationale
 */

import { pushLog, getAndClearNewLogs, storeAgentOutput, markAgentComplete } from "../state.js";
import { Tools } from "../tools.js";
import { formatLakhsCrores } from "../../services/table-formatter.js";
import { agentBroadcaster } from "../../services/agent-broadcast.js";
import { parseRFPWithAI, parseRFPComplete } from "../../services/pdf-parser.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Predefined portal URLs to scan (simulating real tender portals)
const PORTAL_URLS = [
  { id: 'gov', name: 'Government Procurement Portal', url: '/portals/gov.html', type: 'government', json_file: 'gov.json' },
  { id: 'utilities', name: 'Utilities & Infrastructure Hub', url: '/portals/utilities.html', type: 'utility', json_file: 'utilities.json' },
  { id: 'industrial', name: 'Industrial Supply Network', url: '/portals/industrial.html', type: 'private', json_file: 'industrial.json' }
];

export async function SalesAgent(S) {
  const broadcast = S.broadcast !== false;
  
  // Helper to log and broadcast
  const logBroadcast = (msg, data = {}) => {
    pushLog(S, msg, "Sales");
    if (broadcast) agentBroadcaster.log('Sales', msg, data);
  };
  
  logBroadcast("");
  logBroadcast("============================================================");
  logBroadcast("SALES AGENT: PDF --> JSON --> Analysis Workflow", { phase: 'start' });
  logBroadcast("============================================================");
  
  // ========================================
  // STEP 1: SCAN PORTAL URLs FOR PDFs
  // ========================================
  logBroadcast("");
  logBroadcast("[Step 1/5] Scanning portal URLs for RFP PDFs...", { step: 1, action: 'scan_portals' });
  
  S.scannedPortals = [];
  S.discoveredPDFs = [];
  
  for (const portal of PORTAL_URLS) {
    logBroadcast(`   Scanning: ${portal.name}`, { portal: portal.id });
    
    // Read the portal JSON data
    const jsonPath = path.join(__dirname, '../../public/data/portals', portal.json_file);
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      
      // Each tender has a PDF
      const pdfs = data.map(tender => ({
        tender_id: tender.tender_id,
        title: tender.title,
        pdf_url: tender.pdf_url || `/rfps/${tender.tender_id}.pdf`,
        portal: portal.id,
        portal_name: portal.name,
        due_date: tender.due_date,
        estimated_cost: tender.estimated_cost_inr,
        organisation: tender.organisation
      }));
      
      S.discoveredPDFs = S.discoveredPDFs.concat(pdfs);
      S.scannedPortals.push({
        ...portal,
        scanned_at: new Date().toISOString(),
        pdfs_found: pdfs.length,
        status: 'scanned'
      });
      
      logBroadcast(`      Found ${pdfs.length} RFP PDFs`, { count: pdfs.length });
    } catch (error) {
      logBroadcast(`      Error scanning portal: ${error.message}`, { error: true });
    }
  }
  
  logBroadcast(`   Total PDFs discovered: ${S.discoveredPDFs.length}`, { total: S.discoveredPDFs.length });
  
  // ========================================
  // STEP 2: FILTER BY 90-DAY DEADLINE
  // ========================================
  logBroadcast("");
  logBroadcast("[Step 2/5] Filtering RFPs due within 90 days...", { step: 2, action: 'filter' });
  
  const now = new Date();
  const deadlineCutoff = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  
  S.filteredPDFs = S.discoveredPDFs.filter(pdf => {
    const dueDate = new Date(pdf.due_date);
    return dueDate > now && dueDate <= deadlineCutoff;
  }).map(pdf => ({
    ...pdf,
    days_until_deadline: Math.ceil((new Date(pdf.due_date) - now) / (1000 * 60 * 60 * 24))
  }));
  
  logBroadcast(`   Filtered to ${S.filteredPDFs.length} RFPs within deadline window`, { count: S.filteredPDFs.length });
  
  if (S.filteredPDFs.length === 0) {
    logBroadcast("   [WARNING] No RFPs found within 90-day window", { error: true });
    if (broadcast) agentBroadcaster.completeAgent('Sales', { error: 'no_rfps_found' });
    S.next = "end";
    return { ...S, logs: getAndClearNewLogs(S) };
  }
  
  // ========================================
  // STEP 3: DOWNLOAD & PARSE PDFs TO JSON
  // ========================================
  logBroadcast("");
  logBroadcast("[Step 3/5] Converting PDFs to JSON (AI Extraction)...", { step: 3, action: 'pdf_to_json' });
  logBroadcast("   This step extracts structured data from each PDF");
  logBroadcast("");
  
  S.parsedRFPs = [];
  const maxToParse = Math.min(10, S.filteredPDFs.length); // Limit for performance
  
  for (let i = 0; i < maxToParse; i++) {
    const pdf = S.filteredPDFs[i];
    logBroadcast(`   [${i + 1}/${maxToParse}] Processing: ${pdf.tender_id}`, { 
      tender_id: pdf.tender_id,
      pdf_url: pdf.pdf_url 
    });
    
    try {
      // Read the PDF file
      const pdfPath = path.join(__dirname, '../../public', pdf.pdf_url);
      
      if (fs.existsSync(pdfPath)) {
        // Parse PDF to JSON using AI
        const parseResult = await parseRFPWithAI(pdfPath);
        
        if (parseResult.success) {
          const extractedJson = {
            // Original PDF reference
            source_pdf: {
              url: pdf.pdf_url,
              tender_id: pdf.tender_id,
              portal: pdf.portal_name
            },
            
            // Extracted data
            rfp_id: parseResult.summary?.rfp_id || pdf.tender_id,
            buyer_name: parseResult.summary?.buyer_name || pdf.organisation,
            buyer_type: parseResult.summary?.buyer_type || 'Unknown',
            project_name: parseResult.summary?.project_name || pdf.title,
            due_date: parseResult.summary?.due_date || pdf.due_date,
            estimated_budget: parseResult.summary?.estimated_budget || pdf.estimated_cost,
            delivery_location: parseResult.summary?.delivery_location || parseResult.summary?.location,
            delivery_timeline_days: parseResult.summary?.delivery_timeline_days || 60,
            
            // Buyer requirements (the key data for Technical Agent)
            buyer_requirements: parseResult.summary?.buyer_requirements || 
                               parseResult.summary?.scope || [{
                                 item_no: '1',
                                 description: pdf.title,
                                 cable_type: determineCableType(pdf.title),
                                 quantity_km: 5
                               }],
            
            // Tests required (for Pricing Agent)
            tests_required: parseResult.summary?.tests_required || [],
            
            // Third-party inspection requirements
            third_party_inspection: parseResult.summary?.third_party_inspection || {
              required: true,
              agency: 'CPRI/ERDA'
            },
            
            // Submission instructions (for Submission Agent)
            submission: parseResult.summary?.submission || {
              mode: 'EMAIL_FORM',
              email_to: 'procurement@buyer.org'
            },
            
            // Extraction metadata
            extraction_method: parseResult.extraction_method,
            num_pages: parseResult.num_pages,
            extracted_at: new Date().toISOString()
          };
          
          // Calculate qualification score
          extractedJson.qualification_score = calculateQualificationScore(
            extractedJson, 
            pdf.days_until_deadline
          );
          extractedJson.days_until_deadline = pdf.days_until_deadline;
          
          S.parsedRFPs.push(extractedJson);
          
          logBroadcast(`      [OK] Extracted using ${parseResult.extraction_method}`, {
            tender_id: pdf.tender_id,
            extraction_method: parseResult.extraction_method,
            requirements_count: extractedJson.buyer_requirements?.length || 0
          });
          
          // Show clickable link info in orchestration
          if (broadcast) {
            agentBroadcaster.log('Sales', `PDF_TO_JSON: ${pdf.tender_id}`, {
              type: 'pdf_conversion',
              pdf_url: pdf.pdf_url,
              json_preview: {
                rfp_id: extractedJson.rfp_id,
                buyer: extractedJson.buyer_name,
                requirements: extractedJson.buyer_requirements?.length || 0,
                submission_mode: extractedJson.submission?.mode
              }
            });
          }
        } else {
          logBroadcast(`      [WARN] Parse failed, using metadata`, { error: parseResult.error });
          // Use basic metadata from portal
          S.parsedRFPs.push({
            source_pdf: { url: pdf.pdf_url, tender_id: pdf.tender_id, portal: pdf.portal_name },
            rfp_id: pdf.tender_id,
            buyer_name: pdf.organisation,
            project_name: pdf.title,
            due_date: pdf.due_date,
            estimated_budget: pdf.estimated_cost,
            buyer_requirements: [{ item_no: '1', description: pdf.title, cable_type: determineCableType(pdf.title) }],
            qualification_score: 50,
            days_until_deadline: pdf.days_until_deadline,
            extraction_method: 'METADATA_ONLY'
          });
        }
      } else {
        logBroadcast(`      [SKIP] PDF file not found`, { path: pdfPath });
      }
    } catch (error) {
      logBroadcast(`      [ERROR] ${error.message}`, { error: true });
    }
  }
  
  logBroadcast("");
  logBroadcast(`   Successfully parsed ${S.parsedRFPs.length} PDFs to JSON`, { count: S.parsedRFPs.length });
  
  // ========================================
  // STEP 4: RANK AND SELECT BEST RFP
  // ========================================
  logBroadcast("");
  logBroadcast("[Step 4/5] Ranking RFPs and selecting best opportunity...", { step: 4, action: 'rank_select' });
  
  // Sort by qualification score
  const rankedRFPs = S.parsedRFPs.sort((a, b) => b.qualification_score - a.qualification_score);
  
  logBroadcast("");
  logBroadcast("+----------+------------------------------+----------+------------+-------+");
  logBroadcast("| RFP ID   | Buyer                        | Days Left| Budget     | Score |");
  logBroadcast("+----------+------------------------------+----------+------------+-------+");
  
  const topRFPs = rankedRFPs.slice(0, 5);
  topRFPs.forEach((rfp, i) => {
    const id = (rfp.rfp_id || '').substring(0, 8).padEnd(8);
    const buyer = (rfp.buyer_name || '').substring(0, 28).padEnd(28);
    const days = String(rfp.days_until_deadline || 0).padStart(5) + ' d';
    const budget = formatLakhsCrores(rfp.estimated_budget || 0).padStart(10);
    const score = String(rfp.qualification_score || 0).padStart(3) + '/100';
    logBroadcast(`| ${id} | ${buyer} |  ${days} | ${budget} | ${score} |`, { 
      rfp_id: rfp.rfp_id,
      rank: i + 1 
    });
  });
  
  logBroadcast("+----------+------------------------------+----------+------------+-------+");
  
  // Select the top RFP
  const selectedRFP = rankedRFPs[0];
  
  if (!selectedRFP) {
    logBroadcast("   [ERROR] No suitable RFP found for selection", { error: true });
    if (broadcast) agentBroadcaster.completeAgent('Sales', { error: 'no_suitable_rfp' });
    S.next = "end";
    return { ...S, logs: getAndClearNewLogs(S) };
  }
  
  S.selectedRFP = selectedRFP;
  S.rfpData = selectedRFP;
  
  logBroadcast("");
  logBroadcast("================================================================");
  logBroadcast("  SELECTED RFP FOR BID RESPONSE", { selected: true });
  logBroadcast("================================================================");
  logBroadcast(`  RFP ID:         ${selectedRFP.rfp_id}`);
  logBroadcast(`  Source PDF:     ${selectedRFP.source_pdf?.url}`);
  logBroadcast(`  Buyer:          ${selectedRFP.buyer_name}`);
  logBroadcast(`  Project:        ${selectedRFP.project_name}`);
  logBroadcast(`  Due Date:       ${formatDate(selectedRFP.due_date)} (${selectedRFP.days_until_deadline} days)`);
  logBroadcast(`  Budget:         ${formatLakhsCrores(selectedRFP.estimated_budget)}`);
  logBroadcast(`  Requirements:   ${selectedRFP.buyer_requirements?.length || 0} line items`);
  logBroadcast(`  Submission:     ${selectedRFP.submission?.mode || 'Unknown'}`);
  logBroadcast(`  Score:          ${selectedRFP.qualification_score}/100`);
  logBroadcast("================================================================");
  
  // ========================================
  // STEP 5: PREPARE OUTPUT FOR MASTER AGENT
  // ========================================
  logBroadcast("");
  logBroadcast("[Step 5/5] Preparing structured output for Master Agent...", { step: 5, action: 'prepare_output' });
  
  const salesOutput = {
    // Workflow metadata
    workflow: {
      portals_scanned: S.scannedPortals.length,
      pdfs_discovered: S.discoveredPDFs.length,
      pdfs_within_deadline: S.filteredPDFs.length,
      pdfs_parsed: S.parsedRFPs.length,
      selection_method: 'Qualification Score Ranking'
    },
    
    // PDF → JSON conversion proof (for orchestration display)
    pdf_to_json_conversions: S.parsedRFPs.slice(0, 5).map(rfp => ({
      pdf_url: rfp.source_pdf?.url,
      tender_id: rfp.rfp_id,
      extraction_method: rfp.extraction_method,
      extracted_fields: Object.keys(rfp).filter(k => k !== 'source_pdf').length
    })),
    
    // Selected RFP (full JSON)
    selected_rfp: selectedRFP,
    
    // Key data for other agents
    for_technical_agent: {
      buyer_requirements: selectedRFP.buyer_requirements,
      delivery_location: selectedRFP.delivery_location,
      delivery_timeline_days: selectedRFP.delivery_timeline_days
    },
    
    for_pricing_agent: {
      tests_required: selectedRFP.tests_required,
      third_party_inspection: selectedRFP.third_party_inspection,
      estimated_budget: selectedRFP.estimated_budget
    },
    
    for_submission_agent: {
      submission: selectedRFP.submission,
      due_date: selectedRFP.due_date,
      buyer_contact: selectedRFP.submission?.email_to || selectedRFP.submission?.meeting_email
    }
  };
  
  storeAgentOutput(S, 'sales', salesOutput);
  markAgentComplete(S, 'Sales');
  
  logBroadcast("");
  logBroadcast("[COMPLETE] Sales Agent workflow finished", { status: 'complete' });
  logBroadcast("   --> Sending extracted JSON to Master Agent");
  logBroadcast("   --> Master will distribute to Technical + Pricing Agents");
  
  if (broadcast) {
    agentBroadcaster.completeAgent('Sales', {
      ...salesOutput,
      summary: `Selected ${selectedRFP.rfp_id} from ${S.parsedRFPs.length} parsed RFPs`
    });
  }
  
  // Continue to Master Agent
  S.next = "master";
  return { ...S, logs: getAndClearNewLogs(S) };
}

/**
 * Calculate qualification score for RFP selection
 */
function calculateQualificationScore(rfp, daysUntilDeadline) {
  let score = 0;
  
  // Time factor (max 30 points)
  if (daysUntilDeadline >= 30 && daysUntilDeadline <= 60) {
    score += 30;
  } else if (daysUntilDeadline > 60) {
    score += 25;
  } else if (daysUntilDeadline >= 14) {
    score += 15;
  } else {
    score += 5;
  }
  
  // Budget factor (max 25 points)
  const budget = rfp.estimated_budget || 0;
  if (budget >= 50000000) score += 25;
  else if (budget >= 10000000) score += 20;
  else if (budget >= 5000000) score += 15;
  else if (budget >= 1000000) score += 10;
  else score += 5;
  
  // Requirements clarity (max 20 points)
  const reqCount = rfp.buyer_requirements?.length || 0;
  if (reqCount > 0) {
    score += Math.min(20, reqCount * 5 + 10);
  }
  
  // Submission mode clarity (max 15 points)
  if (rfp.submission?.mode) {
    score += 15;
  }
  
  // Extraction quality (max 10 points)
  if (rfp.extraction_method === 'OPENAI_GPT' || rfp.extraction_method === 'GEMINI_AI') {
    score += 10;
  } else if (rfp.extraction_method === 'PATTERN_MATCHING') {
    score += 5;
  }
  
  return Math.min(100, score);
}

/**
 * Determine cable type from title
 */
function determineCableType(title) {
  const lower = (title || '').toLowerCase();
  
  if (lower.includes('ehv') || lower.includes('66kv') || lower.includes('110kv')) return 'EHV Cable';
  if (lower.includes('ht') || lower.includes('11kv') || lower.includes('22kv') || lower.includes('33kv')) return 'HT Cable';
  if (lower.includes('control')) return 'Control Cable';
  if (lower.includes('instrument')) return 'Instrumentation Cable';
  if (lower.includes('lt') || lower.includes('1.1kv')) return 'LT Cable';
  
  return 'Power Cable';
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric' 
  });
}
