/**
 * PDF Routes
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Handles PDF upload, parsing, and analysis using Gemini AI and OpenCorporates
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pdfParser from '../services/pdf-parser.js';
import submissionAgent from '../agentic/agents/submission.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

/**
 * POST /api/pdf/upload
 * Upload and parse a PDF document
 */
router.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No PDF file uploaded'
      });
    }

    const filePath = req.file.path;
    const verifyCompany = req.body.verify_company !== 'false';

    console.log(`📄 Processing PDF: ${req.file.originalname}`);

    // Parse the PDF with AI enhancement and optional company verification
    const result = await pdfParser.parseRFPComplete(filePath, verifyCompany);

    // Clean up uploaded file after processing
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.log('Could not delete temp file:', e.message);
    }

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        filename: req.file.originalname
      });
    }

    res.json({
      success: true,
      filename: req.file.originalname,
      extraction_method: result.extraction_method,
      summary: result.summary,
      num_pages: result.num_pages,
      message: `PDF parsed successfully using ${result.extraction_method}`
    });

  } catch (error) {
    console.error('PDF upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/pdf/analyze
 * Analyze any PDF document (generic analysis)
 */
router.post('/analyze', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No PDF file uploaded'
      });
    }

    const filePath = req.file.path;
    console.log(`🔍 Analyzing document: ${req.file.originalname}`);

    const result = await pdfParser.analyzeDocument(filePath);

    // Clean up
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.log('Could not delete temp file:', e.message);
    }

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      filename: req.file.originalname,
      analysis: result.analysis,
      raw_text_preview: result.raw_text
    });

  } catch (error) {
    console.error('PDF analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/pdf/parse-rfp
 * Parse an RFP PDF and extract structured data with AI
 */
router.post('/parse-rfp', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No PDF file uploaded'
      });
    }

    const filePath = req.file.path;
    const generateSubmissionPlan = req.body.generate_submission !== 'false';

    console.log(`📋 Parsing RFP: ${req.file.originalname}`);

    // Full RFP parsing with company verification
    const parseResult = await pdfParser.parseRFPComplete(filePath, true);

    // Clean up
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.log('Could not delete temp file:', e.message);
    }

    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: parseResult.error
      });
    }

    const response = {
      success: true,
      filename: req.file.originalname,
      extraction_method: parseResult.extraction_method,
      rfp_summary: parseResult.summary,
      num_pages: parseResult.num_pages
    };

    // Optionally generate submission plan
    if (generateSubmissionPlan && parseResult.summary) {
      const submissionPlan = await submissionAgent.processSubmission(
        parseResult.summary,
        null, // technical match will be added later
        null, // pricing will be added later
        {} // default bidder info
      );
      response.submission_plan = submissionPlan;
    }

    res.json(response);

  } catch (error) {
    console.error('RFP parsing error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/pdf/submission-plan
 * Generate submission plan for a given RFP summary
 */
router.post('/submission-plan', async (req, res) => {
  try {
    const { rfp_summary, technical_match, pricing, bidder_info } = req.body;

    if (!rfp_summary) {
      return res.status(400).json({
        success: false,
        error: 'rfp_summary is required'
      });
    }

    console.log(`📝 Generating submission plan for: ${rfp_summary.rfp_id}`);

    const submissionPlan = await submissionAgent.processSubmission(
      rfp_summary,
      technical_match || null,
      pricing || null,
      bidder_info || {}
    );

    res.json({
      success: true,
      submission_plan: submissionPlan
    });

  } catch (error) {
    console.error('Submission plan error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pdf/ai-status
 * Check which AI providers are available for PDF parsing
 */
router.get('/ai-status', (req, res) => {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const provider = process.env.PDF_AI_PROVIDER || 'auto';
  
  res.json({
    success: true,
    ai_providers: {
      gemini: {
        available: hasGemini,
        model: 'gemini-2.0-flash'
      },
      openai: {
        available: hasOpenAI,
        model: 'gpt-4o-mini'
      }
    },
    preferred_provider: provider,
    fallback_available: hasGemini || hasOpenAI,
    pattern_matching_fallback: true,
    message: hasGemini || hasOpenAI 
      ? `AI parsing available (${hasGemini ? 'Gemini' : ''}${hasGemini && hasOpenAI ? ' + ' : ''}${hasOpenAI ? 'OpenAI' : ''})`
      : 'No AI providers configured, using pattern matching only'
  });
});

/**
 * GET /api/pdf/submission-modes
 * Get available submission modes and their descriptions
 */
router.get('/submission-modes', (req, res) => {
  res.json({
    success: true,
    modes: {
      EMAIL_FORM: {
        name: 'Email Form Submission',
        description: 'Fill the bid response form (e.g., Annexure-B) inside the RFP PDF and email it to the specified address',
        requires_print: false,
        requires_courier: false,
        digital_submission: true
      },
      LETTER_COURIER: {
        name: 'Physical Letter/Courier',
        description: 'Print bid documents on company letterhead and courier to the physical address',
        requires_print: true,
        requires_courier: true,
        digital_submission: false
      },
      EXTERNAL_PORTAL: {
        name: 'External Portal Registration',
        description: 'Register on a separate vendor portal and submit bid documents online',
        requires_print: false,
        requires_courier: false,
        digital_submission: true
      },
      MEETING_EMAIL: {
        name: 'Pre-bid Meeting Request',
        description: 'Email to schedule a pre-bid meeting before formal submission',
        requires_print: false,
        requires_courier: false,
        digital_submission: true
      }
    }
  });
});

/**
 * POST /api/pdf/parse-url
 * Parse a PDF from a URL (for RFPs stored in public/rfps/)
 */
router.post('/parse-url', async (req, res) => {
  try {
    const { pdf_url } = req.body;

    if (!pdf_url) {
      return res.status(400).json({
        success: false,
        error: 'pdf_url is required'
      });
    }

    // Handle local URLs (relative to public folder)
    let filePath;
    if (pdf_url.startsWith('/rfps/') || pdf_url.startsWith('rfps/')) {
      const relativePath = pdf_url.replace(/^\//, '');
      filePath = path.join(__dirname, '../public', relativePath);
    } else if (pdf_url.startsWith('http')) {
      // For remote URLs, we'd need to download first
      return res.status(400).json({
        success: false,
        error: 'Remote URL parsing not yet implemented. Use local paths starting with /rfps/'
      });
    } else {
      filePath = path.join(__dirname, '../public', pdf_url);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: `PDF not found at path: ${pdf_url}`
      });
    }

    console.log(`📄 Parsing PDF from URL: ${pdf_url}`);

    const result = await pdfParser.parseRFPComplete(filePath, true);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      pdf_url,
      extraction_method: result.extraction_method,
      summary: result.summary,
      num_pages: result.num_pages
    });

  } catch (error) {
    console.error('PDF URL parsing error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/pdf/generate-submission
 * Generate complete submission package based on RFP data and submission mode
 */
router.post('/generate-submission', async (req, res) => {
  try {
    const { rfp_id, rfp_data, bidder_info } = req.body;

    if (!rfp_id) {
      return res.status(400).json({
        success: false,
        error: 'rfp_id is required'
      });
    }

    console.log(`📦 Generating submission package for: ${rfp_id}`);

    // If rfp_data not provided, try to load from portals
    let rfpSummary = rfp_data;
    if (!rfpSummary || !rfpSummary.submission) {
      // Load from all-portals.json
      const allPortalsPath = path.join(__dirname, '../public/data/all-portals.json');
      if (fs.existsSync(allPortalsPath)) {
        const allPortals = JSON.parse(fs.readFileSync(allPortalsPath, 'utf-8'));
        const foundRfp = allPortals.find(t => t.tender_id === rfp_id);
        if (foundRfp) {
          rfpSummary = {
            ...foundRfp,
            rfp_id: foundRfp.tender_id,
            buyer_name: foundRfp.organisation,
            project_name: foundRfp.title,
            due_date: foundRfp.due_date,
            estimated_value: foundRfp.estimated_cost_inr
          };
        }
      }
    }

    if (!rfpSummary) {
      return res.status(404).json({
        success: false,
        error: `RFP ${rfp_id} not found`
      });
    }

    // Generate submission plan using submission agent
    const submissionPlan = await submissionAgent.processSubmission(
      rfpSummary,
      null, // technical match
      null, // pricing
      bidder_info || {}
    );

    res.json({
      success: true,
      rfp_id,
      submission_plan: submissionPlan
    });

  } catch (error) {
    console.error('Submission generation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/pdf/generate-letter
 * Generate a printable PDF letter for LETTER_COURIER submission mode
 */
router.post('/generate-letter', async (req, res) => {
  try {
    const { rfp_id, letter_content } = req.body;

    if (!letter_content) {
      return res.status(400).json({
        success: false,
        error: 'letter_content is required'
      });
    }

    console.log(`🖨️ Generating letter PDF for: ${rfp_id}`);

    // Dynamic import PDFKit
    const PDFDocument = (await import('pdfkit')).default;
    
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="bid-letter-${rfp_id}.pdf"`);
      res.send(pdfBuffer);
    });

    // Letterhead
    doc.fontSize(16).font('Helvetica-Bold').text(letter_content.letterhead?.company_name || 'Company Name', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(letter_content.letterhead?.address || '', { align: 'center' });
    doc.text(`Tel: ${letter_content.letterhead?.phone || ''} | Email: ${letter_content.letterhead?.email || ''}`, { align: 'center' });
    doc.text(`GST: ${letter_content.letterhead?.gst || ''}`, { align: 'center' });
    doc.moveDown(2);

    // Horizontal line
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    // Date and Reference
    doc.fontSize(11).text(`Date: ${letter_content.date || new Date().toLocaleDateString()}`, { align: 'right' });
    doc.text(`Ref: ${letter_content.reference || ''}`, { align: 'right' });
    doc.moveDown();

    // To address
    doc.font('Helvetica-Bold').text('To,');
    doc.font('Helvetica');
    doc.text(letter_content.to?.designation || '');
    doc.text(letter_content.to?.organization || '');
    doc.text(letter_content.to?.address || '');
    doc.moveDown();

    // Subject
    doc.font('Helvetica-Bold').text(`Subject: ${letter_content.subject || ''}`);
    doc.moveDown();

    // Body
    doc.font('Helvetica').fontSize(10);
    const bodyLines = (letter_content.body || '').split('\n');
    bodyLines.forEach(line => {
      doc.text(line, { align: 'justify' });
    });
    doc.moveDown(2);

    // Enclosures
    if (letter_content.enclosures && letter_content.enclosures.length > 0) {
      doc.font('Helvetica-Bold').text('Enclosures:');
      doc.font('Helvetica');
      letter_content.enclosures.forEach((enc, i) => {
        doc.text(`${i + 1}. ${enc}`);
      });
    }

    doc.end();

  } catch (error) {
    console.error('Letter PDF generation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pdf/rfp/:tenderId
 * Serve the correct RFP PDF (uploaded version if available, otherwise original)
 */
router.get('/rfp/:tenderId', async (req, res) => {
  try {
    const { tenderId } = req.params;
    
    // Import uploaded-pdf-store dynamically
    const { getPdfPath } = await import('../services/uploaded-pdf-store.js');
    
    // Check for uploaded PDF first
    const pdfInfo = getPdfPath(tenderId);
    
    if (pdfInfo && pdfInfo.path && fs.existsSync(pdfInfo.path)) {
      console.log(`📄 Serving UPLOADED PDF for ${tenderId}: ${pdfInfo.originalName}`);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${pdfInfo.originalName}"`);
      return res.sendFile(pdfInfo.path);
    }
    
    // Fall back to original PDF
    const originalPath = path.join(__dirname, '../public/rfps', `${tenderId}.pdf`);
    
    if (fs.existsSync(originalPath)) {
      console.log(`📄 Serving ORIGINAL PDF for ${tenderId}`);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${tenderId}.pdf"`);
      return res.sendFile(originalPath);
    }
    
    res.status(404).json({ error: `PDF not found for ${tenderId}` });
    
  } catch (error) {
    console.error('Error serving PDF:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

