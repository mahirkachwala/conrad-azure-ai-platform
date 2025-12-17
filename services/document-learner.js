/**
 * Document Structure Learner
 * EY Techathon 6.0 - Adaptive AI System
 * 
 * Learns PDF/document structures dynamically.
 * When new documents are uploaded, it:
 * 1. Extracts text and structure
 * 2. Identifies key sections (BOQ, specifications, terms)
 * 3. Creates document templates for similar docs
 * 4. Enables intelligent extraction from any document format
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embed, embedBatch, cosineSimilarity, findSimilar } from './local-embeddings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Document knowledge base path
const DOC_KB_PATH = path.join(__dirname, '../data/document_knowledge.json');

// Known section patterns (bootstrapped, will learn more)
const SECTION_PATTERNS = {
  boq: {
    keywords: ['bill of quantities', 'boq', 'quantity schedule', 'item list', 'material list', 'schedule of quantities'],
    indicators: ['sl.no', 'item no', 'quantity', 'unit', 'rate', 'amount', 'description']
  },
  specifications: {
    keywords: ['technical specifications', 'specifications', 'technical requirements', 'spec sheet'],
    indicators: ['voltage', 'current', 'rating', 'standard', 'is ', 'iec', 'dimension']
  },
  terms: {
    keywords: ['terms and conditions', 'general conditions', 'special conditions', 'contract terms'],
    indicators: ['clause', 'shall', 'must', 'penalty', 'warranty', 'liability']
  },
  submission: {
    keywords: ['submission', 'bid submission', 'tender submission', 'deadline', 'due date'],
    indicators: ['last date', 'closing date', 'submit', 'online', 'offline', 'portal']
  },
  eligibility: {
    keywords: ['eligibility criteria', 'qualification', 'pre-qualification', 'requirements'],
    indicators: ['minimum', 'experience', 'turnover', 'years', 'certificate']
  },
  pricing: {
    keywords: ['price schedule', 'price bid', 'financial bid', 'commercial bid'],
    indicators: ['total', 'gst', 'tax', 'inclusive', 'exclusive', 'per unit']
  },
  testing: {
    keywords: ['testing', 'test requirements', 'type test', 'routine test', 'acceptance test'],
    indicators: ['test', 'report', 'certificate', 'lab', 'nabl']
  }
};

// Document knowledge storage
let documentKnowledge = {
  version: '1.0',
  templates: {},        // document type -> structure template
  sectionEmbeddings: {}, // section type -> embeddings
  extractionPatterns: {}, // learned extraction patterns
  documentTypes: [],    // learned document types
  lastUpdated: null
};

/**
 * Initialize document learner
 */
export async function initDocumentLearner() {
  try {
    if (fs.existsSync(DOC_KB_PATH)) {
      const data = fs.readFileSync(DOC_KB_PATH, 'utf-8');
      documentKnowledge = JSON.parse(data);
      console.log(`📄 Loaded document knowledge: ${Object.keys(documentKnowledge.templates).length} templates`);
    }
  } catch (error) {
    console.warn('⚠️ Could not load document knowledge, starting fresh');
  }
  
  // Pre-compute section embeddings if not done
  await initSectionEmbeddings();
  
  return documentKnowledge;
}

/**
 * Save document knowledge
 */
function saveDocumentKnowledge() {
  documentKnowledge.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DOC_KB_PATH, JSON.stringify(documentKnowledge, null, 2));
}

/**
 * Initialize section embeddings for classification
 */
async function initSectionEmbeddings() {
  if (Object.keys(documentKnowledge.sectionEmbeddings).length > 0) return;
  
  console.log('🔢 Computing section embeddings...');
  
  for (const [sectionType, patterns] of Object.entries(SECTION_PATTERNS)) {
    const text = [...patterns.keywords, ...patterns.indicators].join(' ');
    try {
      documentKnowledge.sectionEmbeddings[sectionType] = await embed(text);
    } catch (e) {
      console.warn(`Could not embed section: ${sectionType}`);
    }
  }
  
  saveDocumentKnowledge();
  console.log('✅ Section embeddings computed');
}

/**
 * Learn document structure from extracted text
 * @param {string} text - Extracted document text
 * @param {string} fileName - Original file name
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Learned document structure
 */
export async function learnDocumentStructure(text, fileName, metadata = {}) {
  console.log(`📄 Learning document structure: ${fileName}`);
  
  // Split into paragraphs/sections
  const paragraphs = splitIntoParagraphs(text);
  
  // Classify each section
  const sections = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    if (para.text.length < 20) continue;
    
    const classification = await classifySection(para.text);
    sections.push({
      index: i,
      startLine: para.startLine,
      endLine: para.endLine,
      type: classification.type,
      confidence: classification.confidence,
      preview: para.text.substring(0, 200),
      hasTable: detectTable(para.text),
      hasList: detectList(para.text)
    });
  }
  
  // Identify document type
  const docType = identifyDocumentType(sections, text);
  
  // Extract key information based on detected sections
  const extractedInfo = await extractKeyInformation(text, sections);
  
  // Create/update template
  const template = {
    fileName,
    documentType: docType,
    sections: sections.filter(s => s.confidence > 0.5),
    extractedFields: Object.keys(extractedInfo),
    sectionOrder: sections.map(s => s.type).filter(t => t !== 'unknown'),
    learnedAt: new Date().toISOString(),
    metadata
  };
  
  // Store template
  const templateKey = docType || 'generic';
  if (!documentKnowledge.templates[templateKey]) {
    documentKnowledge.templates[templateKey] = [];
  }
  documentKnowledge.templates[templateKey].push(template);
  
  // Learn extraction patterns
  learnExtractionPatterns(text, extractedInfo, docType);
  
  saveDocumentKnowledge();
  
  console.log(`✅ Learned: ${sections.length} sections, type: ${docType}`);
  
  return {
    documentType: docType,
    sections,
    extractedInfo,
    template
  };
}

/**
 * Split text into paragraphs
 */
function splitIntoParagraphs(text) {
  const lines = text.split('\n');
  const paragraphs = [];
  let current = { text: '', startLine: 0, endLine: 0 };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line === '') {
      if (current.text.length > 0) {
        current.endLine = i - 1;
        paragraphs.push({ ...current });
        current = { text: '', startLine: i + 1, endLine: i + 1 };
      }
    } else {
      if (current.text === '') current.startLine = i;
      current.text += (current.text ? ' ' : '') + line;
    }
  }
  
  if (current.text.length > 0) {
    current.endLine = lines.length - 1;
    paragraphs.push(current);
  }
  
  return paragraphs;
}

/**
 * Classify a text section
 */
async function classifySection(text) {
  const textLower = text.toLowerCase();
  
  // First check keyword matches
  for (const [sectionType, patterns] of Object.entries(SECTION_PATTERNS)) {
    const keywordMatch = patterns.keywords.some(kw => textLower.includes(kw));
    const indicatorMatches = patterns.indicators.filter(ind => textLower.includes(ind)).length;
    
    if (keywordMatch || indicatorMatches >= 2) {
      return {
        type: sectionType,
        confidence: keywordMatch ? 0.9 : 0.6 + (indicatorMatches * 0.1),
        method: 'keyword'
      };
    }
  }
  
  // Use embedding similarity for uncertain cases
  try {
    const textEmbedding = await embed(text.substring(0, 500));
    let bestMatch = { type: 'unknown', confidence: 0 };
    
    for (const [sectionType, sectionEmb] of Object.entries(documentKnowledge.sectionEmbeddings)) {
      const similarity = cosineSimilarity(textEmbedding, sectionEmb);
      if (similarity > bestMatch.confidence) {
        bestMatch = { type: sectionType, confidence: similarity, method: 'embedding' };
      }
    }
    
    if (bestMatch.confidence > 0.6) {
      return bestMatch;
    }
  } catch (e) {
    // Fall through to unknown
  }
  
  return { type: 'unknown', confidence: 0, method: 'none' };
}

/**
 * Detect if text contains a table
 */
function detectTable(text) {
  // Check for table indicators
  const tablePatterns = [
    /\|\s*[\w\s]+\s*\|/,  // Pipe-separated
    /\t.*\t.*\t/,         // Tab-separated
    /\d+\.\s+\w+.*\d+/    // Numbered items with quantities
  ];
  
  return tablePatterns.some(p => p.test(text));
}

/**
 * Detect if text contains a list
 */
function detectList(text) {
  const listPatterns = [
    /^\s*[\d]+\.\s/m,     // Numbered list
    /^\s*[•\-\*]\s/m,     // Bullet list
    /^\s*[a-z]\)\s/m      // Letter list
  ];
  
  return listPatterns.some(p => p.test(text));
}

/**
 * Identify document type
 */
function identifyDocumentType(sections, fullText) {
  const textLower = fullText.toLowerCase();
  
  // Check for RFP/tender indicators
  if (textLower.includes('tender') || textLower.includes('rfp') || 
      textLower.includes('request for proposal') || textLower.includes('bid')) {
    
    if (sections.some(s => s.type === 'boq')) return 'rfp_with_boq';
    return 'rfp_generic';
  }
  
  // Check for quotation
  if (textLower.includes('quotation') || textLower.includes('quote') ||
      textLower.includes('price offer')) {
    return 'quotation';
  }
  
  // Check for technical document
  if (sections.filter(s => s.type === 'specifications').length > 2) {
    return 'technical_specification';
  }
  
  // Check for purchase order
  if (textLower.includes('purchase order') || textLower.includes('po number')) {
    return 'purchase_order';
  }
  
  return 'generic_document';
}

/**
 * Extract key information from document
 */
async function extractKeyInformation(text, sections) {
  const extracted = {};
  const textLower = text.toLowerCase();
  
  // Extract dates
  const datePatterns = [
    /(?:due|deadline|last|closing)\s*(?:date)?[\s:]+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/gi,
    /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/g
  ];
  
  for (const pattern of datePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      extracted.dates = matches.slice(0, 5);
      break;
    }
  }
  
  // Extract amounts/values
  const amountPattern = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{2})?)/gi;
  const amounts = [...text.matchAll(amountPattern)].map(m => m[1]);
  if (amounts.length > 0) {
    extracted.amounts = amounts.slice(0, 10);
  }
  
  // Extract tender/RFP ID
  const idPatterns = [
    /(?:tender|rfp|bid|ref|reference)\s*(?:no\.?|number|id)?[\s:]+([A-Z0-9\-\/]+)/gi,
    /([A-Z]{2,}\d{2,}[A-Z0-9\-]*)/g
  ];
  
  for (const pattern of idPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      extracted.reference_ids = matches.slice(0, 3);
      break;
    }
  }
  
  // Extract organization names (capitalized multi-word phrases)
  const orgPattern = /(?:m\/s\.?|messrs\.?|organization|company|buyer|seller)[\s:]+([A-Z][A-Za-z\s&]+(?:Ltd\.?|Limited|Pvt\.?|Private|Corp\.?)?)/g;
  const orgs = [...text.matchAll(orgPattern)].map(m => m[1].trim());
  if (orgs.length > 0) {
    extracted.organizations = [...new Set(orgs)].slice(0, 5);
  }
  
  // Extract quantities from BOQ sections
  const boqSection = sections.find(s => s.type === 'boq');
  if (boqSection) {
    const qtyPattern = /(\d+(?:\.\d+)?)\s*(?:km|m|nos|units|sets|pcs|meters|kilomet)/gi;
    const quantities = [...text.matchAll(qtyPattern)].map(m => ({
      value: parseFloat(m[1]),
      unit: m[0].replace(m[1], '').trim()
    }));
    if (quantities.length > 0) {
      extracted.quantities = quantities.slice(0, 20);
    }
  }
  
  // Extract technical specs
  const specSection = sections.find(s => s.type === 'specifications');
  if (specSection) {
    extracted.specifications = {
      voltage: text.match(/(\d+(?:\.\d+)?)\s*kv/gi)?.slice(0, 5),
      current: text.match(/(\d+(?:\.\d+)?)\s*(?:amp|a\b)/gi)?.slice(0, 5),
      size: text.match(/(\d+(?:\.\d+)?)\s*(?:sqmm|mm2|sq\.?\s*mm)/gi)?.slice(0, 5)
    };
  }
  
  return extracted;
}

/**
 * Learn extraction patterns from successful extractions
 */
function learnExtractionPatterns(text, extractedInfo, docType) {
  if (!documentKnowledge.extractionPatterns[docType]) {
    documentKnowledge.extractionPatterns[docType] = {
      fieldContexts: {},
      successfulPatterns: []
    };
  }
  
  const patterns = documentKnowledge.extractionPatterns[docType];
  
  // Learn context around extracted values
  for (const [field, values] of Object.entries(extractedInfo)) {
    if (!patterns.fieldContexts[field]) {
      patterns.fieldContexts[field] = [];
    }
    
    if (Array.isArray(values) && values.length > 0) {
      // Find context around first value
      const firstValue = String(values[0]);
      const idx = text.indexOf(firstValue);
      if (idx > 0) {
        const context = text.substring(Math.max(0, idx - 50), idx + firstValue.length + 50);
        patterns.fieldContexts[field].push(context);
        
        // Keep only last 10 contexts
        if (patterns.fieldContexts[field].length > 10) {
          patterns.fieldContexts[field] = patterns.fieldContexts[field].slice(-10);
        }
      }
    }
  }
}

/**
 * Extract information from new document using learned patterns
 * @param {string} text - Document text
 * @param {string} documentType - Optional document type hint
 */
export async function extractFromDocument(text, documentType = null) {
  // First, learn the structure
  const structure = await learnDocumentStructure(text, 'uploaded_document');
  
  const docType = documentType || structure.documentType;
  
  // Get learned patterns for this type
  const patterns = documentKnowledge.extractionPatterns[docType] || {};
  
  // Enhanced extraction using learned contexts
  const extracted = { ...structure.extractedInfo };
  
  // Use field contexts to find additional values
  for (const [field, contexts] of Object.entries(patterns.fieldContexts || {})) {
    if (!extracted[field] && contexts.length > 0) {
      // Try to find similar contexts in new document
      for (const ctx of contexts) {
        // Simple pattern matching based on learned context
        const words = ctx.split(/\s+/).filter(w => w.length > 3);
        const pattern = new RegExp(words.slice(0, 3).join('.*?'), 'i');
        
        if (pattern.test(text)) {
          // Found similar context, extract value
          extracted[`${field}_potential`] = 'Found similar pattern';
        }
      }
    }
  }
  
  return {
    documentType: docType,
    sections: structure.sections,
    extracted,
    confidence: structure.sections.filter(s => s.confidence > 0.7).length / Math.max(1, structure.sections.length)
  };
}

/**
 * Get similar documents from knowledge base
 */
export async function findSimilarDocuments(text, topK = 5) {
  const textEmbedding = await embed(text.substring(0, 1000));
  
  const results = [];
  
  for (const [docType, templates] of Object.entries(documentKnowledge.templates)) {
    for (const template of templates) {
      // Compare against template preview/structure
      results.push({
        documentType: docType,
        fileName: template.fileName,
        sections: template.sectionOrder,
        learnedAt: template.learnedAt
      });
    }
  }
  
  return results.slice(0, topK);
}

/**
 * Export document knowledge for training
 */
export function exportForTraining() {
  const trainingData = [];
  
  for (const [docType, templates] of Object.entries(documentKnowledge.templates)) {
    for (const template of templates) {
      trainingData.push({
        input: template.sectionOrder.join(' -> '),
        output: docType,
        fields: template.extractedFields
      });
    }
  }
  
  return trainingData;
}

/**
 * Get extraction statistics
 */
export function getStats() {
  return {
    templateCount: Object.values(documentKnowledge.templates).flat().length,
    documentTypes: Object.keys(documentKnowledge.templates),
    sectionTypes: Object.keys(documentKnowledge.sectionEmbeddings),
    patternCount: Object.values(documentKnowledge.extractionPatterns)
      .reduce((sum, p) => sum + Object.keys(p.fieldContexts || {}).length, 0),
    lastUpdated: documentKnowledge.lastUpdated
  };
}

export default {
  initDocumentLearner,
  learnDocumentStructure,
  extractFromDocument,
  findSimilarDocuments,
  exportForTraining,
  getStats
};



