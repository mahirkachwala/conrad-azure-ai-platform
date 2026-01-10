import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import our shared PDF parser (which supports Azure Document Intelligence)
import { parsePDF, extractRFPSummary } from './pdf-parser.js';

// Multi-provider AI setup
const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

const genAI = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

console.log(`📄 Document Extractor: Gemini ${geminiKey ? '✅' : '❌'} | OpenAI ${openaiKey ? '✅' : '❌'}`);

/**
 * Generate content with multi-provider fallback
 */
async function generateWithFallback(prompt, options = {}) {
  const providers = [];

  if (genAI) providers.push({ name: 'Gemini', fn: () => generateWithGemini(prompt) });
  if (openai) providers.push({ name: 'OpenAI', fn: () => generateWithOpenAI(prompt) });

  for (const provider of providers) {
    try {
      console.log(`   🤖 Trying ${provider.name}...`);
      const result = await provider.fn();
      console.log(`   ✅ ${provider.name} success`);
      return result;
    } catch (error) {
      console.warn(`   ⚠️ ${provider.name} failed:`, error.message);
      // Check for quota errors
      if (error.message?.includes('429') || error.message?.includes('503') || error.message?.includes('quota')) {
        console.log(`   🚫 ${provider.name} quota exhausted, trying next...`);
      }
    }
  }

  throw new Error('All AI providers failed');
}

async function generateWithGemini(prompt) {
  const result = await genAI.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt
  });
  return result.text;
}

async function generateWithOpenAI(prompt) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4000,
    temperature: 0.3
  });
  return response.choices[0]?.message?.content || '';
}

/**
 * Extract text from PDF using pdf-parse
 */
// Obsolete: Internal extractFromPDF removed in favor of services/pdf-parser.js

/**
 * Extract text from Word document using mammoth
 */
async function extractFromWord(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });

    return {
      text: result.value,
      messages: result.messages
    };
  } catch (error) {
    console.error('Word extraction error:', error);
    throw new Error(`Failed to extract Word document: ${error.message}`);
  }
}

/**
 * Use Gemini AI to intelligently extract tender information from document text
 */
async function extractTenderDataWithAI(documentText, fileName = '') {
  const extractionPrompt = `You are an AI specialized in analyzing tender/RFP documents for cable/wire procurement. Extract structured information from the following document.

Document Name: ${fileName}

Document Text:
${documentText}

Extract the following information (if available in the document). If a field is not found, return null:

1. **tender_id**: Tender reference number (e.g., IND-201, GOV-100, RFP-2024-001)
2. **organisation**: Issuing organization/buyer name
3. **title**: Tender title or subject
4. **material**: Material/item being procured
5. **product_category**: Category (e.g., Cables, Transformers, Equipment)
6. **city**: Delivery location or issuing office city
7. **publish_date**: Publication/issue date (YYYY-MM-DD format)
8. **due_date**: Bid submission deadline (YYYY-MM-DD format)
9. **estimated_cost_inr**: Estimated value in INR (number only, no currency symbols)
10. **contact_person**: Contact person name
11. **contact_email**: Contact email
12. **contact_phone**: Contact phone number

13. **cable_requirements**: CRITICAL - Array of cable items with quantities. For EACH item, extract:
    - item_no: Item number (1, 2, 3...)
    - description: Full cable description (e.g., "6.6kV HT Cable 3C x 70 sqmm Armoured Copper")
    - cable_type: Type (HT Cable, LT Cable, Control Cable, Instrumentation Cable)
    - voltage: Voltage rating (e.g., "6.6kV", "1.1kV", "11kV")
    - cores: Number of cores (e.g., "3C", "11C", "4C")
    - size_sqmm: Cross-section in sqmm (e.g., "70", "1.5", "95")
    - conductor: Conductor material (Copper or Aluminium)
    - qty_km: EXACT quantity in kilometers as a NUMBER (e.g., 5, 3, 10)
    
14. **testing_requirements**: Object containing:
    - routine_tests: Array of routine test names
    - type_tests: Array of type test names
    - third_party_required: Boolean - true ONLY if third-party testing is MANDATORY/REQUIRED. False if document says "third party testing is not required" or "external testing not mandatory"

15. **external_testing_required**: Boolean - Set to:
    - TRUE only if document explicitly says third-party/external/NABL/CPRI testing is "required", "mandatory", or "must be done"
    - FALSE if document says "external testing not required", "third party testing is not required", "no external testing", or makes no mention of external testing requirement
    - IMPORTANT: If the document mentions testing labs but says they are NOT required, this should be FALSE

16. **submission_mode**: One of: "EMAIL_FORM", "LETTER_COURIER", "EXTERNAL_PORTAL", "MEETING_EMAIL"
    - MEETING_EMAIL: If pre-bid meeting is required/mandatory
    - LETTER_COURIER: If physical courier/post submission
    - EXTERNAL_PORTAL: If separate portal registration needed
    - EMAIL_FORM: If email submission with attached form

17. **submission_email**: Email address for bid submission (if mentioned)

18. **payment_terms**: Payment terms summary
19. **delivery_period**: Delivery timeline
20. **warranty**: Warranty period

IMPORTANT: For cable_requirements, extract the EXACT quantities mentioned in the document. If it says "5 km" or "5 kilometers", the qty_km should be 5.

Return the data as a **valid JSON object** with these exact field names. Be thorough and accurate.`;

  try {
    // Use multi-provider fallback (Gemini -> OpenAI)
    const responseText = await generateWithFallback(extractionPrompt);

    // Extract JSON from the response (handle markdown code blocks)
    let jsonText = responseText;
    if (responseText.includes('```json')) {
      jsonText = responseText.split('```json')[1].split('```')[0].trim();
    } else if (responseText.includes('```')) {
      jsonText = responseText.split('```')[1].split('```')[0].trim();
    }

    const extractedData = JSON.parse(jsonText);

    return {
      success: true,
      data: extractedData,
      rawText: documentText.substring(0, 1000) // Include first 1000 chars for reference
    };

  } catch (error) {
    console.error('AI extraction error:', error);
    return {
      success: false,
      error: error.message,
      rawText: documentText.substring(0, 1000)
    };
  }
}

/**
 * Main document extraction function
 * Supports PDF (with Azure) and Word documents
 */
export async function extractDocumentData(filePath, fileType) {
  let extractedText = '';
  // Metadata will now hold our structured Azure data
  let metadata = {};

  // Step 1: Extract text and metadata
  if (fileType === 'application/pdf' || filePath.endsWith('.pdf')) {
    // metadata will contain { tables, keyValuePairs } if Azure was used
    const pdfData = await parsePDF(filePath);

    if (!pdfData.success) {
      throw new Error(`PDF Parsing failed: ${pdfData.error}`);
    }

    extractedText = pdfData.text;
    metadata = {
      pages: pdfData.numPages,
      type: 'PDF',
      ...pdfData.metadata // Spread Azure results here
    };

  } else if (
    fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileType === 'application/msword' ||
    filePath.endsWith('.docx') ||
    filePath.endsWith('.doc')
  ) {
    const wordData = await extractFromWord(filePath);
    extractedText = wordData.text;
    metadata = {
      type: 'Word',
      messages: wordData.messages
    };
  } else {
    throw new Error(`Unsupported file type: ${fileType}`);
  }

  // Step 2: Extract structured data using AI (Primary Method)
  const fileName = filePath.split('/').pop();
  let aiResult = { success: false };

  try {
    // Attempt detailed AI extraction first (for part-wise cable requirements)
    aiResult = await extractTenderDataWithAI(extractedText, fileName);
  } catch (err) {
    console.error("Primary AI extraction failed, attempting fallback:", err);
  }


  // Step 3: Use Azure Metadata as a fallback or if AI failed
  // If we have high-quality Azure Key-Value pairs and AI failed, we can construct the object directly
  if ((!aiResult.success || !aiResult.data) && metadata.keyValuePairs && metadata.keyValuePairs.length > 5) {
    console.log('   ✨ Using Azure Document Intelligence metadata for extraction override (Fallback)');

    const kvMap = new Map();
    metadata.keyValuePairs.forEach(kv => {
      const key = (kv.key?.content || '').toLowerCase();
      const value = (kv.value?.content || '');
      kvMap.set(key, value);
    });

    // Helper to find value loosely
    const findVal = (terms) => {
      for (const t of terms) {
        for (const [k, v] of kvMap.entries()) {
          if (k.includes(t)) return v;
        }
      }
      return null;
    };

    // Direct mapping from Azure KV to our schema
    const directData = {
      tender_id: findVal(['tender id', 'tender no', 'rfp no', 'bid no']),
      organisation: findVal(['organisation', 'buyer', 'issuer', 'company', 'department']),
      title: findVal(['title', 'subject', 'name of work', 'description']),
      due_date: findVal(['due date', 'closing date', 'deadline', 'submission date']),
      estimated_cost_inr: parseFloat((findVal(['estimated cost', 'tender value', 'project cost']) || '0').replace(/[^0-9.]/g, '')),
      city: findVal(['city', 'location', 'place']),
      submission_mode: 'EMAIL_FORM', // Default fallback
      contact_email: findVal(['email', 'contact']),
      // Mocked requirements - check if technical_specs are available via pattern matching if Azure misses them
      cable_requirements: [{ item_no: 1, description: "Cable requirement from document (Extracted via Azure KV)", qty_km: 1 }]
    };

    // Generate a static analysis based on the extracted data
    const staticAnalysis = `SUMMARY
This document appears to be a tender/RFP titled "${directData.title || 'Unknown Title'}" issued by ${directData.organisation || 'Unknown Organization'}. The extracted value is approximately INR ${directData.estimated_cost_inr || '0'}.

KEY POINTS
• Buyer: ${directData.organisation || 'N/A'}
• ID: ${directData.tender_id || 'N/A'}
• Location: ${directData.city || 'N/A'}
• Deadline: ${directData.due_date || 'N/A'}

SUBMISSION MODE
• Method: ${directData.submission_mode}
• Contact: ${directData.contact_email || 'Not extracted'}`;

    return {
      success: true,
      data: directData,
      rawText: extractedText.substring(0, 1000),
      metadata,
      extractedText: extractedText.substring(0, 2000),
      analysis: staticAnalysis, // Provide the static analysis here
      // Add empty company info structure so UI doesn't crash
      companyInfo: { name: directData.organisation || 'Unknown', credibility_label: 'UNVERIFIED', raw_score: 0 }
    };
  }

  // Step 4: Use Regex/Pattern Matching as Final Fallback
  if (!aiResult.success || !aiResult.data) {
    console.log('   🔧 Using Regex/Pattern Matching as Final Fallback');
    const regexSummary = extractRFPSummary(extractedText);

    // Map regex summary to our data schema
    const regexData = {
      tender_id: regexSummary.rfp_id,
      organisation: regexSummary.buyer_name,
      title: `RFP for ${regexSummary.technical_specs?.cable_type || 'Cables'}`,
      due_date: regexSummary.due_date,
      estimated_cost_inr: regexSummary.estimated_value,
      city: regexSummary.location || 'India', // Default to India if not found
      submission_mode: regexSummary.submission.mode || 'EMAIL_FORM',
      contact_email: regexSummary.submission.email_to || regexSummary.submission.meeting_email || null,
      cable_requirements: []
    };

    // Map scope items or technical specs to cable_requirements
    if (regexSummary.scope && regexSummary.scope.length > 0) {
      regexData.cable_requirements = regexSummary.scope.map((item, idx) => ({
        item_no: idx + 1,
        description: item.description,
        qty_km: item.extracted_specs?.quantity_km || 1,
        // Add extra fields if available
        cable_type: item.extracted_specs?.cable_type,
        voltage: item.extracted_specs?.voltage_kv ? `${item.extracted_specs.voltage_kv}kV` : null
      }));
    } else {
      // Create a single item from technical specs
      const specs = regexSummary.technical_specs;
      regexData.cable_requirements = [{
        item_no: 1,
        description: `${specs.cable_type || 'Cable'} ${specs.voltage_kv ? specs.voltage_kv + 'kV' : ''} ${specs.conductor_material || ''} ${specs.cross_section_sqmm ? specs.cross_section_sqmm + 'sqmm' : ''}`.trim(),
        qty_km: specs.quantity_km || 1
      }];
    }

    const staticAnalysis = `SUMMARY
(Extracted via Pattern Matching Pattern)
This document appears to be a tender issued by ${regexData.organisation || 'Unknown Organization'} for ${regexData.title}.

KEY POINTS
• Buyer: ${regexData.organisation || 'N/A'}
• ID: ${regexData.tender_id || 'N/A'}
• Location: ${regexData.city || 'N/A'}
• Deadline: ${regexData.due_date || 'N/A'}

SUBMISSION MODE
• Method: ${regexData.submission_mode}
• Contact: ${regexData.contact_email || 'Not extracted'}`;

    return {
      success: true,
      data: regexData,
      rawText: extractedText.substring(0, 1000),
      metadata,
      extractedText: extractedText.substring(0, 2000),
      analysis: staticAnalysis,
      companyInfo: { name: regexData.organisation || 'Unknown', credibility_label: 'UNVERIFIED', raw_score: 0 }
    };
  }

  // If AI failed to generate analysis, use the same static generator fallback
  if (aiResult.success && aiResult.data && !aiResult.analysis) {
    const d = aiResult.data;
    aiResult.analysis = `SUMMARY
This document extracts as a tender titled "${d.title || 'Unknown'}" from ${d.organisation || 'Unknown'}.

KEY DETAILS
• Estimated Cost: ${d.estimated_cost_inr}
• Due Date: ${d.due_date}

(Generated via Azure Document Intelligence Extraction)`;


  }

  return {
    ...aiResult,
    metadata,
    extractedText: extractedText.substring(0, 2000)
  };
}

/**
 * Load company data and find matching company
 */
function loadCompanies() {
  try {
    const companiesPath = path.join(__dirname, '../public/data/companies.json');
    const data = fs.readFileSync(companiesPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load companies:', error);
    return [];
  }
}

function findCompany(companies, organizationName) {
  if (!organizationName) return null;
  const query = organizationName.toLowerCase();
  return companies.find(c =>
    c.name.toLowerCase() === query ||
    c.name.toLowerCase().includes(query) ||
    query.includes(c.name.toLowerCase().split('(')[0].trim())
  );
}

/**
 * Analyze uploaded document with AI insights and OpenCorporates company verification
 */
export async function analyzeUploadedDocument(filePath, fileType) {
  // Extract structured data
  const extraction = await extractDocumentData(filePath, fileType);

  if (!extraction.success) {
    return {
      success: false,
      error: extraction.error,
      message: 'Failed to extract data from document'
    };
  }

  // Load companies and find matching organization
  const companies = loadCompanies();
  const company = findCompany(companies, extraction.data?.organisation);

  // Add OpenCorporates company credibility data to extracted data
  let companyInfo = null;
  if (company) {
    companyInfo = {
      name: company.name,
      credibility_label: company.credibility_label || 'UNKNOWN',
      raw_score: company.raw_score || 0,
      status: company.status || 'Unknown',
      jurisdiction: company.jurisdiction || 'Unknown',
      age_years: company.age_years || 0,
      incorporation_date: company.incorporation_date,
      company_type: company.company_type || 'Unknown',
      oc_url: company.oc_url || null,
      hasAddress: company.signals?.hasAddress || company.hasAddress || false,
      filingsCount: company.signals?.filingsCount || company.filingsCount || 0,
      red_flags: company.red_flags || [],
      green_flags: company.green_flags || []
    };
  }

  // Generate AI analysis with OpenCorporates context
  const companyContext = company ? `

COMPANY VERIFICATION (OpenCorporates):
• Organization: ${company.name}
• Credibility: ${company.credibility_label} (Score: ${company.raw_score}/100)
• Status: ${company.status}
• Age: ${company.age_years} years
• Jurisdiction: ${company.jurisdiction}
• Company Type: ${company.company_type}
• Red Flags: ${company.red_flags?.length || 0}
• Green Flags: ${company.green_flags?.length || 0}
${company.oc_url ? `• Registry Link: ${company.oc_url}` : ''}` : '';

  const analysisPrompt = `Analyze this tender/RFP document and provide a concise, well-structured analysis:

Extracted Data:
${JSON.stringify(extraction.data, null, 2)}${companyContext}

Provide a brief analysis in exactly this format (use plain text, no markdown symbols like *, **, #, ---, etc.):

SUMMARY
[2-3 sentences overview of the tender]

COMPANY CREDIBILITY (OpenCorporates)
${company ? `• ${company.name}: ${company.credibility_label} (${company.raw_score}/100)
• Status: ${company.status}, Age: ${company.age_years} years
• Verification: ${company.hasAddress ? 'Has Address ✓' : 'No Address'}, ${company.filingsCount || 0} filings
${company.oc_url ? `• View on OpenCorporates: ${company.oc_url}` : ''}` : '• Company not found in OpenCorporates database'}

KEY POINTS
• [Point 1]
• [Point 2]
• [Point 3]

TESTING REQUIREMENTS
• [Required tests from the RFP - Type Test, Routine Test, Acceptance Test, etc.]
• [Testing standards mentioned - IS, IEC, CPRI, etc.]
• [External testing requirements if any]

TERMS & CONDITIONS
• Delivery Period: [Extract from document]
• Payment Terms: [Extract from document]
• Warranty: [Extract from document]
• LD Clause: [Extract from document]
• EMD/Security Deposit: [Extract from document]

SUBMISSION MODE
[Identify submission method - Email, Courier, Portal Registration, Pre-bid Meeting, etc.]
• Submission Deadline: [Date/Time]
• Submission Address/Email/Portal: [Details]

Keep it concise - total output should be under 400 words. Use simple bullet points (•) only, no asterisks or markdown formatting.`;

  try {
    // Use multi-provider fallback (Gemini -> OpenAI)
    const analysis = await generateWithFallback(analysisPrompt);

    return {
      success: true,
      extractedData: extraction.data,
      companyInfo: companyInfo,
      analysis: analysis,
      metadata: extraction.metadata,
      fileName: filePath.split('/').pop()
    };

  } catch (error) {
    // If AI providers failed, generate a concise rule-based fallback analysis from extracted data
    const fallbackAnalysis = generateFallbackAnalysis(extraction.data, companyInfo);
    return {
      success: true,
      extractedData: extraction.data,
      companyInfo: companyInfo,
      analysis: fallbackAnalysis,
      metadata: extraction.metadata,
      fileName: filePath.split('/').pop()
    };
  }
}

/**
 * Create a short, human-readable analysis from extracted data when AI is unavailable
 */
function generateFallbackAnalysis(extractedData, companyInfo) {
  try {
    const d = extractedData || {};
    const lines = [];

    const title = d.title || d.rfp_id || d.fileName || 'Tender document';
    lines.push(`SUMMARY\n${title} - ${d.product_category || ''}`);

    const org = d.organisation || d.buyer || d.buyer_name || 'Unknown buyer';
    const location = d.city || d.delivery_location || d.location || 'Unknown location';
    lines.push(`• Buyer: ${org}`);
    lines.push(`• Location: ${location}`);

    if (d.due_date) lines.push(`• Submission deadline: ${d.due_date}`);
    if (d.estimated_cost_inr) lines.push(`• Estimated budget: INR ${d.estimated_cost_inr}`);

    // Key points - cable requirements or technical specs
    const items = d.cable_requirements || d.buyer_requirements || d.scope || [];
    if (items && items.length > 0) {
      const first = items[0];
      const desc = first.description || `${first.cable_type || ''} ${first.size || ''}`;
      lines.push(`• Primary item: ${desc} — Qty: ${first.qty_km || first.quantity_km || first.qty || ''}`);
    }

    // Submission instructions
    const submission = d.submission || {};
    if (submission.mode) {
      lines.push(`• Submission: ${submission.mode}` + (submission.email_to ? ` to ${submission.email_to}` : ''));
    }

    // Company credibility summary if available
    if (companyInfo && companyInfo.credibility_label) {
      lines.push(`COMPANY CREDIBILITY\n• ${companyInfo.company_name || companyInfo.name}: ${companyInfo.credibility_label} (${companyInfo.credibility_score || companyInfo.raw_score || 'N/A'}/100)`);
    }

    // Limit output length
    return lines.join('\n').substring(0, 1500);
  } catch (e) {
    return 'Analysis could not be generated at this time.';
  }
}
