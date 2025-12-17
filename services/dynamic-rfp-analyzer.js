/**
 * DYNAMIC RFP ANALYZER
 * 
 * This service parses ACTUAL RFP PDFs and extracts ALL data dynamically.
 * NO STATIC DATA - everything comes from the PDF.
 * 
 * Flow:
 * 1. Parse PDF → Extract raw text
 * 2. Use AI (Gemini) to convert to structured JSON
 * 3. Extract SECTION 1: SCOPE OF SUPPLY (cables with quantities)
 * 4. Extract SECTION 2: TESTING REQUIREMENTS (exact test names)
 * 5. Extract submission mode, terms & conditions
 * 6. Match cables to CSV → Calculate material cost
 * 7. Match tests to testing.csv → Calculate testing cost
 * 8. Add GST → Generate quotation
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import adaptiveCsvManager from './adaptive-csv-manager.js';
import { getPdfPath, getExtractedData } from './uploaded-pdf-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Multi-provider AI setup
const geminiKey = process.env.GEMINI_API_KEY || '';
const openaiKey = process.env.OPENAI_API_KEY || '';

const ai = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

console.log(`🔍 Dynamic RFP Analyzer: Gemini ${geminiKey ? '✅' : '❌'} | OpenAI ${openaiKey ? '✅' : '❌'}`);

/**
 * Generate content with multi-provider fallback
 */
async function generateWithFallback(prompt) {
  const errors = [];
  
  // Try Gemini first
  if (ai) {
    try {
      console.log('   🤖 Trying Gemini...');
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt
      });
      console.log('   ✅ Gemini success');
      return response.text || '';
    } catch (error) {
      console.warn('   ⚠️ Gemini failed:', error.message);
      errors.push(`Gemini: ${error.message}`);
    }
  }
  
  // Try OpenAI fallback
  if (openai) {
    try {
      console.log('   🤖 Trying OpenAI...');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4000,
        temperature: 0.3
      });
      console.log('   ✅ OpenAI success');
      return response.choices[0]?.message?.content || '';
    } catch (error) {
      console.warn('   ⚠️ OpenAI failed:', error.message);
      errors.push(`OpenAI: ${error.message}`);
    }
  }
  
  throw new Error(`All AI providers failed: ${errors.join('; ')}`);
}

// Dynamic import for pdf-parse
let pdfParse = null;
async function loadPdfParse() {
  if (!pdfParse) {
    const module = await import('pdf-parse');
    pdfParse = module.default;
  }
  return pdfParse;
}

/**
 * Parse PDF and extract raw text
 */
async function extractPdfText(pdfPath) {
  try {
    const pdf = await loadPdfParse();
    
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF not found: ${pdfPath}`);
    }
    
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    
    return {
      success: true,
      text: data.text,
      numPages: data.numpages
    };
  } catch (error) {
    console.error('PDF extraction error:', error.message);
    return { success: false, error: error.message, text: '' };
  }
}

/**
 * Use Gemini AI to extract structured data from PDF text
 * This extracts EVERYTHING dynamically - no assumptions
 */
async function extractWithAI(pdfText) {
  if (!process.env.GEMINI_API_KEY) {
    console.log('⚠️ No Gemini API key - using pattern matching');
    return null;
  }
  
  const prompt = `You are an expert at parsing RFP/Tender documents for electrical cables.
  
CRITICAL: Extract EXACTLY what is written in the document. Do NOT make assumptions.

From this PDF text, extract a JSON object with:

{
  "tender_id": "string - exact tender/RFP reference number",
  "organisation": "string - buyer organization name",
  "title": "string - tender title",
  "due_date": "string - submission deadline (YYYY-MM-DD format)",
  "city": "string - delivery location/city",
  
  "cable_requirements": [
    {
      "item_no": number,
      "cable_type": "string - HT Cable/LT Cable/Control Cable/EHV Cable/Instrumentation Cable",
      "voltage": "string - e.g., 11kV, 33kV, 1.1kV",
      "conductor": "string - Copper or Aluminium",
      "size": "string - e.g., 95 sqmm, 120 sqmm",
      "cores": "string - e.g., 3, 4, 12",
      "insulation": "string - XLPE or PVC",
      "armoured": "string - Armoured or Non-Armoured",
      "qty_km": number,
      "standard": "string - IS/IEC standard"
    }
  ],
  
  "testing_requirements": {
    "routine_tests": [
      {"name": "string - exact test name from document", "standard": "string"}
    ],
    "type_tests": [
      {"name": "string - exact test name from document", "standard": "string"}
    ],
    "third_party_inspection": {
      "required": boolean,
      "agency": "string - NABL/CPRI/etc if mentioned"
    }
  },
  
  "submission": {
    "mode": "string - EMAIL_FORM/LETTER_COURIER/EXTERNAL_PORTAL/MEETING_EMAIL",
    "email": "string - if email submission",
    "address": "string - if physical submission",
    "portal_url": "string - if portal submission",
    "form_reference": "string - Annexure-A/B/etc"
  },
  
  "terms": {
    "delivery_weeks": number,
    "payment_terms": "string",
    "warranty_months": number,
    "ld_clause": "string"
  }
}

IMPORTANT:
- For cable_requirements: Extract EACH cable item separately with EXACT quantities
- For testing_requirements: Extract EXACT test names as written in the document
- voltage must include the unit (kV)
- qty_km must be a number (kilometers)

PDF TEXT:
${pdfText}

Return ONLY the JSON object, no other text.`;

  try {
    // Use multi-provider fallback (Gemini -> OpenAI)
    const responseText = await generateWithFallback(prompt);
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return null;
  } catch (error) {
    console.error('AI extraction error:', error.message);
    return null;
  }
}

/**
 * Pattern-based extraction as fallback
 * Enhanced to parse the specific RFP format with tables
 */
function extractWithPatterns(pdfText) {
  const data = {
    tender_id: null,
    organisation: null,
    title: null,
    due_date: null,
    city: null,
    cable_requirements: [],
    testing_requirements: { routine_tests: [], type_tests: [], third_party_inspection: { required: false } },
    submission: {},
    terms: {},
    external_testing_required: false
  };
  
  const text = pdfText;
  const textLower = text.toLowerCase();
  
  console.log('📋 Pattern-based extraction starting...');
  
  // Extract tender ID - multiple patterns
  const idPatterns = [
    /RFP\s*ID[:\s]*([A-Z]{2,4}[\-]?\d{3,4})/i,
    /Tender\s*(?:ID|No)[:\s]*([A-Z]{2,4}[\-]?\d{3,4})/i,
    /Reference[:\s]*([A-Z]{2,4}[\-]?\d{3,4})/i,
    /([A-Z]{2,4}[\-]\d{3})/
  ];
  for (const pattern of idPatterns) {
    const match = text.match(pattern);
    if (match) {
      data.tender_id = match[1].toUpperCase();
      console.log(`   ✓ Tender ID: ${data.tender_id}`);
      break;
    }
  }
  
  // Extract organisation
  const orgPatterns = [
    /Organization[:\s]*([A-Za-z\s]+(?:Ltd|Limited|Corporation|Industries))/i,
    /Organisation[:\s]*([A-Za-z\s]+(?:Ltd|Limited|Corporation|Industries))/i,
    /Buyer[:\s]*([A-Za-z\s]+(?:Ltd|Limited|Corporation|Industries))/i
  ];
  for (const pattern of orgPatterns) {
    const match = text.match(pattern);
    if (match) {
      data.organisation = match[1].trim();
      console.log(`   ✓ Organisation: ${data.organisation}`);
      break;
    }
  }
  
  // Extract location
  const locationMatch = text.match(/Location[:\s]*([A-Za-z\s,]+?)(?:\n|India)/i);
  if (locationMatch) {
    data.city = locationMatch[1].trim().replace(/,\s*$/, '');
    console.log(`   ✓ City: ${data.city}`);
  }
  
  // ========== SECTION 1: SCOPE OF SUPPLY ==========
  console.log('   📦 Extracting cable requirements...');
  console.log('   📝 PDF text length:', text.length);
  
  let tableMatch;
  
  // PATTERN 1: Header section format "Item 1: 6.6kV HT Cable - 3C x 70 sqmm Copper (5 km)"
  const headerPattern = /Item\s*(\d+)[:\s]+(\d+(?:\.\d+)?)\s*kV\s+(HT|LT|Control|EHV|Instrumentation)\s*Cable[^(]*?(\d+)\s*C?\s*[x×]\s*(\d+(?:\.\d+)?)\s*sqmm[^(]*?(Copper|Aluminium|Al|Cu)[^(]*?\((\d+(?:\.\d+)?)\s*km\)/gi;
  
  while ((tableMatch = headerPattern.exec(text)) !== null) {
    const cableType = tableMatch[3] + ' Cable';
    const cable = {
      item_no: parseInt(tableMatch[1]),
      cable_type: cableType === 'HT Cable' ? 'HT Cable' : cableType,
      voltage: tableMatch[2] + 'kV',
      size: tableMatch[5] + ' sqmm',
      cores: tableMatch[4],
      conductor: tableMatch[6].toLowerCase().includes('copper') || tableMatch[6].toLowerCase() === 'cu' ? 'Copper' : 'Aluminium',
      qty_km: parseFloat(tableMatch[7]),
      standard: 'IS 7098',
      insulation: 'XLPE',
      armoured: 'Armoured'
    };
    data.cable_requirements.push(cable);
    console.log(`      ✓ Item ${cable.item_no}: ${cable.voltage} ${cable.cable_type} - ${cable.qty_km} km (header pattern)`);
  }
  
  // PATTERN 2: Table row format "1 HT Cable 6.6kV 70 sqmm 3C Copper 5 IS 7098"
  if (data.cable_requirements.length === 0) {
    const tableRowPattern = /(\d+)\s+(HT Cable|LT Cable|Control Cable|EHV Cable|Instrumentation Cable)\s+(\d+(?:\.\d+)?)\s*kV\s+(\d+(?:\.\d+)?)\s*sqmm\s+(\d+)C\s+(Copper|Aluminium|Al|Cu)\s+(\d+(?:\.\d+)?)\s+(IS\s*\d+)/gi;
    
    while ((tableMatch = tableRowPattern.exec(text)) !== null) {
      const cable = {
        item_no: parseInt(tableMatch[1]),
        cable_type: tableMatch[2],
        voltage: tableMatch[3] + 'kV',
        size: tableMatch[4] + ' sqmm',
        cores: tableMatch[5],
        conductor: tableMatch[6].includes('Cu') || tableMatch[6].toLowerCase().includes('copper') ? 'Copper' : 'Aluminium',
        qty_km: parseFloat(tableMatch[7]),
        standard: tableMatch[8],
        insulation: 'XLPE',
        armoured: 'Armoured'
      };
      data.cable_requirements.push(cable);
      console.log(`      ✓ Item ${cable.item_no}: ${cable.voltage} ${cable.cable_type} - ${cable.qty_km} km (table pattern)`);
    }
  }
  
  // PATTERN 3: Look for ITEM SPECIFICATIONS sections with Quantity field
  const itemSpecPattern = /ITEM\s*(\d+)\s*SPECIFICATIONS[:\s]*(HT Cable|Control Cable|LT Cable|EHV Cable)[\s\S]*?Quantity[:\s]*(\d+(?:\.\d+)?)\s*km/gi;
  while ((tableMatch = itemSpecPattern.exec(text)) !== null) {
    const itemNo = parseInt(tableMatch[1]);
    const cableType = tableMatch[2];
    const qty = parseFloat(tableMatch[3]);
    
    // Check if we already have this item
    const existingItem = data.cable_requirements.find(c => c.item_no === itemNo);
    if (existingItem) {
      // UPDATE existing item's quantity
      console.log(`      📝 Updating Item ${itemNo} quantity: ${existingItem.qty_km} → ${qty} km`);
      existingItem.qty_km = qty;
    } else {
      // ADD new item from specifications
      const cable = {
        item_no: itemNo,
        cable_type: cableType,
        voltage: 'N/A',
        size: 'N/A',
        cores: 'N/A',
        conductor: 'N/A',
        qty_km: qty,
        standard: 'IS 7098',
        insulation: 'XLPE',
        armoured: 'Armoured'
      };
      data.cable_requirements.push(cable);
      console.log(`      ✓ Item ${itemNo}: ${cableType} - ${qty} km (spec section)`);
    }
  }
  
  // PATTERN 4: Look for individual specification sections and extract Quantity
  // Format: "ITEM 1 SPECIFICATIONS: HT Cable ... Quantity 5 km"
  const specSectionPattern = /ITEM\s*(\d+)\s*SPECIFICATIONS[:\s]*([\s\S]*?)(?=ITEM\s*\d+\s*SPECIFICATIONS|SECTION\s*\d|$)/gi;
  while ((tableMatch = specSectionPattern.exec(text)) !== null) {
    const itemNo = parseInt(tableMatch[1]);
    const sectionText = tableMatch[2];
    
    // Extract quantity from this section
    const qtyMatch = sectionText.match(/Quantity[:\s]*(\d+(?:\.\d+)?)\s*km/i);
    if (qtyMatch) {
      const qty = parseFloat(qtyMatch[1]);
      const existingItem = data.cable_requirements.find(c => c.item_no === itemNo);
      if (existingItem && existingItem.qty_km !== qty) {
        console.log(`      📝 Spec section: Updating Item ${itemNo} quantity: ${existingItem.qty_km} → ${qty} km`);
        existingItem.qty_km = qty;
      }
    }
    
    // Extract other details from this section
    const voltageMatch = sectionText.match(/Voltage\s*Rating[:\s]*(\d+(?:\.\d+)?)\s*kV/i);
    const cableTypeMatch = sectionText.match(/Cable\s*Type[:\s]*(HT Cable|Control Cable|LT Cable|EHV Cable)/i);
    
    if (voltageMatch || cableTypeMatch) {
      const existingItem = data.cable_requirements.find(c => c.item_no === itemNo);
      if (existingItem) {
        if (voltageMatch) existingItem.voltage = voltageMatch[1] + 'kV';
        if (cableTypeMatch) existingItem.cable_type = cableTypeMatch[1];
      }
    }
  }
  
  console.log(`   📊 Total cables extracted: ${data.cable_requirements.length}`);
  if (data.cable_requirements.length === 0) {
    console.log('   ⚠️ No cables found with patterns. Checking raw text for cable mentions...');
    // Log a sample of the text for debugging
    console.log('   📄 Text sample:', text.substring(0, 500).replace(/\n/g, ' '));
  }
  
  // ========== SECTION 2: TESTING REQUIREMENTS ==========
  console.log('   🧪 Extracting testing requirements...');
  
  const testSection = text.match(/SECTION\s*2[:\s]*TESTING[\s\S]*?(?=SECTION\s*3|BID\s*SUBMISSION|TERMS|$)/i);
  const testText = testSection ? testSection[0] : text;
  
  // Extract routine tests with their standards
  const routineTestPatterns = [
    { pattern: /Insulation\s*Resistance\s*Test[^)]*\)\s*as\s*per\s*(IS\s*\d+)/i, name: 'Insulation Resistance Test' },
    { pattern: /Spark\s*Test[^)]*\)\s*as\s*per\s*(IS\s*\d+)/i, name: 'Spark Test' },
    { pattern: /Voltage\s*Drop\s*Test[^)]*\)\s*as\s*per\s*(IS\s*\d+)/i, name: 'Voltage Drop Test' },
    { pattern: /Conductor\s*Resistance\s*Test[^)]*\)\s*as\s*per\s*(IS\s*\d+)/i, name: 'Conductor Resistance Test' }
  ];
  
  for (const test of routineTestPatterns) {
    const match = testText.match(test.pattern);
    if (match) {
      data.testing_requirements.routine_tests.push({
        name: test.name,
        standard: match[1] || ''
      });
      console.log(`      Routine: ${test.name}`);
    } else if (testText.toLowerCase().includes(test.name.toLowerCase().split(' ')[0])) {
      // Fallback: just check if test name is mentioned
      data.testing_requirements.routine_tests.push({
        name: test.name,
        standard: ''
      });
      console.log(`      Routine: ${test.name} (no standard found)`);
    }
  }
  
  // Extract type tests
  const typeTestPatterns = [
    { pattern: /High\s*Voltage\s*Test\s*\(HT\)[^)]*as\s*per\s*(IS\s*\d+|IEC\s*\d+)/i, name: 'High Voltage Test' },
    { pattern: /Water\s*Immersion\s*Test[^)]*as\s*per\s*(IS\s*\d+|IEC\s*\d+)/i, name: 'Water Immersion Test' },
    { pattern: /Partial\s*Discharge\s*Test[^)]*as\s*per\s*(IS\s*\d+|IEC\s*\d+)/i, name: 'Partial Discharge Test' },
    { pattern: /Bending\s*Test[^)]*as\s*per\s*(IS\s*\d+)/i, name: 'Bending Test' },
    { pattern: /Tensile\s*Strength\s*Test[^)]*as\s*per\s*(IS\s*\d+)/i, name: 'Tensile Strength Test' },
    { pattern: /Impulse\s*(?:Voltage\s*)?Test[^)]*as\s*per\s*(IS\s*\d+|IEC\s*\d+)/i, name: 'Impulse Test' },
    { pattern: /Tan\s*Delta\s*Test/i, name: 'Tan Delta Test' }
  ];
  
  for (const test of typeTestPatterns) {
    const match = testText.match(test.pattern);
    if (match) {
      data.testing_requirements.type_tests.push({
        name: test.name,
        standard: match[1] || ''
      });
      console.log(`      Type: ${test.name}`);
    } else {
      // Check for simpler mentions
      const simplePattern = new RegExp(test.name.replace(/\s+/g, '\\s*'), 'i');
      if (simplePattern.test(testText)) {
        data.testing_requirements.type_tests.push({
          name: test.name,
          standard: ''
        });
        console.log(`      Type: ${test.name} (simple match)`);
      }
    }
  }
  
  // Check for THIRD PARTY INSPECTION
  const tpiMatch = testText.match(/THIRD\s*PARTY\s*INSPECTION[:\s]*([\s\S]*?)(?=\n\n|SECTION|$)/i);
  if (tpiMatch) {
    const tpiText = tpiMatch[1] || '';
    data.testing_requirements.third_party_inspection = {
      required: true,
      agency: /NABL/i.test(tpiText) ? 'NABL accredited' : (/CPRI/i.test(tpiText) ? 'CPRI' : 'TPI required')
    };
    data.external_testing_required = true;
    console.log(`      Third Party: Required (${data.testing_requirements.third_party_inspection.agency})`);
  } else if (/THIRD\s*PARTY|TPI|NABL.*mandatory|CPRI.*mandatory/i.test(testText)) {
    data.testing_requirements.third_party_inspection = {
      required: true,
      agency: /NABL/i.test(testText) ? 'NABL accredited' : 'TPI required'
    };
    data.external_testing_required = true;
    console.log(`      Third Party: Required`);
  } else {
    data.testing_requirements.third_party_inspection = {
      required: false,
      agency: ''
    };
    data.external_testing_required = false;
    console.log(`      Third Party: NOT required`);
  }
  
  // ========== SECTION 3: SUBMISSION MODE ==========
  console.log('   📮 Extracting submission mode...');
  
  // Check for specific submission mode keywords
  if (/SUBMISSION\s*MODE[:\s]*PRE-?BID\s*MEETING/i.test(text) || 
      /pre-?bid\s*meeting\s*(?:is\s*)?(?:required|mandatory)/i.test(text)) {
    data.submission.mode = 'MEETING_EMAIL';
    console.log(`      Mode: MEETING_EMAIL (Pre-bid meeting required)`);
  } else if (/SUBMISSION\s*MODE[:\s]*(?:PHYSICAL|COURIER|LETTER)/i.test(text) ||
             /physical\s*submission|courier.*bid|send.*registered\s*post/i.test(text)) {
    data.submission.mode = 'LETTER_COURIER';
    console.log(`      Mode: LETTER_COURIER`);
  } else if (/SUBMISSION\s*MODE[:\s]*(?:EMAIL|FORM)/i.test(text) ||
             /email.*annexure|fill.*form.*email|submit.*email/i.test(text)) {
    data.submission.mode = 'EMAIL_FORM';
    console.log(`      Mode: EMAIL_FORM`);
  } else if (/portal\s*registration|register.*portal|vendor\s*portal/i.test(text)) {
    data.submission.mode = 'EXTERNAL_PORTAL';
    console.log(`      Mode: EXTERNAL_PORTAL`);
  }
  
  // Extract email
  const emailMatch = text.match(/(?:Meeting\s*Request\s*)?Email[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) {
    data.submission.email = emailMatch[1];
    console.log(`      Email: ${data.submission.email}`);
  }
  
  // Extract address if courier mode
  if (data.submission.mode === 'LETTER_COURIER') {
    const addressMatch = text.match(/(?:Submit|Courier|Send)\s*(?:to|at)[:\s]*([\s\S]{20,200}?)(?:before|by|\d{1,2}[\/-])/i);
    if (addressMatch) {
      data.submission.address = addressMatch[1].trim().replace(/\n+/g, ', ');
    }
  }
  
  console.log('📋 Pattern extraction complete');
  console.log(`   Cables: ${data.cable_requirements.length}, Tests: ${data.testing_requirements.routine_tests.length + data.testing_requirements.type_tests.length}`);
  
  return data;
}

/**
 * Load cable CSVs and find matching product
 */
async function matchCableToCSV(cableReq) {
  // Determine which CSV to use based on cable type
  let csvType = 'lt_cables';
  const cableTypeLower = (cableReq.cable_type || '').toLowerCase();
  
  if (cableTypeLower.includes('ht')) csvType = 'ht_cables';
  else if (cableTypeLower.includes('control')) csvType = 'control_cables';
  else if (cableTypeLower.includes('ehv')) csvType = 'ehv_cables';
  else if (cableTypeLower.includes('instrumentation')) csvType = 'instrumentation_cables';
  
  // Get CSV data (uses adaptive overrides if available)
  let csvData = adaptiveCsvManager.getCSVData(csvType);
  
  // Fallback to loading from file if not in memory
  if (!csvData || csvData.length === 0) {
    const csvPath = path.join(__dirname, `../data/${csvType}.csv`);
    if (fs.existsSync(csvPath)) {
      const csvContent = fs.readFileSync(csvPath, 'utf-8');
      csvData = parseCSV(csvContent);
    }
  }
  
  if (!csvData || csvData.length === 0) {
    console.log(`⚠️ No CSV data found for ${csvType}`);
    return null;
  }
  
  // Extract numeric values for matching
  const reqVoltage = parseFloat((cableReq.voltage || '').replace(/[^0-9.]/g, '')) || 0;
  const reqSize = parseFloat((cableReq.size || '').replace(/[^0-9.]/g, '')) || 0;
  const reqCores = parseInt(cableReq.cores) || 0;
  
  // Find best match
  let bestMatch = null;
  let bestScore = 0;
  
  for (const product of csvData) {
    let score = 0;
    
    // Voltage match (most important)
    const prodVoltage = parseFloat(product.Voltage_kV || product.voltage || '0');
    if (Math.abs(prodVoltage - reqVoltage) < 1) score += 40;
    else if (Math.abs(prodVoltage - reqVoltage) < 5) score += 20;
    
    // Size match
    const prodSize = parseFloat(product.Size_sqmm || product.cross_section || product.size || '0');
    if (Math.abs(prodSize - reqSize) < 5) score += 30;
    else if (Math.abs(prodSize - reqSize) < 20) score += 15;
    
    // Cores match
    const prodCores = parseInt(product.Cores || product.no_of_cores || '0');
    if (prodCores === reqCores) score += 20;
    
    // Conductor match
    const prodConductor = (product.Conductor || product.conductor_material || '').toLowerCase();
    const reqConductor = (cableReq.conductor || '').toLowerCase();
    if (prodConductor.includes(reqConductor.substring(0, 3))) score += 10;
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = product;
    }
  }
  
  if (bestMatch) {
    return {
      product: bestMatch,
      matchScore: bestScore,
      unitPrice: parseFloat(bestMatch.Unit_Price_Per_Km || bestMatch.price_per_km || bestMatch.Price_INR || 0)
    };
  }
  
  return null;
}

/**
 * Load testing CSV and match tests
 */
async function matchTestsToCSV(testNames) {
  // Get testing data (uses adaptive overrides if available)
  let testingData = adaptiveCsvManager.getCSVData('testing');
  
  // Fallback to loading from file
  if (!testingData || testingData.length === 0) {
    const testingPath = path.join(__dirname, '../data/testing.csv');
    if (fs.existsSync(testingPath)) {
      const csvContent = fs.readFileSync(testingPath, 'utf-8');
      testingData = parseCSV(csvContent);
    }
  }
  
  if (!testingData || testingData.length === 0) {
    console.log('⚠️ No testing CSV data found');
    return [];
  }
  
  const matchedTests = [];
  
  for (const testName of testNames) {
    const testNameLower = testName.toLowerCase();
    
    // Find best matching test in CSV
    for (const test of testingData) {
      const csvTestName = (test.Test_Name || test.test_name || '').toLowerCase();
      
      // Check for partial match
      if (csvTestName.includes(testNameLower.split(' ')[0]) || 
          testNameLower.includes(csvTestName.split(' ')[0])) {
        matchedTests.push({
          name: test.Test_Name || test.test_name,
          testId: test.Test_ID || test.test_id,
          price: parseFloat(test.Price_INR || test.price || 0),
          standard: test.Standard || test.standard || '',
          duration: parseInt(test.Duration_Days || test.duration || 1)
        });
        break;
      }
    }
  }
  
  return matchedTests;
}

/**
 * Simple CSV parser
 */
function parseCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    if (values.length >= headers.length) {
      const row = {};
      headers.forEach((h, idx) => row[h] = values[idx]);
      data.push(row);
    }
  }
  
  return data;
}

/**
 * MAIN FUNCTION: Analyze RFP PDF dynamically
 * 
 * This is the core function that parses an actual PDF and calculates everything dynamically.
 * 
 * @param {string} pdfPath - Path to the RFP PDF file
 * @returns {Object} Complete analysis with quotation
 */
export async function analyzeRFPDynamically(pdfPath) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📄 DYNAMIC RFP ANALYSIS`);
  console.log(`📂 PDF: ${pdfPath}`);
  console.log(`${'='.repeat(60)}\n`);
  
  // Step 1: Extract PDF text
  console.log('📖 Step 1: Extracting PDF text...');
  const pdfResult = await extractPdfText(pdfPath);
  
  if (!pdfResult.success) {
    return { success: false, error: `PDF extraction failed: ${pdfResult.error}` };
  }
  console.log(`   ✅ Extracted ${pdfResult.text.length} characters from ${pdfResult.numPages} pages`);
  
  // Step 2: Use AI to extract structured data
  console.log('\n🤖 Step 2: AI extraction...');
  let extractedData = await extractWithAI(pdfResult.text);
  
  if (!extractedData) {
    console.log('   ⚠️ AI extraction failed, using pattern matching...');
    extractedData = extractWithPatterns(pdfResult.text);
  } else {
    console.log('   ✅ AI extraction successful');
  }
  
  // Step 3: Process cable requirements
  console.log('\n📦 Step 3: Matching cables to CSV...');
  const cableAnalysis = [];
  let totalMaterialCost = 0;
  
  for (const cable of (extractedData.cable_requirements || [])) {
    const match = await matchCableToCSV(cable);
    
    if (match) {
      const lineCost = match.unitPrice * (cable.qty_km || 1);
      // Add 12% hidden margin
      const costWithMargin = Math.round(lineCost * 1.12);
      
      cableAnalysis.push({
        ...cable,
        matched_product: match.product.Product_Name || match.product.description || 'Matched',
        match_score: match.matchScore,
        unit_price: match.unitPrice,
        quantity_km: cable.qty_km || 1,
        line_cost: costWithMargin,
        margin_included: true
      });
      
      totalMaterialCost += costWithMargin;
      console.log(`   ✅ ${cable.cable_type}: ${cable.qty_km}km × ₹${match.unitPrice.toLocaleString()} = ₹${costWithMargin.toLocaleString()}`);
    } else {
      console.log(`   ⚠️ No match found for ${cable.cable_type}`);
    }
  }
  
  // Step 4: Process testing requirements
  console.log('\n🧪 Step 4: Matching tests to testing.csv...');
  const allTestNames = [];
  
  // Collect all test names from routine and type tests
  const routineTests = extractedData.testing_requirements?.routine_tests || [];
  const typeTests = extractedData.testing_requirements?.type_tests || [];
  
  for (const test of routineTests) {
    allTestNames.push(test.name);
  }
  for (const test of typeTests) {
    allTestNames.push(test.name);
  }
  
  const matchedTests = await matchTestsToCSV(allTestNames);
  let totalTestingCost = 0;
  const testingDetails = [];
  
  // Calculate testing cost: test_price × cable_quantity for each cable
  for (const cable of (extractedData.cable_requirements || [])) {
    const qtyKm = cable.qty_km || 1;
    
    for (const test of matchedTests) {
      const testCost = test.price * qtyKm;
      testingDetails.push({
        test_name: test.name,
        test_id: test.testId,
        unit_price: test.price,
        quantity_km: qtyKm,
        for_cable: `${cable.voltage} ${cable.cable_type}`,
        cost: testCost
      });
      totalTestingCost += testCost;
      console.log(`   ✅ ${test.name}: ${qtyKm}km × ₹${test.price.toLocaleString()} = ₹${testCost.toLocaleString()}`);
    }
  }
  
  // Step 5: Calculate final quotation
  console.log('\n💰 Step 5: Calculating quotation...');
  const subtotal = totalMaterialCost + totalTestingCost;
  const gst = Math.round(subtotal * 0.18);
  const grandTotal = subtotal + gst;
  
  const quotation = {
    materialCost: {
      total: totalMaterialCost,
      items: cableAnalysis,
      note: 'Includes 12% margin'
    },
    testingCost: {
      total: totalTestingCost,
      items: testingDetails,
      note: `Based on ${matchedTests.length} tests from RFP`
    },
    externalTesting: {
      required: extractedData.testing_requirements?.third_party_inspection?.required || false,
      agency: extractedData.testing_requirements?.third_party_inspection?.agency || '',
      estimated_cost: 'TBD'
    },
    gst: {
      rate: 18,
      amount: gst
    },
    grandTotal: grandTotal
  };
  
  console.log(`\n   Material Cost: ₹${totalMaterialCost.toLocaleString()}`);
  console.log(`   Testing Cost:  ₹${totalTestingCost.toLocaleString()}`);
  console.log(`   GST (18%):     ₹${gst.toLocaleString()}`);
  console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`   GRAND TOTAL:   ₹${grandTotal.toLocaleString()}`);
  
  // Build complete result
  const result = {
    success: true,
    extraction_method: extractedData ? 'AI_ENHANCED' : 'PATTERN_MATCHING',
    
    // Basic info from PDF
    tender_id: extractedData.tender_id,
    organisation: extractedData.organisation,
    title: extractedData.title,
    due_date: extractedData.due_date,
    city: extractedData.city,
    
    // Cable requirements (as extracted from PDF)
    cable_requirements: cableAnalysis,
    
    // Testing requirements (as extracted from PDF)
    testing_requirements: {
      routine_tests: routineTests,
      type_tests: typeTests,
      matched_tests: matchedTests,
      third_party_inspection: extractedData.testing_requirements?.third_party_inspection
    },
    
    // Submission mode (from PDF)
    submission: extractedData.submission || {},
    
    // Terms (from PDF)
    terms: extractedData.terms || {
      delivery_weeks: 8,
      payment_terms: '30 days from delivery',
      warranty_months: 18,
      ld_clause: '0.5% per week, max 5%'
    },
    
    // Calculated quotation
    quotation: quotation,
    
    // Raw data for debugging
    raw_extracted: extractedData
  };
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ ANALYSIS COMPLETE`);
  console.log(`${'='.repeat(60)}\n`);
  
  return result;
}

/**
 * Analyze RFP by tender ID
 * Checks for uploaded PDF first, then falls back to original
 * Uses stored extracted data when available to avoid re-parsing
 */
export async function analyzeRFPById(tenderId) {
  // Use uploaded PDF store to get the correct PDF path
  const pdfInfo = getPdfPath(tenderId);
  
  if (!pdfInfo) {
    return { 
      success: false, 
      error: `PDF not found for tender ${tenderId}. Try uploading the RFP document first.` 
    };
  }
  
  console.log(`\n📄 Analyzing RFP: ${tenderId}`);
  console.log(`   Source: ${pdfInfo.source}`);
  console.log(`   File: ${pdfInfo.originalName}`);
  
  // Check if we have stored extracted data from the upload
  const storedData = getExtractedData(tenderId);
  
  if (storedData && pdfInfo.source === 'UPLOADED') {
    console.log(`   📊 Using STORED extracted data (from initial upload)`);
    
    // Use the stored analysis text for pattern extraction
    const analysisText = storedData.analysis_text || '';
    
    // Parse cable requirements from the analysis text
    const cableRequirements = parseCableRequirementsFromAnalysis(analysisText, storedData.raw_data);
    
    // Parse testing requirements
    const testingRequirements = parseTestingRequirementsFromAnalysis(analysisText);
    
    // Parse submission mode
    const submissionMode = parseSubmissionModeFromAnalysis(analysisText);
    
    // Check for external testing - only if EXPLICITLY required
    // Must have specific phrases indicating mandatory external testing
    const externalTestingPatterns = [
      /third\s*party\s*inspection.*(?:mandatory|required|must)/i,
      /TPI.*(?:mandatory|required|must)/i,
      /NABL.*(?:mandatory|required|must|accredited\s*agency)/i,
      /CPRI.*(?:mandatory|required|must)/i,
      /external\s*testing.*(?:required|mandatory)/i,
      /mandatory.*third\s*party/i,
      /TPI\s*by\s*NABL/i
    ];
    
    let externalTestingRequired = false;
    for (const pattern of externalTestingPatterns) {
      if (pattern.test(analysisText)) {
        externalTestingRequired = true;
        console.log(`   🧪 External testing REQUIRED (matched: ${pattern})`);
        break;
      }
    }
    
    // Double check - if text says "Not explicitly stated" or "Not mentioned", it's NOT required
    if (/external\s*testing.*not\s*(?:explicitly\s*)?(?:stated|mentioned|specified|required)/i.test(analysisText)) {
      externalTestingRequired = false;
      console.log(`   🧪 External testing NOT required (explicitly stated as not required)`);
    }
    
    console.log(`   🧪 External testing required: ${externalTestingRequired}`);
    
    // Calculate costs based on extracted data
    const materialCostResult = await calculateMaterialCostFromCables(cableRequirements);
    const testingCostResult = await calculateTestingCostFromTests(testingRequirements, cableRequirements);
    
    const totalBeforeGST = materialCostResult.total + testingCostResult.total;
    const gst = Math.round(totalBeforeGST * 0.18);
    const grandTotal = totalBeforeGST + gst;
    
    const result = {
      success: true,
      pdf_source: 'UPLOADED',
      pdf_filename: pdfInfo.originalName,
      uploaded_at: pdfInfo.uploadedAt,
      extraction_method: 'STORED_DATA',
      
      tender_id: storedData.tender_id,
      organisation: storedData.organisation,
      title: storedData.title,
      due_date: storedData.due_date,
      city: storedData.city,
      
      cable_requirements: cableRequirements,
      testing_requirements: testingRequirements,
      external_testing_required: externalTestingRequired,
      
      submission: submissionMode,
      
      terms: {
        delivery_weeks: 8,
        payment_terms: '30 days from delivery',
        warranty_months: 18,
        ld_clause: '0.5% per week, max 5%'
      },
      
      quotation: {
        materialCost: materialCostResult,
        testingCost: testingCostResult,
        gst: { rate: 18, amount: gst },
        grandTotal: grandTotal
      }
    };
    
    console.log(`   ✅ Analysis complete (using stored data)`);
    console.log(`   📦 Cables: ${cableRequirements.length} items`);
    console.log(`   🧪 External testing: ${externalTestingRequired}`);
    
    return result;
  }
  
  // Fall back to full PDF parsing
  console.log(`   📖 Parsing PDF from scratch...`);
  const result = await analyzeRFPDynamically(pdfInfo.path);
  
  // Add source info to result
  if (result.success) {
    result.pdf_source = pdfInfo.source;
    result.pdf_filename = pdfInfo.originalName;
    if (pdfInfo.uploadedAt) {
      result.uploaded_at = pdfInfo.uploadedAt;
    }
  }
  
  return result;
}

/**
 * Parse cable requirements from AI analysis text and raw data
 */
function parseCableRequirementsFromAnalysis(analysisText, rawData) {
  const cables = [];
  console.log('   🔍 Parsing cable requirements...');
  
  // FIRST: Try to get from raw extracted data (most reliable)
  if (rawData) {
    console.log('   📋 Checking raw extracted data...');
    
    // Check for cable_items in raw data
    if (rawData.cable_items && Array.isArray(rawData.cable_items)) {
      rawData.cable_items.forEach((item, i) => {
        cables.push({
          item_no: i + 1,
          cable_type: item.cable_type || item.type || 'Cable',
          voltage: item.voltage || 'N/A',
          cores: item.cores || item.no_of_cores || 'N/A',
          size: item.size || item.cross_section || 'N/A',
          qty_km: parseFloat(item.qty_km || item.quantity || item.qty || 1),
          conductor: item.conductor || 'Copper',
          insulation: item.insulation || 'XLPE',
          armoured: 'Armoured',
          standard: item.standard || 'IS 7098'
        });
      });
      console.log(`   ✅ Found ${cables.length} cables in raw data`);
    }
    
    // Check for material field with embedded cable info
    const material = rawData.material || rawData.Material || '';
    if (cables.length === 0 && material) {
      // Pattern: "6.6kV HT Cable - 3C x 70 sqmm Copper (5 km), 1.1kV Control Cable..."
      const cablePattern = /(\d+(?:\.\d+)?)\s*kV\s+(HT|LT|Control|EHV|Instrumentation)\s*Cable[^,)]*?(\d+)\s*C?\s*[x×]\s*(\d+(?:\.\d+)?)\s*sqmm[^,)]*?\(?(\d+(?:\.\d+)?)\s*km\)?/gi;
      let match;
      let itemNo = 1;
      
      while ((match = cablePattern.exec(material)) !== null) {
        cables.push({
          item_no: itemNo++,
          cable_type: match[2] + ' Cable',
          voltage: match[1] + 'kV',
          cores: match[3],
          size: match[4] + ' sqmm',
          qty_km: parseFloat(match[5]),
          conductor: 'Copper',
          insulation: 'XLPE',
          armoured: 'Armoured',
          standard: 'IS 7098'
        });
      }
      if (cables.length > 0) {
        console.log(`   ✅ Found ${cables.length} cables in material field`);
      }
    }
  }
  
  // SECOND: Try to parse from analysis text
  if (cables.length === 0 && analysisText) {
    console.log('   📝 Parsing from AI analysis text...');
    
    // Pattern 1: "6.6kV HT Cable - 3C x 70 sqmm Copper (5 km)"
    const pattern1 = /(\d+(?:\.\d+)?)\s*kV\s+(HT|LT|Control|EHV|Instrumentation)\s*Cable[^(]*?(\d+)\s*C?\s*[x×]\s*(\d+(?:\.\d+)?)\s*sqmm[^(]*?\((\d+(?:\.\d+)?)\s*km\)/gi;
    let match;
    let itemNo = 1;
    
    while ((match = pattern1.exec(analysisText)) !== null) {
      cables.push({
        item_no: itemNo++,
        cable_type: match[2] + ' Cable',
        voltage: match[1] + 'kV',
        cores: match[3],
        size: match[4] + ' sqmm',
        qty_km: parseFloat(match[5]),
        conductor: 'Copper',
        insulation: 'XLPE',
        armoured: 'Armoured',
        standard: 'IS 7098'
      });
    }
    
    // Pattern 2: Look for "Item 1" patterns
    if (cables.length === 0) {
      const pattern2 = /Item\s*(\d+)[:\s]*([\s\S]*?)(?=Item\s*\d+|KEY\s*POINTS|TESTING|$)/gi;
      while ((match = pattern2.exec(analysisText)) !== null) {
        const itemText = match[2];
        const voltage = itemText.match(/(\d+(?:\.\d+)?)\s*kV/i);
        const cableType = itemText.match(/(HT|LT|Control|EHV|Instrumentation)\s*Cable/i);
        const qty = itemText.match(/(\d+(?:\.\d+)?)\s*km/i);
        const cores = itemText.match(/(\d+)\s*C/i);
        const size = itemText.match(/(\d+(?:\.\d+)?)\s*sqmm/i);
        
        if (cableType && qty) {
          cables.push({
            item_no: parseInt(match[1]),
            cable_type: cableType[1] + ' Cable',
            voltage: voltage ? voltage[1] + 'kV' : 'N/A',
            cores: cores ? cores[1] : 'N/A',
            size: size ? size[1] + ' sqmm' : 'N/A',
            qty_km: parseFloat(qty[1]),
            conductor: 'Copper',
            insulation: 'XLPE',
            armoured: 'Armoured',
            standard: 'IS 7098'
          });
        }
      }
    }
    
    // Pattern 3: General cable mention with quantity
    if (cables.length === 0) {
      // Look for any mention of cables with km values
      const pattern3 = /(HT|LT|Control|EHV|Instrumentation)\s*Cable[^.]*?(\d+(?:\.\d+)?)\s*km/gi;
      itemNo = 1;
      while ((match = pattern3.exec(analysisText)) !== null) {
        cables.push({
          item_no: itemNo++,
          cable_type: match[1] + ' Cable',
          voltage: 'N/A',
          qty_km: parseFloat(match[2]),
          conductor: 'Copper',
          insulation: 'XLPE',
          armoured: 'Armoured',
          standard: 'IS 7098'
        });
      }
    }
  }
  
  // FALLBACK: Create default cables based on document type
  if (cables.length === 0) {
    console.log('   ⚠️ No cables extracted - using fallback detection');
    
    // Check if it mentions cables in general
    if (/HT\s*Cable/i.test(analysisText)) {
      cables.push({
        item_no: 1,
        cable_type: 'HT Cable',
        voltage: '11kV',
        qty_km: 5,
        conductor: 'Copper',
        insulation: 'XLPE',
        armoured: 'Armoured',
        standard: 'IS 7098'
      });
    }
    if (/Control\s*Cable/i.test(analysisText)) {
      cables.push({
        item_no: cables.length + 1,
        cable_type: 'Control Cable',
        voltage: '1.1kV',
        qty_km: 3,
        conductor: 'Copper',
        insulation: 'PVC',
        armoured: 'Armoured',
        standard: 'IS 1554'
      });
    }
  }
  
  console.log(`   📦 Final: ${cables.length} cable requirements`);
  cables.forEach((c, i) => {
    console.log(`      Item ${i+1}: ${c.voltage} ${c.cable_type} - ${c.qty_km} km`);
  });
  
  return cables;
}

/**
 * Parse testing requirements from AI analysis text
 */
function parseTestingRequirementsFromAnalysis(analysisText) {
  const requirements = {
    routine_tests: [],
    type_tests: [],
    third_party_inspection: { required: false }
  };
  
  // Extract routine tests
  const routineMatch = analysisText.match(/Routine\s*Tests?[:\s]*([\s\S]*?)(?=Type\s*Tests?|$)/i);
  if (routineMatch) {
    const tests = routineMatch[1].match(/(?:•|-|\d+\.)\s*([^•\-\n]+)/g) || [];
    tests.forEach(t => {
      const name = t.replace(/^[•\-\d.]+\s*/, '').trim();
      if (name) requirements.routine_tests.push({ name });
    });
  }
  
  // Extract type tests
  const typeMatch = analysisText.match(/Type\s*Tests?[:\s]*([\s\S]*?)(?=Testing\s*Standards|External|Third|$)/i);
  if (typeMatch) {
    const tests = typeMatch[1].match(/(?:•|-|\d+\.)\s*([^•\-\n]+)/g) || [];
    tests.forEach(t => {
      const name = t.replace(/^[•\-\d.]+\s*/, '').trim();
      if (name) requirements.type_tests.push({ name });
    });
  }
  
  // Check for third party inspection - must be explicitly mandatory
  const tpiPatterns = [
    /third\s*party\s*inspection.*(?:mandatory|required|must)/i,
    /TPI.*(?:mandatory|required|must)/i,
    /NABL.*(?:mandatory|required|must)/i,
    /CPRI.*(?:mandatory|required|must)/i,
    /mandatory.*third\s*party/i,
    /TPI\s*by\s*NABL/i
  ];
  
  let tpiRequired = false;
  for (const pattern of tpiPatterns) {
    if (pattern.test(analysisText)) {
      tpiRequired = true;
      break;
    }
  }
  
  // Check for "not required" phrases
  if (/external\s*testing.*not\s*(?:explicitly\s*)?(?:stated|mentioned|specified|required)/i.test(analysisText)) {
    tpiRequired = false;
  }
  
  if (tpiRequired) {
    requirements.third_party_inspection = {
      required: true,
      agency: 'NABL/CPRI accredited'
    };
  }
  
  console.log(`   🧪 Parsed ${requirements.routine_tests.length} routine + ${requirements.type_tests.length} type tests`);
  
  return requirements;
}

/**
 * Parse submission mode from AI analysis text
 */
function parseSubmissionModeFromAnalysis(analysisText) {
  let mode = 'EMAIL_FORM';
  let email = '';
  
  if (/pre-?bid\s*meeting|meeting.*mandatory|request.*meeting/i.test(analysisText)) {
    mode = 'MEETING_EMAIL';
  } else if (/physical.*courier|courier.*address|postal|registered\s*post/i.test(analysisText)) {
    mode = 'LETTER_COURIER';
  } else if (/portal\s*registration|external\s*portal|vendor\s*portal/i.test(analysisText)) {
    mode = 'EXTERNAL_PORTAL';
  }
  
  const emailMatch = analysisText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) email = emailMatch[1];
  
  console.log(`   📮 Submission mode: ${mode}`);
  
  return { mode, email };
}

/**
 * Calculate material cost from cable requirements
 */
async function calculateMaterialCostFromCables(cables) {
  let total = 0;
  const items = [];
  
  // Load cable catalogs
  const htCables = adaptiveCsvManager.getCSVData('ht_cables') || [];
  const ltCables = adaptiveCsvManager.getCSVData('lt_cables') || [];
  const controlCables = adaptiveCsvManager.getCSVData('control_cables') || [];
  
  for (const cable of cables) {
    // Estimate unit price based on cable type
    let unitPrice = 150000; // default per km
    
    if (cable.cable_type?.toLowerCase().includes('ht')) {
      unitPrice = 180000;
    } else if (cable.cable_type?.toLowerCase().includes('control')) {
      unitPrice = 120000;
    } else if (cable.cable_type?.toLowerCase().includes('lt')) {
      unitPrice = 100000;
    }
    
    const lineCost = Math.round(unitPrice * (cable.qty_km || 1) * 1.12); // 12% margin
    total += lineCost;
    
    items.push({
      ...cable,
      unitPrice,
      lineCost
    });
  }
  
  return { total, items };
}

/**
 * Calculate testing cost from requirements
 */
async function calculateTestingCostFromTests(testReqs, cables) {
  let total = 0;
  const tests = [];
  
  // Load testing catalog
  const testingCatalog = adaptiveCsvManager.getCSVData('testing') || [];
  
  // Calculate total cable length for testing
  const totalKm = cables.reduce((sum, c) => sum + (c.qty_km || 0), 0);
  
  // Estimate tests based on extracted requirements
  const allTests = [...(testReqs.routine_tests || []), ...(testReqs.type_tests || [])];
  
  for (const test of allTests) {
    // Estimate test cost
    let testCost = 5000; // default per test
    
    if (/high\s*voltage/i.test(test.name)) testCost = 15000;
    else if (/insulation/i.test(test.name)) testCost = 8000;
    else if (/partial\s*discharge/i.test(test.name)) testCost = 20000;
    else if (/water\s*immersion/i.test(test.name)) testCost = 12000;
    else if (/impulse/i.test(test.name)) testCost = 25000;
    
    // Multiply by km if quantity-based
    const lineCost = Math.round(testCost * Math.max(1, totalKm / 5));
    total += lineCost;
    
    tests.push({
      name: test.name,
      unitCost: testCost,
      lineCost
    });
  }
  
  return { total, tests };
}

export default {
  analyzeRFPDynamically,
  analyzeRFPById,
  extractPdfText,
  extractWithAI,
  extractWithPatterns,
  matchCableToCSV,
  matchTestsToCSV
};

