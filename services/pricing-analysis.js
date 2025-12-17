/**
 * Pricing Analysis Service
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Provides realistic pricing logic with:
 * - Market value benchmarks based on product specifications
 * - Counter offers that are AT or BELOW market value (never above)
 * - Test costs scaled proportionally to project value
 * - Clear analysis rubrics
 */

import { getOEMProducts, SERVICES_PRICING_TABLE } from './oem-datasheets.js';

// Market value benchmarks per cable type (INR per km)
// Based on industry standards and current market rates
const MARKET_VALUE_BENCHMARKS = {
  // HT Cables (11kV)
  'HT-11kV-Cu-XLPE': {
    '95mm': { min: 750000, avg: 825000, max: 900000 },
    '120mm': { min: 890000, avg: 970000, max: 1050000 },
    '185mm': { min: 1200000, avg: 1320000, max: 1450000 },
    '240mm': { min: 1480000, avg: 1620000, max: 1780000 }
  },
  'HT-11kV-Al-XLPE': {
    '95mm': { min: 450000, avg: 510000, max: 560000 },
    '120mm': { min: 530000, avg: 590000, max: 650000 },
    '185mm': { min: 740000, avg: 820000, max: 900000 },
    '240mm': { min: 930000, avg: 1020000, max: 1120000 }
  },
  // LT Cables (1.1kV)
  'LT-1.1kV-Cu-XLPE': {
    '25mm': { min: 115000, avg: 130000, max: 145000 },
    '35mm': { min: 155000, avg: 175000, max: 195000 },
    '50mm': { min: 200000, avg: 225000, max: 250000 },
    '70mm': { min: 275000, avg: 310000, max: 345000 },
    '95mm': { min: 370000, avg: 415000, max: 460000 }
  },
  // Control Cables
  'Control-Cu-PVC': {
    '7C-2.5mm': { min: 65000, avg: 75000, max: 85000 },
    '12C-1.5mm': { min: 72000, avg: 82000, max: 92000 },
    '19C-2.5mm': { min: 115000, avg: 130000, max: 145000 },
    '24C-1.5mm': { min: 145000, avg: 160000, max: 175000 }
  },
  // EHT Cables (33kV+)
  'EHT-33kV-Al-XLPE': {
    '300mm': { min: 1350000, avg: 1500000, max: 1650000 },
    '400mm': { min: 1720000, avg: 1900000, max: 2100000 }
  }
};

// Test cost scaling factors based on project value
// Tests should be 2-5% of project value depending on complexity
const TEST_COST_SCALING = {
  routine: {
    basePercentage: 0.5,  // 0.5% of project value
    minAmount: 15000,     // Minimum test cost
    maxAmount: 150000     // Maximum for routine tests
  },
  type: {
    basePercentage: 1.5,  // 1.5% of project value
    minAmount: 50000,
    maxAmount: 500000
  },
  acceptance: {
    basePercentage: 0.8,  // 0.8% of project value
    minAmount: 25000,
    maxAmount: 250000
  },
  special: {
    basePercentage: 1.0,  // 1.0% of project value
    minAmount: 40000,
    maxAmount: 400000
  }
};

/**
 * Get market value benchmark for a product
 * @param {Object} product - Product with specifications
 * @returns {Object} Market value benchmark (min, avg, max)
 */
export function getMarketValueBenchmark(product) {
  const specs = product.specifications || product;
  const voltage = specs.voltage_rating_v || specs.voltage || 1100;
  const conductor = (specs.conductor_material || 'Copper').toLowerCase();
  const insulation = (specs.insulation_material || 'XLPE').toUpperCase();
  const crossSection = specs.conductor_cross_section_mm2 || specs.cross_section_area || 95;
  const cores = specs.no_of_cores || 3;
  
  // Determine cable category
  let category = '';
  let sizeKey = '';
  
  if (voltage >= 33000) {
    category = 'EHT-33kV-Al-XLPE';
    sizeKey = `${crossSection}mm`;
  } else if (voltage >= 11000) {
    const cond = conductor.includes('copper') || conductor.includes('cu') ? 'Cu' : 'Al';
    category = `HT-11kV-${cond}-XLPE`;
    sizeKey = `${crossSection}mm`;
  } else if (voltage <= 1100) {
    // Check if control cable
    if (cores >= 7 || (product.category || '').toLowerCase().includes('control')) {
      category = 'Control-Cu-PVC';
      sizeKey = `${cores}C-${crossSection}mm`;
    } else {
      const cond = conductor.includes('copper') || conductor.includes('cu') ? 'Cu' : 'Al';
      category = `LT-1.1kV-${cond}-XLPE`;
      sizeKey = `${crossSection}mm`;
    }
  }
  
  // Get benchmark or calculate based on base price
  const categoryBenchmarks = MARKET_VALUE_BENCHMARKS[category];
  if (categoryBenchmarks && categoryBenchmarks[sizeKey]) {
    return categoryBenchmarks[sizeKey];
  }
  
  // Fallback: Calculate from base OEM price with typical margins
  const oemPrice = product.unit_price_inr_per_km || product.unit_price || 500000;
  return {
    min: Math.round(oemPrice * 0.9),
    avg: Math.round(oemPrice * 1.0),
    max: Math.round(oemPrice * 1.15)
  };
}

/**
 * Analyze RFP quoted price against market value
 * Enhanced with nuanced analysis for varied deal quality
 * 
 * @param {number} quotedPrice - Price quoted in RFP
 * @param {Object} marketBenchmark - Market value benchmark
 * @param {Object} context - Additional context (testCosts, credibility)
 * @returns {Object} Price analysis result
 */
export function analyzeQuotedPrice(quotedPrice, marketBenchmark, context = {}) {
  const { min, avg, max } = marketBenchmark;
  const { testCosts = 0, credibilityScore = 75, projectValue = quotedPrice } = context;
  
  // Calculate deviation from average
  const deviationFromAvg = ((quotedPrice - avg) / avg) * 100;
  const deviationFromMax = ((quotedPrice - max) / max) * 100;
  
  let priceCategory = 'FAIR';
  let recommendation = '';
  let counterOfferTarget = 0;
  let counterOfferReason = '';
  let dealQuality = 'ACCEPTABLE';
  let riskFlags = [];
  
  // ============================================
  // NUANCED PRICING ANALYSIS WITH VARIANCE
  // ============================================
  
  if (quotedPrice > max * 1.3) {
    // VERY BAD DEAL: >30% above max market - reject or heavy negotiation
    priceCategory = 'SIGNIFICANTLY_OVERPRICED';
    dealQuality = 'POOR';
    counterOfferTarget = Math.round(avg * 0.95); // Counter at 5% below average
    counterOfferReason = '⚠️ REJECT OR RENEGOTIATE: Price is 30%+ above market maximum. Consider alternative vendors.';
    recommendation = '❌ NOT RECOMMENDED: Significant overpricing detected. Seek alternatives.';
    riskFlags.push('Extreme price variance from market');
    
  } else if (quotedPrice > max * 1.15) {
    // BAD DEAL: 15-30% above max
    priceCategory = 'OVERPRICED';
    dealQuality = 'BELOW_AVERAGE';
    counterOfferTarget = Math.round(avg); // Counter at market average
    counterOfferReason = '⚠️ NEGOTIATE: Price exceeds market by 15-30%. Counter at market average.';
    recommendation = '⚠️ NEGOTIATE STRONGLY: Price is significantly above market rates.';
    riskFlags.push('Price above market maximum');
    
  } else if (quotedPrice > max) {
    // NEEDS NEGOTIATION: Slightly above max
    priceCategory = 'ABOVE_MARKET';
    dealQuality = 'FAIR';
    counterOfferTarget = Math.round((avg + max) / 2); // Counter between avg and max
    counterOfferReason = 'Price slightly above market max. Counter offer brings it into competitive range.';
    recommendation = '🔄 NEGOTIATE: Minor adjustment needed to reach market rates.';
    
  } else if (quotedPrice > avg * 1.05 && quotedPrice <= max) {
    // ACCEPTABLE: Above average but within max
    priceCategory = 'ABOVE_AVERAGE';
    dealQuality = 'ACCEPTABLE';
    counterOfferTarget = Math.round(avg * 0.98); // Counter slightly below average
    counterOfferReason = 'Price is above average but within market range. Negotiate for better terms.';
    recommendation = '✓ ACCEPTABLE: Consider minor negotiation for better value.';
    
  } else if (quotedPrice >= avg * 0.95 && quotedPrice <= avg * 1.05) {
    // GOOD DEAL: Within 5% of average - ideal scenario
    priceCategory = 'COMPETITIVE';
    dealQuality = 'GOOD';
    counterOfferTarget = quotedPrice; // No counter needed!
    counterOfferReason = '✅ NO COUNTER NEEDED: Price is at competitive market rate.';
    recommendation = '✅ RECOMMENDED: Price is competitive. Proceed with procurement.';
    
  } else if (quotedPrice >= min && quotedPrice < avg * 0.95) {
    // GREAT DEAL: Below average but above minimum
    priceCategory = 'BELOW_AVERAGE';
    dealQuality = 'EXCELLENT';
    counterOfferTarget = quotedPrice; // Accept as-is
    counterOfferReason = '🎯 EXCELLENT VALUE: Price below market average. Accept this offer.';
    recommendation = '🎯 STRONGLY RECOMMENDED: Excellent pricing. Fast-track approval.';
    
  } else if (quotedPrice < min * 0.85) {
    // SUSPICIOUS: Too cheap - may indicate quality/delivery issues
    priceCategory = 'SUSPICIOUSLY_LOW';
    dealQuality = 'RISKY';
    counterOfferTarget = Math.round(min); // Don't go lower
    counterOfferReason = '⚠️ VERIFY QUALITY: Price unusually low. Check vendor capability and material quality.';
    recommendation = '⚠️ INVESTIGATE: Price below cost basis. Verify vendor credentials.';
    riskFlags.push('Price suspiciously below market minimum');
    
  } else {
    // Below minimum but not suspicious
    priceCategory = 'BELOW_MARKET';
    dealQuality = 'GOOD';
    counterOfferTarget = quotedPrice;
    counterOfferReason = '✓ GOOD VALUE: Price below typical market. Accept if vendor is credible.';
    recommendation = '✓ FAVORABLE: Good pricing. Verify vendor delivery capability.';
  }
  
  // ============================================
  // FACTOR IN TEST COSTS
  // ============================================
  let testCostImpact = '';
  const testPercentage = projectValue > 0 ? (testCosts / projectValue) * 100 : 0;
  
  if (testCosts > 0) {
    if (testPercentage > 5) {
      testCostImpact = '⚠️ HIGH TEST BURDEN: Testing costs are >5% of project, significantly impacting total cost.';
      if (dealQuality === 'GOOD' || dealQuality === 'EXCELLENT') {
        dealQuality = 'ACCEPTABLE';
        recommendation += ' However, high testing costs reduce overall value.';
      }
      riskFlags.push('High testing cost ratio');
    } else if (testPercentage > 3) {
      testCostImpact = 'ℹ️ MODERATE TEST COSTS: Testing costs are 3-5% of project value.';
    } else {
      testCostImpact = '✓ REASONABLE TEST COSTS: Testing costs within normal range.';
    }
  }
  
  // ============================================
  // FACTOR IN CREDIBILITY
  // ============================================
  let credibilityImpact = '';
  
  if (credibilityScore < 40) {
    credibilityImpact = '⚠️ LOW CREDIBILITY: Vendor verification score is poor. Exercise caution.';
    if (dealQuality === 'GOOD' || dealQuality === 'EXCELLENT') {
      dealQuality = 'RISKY';
      recommendation = '⚠️ RISKY: Good price but vendor credibility is low. Conduct due diligence.';
    }
    riskFlags.push('Low vendor credibility score');
  } else if (credibilityScore < 60) {
    credibilityImpact = 'ℹ️ MODERATE CREDIBILITY: Vendor has acceptable but not strong credentials.';
  } else if (credibilityScore >= 80) {
    credibilityImpact = '✓ HIGH CREDIBILITY: Vendor is well-established and verified.';
    if (dealQuality === 'ACCEPTABLE') {
      dealQuality = 'GOOD'; // Upgrade due to credibility
    }
  }
  
  // Calculate actual savings (only if counter offer is different from quoted)
  const savingsFromQuoted = counterOfferTarget < quotedPrice ? quotedPrice - counterOfferTarget : 0;
  const savingsPercentage = savingsFromQuoted > 0 ? (savingsFromQuoted / quotedPrice) * 100 : 0;
  
  return {
    quotedPrice,
    marketBenchmark: { min, avg, max },
    deviationFromAvg: Math.round(deviationFromAvg * 100) / 100,
    deviationFromMax: Math.round(deviationFromMax * 100) / 100,
    priceCategory,
    dealQuality,
    counterOffer: {
      amount: counterOfferTarget,
      reason: counterOfferReason,
      savingsAmount: Math.round(savingsFromQuoted),
      savingsPercentage: Math.round(savingsPercentage * 100) / 100,
      negotiationNeeded: counterOfferTarget < quotedPrice
    },
    recommendation,
    testCostImpact,
    credibilityImpact,
    riskFlags,
    isWithinMarket: quotedPrice <= max,
    isCompetitive: quotedPrice <= avg * 1.05,
    isExcellentDeal: quotedPrice <= avg * 0.95 && quotedPrice >= min
  };
}

/**
 * Calculate scaled test costs based on project value
 * Tests are scaled to be 2-5% of project value total
 * 
 * @param {number} projectValue - Total RFP value in INR
 * @param {Array} requiredTests - Array of required tests with test_id, name, test_category
 * @returns {Object} Scaled test costs
 */
export function calculateScaledTestCosts(projectValue, requiredTests = []) {
  const scaledCosts = {
    routine: [],
    type: [],
    acceptance: [],
    special: [],
    summary: {
      routineTotal: 0,
      typeTotal: 0,
      acceptanceTotal: 0,
      specialTotal: 0,
      grandTotal: 0,
      percentageOfProject: 0
    }
  };
  
  // Group tests by category
  const testsByCategory = {
    'Routine Test': 'routine',
    'Type Test': 'type',
    'Acceptance Test': 'acceptance',
    'Special Test': 'special'
  };
  
  // Default base prices by test type if not provided
  const defaultBasePrices = {
    'Routine Test': 25000,
    'Type Test': 85000,
    'Acceptance Test': 45000,
    'Special Test': 55000
  };
  
  // Use provided tests or create default set
  let testsToPrice = requiredTests.length > 0 ? requiredTests : [
    { test_id: 'T001', name: 'High Voltage Test', test_category: 'Type Test' },
    { test_id: 'T002', name: 'Conductor Resistance', test_category: 'Routine Test' },
    { test_id: 'T003', name: 'Insulation Resistance', test_category: 'Routine Test' }
  ];
  
  // Scale each test cost based on project value
  for (const test of testsToPrice) {
    const category = testsByCategory[test.test_category] || 'routine';
    const scaling = TEST_COST_SCALING[category];
    
    // Get base price (from test data or default)
    const basePrice = test.price_inr || defaultBasePrices[test.test_category] || 30000;
    
    // Calculate scaled cost using logarithmic scaling
    // Formula: basePrice * log10(projectValue / 100000)
    // For 85L project: log10(8500000/100000) = log10(85) ≈ 1.93
    // This makes tests scale proportionally to project size
    const projectMultiplier = Math.max(1, Math.log10(projectValue / 100000));
    let scaledPrice = Math.round(basePrice * projectMultiplier);
    
    // Apply percentage-based bounds relative to project value
    const minBound = Math.round(projectValue * (scaling.basePercentage / 100) * 0.3);
    const maxBound = Math.round(projectValue * (scaling.basePercentage / 100) * 1.5);
    
    // Apply absolute min/max as safety bounds
    scaledPrice = Math.max(scaling.minAmount, scaledPrice);
    scaledPrice = Math.min(scaling.maxAmount, scaledPrice);
    
    // Also cap at percentage-based max
    scaledPrice = Math.min(maxBound, scaledPrice);
    scaledPrice = Math.max(minBound, scaledPrice);
    
    const scaledTest = {
      test_id: test.test_id,
      test_name: test.name || test.test_name,
      test_category: test.test_category,
      original_price: basePrice,
      price_inr: scaledPrice,
      scaled_price: scaledPrice,
      scaling_factor: Math.round((scaledPrice / basePrice) * 100) / 100,
      percentage_of_project: Math.round((scaledPrice / projectValue) * 10000) / 100
    };
    
    scaledCosts[category].push(scaledTest);
    scaledCosts.summary[`${category}Total`] += scaledPrice;
  }
  
  // Calculate grand total
  scaledCosts.summary.grandTotal = 
    scaledCosts.summary.routineTotal + 
    scaledCosts.summary.typeTotal + 
    scaledCosts.summary.acceptanceTotal + 
    scaledCosts.summary.specialTotal;
  
  scaledCosts.summary.percentageOfProject = 
    Math.round((scaledCosts.summary.grandTotal / projectValue) * 10000) / 100;
  
  return scaledCosts;
}

/**
 * Generate complete pricing analysis for an RFP
 * @param {Object} rfp - RFP data
 * @param {Array} matchedProducts - Products matched from OEM catalog
 * @param {Object} companyCredibility - Company credibility data
 * @returns {Object} Complete pricing analysis
 */
export function generatePricingAnalysis(rfp, matchedProducts, companyCredibility = {}) {
  const projectValue = rfp.estimated_cost_inr || 10000000;
  const analysis = {
    rfp_id: rfp.tender_id || rfp.rfp_id,
    project_value: projectValue,
    analysis_timestamp: new Date().toISOString(),
    
    // Product-level analysis
    products: [],
    
    // Test costs (scaled)
    test_analysis: null,
    
    // Overall pricing summary
    pricing_summary: {
      total_material_market_value: 0,
      total_quoted_value: 0,
      recommended_counter_offer: 0,
      potential_savings: 0,
      savings_percentage: 0
    },
    
    // Scoring rubric
    scoring: {
      price_competitiveness: 0,
      spec_match_score: 0,
      credibility_score: 0,
      overall_score: 0,
      recommendation: ''
    }
  };
  
  // Analyze each matched product
  let totalMarketValue = 0;
  let totalQuoted = 0;
  let totalCounterOffer = 0;
  let avgSpecMatch = 0;
  
  for (const product of matchedProducts) {
    const marketBenchmark = getMarketValueBenchmark(product);
    
    // Estimate quoted price from RFP value / number of products
    const estimatedQuotedPrice = Math.round(projectValue / matchedProducts.length / 50); // per km
    const priceAnalysis = analyzeQuotedPrice(estimatedQuotedPrice, marketBenchmark);
    
    // Estimate quantity (km)
    const estimatedQty = Math.max(10, Math.round(projectValue / (marketBenchmark.avg * matchedProducts.length)));
    
    const productAnalysis = {
      sku_id: product.sku_id,
      product_name: product.product_name,
      spec_match_percentage: product.spec_match_percentage || 80,
      
      // Pricing details
      market_benchmark: marketBenchmark,
      oem_list_price: product.unit_price_inr_per_km || product.unit_price,
      estimated_quantity_km: estimatedQty,
      
      // Price analysis
      price_analysis: priceAnalysis,
      
      // Line totals
      market_value_line_total: marketBenchmark.avg * estimatedQty,
      counter_offer_line_total: priceAnalysis.counterOffer.amount * estimatedQty
    };
    
    analysis.products.push(productAnalysis);
    
    totalMarketValue += productAnalysis.market_value_line_total;
    totalQuoted += estimatedQuotedPrice * estimatedQty;
    totalCounterOffer += productAnalysis.counter_offer_line_total;
    avgSpecMatch += product.spec_match_percentage || 80;
  }
  
  avgSpecMatch = Math.round(avgSpecMatch / matchedProducts.length);
  
  // Calculate test costs
  const routineTests = [
    { test_id: 'RT-001', name: 'Conductor Resistance' },
    { test_id: 'RT-002', name: 'High Voltage Test' },
    { test_id: 'RT-003', name: 'Insulation Resistance' }
  ];
  const typeTests = [
    { test_id: 'TT-001', name: 'Partial Discharge' },
    { test_id: 'TT-003', name: 'Bending Test' }
  ];
  const acceptanceTests = [
    { test_id: 'AT-003', name: 'IR Test After Laying' },
    { test_id: 'AT-004', name: 'HV Test After Laying' }
  ];
  
  analysis.test_analysis = calculateScaledTestCosts(
    projectValue, 
    [...routineTests, ...typeTests, ...acceptanceTests]
  );
  
  // Pricing summary
  analysis.pricing_summary = {
    total_material_market_value: totalMarketValue,
    total_quoted_value: totalQuoted,
    recommended_counter_offer: totalCounterOffer,
    total_test_cost: analysis.test_analysis.summary.grandTotal,
    subtotal_with_tests: totalCounterOffer + analysis.test_analysis.summary.grandTotal,
    gst_18_percent: Math.round((totalCounterOffer + analysis.test_analysis.summary.grandTotal) * 0.18),
    grand_total: Math.round((totalCounterOffer + analysis.test_analysis.summary.grandTotal) * 1.18),
    potential_savings: Math.max(0, totalQuoted - totalCounterOffer),
    savings_percentage: Math.round(Math.max(0, (totalQuoted - totalCounterOffer) / totalQuoted * 100) * 100) / 100
  };
  
  // Calculate scoring rubric
  const credScore = companyCredibility.score || companyCredibility.raw_score || 75;
  const priceCompetitiveness = calculatePriceCompetitivenessScore(analysis.products);
  
  analysis.scoring = calculateOverallScore({
    specMatch: avgSpecMatch,
    priceCompetitiveness,
    credibilityScore: credScore,
    testCoverage: Math.min(100, (analysis.test_analysis.summary.grandTotal / projectValue) * 100 * 20) // Scale test coverage
  });
  
  return analysis;
}

/**
 * Calculate price competitiveness score based on product analyses
 * @param {Array} products - Product analyses
 * @returns {number} Score 0-100
 */
function calculatePriceCompetitivenessScore(products) {
  if (products.length === 0) return 50;
  
  let totalScore = 0;
  
  for (const product of products) {
    const pa = product.price_analysis;
    let score = 50; // Base score
    
    switch (pa.priceCategory) {
      case 'BELOW_AVERAGE':
        score = 90;
        break;
      case 'COMPETITIVE':
        score = 80;
        break;
      case 'ABOVE_AVERAGE':
        score = 60;
        break;
      case 'OVERPRICED':
        score = 40;
        break;
      case 'SIGNIFICANTLY_OVERPRICED':
        score = 20;
        break;
      case 'SUSPICIOUSLY_LOW':
        score = 35; // Penalty for suspicious pricing
        break;
      default:
        score = 50;
    }
    
    totalScore += score;
  }
  
  return Math.round(totalScore / products.length);
}

/**
 * Calculate overall scoring with clear rubric
 * SPEC MATCH is the PRIMARY factor - a 100% spec match should always rank higher
 * 
 * @param {Object} factors - Scoring factors
 * @returns {Object} Complete scoring breakdown
 */
function calculateOverallScore({ specMatch, priceCompetitiveness, credibilityScore, testCoverage }) {
  // Weights for each factor (must sum to 100)
  // SPEC MATCH is dominant - without the right product, nothing else matters
  const weights = {
    specMatch: 50,            // Technical fit is THE MOST important (50%)
    priceCompetitiveness: 25, // Price is second (25%)
    credibility: 18,          // Company credibility (18%)
    testCoverage: 7           // Adequate testing (7%)
  };
  
  // Normalize scores to 0-100 scale
  const normalizedScores = {
    specMatch: Math.min(100, Math.max(0, specMatch)),
    priceCompetitiveness: Math.min(100, Math.max(0, priceCompetitiveness)),
    credibility: Math.min(100, Math.max(0, credibilityScore)),
    testCoverage: Math.min(100, Math.max(0, testCoverage))
  };
  
  // Calculate weighted score
  const weightedScore = 
    (normalizedScores.specMatch * weights.specMatch / 100) +
    (normalizedScores.priceCompetitiveness * weights.priceCompetitiveness / 100) +
    (normalizedScores.credibility * weights.credibility / 100) +
    (normalizedScores.testCoverage * weights.testCoverage / 100);
  
  const overallScore = Math.round(weightedScore);
  
  // Generate recommendation
  let recommendation = '';
  let riskLevel = 'MEDIUM';
  
  if (overallScore >= 80) {
    recommendation = 'STRONGLY RECOMMENDED: Excellent technical match, competitive pricing, and reliable vendor.';
    riskLevel = 'LOW';
  } else if (overallScore >= 65) {
    recommendation = 'RECOMMENDED: Good overall fit with minor areas for negotiation.';
    riskLevel = 'LOW';
  } else if (overallScore >= 50) {
    recommendation = 'PROCEED WITH CAUTION: Acceptable but requires negotiation on pricing or specifications.';
    riskLevel = 'MEDIUM';
  } else if (overallScore >= 35) {
    recommendation = 'CONDITIONAL: Significant gaps exist. Recommend alternative evaluation.';
    riskLevel = 'HIGH';
  } else {
    recommendation = 'NOT RECOMMENDED: Major issues with specifications, pricing, or credibility.';
    riskLevel = 'HIGH';
  }
  
  return {
    overall_score: overallScore,
    risk_level: riskLevel,
    recommendation,
    
    // Detailed breakdown
    breakdown: {
      spec_match: {
        score: normalizedScores.specMatch,
        weight: weights.specMatch,
        contribution: Math.round(normalizedScores.specMatch * weights.specMatch / 100),
        label: getScoreLabel(normalizedScores.specMatch)
      },
      price_competitiveness: {
        score: normalizedScores.priceCompetitiveness,
        weight: weights.priceCompetitiveness,
        contribution: Math.round(normalizedScores.priceCompetitiveness * weights.priceCompetitiveness / 100),
        label: getScoreLabel(normalizedScores.priceCompetitiveness)
      },
      credibility: {
        score: normalizedScores.credibility,
        weight: weights.credibility,
        contribution: Math.round(normalizedScores.credibility * weights.credibility / 100),
        label: getScoreLabel(normalizedScores.credibility)
      },
      test_coverage: {
        score: normalizedScores.testCoverage,
        weight: weights.testCoverage,
        contribution: Math.round(normalizedScores.testCoverage * weights.testCoverage / 100),
        label: getScoreLabel(normalizedScores.testCoverage)
      }
    },
    
    // Rubric explanation
    rubric: {
      description: 'Weighted scoring based on technical fit, pricing, vendor credibility, and test coverage',
      factors: [
        { name: 'Specification Match', weight: `${weights.specMatch}%`, description: 'How well OEM products match RFP requirements' },
        { name: 'Price Competitiveness', weight: `${weights.priceCompetitiveness}%`, description: 'Pricing relative to market benchmarks' },
        { name: 'Vendor Credibility', weight: `${weights.credibility}%`, description: 'Company verification and track record' },
        { name: 'Test Coverage', weight: `${weights.testCoverage}%`, description: 'Adequacy of quality assurance testing' }
      ]
    }
  };
}

/**
 * Get label for score
 */
function getScoreLabel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Acceptable';
  if (score >= 40) return 'Needs Improvement';
  return 'Poor';
}

export default {
  getMarketValueBenchmark,
  analyzeQuotedPrice,
  calculateScaledTestCosts,
  generatePricingAnalysis,
  MARKET_VALUE_BENCHMARKS,
  TEST_COST_SCALING
};

