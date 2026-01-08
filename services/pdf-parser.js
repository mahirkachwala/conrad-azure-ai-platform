/**
 * PDF Parser Service
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Parses PDF documents to extract RFP information including:
 * - Basic tender details (ID, buyer, dates, value)
 * - Technical specifications
 * - Submission instructions (4 modes: EMAIL_FORM, LETTER_COURIER, EXTERNAL_PORTAL, MEETING_EMAIL)
 * - Required tests and certifications
 * 
 * Works with any simple PDF, not just fabricated RFPs
 * Uses Gemini AI for enhanced extraction when available
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { searchCompany, verifyAndEnhanceCompany } from './opencorporates.js';
import { analyzePdf as analyzePdfAzure } from './azure-document-intelligence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Multi-provider AI setup
const geminiKey = process.env.GEMINI_API_KEY || '';
const openaiKey = process.env.OPENAI_API_KEY || '';

const ai = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

console.log(`📋 PDF Parser: Gemini ${geminiKey ? '✅' : '❌'} | OpenAI ${openaiKey ? '✅' : '❌'}`);

// OpenCorporates API Key from environment
const OPENCORPORATES_API_KEY = process.env.OPENCORPORATES_API_KEY || '';

// AI Provider preference (can be 'gemini', 'openai', or 'auto')
const AI_PROVIDER = process.env.PDF_AI_PROVIDER || 'auto';

/**
 * Generate content with multi-provider fallback
 */
async function generateWithFallback(prompt) {
  const errors = [];

  // Try Gemini first (unless OpenAI is preferred)
  if (ai && AI_PROVIDER !== 'openai') {
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

  // If Gemini was skipped due to preference, try it now
  if (ai && AI_PROVIDER === 'openai') {
    try {
      console.log('   🤖 Trying Gemini (fallback)...');
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

  throw new Error(`All AI providers failed: ${errors.join('; ')}`);
}

// Dynamic import for pdf-parse (CommonJS module)
let pdfParse = null;

async function loadPdfParse() {
  if (!pdfParse) {
    const module = await import('pdf-parse');
    pdfParse = module.default;
  }
  return pdfParse;
}

/**
 * Submission modes for RFP responses
 */
export const SUBMISSION_MODES = {
  EMAIL_FORM: 'EMAIL_FORM',           // Fill form inside PDF and email
  LETTER_COURIER: 'LETTER_COURIER',   // Write letter and courier physically
  EXTERNAL_PORTAL: 'EXTERNAL_PORTAL', // Register on separate portal
  MEETING_EMAIL: 'MEETING_EMAIL'      // Email to schedule meeting
};

/**
 * Parse a PDF file and extract text content
 * @param {string|Buffer} pdfSource - File path or Buffer
 * @returns {Promise<Object>} Extracted text and metadata
 */
export async function parsePDF(pdfSource) {
  let dataBuffer;

  // Prepare buffer
  try {
    if (Buffer.isBuffer(pdfSource)) {
      dataBuffer = pdfSource;
    } else if (typeof pdfSource === 'string') {
      if (!fs.existsSync(pdfSource)) {
        throw new Error(`PDF file not found: ${pdfSource}`);
      }
      dataBuffer = fs.readFileSync(pdfSource);
    } else {
      throw new Error('Invalid PDF source: must be file path or Buffer');
    }
  } catch (error) {
    return { success: false, error: error.message, text: '', numPages: 0 };
  }

  // 1. Try Azure Document Intelligence FIRST
  try {
    const azureResult = await analyzePdfAzure(dataBuffer);
    if (azureResult.success) {
      return {
        success: true,
        text: azureResult.text,
        numPages: azureResult.pages?.length || 1,
        source: 'azure-document-intelligence',
        metadata: {
          tables: azureResult.tables,
          keyValuePairs: azureResult.keyValuePairs
        }
      };
    }
  } catch (azureError) {
    // Just log and continue to fallback
    // console.log('Azure Document Intelligence skipped/failed, falling back to local parser.');
  }

  // 2. Fallback to local PDF Parse
  try {
    const pdf = await loadPdfParse();
    const data = await pdf(dataBuffer);

    return {
      success: true,
      text: data.text,
      numPages: data.numpages,
      info: data.info,
      metadata: data.metadata,
      source: 'local-pdf-parse'
    };
  } catch (error) {
    console.error('PDF parsing error:', error.message);
    return {
      success: false,
      error: error.message,
      text: '',
      numPages: 0
    };
  }
}

/**
 * Extract RFP summary from PDF text using pattern matching
 * This is a fallback when AI parsing is not available
 * @param {string} text - Raw text from PDF
 * @returns {Object} Extracted RFP summary
 */
export function extractRFPSummary(text) {
  const summary = {
    rfp_id: null,
    buyer_name: null,
    project_name: null,
    due_date: null,
    estimated_value: null,
    location: null,
    scope: [],
    technical_specs: {},
    tests_required: [],
    submission: {
      mode: null,
      email_to: null,
      email_subject_template: null,
      postal_address: null,
      portal_url: null,
      meeting_email: null,
      form_annexure: null,
      additional_notes: null
    },
    raw_text: text
  };

  const textLower = text.toLowerCase();

  // Extract RFP/Tender ID
  const idPatterns = [
    /(?:tender|rfp|nit|enquiry)[\s\-_]*(?:no|number|id|ref)[.:\s]*([A-Z0-9\-\/]+)/i,
    /(?:reference|ref)[\s\-_]*(?:no|number)?[.:\s]*([A-Z0-9\-\/]+)/i,
    /([A-Z]{2,4}[\-\/][0-9]{4}[\-\/][A-Z0-9\-]+)/i
  ];
  for (const pattern of idPatterns) {
    const match = text.match(pattern);
    if (match) {
      summary.rfp_id = match[1].trim();
      break;
    }
  }

  // Extract organization/buyer name
  const orgPatterns = [
    /(?:issued by|buyer|organization|company|authority)[:\s]+([A-Za-z\s&.,()]+?)(?:\n|$)/i,
    /^([A-Z][A-Za-z\s&.,()]+(?:Limited|Ltd|Corporation|Corp|Inc|Pvt|Private|Government|Board|Authority))/m
  ];
  for (const pattern of orgPatterns) {
    const match = text.match(pattern);
    if (match) {
      summary.buyer_name = match[1].trim().substring(0, 100);
      break;
    }
  }

  // Extract due date
  const datePatterns = [
    /(?:due|deadline|submission|last)[:\s]*(?:date)?[:\s]*(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})/i,
    /(?:on or before|by|before)[:\s]*(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})/i,
    /(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})[,\s]+(?:\d{1,2}:\d{2})?[,\s]*(?:hrs|hours|pm|am)/i
  ];
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      summary.due_date = match[1].trim();
      break;
    }
  }

  // Extract estimated value
  const valuePatterns = [
    /(?:estimated|approx|approximate|tender)?[\s]*(?:value|cost|amount)[:\s]*(?:rs\.?|inr|₹)?[\s]*([0-9,]+(?:\.[0-9]+)?)\s*(?:lakhs?|lacs?|crores?|cr)?/i,
    /(?:rs\.?|inr|₹)[\s]*([0-9,]+(?:\.[0-9]+)?)\s*(?:lakhs?|lacs?|crores?|cr)?/i
  ];
  for (const pattern of valuePatterns) {
    const match = text.match(pattern);
    if (match) {
      let value = parseFloat(match[1].replace(/,/g, ''));
      const textAfter = text.substring(match.index, match.index + 50).toLowerCase();
      if (textAfter.includes('crore') || textAfter.includes('cr')) {
        value *= 10000000;
      } else if (textAfter.includes('lakh') || textAfter.includes('lac')) {
        value *= 100000;
      }
      summary.estimated_value = value;
      break;
    }
  }

  // Extract location/city
  const locationPatterns = [
    /(?:delivery|location|site|place)[:\s]+([A-Za-z\s,]+?)(?:\n|$)/i,
    /(?:at|in)\s+([A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+)*)/
  ];
  const indianCities = ['mumbai', 'delhi', 'bangalore', 'chennai', 'hyderabad', 'kolkata', 'pune', 'ahmedabad', 'jaipur', 'lucknow', 'nagpur', 'indore', 'coimbatore'];
  for (const city of indianCities) {
    if (textLower.includes(city)) {
      summary.location = city.charAt(0).toUpperCase() + city.slice(1);
      break;
    }
  }

  // Detect submission mode
  summary.submission = detectSubmissionMode(text);

  // Extract cable/wire specifications
  summary.technical_specs = extractTechnicalSpecs(text);

  // Extract required tests
  summary.tests_required = extractRequiredTests(text);

  // Extract scope items
  summary.scope = extractScopeItems(text);

  return summary;
}

/**
 * Detect submission mode from PDF text
 * @param {string} text - Raw text from PDF
 * @returns {Object} Submission instructions
 */
export function detectSubmissionMode(text) {
  const textLower = text.toLowerCase();
  const submission = {
    mode: null,
    email_to: null,
    email_subject_template: null,
    postal_address: null,
    portal_url: null,
    meeting_email: null,
    form_annexure: null,
    additional_notes: null
  };

  // Check for EMAIL_FORM mode (fill form and email)
  if (
    (textLower.includes('annexure') || textLower.includes('form')) &&
    (textLower.includes('email') || textLower.includes('e-mail')) &&
    (textLower.includes('fill') || textLower.includes('complete'))
  ) {
    submission.mode = SUBMISSION_MODES.EMAIL_FORM;

    // Extract email address
    const emailMatch = text.match(/(?:email|e-mail|send)\s*(?:to|at)?[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (emailMatch) {
      submission.email_to = emailMatch[1].toLowerCase();
    }

    // Extract subject template
    const subjectMatch = text.match(/(?:subject|sub)[:\s]*["']?([^"'\n]+?)["']?\s*(?:before|by|$)/i);
    if (subjectMatch) {
      submission.email_subject_template = subjectMatch[1].trim();
    }

    // Extract annexure reference
    const annexureMatch = text.match(/(?:annexure|form)[\s\-]*([A-Z0-9]+)/i);
    if (annexureMatch) {
      submission.form_annexure = `Annexure-${annexureMatch[1]}`;
    }

    return submission;
  }

  // Check for LETTER_COURIER mode (physical submission)
  if (
    (textLower.includes('physical') || textLower.includes('courier') || textLower.includes('post')) &&
    (textLower.includes('address') || textLower.includes('submit'))
  ) {
    submission.mode = SUBMISSION_MODES.LETTER_COURIER;

    // Extract postal address
    const addressPatterns = [
      /(?:address|submit\s+(?:to|at)|courier\s+to)[:\s]*\n?([\s\S]{20,200}?)(?:\n\n|before|by|\d{1,2}[\-\/])/i,
      /(?:chief|general|procurement|tender)\s+(?:manager|officer|section)[\s\S]{0,50}?([\s\S]{20,150}?\d{6})/i
    ];
    for (const pattern of addressPatterns) {
      const match = text.match(pattern);
      if (match) {
        submission.postal_address = match[1].trim().replace(/\n+/g, ', ');
        break;
      }
    }

    submission.additional_notes = 'Document must be printed and couriered physically';
    return submission;
  }

  // Check for EXTERNAL_PORTAL mode (register on portal)
  if (
    (textLower.includes('portal') || textLower.includes('register') || textLower.includes('website')) &&
    (textLower.includes('vendor') || textLower.includes('bidder') || textLower.includes('online'))
  ) {
    submission.mode = SUBMISSION_MODES.EXTERNAL_PORTAL;

    // Extract portal URL
    const urlMatch = text.match(/(?:portal|register|website|url)[:\s]*(https?:\/\/[^\s]+)/i);
    if (urlMatch) {
      submission.portal_url = urlMatch[1];
    } else {
      // Try to find any URL
      const anyUrlMatch = text.match(/(https?:\/\/[^\s]+)/i);
      if (anyUrlMatch) {
        submission.portal_url = anyUrlMatch[1];
      }
    }

    submission.additional_notes = 'Register on vendor portal and submit bid online';
    return submission;
  }

  // Check for MEETING_EMAIL mode (schedule meeting)
  if (
    (textLower.includes('meeting') || textLower.includes('pre-bid') || textLower.includes('prebid')) &&
    (textLower.includes('email') || textLower.includes('request') || textLower.includes('slot'))
  ) {
    submission.mode = SUBMISSION_MODES.MEETING_EMAIL;

    // Extract meeting email
    const emailMatch = text.match(/(?:email|e-mail|contact)[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (emailMatch) {
      submission.meeting_email = emailMatch[1].toLowerCase();
    }

    submission.additional_notes = 'Request pre-bid meeting slot before formal submission';
    return submission;
  }

  // Default: Try to detect any email for generic submission
  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) {
    submission.mode = SUBMISSION_MODES.EMAIL_FORM;
    submission.email_to = emailMatch[1].toLowerCase();
    submission.additional_notes = 'Submit bid via email';
  }

  return submission;
}

/**
 * Extract technical specifications from PDF text
 * @param {string} text - Raw text from PDF
 * @returns {Object} Technical specifications
 */
export function extractTechnicalSpecs(text) {
  const specs = {
    cable_type: null,
    voltage_kv: null,
    conductor_material: null,
    cross_section_sqmm: null,
    cores: null,
    insulation: null,
    armoured: null,
    standard: null,
    quantity_km: null
  };

  const textLower = text.toLowerCase();

  // Cable type
  if (textLower.includes('ehv') || textLower.includes('extra high voltage') || textLower.includes('66kv') || textLower.includes('110kv')) {
    specs.cable_type = 'EHV Cable';
  } else if (textLower.includes('ht cable') || textLower.includes('high tension') || textLower.includes('11kv') || textLower.includes('22kv') || textLower.includes('33kv')) {
    specs.cable_type = 'HT Cable';
  } else if (textLower.includes('lt cable') || textLower.includes('low tension') || textLower.includes('1.1kv')) {
    specs.cable_type = 'LT Cable';
  } else if (textLower.includes('control cable')) {
    specs.cable_type = 'Control Cable';
  } else if (textLower.includes('instrumentation')) {
    specs.cable_type = 'Instrumentation Cable';
  }

  // Voltage
  const voltageMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:kv|kilo\s*volt)/i);
  if (voltageMatch) {
    specs.voltage_kv = parseFloat(voltageMatch[1]);
  }

  // Conductor material
  if (textLower.includes('copper') || textLower.includes(' cu ')) {
    specs.conductor_material = 'Copper';
  } else if (textLower.includes('aluminium') || textLower.includes('aluminum') || textLower.includes(' al ')) {
    specs.conductor_material = 'Aluminium';
  }

  // Cross section
  const areaMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*mm|sqmm|mm²|mm2)/i);
  if (areaMatch) {
    specs.cross_section_sqmm = parseFloat(areaMatch[1]);
  }

  // Cores
  const coresMatch = text.match(/(\d+)\s*(?:core|c\s*x)/i);
  if (coresMatch) {
    specs.cores = parseInt(coresMatch[1]);
  }

  // Insulation
  if (textLower.includes('xlpe') || textLower.includes('cross.?linked')) {
    specs.insulation = 'XLPE';
  } else if (textLower.includes('pvc')) {
    specs.insulation = 'PVC';
  } else if (textLower.includes('rubber') || textLower.includes('epr')) {
    specs.insulation = 'EPR';
  }

  // Armoured
  specs.armoured = textLower.includes('armoured') || textLower.includes('armored');

  // Standard
  const standardMatch = text.match(/(IS\s*\d+|IEC\s*\d+|BIS\s*\d+)/i);
  if (standardMatch) {
    specs.standard = standardMatch[1].toUpperCase();
  }

  // Quantity
  const qtyMatch = text.match(/(?:quantity|qty)[:\s]*(\d+(?:\.\d+)?)\s*(?:km|kilometer|metre|meter|m\b)/i);
  if (qtyMatch) {
    let qty = parseFloat(qtyMatch[1]);
    const textAfter = text.substring(qtyMatch.index, qtyMatch.index + 20).toLowerCase();
    if (!textAfter.includes('km') && textAfter.includes('m')) {
      qty /= 1000; // Convert meters to km
    }
    specs.quantity_km = qty;
  }

  return specs;
}

/**
 * Extract required tests from PDF text
 * @param {string} text - Raw text from PDF
 * @returns {Array} List of required tests
 */
export function extractRequiredTests(text) {
  const tests = [];
  const textLower = text.toLowerCase();

  const testPatterns = [
    { pattern: /high\s*voltage\s*test/i, name: 'High Voltage Test', type: 'ROUTINE' },
    { pattern: /insulation\s*resistance/i, name: 'Insulation Resistance Test', type: 'ROUTINE' },
    { pattern: /conductor\s*resistance/i, name: 'Conductor Resistance Test', type: 'ROUTINE' },
    { pattern: /partial\s*discharge/i, name: 'Partial Discharge Test', type: 'TYPE' },
    { pattern: /impulse\s*(?:voltage)?/i, name: 'Impulse Voltage Test', type: 'TYPE' },
    { pattern: /bending\s*test/i, name: 'Bending Test', type: 'TYPE' },
    { pattern: /hot\s*set/i, name: 'Hot Set Test', type: 'TYPE' },
    { pattern: /tan\s*delta/i, name: 'Tan Delta Test', type: 'TYPE' },
    { pattern: /water\s*(?:immersion|absorption)/i, name: 'Water Immersion Test', type: 'ACCEPTANCE' },
    { pattern: /flame\s*(?:retardant|resistance)/i, name: 'Flame Retardant Test', type: 'TYPE' },
    { pattern: /smoke\s*density/i, name: 'Smoke Density Test', type: 'TYPE' },
    { pattern: /thermal\s*(?:stability|aging)/i, name: 'Thermal Stability Test', type: 'TYPE' },
    { pattern: /type\s*test/i, name: 'Type Test (Complete)', type: 'TYPE' },
    { pattern: /routine\s*test/i, name: 'Routine Test Package', type: 'ROUTINE' },
    { pattern: /acceptance\s*test/i, name: 'Acceptance Test', type: 'ACCEPTANCE' },
    { pattern: /site\s*test/i, name: 'Site Test', type: 'SITE' }
  ];

  for (const { pattern, name, type } of testPatterns) {
    if (pattern.test(text)) {
      tests.push({ name, type });
    }
  }

  // If IS/IEC standard mentioned, add standard compliance
  const standardMatch = text.match(/(IS\s*7098|IS\s*8130|IEC\s*60502|IEC\s*60840)/gi);
  if (standardMatch) {
    const uniqueStandards = [...new Set(standardMatch.map(s => s.toUpperCase()))];
    for (const std of uniqueStandards) {
      tests.push({ name: `Compliance to ${std}`, type: 'COMPLIANCE' });
    }
  }

  return tests;
}

/**
 * Extract scope items from PDF text
 * @param {string} text - Raw text from PDF
 * @returns {Array} List of scope items
 */
export function extractScopeItems(text) {
  const items = [];

  // Look for line items in tables or lists
  const lineItemPattern = /(?:item|s\.?\s*no|sr\.?\s*no)[.\s:]*(\d+)[.\s:]*([^\n]+)/gi;
  let match;
  let itemId = 1;

  while ((match = lineItemPattern.exec(text)) !== null) {
    const description = match[2].trim();
    if (description.length > 10 && description.length < 200) {
      items.push({
        item_id: `ITEM-${itemId++}`,
        description: description,
        extracted_specs: extractTechnicalSpecs(description)
      });
    }
  }

  // If no line items found, create one from general specs
  if (items.length === 0) {
    const specs = extractTechnicalSpecs(text);
    if (specs.cable_type || specs.voltage_kv) {
      items.push({
        item_id: 'ITEM-1',
        description: `${specs.cable_type || 'Cable'} ${specs.cores ? specs.cores + 'C' : ''} ${specs.cross_section_sqmm ? specs.cross_section_sqmm + 'sqmm' : ''} ${specs.conductor_material || ''} ${specs.insulation || ''}`.trim(),
        extracted_specs: specs
      });
    }
  }

  return items;
}

/**
 * Parse PDF and extract RFP summary using AI (Gemini)
 * @param {string|Buffer} pdfSource - File path or Buffer
 * @param {Function} aiParser - Optional AI parsing function
 * @returns {Promise<Object>} Complete RFP summary
 */
export async function parseRFPDocument(pdfSource, aiParser = null) {
  // First, extract raw text
  const pdfResult = await parsePDF(pdfSource);

  if (!pdfResult.success) {
    return {
      success: false,
      error: pdfResult.error,
      summary: null
    };
  }

  // Extract summary using pattern matching
  const summary = extractRFPSummary(pdfResult.text);

  // If AI parser is provided, enhance the extraction
  if (aiParser && typeof aiParser === 'function') {
    try {
      const aiEnhanced = await aiParser(pdfResult.text, summary);
      if (aiEnhanced) {
        // Merge AI results with pattern-matched results
        return {
          success: true,
          summary: { ...summary, ...aiEnhanced },
          raw_text: pdfResult.text,
          num_pages: pdfResult.numPages,
          extraction_method: 'AI_ENHANCED'
        };
      }
    } catch (error) {
      console.error('AI parsing failed, using pattern matching:', error.message);
    }
  }

  return {
    success: true,
    summary,
    raw_text: pdfResult.text,
    num_pages: pdfResult.numPages,
    extraction_method: 'PATTERN_MATCHING'
  };
}

/**
 * Generate AI prompt for RFP extraction
 * This prompt is designed for BUYER-CENTRIC RFPs where:
 * - The BUYER (PSU/Govt/Industry) is requesting cables
 * - The VENDOR (OEM like us) will respond with their products
 * 
 * @param {string} pdfText - Raw text from PDF
 * @returns {string} Prompt for AI
 */
export function generateExtractionPrompt(pdfText) {
  return `You are an expert at reading tender/RFP documents for electrical cables and wires.

CONTEXT: This is a BUYER'S RFP document. The BUYER (usually a PSU, Government body, or Industry) 
is publishing requirements for cables they NEED TO PURCHASE. We are an OEM vendor who wants to 
analyze this RFP and submit our bid.

Extract the BUYER'S REQUIREMENTS from this PDF text.

Return a JSON object with these fields:
{
  "rfp_id": "string - tender/RFP reference number",
  "buyer_name": "string - organization issuing the tender (the BUYER who needs cables)",
  "buyer_type": "string - Government/PSU, Industrial, or Utility",
  "project_name": "string - project title or description",
  "due_date": "string - submission deadline (DD/MM/YYYY format)",
  "estimated_budget": "number - buyer's estimated budget in INR",
  "delivery_location": "string - where cables need to be delivered",
  "delivery_timeline_days": "number - expected delivery within X days",
  "buyer_requirements": [
    {
      "item_no": "string - line item number",
      "cable_type": "string - HT Cable, LT Cable, EHV Cable, Control Cable, etc.",
      "description": "string - full cable description",
      "voltage_kv": "number - voltage rating in kV",
      "conductor_material": "Copper or Aluminium",
      "cross_section_sqmm": "number - conductor size in sqmm",
      "no_of_cores": "number - number of cores",
      "insulation": "string - XLPE, PVC, etc.",
      "armoured": "boolean - true if armoured required",
      "quantity_km": "number - quantity in kilometers",
      "standard": "string - IS/IEC standard reference"
    }
  ],
  "tests_required": [
    { 
      "name": "string - test name", 
      "type": "ROUTINE|TYPE|ACCEPTANCE|SITE",
      "mandatory": "boolean"
    }
  ],
  "third_party_inspection": {
    "required": "boolean",
    "agency": "string - if specified (CPRI, ERDA, etc.)"
  },
  "payment_terms": "string - payment conditions",
  "warranty_months": "number - required warranty period",
  "submission": {
    "mode": "EMAIL_FORM|LETTER_COURIER|EXTERNAL_PORTAL|MEETING_EMAIL",
    "email_to": "string - email address if applicable",
    "postal_address": "string - address if physical submission",
    "portal_url": "string - URL if portal submission",
    "meeting_email": "string - email for meeting request",
    "form_annexure": "string - form reference like Annexure-B"
  },
  "eligibility_criteria": [
    "string - each eligibility requirement"
  ],
  "documents_required": [
    "string - each document the vendor must submit"
  ]
}

For submission.mode, choose based on:
- EMAIL_FORM: If bidder must fill a form/annexure and email it
- LETTER_COURIER: If bidder must send physical letter/documents by post/courier
- EXTERNAL_PORTAL: If bidder must register/submit on a separate website/portal
- MEETING_EMAIL: If bidder must email to schedule a pre-bid meeting first

PDF TEXT:
${pdfText.substring(0, 10000)}

Return ONLY the JSON object, no other text.`;
}

/**
 * Parse PDF using AI for enhanced extraction (Gemini → OpenAI fallback)
 * @param {string} pdfText - Raw text extracted from PDF
 * @returns {Promise<Object>} AI-extracted RFP summary
 */
export async function parseWithGeminiAI(pdfText) {
  try {
    if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
      console.log('No AI API keys found');
      return null;
    }

    const prompt = generateExtractionPrompt(pdfText);

    // Use multi-provider fallback (Gemini -> OpenAI)
    const responseText = await generateWithFallback(prompt);

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed;
    }

    return null;
  } catch (error) {
    console.error('AI parsing error:', error.message);
    return null;
  }
}

/**
 * Parse PDF using OpenAI GPT for enhanced extraction
 * Used as fallback when Gemini is unavailable
 * @param {string} pdfText - Raw text extracted from PDF
 * @returns {Promise<Object>} AI-extracted RFP summary
 */
export async function parseWithOpenAI(pdfText) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('OpenAI API key not found');
      return null;
    }

    const prompt = generateExtractionPrompt(pdfText);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',  // Cost-effective model for document parsing
      messages: [
        {
          role: 'system',
          content: 'You are an expert at extracting structured information from RFP/tender documents. Always respond with valid JSON only, no explanations.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,  // Low temperature for consistent extraction
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });

    const responseText = response.choices?.[0]?.message?.content || '';

    // Parse JSON response
    try {
      const parsed = JSON.parse(responseText);
      return parsed;
    } catch (parseError) {
      // Try to extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }

    return null;
  } catch (error) {
    console.error('OpenAI parsing error:', error.message);
    return null;
  }
}

/**
 * Parse PDF using best available AI provider
 * Tries providers in order based on configuration and availability
 * @param {string} pdfText - Raw text extracted from PDF
 * @returns {Promise<{result: Object|null, provider: string}>} AI-extracted RFP summary with provider info
 */
export async function parseWithBestAI(pdfText) {
  const providers = [];

  // Determine order based on preference
  if (AI_PROVIDER === 'openai') {
    providers.push({ fn: parseWithOpenAI, name: 'OPENAI_GPT' });
    providers.push({ fn: parseWithGeminiAI, name: 'GEMINI_AI' });
  } else if (AI_PROVIDER === 'gemini') {
    providers.push({ fn: parseWithGeminiAI, name: 'GEMINI_AI' });
    providers.push({ fn: parseWithOpenAI, name: 'OPENAI_GPT' });
  } else {
    // Auto mode: try Gemini first (usually free tier available), then OpenAI
    providers.push({ fn: parseWithGeminiAI, name: 'GEMINI_AI' });
    providers.push({ fn: parseWithOpenAI, name: 'OPENAI_GPT' });
  }

  for (const provider of providers) {
    try {
      console.log(`🤖 Trying PDF parsing with ${provider.name}...`);
      const result = await provider.fn(pdfText);
      if (result && (result.rfp_id || result.buyer_name || result.project_name)) {
        return { result, provider: provider.name };
      }
    } catch (error) {
      console.log(`${provider.name} failed:`, error.message);
    }
  }

  return { result: null, provider: 'NONE' };
}

/**
 * Complete PDF parsing with AI enhancement
 * Tries multiple AI providers (Gemini, OpenAI), falls back to pattern matching
 * @param {string|Buffer} pdfSource - File path or Buffer
 * @returns {Promise<Object>} Complete RFP extraction result
 */
export async function parseRFPWithAI(pdfSource) {
  // First extract raw text
  const pdfResult = await parsePDF(pdfSource);

  if (!pdfResult.success) {
    return {
      success: false,
      error: pdfResult.error,
      summary: null,
      extraction_method: 'FAILED'
    };
  }

  // Try AI parsing first with best available provider
  let summary = null;
  let extractionMethod = 'PATTERN_MATCHING';

  try {
    const { result: aiResult, provider } = await parseWithBestAI(pdfResult.text);
    if (aiResult && (aiResult.rfp_id || aiResult.buyer_name)) {
      summary = aiResult;
      extractionMethod = provider;
      console.log(`✅ PDF parsed using ${provider}`);
    }
  } catch (error) {
    console.log('AI parsing failed, using pattern matching:', error.message);
  }

  // Fallback to pattern matching
  if (!summary) {
    summary = extractRFPSummary(pdfResult.text);
    console.log('📋 PDF parsed using pattern matching');
  }

  // Ensure submission mode is set
  if (!summary.submission || !summary.submission.mode) {
    summary.submission = detectSubmissionMode(pdfResult.text);
  }

  return {
    success: true,
    summary,
    raw_text: pdfResult.text,
    num_pages: pdfResult.numPages,
    extraction_method: extractionMethod
  };
}

/**
 * Verify and enrich buyer company information using OpenCorporates
 * @param {string} companyName - Company name extracted from PDF
 * @returns {Promise<Object>} Verified company information
 */
export async function verifyBuyerCompany(companyName) {
  if (!companyName || !OPENCORPORATES_API_KEY) {
    return {
      verified: false,
      company_name: companyName,
      reason: 'No company name or API key'
    };
  }

  try {
    // Use the existing OpenCorporates service
    const result = await verifyAndEnhanceCompany(companyName);

    if (result && result.verified) {
      return {
        verified: true,
        company_name: result.name || companyName,
        status: result.status,
        jurisdiction: result.jurisdiction,
        incorporation_date: result.incorporationDate,
        company_type: result.companyType,
        registered_address: result.registeredAddress,
        credibility_score: result.raw_score || result.credibilityScore,
        credibility_label: result.credibility_label || result.credibilityLabel,
        opencorporates_url: result.opencorporatesUrl,
        risk_flags: result.risk_flags || []
      };
    }

    // Try direct search if verification failed
    const searchResult = await searchCompany(companyName);
    if (searchResult.success && searchResult.companies?.length > 0) {
      const topMatch = searchResult.companies[0];
      return {
        verified: true,
        company_name: topMatch.name,
        status: topMatch.status,
        jurisdiction: topMatch.jurisdiction,
        incorporation_date: topMatch.incorporationDate,
        company_type: topMatch.companyType,
        registered_address: topMatch.registeredAddress,
        opencorporates_url: topMatch.opencorporatesUrl,
        match_confidence: 'PARTIAL'
      };
    }

    return {
      verified: false,
      company_name: companyName,
      reason: 'Company not found in OpenCorporates'
    };

  } catch (error) {
    console.error('Company verification error:', error.message);
    return {
      verified: false,
      company_name: companyName,
      reason: error.message
    };
  }
}

/**
 * Enhanced RFP parsing with company verification
 * @param {string|Buffer} pdfSource - File path or Buffer
 * @param {boolean} verifyCompany - Whether to verify buyer company via OpenCorporates
 * @returns {Promise<Object>} Complete RFP extraction with company verification
 */
export async function parseRFPComplete(pdfSource, verifyCompany = true) {
  // First do the AI/pattern-based extraction
  const parseResult = await parseRFPWithAI(pdfSource);

  if (!parseResult.success) {
    return parseResult;
  }

  // Optionally verify the buyer company
  if (verifyCompany && parseResult.summary?.buyer_name) {
    const companyVerification = await verifyBuyerCompany(parseResult.summary.buyer_name);
    parseResult.summary.buyer_verification = companyVerification;

    // Update buyer name if we got a verified match
    if (companyVerification.verified && companyVerification.company_name) {
      parseResult.summary.buyer_name_verified = companyVerification.company_name;
    }
  }

  return parseResult;
}

/**
 * Analyze any PDF document (not just RFPs)
 * Generic PDF analysis for the AI bot
 * @param {string|Buffer} pdfSource - File path or Buffer
 * @returns {Promise<Object>} Document analysis
 */
export async function analyzeDocument(pdfSource) {
  const pdfResult = await parsePDF(pdfSource);

  if (!pdfResult.success) {
    return {
      success: false,
      error: pdfResult.error
    };
  }

  const text = pdfResult.text;
  const textLower = text.toLowerCase();

  // Detect document type
  let documentType = 'UNKNOWN';
  if (textLower.includes('tender') || textLower.includes('rfp') || textLower.includes('nit') || textLower.includes('enquiry')) {
    documentType = 'RFP_TENDER';
  } else if (textLower.includes('invoice') || textLower.includes('bill')) {
    documentType = 'INVOICE';
  } else if (textLower.includes('purchase order') || textLower.includes('p.o.')) {
    documentType = 'PURCHASE_ORDER';
  } else if (textLower.includes('specification') || textLower.includes('technical')) {
    documentType = 'TECHNICAL_SPEC';
  } else if (textLower.includes('quotation') || textLower.includes('quote')) {
    documentType = 'QUOTATION';
  } else if (textLower.includes('contract') || textLower.includes('agreement')) {
    documentType = 'CONTRACT';
  }

  // Extract key information based on document type
  let analysis = {
    document_type: documentType,
    num_pages: pdfResult.numPages,
    word_count: text.split(/\s+/).length,
    key_dates: [],
    key_values: [],
    organizations: [],
    emails: [],
    phone_numbers: []
  };

  // Extract dates
  const dateMatches = text.match(/\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4}/g) || [];
  analysis.key_dates = [...new Set(dateMatches)].slice(0, 5);

  // Extract monetary values
  const valueMatches = text.match(/(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?/gi) || [];
  analysis.key_values = [...new Set(valueMatches)].slice(0, 5);

  // Extract emails
  const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  analysis.emails = [...new Set(emailMatches)];

  // Extract phone numbers
  const phoneMatches = text.match(/(?:\+91|0)?[\s\-]?\d{10}/g) || [];
  analysis.phone_numbers = [...new Set(phoneMatches)].slice(0, 3);

  // If it's an RFP, do full extraction
  if (documentType === 'RFP_TENDER') {
    const rfpSummary = extractRFPSummary(text);
    analysis.rfp_summary = rfpSummary;
  }

  return {
    success: true,
    analysis,
    raw_text: text.substring(0, 2000) + (text.length > 2000 ? '...' : '')
  };
}

export default {
  parsePDF,
  parseRFPDocument,
  parseRFPWithAI,
  parseRFPComplete,
  parseWithGeminiAI,
  parseWithOpenAI,
  parseWithBestAI,
  analyzeDocument,
  extractRFPSummary,
  detectSubmissionMode,
  extractTechnicalSpecs,
  extractRequiredTests,
  extractScopeItems,
  verifyBuyerCompany,
  generateExtractionPrompt,
  SUBMISSION_MODES
};

