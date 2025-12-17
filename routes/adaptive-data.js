/**
 * Adaptive Data Routes
 * Handles CSV uploads, session management, and quotation modifications
 */

import express from 'express';
import multer from 'multer';
import { 
  uploadSessionCSV, 
  getSessionStatus, 
  clearSessionOverrides,
  parseQuotationModification,
  applyQuotationModifications,
  getDataComparison,
  hasSessionOverride
} from '../services/adaptive-csv-manager.js';
import { 
  reloadTestingData, 
  reloadCableProducts,
  calculateQuotation,
  getAllTests
} from '../services/adaptive-pricing.js';

const router = express.Router();

// Configure multer for CSV uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

/**
 * POST /api/adaptive/upload-csv
 * Upload a CSV file for session-based adaptation
 */
router.post('/upload-csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded' 
      });
    }
    
    const csvContent = req.file.buffer.toString('utf-8');
    const fileName = req.file.originalname;
    const userIntent = req.body.intent || req.body.description || '';
    
    console.log(`[Adaptive Upload] Received: ${fileName} (${req.file.size} bytes)`);
    console.log(`[Adaptive Upload] User intent: ${userIntent}`);
    
    // Upload and process CSV
    const result = await uploadSessionCSV(csvContent, fileName, userIntent);
    
    if (result.success) {
      // Reload affected data
      if (result.type === 'testing') {
        reloadTestingData();
      } else if (result.type.includes('cables')) {
        reloadCableProducts();
      }
      
      // Get comparison with default data
      const comparison = getDataComparison(result.type);
      
      res.json({
        success: true,
        message: result.message,
        details: {
          type: result.type,
          confidence: result.confidence,
          detectionMethod: result.detectionMethod,
          rowCount: result.rowCount,
          headers: result.headers,
          structureMapping: result.structureMapping
        },
        comparison: comparison.hasComparison ? {
          defaultRowCount: comparison.defaultRowCount,
          sessionRowCount: comparison.sessionRowCount,
          changesCount: comparison.changes?.length || 0,
          changes: comparison.changes?.slice(0, 10) // First 10 changes
        } : null
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        suggestion: result.suggestion,
        detectedType: result.detectedType,
        headers: result.headers
      });
    }
  } catch (error) {
    console.error('[Adaptive Upload] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/adaptive/upload-csv-text
 * Upload CSV as text (for chat integration)
 */
router.post('/upload-csv-text', async (req, res) => {
  try {
    const { csvContent, fileName, intent } = req.body;
    
    if (!csvContent) {
      return res.status(400).json({ 
        success: false, 
        error: 'No CSV content provided' 
      });
    }
    
    console.log(`[Adaptive Upload Text] Processing CSV with intent: ${intent}`);
    
    const result = await uploadSessionCSV(csvContent, fileName || 'uploaded.csv', intent || '');
    
    if (result.success) {
      // Reload affected data
      if (result.type === 'testing') {
        reloadTestingData();
      } else if (result.type.includes('cables')) {
        reloadCableProducts();
      }
      
      const comparison = getDataComparison(result.type);
      
      res.json({
        success: true,
        message: result.message,
        type: result.type,
        confidence: result.confidence,
        rowCount: result.rowCount,
        comparison
      });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('[Adaptive Upload Text] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/adaptive/session-status
 * Get current session status and active overrides
 */
router.get('/session-status', (req, res) => {
  try {
    const status = getSessionStatus();
    
    res.json({
      success: true,
      session: status,
      summary: {
        activeOverrides: Object.keys(status.activeOverrides).length,
        totalModifications: status.modificationsCount,
        sessionDuration: new Date() - new Date(status.sessionStarted)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/adaptive/clear-session
 * Clear all session overrides
 */
router.post('/clear-session', (req, res) => {
  try {
    clearSessionOverrides();
    
    // Reload default data
    reloadTestingData();
    reloadCableProducts();
    
    res.json({
      success: true,
      message: 'Session cleared. All data reset to defaults.'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/adaptive/modify-quotation
 * Modify a quotation using natural language
 */
router.post('/modify-quotation', async (req, res) => {
  try {
    const { instruction, currentQuotation } = req.body;
    
    if (!instruction || !currentQuotation) {
      return res.status(400).json({
        success: false,
        error: 'Missing instruction or currentQuotation'
      });
    }
    
    console.log(`[Quotation Modify] Instruction: ${instruction}`);
    
    // Parse the modification instruction
    const modifications = await parseQuotationModification(instruction, currentQuotation);
    
    if (!modifications.success) {
      return res.json({
        success: false,
        error: 'Could not understand the modification request',
        suggestion: 'Try phrases like:\n- "increase by 10%"\n- "change total to 5,00,000"\n- "make material cost 3,00,000"\n- "set profit margin to 15%"',
        interpretation: modifications.interpretation
      });
    }
    
    // Apply modifications
    const modifiedQuotation = applyQuotationModifications(currentQuotation, modifications);
    
    res.json({
      success: true,
      message: `Quotation modified: ${modifications.interpretation}`,
      modifications: modifications.changes,
      quotation: modifiedQuotation
    });
  } catch (error) {
    console.error('[Quotation Modify] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/adaptive/recalculate-quotation
 * Recalculate quotation with current session data
 */
router.post('/recalculate-quotation', (req, res) => {
  try {
    const { cableType, specs, quantity, requiredTests } = req.body;
    
    // This will automatically use session overrides if available
    const quotation = calculateQuotation({
      cableType: cableType || 'HT Cable',
      specs: specs || {},
      quantity: quantity || 1000,
      requiredTests: requiredTests || ['type_test', 'routine_test']
    });
    
    // Add session info
    quotation.usingSessionData = {
      testing: hasSessionOverride('testing'),
      cableProducts: hasSessionOverride(cableType?.toLowerCase().replace(' ', '_') + 's')
    };
    
    res.json({
      success: true,
      quotation
    });
  } catch (error) {
    console.error('[Recalculate] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/adaptive/tests
 * Get all tests (with session overrides applied)
 */
router.get('/tests', (req, res) => {
  try {
    const tests = getAllTests();
    const hasOverride = hasSessionOverride('testing');
    
    res.json({
      success: true,
      tests,
      hasSessionOverride: hasOverride,
      usingSessionData: hasOverride,
      count: tests.length,
      source: hasOverride ? 'session_override' : 'testing.csv'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/adaptive/comparison/:type
 * Get comparison between default and session data
 */
router.get('/comparison/:type', (req, res) => {
  try {
    const { type } = req.params;
    const comparison = getDataComparison(type);
    
    res.json({
      success: true,
      comparison
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

