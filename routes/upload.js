import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { analyzeUploadedDocument } from '../services/document-extractor.js';
import { saveRfpAndChunks } from '../services/rfpMemory.js';
import { sessionMemory } from '../services/session-memory.js';
import { storeUploadedPdf, extractTenderIdFromFilename } from '../services/uploaded-pdf-store.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/documents';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and Word documents are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

/**
 * POST /api/upload/document
 * Upload and analyze a PDF or Word document
 */
router.post('/document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const sessionId = req.sessionId;

    console.log('📄 Document uploaded:', req.file.originalname);
    console.log('   Session ID:', sessionId);
    console.log('   File path:', req.file.path);
    console.log('   File type:', req.file.mimetype);
    console.log('   File size:', (req.file.size / 1024).toFixed(2), 'KB');

    // Analyze the document using AI
    const analysis = await analyzeUploadedDocument(req.file.path, req.file.mimetype);

    if (!analysis.success) {
      // Clean up the uploaded file if analysis failed
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn('   ⚠️  Could not delete temporary file:', cleanupError.message);
      }
      
      return res.status(500).json({
        success: false,
        error: analysis.error || 'Document analysis failed',
        message: analysis.message || 'Failed to extract information from the document'
      });
    }

    // Save to RFP Memory database for persistent Q&A
    try {
      // Extract company name from multiple possible fields
      const companyName = analysis.extractedData?.organisation ||
                          analysis.extractedData?.organization ||
                          analysis.extractedData?.buyerName ||
                          analysis.extractedData?.company ||
                          analysis.companyInfo?.name ||
                          'Unknown';
      
      console.log('   📋 Extracted company name:', companyName);
      
      const rfpData = {
        id: analysis.extractedData?.tender_id || analysis.extractedData?.tenderId || `RFP-${Date.now()}`,
        portal: analysis.extractedData?.portal || 'upload',
        buyerName: companyName,
        title: analysis.extractedData?.title || req.file.originalname,
        city: analysis.extractedData?.city || analysis.extractedData?.location || null,
        dueDate: analysis.extractedData?.due_date || analysis.extractedData?.dueDate || analysis.extractedData?.deadline || null,
        estCost: analysis.extractedData?.estimated_cost_inr || analysis.extractedData?.estimatedCost || analysis.extractedData?.estCost || null,
        category: analysis.extractedData?.category || 'General',
        pdfPath: req.file.path
      };

      const fullText = analysis.extractedData?.fullText || 
                       analysis.metadata?.rawText || 
                       JSON.stringify(analysis.extractedData || {});

      saveRfpAndChunks({ rfp: rfpData, fullText });
      console.log(`   ✅ Saved RFP to database: ${rfpData.id}`);
      
      analysis.rfpId = rfpData.id;
      
      // ALWAYS store company context and document for learning
      const sessionData = {
        companyName: companyName,
        lastUploadedTender: rfpData.id,
        lastUploadedFileName: req.file.originalname,
        lastAnalysis: analysis.extractedData,
        companyInfo: analysis.companyInfo,
        lastActivity: 'document_upload',
        uploadTime: new Date().toISOString(),
        // Store document info for learning commands
        lastUploadedDocument: {
          fileName: req.file.originalname,
          extractedText: fullText,
          extractedData: analysis.extractedData,
          uploadTime: new Date().toISOString()
        }
      };
      
      sessionMemory.set(sessionId, sessionData);
      console.log(`   💬 Stored context for session ${sessionId}: company = ${companyName}`);
      console.log(`   🧠 Document stored for potential learning`);
      
      if (!companyName || companyName === 'Unknown' || companyName.length <= 2) {
        console.log(`   ⚠️  Company name not extracted, but document still stored for learning`);
      }
    } catch (memoryError) {
      console.error('   ⚠️  Failed to save to RFP memory:', memoryError);
    }

    // Store the uploaded PDF for later use in "Proceed with RFP"
    // Extract tender ID from filename or from analysis
    const tenderId = extractTenderIdFromFilename(req.file.originalname) || 
                     analysis.extractedData?.tender_id ||
                     analysis.extractedData?.tenderId;
    
    if (tenderId && req.file.mimetype === 'application/pdf') {
      // Keep the file and store it for dynamic RFP analysis
      const permanentPath = path.join(process.cwd(), 'uploads/rfp-documents', `${tenderId}-${Date.now()}.pdf`);
      const permanentDir = path.dirname(permanentPath);
      
      if (!fs.existsSync(permanentDir)) {
        fs.mkdirSync(permanentDir, { recursive: true });
      }
      
      // Copy file to permanent location
      fs.copyFileSync(req.file.path, permanentPath);
      
      // Prepare extracted data for storage (to avoid re-parsing)
      const extractedDataForStorage = {
        tender_id: tenderId,
        organisation: analysis.extractedData?.organisation || analysis.extractedData?.organization,
        title: analysis.extractedData?.title,
        due_date: analysis.extractedData?.due_date || analysis.extractedData?.dueDate,
        city: analysis.extractedData?.city || analysis.extractedData?.location,
        estimated_cost: analysis.extractedData?.estimated_cost_inr || analysis.extractedData?.estimatedCost,
        analysis_text: analysis.analysis, // AI analysis text for parsing
        raw_data: analysis.extractedData
      };
      
      // Store in uploaded PDF store WITH extracted data
      storeUploadedPdf(tenderId, permanentPath, req.file.originalname, extractedDataForStorage);
      
      console.log(`   📄 STORED UPLOADED PDF for ${tenderId}`);
      console.log(`   📂 Path: ${permanentPath}`);
      console.log(`   📊 Extracted data stored for reuse`);
      console.log(`   ✨ This data will be used when you click "Proceed with RFP"`);
      
      // Add info to response
      analysis.uploadedPdfStored = true;
      analysis.uploadedTenderId = tenderId;
    }
    
    // Clean up the temporary upload file
    try {
      fs.unlinkSync(req.file.path);
      console.log('   ✅ Cleaned up temporary file');
    } catch (cleanupError) {
      console.warn('   ⚠️  Could not delete temporary file:', cleanupError.message);
    }

    // DYNAMIC: Extract submission mode from uploaded PDF using AI analysis
    // DO NOT use cached JSON data - use what was extracted from the PDF
    let submissionDetails = null;
    
    // Parse submission mode from the AI analysis text AND extracted data
    const analysisText = analysis.analysis || '';
    const rawSubmissionMode = analysis.extractedData?.submission_mode;
    let detectedMode = 'EMAIL_FORM'; // default
    
    // PRIORITY 1: Use structured submission_mode from AI extraction
    if (rawSubmissionMode) {
      detectedMode = rawSubmissionMode;
      console.log(`   📋 Submission mode from AI extraction: ${rawSubmissionMode}`);
    }
    // PRIORITY 2: Pattern matching on analysis text (more flexible patterns)
    else if (/pre-?bid\s*meeting|meeting\s*(?:required|mandatory)|request.*meeting|meeting.*email|schedule\s*meeting/i.test(analysisText)) {
      detectedMode = 'MEETING_EMAIL';
      console.log('   📅 Detected submission mode: PRE-BID MEETING (from text)');
    } else if (/submission.*meeting|meeting.*submission|and\s*meeting\s*required/i.test(analysisText)) {
      detectedMode = 'MEETING_EMAIL';
      console.log('   📅 Detected submission mode: MEETING (from combined text)');
    } else if (/physical.*courier|courier.*address|postal|registered\s*post|send.*courier/i.test(analysisText)) {
      detectedMode = 'LETTER_COURIER';
      console.log('   📮 Detected submission mode: PHYSICAL COURIER');
    } else if (/portal\s*registration|external\s*portal|vendor\s*portal|e-?tender\s*portal|online\s*portal/i.test(analysisText)) {
      detectedMode = 'EXTERNAL_PORTAL';
      console.log('   🌐 Detected submission mode: EXTERNAL PORTAL');
    } else if (/email.*form|annexure.*email|fill.*form|email\s*submission/i.test(analysisText)) {
      detectedMode = 'EMAIL_FORM';
      console.log('   📧 Detected submission mode: EMAIL FORM');
    }
    
    // Extract email from analysis
    const emailMatch = analysisText.match(/(?:Email|email)[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    const extractedEmail = emailMatch ? emailMatch[1] : (analysis.extractedData?.contact_email || '');
    
    // Build submission details from extracted data
    submissionDetails = {
      mode: detectedMode,
      email: extractedEmail,
      submission_notes: detectedMode === 'MEETING_EMAIL' 
        ? 'Request a pre-bid meeting by sending an email with your company profile.'
        : detectedMode === 'LETTER_COURIER'
        ? 'Print bid documents on company letterhead and courier to the specified address.'
        : 'Submit your bid via email with the required documents.',
      deadline: analysis.extractedData?.due_date || analysis.extractedData?.dueDate
    };
    
    // Set the dynamically extracted submission data
    analysis.extractedData.submission = submissionDetails;
    console.log(`   📋 Submission mode set to: ${detectedMode}`);
    console.log(`   📧 Contact email: ${extractedEmail || 'Not found'}`);
    
    // REMOVED: Loading from all-portals.json - we now use dynamically extracted data

    res.json({
      success: true,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      extractedData: analysis.extractedData,
      companyInfo: analysis.companyInfo,
      analysis: analysis.analysis,
      metadata: analysis.metadata,
      rfpId: analysis.rfpId,
      submission: submissionDetails
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up file if it exists
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Document upload and analysis failed',
      message: 'An error occurred while processing your document'
    });
  }
});

export default router;
