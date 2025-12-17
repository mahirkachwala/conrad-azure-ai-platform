/**
 * Dataset API Routes
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * API endpoints for accessing cable product datasets,
 * running product matching, and calculating pricing.
 */

import express from 'express';
import { getCableDataset, loadCableProducts, loadCableTests, loadPricingRules } from '../services/cable-dataset-loader.js';
import { getProductMatcher, matchProducts, matchProductsForAgent, quickMatchProducts } from '../services/product-matcher.js';

const router = express.Router();

/**
 * GET /api/dataset/stats
 * Get dataset statistics
 */
router.get('/stats', (req, res) => {
  try {
    const dataset = getCableDataset();
    const stats = dataset.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dataset/products
 * Get all products or filter by criteria
 */
router.get('/products', (req, res) => {
  try {
    const dataset = getCableDataset();
    const { type, material, cores, voltage, area, armoured, insulation, limit } = req.query;
    
    const criteria = {};
    if (type) criteria.type = type;
    if (material) criteria.conductor_material = material;
    if (cores) criteria.cores = parseInt(cores, 10);
    if (voltage) criteria.voltage_rating = parseFloat(voltage);
    if (area) criteria.conductor_area = parseFloat(area);
    if (armoured !== undefined) criteria.armoured = armoured === 'true';
    if (insulation) criteria.insulation = insulation;
    
    let products = Object.keys(criteria).length > 0 
      ? dataset.filterProducts(criteria)
      : dataset.getProducts();
    
    if (limit) {
      products = products.slice(0, parseInt(limit, 10));
    }
    
    res.json({ 
      success: true, 
      count: products.length,
      products 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dataset/products/:skuId
 * Get a specific product by SKU ID
 */
router.get('/products/:skuId', (req, res) => {
  try {
    const dataset = getCableDataset();
    const product = dataset.getProductBySKU(req.params.skuId);
    
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dataset/tests
 * Get all tests or filter by product type
 */
router.get('/tests', (req, res) => {
  try {
    const dataset = getCableDataset();
    const { productType } = req.query;
    
    const tests = productType 
      ? dataset.getTestsForProductType(productType)
      : dataset.getTests();
    
    res.json({ 
      success: true, 
      count: tests.length,
      tests 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dataset/pricing-rules
 * Get all pricing rules
 */
router.get('/pricing-rules', (req, res) => {
  try {
    const rules = loadPricingRules();
    res.json({ success: true, rules });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dataset/match
 * Match RFP requirement to products using semantic matching
 */
router.post('/match', async (req, res) => {
  try {
    const { requirement, topK, minScore, quickMode } = req.body;
    
    if (!requirement) {
      return res.status(400).json({ 
        success: false, 
        error: 'requirement field is required' 
      });
    }
    
    let matches;
    if (quickMode) {
      // Quick rule-based matching (no embeddings)
      matches = quickMatchProducts(requirement, topK || 5);
      res.json({
        success: true,
        mode: 'quick',
        requirement,
        matches
      });
    } else {
      // Full semantic matching (with embeddings if available)
      matches = await matchProductsForAgent(requirement, {
        topK: topK || 5,
        minScore: minScore || 0.3
      });
      res.json({
        success: true,
        mode: 'semantic',
        ...matches
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dataset/pricing
 * Calculate pricing for a product order
 */
router.post('/pricing', (req, res) => {
  try {
    const { skuId, quantityKm, testIds } = req.body;
    
    if (!skuId || !quantityKm) {
      return res.status(400).json({ 
        success: false, 
        error: 'skuId and quantityKm are required' 
      });
    }
    
    const dataset = getCableDataset();
    const pricing = dataset.calculateOrderPricing(
      skuId, 
      parseFloat(quantityKm),
      { testIds: testIds || [] }
    );
    
    if (pricing.error) {
      return res.status(404).json({ success: false, error: pricing.error });
    }
    
    res.json({ success: true, pricing });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dataset/test-cost
 * Calculate test costs for given test IDs
 */
router.post('/test-cost', (req, res) => {
  try {
    const { testIds } = req.body;
    
    if (!testIds || !Array.isArray(testIds)) {
      return res.status(400).json({ 
        success: false, 
        error: 'testIds array is required' 
      });
    }
    
    const dataset = getCableDataset();
    const testCost = dataset.calculateTestCost(testIds);
    
    res.json({ success: true, ...testCost });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dataset/product-types
 * Get list of available product types
 */
router.get('/product-types', (req, res) => {
  try {
    const dataset = getCableDataset();
    const stats = dataset.getStats();
    
    res.json({ 
      success: true, 
      types: stats.product_types,
      materials: stats.materials
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dataset/bulk-match
 * Match multiple RFP requirements at once
 */
router.post('/bulk-match', async (req, res) => {
  try {
    const { requirements } = req.body;
    
    if (!requirements || !Array.isArray(requirements)) {
      return res.status(400).json({ 
        success: false, 
        error: 'requirements array is required' 
      });
    }
    
    const results = [];
    for (const req of requirements.slice(0, 10)) { // Limit to 10
      const matches = await matchProductsForAgent(req.description || req, {
        topK: 3,
        minScore: 0.3
      });
      results.push({
        rfp_id: req.rfp_id || null,
        ...matches
      });
    }
    
    res.json({ 
      success: true, 
      count: results.length,
      results 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dataset/refresh
 * Clear cache and reload datasets
 */
router.get('/refresh', (req, res) => {
  try {
    const dataset = getCableDataset();
    dataset.clearCache();
    dataset.load();
    
    const stats = dataset.getStats();
    res.json({ 
      success: true, 
      message: 'Dataset cache cleared and reloaded',
      stats 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;











