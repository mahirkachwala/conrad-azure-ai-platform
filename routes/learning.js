/**
 * Learning API Routes
 * EY Techathon 6.0 - Adaptive AI System
 * 
 * Endpoints for:
 * - Triggering learning from new data
 * - Checking learning status
 * - Managing model fine-tuning
 * - Viewing learned schemas and patterns
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { 
  initContinuousLearning, 
  learnFromAllData, 
  learnFromUpload, 
  learnFromPDFText,
  getLearningStatus,
  relearAll
} from '../services/continuous-learner.js';

import { 
  generateTrainingPairs, 
  runFineTuning, 
  getFineTunerStatus,
  findSimilarDomainTerms,
  exportTrainingData
} from '../services/model-finetuner.js';

import { 
  intelligentQuery, 
  semanticSearch, 
  getRAGStatus 
} from '../services/adaptive-rag.js';

import { 
  getAllSchemas, 
  findMatchingColumns 
} from '../services/schema-learner.js';

import { 
  getStats as getDocStats 
} from '../services/document-learner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure file upload
const upload = multer({ 
  dest: path.join(__dirname, '../data/uploads'),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Initialize flag
let isInitialized = false;

/**
 * Initialize learning system on first request
 */
async function ensureInitialized() {
  if (!isInitialized) {
    await initContinuousLearning();
    isInitialized = true;
  }
}

/**
 * GET /api/learning/status
 * Get overall learning system status
 */
router.get('/status', async (req, res) => {
  try {
    await ensureInitialized();
    
    const status = getLearningStatus();
    const ragStatus = getRAGStatus();
    const finetuneStatus = getFineTunerStatus();
    const schemas = getAllSchemas();
    const docStats = getDocStats();
    
    res.json({
      success: true,
      learning: status,
      rag: ragStatus,
      finetuning: finetuneStatus,
      schemas: {
        count: Object.keys(schemas).length,
        files: Object.keys(schemas)
      },
      documents: docStats
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning/learn-all
 * Trigger learning from all existing data
 */
router.post('/learn-all', async (req, res) => {
  try {
    await ensureInitialized();
    
    res.json({ 
      success: true, 
      message: 'Learning started...',
      status: 'processing'
    });
    
    // Run learning in background
    learnFromAllData().then(result => {
      console.log('Learning complete:', result);
    }).catch(err => {
      console.error('Learning error:', err);
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning/upload
 * Upload and learn from a new file
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    await ensureInitialized();
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    const result = await learnFromUpload(req.file.path, path.extname(req.file.originalname));
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: result.success,
      file: req.file.originalname,
      ...result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning/learn-pdf
 * Learn from PDF text content
 */
router.post('/learn-pdf', async (req, res) => {
  try {
    await ensureInitialized();
    
    const { text, fileName, metadata } = req.body;
    
    if (!text) {
      return res.status(400).json({ success: false, error: 'No text provided' });
    }
    
    const result = await learnFromPDFText(text, { fileName, ...metadata });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning/finetune
 * Trigger model fine-tuning
 */
router.post('/finetune', async (req, res) => {
  try {
    await ensureInitialized();
    
    // Generate training pairs first
    const pairs = await generateTrainingPairs();
    
    // Run fine-tuning
    const result = await runFineTuning();
    
    res.json({
      success: true,
      training_pairs: pairs.length,
      ...result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/learning/finetune/status
 * Get fine-tuning status
 */
router.get('/finetune/status', async (req, res) => {
  try {
    const status = getFineTunerStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/learning/schemas
 * Get all learned schemas
 */
router.get('/schemas', async (req, res) => {
  try {
    await ensureInitialized();
    const schemas = getAllSchemas();
    res.json({ success: true, schemas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning/search
 * Semantic search using learned embeddings
 */
router.post('/search', async (req, res) => {
  try {
    await ensureInitialized();
    
    const { query, collections, topK } = req.body;
    
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query required' });
    }
    
    const results = await semanticSearch(query, {
      collections: collections || ['PRODUCTS', 'TENDERS'],
      topK: topK || 10
    });
    
    res.json({
      success: true,
      query,
      results_count: results.length,
      results
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning/intelligent-query
 * Intelligent query using all learning components
 */
router.post('/intelligent-query', async (req, res) => {
  try {
    await ensureInitialized();
    
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query required' });
    }
    
    const result = await intelligentQuery(query);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning/find-columns
 * Find columns matching a query
 */
router.post('/find-columns', async (req, res) => {
  try {
    await ensureInitialized();
    
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query required' });
    }
    
    const matches = await findMatchingColumns(query);
    
    res.json({
      success: true,
      query,
      matches
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning/similar-terms
 * Find similar domain terms
 */
router.post('/similar-terms', async (req, res) => {
  try {
    await ensureInitialized();
    
    const { text, topK } = req.body;
    
    if (!text) {
      return res.status(400).json({ success: false, error: 'Text required' });
    }
    
    const terms = await findSimilarDomainTerms(text, topK || 5);
    
    res.json({
      success: true,
      text,
      similar_terms: terms
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning/relearn
 * Force re-learn everything
 */
router.post('/relearn', async (req, res) => {
  try {
    await ensureInitialized();
    
    res.json({ 
      success: true, 
      message: 'Re-learning started...',
      status: 'processing'
    });
    
    // Run in background
    relearAll().then(result => {
      console.log('Re-learning complete:', result);
    }).catch(err => {
      console.error('Re-learning error:', err);
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/learning/export-training
 * Export training data for external use
 */
router.get('/export-training', async (req, res) => {
  try {
    const data = exportTrainingData();
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;



