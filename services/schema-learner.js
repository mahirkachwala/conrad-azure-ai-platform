/**
 * Schema Learner Service
 * EY Techathon 6.0 - Adaptive AI System
 * 
 * Automatically learns and adapts to CSV/data structures.
 * When new data files are added, it:
 * 1. Detects column types and patterns
 * 2. Creates semantic embeddings for columns
 * 3. Maps new schemas to known patterns
 * 4. Enables dynamic querying without hardcoded logic
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embed, embedBatch, cosineSimilarity } from './local-embeddings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Schema knowledge base path
const SCHEMA_KB_PATH = path.join(__dirname, '../data/schema_knowledge.json');

// Known column type patterns (bootstrapped, will learn more)
const COLUMN_TYPE_PATTERNS = {
  identifier: ['id', 'sku', 'code', 'number', 'ref', 'tender_id', 'rfp_id', 'item_no'],
  product_name: ['name', 'product', 'title', 'description', 'item', 'material'],
  price: ['price', 'cost', 'rate', 'amount', 'value', 'mrp', 'unit_price'],
  quantity: ['quantity', 'qty', 'count', 'units', 'volume', 'km', 'meters'],
  voltage: ['voltage', 'volt', 'kv', 'rating_v', 'voltage_rating'],
  conductor: ['conductor', 'core', 'wire', 'material_type', 'cu', 'al'],
  insulation: ['insulation', 'xlpe', 'pvc', 'sheath', 'jacket'],
  date: ['date', 'deadline', 'due', 'submission', 'published', 'created'],
  location: ['city', 'location', 'state', 'region', 'area', 'place'],
  organization: ['organization', 'company', 'buyer', 'vendor', 'supplier', 'org'],
  category: ['category', 'type', 'class', 'group', 'segment'],
  specification: ['spec', 'size', 'dimension', 'cross_section', 'area', 'sqmm', 'mm2'],
  boolean: ['armoured', 'armored', 'active', 'enabled', 'available', 'yes', 'no']
};

// Learned schemas storage
let schemaKnowledge = {
  version: '1.0',
  schemas: {},           // file -> schema mapping
  columnEmbeddings: {},  // column name -> embedding
  typePatterns: {},      // learned type patterns
  relationships: [],     // detected relationships between files
  lastUpdated: null
};

/**
 * Initialize schema learner - load existing knowledge
 */
export async function initSchemaLearner() {
  try {
    if (fs.existsSync(SCHEMA_KB_PATH)) {
      const data = fs.readFileSync(SCHEMA_KB_PATH, 'utf-8');
      schemaKnowledge = JSON.parse(data);
      console.log(`📚 Loaded schema knowledge: ${Object.keys(schemaKnowledge.schemas).length} schemas`);
    }
  } catch (error) {
    console.warn('⚠️ Could not load schema knowledge, starting fresh');
  }
  return schemaKnowledge;
}

/**
 * Save schema knowledge to disk
 */
function saveSchemaKnowledge() {
  schemaKnowledge.lastUpdated = new Date().toISOString();
  fs.writeFileSync(SCHEMA_KB_PATH, JSON.stringify(schemaKnowledge, null, 2));
  console.log('💾 Schema knowledge saved');
}

/**
 * Learn schema from a CSV file
 * @param {string} filePath - Path to CSV file
 * @returns {Object} Learned schema
 */
export async function learnCSVSchema(filePath) {
  console.log(`🔍 Learning schema from: ${path.basename(filePath)}`);
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  
  if (lines.length < 2) {
    throw new Error('CSV file must have at least header and one data row');
  }
  
  const headers = parseCSVLine(lines[0]);
  const sampleRows = lines.slice(1, Math.min(11, lines.length)).map(parseCSVLine);
  
  const schema = {
    fileName: path.basename(filePath),
    filePath: filePath,
    columnCount: headers.length,
    rowCount: lines.length - 1,
    columns: [],
    learnedAt: new Date().toISOString()
  };
  
  // Analyze each column
  for (let i = 0; i < headers.length; i++) {
    const columnName = headers[i].trim();
    const sampleValues = sampleRows.map(row => row[i]?.trim() || '').filter(v => v);
    
    const columnInfo = await analyzeColumn(columnName, sampleValues);
    schema.columns.push(columnInfo);
  }
  
  // Detect relationships with other schemas
  schema.relationships = detectRelationships(schema);
  
  // Store schema
  schemaKnowledge.schemas[path.basename(filePath)] = schema;
  saveSchemaKnowledge();
  
  console.log(`✅ Learned schema: ${schema.columns.length} columns, ${schema.rowCount} rows`);
  
  return schema;
}

/**
 * Analyze a single column
 */
async function analyzeColumn(columnName, sampleValues) {
  const normalizedName = columnName.toLowerCase().replace(/[_\s-]/g, '');
  
  // Detect type from name patterns
  let detectedType = 'unknown';
  for (const [type, patterns] of Object.entries(COLUMN_TYPE_PATTERNS)) {
    if (patterns.some(p => normalizedName.includes(p))) {
      detectedType = type;
      break;
    }
  }
  
  // Analyze sample values for additional type inference
  const valueAnalysis = analyzeValues(sampleValues);
  
  // If type still unknown, infer from values
  if (detectedType === 'unknown') {
    if (valueAnalysis.isNumeric) detectedType = 'numeric';
    else if (valueAnalysis.isDate) detectedType = 'date';
    else if (valueAnalysis.isBoolean) detectedType = 'boolean';
    else detectedType = 'text';
  }
  
  // Create embedding for semantic matching
  const searchText = `${columnName} ${detectedType} ${sampleValues.slice(0, 3).join(' ')}`;
  let embedding = null;
  
  try {
    embedding = await embed(searchText);
    schemaKnowledge.columnEmbeddings[columnName] = embedding;
  } catch (e) {
    console.warn(`Could not embed column ${columnName}`);
  }
  
  return {
    name: columnName,
    normalizedName,
    detectedType,
    nullable: valueAnalysis.hasNulls,
    uniqueRatio: valueAnalysis.uniqueRatio,
    sampleValues: sampleValues.slice(0, 5),
    valueStats: valueAnalysis,
    hasEmbedding: embedding !== null
  };
}

/**
 * Analyze sample values
 */
function analyzeValues(values) {
  const nonEmpty = values.filter(v => v && v.trim());
  const unique = new Set(nonEmpty);
  
  const isNumeric = nonEmpty.every(v => !isNaN(parseFloat(v)));
  const isDate = nonEmpty.every(v => !isNaN(Date.parse(v)));
  const isBoolean = nonEmpty.every(v => 
    ['yes', 'no', 'true', 'false', '1', '0', 'y', 'n'].includes(v.toLowerCase())
  );
  
  let stats = {
    total: values.length,
    nonEmpty: nonEmpty.length,
    hasNulls: values.length > nonEmpty.length,
    uniqueCount: unique.size,
    uniqueRatio: nonEmpty.length > 0 ? unique.size / nonEmpty.length : 0,
    isNumeric,
    isDate,
    isBoolean
  };
  
  if (isNumeric && nonEmpty.length > 0) {
    const nums = nonEmpty.map(v => parseFloat(v));
    stats.min = Math.min(...nums);
    stats.max = Math.max(...nums);
    stats.avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  }
  
  return stats;
}

/**
 * Detect relationships between schemas
 */
function detectRelationships(newSchema) {
  const relationships = [];
  
  for (const [fileName, existingSchema] of Object.entries(schemaKnowledge.schemas)) {
    if (fileName === newSchema.fileName) continue;
    
    // Check for common columns (potential joins)
    for (const newCol of newSchema.columns) {
      for (const existCol of existingSchema.columns) {
        if (newCol.normalizedName === existCol.normalizedName ||
            newCol.detectedType === 'identifier' && existCol.detectedType === 'identifier') {
          relationships.push({
            targetFile: fileName,
            sourceColumn: newCol.name,
            targetColumn: existCol.name,
            relationshipType: newCol.uniqueRatio > 0.9 ? 'one-to-many' : 'many-to-many'
          });
        }
      }
    }
  }
  
  return relationships;
}

/**
 * Find columns matching a semantic query
 * @param {string} query - Natural language query (e.g., "cable voltage rating")
 * @returns {Array} Matching columns across all schemas
 */
export async function findMatchingColumns(query) {
  const queryEmbedding = await embed(query);
  const matches = [];
  
  for (const [fileName, schema] of Object.entries(schemaKnowledge.schemas)) {
    for (const column of schema.columns) {
      if (schemaKnowledge.columnEmbeddings[column.name]) {
        const similarity = cosineSimilarity(
          queryEmbedding,
          schemaKnowledge.columnEmbeddings[column.name]
        );
        
        if (similarity > 0.5) {
          matches.push({
            file: fileName,
            column: column.name,
            type: column.detectedType,
            similarity: Math.round(similarity * 100),
            sampleValues: column.sampleValues
          });
        }
      }
    }
  }
  
  return matches.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Learn all CSVs in a directory
 */
export async function learnDirectory(dirPath) {
  console.log(`📂 Learning schemas from directory: ${dirPath}`);
  
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.csv'));
  const results = [];
  
  for (const file of files) {
    try {
      const schema = await learnCSVSchema(path.join(dirPath, file));
      results.push({ file, success: true, columns: schema.columns.length });
    } catch (error) {
      results.push({ file, success: false, error: error.message });
    }
  }
  
  console.log(`✅ Learned ${results.filter(r => r.success).length}/${files.length} schemas`);
  return results;
}

/**
 * Generate dynamic query based on learned schema
 * @param {string} query - User query
 * @param {string} targetFile - Target CSV file
 * @returns {Object} Query plan
 */
export async function generateQueryPlan(query, targetFile = null) {
  const matchingColumns = await findMatchingColumns(query);
  
  if (matchingColumns.length === 0) {
    return { success: false, message: 'No matching columns found' };
  }
  
  // Group by file
  const byFile = {};
  for (const match of matchingColumns) {
    if (!byFile[match.file]) byFile[match.file] = [];
    byFile[match.file].push(match);
  }
  
  // If target file specified, prioritize it
  const files = targetFile && byFile[targetFile] 
    ? [targetFile, ...Object.keys(byFile).filter(f => f !== targetFile)]
    : Object.keys(byFile);
  
  return {
    success: true,
    query,
    matchingFiles: files,
    columnMatches: byFile,
    suggestedFilters: matchingColumns.slice(0, 3).map(m => ({
      file: m.file,
      column: m.column,
      type: m.type
    }))
  };
}

/**
 * Get schema summary for a file
 */
export function getSchemaInfo(fileName) {
  return schemaKnowledge.schemas[fileName] || null;
}

/**
 * Get all learned schemas
 */
export function getAllSchemas() {
  return schemaKnowledge.schemas;
}

/**
 * Parse CSV line (handles quoted values)
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  
  return result;
}

/**
 * Export schema knowledge for fine-tuning
 */
export function exportForTraining() {
  const trainingData = [];
  
  for (const [fileName, schema] of Object.entries(schemaKnowledge.schemas)) {
    for (const column of schema.columns) {
      trainingData.push({
        input: column.name,
        output: column.detectedType,
        context: `Column from ${fileName}`,
        samples: column.sampleValues
      });
    }
  }
  
  return trainingData;
}

export default {
  initSchemaLearner,
  learnCSVSchema,
  learnDirectory,
  findMatchingColumns,
  generateQueryPlan,
  getSchemaInfo,
  getAllSchemas,
  exportForTraining
};



