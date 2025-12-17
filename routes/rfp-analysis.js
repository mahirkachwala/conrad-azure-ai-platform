/**
 * RFP Analysis Route
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Provides API endpoints for:
 * - Complete RFP analysis with consolidated rubric
 * - Specification matching with deviation analysis
 * - Pricing analysis with market benchmarks
 * - Company credibility verification
 */

import express from 'express';
import { analyzeRFP, RUBRIC_WEIGHTS } from '../services/analysis-rubric.js';
import { matchWithDeviation, getEnhancedMatcher } from '../services/enhanced-spec-matcher.js';
import { 
  generatePricingAnalysis, 
  getMarketValueBenchmark, 
  analyzeQuotedPrice,
  calculateScaledTestCosts 
} from '../services/pricing-analysis.js';
import { getCredibilityScore } from '../services/credibility.js';
import { getOEMProducts } from '../services/oem-datasheets.js';

const router = express.Router();

/**
 * GET /api/analysis/rubric
 * Returns the analysis rubric weights and description
 */
router.get('/rubric', (req, res) => {
  res.json({
    success: true,
    rubric: RUBRIC_WEIGHTS,
    description: 'Consolidated analysis rubric for RFP evaluation',
    total_weight: Object.values(RUBRIC_WEIGHTS).reduce((sum, r) => sum + r.weight, 0)
  });
});

/**
 * POST /api/analysis/complete
 * Generates complete RFP analysis with all components
 * 
 * Body: {
 *   rfp: { tender_id, title, material, estimated_cost_inr, organisation },
 *   company_name: string (optional),
 *   quoted_price: number (optional)
 * }
 */
router.post('/complete', async (req, res) => {
  try {
    const { rfp, company_name, quoted_price } = req.body;
    
    if (!rfp) {
      return res.status(400).json({ 
        success: false, 
        error: 'RFP data is required' 
      });
    }
    
    // Get matched products for the RFP
    const matcher = getEnhancedMatcher();
    const requirement = rfp.material || rfp.title || '';
    const matchResults = matcher.findMatches(requirement, { topN: 5 });
    
    // Generate complete analysis
    const analysis = await analyzeRFP({
      rfp,
      matchedProducts: matchResults.matches,
      companyName: company_name || rfp.organisation,
      quotedPrice: quoted_price
    });
    
    res.json({
      success: true,
      analysis,
      match_results: matchResults
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/analysis/spec-match
 * Performs specification matching with detailed deviation analysis
 * 
 * Body: {
 *   requirement: "50mm copper XLPE cable 11kV",
 *   top_n: 5 (optional)
 * }
 */
router.post('/spec-match', (req, res) => {
  try {
    const { requirement, top_n = 5 } = req.body;
    
    if (!requirement) {
      return res.status(400).json({ 
        success: false, 
        error: 'Requirement text is required' 
      });
    }
    
    const matchResults = matchWithDeviation(requirement, { topN: top_n });
    
    res.json({
      success: true,
      results: matchResults
    });
    
  } catch (error) {
    console.error('Spec match error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/analysis/pricing
 * Analyzes pricing with market benchmarks
 * 
 * Body: {
 *   sku_id: "HT-CU-XLPE-3C-95" (or product details),
 *   quoted_price: 850000,
 *   project_value: 10000000
 * }
 */
router.post('/pricing', (req, res) => {
  try {
    const { sku_id, quoted_price, project_value = 10000000 } = req.body;
    
    // Get product details
    const products = getOEMProducts();
    let product = products.find(p => p.sku_id === sku_id);
    
    if (!product && !req.body.product) {
      return res.status(400).json({ 
        success: false, 
        error: 'Either sku_id or product details required' 
      });
    }
    
    product = product || req.body.product;
    
    // Get market benchmark
    const benchmark = getMarketValueBenchmark(product);
    
    // Analyze quoted price
    const priceToAnalyze = quoted_price || product.unit_price_inr_per_km;
    const analysis = analyzeQuotedPrice(priceToAnalyze, benchmark);
    
    // Calculate scaled test costs
    const testCosts = calculateScaledTestCosts(project_value, [
      { test_id: 'RT-001', name: 'Conductor Resistance' },
      { test_id: 'RT-002', name: 'High Voltage Test' },
      { test_id: 'TT-001', name: 'Partial Discharge' },
      { test_id: 'AT-003', name: 'IR Test After Laying' }
    ]);
    
    res.json({
      success: true,
      product: {
        sku_id: product.sku_id,
        product_name: product.product_name
      },
      market_benchmark: benchmark,
      price_analysis: analysis,
      test_costs: testCosts.summary,
      recommendation: analysis.recommendation
    });
    
  } catch (error) {
    console.error('Pricing analysis error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/analysis/credibility/:company
 * Gets credibility score for a company
 */
router.get('/credibility/:company', (req, res) => {
  try {
    const companyName = decodeURIComponent(req.params.company);
    const credibility = getCredibilityScore(companyName);
    
    res.json({
      success: true,
      credibility
    });
    
  } catch (error) {
    console.error('Credibility error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/analysis/market-benchmark/:sku_id
 * Gets market value benchmark for a product
 */
router.get('/market-benchmark/:sku_id', (req, res) => {
  try {
    const skuId = req.params.sku_id;
    const products = getOEMProducts();
    const product = products.find(p => p.sku_id === skuId);
    
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        error: 'Product not found' 
      });
    }
    
    const benchmark = getMarketValueBenchmark(product);
    
    res.json({
      success: true,
      sku_id: skuId,
      product_name: product.product_name,
      benchmark,
      oem_list_price: product.unit_price_inr_per_km,
      price_position: product.unit_price_inr_per_km <= benchmark.avg ? 'COMPETITIVE' : 'ABOVE_MARKET'
    });
    
  } catch (error) {
    console.error('Market benchmark error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/analysis/test-costs
 * Calculates scaled test costs for a project
 * 
 * Body: {
 *   project_value: 10000000,
 *   tests: [{ test_id: "RT-001", name: "Conductor Resistance" }, ...]
 * }
 */
router.post('/test-costs', (req, res) => {
  try {
    const { project_value = 10000000, tests = [] } = req.body;
    
    // Default tests if none provided
    const requiredTests = tests.length > 0 ? tests : [
      { test_id: 'RT-001', name: 'Conductor Resistance' },
      { test_id: 'RT-002', name: 'High Voltage Test' },
      { test_id: 'RT-003', name: 'Insulation Resistance' },
      { test_id: 'TT-001', name: 'Partial Discharge' },
      { test_id: 'TT-003', name: 'Bending Test' },
      { test_id: 'AT-003', name: 'IR Test After Laying' },
      { test_id: 'AT-004', name: 'HV Test After Laying' }
    ];
    
    const scaledCosts = calculateScaledTestCosts(project_value, requiredTests);
    
    res.json({
      success: true,
      project_value,
      scaled_costs: scaledCosts
    });
    
  } catch (error) {
    console.error('Test costs error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/analysis/oem-products
 * Lists all OEM products with their specifications
 */
router.get('/oem-products', (req, res) => {
  try {
    const products = getOEMProducts();
    const { category, material, voltage } = req.query;
    
    let filtered = products;
    
    if (category) {
      filtered = filtered.filter(p => 
        (p.category || '').toLowerCase().includes(category.toLowerCase())
      );
    }
    
    if (material) {
      filtered = filtered.filter(p => 
        (p.specifications?.conductor_material || '').toLowerCase().includes(material.toLowerCase())
      );
    }
    
    if (voltage) {
      const voltageNum = parseInt(voltage);
      filtered = filtered.filter(p => 
        p.specifications?.voltage_rating_v === voltageNum
      );
    }
    
    res.json({
      success: true,
      count: filtered.length,
      products: filtered.map(p => ({
        sku_id: p.sku_id,
        product_name: p.product_name,
        category: p.category,
        voltage: p.specifications?.voltage_rating_v,
        cross_section: p.specifications?.conductor_cross_section_mm2,
        conductor: p.specifications?.conductor_material,
        insulation: p.specifications?.insulation_material,
        cores: p.specifications?.no_of_cores,
        price_per_km: p.unit_price_inr_per_km,
        lead_time: p.lead_time_days
      }))
    });
    
  } catch (error) {
    console.error('OEM products error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

export default router;







