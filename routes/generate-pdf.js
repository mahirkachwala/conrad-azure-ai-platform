/**
 * PDF Generation Route - Adaptive Template System
 * Generates PDFs based on learned document templates
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// Load document knowledge for templates
function loadDocumentKnowledge() {
  const knowledgePath = path.join(__dirname, '../data/document_knowledge.json');
  if (fs.existsSync(knowledgePath)) {
    return JSON.parse(fs.readFileSync(knowledgePath, 'utf-8'));
  }
  return { templates: [], sections: [] };
}

/**
 * GET /api/generate-pdf
 * Generate a PDF based on learned template
 */
router.get('/', async (req, res) => {
  try {
    const { company, template } = req.query;
    
    if (!company) {
      return res.status(400).json({ success: false, error: 'Company name required' });
    }
    
    const knowledge = loadDocumentKnowledge();
    
    // Generate HTML content for PDF
    const htmlContent = generateDocumentHTML(company, template, knowledge);
    
    // For now, return HTML that can be printed as PDF
    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
    
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Generate HTML document based on template
 */
function generateDocumentHTML(company, templateName, knowledge) {
  const date = new Date().toLocaleDateString('en-IN', { 
    day: '2-digit', month: 'long', year: 'numeric' 
  });
  
  const refNumber = `${company.replace(/\s+/g, '-').toUpperCase()}-${Date.now().toString().slice(-6)}`;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Generated Document - ${company}</title>
  <style>
    @media print {
      body { margin: 0; padding: 20mm; }
      .no-print { display: none; }
    }
    body {
      font-family: 'Times New Roman', serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
      line-height: 1.6;
      color: #333;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #333;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      text-transform: uppercase;
    }
    .header p {
      margin: 5px 0;
      color: #666;
    }
    .meta-info {
      display: flex;
      justify-content: space-between;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .section {
      margin-bottom: 25px;
    }
    .section h2 {
      font-size: 16px;
      border-bottom: 1px solid #ccc;
      padding-bottom: 5px;
      margin-bottom: 15px;
    }
    .section p {
      text-align: justify;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    th, td {
      border: 1px solid #333;
      padding: 10px;
      text-align: left;
    }
    th {
      background: #f5f5f5;
    }
    .signature-block {
      margin-top: 60px;
      display: flex;
      justify-content: space-between;
    }
    .signature {
      width: 40%;
    }
    .signature-line {
      border-top: 1px solid #333;
      margin-top: 60px;
      padding-top: 5px;
    }
    .print-btn {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4a90d9;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
    }
    .print-btn:hover {
      background: #357abd;
    }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
  
  <div class="header">
    <h1>${company}</h1>
    <p>Official Document</p>
    <p>Generated using ConRad Adaptive Template System</p>
  </div>
  
  <div class="meta-info">
    <div>
      <strong>Reference No:</strong> ${refNumber}<br>
      <strong>Date:</strong> ${date}
    </div>
    <div style="text-align: right;">
      <strong>Template:</strong> ${templateName || 'Standard Format'}<br>
      <strong>Status:</strong> Draft
    </div>
  </div>
  
  <div class="section">
    <h2>1. Introduction</h2>
    <p>This document has been generated for <strong>${company}</strong> based on the learned template structure. 
    The content follows the format and sections identified from previously analyzed documents.</p>
  </div>
  
  <div class="section">
    <h2>2. Scope of Work</h2>
    <p>[This section contains the scope of work as per the learned template. 
    Please fill in the specific requirements for ${company}.]</p>
    <table>
      <thead>
        <tr>
          <th>S.No.</th>
          <th>Description</th>
          <th>Quantity</th>
          <th>Unit</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>[Item Description]</td>
          <td>[Qty]</td>
          <td>[Unit]</td>
          <td>[Remarks]</td>
        </tr>
        <tr>
          <td>2</td>
          <td>[Item Description]</td>
          <td>[Qty]</td>
          <td>[Unit]</td>
          <td>[Remarks]</td>
        </tr>
      </tbody>
    </table>
  </div>
  
  <div class="section">
    <h2>3. Terms & Conditions</h2>
    <p>Standard terms and conditions apply as per ${company} policies and the learned template format.</p>
    <ul>
      <li>All specifications must comply with applicable standards</li>
      <li>Delivery as per mutually agreed schedule</li>
      <li>Payment terms as per company policy</li>
      <li>Warranty and support as specified</li>
    </ul>
  </div>
  
  <div class="section">
    <h2>4. Contact Information</h2>
    <p><strong>Organization:</strong> ${company}</p>
    <p><strong>Email:</strong> procurement@${company.toLowerCase().replace(/\s+/g, '')}.com</p>
    <p><strong>Generated By:</strong> ConRad AI System</p>
  </div>
  
  <div class="signature-block">
    <div class="signature">
      <div class="signature-line">
        <strong>Authorized Signatory</strong><br>
        ${company}
      </div>
    </div>
    <div class="signature">
      <div class="signature-line">
        <strong>Accepted By</strong><br>
        [Vendor/Party Name]
      </div>
    </div>
  </div>
  
  <p style="text-align: center; margin-top: 40px; color: #999; font-size: 12px;">
    Document generated by ConRad Adaptive AI System | ${new Date().toISOString()}
  </p>
</body>
</html>
  `;
}

export default router;



