import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    model: 'gemini-2.5-flash',
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
async function extractFromPDF(filePath) {
  let parser;
  try {
    const dataBuffer = fs.readFileSync(filePath);
    parser = new PDFParse({ data: dataBuffer });
    const result = await parser.getText();
    
    return {
      text: result.text,
      pages: result.pages,
      info: result.info
    };
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error(`Failed to extract PDF: ${error.message}`);
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
}

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
 * Supports PDF and Word documents
 */
export async function extractDocumentData(filePath, fileType) {
  let extractedText = '';
  let metadata = {};

  // Step 1: Extract raw text based on file type
  if (fileType === 'application/pdf' || filePath.endsWith('.pdf')) {
    const pdfData = await extractFromPDF(filePath);
    extractedText = pdfData.text;
    metadata = {
      pages: pdfData.pages,
      type: 'PDF'
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

  // Step 2: Use AI to extract structured data
  const fileName = filePath.split('/').pop();
  const aiResult = await extractTenderDataWithAI(extractedText, fileName);

  return {
    ...aiResult,
    metadata,
    extractedText: extractedText.substring(0, 2000) // First 2000 chars for reference
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
    return {
      success: true,
      extractedData: extraction.data,
      companyInfo: companyInfo,
      analysis: 'Analysis could not be generated at this time.',
      metadata: extraction.metadata,
      fileName: filePath.split('/').pop()
    };
  }
}
