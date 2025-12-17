/**
 * AWS Textract Service
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Uses AWS Textract for:
 * - OCR of scanned PDFs
 * - Table extraction from BOQ documents
 * - Form field extraction
 * 
 * This provides much better extraction than basic PDF parsing,
 * especially for:
 * - Scanned documents
 * - Complex tables
 * - Hand-written notes
 */

import { TextractClient, AnalyzeDocumentCommand, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import fs from 'fs';
import path from 'path';

// Initialize Textract client
let textractClient = null;

function getTextractClient() {
  if (textractClient) return textractClient;
  
  // Check for credentials
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.warn('⚠️ AWS credentials not found. Textract will not be available.');
    return null;
  }
  
  textractClient = new TextractClient({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });
  
  console.log('✅ AWS Textract client initialized');
  return textractClient;
}

/**
 * Extract text from a PDF/image using Textract
 * @param {string} filePath - Path to PDF or image file
 * @returns {Object} Extracted text and metadata
 */
export async function extractText(filePath) {
  const client = getTextractClient();
  if (!client) {
    return { success: false, error: 'Textract not configured' };
  }
  
  try {
    // Read file as bytes
    const fileBytes = fs.readFileSync(filePath);
    
    const command = new DetectDocumentTextCommand({
      Document: {
        Bytes: fileBytes
      }
    });
    
    const response = await client.send(command);
    
    // Extract text blocks
    const textBlocks = response.Blocks?.filter(b => b.BlockType === 'LINE') || [];
    const fullText = textBlocks.map(b => b.Text).join('\n');
    
    return {
      success: true,
      text: fullText,
      blocks: textBlocks.length,
      confidence: calculateAverageConfidence(textBlocks)
    };
  } catch (error) {
    console.error('Textract extraction error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Extract tables from a document using Textract
 * @param {string} filePath - Path to PDF or image file
 * @returns {Object} Extracted tables with cell data
 */
export async function extractTables(filePath) {
  const client = getTextractClient();
  if (!client) {
    return { success: false, error: 'Textract not configured' };
  }
  
  try {
    const fileBytes = fs.readFileSync(filePath);
    
    const command = new AnalyzeDocumentCommand({
      Document: {
        Bytes: fileBytes
      },
      FeatureTypes: ['TABLES']
    });
    
    const response = await client.send(command);
    
    // Parse tables from response
    const tables = parseTablesFromResponse(response);
    
    return {
      success: true,
      tables: tables,
      tableCount: tables.length
    };
  } catch (error) {
    console.error('Textract table extraction error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Extract BOQ (Bill of Quantities) from a tender document
 * @param {string} filePath - Path to PDF
 * @returns {Object} Structured BOQ data
 */
export async function extractBOQ(filePath) {
  const client = getTextractClient();
  if (!client) {
    return { success: false, error: 'Textract not configured', boq: [] };
  }
  
  try {
    const fileBytes = fs.readFileSync(filePath);
    
    // Use both TABLES and FORMS feature types
    const command = new AnalyzeDocumentCommand({
      Document: {
        Bytes: fileBytes
      },
      FeatureTypes: ['TABLES', 'FORMS']
    });
    
    const response = await client.send(command);
    
    // Parse tables
    const tables = parseTablesFromResponse(response);
    
    // Identify BOQ table (usually has headers like Item, Description, Qty, Unit, Rate)
    const boqTable = findBOQTable(tables);
    
    // Parse BOQ items
    const boqItems = parseBOQItems(boqTable);
    
    // Extract form fields (EMD, deadline, etc.)
    const formFields = parseFormFields(response);
    
    return {
      success: true,
      boq: boqItems,
      formFields: formFields,
      rawTables: tables
    };
  } catch (error) {
    console.error('BOQ extraction error:', error.message);
    return { success: false, error: error.message, boq: [] };
  }
}

/**
 * Full document analysis - extracts text, tables, and forms
 * @param {string} filePath - Path to document
 * @returns {Object} Complete extracted data
 */
export async function analyzeDocument(filePath) {
  const client = getTextractClient();
  if (!client) {
    // Fallback to basic extraction
    return {
      success: false,
      error: 'Textract not configured',
      suggestion: 'Using basic PDF parser as fallback'
    };
  }
  
  try {
    const fileBytes = fs.readFileSync(filePath);
    
    const command = new AnalyzeDocumentCommand({
      Document: {
        Bytes: fileBytes
      },
      FeatureTypes: ['TABLES', 'FORMS']
    });
    
    const response = await client.send(command);
    
    // Extract all data
    const textBlocks = response.Blocks?.filter(b => b.BlockType === 'LINE') || [];
    const fullText = textBlocks.map(b => b.Text).join('\n');
    const tables = parseTablesFromResponse(response);
    const formFields = parseFormFields(response);
    
    return {
      success: true,
      extraction_method: 'AWS_TEXTRACT',
      text: fullText,
      tables: tables,
      formFields: formFields,
      pageCount: getPageCount(response),
      confidence: calculateAverageConfidence(textBlocks)
    };
  } catch (error) {
    console.error('Document analysis error:', error.message);
    return { success: false, error: error.message };
  }
}

// Helper functions

function calculateAverageConfidence(blocks) {
  if (!blocks || blocks.length === 0) return 0;
  const sum = blocks.reduce((acc, b) => acc + (b.Confidence || 0), 0);
  return Math.round(sum / blocks.length);
}

function parseTablesFromResponse(response) {
  const tables = [];
  const blocks = response.Blocks || [];
  
  // Create block map for lookups
  const blockMap = {};
  blocks.forEach(b => {
    blockMap[b.Id] = b;
  });
  
  // Find TABLE blocks
  const tableBlocks = blocks.filter(b => b.BlockType === 'TABLE');
  
  for (const tableBlock of tableBlocks) {
    const table = {
      rows: [],
      rowCount: 0,
      columnCount: 0
    };
    
    // Get CELL blocks for this table
    const cellIds = tableBlock.Relationships?.find(r => r.Type === 'CHILD')?.Ids || [];
    const cells = cellIds.map(id => blockMap[id]).filter(Boolean);
    
    // Organize cells into rows
    const rowMap = {};
    for (const cell of cells) {
      if (cell.BlockType !== 'CELL') continue;
      
      const rowIndex = cell.RowIndex || 0;
      const colIndex = cell.ColumnIndex || 0;
      
      if (!rowMap[rowIndex]) rowMap[rowIndex] = {};
      
      // Get cell text
      const childIds = cell.Relationships?.find(r => r.Type === 'CHILD')?.Ids || [];
      const cellText = childIds
        .map(id => blockMap[id])
        .filter(b => b && b.BlockType === 'WORD')
        .map(b => b.Text)
        .join(' ');
      
      rowMap[rowIndex][colIndex] = cellText;
      
      table.columnCount = Math.max(table.columnCount, colIndex);
    }
    
    // Convert to array
    for (const rowIndex of Object.keys(rowMap).sort((a, b) => a - b)) {
      const row = [];
      for (let col = 1; col <= table.columnCount; col++) {
        row.push(rowMap[rowIndex][col] || '');
      }
      table.rows.push(row);
    }
    
    table.rowCount = table.rows.length;
    tables.push(table);
  }
  
  return tables;
}

function findBOQTable(tables) {
  // Look for table with BOQ-like headers
  const boqHeaders = ['item', 'description', 'qty', 'quantity', 'unit', 'rate', 'amount', 'sl', 'no'];
  
  for (const table of tables) {
    if (table.rows.length === 0) continue;
    
    const headerRow = table.rows[0].map(h => h.toLowerCase());
    const matchCount = headerRow.filter(h => 
      boqHeaders.some(bh => h.includes(bh))
    ).length;
    
    if (matchCount >= 3) {
      return table;
    }
  }
  
  // Return largest table as fallback
  return tables.sort((a, b) => b.rowCount - a.rowCount)[0] || null;
}

function parseBOQItems(table) {
  if (!table || table.rows.length < 2) return [];
  
  const headers = table.rows[0].map(h => h.toLowerCase());
  const items = [];
  
  // Find column indices
  const descIdx = headers.findIndex(h => h.includes('description') || h.includes('particular'));
  const qtyIdx = headers.findIndex(h => h.includes('qty') || h.includes('quantity'));
  const unitIdx = headers.findIndex(h => h.includes('unit'));
  const rateIdx = headers.findIndex(h => h.includes('rate') || h.includes('price'));
  
  // Parse data rows
  for (let i = 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    const item = {
      item_no: i,
      description: descIdx >= 0 ? row[descIdx] : row[1] || '',
      quantity: qtyIdx >= 0 ? row[qtyIdx] : '',
      unit: unitIdx >= 0 ? row[unitIdx] : '',
      rate: rateIdx >= 0 ? row[rateIdx] : ''
    };
    
    // Skip empty rows
    if (item.description.trim()) {
      items.push(item);
    }
  }
  
  return items;
}

function parseFormFields(response) {
  const fields = {};
  const blocks = response.Blocks || [];
  
  // Create block map
  const blockMap = {};
  blocks.forEach(b => {
    blockMap[b.Id] = b;
  });
  
  // Find KEY_VALUE_SET blocks
  const kvBlocks = blocks.filter(b => 
    b.BlockType === 'KEY_VALUE_SET' && b.EntityTypes?.includes('KEY')
  );
  
  for (const kvBlock of kvBlocks) {
    // Get key text
    const keyChildIds = kvBlock.Relationships?.find(r => r.Type === 'CHILD')?.Ids || [];
    const keyText = keyChildIds
      .map(id => blockMap[id])
      .filter(b => b && b.BlockType === 'WORD')
      .map(b => b.Text)
      .join(' ');
    
    // Get value
    const valueId = kvBlock.Relationships?.find(r => r.Type === 'VALUE')?.Ids?.[0];
    const valueBlock = valueId ? blockMap[valueId] : null;
    
    let valueText = '';
    if (valueBlock) {
      const valueChildIds = valueBlock.Relationships?.find(r => r.Type === 'CHILD')?.Ids || [];
      valueText = valueChildIds
        .map(id => blockMap[id])
        .filter(b => b && b.BlockType === 'WORD')
        .map(b => b.Text)
        .join(' ');
    }
    
    if (keyText.trim()) {
      fields[keyText.trim()] = valueText.trim();
    }
  }
  
  return fields;
}

function getPageCount(response) {
  const blocks = response.Blocks || [];
  const pages = new Set(blocks.map(b => b.Page).filter(Boolean));
  return pages.size || 1;
}

/**
 * Check if Textract is available
 */
export function isTextractAvailable() {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

export default {
  extractText,
  extractTables,
  extractBOQ,
  analyzeDocument,
  isTextractAvailable
};



