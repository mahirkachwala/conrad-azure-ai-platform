/**
 * Adobe PDF Services API Integration
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Used for:
 * - PDF form filling
 * - PDF generation (cover letters, bid responses)
 * - Converting PDF to JSON/structured data
 * 
 * API Documentation: https://developer.adobe.com/document-services/
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Adobe credentials from environment
const ADOBE_CLIENT_ID = process.env.ADOBE_PDF_CLIENT_ID || '';
const ADOBE_CLIENT_SECRET = process.env.ADOBE_PDF_CLIENT_SECRET || '';
const ADOBE_API_BASE = 'https://pdf-services.adobe.io';

let accessToken = null;
let tokenExpiry = 0;

/**
 * Get Adobe PDF Services access token
 * Handles token caching and refresh
 * @returns {Promise<string>} Access token
 */
export async function getAccessToken() {
  // Check if we have a valid cached token
  if (accessToken && Date.now() < tokenExpiry - 60000) {
    return accessToken;
  }
  
  if (!ADOBE_CLIENT_ID || !ADOBE_CLIENT_SECRET) {
    console.log('Adobe PDF Services credentials not configured');
    return null;
  }
  
  try {
    const response = await fetch(`${ADOBE_API_BASE}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: ADOBE_CLIENT_ID,
        client_secret: ADOBE_CLIENT_SECRET
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token request failed: ${error}`);
    }
    
    const data = await response.json();
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);
    
    console.log('✅ Adobe PDF Services token obtained');
    return accessToken;
    
  } catch (error) {
    console.error('Adobe token error:', error.message);
    return null;
  }
}

/**
 * Upload a PDF asset to Adobe cloud
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<Object>} Upload result with assetId
 */
export async function uploadAsset(pdfBuffer) {
  const token = await getAccessToken();
  if (!token) {
    return { success: false, error: 'No access token' };
  }
  
  try {
    // Step 1: Get upload pre-signed URI
    const presignedResponse = await fetch(`${ADOBE_API_BASE}/assets`, {
      method: 'POST',
      headers: {
        'X-API-Key': ADOBE_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mediaType: 'application/pdf'
      })
    });
    
    if (!presignedResponse.ok) {
      throw new Error(`Pre-signed URI request failed: ${presignedResponse.status}`);
    }
    
    const presignedData = await presignedResponse.json();
    
    // Step 2: Upload the PDF to the presigned URI
    const uploadResponse = await fetch(presignedData.uploadUri, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf'
      },
      body: pdfBuffer
    });
    
    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.status}`);
    }
    
    console.log('✅ PDF uploaded to Adobe cloud');
    return {
      success: true,
      assetId: presignedData.assetID
    };
    
  } catch (error) {
    console.error('Adobe upload error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Extract structured data from PDF using Adobe Extract API
 * @param {string} assetId - Adobe asset ID
 * @returns {Promise<Object>} Extracted data
 */
export async function extractPDFContent(assetId) {
  const token = await getAccessToken();
  if (!token) {
    return { success: false, error: 'No access token' };
  }
  
  try {
    // Create extract job
    const jobResponse = await fetch(`${ADOBE_API_BASE}/operation/extractpdf`, {
      method: 'POST',
      headers: {
        'X-API-Key': ADOBE_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assetID: assetId,
        elementsToExtract: ['text', 'tables']
      })
    });
    
    if (!jobResponse.ok) {
      throw new Error(`Extract job creation failed: ${jobResponse.status}`);
    }
    
    // Get job location from response headers
    const jobLocation = jobResponse.headers.get('location');
    
    // Poll for job completion
    let status = 'in progress';
    let result = null;
    
    while (status === 'in progress') {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      const statusResponse = await fetch(jobLocation, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-API-Key': ADOBE_CLIENT_ID
        }
      });
      
      const statusData = await statusResponse.json();
      status = statusData.status;
      
      if (status === 'done') {
        result = statusData;
      } else if (status === 'failed') {
        throw new Error('Extract job failed');
      }
    }
    
    // Download the result
    if (result && result.downloadUri) {
      const downloadResponse = await fetch(result.downloadUri);
      const extractedData = await downloadResponse.json();
      
      return {
        success: true,
        data: extractedData
      };
    }
    
    return { success: false, error: 'No download URI' };
    
  } catch (error) {
    console.error('Adobe extract error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Generate PDF document using Adobe Document Generation API
 * @param {string} templateAssetId - Template PDF asset ID
 * @param {Object} jsonData - JSON data to merge
 * @returns {Promise<Object>} Generated PDF result
 */
export async function generateDocument(templateAssetId, jsonData) {
  const token = await getAccessToken();
  if (!token) {
    return { success: false, error: 'No access token' };
  }
  
  try {
    const jobResponse = await fetch(`${ADOBE_API_BASE}/operation/documentgeneration`, {
      method: 'POST',
      headers: {
        'X-API-Key': ADOBE_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assetID: templateAssetId,
        outputFormat: 'pdf',
        jsonDataForMerge: jsonData
      })
    });
    
    if (jobResponse.status !== 201) {
      throw new Error(`Document generation job creation failed: ${jobResponse.status}`);
    }
    
    const jobLocation = jobResponse.headers.get('location');
    
    // Poll for completion
    let status = 'in progress';
    let result = null;
    
    while (status === 'in progress') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const statusResponse = await fetch(jobLocation, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-API-Key': ADOBE_CLIENT_ID
        }
      });
      
      const statusData = await statusResponse.json();
      status = statusData.status;
      
      if (status === 'done') {
        result = statusData;
      } else if (status === 'failed') {
        throw new Error('Document generation failed');
      }
    }
    
    // Download generated PDF
    if (result && result.downloadUri) {
      const downloadResponse = await fetch(result.downloadUri);
      const pdfBuffer = await downloadResponse.buffer();
      
      return {
        success: true,
        pdfBuffer
      };
    }
    
    return { success: false, error: 'No download URI' };
    
  } catch (error) {
    console.error('Adobe generate error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check if Adobe PDF Services is available
 * @returns {Promise<boolean>} Availability status
 */
export async function isAvailable() {
  if (!ADOBE_CLIENT_ID || !ADOBE_CLIENT_SECRET) {
    return false;
  }
  
  const token = await getAccessToken();
  return !!token;
}

/**
 * Fallback PDF generation using PDFKit (when Adobe is not available)
 * This is used for generating bid response documents locally
 */
import PDFDocument from 'pdfkit';

/**
 * Generate a bid response cover letter PDF
 * @param {Object} params - Letter parameters
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function generateCoverLetter(params) {
  const {
    vendor_name = 'OEM Cables Pvt. Ltd.',
    vendor_address = 'Mumbai, India',
    vendor_gst = 'XXXXXXXXXXXXXXXXX',
    buyer_name = 'Buyer Organization',
    buyer_address = 'Buyer Address',
    rfp_reference = 'RFP-XXX',
    rfp_title = 'Supply of Cables',
    bid_items = [],
    total_value = 0,
    delivery_days = 60,
    validity_days = 90
  } = params;
  
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
    
    // Company Header
    doc.fontSize(16).font('Helvetica-Bold').text(vendor_name, { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(vendor_address, { align: 'center' });
    doc.text(`GST: ${vendor_gst}`, { align: 'center' });
    
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();
    
    // Date
    doc.fontSize(11).text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`);
    doc.moveDown();
    
    // Recipient
    doc.font('Helvetica-Bold').text('To,');
    doc.font('Helvetica').text(buyer_name);
    doc.text(buyer_address);
    doc.moveDown();
    
    // Subject
    doc.font('Helvetica-Bold').text(`Subject: Bid Submission for ${rfp_reference} - ${rfp_title}`);
    doc.moveDown();
    
    // Reference
    doc.font('Helvetica').text(`Ref: Your RFP ${rfp_reference}`);
    doc.moveDown();
    
    // Salutation
    doc.text('Dear Sir/Madam,');
    doc.moveDown();
    
    // Body
    doc.text(
      `With reference to the above-mentioned RFP, we are pleased to submit our technical and commercial bid for the supply of electrical cables as per your specifications.`,
      { align: 'justify' }
    );
    doc.moveDown();
    
    doc.text('We confirm the following:');
    doc.moveDown(0.5);
    
    const confirmations = [
      'We have read and understood all terms and conditions mentioned in the RFP.',
      'All materials offered are as per the technical specifications.',
      'We are an established manufacturer of electrical cables with relevant certifications.',
      'All required tests will be conducted at NABL accredited laboratories.',
      `Our bid is valid for ${validity_days} days from the submission date.`,
      `Delivery will be completed within ${delivery_days} days from Purchase Order.`
    ];
    
    confirmations.forEach((text, i) => {
      doc.text(`${i + 1}. ${text}`, { indent: 20 });
    });
    
    doc.moveDown();
    
    // Bid Summary Table
    if (bid_items && bid_items.length > 0) {
      doc.font('Helvetica-Bold').text('BID SUMMARY:', { underline: true });
      doc.moveDown(0.5);
      
      // Table header
      const tableTop = doc.y;
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('S.No', 50, tableTop, { width: 30 });
      doc.text('Description', 85, tableTop, { width: 250 });
      doc.text('Qty', 340, tableTop, { width: 40 });
      doc.text('Unit Price', 385, tableTop, { width: 70 });
      doc.text('Total', 460, tableTop, { width: 80 });
      
      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      
      // Table rows
      doc.font('Helvetica').fontSize(9);
      let y = doc.y + 5;
      bid_items.forEach((item, i) => {
        doc.text(`${i + 1}`, 50, y, { width: 30 });
        doc.text(item.description || item.sku || 'Cable', 85, y, { width: 250 });
        doc.text(`${item.quantity || 1} km`, 340, y, { width: 40 });
        doc.text(`INR ${(item.unit_price || 0).toLocaleString('en-IN')}`, 385, y, { width: 70 });
        doc.text(`INR ${(item.total_price || item.unit_price * item.quantity || 0).toLocaleString('en-IN')}`, 460, y, { width: 80 });
        y += 20;
      });
      
      doc.moveTo(50, y).lineTo(545, y).stroke();
      
      // Total
      doc.font('Helvetica-Bold');
      doc.text('TOTAL BID VALUE:', 340, y + 5, { width: 115 });
      doc.text(`INR ${total_value.toLocaleString('en-IN')}`, 460, y + 5, { width: 80 });
    }
    
    doc.moveDown(3);
    
    // Closing
    doc.fontSize(11).font('Helvetica').text(
      'We look forward to your favorable consideration and assure you of our best services.',
      { align: 'justify' }
    );
    doc.moveDown(2);
    
    doc.text('Thanking you,');
    doc.moveDown();
    doc.text('Yours faithfully,');
    doc.moveDown(2);
    
    // Signature block
    doc.text('_____________________________');
    doc.text('Authorized Signatory');
    doc.text(vendor_name);
    doc.moveDown();
    doc.text('[Company Seal]');
    
    doc.end();
  });
}

/**
 * Generate a filled bid response form PDF
 * @param {Object} params - Form parameters
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function generateBidResponseForm(params) {
  const {
    rfp_reference = 'RFP-XXX',
    rfp_title = 'Supply of Cables',
    buyer_name = 'Buyer Organization',
    vendor = {},
    technical_offer = {},
    commercial_offer = {},
    declarations = []
  } = params;
  
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
    
    // Header
    doc.rect(0, 0, 595, 60).fill('#003366');
    doc.fill('white').fontSize(16).text('BID RESPONSE FORM', 50, 20, { align: 'center' });
    doc.fontSize(11).text(`Reference: ${rfp_reference}`, 50, 42, { align: 'center' });
    
    doc.fill('black');
    let y = 80;
    
    // Section A: Bidder Information
    doc.fontSize(12).font('Helvetica-Bold').text('SECTION A: BIDDER INFORMATION', 50, y);
    y += 20;
    
    doc.fontSize(10).font('Helvetica');
    const bidderFields = [
      ['Company Name', vendor.company_name || '_'.repeat(40)],
      ['Registered Address', vendor.address || '_'.repeat(40)],
      ['GST Number', vendor.gst || '_'.repeat(30)],
      ['PAN Number', vendor.pan || '_'.repeat(30)],
      ['Contact Person', vendor.contact_person || '_'.repeat(30)],
      ['Contact Email', vendor.email || '_'.repeat(30)],
      ['Contact Phone', vendor.phone || '_'.repeat(30)]
    ];
    
    bidderFields.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').text(`${label}:`, 50, y, { continued: true, width: 150 });
      doc.font('Helvetica').text(` ${value}`);
      y += 18;
    });
    
    y += 15;
    
    // Section B: Technical Offer
    doc.fontSize(12).font('Helvetica-Bold').text('SECTION B: TECHNICAL OFFER', 50, y);
    y += 20;
    
    doc.fontSize(10).font('Helvetica');
    const technicalFields = [
      ['Offered Product', technical_offer.product_description || '_'.repeat(40)],
      ['Manufacturer/OEM', technical_offer.manufacturer || '_'.repeat(30)],
      ['SKU/Model Number', technical_offer.sku || '_'.repeat(30)],
      ['Spec Compliance', technical_offer.compliance || 'Yes / No'],
      ['Deviations (if any)', technical_offer.deviations || 'None']
    ];
    
    technicalFields.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').text(`${label}:`, 50, y, { continued: true, width: 150 });
      doc.font('Helvetica').text(` ${value}`);
      y += 18;
    });
    
    y += 15;
    
    // Section C: Commercial Offer
    doc.fontSize(12).font('Helvetica-Bold').text('SECTION C: COMMERCIAL OFFER', 50, y);
    y += 20;
    
    doc.fontSize(10).font('Helvetica');
    const commercialFields = [
      ['Unit Price (per km)', commercial_offer.unit_price ? `INR ${commercial_offer.unit_price.toLocaleString('en-IN')}` : '_'.repeat(20)],
      ['Quantity Offered', commercial_offer.quantity || '_'.repeat(20)],
      ['Total Price', commercial_offer.total_price ? `INR ${commercial_offer.total_price.toLocaleString('en-IN')}` : '_'.repeat(20)],
      ['GST Rate', commercial_offer.gst_rate || '18%'],
      ['Delivery Period', commercial_offer.delivery_days ? `${commercial_offer.delivery_days} days` : '_'.repeat(15)],
      ['Payment Terms', commercial_offer.payment_terms || 'As per RFP'],
      ['Bid Validity', commercial_offer.validity_days ? `${commercial_offer.validity_days} days` : '90 days']
    ];
    
    commercialFields.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').text(`${label}:`, 50, y, { continued: true, width: 150 });
      doc.font('Helvetica').text(` ${value}`);
      y += 18;
    });
    
    y += 15;
    
    // Section D: Declarations
    doc.fontSize(12).font('Helvetica-Bold').text('SECTION D: DECLARATIONS', 50, y);
    y += 20;
    
    doc.fontSize(10).font('Helvetica');
    const defaultDeclarations = [
      'We confirm that we are not blacklisted by any Government department.',
      'We confirm that all information provided is true and accurate.',
      'We agree to all terms and conditions mentioned in this tender.'
    ];
    
    (declarations.length > 0 ? declarations : defaultDeclarations).forEach((decl, i) => {
      const checked = typeof decl === 'object' ? (decl.checked ? '[X]' : '[ ]') : '[X]';
      const text = typeof decl === 'object' ? decl.text : decl;
      doc.text(`${checked} ${text}`, 50, y, { width: 495 });
      y += 20;
    });
    
    y += 30;
    
    // Signature
    doc.font('Helvetica-Bold').text('Authorized Signatory:', 50, y);
    y += 30;
    doc.font('Helvetica').text('_____________________________', 50, y);
    y += 15;
    doc.text('Name: ' + (vendor.signatory_name || '_'.repeat(25)), 50, y);
    y += 15;
    doc.text('Designation: ' + (vendor.designation || '_'.repeat(25)), 50, y);
    y += 15;
    doc.text('Date: ' + new Date().toLocaleDateString('en-IN'), 50, y);
    y += 30;
    doc.text('[Company Seal]', 50, y);
    
    doc.end();
  });
}

/**
 * Check Adobe PDF Services availability and provide status
 * @returns {Object} Status object
 */
export function getServiceStatus() {
  return {
    configured: !!(ADOBE_CLIENT_ID && ADOBE_CLIENT_SECRET),
    client_id_set: !!ADOBE_CLIENT_ID,
    client_secret_set: !!ADOBE_CLIENT_SECRET,
    fallback_available: true,  // PDFKit is always available
    message: ADOBE_CLIENT_ID && ADOBE_CLIENT_SECRET 
      ? 'Adobe PDF Services is configured' 
      : 'Using local PDFKit for PDF generation (Adobe credentials not set)'
  };
}

export default {
  getAccessToken,
  uploadAsset,
  extractPDFContent,
  generateDocument,
  isAvailable,
  generateCoverLetter,
  generateBidResponseForm,
  getServiceStatus
};


