/**
 * Adaptive CSV Manager with HuggingFace Integration
 * Handles session-based CSV uploads and intelligent adaptation
 * 
 * Features:
 * - Session-based storage (auto-deletes on server restart)
 * - HuggingFace embeddings for semantic CSV type detection
 * - Intelligent column mapping using semantic similarity
 * - Natural language quotation modification
 * - Learns different CSV structures automatically
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { embed, cosineSimilarity, initEmbeddings } from './local-embeddings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Session storage - cleared on server restart
const sessionStore = {
  // CSV overrides by type
  csvOverrides: {
    testing: null,
    pricing_rules: null,
    ht_cables: null,
    lt_cables: null,
    control_cables: null,
    ehv_cables: null,
    instrumentation_cables: null
  },
  
  // Learned structures with embeddings
  learnedStructures: {},
  
  // Header embeddings cache (for faster matching)
  headerEmbeddings: {},
  
  // Modification history
  modifications: [],
  
  // Quotation adjustments (user modifications)
  quotationAdjustments: {},
  
  // Session start time
  sessionStarted: new Date().toISOString()
};

// Default CSV paths
const DEFAULT_PATHS = {
  testing: path.join(__dirname, '../data/testing.csv'),
  pricing_rules: path.join(__dirname, '../data/pricing_rules.csv'),
  ht_cables: path.join(__dirname, '../data/products/ht_cables.csv'),
  lt_cables: path.join(__dirname, '../data/products/lt_cables.csv'),
  control_cables: path.join(__dirname, '../data/products/control_cables.csv'),
  ehv_cables: path.join(__dirname, '../data/products/ehv_cables.csv'),
  instrumentation_cables: path.join(__dirname, '../data/products/instrumentation_cables.csv')
};

// Expected column schemas with semantic descriptions
const COLUMN_SCHEMAS = {
  testing: {
    'Test_ID': 'unique identifier code for the test',
    'Test_Name': 'name or title of the testing procedure',
    'Description': 'detailed description of what the test does',
    'Standard': 'IS IEC standard code the test follows',
    'Price_INR': 'cost price amount in Indian rupees',
    'Duration_Days': 'number of days the test takes',
    'Applicable_Types': 'cable types this test applies to'
  },
  pricing_rules: {
    'Rule_ID': 'unique identifier for pricing rule',
    'Parameter': 'name of the pricing parameter',
    'Value': 'numeric value of the parameter',
    'Type': 'type of value percentage or fixed',
    'Description': 'description of what the rule does'
  },
  cables: {
    'SKU_ID': 'stock keeping unit product code',
    'Product_Name': 'full name of the cable product',
    'Type': 'category type of cable HT LT Control',
    'Conductor_Material': 'copper or aluminium conductor',
    'Conductor_Area_mm2': 'cross sectional area in square mm',
    'Voltage_Rating_kV': 'rated voltage in kilovolts',
    'Insulation': 'insulation type XLPE PVC',
    'Armoured': 'whether cable has armour protection',
    'No_of_Cores': 'number of cores in cable',
    'Unit_Price_per_km': 'price per kilometer in rupees'
  }
};

// Pre-computed schema embeddings
let schemaEmbeddings = null;

/**
 * Initialize schema embeddings for semantic matching
 */
async function initSchemaEmbeddings() {
  if (schemaEmbeddings) return schemaEmbeddings;
  
  console.log('[Adaptive CSV] Initializing schema embeddings...');
  
  try {
    await initEmbeddings();
    
    schemaEmbeddings = {};
    
    for (const [schemaType, columns] of Object.entries(COLUMN_SCHEMAS)) {
      schemaEmbeddings[schemaType] = {};
      
      for (const [colName, description] of Object.entries(columns)) {
        // Create rich text for embedding
        const embeddingText = `${colName.replace(/_/g, ' ')} ${description}`;
        schemaEmbeddings[schemaType][colName] = await embed(embeddingText);
      }
    }
    
    console.log('[Adaptive CSV] Schema embeddings ready');
    return schemaEmbeddings;
  } catch (error) {
    console.warn('[Adaptive CSV] Could not init schema embeddings:', error.message);
    return null;
  }
}

/**
 * Detect CSV type using semantic embeddings
 * @param {string} csvContent - CSV file content
 * @param {string} fileName - Original filename
 * @returns {object} - Type detection result with confidence
 */
export async function detectCSVType(csvContent, fileName = '') {
  try {
    const parsed = parse(csvContent, { columns: true, skip_empty_lines: true });
    const headers = Object.keys(parsed[0] || {});
    
    // Quick check by filename first
    const fileNameLower = fileName.toLowerCase();
    if (fileNameLower.includes('testing') || fileNameLower.includes('test_price')) {
      return { type: 'testing', confidence: 0.95, headers, method: 'filename' };
    }
    if (fileNameLower.includes('pricing') || fileNameLower.includes('rule')) {
      return { type: 'pricing_rules', confidence: 0.95, headers, method: 'filename' };
    }
    
    // Cable type detection from filename
    const cableTypes = ['ht', 'lt', 'control', 'ehv', 'instrumentation'];
    for (const ct of cableTypes) {
      if (fileNameLower.includes(ct)) {
        return { type: `${ct}_cables`, confidence: 0.9, headers, method: 'filename' };
      }
    }
    
    // Use semantic matching for better detection
    await initSchemaEmbeddings();
    
    if (schemaEmbeddings) {
      const typeScores = {};
      
      // Embed the headers
      for (const header of headers) {
        const headerEmbedding = await embed(header.replace(/_/g, ' '));
        sessionStore.headerEmbeddings[header] = headerEmbedding;
        
        // Compare with each schema type
        for (const [schemaType, schemaColumns] of Object.entries(schemaEmbeddings)) {
          if (!typeScores[schemaType]) typeScores[schemaType] = 0;
          
          // Find best matching column in schema
          let bestMatch = 0;
          for (const [colName, colEmbedding] of Object.entries(schemaColumns)) {
            const similarity = cosineSimilarity(headerEmbedding, colEmbedding);
            bestMatch = Math.max(bestMatch, similarity);
          }
          
          typeScores[schemaType] += bestMatch;
        }
      }
      
      // Normalize scores
      for (const type of Object.keys(typeScores)) {
        typeScores[type] /= headers.length;
      }
      
      // Find best matching type
      let bestType = 'unknown';
      let bestScore = 0;
      
      for (const [type, score] of Object.entries(typeScores)) {
        if (score > bestScore) {
          bestScore = score;
          bestType = type;
        }
      }
      
      // Map schema types to CSV types
      if (bestType === 'cables') {
        // Determine specific cable type from content
        const firstRow = parsed[0];
        const contentStr = JSON.stringify(firstRow).toLowerCase();
        
        if (contentStr.includes('ehv') || (firstRow.Voltage_Rating_kV && parseInt(firstRow.Voltage_Rating_kV) >= 66)) {
          bestType = 'ehv_cables';
        } else if (contentStr.includes('ht') || contentStr.includes('high tension')) {
          bestType = 'ht_cables';
        } else if (contentStr.includes('lt') || contentStr.includes('low tension')) {
          bestType = 'lt_cables';
        } else if (contentStr.includes('control')) {
          bestType = 'control_cables';
        } else if (contentStr.includes('instrument')) {
          bestType = 'instrumentation_cables';
        } else {
          bestType = 'ht_cables'; // Default to HT
        }
      }
      
      return {
        type: bestType,
        confidence: bestScore,
        headers,
        method: 'semantic',
        allScores: typeScores
      };
    }
    
    // Fallback to keyword matching
    const headerStr = headers.join(',').toLowerCase();
    
    if (headerStr.includes('test_id') || headerStr.includes('test_name') || 
        (headerStr.includes('price') && headerStr.includes('duration'))) {
      return { type: 'testing', confidence: 0.8, headers, method: 'keyword' };
    }
    
    if (headerStr.includes('rule_id') || (headerStr.includes('parameter') && headerStr.includes('value'))) {
      return { type: 'pricing_rules', confidence: 0.8, headers, method: 'keyword' };
    }
    
    if (headerStr.includes('sku') || headerStr.includes('product') || headerStr.includes('cable')) {
      return { type: 'ht_cables', confidence: 0.6, headers, method: 'keyword' };
    }
    
    return { type: 'unknown', confidence: 0, headers, method: 'none' };
  } catch (error) {
    console.error('[CSV Detection] Error:', error.message);
    return { type: 'error', confidence: 0, error: error.message };
  }
}

/**
 * Learn and map CSV structure using semantic similarity
 * @param {string} csvContent - CSV file content
 * @param {string} csvType - Detected or specified type
 * @returns {object} - Structure mapping with confidence scores
 */
export async function learnCSVStructure(csvContent, csvType) {
  try {
    const parsed = parse(csvContent, { columns: true, skip_empty_lines: true });
    const newHeaders = Object.keys(parsed[0] || {});
    
    // Get expected schema
    const schemaType = csvType.includes('cable') ? 'cables' : csvType;
    const expectedColumns = COLUMN_SCHEMAS[schemaType];
    
    if (!expectedColumns) {
      return { success: false, error: `Unknown schema type: ${schemaType}` };
    }
    
    await initSchemaEmbeddings();
    
    const mapping = {};
    const mappingConfidence = {};
    
    // Embed new headers if not cached
    for (const header of newHeaders) {
      if (!sessionStore.headerEmbeddings[header]) {
        sessionStore.headerEmbeddings[header] = await embed(header.replace(/_/g, ' '));
      }
    }
    
    // Find best mapping for each expected column
    for (const [expectedCol, description] of Object.entries(expectedColumns)) {
      let bestMatch = null;
      let bestScore = 0;
      
      const expectedEmbedding = schemaEmbeddings?.[schemaType]?.[expectedCol] || 
                                await embed(`${expectedCol.replace(/_/g, ' ')} ${description}`);
      
      for (const newHeader of newHeaders) {
        const newEmbedding = sessionStore.headerEmbeddings[newHeader];
        const similarity = cosineSimilarity(newEmbedding, expectedEmbedding);
        
        // Also check exact/partial string match for bonus
        const headerLower = newHeader.toLowerCase().replace(/[_\s]/g, '');
        const expectedLower = expectedCol.toLowerCase().replace(/[_\s]/g, '');
        
        let adjustedScore = similarity;
        if (headerLower === expectedLower) {
          adjustedScore = 1.0; // Exact match
        } else if (headerLower.includes(expectedLower) || expectedLower.includes(headerLower)) {
          adjustedScore = Math.max(similarity, 0.85); // Partial match bonus
        }
        
        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestMatch = newHeader;
        }
      }
      
      if (bestMatch && bestScore > 0.5) {
        mapping[expectedCol] = bestMatch;
        mappingConfidence[expectedCol] = bestScore;
      }
    }
    
    // Store learned structure
    sessionStore.learnedStructures[csvType] = {
      originalHeaders: newHeaders,
      mapping,
      mappingConfidence,
      learnedAt: new Date().toISOString()
    };
    
    console.log(`[Adaptive CSV] Learned structure for ${csvType}:`, mapping);
    
    return {
      success: true,
      mapping,
      confidence: mappingConfidence,
      avgConfidence: Object.values(mappingConfidence).reduce((a, b) => a + b, 0) / 
                     Object.values(mappingConfidence).length || 0,
      unmappedExpected: Object.keys(expectedColumns).filter(h => !mapping[h]),
      unmappedNew: newHeaders.filter(h => !Object.values(mapping).includes(h))
    };
  } catch (error) {
    console.error('[Structure Learning] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Upload and store CSV for session
 * @param {string} csvContent - CSV file content
 * @param {string} fileName - Original filename
 * @param {string} userIntent - User's description of what this CSV is
 * @returns {object} - Upload result
 */
export async function uploadSessionCSV(csvContent, fileName = '', userIntent = '') {
  try {
    // Parse CSV to validate
    const parsed = parse(csvContent, { columns: true, skip_empty_lines: true });
    
    if (!parsed.length) {
      return { success: false, error: 'CSV is empty or invalid' };
    }
    
    // Detect type
    let detection = await detectCSVType(csvContent, fileName);
    
    // If user specified intent, try to match
    if (userIntent) {
      const intentLower = userIntent.toLowerCase();
      if (intentLower.includes('test') && (intentLower.includes('price') || intentLower.includes('cost'))) {
        detection.type = 'testing';
        detection.confidence = 0.98;
        detection.method = 'user_intent';
      } else if (intentLower.includes('pricing') || intentLower.includes('rule')) {
        detection.type = 'pricing_rules';
        detection.confidence = 0.98;
        detection.method = 'user_intent';
      } else if (intentLower.includes('cable')) {
        // Try to determine cable type from intent
        if (intentLower.includes('ht') || intentLower.includes('high')) {
          detection.type = 'ht_cables';
        } else if (intentLower.includes('lt') || intentLower.includes('low')) {
          detection.type = 'lt_cables';
        } else if (intentLower.includes('control')) {
          detection.type = 'control_cables';
        } else if (intentLower.includes('ehv') || intentLower.includes('extra')) {
          detection.type = 'ehv_cables';
        } else if (intentLower.includes('instrument')) {
          detection.type = 'instrumentation_cables';
        }
        detection.confidence = 0.95;
        detection.method = 'user_intent';
      }
    }
    
    // Learn structure
    const structureResult = await learnCSVStructure(csvContent, detection.type);
    
    // Store in session
    if (sessionStore.csvOverrides[detection.type] !== undefined) {
      sessionStore.csvOverrides[detection.type] = {
        data: parsed,
        rawContent: csvContent,
        originalFileName: fileName,
        uploadedAt: new Date().toISOString(),
        rowCount: parsed.length,
        headers: detection.headers,
        structureMapping: structureResult.mapping,
        mappingConfidence: structureResult.confidence
      };
      
      // Log modification
      sessionStore.modifications.push({
        type: 'csv_upload',
        csvType: detection.type,
        timestamp: new Date().toISOString(),
        details: {
          fileName,
          rowCount: parsed.length,
          userIntent,
          detectionMethod: detection.method,
          confidence: detection.confidence
        }
      });
      
      console.log(`[Adaptive CSV] Stored ${detection.type} override with ${parsed.length} rows`);
      console.log(`[Adaptive CSV] Detection confidence: ${(detection.confidence * 100).toFixed(1)}%`);
      
      return {
        success: true,
        type: detection.type,
        confidence: detection.confidence,
        detectionMethod: detection.method,
        rowCount: parsed.length,
        headers: detection.headers,
        structureMapping: structureResult,
        message: `✅ Uploaded ${fileName || 'CSV'} as **${detection.type.replace(/_/g, ' ')}** ` +
                 `(${(detection.confidence * 100).toFixed(0)}% confidence). ` +
                 `${parsed.length} records will override default data for this session.`
      };
    }
    
    return {
      success: false,
      error: `Unknown CSV type: ${detection.type}`,
      detectedType: detection.type,
      headers: detection.headers,
      suggestion: 'Please specify what type of data this is (testing prices, cable products, pricing rules)'
    };
  } catch (error) {
    console.error('[Adaptive CSV] Upload error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get CSV data (session override or default)
 * @param {string} csvType - Type of CSV to get
 * @returns {array} - CSV data as array of objects
 */
export function getCSVData(csvType) {
  // Check for session override first
  if (sessionStore.csvOverrides[csvType]?.data) {
    console.log(`[Adaptive CSV] Using session override for ${csvType}`);
    
    const override = sessionStore.csvOverrides[csvType];
    const data = override.data;
    
    // If structure mapping exists, transform data to expected format
    if (override.structureMapping && Object.keys(override.structureMapping).length > 0) {
      return data.map(row => {
        const transformed = {};
        for (const [expected, actual] of Object.entries(override.structureMapping)) {
          transformed[expected] = row[actual] ?? row[expected];
        }
        // Include unmapped fields as-is
        for (const [key, value] of Object.entries(row)) {
          if (!Object.values(override.structureMapping).includes(key)) {
            transformed[key] = value;
          }
        }
        return transformed;
      });
    }
    
    return data;
  }
  
  // Fall back to default
  const defaultPath = DEFAULT_PATHS[csvType];
  if (defaultPath && fs.existsSync(defaultPath)) {
    try {
      const content = fs.readFileSync(defaultPath, 'utf-8');
      return parse(content, { columns: true, skip_empty_lines: true });
    } catch (e) {
      console.warn(`[Adaptive CSV] Could not load default ${csvType}:`, e.message);
    }
  }
  
  return [];
}

/**
 * Check if a CSV type has session override
 * @param {string} csvType - Type to check
 * @returns {boolean}
 */
export function hasSessionOverride(csvType) {
  return sessionStore.csvOverrides[csvType]?.data != null;
}

/**
 * Get session status
 * @returns {object} - Session information
 */
export function getSessionStatus() {
  const overrides = {};
  for (const [type, data] of Object.entries(sessionStore.csvOverrides)) {
    if (data) {
      overrides[type] = {
        rowCount: data.rowCount,
        uploadedAt: data.uploadedAt,
        fileName: data.originalFileName,
        mappingConfidence: data.mappingConfidence
      };
    }
  }
  
  return {
    sessionStarted: sessionStore.sessionStarted,
    activeOverrides: overrides,
    modificationsCount: sessionStore.modifications.length,
    learnedStructures: Object.keys(sessionStore.learnedStructures),
    modifications: sessionStore.modifications.slice(-10) // Last 10 modifications
  };
}

/**
 * Clear session overrides (for manual reset)
 */
export function clearSessionOverrides() {
  for (const key of Object.keys(sessionStore.csvOverrides)) {
    sessionStore.csvOverrides[key] = null;
  }
  sessionStore.modifications = [];
  sessionStore.quotationAdjustments = {};
  sessionStore.learnedStructures = {};
  console.log('[Adaptive CSV] Session overrides cleared');
}

/**
 * Store quotation adjustment
 * @param {string} quotationId - Unique ID for quotation
 * @param {object} adjustment - Adjustment details
 */
export function storeQuotationAdjustment(quotationId, adjustment) {
  sessionStore.quotationAdjustments[quotationId] = {
    ...adjustment,
    timestamp: new Date().toISOString()
  };
  
  sessionStore.modifications.push({
    type: 'quotation_adjustment',
    quotationId,
    timestamp: new Date().toISOString(),
    adjustment
  });
}

/**
 * Get quotation adjustment
 * @param {string} quotationId - Quotation ID
 * @returns {object|null} - Adjustment or null
 */
export function getQuotationAdjustment(quotationId) {
  return sessionStore.quotationAdjustments[quotationId] || null;
}

/**
 * Parse natural language quotation modification using semantic understanding
 * @param {string} instruction - User instruction
 * @param {object} currentQuotation - Current quotation values
 * @returns {object} - Parsed modifications
 */
export async function parseQuotationModification(instruction, currentQuotation) {
  const modifications = {
    changes: [],
    success: false,
    interpretation: ''
  };
  
  const instr = instruction.toLowerCase();
  
  // Define modification intents with patterns
  const intents = [
    {
      name: 'set_total',
      patterns: [/(?:change|make|set)\s+(?:total|grand total|amount)\s+(?:to\s+)?(?:₹|rs\.?|inr)?\s*([\d,]+)/i],
      extract: (match) => ({ type: 'total', value: parseFloat(match[1].replace(/,/g, '')) })
    },
    {
      name: 'increase_percent',
      patterns: [/(?:increase|add|raise)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*%/i],
      extract: (match) => ({ type: 'increase_percent', value: parseFloat(match[1]) })
    },
    {
      name: 'decrease_percent',
      patterns: [/(?:decrease|reduce|lower)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*%/i],
      extract: (match) => ({ type: 'decrease_percent', value: parseFloat(match[1]) })
    },
    {
      name: 'material_cost',
      patterns: [
        /(?:material|material cost)\s+(?:to\s+)?(?:₹|rs\.?|inr)?\s*([\d,]+)/i,
        /(?:make|set)\s+material\s+(?:cost\s+)?(?:to\s+)?(?:₹|rs\.?|inr)?\s*([\d,]+)/i
      ],
      extract: (match) => ({ type: 'material_cost', value: parseFloat(match[1].replace(/,/g, '')) })
    },
    {
      name: 'testing_cost',
      patterns: [
        /(?:testing|test)\s+(?:cost\s+)?(?:to\s+)?(?:₹|rs\.?|inr)?\s*([\d,]+)/i,
        /(?:make|set)\s+testing\s+(?:cost\s+)?(?:to\s+)?(?:₹|rs\.?|inr)?\s*([\d,]+)/i
      ],
      extract: (match) => ({ type: 'testing_cost', value: parseFloat(match[1].replace(/,/g, '')) })
    },
    {
      name: 'profit_margin',
      patterns: [
        /(?:profit|margin)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*%?/i,
        /(?:set|change)\s+(?:profit|margin)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*%?/i
      ],
      extract: (match) => ({ type: 'profit_margin', value: parseFloat(match[1]) })
    },
    {
      name: 'add_amount',
      patterns: [
        /(?:add)\s+(?:₹|rs\.?|inr)?\s*([\d,]+)\s+(?:to|more)/i,
        /(?:add)\s+(?:₹|rs\.?|inr)?\s*([\d,]+)/i
      ],
      extract: (match) => ({ type: 'add_amount', value: parseFloat(match[1].replace(/,/g, '')) })
    },
    {
      name: 'target_around',
      patterns: [
        /(?:around|approximately|about)\s+(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(?:lakhs?|lacs?)?/i,
        /(?:make\s+it|total)\s+(?:around|approximately|about)\s+(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i
      ],
      extract: (match) => {
        let value = parseFloat(match[1].replace(/,/g, ''));
        if (instr.includes('lakh') || instr.includes('lac')) value *= 100000;
        if (instr.includes('crore')) value *= 10000000;
        return { type: 'target_around', value };
      }
    }
  ];
  
  // Try each intent
  for (const intent of intents) {
    for (const pattern of intent.patterns) {
      const match = instruction.match(pattern);
      if (match) {
        const change = intent.extract(match);
        modifications.changes.push(change);
        modifications.success = true;
        modifications.interpretation = `Detected: ${intent.name} -> ${JSON.stringify(change)}`;
        break;
      }
    }
    if (modifications.success) break;
  }
  
  // Handle vague instructions
  if (!modifications.success) {
    if (instr.includes('higher') || instr.includes('increase it') || instr.includes('bit more')) {
      modifications.changes.push({ type: 'increase_percent', value: 10 });
      modifications.success = true;
      modifications.interpretation = 'Vague increase detected - defaulting to +10%';
    } else if (instr.includes('lower') || instr.includes('decrease it') || instr.includes('bit less')) {
      modifications.changes.push({ type: 'decrease_percent', value: 10 });
      modifications.success = true;
      modifications.interpretation = 'Vague decrease detected - defaulting to -10%';
    } else if (instr.includes('double')) {
      modifications.changes.push({ type: 'increase_percent', value: 100 });
      modifications.success = true;
      modifications.interpretation = 'Double detected - +100%';
    } else if (instr.includes('half')) {
      modifications.changes.push({ type: 'decrease_percent', value: 50 });
      modifications.success = true;
      modifications.interpretation = 'Half detected - -50%';
    }
  }
  
  return modifications;
}

/**
 * Apply modifications to quotation
 * @param {object} quotation - Original quotation
 * @param {object} modifications - Modifications to apply
 * @returns {object} - Modified quotation
 */
export function applyQuotationModifications(quotation, modifications) {
  const modified = JSON.parse(JSON.stringify(quotation)); // Deep clone
  
  for (const change of modifications.changes) {
    switch (change.type) {
      case 'total':
      case 'target_around': {
        const targetTotal = change.value;
        const currentTotal = modified.breakdown.grandTotal.value;
        const diff = targetTotal - currentTotal;
        
        // Adjust profit to reach target (keeps breakdown visible)
        modified.breakdown.profit.value += diff / 1.18; // Account for GST
        modified.breakdown.grandTotal.value = targetTotal;
        modified.breakdown.profit.formatted = `₹${modified.breakdown.profit.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.breakdown.grandTotal.formatted = `₹${targetTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.summary.grandTotal = modified.breakdown.grandTotal.formatted;
        break;
      }
      
      case 'increase_percent': {
        const multiplier = 1 + (change.value / 100);
        modified.breakdown.grandTotal.value *= multiplier;
        modified.breakdown.profit.value *= multiplier;
        modified.breakdown.grandTotal.formatted = `₹${modified.breakdown.grandTotal.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.breakdown.profit.formatted = `₹${modified.breakdown.profit.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.summary.grandTotal = modified.breakdown.grandTotal.formatted;
        break;
      }
      
      case 'decrease_percent': {
        const multiplier = 1 - (change.value / 100);
        modified.breakdown.grandTotal.value *= multiplier;
        modified.breakdown.profit.value *= multiplier;
        modified.breakdown.grandTotal.formatted = `₹${modified.breakdown.grandTotal.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.breakdown.profit.formatted = `₹${modified.breakdown.profit.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.summary.grandTotal = modified.breakdown.grandTotal.formatted;
        break;
      }
      
      case 'material_cost': {
        const diff = change.value - modified.breakdown.materialCost.value;
        modified.breakdown.materialCost.value = change.value;
        modified.breakdown.materialCost.formatted = `₹${change.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.breakdown.subtotal.value += diff;
        modified.breakdown.grandTotal.value += diff * 1.18;
        modified.breakdown.subtotal.formatted = `₹${modified.breakdown.subtotal.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.breakdown.grandTotal.formatted = `₹${modified.breakdown.grandTotal.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.summary.grandTotal = modified.breakdown.grandTotal.formatted;
        break;
      }
      
      case 'testing_cost': {
        const diff = change.value - modified.breakdown.testingCost.value;
        modified.breakdown.testingCost.value = change.value;
        modified.breakdown.testingCost.formatted = `₹${change.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.breakdown.subtotal.value += diff;
        modified.breakdown.grandTotal.value += diff * 1.18;
        modified.breakdown.subtotal.formatted = `₹${modified.breakdown.subtotal.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.breakdown.grandTotal.formatted = `₹${modified.breakdown.grandTotal.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.summary.grandTotal = modified.breakdown.grandTotal.formatted;
        break;
      }
      
      case 'profit_margin': {
        const subtotal = modified.breakdown.subtotal.value - (modified.breakdown.discount?.value || 0);
        const newProfit = subtotal * (change.value / 100);
        const diff = newProfit - modified.breakdown.profit.value;
        modified.breakdown.profit.value = newProfit;
        modified.breakdown.profit.label = `Profit Margin (${change.value.toFixed(1)}%)`;
        modified.breakdown.profit.formatted = `₹${newProfit.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.breakdown.grandTotal.value += diff * 1.18;
        modified.breakdown.grandTotal.formatted = `₹${modified.breakdown.grandTotal.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.summary.grandTotal = modified.breakdown.grandTotal.formatted;
        if (modified.modifiable) modified.modifiable.profitMargin = change.value;
        break;
      }
      
      case 'add_amount': {
        modified.breakdown.profit.value += change.value;
        modified.breakdown.grandTotal.value += change.value * 1.18;
        modified.breakdown.profit.formatted = `₹${modified.breakdown.profit.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.breakdown.grandTotal.formatted = `₹${modified.breakdown.grandTotal.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        modified.summary.grandTotal = modified.breakdown.grandTotal.formatted;
        break;
      }
    }
  }
  
  modified.wasModified = true;
  modified.appliedChanges = modifications.changes;
  modified.interpretation = modifications.interpretation;
  
  return modified;
}

/**
 * Get comparison between default and session data
 * @param {string} csvType - Type to compare
 * @returns {object} - Comparison details
 */
export function getDataComparison(csvType) {
  const sessionData = sessionStore.csvOverrides[csvType]?.data;
  const defaultPath = DEFAULT_PATHS[csvType];
  
  if (!sessionData || !defaultPath) {
    return { hasComparison: false };
  }
  
  try {
    const defaultContent = fs.readFileSync(defaultPath, 'utf-8');
    const defaultData = parse(defaultContent, { columns: true, skip_empty_lines: true });
    
    // Compare row counts
    const comparison = {
      hasComparison: true,
      defaultRowCount: defaultData.length,
      sessionRowCount: sessionData.length,
      changes: []
    };
    
    // For testing CSV, compare prices
    if (csvType === 'testing') {
      for (const sessionRow of sessionData) {
        const defaultRow = defaultData.find(d => d.Test_ID === sessionRow.Test_ID);
        if (defaultRow) {
          const defaultPrice = parseFloat(defaultRow.Price_INR) || 0;
          const sessionPrice = parseFloat(sessionRow.Price_INR) || 0;
          
          if (defaultPrice !== sessionPrice) {
            comparison.changes.push({
              id: sessionRow.Test_ID,
              name: sessionRow.Test_Name,
              defaultValue: defaultPrice,
              newValue: sessionPrice,
              change: sessionPrice - defaultPrice,
              changePercent: defaultPrice > 0 ? ((sessionPrice - defaultPrice) / defaultPrice * 100).toFixed(1) : 'N/A'
            });
          }
        }
      }
    }
    
    return comparison;
  } catch (error) {
    return { hasComparison: false, error: error.message };
  }
}

export default {
  detectCSVType,
  learnCSVStructure,
  uploadSessionCSV,
  getCSVData,
  hasSessionOverride,
  getSessionStatus,
  clearSessionOverrides,
  storeQuotationAdjustment,
  getQuotationAdjustment,
  parseQuotationModification,
  applyQuotationModifications,
  getDataComparison
};
