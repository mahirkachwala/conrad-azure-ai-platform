/**
 * UPLOADED PDF STORE
 * 
 * Stores uploaded PDFs in memory so they can be used for RFP analysis
 * instead of the original PDFs in /public/rfps/
 * 
 * Flow:
 * 1. User uploads "IND-201 adaptive.pdf" via chat
 * 2. System extracts tender ID and stores the PDF path
 * 3. When "Proceed with RFP" is clicked, check if there's an uploaded version
 * 4. Use the uploaded version if available, otherwise use original
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory store for uploaded PDFs
// Key: tender ID (e.g., "IND-201")
// Value: { path, uploadedAt, originalName }
const uploadedPdfs = new Map();

/**
 * Store an uploaded PDF for a tender
 * Also stores the extracted data to avoid re-parsing
 */
export function storeUploadedPdf(tenderId, pdfPath, originalName, extractedData = null) {
  const normalizedId = tenderId.toUpperCase().trim();
  
  console.log(`\n════════════════════════════════════════`);
  console.log(`📥 STORING UPLOADED PDF`);
  console.log(`════════════════════════════════════════`);
  console.log(`   Tender ID: ${normalizedId}`);
  console.log(`   Original Name: ${originalName}`);
  console.log(`   Path: ${pdfPath}`);
  console.log(`   File exists: ${fs.existsSync(pdfPath)}`);
  console.log(`   Has extracted data: ${extractedData ? 'YES' : 'NO'}`);
  
  uploadedPdfs.set(normalizedId, {
    path: pdfPath,
    uploadedAt: new Date().toISOString(),
    originalName: originalName,
    extractedData: extractedData
  });
  
  console.log(`   ✅ STORED! Total PDFs in store: ${uploadedPdfs.size}`);
  console.log(`════════════════════════════════════════\n`);
  
  return true;
}

/**
 * Get stored extracted data for a tender
 */
export function getExtractedData(tenderId) {
  const normalizedId = tenderId.toUpperCase().trim();
  const stored = uploadedPdfs.get(normalizedId);
  return stored?.extractedData || null;
}

/**
 * Get the PDF path for a tender (uploaded version or original)
 */
export function getPdfPath(tenderId) {
  const normalizedId = tenderId.toUpperCase().trim();
  
  console.log(`\n🔎 Looking for PDF: ${normalizedId}`);
  console.log(`   📚 Uploaded PDFs in store: ${uploadedPdfs.size}`);
  
  // List all uploaded PDFs for debugging
  if (uploadedPdfs.size > 0) {
    console.log(`   📋 Available uploaded PDFs:`);
    for (const [id, info] of uploadedPdfs) {
      console.log(`      - ${id}: ${info.originalName}`);
    }
  }
  
  // Check for uploaded version first
  if (uploadedPdfs.has(normalizedId)) {
    const uploaded = uploadedPdfs.get(normalizedId);
    console.log(`   ✅ Found uploaded PDF entry for ${normalizedId}`);
    console.log(`   📂 Path: ${uploaded.path}`);
    
    if (fs.existsSync(uploaded.path)) {
      console.log(`   ✅ File EXISTS - using UPLOADED PDF: ${uploaded.originalName}`);
      return {
        path: uploaded.path,
        source: 'UPLOADED',
        originalName: uploaded.originalName,
        uploadedAt: uploaded.uploadedAt
      };
    } else {
      console.log(`   ⚠️ File NOT FOUND at path, removing from store`);
      uploadedPdfs.delete(normalizedId);
    }
  } else {
    console.log(`   ℹ️ No uploaded PDF found for ${normalizedId}`);
  }
  
  // Fall back to original PDF
  const originalPath = path.join(__dirname, `../public/rfps/${normalizedId}.pdf`);
  console.log(`   🔍 Checking original path: ${originalPath}`);
  
  if (fs.existsSync(originalPath)) {
    console.log(`   📄 Using ORIGINAL PDF for ${normalizedId}`);
    return {
      path: originalPath,
      source: 'ORIGINAL',
      originalName: `${normalizedId}.pdf`
    };
  }
  
  console.log(`   ❌ No PDF found for ${normalizedId}`);
  return null;
}

/**
 * Check if an uploaded version exists for a tender
 */
export function hasUploadedPdf(tenderId) {
  const normalizedId = tenderId.toUpperCase().trim();
  return uploadedPdfs.has(normalizedId);
}

/**
 * Get all uploaded PDFs info
 */
export function getAllUploadedPdfs() {
  const result = [];
  for (const [tenderId, info] of uploadedPdfs) {
    result.push({
      tenderId,
      ...info,
      exists: fs.existsSync(info.path)
    });
  }
  return result;
}

/**
 * Clear uploaded PDF for a tender
 */
export function clearUploadedPdf(tenderId) {
  const normalizedId = tenderId.toUpperCase().trim();
  return uploadedPdfs.delete(normalizedId);
}

/**
 * Clear all uploaded PDFs
 */
export function clearAllUploadedPdfs() {
  uploadedPdfs.clear();
  console.log('🗑️ Cleared all uploaded PDFs');
}

/**
 * Extract tender ID from filename
 * e.g., "IND-201 adaptive.pdf" -> "IND-201"
 * e.g., "GOV_102_modified.pdf" -> "GOV-102"
 * e.g., "UTL-300.pdf" -> "UTL-300"
 */
export function extractTenderIdFromFilename(filename) {
  console.log(`🔍 Extracting tender ID from: "${filename}"`);
  
  // Pattern: GOV-XXX, IND-XXX, UTL-XXX, RFP-XXX (with optional dash or underscore)
  const match = filename.match(/(GOV|IND|UTL|RFP)[\-_]?(\d{3,4})/i);
  if (match) {
    // Normalize to format "PREFIX-NUMBER"
    const tenderId = `${match[1].toUpperCase()}-${match[2]}`;
    console.log(`   ✅ Extracted tender ID: ${tenderId}`);
    return tenderId;
  }
  
  console.log(`   ⚠️ No tender ID found in filename`);
  return null;
}

export default {
  storeUploadedPdf,
  getPdfPath,
  hasUploadedPdf,
  getAllUploadedPdfs,
  clearUploadedPdf,
  clearAllUploadedPdfs,
  extractTenderIdFromFilename
};

