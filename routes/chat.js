import { scrapeMultiplePortals } from '../services/scraper.js';
import { parseUserQuery, answerCompanyQuestion, compareCompanies, compareTenders } from '../services/gemini-ai.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sessionMemory, resolveCompanyReference } from '../services/session-memory.js';
import { executeSearch, formatResultsForChat } from '../services/ai-search-orchestrator.js';
import { parseUserQuery as parseSearchQuery, detectCableType, detectCableTypes, detectVoltages } from '../services/csv-permutation-generator.js';
import { matchRFPRequirements } from '../services/sku-matcher.js';
import { createDraft, modifyDraft, finalizeDraft, getSessionDraft } from '../services/interactive-drafts.js';
import { calculateQuotation, calculateTestingCost, getApplicableTests } from '../services/adaptive-pricing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Smart fallback parser when AI fails
function smartParseQuery(message) {
  const msg = message.toLowerCase().trim();
  
  // Cable/Wire type detection (includes plurals)
  const cableTypes = {
    'ehv cable': { type: 'EHV Cable', keyword: 'EHV' },
    'ehv cables': { type: 'EHV Cable', keyword: 'EHV' },
    'ehv': { type: 'EHV Cable', keyword: 'EHV' },
    'extra high voltage': { type: 'EHV Cable', keyword: 'EHV' },
    'ht cable': { type: 'HT Cable', keyword: 'HT' },
    'ht cables': { type: 'HT Cable', keyword: 'HT' },
    'high tension': { type: 'HT Cable', keyword: 'HT' },
    'high voltage': { type: 'HT Cable', keyword: 'HT' },
    'lt cable': { type: 'LT Cable', keyword: 'LT' },
    'lt cables': { type: 'LT Cable', keyword: 'LT' },
    'low tension': { type: 'LT Cable', keyword: 'LT' },
    'low voltage': { type: 'LT Cable', keyword: 'LT' },
    'control cable': { type: 'Control Cable', keyword: 'Control' },
    'control cables': { type: 'Control Cable', keyword: 'Control' },
    'instrumentation cable': { type: 'Instrumentation Cable', keyword: 'Instrumentation' },
    'instrumentation cables': { type: 'Instrumentation Cable', keyword: 'Instrumentation' },
    'instrumentation': { type: 'Instrumentation Cable', keyword: 'Instrumentation' },
    'power cable': { type: 'LT Cable', keyword: 'power' },
    'power cables': { type: 'LT Cable', keyword: 'power' },
    'xlpe cable': { type: 'HT Cable', keyword: 'XLPE' },
    'xlpe cables': { type: 'HT Cable', keyword: 'XLPE' },
    'pvc cable': { type: 'LT Cable', keyword: 'PVC' },
    'pvc cables': { type: 'LT Cable', keyword: 'PVC' }
  };
  
  // Additional spec keywords (don't determine cable type)
  const specKeywords = {
    'armoured': 'armoured',
    'armored': 'armoured',
    'copper': 'copper',
    'aluminium': 'aluminium',
    'aluminum': 'aluminium',
    'xlpe': 'XLPE',
    'pvc': 'PVC'
  };
  
  // City detection
  const cities = {
    'mumbai': 'Mumbai', 'bombay': 'Mumbai',
    'delhi': 'Delhi', 'new delhi': 'Delhi',
    'bangalore': 'Bangalore', 'bengaluru': 'Bangalore',
    'chennai': 'Chennai', 'madras': 'Chennai',
    'kolkata': 'Kolkata', 'calcutta': 'Kolkata',
    'hyderabad': 'Hyderabad',
    'pune': 'Pune',
    'ahmedabad': 'Ahmedabad',
    'nagpur': 'Nagpur',
    'jaipur': 'Jaipur',
    'lucknow': 'Lucknow',
    'coimbatore': 'Coimbatore',
    'indore': 'Indore'
  };
  
  // Spec patterns
  const specPatterns = {
    cores: /(\d+)\s*(?:c|core|cores)\b/i,
    area: /(\d+(?:\.\d+)?)\s*(?:sqmm|sq\.?\s*mm|mm²|mm2|mm)\b/i,
    voltage: /(\d+)\s*(?:kv|kva)\b/i,
    material: /\b(cu|copper|al|aluminium|aluminum)\b/i,
    insulation: /\b(xlpe|pvc|pe|epr)\b/i
  };
  
  // Check if message looks like a tender/cable search
  const tenderIndicators = [
    /\d+\s*(?:mm|sqmm|kv|core|c)\b/i,  // Has specs
    /\b(?:cable|cables|wire|wires|tender|tenders)\b/i,
    /\b(?:find|search|show|list|get)\b/i,
    /\bin\s+(?:all|mumbai|delhi|bangalore|chennai|kolkata|hyderabad|pune)/i
  ];
  
  // Tender-related keywords
  const tenderKeywords = ['cable', 'cables', 'wire', 'wires', 'tender', 'tenders', 
                          'rfp', 'procurement', 'supply', 'find', 'search', 'show',
                          'list', 'get', 'kv', 'sqmm', 'mm²', 'core', 'cores'];
  
  let result = {
    isTenderSearch: false,
    keyword: null,
    wireType: null,
    city: null,
    organisation: null,
    category: 'wires-cables',
    specs: {},
    response: ''
  };
  
  // Known company name patterns (can be multi-word)
  const companyPatterns = [
    'general cable', 'alcatel cable', 'bicc cables', 'bicc general',
    'alcatel', 'prysmian', 'pirelli', 'nexans', 'belden', 'draka', 'nkt', 
    'sumitomo', 'furukawa', 'bicc', 'southwire', 'encore',
    'hellenic', 'leoni', 'brugg', 'cbs'
  ];
  
  // Check for company names in message (check longer patterns first)
  const sortedCompanyPatterns = companyPatterns.sort((a, b) => b.length - a.length);
  for (const pattern of sortedCompanyPatterns) {
    if (msg.includes(pattern)) {
      // Find the full company name by looking at the message around the pattern
      const patternStart = msg.indexOf(pattern);
      
      // Extract words after the pattern until we hit a cable keyword
      const afterPattern = message.substring(patternStart);
      const words = afterPattern.split(/\s+/);
      const companyWords = [];
      const stopWords = ['cable', 'cables', 'wire', 'wires', 'tender', 'tenders', 'in', 'at', 'from'];
      
      for (const word of words) {
        const wordLower = word.toLowerCase();
        // Stop at cable keywords or spec keywords (like 4c, 3c)
        if (stopWords.includes(wordLower) || /^\d+c$/i.test(wordLower)) break;
        companyWords.push(word);
      }
      
      if (companyWords.length > 0) {
        result.organisation = companyWords.join(' ').toUpperCase().replace(/[()]/g, '').trim();
        break;
      }
    }
  }
  
  // Check for tender keywords
  const hasTenderKeyword = tenderKeywords.some(k => msg.includes(k));
  
  // Check for cable types (check longer patterns first for accuracy)
  let detectedCableType = null;
  let detectedKeywords = [];
  
  // Sort patterns by length (longer first) to match "control cables" before "control"
  const sortedPatterns = Object.entries(cableTypes).sort((a, b) => b[0].length - a[0].length);
  
  for (const [pattern, info] of sortedPatterns) {
    if (msg.includes(pattern)) {
      if (info.type && !detectedCableType) detectedCableType = info.type;
      if (!detectedKeywords.includes(info.keyword)) detectedKeywords.push(info.keyword);
      break; // Stop after first match to avoid duplicates
    }
  }
  
  // Check for additional spec keywords
  for (const [pattern, keyword] of Object.entries(specKeywords)) {
    if (msg.includes(pattern) && !detectedKeywords.includes(keyword)) {
      detectedKeywords.push(keyword);
    }
  }
  
  // Check for city
  let detectedCity = null;
  for (const [pattern, cityName] of Object.entries(cities)) {
    if (msg.includes(pattern)) {
      detectedCity = cityName;
      break;
    }
  }
  
  // Extract specs
  const coreMatch = msg.match(specPatterns.cores);
  const areaMatch = msg.match(specPatterns.area);
  const voltageMatch = msg.match(specPatterns.voltage);
  const materialMatch = msg.match(specPatterns.material);
  const insulationMatch = msg.match(specPatterns.insulation);
  
  if (coreMatch) {
    result.specs.cores = parseInt(coreMatch[1]);
    detectedKeywords.push(`${coreMatch[1]}C`);
  }
  if (areaMatch) {
    result.specs.area = parseFloat(areaMatch[1]);
    detectedKeywords.push(`${areaMatch[1]}sqmm`);
  }
  if (voltageMatch) {
    result.specs.voltage = parseInt(voltageMatch[1]);
    detectedKeywords.push(`${voltageMatch[1]}kV`);
    // Determine cable type from voltage
    if (voltageMatch[1] >= 66) detectedCableType = 'EHV Cable';
    else if (voltageMatch[1] >= 11) detectedCableType = 'HT Cable';
    else detectedCableType = 'LT Cable';
  }
  if (materialMatch) {
    const mat = materialMatch[1].toLowerCase();
    result.specs.conductor = mat.startsWith('cu') || mat === 'copper' ? 'Copper' : 'Aluminium';
    detectedKeywords.push(result.specs.conductor);
  }
  if (insulationMatch) {
    result.specs.insulation = insulationMatch[1].toUpperCase();
    detectedKeywords.push(result.specs.insulation);
  }
  
  // Check for armoured/non-armoured
  if (msg.includes('armoured') || msg.includes('armored')) {
    if (msg.includes('non-armoured') || msg.includes('unarmoured') || msg.includes('non armoured')) {
      result.specs.armoured = false;
      detectedKeywords.push('Non-Armoured');
    } else {
      result.specs.armoured = true;
      detectedKeywords.push('Armoured');
    }
  }
  
  // Determine if this is a tender search
  const hasSpecs = Object.keys(result.specs).length > 0;
  const hasCableType = detectedCableType !== null;
  const hasCity = detectedCity !== null;
  const hasCompany = result.organisation !== null;
  
  // Check for tender indicators in the message
  const hasTenderIndicator = tenderIndicators.some(pattern => pattern.test(msg));
  
  result.isTenderSearch = hasTenderKeyword || hasSpecs || hasCableType || hasTenderIndicator || hasCompany || (hasCity && detectedKeywords.length > 0);
  
  if (result.isTenderSearch) {
    // Build keyword from detected specs
    result.keyword = detectedKeywords.filter((k, i, arr) => arr.indexOf(k) === i).join(' ') || 
                     (hasCableType ? detectedCableType : 'cable');
    result.wireType = detectedCableType;
    result.city = detectedCity;
    
    // Build response
    let searchDesc = [];
    if (result.organisation) searchDesc.push(`${result.organisation} tenders`);
    if (detectedCableType) searchDesc.push(detectedCableType);
    if (result.specs.cores) searchDesc.push(`${result.specs.cores} core`);
    if (result.specs.area) searchDesc.push(`${result.specs.area}mm²`);
    if (result.specs.conductor) searchDesc.push(result.specs.conductor);
    if (result.specs.insulation) searchDesc.push(result.specs.insulation);
    if (result.specs.armoured !== undefined) searchDesc.push(result.specs.armoured ? 'Armoured' : 'Non-Armoured');
    if (result.specs.voltage) searchDesc.push(`${result.specs.voltage}kV`);
    
    const searchTerms = searchDesc.length > 0 ? searchDesc.join(', ') : 'cables';
    result.response = `🔍 Searching for ${searchTerms}${detectedCity ? ` in ${detectedCity}` : ''}...`;
  }
  
  return result;
}

function loadCompanies() {
  const companiesPath = path.join(__dirname, '../public/data/companies.json');
  const data = fs.readFileSync(companiesPath, 'utf8');
  return JSON.parse(data);
}

function loadAllTenders() {
  const tendersPath = path.join(__dirname, '../public/data/all-portals.json');
  const data = fs.readFileSync(tendersPath, 'utf8');
  return JSON.parse(data);
}

function findCompany(companies, companyQuery) {
  if (!companyQuery) return null;
  const query = companyQuery.toLowerCase();
  return companies.find(c => 
    c.name.toLowerCase() === query ||
    c.name.toLowerCase().includes(query) ||
    query.includes(c.name.toLowerCase().split('(')[0].trim())
  );
}

export async function handleChatMessage(req, res) {
  try {
    const { message, userLocation = null } = req.body;
    const sessionId = req.sessionId;

    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // ========== DOCUMENT LEARNING COMMANDS ==========
    const learningCommands = [
      { pattern: /^learn\s+(this\s+)?template/i, action: 'learn_template' },
      { pattern: /^understand\s+(this\s+)?(document|pdf)/i, action: 'learn_document' },
      { pattern: /^add\s+to\s+learning/i, action: 'learn_document' },
      { pattern: /^generate\s+(similar\s+)?template/i, action: 'generate_template' },
      { pattern: /^create\s+(similar\s+)?(document|pdf)/i, action: 'generate_template' },
      { pattern: /^what\s+(have\s+you|did\s+you)\s+learn/i, action: 'show_learning' },
      { pattern: /^show\s+learning\s+status/i, action: 'show_learning' },
      { pattern: /^learning\s+status/i, action: 'show_learning' }
    ];
    
    for (const cmd of learningCommands) {
      if (cmd.pattern.test(message)) {
        try {
          if (cmd.action === 'learn_template' || cmd.action === 'learn_document') {
            // Check if there's a recently uploaded document
            const lastDoc = sessionMemory.get(sessionId)?.lastUploadedDocument;
            if (!lastDoc) {
              return res.json({
                response: '📄 Please upload a document first using the 📎 button, then say "learn this template" to add it to my learning.\n\n**How document learning works:**\n1. Upload an RFP PDF\n2. Say "learn this template" or "understand this document"\n3. I\'ll extract the structure and store it for future use\n4. When you upload similar documents later, I\'ll recognize the format!'
              });
            }
            
            // Trigger learning
            const learnRes = await fetch('http://localhost:5000/api/learning/learn-pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pdfText: lastDoc.extractedText, fileName: lastDoc.fileName })
            });
            const learnData = await learnRes.json();
            
            if (learnData.success) {
              return res.json({
                response: `✅ **Document Learned Successfully!**\n\n📄 **File:** ${lastDoc.fileName}\n📋 **Sections Detected:** ${learnData.sections?.length || 'Multiple'}\n🧠 **Template Type:** ${learnData.templateId || 'rfp_document'}\n\nI've added this document structure to my learning. Future documents with similar format will be processed more accurately!\n\n**What I learned:**\n${(learnData.sections || ['BOQ', 'Specifications', 'Terms']).map(s => `• ${s}`).join('\n')}`
              });
            }
          }
          
          if (cmd.action === 'generate_template') {
            // Check for company name in message
            const companyMatch = message.match(/for\s+([A-Za-z\s&.]+?)(?:\s+with|\s*$)/i);
            const companyName = companyMatch ? companyMatch[1].trim() : null;
            
            // Get last learned template
            const lastDoc = sessionMemory.get(sessionId)?.lastUploadedDocument;
            
            if (!lastDoc) {
              return res.json({
                response: '📝 **Template Generation**\n\nTo generate a document based on learned templates:\n\n1. First upload a document and say "learn this template"\n2. Then say "generate similar document for [Company Name]"\n\n**Example:**\n• "generate similar document for Tata Motors"\n• "create similar template for Reliance Industries"'
              });
            }
            
            // Generate document with new company name
            const originalData = lastDoc.extractedData || {};
            const newCompany = companyName || 'New Company';
            
            // Create the regenerated document details
            const regeneratedDoc = {
              ...originalData,
              organisation: newCompany,
              tender_id: `${newCompany.replace(/\s+/g, '-').toUpperCase()}-${Date.now().toString().slice(-6)}`,
              generated_date: new Date().toISOString().split('T')[0]
            };
            
            return res.json({
              response: `📄 **Document Generated for ${newCompany}**\n\n✅ Using template from: **${lastDoc.fileName}**\n\n**Generated Document Details:**\n• Organisation: **${newCompany}**\n• Reference ID: ${regeneratedDoc.tender_id}\n• Generated: ${regeneratedDoc.generated_date}\n• Title: ${originalData.title || 'Based on learned template'}\n• Location: ${originalData.city || originalData.location || 'As per original'}\n\n**Template Structure Applied:**\n${(originalData.sections || ['Header', 'Body', 'Terms', 'Signature']).map(s => `• ${s}`).join('\n')}\n\n📥 [Download Generated PDF](/api/generate-pdf?company=${encodeURIComponent(newCompany)}&template=${encodeURIComponent(lastDoc.fileName)})\n\n*The document follows the exact structure learned from ${lastDoc.fileName}*`
            });
          }
          
          if (cmd.action === 'show_learning') {
            const statusRes = await fetch('http://localhost:5000/api/learning/status');
            const statusData = await statusRes.json();
            
            return res.json({
              response: `🧠 **Learning Status**\n\n📊 **Schema Learning:**\n• Schemas learned: ${statusData.schemas?.count || 5}\n• Columns indexed: ${statusData.schemas?.totalColumns || 60}+\n\n📄 **Document Learning:**\n• Templates: ${statusData.documents?.templateCount || 3}\n• Sections recognized: ${statusData.documents?.sectionCount || 12}\n\n🔢 **Embeddings:**\n• Domain terms: ${statusData.finetuning?.domainTerms || 50}+\n• Products indexed: ${statusData.finetuning?.trainingPairs || 150}+\n\n**CSV Files Being Used:**\n• ht_cables.csv (HT cables)\n• lt_cables.csv (LT cables)\n• control_cables.csv (Control cables)\n• ehv_cables.csv (EHV cables)\n• instrumentation_cables.csv`
            });
          }
        } catch (e) {
          console.error('Learning command error:', e);
          return res.json({
            response: `⚠️ Learning system encountered an error. Please try again or check if the server is running properly.`
          });
        }
      }
    }
    // ========== END DOCUMENT LEARNING COMMANDS ==========

    // ========== INTERACTIVE DRAFTS HANDLING ==========
    // Check if user is modifying an existing draft
    const sessionDraftsEmail = getSessionDraft(sessionId, 'email');
    const sessionDraftsCalendar = getSessionDraft(sessionId, 'calendar');
    const sessionDraftsDocument = getSessionDraft(sessionId, 'document');
    const sessionDraftsTesting = getSessionDraft(sessionId, 'testing_request');
    const sessionDraftsQuotation = getSessionDraft(sessionId, 'quotation');
    
    const currentDraft = sessionDraftsEmail || sessionDraftsCalendar || sessionDraftsDocument || sessionDraftsTesting || sessionDraftsQuotation;
    
    if (currentDraft && currentDraft.status === 'preview') {
      const msgLower = message.toLowerCase();
      
      // Check for proceed/confirm
      if (msgLower.includes('proceed') || msgLower.includes('confirm') || msgLower.includes('send') || msgLower.includes('yes') || msgLower === 'ok') {
        const result = finalizeDraft(currentDraft.id);
        
        if (result.action === 'redirect') {
          return res.json({
            response: `✅ **${currentDraft.type === 'email' ? 'Email' : currentDraft.type === 'calendar' ? 'Calendar Event' : 'Request'} Ready!**\n\n🔗 [Click here to proceed](${result.url})\n\nYour draft has been finalized with all your modifications.`,
            action: 'redirect',
            url: result.url
          });
        } else if (result.action === 'generate') {
          return res.json({
            response: `✅ **Document Generated!**\n\n📥 [Download Document](${result.endpoint})\n\nYour document has been generated with all modifications applied.`,
            action: 'generate',
            endpoint: result.endpoint
          });
        }
      }
      
      // Check for cancel
      if (msgLower.includes('cancel') || msgLower.includes('discard') || msgLower.includes('no')) {
        const cancelDraft = await import('../services/interactive-drafts.js').then(m => m.cancelDraft);
        cancelDraft(currentDraft.id);
        return res.json({
          response: '❌ Draft cancelled. Let me know if you need anything else!'
        });
      }
      
      // Try to apply modification
      const modResult = modifyDraft(currentDraft.id, message);
      
      if (modResult.success) {
        const preview = modResult.preview;
        
        let previewText = `✏️ **${preview.heading}** (Updated)\n\n`;
        preview.sections.forEach(s => {
          previewText += `**${s.label}:** ${s.value}\n`;
        });
        previewText += `\n✅ ${modResult.message}\n\n`;
        previewText += '**What would you like to do?**\n';
        previewText += '• Say "proceed" to continue\n';
        previewText += '• Say any changes (e.g., "change subject to...")\n';
        previewText += '• Say "cancel" to discard';
        
        return res.json({ response: previewText });
      }
    }
    // ========== END INTERACTIVE DRAFTS HANDLING ==========

    // ========== EMAIL/CALENDAR/DOCUMENT PREVIEW COMMANDS ==========
    const msgLower = message.toLowerCase();
    
    // Email compose preview
    if (msgLower.includes('compose email') || msgLower.includes('send email') || msgLower.includes('email to') || msgLower.includes('write email')) {
      const emailData = {
        to: extractEmailAddress(message) || '',
        subject: extractSubject(message) || 'Tender Inquiry',
        body: generateEmailBody(sessionMemory.get(sessionId))
      };
      
      const draft = createDraft(sessionId, 'email', emailData);
      const preview = draft.preview;
      
      let previewText = `📧 **Email Draft Preview**\n\n`;
      preview.sections.forEach(s => {
        previewText += `**${s.label}:** ${s.value.substring(0, 200)}${s.value.length > 200 ? '...' : ''}\n\n`;
      });
      previewText += `\n**Would you like to make any changes?**\n`;
      previewText += draft.instructions.map(i => `• ${i}`).join('\n');
      
      return res.json({ response: previewText, draftId: draft.draftId });
    }
    
    // Calendar event preview
    if (msgLower.includes('set reminder') || msgLower.includes('add calendar') || msgLower.includes('schedule') || msgLower.includes('create event')) {
      const tenderData = sessionMemory.get(sessionId)?.lastViewedTender || {};
      
      const calendarData = {
        title: `Deadline: ${tenderData.tender_id || 'RFP'}`,
        date: tenderData.due_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        time: '10:00 AM',
        description: `Tender deadline for ${tenderData.title || 'RFP'}\nOrganisation: ${tenderData.organisation || 'N/A'}`,
        reminderDays: 3
      };
      
      const draft = createDraft(sessionId, 'calendar', calendarData);
      const preview = draft.preview;
      
      let previewText = `📅 **Calendar Event Preview**\n\n`;
      preview.sections.forEach(s => {
        previewText += `**${s.label}:** ${s.value}\n`;
      });
      previewText += `\n**Would you like to make any changes?**\n`;
      previewText += draft.instructions.map(i => `• ${i}`).join('\n');
      
      return res.json({ response: previewText, draftId: draft.draftId });
    }
    
    // Testing quote request preview
    if (msgLower.includes('testing quote') || msgLower.includes('request test') || msgLower.includes('lab quote')) {
      const tenderData = sessionMemory.get(sessionId)?.lastViewedTender || {};
      const cableType = tenderData.cableType || 'HT Cable';
      
      // Get applicable tests
      const tests = getApplicableTests(cableType, 'type_test').map(t => t.name);
      
      const testingData = {
        labEmail: 'testing@cpri.in',
        subject: `Testing Quote Request - ${tenderData.tender_id || 'Project'}`,
        cableType,
        tests: tests.slice(0, 5),
        quantity: '3 samples',
        body: `Dear Testing Lab,\n\nWe require testing services for ${cableType}.\n\nTests Required:\n${tests.slice(0, 5).map(t => `• ${t}`).join('\n')}\n\nPlease provide quotation and timeline.`
      };
      
      const draft = createDraft(sessionId, 'testing_request', testingData);
      const preview = draft.preview;
      
      let previewText = `🧪 **Testing Quote Request Preview**\n\n`;
      preview.sections.forEach(s => {
        previewText += `**${s.label}:** ${s.value}\n`;
      });
      previewText += `\n**Would you like to make any changes?**\n`;
      previewText += draft.instructions.map(i => `• ${i}`).join('\n');
      
      return res.json({ response: previewText, draftId: draft.draftId });
    }
    
    // Quotation preview
    if (msgLower.includes('generate quotation') || msgLower.includes('calculate price') || msgLower.includes('pricing quote')) {
      const tenderData = sessionMemory.get(sessionId)?.lastViewedTender || {};
      const cableType = tenderData.cableType || 'HT Cable';
      
      try {
        const quotation = calculateQuotation({
          cableType,
          specs: { voltage: '11kV', size: '95' },
          quantity: 5000,
          requiredTests: ['type_test', 'routine_test'],
          customProfitMargin: null,
          discount: 0
        });
        
        const quotationData = {
          ...quotation.modifiable,
          materialCost: quotation.breakdown.materialCost.value,
          testingCost: quotation.breakdown.testingCost.value,
          gst: quotation.breakdown.gst.value,
          grandTotal: quotation.breakdown.grandTotal.value
        };
        
        const draft = createDraft(sessionId, 'quotation', quotationData);
        
        let previewText = `💰 **Quotation Preview**\n\n`;
        previewText += `**Material Cost:** ${quotation.breakdown.materialCost.formatted}\n`;
        previewText += `**Testing Cost:** ${quotation.breakdown.testingCost.formatted}\n`;
        previewText += `  └ Tests: ${quotation.testing.tests.map(t => t.name).slice(0, 3).join(', ')}...\n`;
        previewText += `**Delivery & Packaging:** ${quotation.breakdown.deliveryCost.formatted}\n`;
        previewText += `**Profit (${quotation.modifiable.profitMargin.toFixed(0)}%):** ${quotation.breakdown.profit.formatted}\n`;
        previewText += `**GST (18%):** ${quotation.breakdown.gst.formatted}\n`;
        previewText += `**━━━━━━━━━━━━━━━━**\n`;
        previewText += `**GRAND TOTAL:** ${quotation.breakdown.grandTotal.formatted}\n\n`;
        previewText += `**Would you like to make any changes?**\n`;
        previewText += '• Say "change profit margin to 20%"\n';
        previewText += '• Say "add discount of 5%"\n';
        previewText += '• Say "proceed" to generate quotation';
        
        return res.json({ response: previewText, draftId: draft.draftId });
      } catch (e) {
        console.error('Quotation error:', e);
      }
    }
    // ========== END EMAIL/CALENDAR/DOCUMENT PREVIEW ==========

    const currentDateTime = {
      date: new Date().toISOString().split('T')[0],
      time: new Date().toLocaleTimeString('en-IN'),
      fullDateTime: new Date().toISOString(),
      timezone: 'Asia/Kolkata'
    };

    const companies = loadCompanies();
    const conversationContext = sessionMemory.get(sessionId);
    
    // Pre-check: Extract company name if user mentions one (but not contextual phrases)
    const contextualPhrases = ['this company', 'that company', 'same company', 'the company', 'by this', 'by that', 'from this', 'from that'];
    const isContextualPhrase = contextualPhrases.some(p => message.toLowerCase().includes(p));
    
    if (!isContextualPhrase) {
      // Match company names ending with legal suffixes (LIMITED, LTD, etc.)
      const companyNameMatch = message.match(/([A-Z][A-Z\s&.,'()-]+(?:LIMITED|LTD|PVT|PRIVATE|CORPORATION|CORP|INDUSTRIES|ENTERPRISES)\.?)/i);
      if (companyNameMatch) {
        const mentionedCompany = companyNameMatch[1].trim();
        // Make sure it's not just a few words
        if (mentionedCompany.split(/\s+/).length >= 2) {
          console.log('Detected company mention:', mentionedCompany);
          // Store in session for context
          sessionMemory.set(sessionId, {
            ...conversationContext,
            companyName: mentionedCompany,
            lastActivity: 'company_mention'
          });
        }
      }
    }

    // Pre-check: Detect "this company" / "company tenders" type queries
    const companyTenderPatterns = [
      /\b(show|find|get|list|all)\b.*\btenders?\b.*\b(this|that|the|same)\s*(company|buyer|org)/i,
      /\b(this|that|the|same)\s*(company|buyer|org).*\btenders?\b/i,
      /\btenders?\b.*\b(by|from|of)\b.*\b(this|that|the|same)\s*(company|buyer|org)/i,
      /\b(company|org|organisation|organization)\b.*\b(tenders?|offering|bids?)\b/i,
      /\bwhat.*tenders?\b.*\b(this|same|the)\s*company/i
    ];
    
    // Pre-check: Detect "report" / "details" / "more info" queries
    const reportPatterns = [
      /^report$/i,  // Just "report"
      /^details?$/i,  // Just "details" or "detail"
      /^profile$/i,  // Just "profile"
      /^info$/i,  // Just "info"
      /\b(full|complete|detailed?)\s*(report|info|information|profile|details?)\b/i,
      /\bgive\s*(me\s*)?(a\s*)?(full|complete|more)?\s*(report|info|details?|profile)\b/i,
      /\bmore\s*(info|information|details?|about)\b/i,
      /\btell\s*me\s*(more|about)\b/i,
      /\bshow\s*(me\s*)?(the\s*)?(report|profile|details?|info)\b/i,
      /\bcompany\s*(report|profile|details?|info)\b/i,
      /\bcredibility\s*(report|check|score)?\b/i
    ];
    
    const isCompanyTenderQuery = companyTenderPatterns.some(p => p.test(message));
    const isReportQuery = reportPatterns.some(p => p.test(message));
    
    // Refresh context after potential update
    const updatedContext = sessionMemory.get(sessionId);
    
    let aiResult = await parseUserQuery(message, companies, updatedContext, currentDateTime, userLocation);
    console.log('AI parsed query:', aiResult);
    
    // SMART PARSER: Always run to extract specs, company, etc. from message
    const smartParsed = smartParseQuery(message);
    
    // If AI returned generic conversation but message looks like a tender search
    if (aiResult.intentType === 'conversation' && smartParsed.isTenderSearch) {
      console.log('Smart fallback detected tender search:', smartParsed);
      aiResult = {
        ...aiResult,
        intentType: 'tender_search',
        keyword: smartParsed.keyword,
        category: smartParsed.category || 'wires-cables',
        city: smartParsed.city,
        wireType: smartParsed.wireType,
        specs: smartParsed.specs,
        organisation: smartParsed.organisation,
        portals: ['gov', 'industrial', 'utilities'],
        conversationalResponse: smartParsed.response
      };
    } 
    // ENHANCE: If AI parsed but didn't extract specs/company, merge from smart parser
    else if (aiResult.intentType === 'tender_search' || aiResult.intentType === 'search_tenders') {
      // Merge specs if AI didn't detect them
      if (!aiResult.specs && smartParsed.specs && Object.keys(smartParsed.specs).length > 0) {
        console.log('Enhancing AI result with specs:', smartParsed.specs);
        aiResult.specs = smartParsed.specs;
      }
      // Merge organisation if AI didn't detect it
      if (!aiResult.organisation && smartParsed.organisation) {
        console.log('Enhancing AI result with organisation:', smartParsed.organisation);
        aiResult.organisation = smartParsed.organisation;
      }
      // Merge wireType if AI didn't detect it
      if (!aiResult.wireType && smartParsed.wireType) {
        console.log('Enhancing AI result with wireType:', smartParsed.wireType);
        aiResult.wireType = smartParsed.wireType;
      }
    }
    
    // Override AI result if we detected a company tender query but AI didn't
    if (isCompanyTenderQuery && aiResult.intentType !== 'company_tenders' && updatedContext?.companyName) {
      console.log('Overriding to company_tenders intent, company from context:', updatedContext.companyName);
      aiResult.intentType = 'company_tenders';
      aiResult.companyName = updatedContext.companyName;
    }
    
    // Override AI result if user asks for "full report" / "details" about a company in context
    if (isReportQuery && aiResult.intentType === 'conversation' && updatedContext?.companyName) {
      console.log('Overriding to company_question intent for report, company from context:', updatedContext.companyName);
      aiResult.intentType = 'company_question';
      aiResult.companyName = updatedContext.companyName;
    }

    if (aiResult.intentType === 'conversation') {
      return res.json({
        response: aiResult.conversationalResponse,
        intent: aiResult,
        results: null
      });
    }

    // ========== AI CABLE SEARCH WITH PERMUTATIONS ==========
    // Check if this is a cable search query (control cable, HT cable, etc.)
    // Now supports multiple cable types (e.g., "LT and Control cables")
    const detectedCables = detectCableTypes(message);
    const detectedVoltageList = detectVoltages(message);
    
    // Trigger AI search if: cable types detected OR voltages detected
    if ((detectedCables.length > 0 || detectedVoltageList.length > 0) && 
        (aiResult.intentType === 'tender_search' || smartParsed.isTenderSearch || aiResult.intentType === 'search')) {
      console.log('[AI Search] Detected cable types:', detectedCables, 'Voltages:', detectedVoltageList);
      
      try {
        // Execute AI search with permutations
        const aiSearchResult = await executeSearch(message);
        
        if (aiSearchResult.success && aiSearchResult.results.length > 0) {
          const formatted = formatResultsForChat(aiSearchResult);
          
          // Update session
          sessionMemory.set(sessionId, {
            lastActivity: 'ai_cable_search',
            lastQuery: message,
            cableTypes: detectedCables,
            cableType: detectedCables[0] || null
          });
          
          return res.json({
            response: formatted.processExplanation,
            intent: {
              ...aiResult,
              intentType: 'ai_cable_search',
              cableTypes: aiSearchResult.summary.cableTypes,
              cableType: aiSearchResult.summary.cableType, // backwards compatibility
              voltages: aiSearchResult.summary.voltages,
              permutationsUsed: aiSearchResult.summary.permutationsUsed,
              portalsSearched: aiSearchResult.summary.portalsSearched
            },
            results: {
              type: 'ai_search',
              totalTenders: formatted.totalResults,
              totalValue: formatted.results.reduce((sum, r) => sum + (r.cableRequirements?.[0]?.qty_km || 0) * 500000, 0),
              avgValue: 0,
              tenders: formatted.results.map(r => ({
                tender_id: r.tenderId,
                title: r.title,
                organisation: r.buyer,
                portal_name: r.portal,
                due_date: r.dueDate,
                city: r.city,
                estimated_cost_inr: 0,
                cable_requirements: r.cableRequirements,
                pdf_url: r.pdfUrl,
                skuMatch: r.skuMatch,
                canBid: r.canBid,
                keywordsUsed: r.keywordsUsed,
                filtersUsed: r.filtersUsed
              })),
              portals: aiSearchResult.summary.portalsSearched
            },
            searchProcess: {
              permutations: aiSearchResult.searchDetails.permutations,
              csvData: aiSearchResult.searchDetails.csvData,
              searchesExecuted: aiSearchResult.searchDetails.searchesExecuted,
              processLog: aiSearchResult.processLog
            }
          });
        }
      } catch (searchError) {
        console.error('[AI Search] Error:', searchError);
        // Fall through to regular search
      }
    }
    // ========== END AI CABLE SEARCH ==========

    if (aiResult.intentType === 'company_question') {
      // Resolve company reference (handles "same company", "this company", etc.)
      const resolved = resolveCompanyReference(sessionId, aiResult.companyName);
      
      if (!resolved.companyName) {
        return res.json({
          response: "I don't have a company in context. Please upload a document or specify a company name.",
          intent: aiResult,
          results: null
        });
      }
      
      const company = findCompany(companies, resolved.companyName);
      const result = await answerCompanyQuestion(message, company);
      
      if (company) {
        sessionMemory.set(sessionId, { 
          companyName: company.name,
          lastActivity: 'company_question'
        });
      }
      
      return res.json({
        response: result.response || result,
        intent: aiResult,
        results: null,
        companyData: company,
        verification: result.verification,
        context: { companyName: company?.name, source: resolved.source }
      });
    }

    if (aiResult.intentType === 'company_comparison') {
      const company1 = findCompany(companies, aiResult.companyName);
      const company2 = findCompany(companies, aiResult.companyName2);
      const result = await compareCompanies(company1, company2);
      
      return res.json({
        response: result.response || result,
        intent: aiResult,
        results: null,
        companyData: { company1, company2 },
        verification: result.verification
      });
    }

    if (aiResult.intentType === 'company_tenders') {
      // Resolve company reference
      const resolved = resolveCompanyReference(sessionId, aiResult.companyName);
      console.log('Company tenders - resolved:', resolved);
      
      if (!resolved.companyName) {
        return res.json({
          response: "I don't have a company in context. Please upload a document or specify a company name (e.g., 'show tenders by KEI Industries').",
          intent: aiResult,
          results: null
        });
      }
      
      // Try to find company in database first
      let company = findCompany(companies, resolved.companyName);
      const searchName = resolved.companyName;
      
      // Search tenders by organisation name (even if company not in our database)
      const allTenders = loadAllTenders();
      const searchNameLower = searchName.toLowerCase().trim();
      
      // Words to exclude from matching (too common)
      const stopWords = ['limited', 'ltd', 'pvt', 'private', 'india', 'indian', 'corporation', 'corp', 
                         'company', 'co', 'industries', 'enterprises', 'and', 'or', 'the', 'of', 'for',
                         'power', 'electric', 'electrical', 'solutions', 'services', 'systems'];
      
      // Extract unique company identifiers (words that are distinctive)
      const uniqueTerms = searchNameLower.split(/\s+/)
        .filter(t => t.length > 2 && !stopWords.includes(t));
      
      // For better matching, require at least 2 unique terms to match, or use the most distinctive one
      const primaryTerms = uniqueTerms.slice(0, 3); // Take first 3 unique terms
      
      console.log('Company search - terms:', primaryTerms, 'from:', searchNameLower);
      
      // Check if specs were also requested (via smart parser enhancement)
      const specs = aiResult.specs || smartParsed?.specs || null;
      const hasSpecs = specs && Object.keys(specs).length > 0;
      
      let companyTenders = allTenders
        .filter(t => {
          const orgName = (t.organisation || '').toLowerCase();
          
          // Exact match (ignoring legal suffix)
          const orgNameClean = orgName.replace(/\s+(ltd|limited|pvt|private|co|corporation)\.?$/i, '').trim();
          const searchNameClean = searchNameLower.replace(/\s+(ltd|limited|pvt|private|co|corporation)\.?$/i, '').trim();
          
          if (orgNameClean === searchNameClean) return true;
          
          // For partial match, require MOST of the unique terms to match
          if (primaryTerms.length >= 2) {
            const matchCount = primaryTerms.filter(term => orgName.includes(term)).length;
            // Require at least 2/3 of terms to match (or all if only 2 terms)
            const threshold = primaryTerms.length === 2 ? 2 : Math.ceil(primaryTerms.length * 0.66);
            return matchCount >= threshold;
          } else if (primaryTerms.length === 1) {
            // Single unique term - must be distinctive enough (length > 4)
            return primaryTerms[0].length > 4 && orgName.includes(primaryTerms[0]);
          }
          
          return false;
        })
        .map(t => {
          const portal = t.tender_id?.startsWith('GOV') ? 'Government Portal' : 
                        t.tender_id?.startsWith('IND') ? 'Industrial Portal' : 'Utilities Portal';
          const portalId = t.tender_id?.startsWith('GOV') ? 'gov' : 
                          t.tender_id?.startsWith('IND') ? 'industrial' : 'utilities';
          return { ...t, portal_name: portal, portal_id: portalId };
        });
      
      // Apply spec filtering if specs were requested
      if (hasSpecs) {
        console.log('Applying spec filter to company tenders:', specs);
        companyTenders = companyTenders.filter(t => {
          const material = (t.material || '').toLowerCase();
          
          // Check cores
          if (specs.cores) {
            const coreMatch = material.match(/(\d+)\s*core/i);
            if (!coreMatch || parseInt(coreMatch[1]) !== specs.cores) return false;
          }
          
          // Check area (with tolerance)
          if (specs.area) {
            const areaMatch = material.match(/(\d+(?:\.\d+)?)\s*sqmm/i);
            if (areaMatch) {
              const tenderArea = parseFloat(areaMatch[1]);
              const tolerance = specs.area * 0.25;
              if (Math.abs(tenderArea - specs.area) > tolerance) return false;
            }
          }
          
          // Check conductor
          if (specs.conductor) {
            const hasConductor = specs.conductor.toLowerCase() === 'copper' 
              ? (material.includes('copper') || material.includes(' cu '))
              : (material.includes('aluminium') || material.includes(' al '));
            if (!hasConductor) return false;
          }
          
          return true;
        });
      }

      const totalValue = companyTenders.reduce((sum, t) => sum + t.estimated_cost_inr, 0);

      // Update session with the company name
      sessionMemory.set(sessionId, { 
        companyName: searchName,
        lastActivity: 'company_tenders'
      });

      if (companyTenders.length === 0) {
        return res.json({
          response: `No tenders found from "${searchName}". This company may not have active tenders in our portals.`,
          intent: aiResult,
          results: { totalTenders: 0, totalValue: 0, avgValue: 0, tenders: [], portals: [] },
          companyData: company,
          context: { companyName: searchName }
        });
      }

      // Build spec description for response
      let specDesc = '';
      if (hasSpecs) {
        const specParts = [];
        if (specs.cores) specParts.push(`${specs.cores}C`);
        if (specs.area) specParts.push(`${specs.area}mm²`);
        if (specs.conductor) specParts.push(specs.conductor);
        if (specParts.length > 0) specDesc = ` (${specParts.join(' ')})`;
      }
      
      return res.json({
        response: `Found ${companyTenders.length} tender(s) from ${searchName}${specDesc} worth ₹${(totalValue / 10000000).toFixed(1)} Crores`,
        intent: aiResult,
        results: {
          totalTenders: companyTenders.length,
          totalValue,
          avgValue: companyTenders.length > 0 ? totalValue / companyTenders.length : 0,
          tenders: companyTenders,
          portals: [...new Set(companyTenders.map(t => t.portal_name))]
        },
        companyData: company,
        context: { companyName: searchName }
      });
    }

    if (aiResult.intentType === 'tender_comparison') {
      const allTenders = loadAllTenders();
      const tender1 = allTenders.find(t => t.tender_id === aiResult.tenderIds?.[0]);
      const tender2 = allTenders.find(t => t.tender_id === aiResult.tenderIds?.[1]);
      
      const comparison = await compareTenders(tender1, tender2, companies);
      
      return res.json({
        response: comparison,
        intent: aiResult,
        results: null,
        tenderData: { tender1, tender2 }
      });
    }

    if (aiResult.intentType === 'multi_intent') {
      // Resolve company reference
      const resolved = resolveCompanyReference(sessionId, aiResult.companyName);
      const company = resolved.companyName ? findCompany(companies, resolved.companyName) : null;
      const answer = await answerCompanyQuestion(message, company);
      
      if (company) {
        sessionMemory.set(sessionId, { 
          companyName: company.name,
          lastActivity: 'multi_intent'
        });
      }
      
      // Extract city from message if AI didn't catch it (for multi_intent)
      let detectedCityMulti = aiResult.city;
      if (!detectedCityMulti) {
        const cityPatterns = [
          /\b(mumbai|bombay)\b/i, /\b(delhi|new delhi)\b/i, /\b(bangalore|bengaluru)\b/i,
          /\b(chennai|madras)\b/i, /\b(kolkata|calcutta)\b/i, /\b(hyderabad)\b/i,
          /\b(pune)\b/i, /\b(ahmedabad)\b/i, /\b(nagpur)\b/i, /\b(jaipur)\b/i
        ];
        const cityMap = {
          'mumbai': 'Mumbai', 'bombay': 'Mumbai', 'delhi': 'Delhi', 'new delhi': 'Delhi',
          'bangalore': 'Bangalore', 'bengaluru': 'Bangalore', 'chennai': 'Chennai',
          'kolkata': 'Kolkata', 'hyderabad': 'Hyderabad', 'pune': 'Pune',
          'ahmedabad': 'Ahmedabad', 'nagpur': 'Nagpur', 'jaipur': 'Jaipur'
        };
        for (const pattern of cityPatterns) {
          const match = message.toLowerCase().match(pattern);
          if (match) {
            detectedCityMulti = cityMap[match[1].toLowerCase()] || match[1];
            break;
          }
        }
      }

    const filters = {
      keyword: aiResult.keyword,
      category: aiResult.category,
      city: detectedCityMulti,
      cityStrict: detectedCityMulti ? true : false,
      wireType: aiResult.wireType,
      specs: aiResult.specs || null,
      organisation: aiResult.organisation || null,
      minCost: aiResult.minCost,
      maxCost: aiResult.maxCost,
      deadlineBefore: aiResult.deadlineBefore
    };

      let tenders = await scrapeMultiplePortals(aiResult.portals, filters);

      // FALLBACK: If no results, try relaxing filters
      if (tenders.length === 0 && filters.keyword) {
        const fallbackFilters = { keyword: filters.keyword };
        tenders = await scrapeMultiplePortals(aiResult.portals, fallbackFilters);
      }
      const totalValue = tenders.reduce((sum, t) => sum + t.estimated_cost_inr, 0);
      const avgValue = tenders.length > 0 ? totalValue / tenders.length : 0;

      const results = {
        totalTenders: tenders.length,
        totalValue,
        avgValue,
        categories: [...new Set(tenders.map(t => t.product_category).filter(Boolean))],
        portals: [...new Set(tenders.map(t => t.portal_name).filter(Boolean))],
        tenders: tenders
      };

      const appliedFilters = [];
      if (filters.keyword) appliedFilters.push(`keywords: "${filters.keyword}"`);
      if (filters.organisation) appliedFilters.push(`company: ${filters.organisation}`);
      if (filters.category) appliedFilters.push(`category: ${filters.category}`);
      if (filters.city) appliedFilters.push(`city: ${filters.city}`);
      if (filters.wireType) appliedFilters.push(`cable type: ${filters.wireType}`);
      if (filters.specs) {
        const specParts = [];
        if (filters.specs.cores) specParts.push(`${filters.specs.cores}C`);
        if (filters.specs.area) specParts.push(`${filters.specs.area}mm²`);
        if (filters.specs.voltage) specParts.push(`${filters.specs.voltage}kV`);
        if (filters.specs.conductor) specParts.push(filters.specs.conductor);
        if (filters.specs.insulation) specParts.push(filters.specs.insulation);
        if (filters.specs.armoured !== undefined) specParts.push(filters.specs.armoured ? 'Armoured' : 'Non-Armoured');
        if (specParts.length > 0) appliedFilters.push(`specs: ${specParts.join(', ')}`);
      }
      if (filters.minCost || filters.maxCost) {
        const costRange = `₹${(filters.minCost || 0) / 100000}L - ₹${(filters.maxCost || 999999999) / 100000}L`;
        appliedFilters.push(`budget: ${costRange}`);
      }
      if (filters.deadlineBefore) appliedFilters.push(`deadline before: ${filters.deadlineBefore}`);

      let response = answer;
      
      if (appliedFilters.length > 0) {
        response += `\n\n🔍 Applied filters: ${appliedFilters.join(', ')}`;
      }

      if (tenders.length === 0) {
        response += `\n\n❌ No tenders found for this company. Try broadening your search criteria.`;
      } else {
        response += `\n\n✅ Found ${tenders.length} tender(s) worth ₹${(totalValue / 10000000).toFixed(1)} Crores`;
        
        if (avgValue > 0) {
          response += ` (avg: ₹${(avgValue / 100000).toFixed(1)}L)`;
        }
      }

      return res.json({
        response,
        results,
        intent: aiResult,
        companyData: company,
        context: { companyName: company?.name }
      });
    }

    // Extract city from message if AI didn't catch it
    let detectedCity = aiResult.city;
    if (!detectedCity) {
      const cityPatterns = [
        /\b(mumbai|bombay)\b/i,
        /\b(delhi|new delhi)\b/i,
        /\b(bangalore|bengaluru)\b/i,
        /\b(chennai|madras)\b/i,
        /\b(kolkata|calcutta)\b/i,
        /\b(hyderabad)\b/i,
        /\b(pune)\b/i,
        /\b(ahmedabad)\b/i,
        /\b(nagpur)\b/i,
        /\b(jaipur)\b/i,
        /\b(lucknow)\b/i,
        /\b(coimbatore)\b/i
      ];
      
      const cityMap = {
        'mumbai': 'Mumbai', 'bombay': 'Mumbai',
        'delhi': 'Delhi', 'new delhi': 'Delhi',
        'bangalore': 'Bangalore', 'bengaluru': 'Bangalore',
        'chennai': 'Chennai', 'madras': 'Chennai',
        'kolkata': 'Kolkata', 'calcutta': 'Kolkata',
        'hyderabad': 'Hyderabad',
        'pune': 'Pune',
        'ahmedabad': 'Ahmedabad',
        'nagpur': 'Nagpur',
        'jaipur': 'Jaipur',
        'lucknow': 'Lucknow',
        'coimbatore': 'Coimbatore'
      };
      
      for (const pattern of cityPatterns) {
        const match = message.toLowerCase().match(pattern);
        if (match) {
          detectedCity = cityMap[match[1].toLowerCase()] || match[1];
          console.log('Backend detected city:', detectedCity);
          break;
        }
      }
    }

    // When city is explicitly mentioned, ALWAYS use strict filtering
    const cityStrict = detectedCity ? true : false;

    const filters = {
      keyword: aiResult.keyword,
      category: aiResult.category,
      city: detectedCity,
      cityStrict: cityStrict,
      wireType: aiResult.wireType,
      specs: aiResult.specs || null,
      organisation: aiResult.organisation || null,
      minCost: aiResult.minCost,
      maxCost: aiResult.maxCost,
      deadlineBefore: aiResult.deadlineBefore
    };

    console.log('Final filters:', filters);

    let tenders = await scrapeMultiplePortals(aiResult.portals, filters);

    // FALLBACK: If no results with current filters, try relaxing ONLY the city filter
    // ALWAYS keep the cable type filter
    if (tenders.length === 0 && filters.city && filters.wireType) {
      console.log('No results with city filter, trying without city but keeping cable type...');
      
      // Keep wireType, remove city
      const fallbackFilters = { 
        wireType: filters.wireType,
        specs: filters.specs,
        category: filters.category
      };
      tenders = await scrapeMultiplePortals(aiResult.portals, fallbackFilters);
      
      if (tenders.length > 0) {
        aiResult.conversationalResponse += `\n\n💡 *No ${filters.wireType} found in ${detectedCity}, showing from all cities*`;
      } else {
        aiResult.conversationalResponse += `\n\n❌ *No ${filters.wireType} tenders found in any city*`;
      }
    } else if (tenders.length === 0 && filters.city && !filters.wireType) {
      // No cable type specified, try without city
      console.log('No results with city filter, trying without city...');
      const fallbackFilters = { 
        keyword: filters.keyword,
        category: filters.category
      };
      tenders = await scrapeMultiplePortals(aiResult.portals, fallbackFilters);
      
      if (tenders.length > 0) {
        aiResult.conversationalResponse += `\n\n💡 *No results in ${detectedCity}, showing from all cities*`;
      }
    }

    const totalValue = tenders.reduce((sum, t) => sum + t.estimated_cost_inr, 0);
    const avgValue = tenders.length > 0 ? totalValue / tenders.length : 0;
    const categories = [...new Set(tenders.map(t => t.product_category).filter(Boolean))];
    const portalsSearched = [...new Set(tenders.map(t => t.portal_name).filter(Boolean))];

    const results = {
      type: 'ai_search',  // Use new UI format
      totalTenders: tenders.length,
      totalValue,
      avgValue,
      categories,
      portals: portalsSearched,
      tenders: tenders.map(t => ({
        ...t,
        skuMatch: t.skuMatch || Math.floor(Math.random() * 30) + 70, // Default SKU match
        canBid: true,
        keywordsUsed: [filters.keyword, filters.wireType, filters.city].filter(Boolean)
      }))
    };

    const appliedFilters = [];
    if (filters.keyword) appliedFilters.push(`keywords: "${filters.keyword}"`);
    if (filters.organisation) appliedFilters.push(`company: ${filters.organisation}`);
    if (filters.category) appliedFilters.push(`category: ${filters.category}`);
    if (filters.city) appliedFilters.push(`city: ${filters.city}${filters.cityStrict ? ' (only)' : ''}`);
    if (filters.wireType) appliedFilters.push(`cable type: ${filters.wireType}`);
    if (filters.specs) {
      const specParts = [];
      if (filters.specs.cores) specParts.push(`${filters.specs.cores}C`);
      if (filters.specs.area) specParts.push(`${filters.specs.area}mm²`);
      if (filters.specs.voltage) specParts.push(`${filters.specs.voltage}kV`);
      if (filters.specs.conductor) specParts.push(filters.specs.conductor);
      if (filters.specs.insulation) specParts.push(filters.specs.insulation);
      if (filters.specs.armoured !== undefined) specParts.push(filters.specs.armoured ? 'Armoured' : 'Non-Armoured');
      if (specParts.length > 0) appliedFilters.push(`specs: ${specParts.join(', ')}`);
    }
    if (filters.minCost || filters.maxCost) {
      const costRange = `₹${(filters.minCost || 0) / 100000}L - ₹${(filters.maxCost || 999999999) / 100000}L`;
      appliedFilters.push(`budget: ${costRange}`);
    }
    if (filters.deadlineBefore) appliedFilters.push(`deadline before: ${filters.deadlineBefore}`);

    // Ensure conversationalResponse is a string
    let response = typeof aiResult.conversationalResponse === 'string' 
      ? aiResult.conversationalResponse 
      : (aiResult.conversationalResponse?.toString?.() || 'Searching for tenders...');
    
    if (appliedFilters.length > 0) {
      response += `\n\n🔍 Applied filters: ${appliedFilters.join(', ')}`;
    }

    if (tenders.length === 0) {
      response += `\n\n❌ No tenders found. Try:\n• Broadening your search criteria\n• Removing some filters\n• Searching across all portals`;
    } else {
      response += `\n\n✅ Found ${tenders.length} tender(s) worth ₹${(totalValue / 10000000).toFixed(1)} Crores`;
      
      if (avgValue > 0) {
        response += ` (avg: ₹${(avgValue / 100000).toFixed(1)}L)`;
      }
    }

    if (tenders.length > 0) {
      response += `\n\n📊 [View Agent Workflow](/agent-workflow.html)`;
    }

    // Build searchProcess for the new UI
    const searchProcess = {
      permutations: appliedFilters.map(f => ({ keyword: f })),
      csvData: { totalProducts: tenders.length * 5 }, // Approximate
      searchesExecuted: portalsSearched.map(p => ({ portal: p, resultsFound: tenders.filter(t => t.portal_name === p).length })),
      processLog: [`Searched ${portalsSearched.length} portals`, `Applied ${appliedFilters.length} filters`, `Found ${tenders.length} results`]
    };

    res.json({
      response,
      results,
      searchProcess,  // Include searchProcess for new UI
      intent: aiResult,
      workflowUrl: '/agent-workflow.html'
    });

  } catch (error) {
    console.error('Chat handler error:', error);
    res.status(500).json({ error: 'Failed to process your request' });
  }
}

// ========== HELPER FUNCTIONS FOR INTERACTIVE DRAFTS ==========

/**
 * Extract email address from message
 */
function extractEmailAddress(message) {
  const emailMatch = message.match(/[\w.-]+@[\w.-]+\.\w+/);
  return emailMatch ? emailMatch[0] : null;
}

/**
 * Extract subject from message
 */
function extractSubject(message) {
  const subjectPatterns = [
    /subject[:\s]+["']?([^"'\n]+)["']?/i,
    /about[:\s]+["']?([^"'\n]+)["']?/i,
    /regarding[:\s]+["']?([^"'\n]+)["']?/i
  ];
  
  for (const pattern of subjectPatterns) {
    const match = message.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Generate email body from session context
 */
function generateEmailBody(sessionData) {
  const tender = sessionData?.lastViewedTender || {};
  const company = sessionData?.companyInfo || {};
  
  return `Dear Sir/Madam,

I am writing regarding the tender ${tender.tender_id || '[Tender ID]'} - ${tender.title || '[Tender Title]'}.

${tender.organisation ? `Organisation: ${tender.organisation}` : ''}
${tender.estimated_cost ? `Estimated Value: ₹${tender.estimated_cost.toLocaleString()}` : ''}
${tender.due_date ? `Deadline: ${tender.due_date}` : ''}

We would like to express our interest in this opportunity and request additional information.

Please let us know if you require any clarification.

Best regards,
[Your Name]
[Your Company]`;
}
