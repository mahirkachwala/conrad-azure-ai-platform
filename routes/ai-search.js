/**
 * AI SEARCH API ROUTES
 * 
 * Endpoints for automated RFP search using permutation logic
 */

import express from 'express';
import { executeSearch, formatResultsForChat } from '../services/ai-search-orchestrator.js';
import { parseUserQuery, generatePermutations } from '../services/csv-permutation-generator.js';
import { matchRFPRequirements } from '../services/sku-matcher.js';

const router = express.Router();

/**
 * POST /api/ai-search/query
 * Main search endpoint - processes natural language query
 */
router.post('/query', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }
    
    console.log(`[AI Search] Processing query: "${query}"`);
    
    const searchResult = await executeSearch(query);
    const formattedResult = formatResultsForChat(searchResult);
    
    res.json({
      success: true,
      ...formattedResult,
      rawData: searchResult
    });
    
  } catch (error) {
    console.error('[AI Search] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/ai-search/analyze-intent
 * Analyze user query without executing search
 */
router.post('/analyze-intent', (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query is required' });
    }
    
    const analysis = parseUserQuery(query);
    
    res.json({
      success: !analysis.error,
      analysis: analysis
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/ai-search/permutations
 * Generate permutations for a cable type
 */
router.post('/permutations', (req, res) => {
  try {
    const { cableType, filters } = req.body;
    
    if (!cableType) {
      return res.status(400).json({ success: false, error: 'Cable type is required' });
    }
    
    const result = generatePermutations(cableType, filters || {});
    
    res.json({
      success: !result.error,
      ...result
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/ai-search/sku-match
 * Match RFP requirements against product catalog
 */
router.post('/sku-match', (req, res) => {
  try {
    const { cableRequirements } = req.body;
    
    if (!cableRequirements || !Array.isArray(cableRequirements)) {
      return res.status(400).json({ 
        success: false, 
        error: 'cableRequirements array is required' 
      });
    }
    
    const matchResult = matchRFPRequirements(cableRequirements);
    
    res.json({
      success: true,
      ...matchResult
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/ai-search/cable-types
 * Get available cable types for search
 */
router.get('/cable-types', (req, res) => {
  res.json({
    success: true,
    cableTypes: [
      { key: 'control', label: 'Control Cable', description: 'Multi-core cables for control circuits' },
      { key: 'ht', label: 'HT Cable', description: 'High Tension cables (11kV - 33kV)' },
      { key: 'lt', label: 'LT Cable', description: 'Low Tension cables (up to 1.1kV)' },
      { key: 'ehv', label: 'EHV Cable', description: 'Extra High Voltage cables (66kV+)' },
      { key: 'instrumentation', label: 'Instrumentation Cable', description: 'Signal and instrumentation cables' }
    ]
  });
});

export default router;


