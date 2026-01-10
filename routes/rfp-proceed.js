/**
 * RFP PROCEED API ROUTES
 * 
 * Handles "Proceed with RFP" workflow:
 * - Analyze RFP and generate quotation
 * - Generate submission packages for all 4 modes
 * - Generate testing emails
 * - Generate PDF documents
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import { analyzeRFP, generateSubmissionPackage, generateTestingEmail, COMPANY_PRESET } from '../services/rfp-analysis-service.js';
import { analyzeRFPById, analyzeRFPDynamically } from '../services/dynamic-rfp-analyzer.js';
import { getExtractedData, hasUploadedPdf } from '../services/uploaded-pdf-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Parse cable requirements from extracted data
 * Uses the structured data from AI extraction
 */
function parseCableRequirementsFromAnalysis(analysisText, rawData) {
  console.log(`   🔍 Parsing cable requirements...`);
  console.log(`   📊 Raw data cable_requirements:`, JSON.stringify(rawData?.cable_requirements, null, 2));
  
  // PRIORITY 1: Use structured cable_requirements from AI extraction
  if (rawData?.cable_requirements && Array.isArray(rawData.cable_requirements)) {
    console.log(`   ✅ Found ${rawData.cable_requirements.length} cables in structured data`);
    return rawData.cable_requirements.map((cable, idx) => ({
      item_no: cable.item_no || idx + 1,
      description: cable.description || `${cable.voltage || ''} ${cable.cable_type || 'Cable'} ${cable.cores || ''} x ${cable.size_sqmm || ''} sqmm`.trim(),
      cable_type: cable.cable_type || 'Cable',
      voltage: cable.voltage || '',
      cores: cable.cores || '',
      size_sqmm: cable.size_sqmm || '',
      conductor: cable.conductor || 'Copper',
      qty_km: parseFloat(cable.qty_km) || 0
    }));
  }
  
  // PRIORITY 2: Parse from analysis text (fallback)
  const cables = [];
  if (analysisText) {
    console.log(`   ⚠️ No structured data, parsing from text...`);
    
    // Multiple patterns to catch different formats
    const patterns = [
      // "Item 1: 6.6kV HT Cable... - 5 km"
      /Item\s*(\d+)[:\-\s]+([^\n]+?)(?:\s*[-–]\s*|\s+)(\d+(?:\.\d+)?)\s*(?:km|kilometer)/gi,
      // "1. 6.6kV HT Cable... 5 km"
      /(\d+)\.\s*([^\n]+?)(?:\s+)(\d+(?:\.\d+)?)\s*(?:km|kilometer)/gi,
      // "6.6kV HT Cable (5 km)" or "HT Cable: 5 km"
      /([A-Z][\w\s]+Cable[^\n]*?)\s*[:(-]\s*(\d+(?:\.\d+)?)\s*(?:km|kilometer)/gi
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(analysisText)) !== null) {
        if (match.length >= 3) {
          const itemNo = match.length === 4 ? parseInt(match[1]) : cables.length + 1;
          async function handleAnalyzeRequest(req, res) {
            try {
              const { tenderId, rfpData, useDynamicParsing = true } = req.body || {};

              console.log(`\n🚀 [RFP Proceed] Analyzing tender: ${tenderId}`);

              // STEP 1: Load base tender data from JSON (always needed for fallback fields)
              let tender = rfpData;
              if (tenderId && !rfpData) {
                tender = loadTenderById(tenderId);
              }

              if (!tender && !tenderId) {
                return res.status(400).json({
                  success: false,
                  error: 'Either tenderId or rfpData is required'
                });
              }

              // STEP 2: If dynamic parsing is enabled and a tenderId is provided,
              // analyze the actual PDF (uploaded or original) to ensure ANY PDF is parsed.
              if (tenderId && useDynamicParsing) {
                console.log(`   📄 Dynamic parsing enabled for ${tenderId} - analyzing actual PDF`);
                const pdfAnalysis = await analyzeRFPById(tenderId);

                if (pdfAnalysis && pdfAnalysis.success) {
                  return res.json({
                    success: true,
                    analysis_method: 'DYNAMIC_PDF',
                    source: pdfAnalysis.pdf_source || 'PDF',
                    ...pdfAnalysis
                  });
                } else {
                  // If dynamic parsing failed, fall back to stored uploaded data or JSON
                  console.warn(`   ⚠️ Dynamic PDF analysis failed for ${tenderId}:`, pdfAnalysis?.error || 'unknown');
                  // continue to check stored uploaded data or JSON below
                }
              }

              // STEP 2: Check if there's an UPLOADED PDF for this tender
              // If user uploaded an edited PDF, use that data instead!
              const uploadedData = tenderId ? getExtractedData(tenderId) : null;

              if (uploadedData) {
                console.log(`\n   ════════════════════════════════════════════════════`);
                console.log(`   📥 FOUND UPLOADED PDF DATA for ${tenderId}!`);
                console.log(`   📊 Using data from user's uploaded PDF instead of JSON`);
                console.log(`   ════════════════════════════════════════════════════`);

                // Parse the uploaded PDF's analysis
                const analysisText = uploadedData.analysis_text || '';
                const rawData = uploadedData.raw_data || {};

                // DEBUG: Log what we have from extraction
                console.log(`\n   🔍 DEBUG: raw_data.cable_requirements =`, JSON.stringify(rawData?.cable_requirements, null, 2));
                console.log(`   🔍 DEBUG: raw_data.testing_requirements =`, JSON.stringify(rawData?.testing_requirements, null, 2));
                console.log(`   🔍 DEBUG: raw_data.external_testing_required =`, rawData?.external_testing_required);

                // Build cable requirements from uploaded data
                const parsedCables = parseCableRequirementsFromAnalysis(analysisText, rawData);
                console.log(`   📦 Parsed ${parsedCables.length} cables from uploaded PDF`);

                // Build testing requirements
                const parsedTests = parseTestingFromAnalysis(analysisText, rawData);
                console.log(`   🧪 Parsed ${parsedTests.length} tests from uploaded PDF`);

                // Check for external testing
                const externalTesting = parseExternalTestingFromAnalysis(analysisText, rawData);
                console.log(`   🔬 External testing required: ${externalTesting}`);

                // Get submission mode
                const submissionMode = parseSubmissionModeFromAnalysis(analysisText, rawData);
                console.log(`   📤 Submission mode: ${submissionMode}`);

                // Parse additional fields
                const parsedTerms = parseTermsFromAnalysis(rawData);
                const parsedDueDate = parseDueDateFromAnalysis(rawData);

                // Merge with base tender data (UPLOADED PDF data takes PRIORITY)
                const mergedTender = {
                  ...(tender || {}),
                  tender_id: tenderId,
                  organisation: uploadedData.organisation || rawData?.organisation || tender?.organisation,
                  title: uploadedData.title || rawData?.title || tender?.title,
                  // Due date from uploaded PDF takes priority!
                  due_date: parsedDueDate || uploadedData.due_date || tender?.due_date,
                  city: uploadedData.city || rawData?.city || tender?.city,
                  estimated_cost: uploadedData.estimated_cost || rawData?.estimated_cost_inr || tender?.estimated_cost,
                  // Cable requirements from uploaded PDF (with correct quantities!)
                  cable_requirements: parsedCables.length > 0 ? parsedCables : (tender?.cable_requirements || []),
                  // Testing from uploaded PDF
                  tests_required: parsedTests.length > 0 ? parsedTests : (tender?.tests_required || []),
                  external_testing_required: externalTesting,
                  // Submission mode from uploaded PDF
                  submission: {
                    mode: submissionMode,
                    email: rawData?.submission_email || rawData?.contact_email || tender?.submission?.email,
                    ...(tender?.submission || {})
                  },
                  // Terms from uploaded PDF
                  terms: {
                    delivery: parsedTerms.delivery || tender?.terms?.delivery,
                    payment: parsedTerms.payment || tender?.terms?.payment,
                    warranty: parsedTerms.warranty || tender?.terms?.warranty,
                    ...(tender?.terms || {})
                  }
                };

                // Normalise common field names to avoid undefined lookups in other modules
                // Provide multiple aliases used across the codebase so UI and routes don't see undefined
                mergedTender.submission = mergedTender.submission || {};
                // ensure both .mode and .submission_mode are available
                mergedTender.submission.mode = mergedTender.submission.mode || submissionMode;
                mergedTender.submission.submission_mode = mergedTender.submission.submission_mode || mergedTender.submission.mode;
                // email variants
                mergedTender.submission.email = mergedTender.submission.email || mergedTender.submission.submission_email || mergedTender.submission.email || mergedTender.submission.submissionEmail || mergedTender.submission_email || rawData?.submission_email || rawData?.contact_email || tender?.submission?.email;
                mergedTender.submission.submission_email = mergedTender.submission.submission_email || mergedTender.submission.email;
                // address variants
                mergedTender.submission.submission_address = mergedTender.submission.submission_address || mergedTender.submission.submissionAddress || tender?.submission?.submission_address || tender?.submission_address || rawData?.submission_address;
                // external testing flags - ensure consistent boolean
                mergedTender.external_testing_required = !!mergedTender.external_testing_required || !!rawData?.external_testing_required || false;
                mergedTender.tests_required = mergedTender.tests_required || mergedTender.testing_requirements || tender?.tests_required || tender?.testing_requirements || [];

                console.log(`\n   ═══════════════════════════════════════`);
                console.log(`   📊 MERGED TENDER DATA (from uploaded PDF):`);
                console.log(`   ═══════════════════════════════════════`);
                console.log(`   📋 Tender ID: ${mergedTender.tender_id}`);
                console.log(`   🏢 Organisation: ${mergedTender.organisation}`);
                console.log(`   📅 Due Date: ${mergedTender.due_date}`);
                console.log(`   📦 Cable Requirements: ${mergedTender.cable_requirements.length} items`);
                mergedTender.cable_requirements.forEach((c, i) => {
                  console.log(`      Item ${i+1}: ${c.description || c.cable_type} - ${c.qty_km} km`);
                });
                console.log(`   🧪 Tests Required: ${mergedTender.tests_required.length}`);
                console.log(`   🔬 External Testing: ${mergedTender.external_testing_required}`);
                console.log(`   📤 Submission Mode: ${mergedTender.submission.mode}`);
                console.log(`   ═══════════════════════════════════════\n`);

                // Analyze using merged data
                const analysis = analyzeRFP(mergedTender);

                return res.json({
                  success: true,
                  analysis_method: 'UPLOADED_PDF',
                  source: 'User uploaded PDF',
                  ...analysis
                });
              }

              // STEP 3: No uploaded PDF data used - use original JSON-based analysis
              console.log(`   📋 No uploaded PDF data used, using JSON data (if provided)`);

              if (!tender) {
                return res.status(404).json({
                  success: false,
                  error: `Tender ${tenderId} not found`
                });
              }

              // Analyze RFP using original method (JSON-based analysis)
              const analysis = analyzeRFP(tender);

              res.json({
                success: true,
                analysis_method: 'JSON_BASED',
                ...analysis
              });

            } catch (error) {
              console.error('[RFP Proceed] Error:', error);
              res.status(500).json({
                success: false,
                error: error.message
              });
            }
          }

          // POST handler
          router.post('/analyze', handleAnalyzeRequest);

          // Allow GET for convenience (e.g., browser) — maps query params to body
          router.get('/analyze', async (req, res) => {
            // Map query parameters to expected POST body
            const { tenderId, useDynamicParsing = 'true', rfpData } = req.query;
            try {
              req.body = {
                tenderId,
                useDynamicParsing: useDynamicParsing === 'true' || useDynamicParsing === '1',
                rfpData: rfpData ? JSON.parse(rfpData) : undefined
              };
            } catch (e) {
              // if parsing fails, ignore rfpData
              req.body = { tenderId, useDynamicParsing: useDynamicParsing === 'true' || useDynamicParsing === '1' };
            }
            return handleAnalyzeRequest(req, res);
          });
  /**
 * Parse due date from extracted data
 */
function parseDueDateFromAnalysis(rawData) {
  if (rawData?.due_date) {
    console.log(`   📅 Due date: ${rawData.due_date} (from extracted data)`);
    return rawData.due_date;
  }
  return null;
}

/**
 * Load tender data by ID (fallback for basic info)
 */
function loadTenderById(tenderId) {
  const portalFiles = ['gov.json', 'industrial.json', 'utilities.json'];
  
  for (const file of portalFiles) {
    const filePath = path.join(__dirname, '../public/data/portals', file);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const tender = data.find(t => t.tender_id === tenderId);
      if (tender) return tender;
    }
  }
  
  return null;
}

/**
 * POST /api/rfp-proceed/analyze
 * DYNAMIC RFP Analysis - Parses the ACTUAL PDF file
 * 
 * This endpoint now:
 * 1. Reads the actual PDF from public/rfps/{tenderId}.pdf
 * 2. Extracts ALL data dynamically using AI
 * 3. Matches cables to CSVs, calculates material cost
 * 4. Matches tests to testing.csv, calculates testing cost
 * 5. Returns complete quotation
 */
router.post('/analyze', async (req, res) => {
  try {
    const { tenderId, rfpData, useDynamicParsing = true } = req.body;
    
    console.log(`\n🚀 [RFP Proceed] Analyzing tender: ${tenderId}`);
    
    // STEP 1: Load base tender data from JSON (always needed for fallback fields)
    let tender = rfpData;
    if (tenderId && !rfpData) {
      tender = loadTenderById(tenderId);
    }
    
    if (!tender && !tenderId) {
      return res.status(400).json({
        success: false,
        error: 'Either tenderId or rfpData is required'
      });
    }
    
    // STEP 2: If dynamic parsing is enabled and a tenderId is provided,
    // analyze the actual PDF (uploaded or original) to ensure ANY PDF is parsed.
    if (tenderId && useDynamicParsing) {
      console.log(`   📄 Dynamic parsing enabled for ${tenderId} - analyzing actual PDF`);
      const pdfAnalysis = await analyzeRFPById(tenderId);

      if (pdfAnalysis && pdfAnalysis.success) {
        return res.json({
          success: true,
          analysis_method: 'DYNAMIC_PDF',
          source: pdfAnalysis.pdf_source || 'PDF',
          ...pdfAnalysis
        });
      } else {
        // If dynamic parsing failed, fall back to stored uploaded data or JSON
        console.warn(`   ⚠️ Dynamic PDF analysis failed for ${tenderId}:`, pdfAnalysis?.error || 'unknown');
        // continue to check stored uploaded data or JSON below
      }
    }

    // STEP 2: Check if there's an UPLOADED PDF for this tender
    // If user uploaded an edited PDF, use that data instead!
    const uploadedData = tenderId ? getExtractedData(tenderId) : null;

    if (uploadedData) {
      console.log(`\n   ════════════════════════════════════════════════════`);
      console.log(`   📥 FOUND UPLOADED PDF DATA for ${tenderId}!`);
      console.log(`   📊 Using data from user's uploaded PDF instead of JSON`);
      console.log(`   ════════════════════════════════════════════════════`);
      
      // Parse the uploaded PDF's analysis
      const analysisText = uploadedData.analysis_text || '';
      const rawData = uploadedData.raw_data || {};
      
      // DEBUG: Log what we have from extraction
      console.log(`\n   🔍 DEBUG: raw_data.cable_requirements =`, JSON.stringify(rawData?.cable_requirements, null, 2));
      console.log(`   🔍 DEBUG: raw_data.testing_requirements =`, JSON.stringify(rawData?.testing_requirements, null, 2));
      console.log(`   🔍 DEBUG: raw_data.external_testing_required =`, rawData?.external_testing_required);
      
      // Build cable requirements from uploaded data
      const parsedCables = parseCableRequirementsFromAnalysis(analysisText, rawData);
      console.log(`   📦 Parsed ${parsedCables.length} cables from uploaded PDF`);
      
      // Build testing requirements
      const parsedTests = parseTestingFromAnalysis(analysisText, rawData);
      console.log(`   🧪 Parsed ${parsedTests.length} tests from uploaded PDF`);
      
      // Check for external testing
      const externalTesting = parseExternalTestingFromAnalysis(analysisText, rawData);
      console.log(`   🔬 External testing required: ${externalTesting}`);
      
      // Get submission mode
      const submissionMode = parseSubmissionModeFromAnalysis(analysisText, rawData);
      console.log(`   📤 Submission mode: ${submissionMode}`);
      
      // Parse additional fields
      const parsedTerms = parseTermsFromAnalysis(rawData);
      const parsedDueDate = parseDueDateFromAnalysis(rawData);
      
      // Merge with base tender data (UPLOADED PDF data takes PRIORITY)
      const mergedTender = {
        ...(tender || {}),
        tender_id: tenderId,
        organisation: uploadedData.organisation || rawData?.organisation || tender?.organisation,
        title: uploadedData.title || rawData?.title || tender?.title,
        // Due date from uploaded PDF takes priority!
        due_date: parsedDueDate || uploadedData.due_date || tender?.due_date,
        city: uploadedData.city || rawData?.city || tender?.city,
        estimated_cost: uploadedData.estimated_cost || rawData?.estimated_cost_inr || tender?.estimated_cost,
        // Cable requirements from uploaded PDF (with correct quantities!)
        cable_requirements: parsedCables.length > 0 ? parsedCables : (tender?.cable_requirements || []),
        // Testing from uploaded PDF
        tests_required: parsedTests.length > 0 ? parsedTests : (tender?.tests_required || []),
        external_testing_required: externalTesting,
        // Submission mode from uploaded PDF
        submission: {
          mode: submissionMode,
          email: rawData?.submission_email || rawData?.contact_email || tender?.submission?.email,
          ...(tender?.submission || {})
        },
        // Terms from uploaded PDF
        terms: {
          delivery: parsedTerms.delivery || tender?.terms?.delivery,
          payment: parsedTerms.payment || tender?.terms?.payment,
          warranty: parsedTerms.warranty || tender?.terms?.warranty,
          ...(tender?.terms || {})
        }
      };

      // Normalise common field names to avoid undefined lookups in other modules
      // Provide multiple aliases used across the codebase so UI and routes don't see undefined
      mergedTender.submission = mergedTender.submission || {};
      // ensure both .mode and .submission_mode are available
      mergedTender.submission.mode = mergedTender.submission.mode || submissionMode;
      mergedTender.submission.submission_mode = mergedTender.submission.submission_mode || mergedTender.submission.mode;
      // email variants
      mergedTender.submission.email = mergedTender.submission.email || mergedTender.submission.submission_email || mergedTender.submission.email || mergedTender.submission.submissionEmail || mergedTender.submission_email || rawData?.submission_email || rawData?.contact_email || tender?.submission?.email;
      mergedTender.submission.submission_email = mergedTender.submission.submission_email || mergedTender.submission.email;
      // address variants
      mergedTender.submission.submission_address = mergedTender.submission.submission_address || mergedTender.submission.submissionAddress || tender?.submission?.submission_address || tender?.submission_address || rawData?.submission_address;
      // external testing flags - ensure consistent boolean
      mergedTender.external_testing_required = !!mergedTender.external_testing_required || !!rawData?.external_testing_required || false;
      mergedTender.tests_required = mergedTender.tests_required || mergedTender.testing_requirements || tender?.tests_required || tender?.testing_requirements || [];

      
      console.log(`\n   ═══════════════════════════════════════`);
      console.log(`   📊 MERGED TENDER DATA (from uploaded PDF):`);
      console.log(`   ═══════════════════════════════════════`);
      console.log(`   📋 Tender ID: ${mergedTender.tender_id}`);
      console.log(`   🏢 Organisation: ${mergedTender.organisation}`);
      console.log(`   📅 Due Date: ${mergedTender.due_date}`);
      console.log(`   📦 Cable Requirements: ${mergedTender.cable_requirements.length} items`);
      mergedTender.cable_requirements.forEach((c, i) => {
        console.log(`      Item ${i+1}: ${c.description || c.cable_type} - ${c.qty_km} km`);
      });
      console.log(`   🧪 Tests Required: ${mergedTender.tests_required.length}`);
      console.log(`   🔬 External Testing: ${mergedTender.external_testing_required}`);
      console.log(`   📤 Submission Mode: ${mergedTender.submission.mode}`);
      console.log(`   ═══════════════════════════════════════\n`);
      
      // Analyze using merged data
      const analysis = analyzeRFP(mergedTender);
      
      return res.json({
        success: true,
        analysis_method: 'UPLOADED_PDF',
        source: 'User uploaded PDF',
        ...analysis
      });
    }
    
    // STEP 3: No uploaded PDF data used - use original JSON-based analysis
    console.log(`   📋 No uploaded PDF data used, using JSON data (if provided)`);

    if (!tender) {
      return res.status(404).json({
        success: false,
        error: `Tender ${tenderId} not found`
      });
    }

    // Analyze RFP using original method (JSON-based analysis)
    const analysis = analyzeRFP(tender);

    res.json({
      success: true,
      analysis_method: 'JSON_BASED',
      ...analysis
    });
    
  } catch (error) {
    console.error('[RFP Proceed] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/rfp-proceed/analyze-pdf
 * Analyze an uploaded PDF file directly (for custom/modified PDFs)
 */
router.post('/analyze-pdf', async (req, res) => {
  try {
    const { pdfPath, pdfBase64 } = req.body;
    
    if (!pdfPath && !pdfBase64) {
      return res.status(400).json({
        success: false,
        error: 'Either pdfPath or pdfBase64 is required'
      });
    }
    
    let targetPath = pdfPath;
    
    // If base64 provided, save to temp file
    if (pdfBase64) {
      const tempDir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      targetPath = path.join(tempDir, `temp-${Date.now()}.pdf`);
      fs.writeFileSync(targetPath, Buffer.from(pdfBase64, 'base64'));
    }
    
    // Analyze the PDF
    const analysis = await analyzeRFPDynamically(targetPath);
    
    // Clean up temp file
    if (pdfBase64 && fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    
    res.json(analysis);
    
  } catch (error) {
    console.error('[Analyze PDF] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/rfp-proceed/generate-bid-pdf
 * Generate printable bid document PDF
 * For PDF_FORM_FILL mode: 2 pages (Quotation + Bid Response Form)
 * For other modes: 1 page (Quotation only)
 */
router.post('/generate-bid-pdf', async (req, res) => {
  try {
    const { tenderId, quotation, companyDetails } = req.body;
    
    const tender = loadTenderById(tenderId);
    if (!tender) {
      return res.status(404).json({ success: false, error: 'Tender not found' });
    }
    
    // Merge passed company details with preset defaults
    const company = companyDetails ? {
      ...COMPANY_PRESET,
      name: companyDetails.name || COMPANY_PRESET.name,
      contact_person: companyDetails.contact_person || COMPANY_PRESET.contact_person,
      designation: companyDetails.designation || COMPANY_PRESET.designation || 'Managing Director',
      email: companyDetails.email || COMPANY_PRESET.email,
      phone: companyDetails.phone || COMPANY_PRESET.phone,
      address: companyDetails.address || COMPANY_PRESET.address,
      gstin: companyDetails.gstin || COMPANY_PRESET.gstin,
      pan: companyDetails.pan || COMPANY_PRESET.pan
    } : COMPANY_PRESET;
    
    console.log('[Bid PDF] Using company:', company.contact_person, company.designation);
    const submissionMode = tender.submission?.mode || 'UNKNOWN';
    const isPdfFormFill = submissionMode === 'PDF_FORM_FILL';
    
    // Re-calculate quotation if not provided
    let finalQuotation = quotation;
    if (!finalQuotation && tender.cable_requirements) {
      try {
        const { analyzeRFP } = await import('../services/rfp-analysis-service.js');
        const analysis = analyzeRFP(tender);
        finalQuotation = analysis.quotation;
        console.log('[Bid PDF] Recalculated quotation successfully');
      } catch (calcError) {
        console.error('[Bid PDF] Error recalculating quotation:', calcError);
        // Continue without quotation - PDF will show what it can
      }
    }
    
    // Validate required data
    if (!tenderId) {
      return res.status(400).json({ success: false, error: 'Tender ID is required' });
    }
    
    // Generate PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const base64Pdf = pdfBuffer.toString('base64');
      
      // Instructions vary based on submission mode
      const instructions = isPdfFormFill ? [
        '1. This PDF has 2 pages:',
        '   - Page 1: Quotation Summary (for your reference)',
        '   - Page 2: Bid Response Form (Annexure-A)',
        '2. Print this document',
        '3. Sign at the designated signature area on Page 2',
        '4. Stamp with company seal',
        '5. Scan and attach to your submission email'
      ] : [
        '1. Review the quotation summary',
        '2. Print if needed for physical submission',
        '3. This serves as your bid documentation'
      ];
      
      res.json({
        success: true,
        pdf: base64Pdf,
        filename: `BID_${tenderId}_${Date.now()}.pdf`,
        instructions: instructions
      });
    });
    
    doc.on('error', (err) => {
      console.error('[Bid PDF] PDF Generation Error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: `PDF generation failed: ${err.message}` });
      }
    });
    
    // ========== PAGE 1: QUOTATION SUMMARY ==========
    doc.fontSize(16).font('Helvetica-Bold').text('BID QUOTATION SUMMARY', { align: 'center' });
    doc.moveDown(0.5);
    const pageInfo = isPdfFormFill ? '(Page 1 of 2)' : '';
    doc.fontSize(10).font('Helvetica').text(pageInfo, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).font('Helvetica').text(`Tender ID: ${tenderId}`, { align: 'center' });
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, { align: 'center' });
    doc.moveDown(2);
    
    // Company Details
    doc.fontSize(12).font('Helvetica-Bold').text('BIDDER DETAILS');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Company: ${company.name}`);
    doc.text(`Address: ${company.address.replace(/\n/g, ', ')}`);
    doc.text(`GSTIN: ${company.gstin} | PAN: ${company.pan}`);
    doc.text(`Contact: ${company.contact_person} | Phone: ${company.phone}`);
    doc.moveDown();
    
    // RFP Details
    doc.fontSize(12).font('Helvetica-Bold').text('TENDER DETAILS');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Tender ID: ${tender.tender_id}`);
    doc.text(`Title: ${tender.title}`);
    doc.text(`Buyer: ${tender.organisation}`);
    doc.text(`Due Date: ${new Date(tender.due_date).toLocaleDateString('en-IN')}`);
    doc.moveDown();
    
    // Cable Requirements
    if (tender.cable_requirements?.length > 0) {
      doc.fontSize(12).font('Helvetica-Bold').text('CABLE REQUIREMENTS');
      doc.moveDown(0.5);
      doc.fontSize(9).font('Helvetica');
      tender.cable_requirements.forEach((req, idx) => {
        doc.text(`${idx + 1}. ${req.voltage} ${req.cable_type} ${req.cores}C x ${req.size} - ${req.qty_km || 1} km`);
      });
      doc.moveDown();
    }
    
    // Price Summary - CUSTOMER FACING (no profit breakdown shown)
    if (finalQuotation) {
      doc.fontSize(12).font('Helvetica-Bold').text('PRICE QUOTATION');
      doc.moveDown(0.5);
      
      // Draw table
      doc.fontSize(9).font('Helvetica');
      
      const drawRow = (label, amount, bold = false, note = '') => {
        if (bold) doc.font('Helvetica-Bold');
        doc.text(label, 50, doc.y);
        const amountText = typeof amount === 'string' ? amount : `Rs. ${amount?.toLocaleString('en-IN') || '0'}`;
        doc.text(amountText, 350, doc.y - 12, { align: 'right', width: 150 });
        if (bold) doc.font('Helvetica');
        if (note) {
          doc.fontSize(8).font('Helvetica-Oblique');
          doc.text(`  ${note}`, 55, doc.y);
          doc.font('Helvetica').fontSize(9);
        }
        doc.moveDown(0.3);
      };
      
      // Material cost (includes built-in margin, but we don't show that)
      if (finalQuotation.materialCost?.total !== undefined) {
        drawRow('Material Supply Cost:', finalQuotation.materialCost?.total);
      }
      
      // Testing cost
      if (finalQuotation.testingCost?.total > 0) {
        drawRow('Testing & Certification:', finalQuotation.testingCost?.total);
      }
      
      // External testing (if required but TBD)
      if (finalQuotation.externalTesting?.required) {
        drawRow('External Testing:', 'To Be Confirmed*', false, '*Quote pending from testing lab');
      }
      
      // GST
      if (finalQuotation.gst?.amount !== undefined) {
        drawRow('GST @ 18%:', finalQuotation.gst?.amount);
      }
      
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(500, doc.y).stroke();
      doc.moveDown(0.3);
      
      // Grand total - handle external testing note
      if (finalQuotation.externalTesting?.required) {
        drawRow('TOTAL (Excl. External Testing):', finalQuotation.grandTotal, true);
        doc.fontSize(8).font('Helvetica-Oblique');
        doc.text('* External testing costs will be added upon receipt of quotation from NABL/BIS accredited lab', 50, doc.y);
        doc.font('Helvetica').fontSize(9);
      } else {
        if (finalQuotation.grandTotal !== undefined) {
          drawRow('GRAND TOTAL:', finalQuotation.grandTotal, true);
        }
      }
    } else {
      // No quotation available
      doc.fontSize(12).font('Helvetica-Bold').text('PRICE QUOTATION');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica').fillColor('#666666');
      doc.text('Quotation will be calculated upon request.', 50, doc.y);
      doc.fillColor('#000000');
      doc.moveDown();
    }
    
    // Only show Page 2 note for PDF_FORM_FILL mode
    if (isPdfFormFill) {
      doc.moveDown(2);
      doc.fontSize(10).font('Helvetica-Oblique');
      doc.text('Note: This is Page 1 (Summary). Please sign the Bid Response Form on Page 2.', { align: 'center' });
      
      // ========== PAGE 2: BID RESPONSE FORM (ANNEXURE-A) ==========
      // Only generated for PDF_FORM_FILL submission mode
      doc.addPage();
      
      // Header with box
      doc.rect(45, 40, 505, 50).stroke();
      doc.fontSize(14).font('Helvetica-Bold').text('ANNEXURE-A: BID RESPONSE FORM', 50, 52, { align: 'center', width: 495 });
      doc.fontSize(10).font('Helvetica').text(`Tender Reference: ${tender.tender_id}`, 50, 70, { align: 'center', width: 495 });
      
      doc.moveDown(3);
      let formY = 110;
      
      // Helper function to draw form field
      const drawFormField = (label, value, y, width = 450) => {
        doc.fontSize(9).font('Helvetica-Bold').text(label, 50, y);
        doc.rect(50, y + 12, width, 18).stroke();
        doc.fontSize(9).font('Helvetica').text(value || '', 55, y + 16);
        return y + 38;
      };
      
      const drawFormFieldHalf = (label1, value1, label2, value2, y) => {
        doc.fontSize(9).font('Helvetica-Bold').text(label1, 50, y);
        doc.rect(50, y + 12, 215, 18).stroke();
        doc.fontSize(9).font('Helvetica').text(value1 || '', 55, y + 16);
        
        doc.fontSize(9).font('Helvetica-Bold').text(label2, 285, y);
        doc.rect(285, y + 12, 215, 18).stroke();
        doc.fontSize(9).font('Helvetica').text(value2 || '', 290, y + 16);
        return y + 38;
      };
      
      // Section 1: Vendor Information
      doc.fontSize(11).font('Helvetica-Bold').text('SECTION 1: VENDOR INFORMATION', 50, formY);
      formY += 20;
      
      formY = drawFormField('Company Name / Firm Name:', company.name, formY);
      formY = drawFormField('Registered Address:', company.address.replace(/\n/g, ', '), formY);
      formY = drawFormFieldHalf('GSTIN:', company.gstin, 'PAN:', company.pan, formY);
      formY = drawFormFieldHalf('Contact Person:', company.contact_person, 'Designation:', company.designation, formY);
      formY = drawFormFieldHalf('Phone:', company.phone, 'Email:', company.email, formY);
      
      formY += 10;
      
      // Section 2: Bid Details
      doc.fontSize(11).font('Helvetica-Bold').text('SECTION 2: BID DETAILS', 50, formY);
      formY += 20;
      
      formY = drawFormField('Tender Reference No:', tender.tender_id, formY);
      formY = drawFormField('Tender Title:', tender.title, formY);
      formY = drawFormFieldHalf('Quoted Amount (Rs.):', finalQuotation?.grandTotal?.toLocaleString('en-IN') || '', 'Validity (Days):', '90', formY);
      formY = drawFormFieldHalf('Delivery Period:', tender.delivery_period || '8-12 weeks', 'Warranty:', tender.warranty || '18 months', formY);
      
      formY += 10;
      
      // Section 3: Declaration & Signature
      doc.fontSize(11).font('Helvetica-Bold').text('SECTION 3: DECLARATION', 50, formY);
      formY += 15;
      
      doc.fontSize(8).font('Helvetica');
      doc.text('I/We hereby declare that:', 50, formY);
      formY += 12;
      doc.text('1. All information provided in this form is true and correct to the best of my/our knowledge.', 50, formY);
      formY += 10;
      doc.text('2. I/We agree to abide by all terms and conditions of the tender document.', 50, formY);
      formY += 10;
      doc.text('3. I/We understand that any false information may result in disqualification.', 50, formY);
      formY += 10;
      doc.text('4. This quotation is valid for 90 days from the date of submission.', 50, formY);
      formY += 20;
      
      // Signature Box
      doc.rect(50, formY, 450, 80).stroke();
      doc.fontSize(9).font('Helvetica-Bold').text('AUTHORIZED SIGNATORY', 55, formY + 5);
      doc.fontSize(8).font('Helvetica');
      doc.text(`For: ${company.name}`, 55, formY + 20);
      doc.text('Signature: ____________________________', 55, formY + 40);
      doc.text('Date: ____________________________', 55, formY + 55);
      doc.text('(Company Seal)', 350, formY + 40);
      
      formY += 95;
      
      // Instructions
      doc.fontSize(8).font('Helvetica-Oblique');
      doc.text('IMPORTANT: Print this form, sign at the designated area above, affix company seal, and submit as per tender instructions.', 50, formY, { width: 450, align: 'center' });
    }
    
    doc.end();
    
  } catch (error) {
    console.error('[Generate PDF] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rfp-proceed/generate-cover-letter
 * Generate printable cover letter for courier submission
 */
router.post('/generate-cover-letter', async (req, res) => {
  try {
    const { tenderId, recipientAddress, companyDetails } = req.body;
    
    const tender = loadTenderById(tenderId);
    if (!tender) {
      return res.status(404).json({ success: false, error: 'Tender not found' });
    }
    
    // Use passed company details or fall back to preset
    const company = companyDetails ? {
      ...COMPANY_PRESET,
      name: companyDetails.name || COMPANY_PRESET.name,
      contact_person: companyDetails.contact_person || COMPANY_PRESET.contact_person,
      designation: companyDetails.designation || COMPANY_PRESET.designation || 'Managing Director',
      email: companyDetails.email || COMPANY_PRESET.email,
      phone: companyDetails.phone || COMPANY_PRESET.phone,
      address: companyDetails.address || COMPANY_PRESET.address
    } : COMPANY_PRESET;
    
    console.log('[Cover Letter] Using company details:', company.contact_person, company.designation);
    
    const address = recipientAddress || tender.submission?.submission_address || 'Address not specified';
    
    // Generate PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const base64Pdf = pdfBuffer.toString('base64');
      
      res.json({
        success: true,
        pdf: base64Pdf,
        filename: `COVER_LETTER_${tenderId}_${Date.now()}.pdf`
      });
    });
    
    // Letterhead
    doc.fontSize(14).font('Helvetica-Bold').text(company.name, { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(company.address.replace(/\n/g, ', '), { align: 'center' });
    doc.text(`Phone: ${company.phone} | Email: ${company.email}`, { align: 'center' });
    doc.moveDown(2);
    
    // Date
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`);
    doc.moveDown();
    
    // Recipient
    doc.text('To,');
    doc.text(address);
    doc.moveDown(2);
    
    // Subject
    doc.font('Helvetica-Bold').text(`Subject: Bid Submission for ${tender.tender_id} - ${tender.title}`);
    doc.moveDown();
    
    // Body
    doc.font('Helvetica');
    doc.text('Dear Sir/Madam,');
    doc.moveDown();
    doc.text(`We are pleased to submit our bid for the above-referenced tender. Please find enclosed our complete bid documents including technical and commercial proposals.`);
    doc.moveDown();
    doc.text('Enclosed Documents:');
    doc.text('1. Duly filled bid form');
    doc.text('2. Company registration certificate');
    doc.text('3. GST and PAN documents');
    doc.text('4. Technical compliance certificate');
    doc.text('5. Price schedule');
    doc.moveDown();
    doc.text('We confirm that our bid is valid for 90 days from the date of submission and we agree to all terms and conditions of the tender.');
    doc.moveDown();
    doc.text('We look forward to your favorable consideration.');
    doc.moveDown(2);
    
    // Closing
    doc.text('Thanking you,');
    doc.moveDown();
    doc.text('Yours faithfully,');
    doc.text(`For ${company.name}`);
    doc.moveDown(3);
    doc.text('______________________________');
    doc.text(company.contact_person);
    doc.text(company.designation);
    
    doc.end();
    
  } catch (error) {
    console.error('[Generate Cover Letter] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rfp-proceed/testing-email
 * Generate testing quotation request email
 */
router.post('/testing-email', async (req, res) => {
  try {
    const { tenderId } = req.body;
    
    const tender = loadTenderById(tenderId);
    if (!tender) {
      return res.status(404).json({ success: false, error: 'Tender not found' });
    }
    
    const email = generateTestingEmail(tender, tender.cable_requirements || []);
    
    res.json({
      success: true,
      email: email
    });
    
  } catch (error) {
    console.error('[Testing Email] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/rfp-proceed/company-preset
 * Get company preset data for form filling
 */
router.get('/company-preset', (req, res) => {
  res.json({
    success: true,
    company: COMPANY_PRESET
  });
});

// In-memory draft storage for previews
const drafts = new Map();

/**
 * POST /api/rfp-proceed/gmail-preview
 * Generate email preview for user review before sending
 */
router.post('/gmail-preview', (req, res) => {
  try {
    const { to, subject, body, tenderId } = req.body;
    
    const draftId = `email-${Date.now()}`;
    const draft = {
      id: draftId,
      type: 'email',
      to: to || '',
      subject: subject || '',
      body: body || '',
      tenderId,
      createdAt: new Date().toISOString(),
      status: 'preview'
    };
    
    drafts.set(draftId, draft);
    
    res.json({
      success: true,
      draftId,
      preview: draft,
      message: 'Email draft created. Review and modify before sending.',
      instructions: [
        'Say "change subject to [new subject]" to modify',
        'Say "change recipient to [email]" to change recipient',
        'Say "add to body: [text]" to append text',
        'Say "proceed" or click Confirm to send'
      ]
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rfp-proceed/gmail-modify
 * Modify email draft based on user instruction
 */
router.post('/gmail-modify', (req, res) => {
  try {
    const { draftId, modification } = req.body;
    
    const draft = drafts.get(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    
    const mod = modification.toLowerCase();
    
    // Parse modifications
    if (mod.includes('change subject to')) {
      const newSubject = modification.replace(/change subject to\s*/i, '').trim();
      draft.subject = newSubject;
    }
    if (mod.includes('change recipient to') || mod.includes('change to to')) {
      const newTo = modification.match(/to\s+([\w.-]+@[\w.-]+)/i);
      if (newTo) draft.to = newTo[1];
    }
    if (mod.includes('add to body') || mod.includes('append')) {
      const addText = modification.replace(/add to body[:\s]*/i, '').replace(/append[:\s]*/i, '').trim();
      draft.body += '\n\n' + addText;
    }
    if (mod.includes('change contact') || mod.includes('change name')) {
      const nameMatch = modification.match(/to\s+([A-Za-z\s]+)/i);
      if (nameMatch) {
        draft.body = draft.body.replace(/Contact Person:[^\n]*/i, `Contact Person: ${nameMatch[1].trim()}`);
      }
    }
    
    draft.modifiedAt = new Date().toISOString();
    drafts.set(draftId, draft);
    
    res.json({
      success: true,
      draftId,
      preview: draft,
      message: 'Draft updated. Say "proceed" to send or continue modifying.'
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rfp-proceed/gmail-compose
 * Finalize and generate Gmail compose URL
 */
router.post('/gmail-compose', (req, res) => {
  try {
    const { draftId, to, subject, body } = req.body;
    
    let finalTo = to;
    let finalSubject = subject;
    let finalBody = body;
    
    // If draftId provided, use draft data
    if (draftId) {
      const draft = drafts.get(draftId);
      if (draft) {
        finalTo = draft.to;
        finalSubject = draft.subject;
        finalBody = draft.body;
        draft.status = 'sent';
        drafts.set(draftId, draft);
      }
    }
    
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(finalTo || '')}&su=${encodeURIComponent(finalSubject || '')}&body=${encodeURIComponent(finalBody || '')}`;
    
    res.json({
      success: true,
      gmailUrl: gmailUrl
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rfp-proceed/pdf-preview
 * Generate PDF preview for user review before generating
 */
router.post('/pdf-preview', (req, res) => {
  try {
    const { tenderId, quotation, companyDetails } = req.body;
    
    const draftId = `pdf-${Date.now()}`;
    const draft = {
      id: draftId,
      type: 'pdf',
      tenderId,
      quotation: quotation || {},
      companyDetails: companyDetails || COMPANY_PRESET,
      sections: ['Cover Page', 'Quotation Details', 'Cable Specifications', 'Testing Requirements', 'Terms & Conditions'],
      createdAt: new Date().toISOString(),
      status: 'preview'
    };
    
    drafts.set(draftId, draft);
    
    res.json({
      success: true,
      draftId,
      preview: {
        ...draft,
        previewSections: [
          { name: 'Company', value: draft.companyDetails.name },
          { name: 'Contact Person', value: draft.companyDetails.contact_person, editable: true },
          { name: 'Email', value: draft.companyDetails.email },
          { name: 'Tender Reference', value: tenderId },
          { name: 'Total Quote', value: quotation?.grandTotal || 'Calculated' }
        ]
      },
      message: 'PDF draft created. Review and modify before generating.',
      instructions: [
        'Say "change contact person to [name]"',
        'Say "change company name to [name]"',
        'Say "add section [section name]"',
        'Say "proceed" to generate PDF'
      ]
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rfp-proceed/pdf-modify
 * Modify PDF draft based on user instruction
 */
router.post('/pdf-modify', (req, res) => {
  try {
    const { draftId, modification } = req.body;
    
    const draft = drafts.get(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    
    const mod = modification.toLowerCase();
    
    if (mod.includes('change contact person to') || mod.includes('change contact to')) {
      const name = modification.replace(/change contact.*?to\s*/i, '').trim();
      draft.companyDetails.contact_person = name;
    }
    if (mod.includes('change company name to') || mod.includes('change company to')) {
      const name = modification.replace(/change company.*?to\s*/i, '').trim();
      draft.companyDetails.name = name;
    }
    if (mod.includes('add section')) {
      const section = modification.replace(/add section\s*/i, '').trim();
      draft.sections.push(section);
    }
    
    draft.modifiedAt = new Date().toISOString();
    drafts.set(draftId, draft);
    
    res.json({
      success: true,
      draftId,
      preview: {
        ...draft,
        previewSections: [
          { name: 'Company', value: draft.companyDetails.name },
          { name: 'Contact Person', value: draft.companyDetails.contact_person, editable: true },
          { name: 'Email', value: draft.companyDetails.email },
          { name: 'Sections', value: draft.sections.join(', ') }
        ]
      },
      message: 'PDF draft updated. Say "proceed" to generate or continue modifying.'
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/rfp-proceed/draft/:draftId
 * Get current draft state
 */
router.get('/draft/:draftId', (req, res) => {
  const draft = drafts.get(req.params.draftId);
  if (!draft) {
    return res.status(404).json({ success: false, error: 'Draft not found' });
  }
  res.json({ success: true, draft });
});

/**
 * POST /api/rfp-proceed/calendar-preview
 * Generate calendar event preview
 */
router.post('/calendar-preview', (req, res) => {
  try {
    const { title, date, description, location, tenderId } = req.body;
    
    const draftId = `calendar-${Date.now()}`;
    const draft = {
      id: draftId,
      type: 'calendar',
      title: title || 'RFP Deadline',
      date: date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      description: description || '',
      location: location || '',
      tenderId,
      reminderDays: 3,
      createdAt: new Date().toISOString(),
      status: 'preview'
    };
    
    drafts.set(draftId, draft);
    
    res.json({
      success: true,
      draftId,
      preview: draft,
      message: 'Calendar event draft created. Review and modify before adding.',
      instructions: [
        'Say "change date to [date]"',
        'Say "change title to [title]"',
        'Say "set reminder for [X] days before"',
        'Say "proceed" to add to calendar'
      ]
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rfp-proceed/calendar-modify
 * Modify calendar draft
 */
router.post('/calendar-modify', (req, res) => {
  try {
    const { draftId, modification } = req.body;
    
    const draft = drafts.get(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    
    const mod = modification.toLowerCase();
    
    if (mod.includes('change date to') || mod.includes('set date to')) {
      const dateMatch = modification.match(/to\s+(.+)/i);
      if (dateMatch) {
        const parsedDate = new Date(dateMatch[1].trim());
        if (!isNaN(parsedDate)) {
          draft.date = parsedDate.toISOString().split('T')[0];
        }
      }
    }
    if (mod.includes('change title to')) {
      const title = modification.replace(/change title to\s*/i, '').trim();
      draft.title = title;
    }
    if (mod.includes('reminder') && mod.includes('days')) {
      const daysMatch = modification.match(/(\d+)\s*days/i);
      if (daysMatch) {
        draft.reminderDays = parseInt(daysMatch[1]);
      }
    }
    
    draft.modifiedAt = new Date().toISOString();
    drafts.set(draftId, draft);
    
    res.json({
      success: true,
      draftId,
      preview: draft,
      message: 'Calendar event updated. Say "proceed" to add or continue modifying.'
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rfp-proceed/calendar-event
 * Finalize and generate Google Calendar event URL
 */
router.post('/calendar-event', (req, res) => {
  try {
    const { draftId, title, date, description, location } = req.body;
    
    let finalTitle = title;
    let finalDate = date;
    let finalDescription = description;
    let finalLocation = location;
    
    if (draftId) {
      const draft = drafts.get(draftId);
      if (draft) {
        finalTitle = draft.title;
        finalDate = draft.date;
        finalDescription = draft.description;
        finalLocation = draft.location;
        draft.status = 'added';
        drafts.set(draftId, draft);
      }
    }
    
    const eventDate = new Date(finalDate);
    const startDate = eventDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endDate = new Date(eventDate.getTime() + 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(finalTitle || '')}&dates=${startDate}/${endDate}&details=${encodeURIComponent(finalDescription || '')}&location=${encodeURIComponent(finalLocation || '')}`;
    
    res.json({
      success: true,
      calendarUrl: calendarUrl
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rfp-proceed/ai-modify-email
 * Use AI to intelligently modify email based on natural language instructions
 */
router.post('/ai-modify-email', async (req, res) => {
  try {
    const { currentEmail, instruction, context } = req.body;
    
    if (!currentEmail || !instruction) {
      return res.status(400).json({
        success: false,
        error: 'currentEmail and instruction are required'
      });
    }
    
    // Import the AI email modifier
    const { modifyEmailWithAI } = await import('../services/ai-email-modifier.js');
    
    const result = await modifyEmailWithAI(currentEmail, instruction, context || {});
    
    res.json(result);
    
  } catch (error) {
    console.error('[AI Modify Email] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/rfp-proceed/generate-email
 * Generate a new email from scratch based on intent and context
 */
router.post('/generate-email', async (req, res) => {
  try {
    const { intent, context } = req.body;
    
    if (!intent) {
      return res.status(400).json({
        success: false,
        error: 'intent is required (inquiry, follow_up, quotation, meeting_request, counter_offer)'
      });
    }
    
    const { generateEmail } = await import('../services/ai-email-modifier.js');
    
    const result = await generateEmail(intent, context || {});
    
    res.json(result);
    
  } catch (error) {
    console.error('[Generate Email] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;

