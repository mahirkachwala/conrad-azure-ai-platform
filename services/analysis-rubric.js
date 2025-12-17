/**
 * Consolidated Analysis Rubric Service
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Provides a unified scoring framework that combines:
 * - Company Credibility (from OpenCorporates)
 * - Specification Match Score
 * - Price Quotation Analysis
 * - Testing Requirements & Costs
 * - Overall Win Probability
 */

import { getCredibilityScore } from './credibility.js';
import { generatePricingAnalysis, getMarketValueBenchmark, analyzeQuotedPrice, calculateScaledTestCosts } from './pricing-analysis.js';
import { getEnhancedMatcher } from './enhanced-spec-matcher.js';
import { formatLakhsCrores } from './table-formatter.js';

/**
 * Complete Analysis Rubric Weights
 * These weights determine how each factor contributes to the final score
 */
export const RUBRIC_WEIGHTS = {
  spec_match: {
    weight: 35,
    description: 'Technical Specification Match',
    sub_factors: [
      { name: 'Voltage Rating Match', weight: 25, critical: true },
      { name: 'Cross-Section Match', weight: 20, critical: false },
      { name: 'Conductor Material Match', weight: 20, critical: true },
      { name: 'Insulation Material Match', weight: 15, critical: false },
      { name: 'Core Count Match', weight: 10, critical: false },
      { name: 'Other Specs', weight: 10, critical: false }
    ]
  },
  price_analysis: {
    weight: 30,
    description: 'Price Competitiveness & Market Analysis',
    sub_factors: [
      { name: 'Price vs Market Benchmark', weight: 40, critical: false },
      { name: 'Counter Offer Viability', weight: 30, critical: false },
      { name: 'Cost Breakdown Transparency', weight: 15, critical: false },
      { name: 'Payment Terms', weight: 15, critical: false }
    ]
  },
  credibility: {
    weight: 25,
    description: 'Vendor Credibility & Verification',
    sub_factors: [
      { name: 'Company Registration Status', weight: 30, critical: true },
      { name: 'Years in Operation', weight: 25, critical: false },
      { name: 'OpenCorporates Verification', weight: 25, critical: false },
      { name: 'Past Performance', weight: 20, critical: false }
    ]
  },
  test_coverage: {
    weight: 10,
    description: 'Quality Assurance & Testing',
    sub_factors: [
      { name: 'Routine Tests Included', weight: 35, critical: false },
      { name: 'Type Tests Available', weight: 35, critical: false },
      { name: 'Acceptance Test Plan', weight: 30, critical: false }
    ]
  }
};

/**
 * Risk Level Thresholds
 */
const RISK_LEVELS = {
  LOW: { min: 75, color: '#10b981', label: 'LOW RISK', icon: '✅' },
  MEDIUM: { min: 50, color: '#f59e0b', label: 'MEDIUM RISK', icon: '⚠️' },
  HIGH: { min: 0, color: '#ef4444', label: 'HIGH RISK', icon: '🚨' }
};

/**
 * Main Analysis Rubric Class
 */
export class AnalysisRubric {
  constructor() {
    this.weights = RUBRIC_WEIGHTS;
  }
  
  /**
   * Generate complete RFP analysis with all rubric components
   * @param {Object} params - Analysis parameters
   * @returns {Object} Complete analysis with scores and recommendations
   */
  async generateCompleteAnalysis({
    rfp,
    matchedProducts = [],
    companyName = null,
    quotedPrice = null
  }) {
    const analysis = {
      rfp_id: rfp.tender_id || rfp.rfp_id,
      rfp_title: rfp.title,
      buyer: rfp.organisation,
      project_value: rfp.estimated_cost_inr,
      analysis_timestamp: new Date().toISOString(),
      
      // Component scores
      components: {},
      
      // Overall results
      overall: {
        score: 0,
        risk_level: 'HIGH',
        recommendation: '',
        go_no_go: 'EVALUATE'
      },
      
      // Detailed breakdowns
      details: {},
      
      // Action items
      action_items: []
    };
    
    // 1. Analyze Specification Match
    analysis.components.spec_match = this.analyzeSpecMatch(rfp, matchedProducts);
    
    // 2. Analyze Pricing
    analysis.components.price_analysis = this.analyzePricing(rfp, matchedProducts, quotedPrice);
    
    // 3. Analyze Credibility
    analysis.components.credibility = await this.analyzeCredibility(companyName || rfp.organisation);
    
    // 4. Analyze Test Coverage
    analysis.components.test_coverage = this.analyzeTestCoverage(rfp, analysis.components.price_analysis);
    
    // 5. Calculate Overall Score
    analysis.overall = this.calculateOverallScore(analysis.components);
    
    // 6. Generate Recommendations
    analysis.action_items = this.generateActionItems(analysis);
    
    // 7. Create summary table
    analysis.summary_table = this.createSummaryTable(analysis);
    
    return analysis;
  }
  
  /**
   * Analyze specification match
   */
  analyzeSpecMatch(rfp, matchedProducts) {
    const result = {
      score: 0,
      weight: this.weights.spec_match.weight,
      contribution: 0,
      status: 'UNKNOWN',
      details: []
    };
    
    if (!matchedProducts || matchedProducts.length === 0) {
      result.status = 'NO_PRODUCTS';
      result.score = 0;
      result.details.push({
        finding: 'No products matched',
        impact: 'Cannot evaluate specification match',
        action: 'Review RFP requirements and OEM catalog'
      });
      return result;
    }
    
    // Use enhanced matcher for detailed analysis
    const matcher = getEnhancedMatcher();
    const rfpDescription = rfp.material || rfp.title || '';
    const matchResults = matcher.findMatches(rfpDescription, { topN: 3 });
    
    // Calculate average spec match
    let totalScore = 0;
    const productDetails = [];
    
    for (const product of matchedProducts) {
      const score = product.spec_match_percentage || product.overall_score || 70;
      totalScore += score;
      
      productDetails.push({
        sku_id: product.sku_id,
        product_name: product.product_name,
        score: score,
        status: score >= 90 ? 'EXCELLENT' : score >= 75 ? 'GOOD' : score >= 60 ? 'ACCEPTABLE' : 'POOR',
        issues: product.issues || [],
        compromises: product.compromises || []
      });
    }
    
    result.score = Math.round(totalScore / matchedProducts.length);
    result.contribution = Math.round(result.score * result.weight / 100);
    result.status = result.score >= 80 ? 'GOOD' : result.score >= 60 ? 'ACCEPTABLE' : 'NEEDS_ATTENTION';
    result.products = productDetails;
    result.compromise_analysis = matchResults.compromise_analysis;
    
    // Add findings
    if (result.score >= 80) {
      result.details.push({
        finding: `Average spec match of ${result.score}%`,
        impact: 'Products meet RFP requirements',
        action: 'Proceed with confidence'
      });
    } else if (result.score >= 60) {
      result.details.push({
        finding: `Average spec match of ${result.score}%`,
        impact: 'Some specifications have deviations',
        action: 'Review compromises and confirm acceptability'
      });
    } else {
      result.details.push({
        finding: `Low spec match of ${result.score}%`,
        impact: 'Significant specification gaps',
        action: 'Consider alternative products or negotiate specifications'
      });
    }
    
    return result;
  }
  
  /**
   * Analyze pricing
   */
  analyzePricing(rfp, matchedProducts, quotedPrice = null) {
    const result = {
      score: 0,
      weight: this.weights.price_analysis.weight,
      contribution: 0,
      status: 'UNKNOWN',
      details: []
    };
    
    const projectValue = rfp.estimated_cost_inr || 10000000;
    
    // Generate pricing analysis using new module
    const pricingAnalysis = generatePricingAnalysis(rfp, matchedProducts, {});
    
    // Evaluate price competitiveness
    let priceScore = 0;
    const priceCategories = pricingAnalysis.products.map(p => p.price_analysis.priceCategory);
    
    const categoryScores = {
      'BELOW_AVERAGE': 100,
      'COMPETITIVE': 85,
      'ABOVE_AVERAGE': 65,
      'OVERPRICED': 40,
      'SIGNIFICANTLY_OVERPRICED': 20,
      'SUSPICIOUSLY_LOW': 30
    };
    
    for (const cat of priceCategories) {
      priceScore += categoryScores[cat] || 50;
    }
    
    result.score = Math.round(priceScore / priceCategories.length);
    result.contribution = Math.round(result.score * result.weight / 100);
    
    // Set status
    if (result.score >= 75) {
      result.status = 'COMPETITIVE';
    } else if (result.score >= 50) {
      result.status = 'NEGOTIABLE';
    } else {
      result.status = 'OVERPRICED';
    }
    
    // Include pricing summary
    result.pricing_summary = {
      market_value_total: pricingAnalysis.pricing_summary.total_material_market_value,
      recommended_counter: pricingAnalysis.pricing_summary.recommended_counter_offer,
      test_costs: pricingAnalysis.pricing_summary.total_test_cost,
      grand_total: pricingAnalysis.pricing_summary.grand_total,
      potential_savings: pricingAnalysis.pricing_summary.potential_savings,
      savings_percentage: pricingAnalysis.pricing_summary.savings_percentage
    };
    
    // Add findings
    if (result.status === 'COMPETITIVE') {
      result.details.push({
        finding: 'Pricing is competitive with market rates',
        impact: 'Favorable position for negotiation',
        action: 'Proceed with minor discount requests'
      });
    } else if (result.status === 'NEGOTIABLE') {
      result.details.push({
        finding: 'Pricing is above market average',
        impact: 'Room for negotiation exists',
        action: `Counter offer at ${formatLakhsCrores(result.pricing_summary.recommended_counter)}`
      });
    } else {
      result.details.push({
        finding: 'Pricing is significantly above market',
        impact: 'May affect profitability',
        action: 'Strong negotiation required or consider alternatives'
      });
    }
    
    // Include product-level analysis
    result.product_pricing = pricingAnalysis.products.map(p => ({
      sku_id: p.sku_id,
      market_benchmark: p.market_benchmark,
      price_category: p.price_analysis.priceCategory,
      counter_offer: p.price_analysis.counterOffer.amount,
      recommendation: p.price_analysis.recommendation
    }));
    
    return result;
  }
  
  /**
   * Analyze company credibility
   */
  async analyzeCredibility(companyName) {
    const result = {
      score: 0,
      weight: this.weights.credibility.weight,
      contribution: 0,
      status: 'UNKNOWN',
      details: []
    };
    
    if (!companyName) {
      result.status = 'NOT_AVAILABLE';
      result.score = 50; // Default to medium if no company info
      result.details.push({
        finding: 'Company information not provided',
        impact: 'Cannot verify vendor credibility',
        action: 'Request company details for verification'
      });
      return result;
    }
    
    // Get credibility from OpenCorporates data
    const credibility = getCredibilityScore(companyName);
    
    result.score = credibility.score || 50;
    result.contribution = Math.round(result.score * result.weight / 100);
    result.label = credibility.label;
    result.company_info = {
      name: credibility.company,
      status: credibility.status,
      jurisdiction: credibility.jurisdiction,
      age_years: credibility.age_years,
      incorporation_date: credibility.incorporation_date,
      oc_url: credibility.oc_url,
      verified: credibility.confidence === 100
    };
    
    // Set status based on score
    if (result.score >= 75) {
      result.status = 'VERIFIED';
      result.details.push({
        finding: `Company verified with ${result.label} credibility`,
        impact: 'Reliable vendor',
        action: 'Proceed with standard due diligence'
      });
    } else if (result.score >= 50) {
      result.status = 'PARTIAL';
      result.details.push({
        finding: `Company has ${result.label} credibility score`,
        impact: 'Some verification available',
        action: 'Request additional references or certifications'
      });
    } else if (result.score > 0) {
      result.status = 'LOW';
      result.details.push({
        finding: 'Low credibility score',
        impact: 'Higher risk vendor',
        action: 'Perform enhanced due diligence or consider alternatives'
      });
    } else {
      result.status = 'UNVERIFIED';
      result.details.push({
        finding: 'Company not found in verified database',
        impact: 'Cannot verify vendor',
        action: 'Request official documentation for verification'
      });
    }
    
    return result;
  }
  
  /**
   * Analyze test coverage
   */
  analyzeTestCoverage(rfp, pricingComponent) {
    const result = {
      score: 0,
      weight: this.weights.test_coverage.weight,
      contribution: 0,
      status: 'UNKNOWN',
      details: []
    };
    
    const projectValue = rfp.estimated_cost_inr || 10000000;
    
    // Get scaled test costs
    const testCosts = calculateScaledTestCosts(projectValue, [
      { test_id: 'RT-001', name: 'Conductor Resistance' },
      { test_id: 'RT-002', name: 'High Voltage Test' },
      { test_id: 'RT-003', name: 'Insulation Resistance' },
      { test_id: 'TT-001', name: 'Partial Discharge' },
      { test_id: 'TT-003', name: 'Bending Test' },
      { test_id: 'AT-003', name: 'IR Test After Laying' },
      { test_id: 'AT-004', name: 'HV Test After Laying' }
    ]);
    
    // Evaluate test coverage adequacy
    const testPercentage = testCosts.summary.percentageOfProject;
    
    // Good test coverage is typically 2-5% of project value
    if (testPercentage >= 2 && testPercentage <= 5) {
      result.score = 100;
      result.status = 'ADEQUATE';
    } else if (testPercentage >= 1 && testPercentage < 2) {
      result.score = 70;
      result.status = 'MINIMAL';
    } else if (testPercentage > 5 && testPercentage <= 8) {
      result.score = 80;
      result.status = 'COMPREHENSIVE';
    } else if (testPercentage > 8) {
      result.score = 60;
      result.status = 'EXCESSIVE';
    } else {
      result.score = 40;
      result.status = 'INSUFFICIENT';
    }
    
    result.contribution = Math.round(result.score * result.weight / 100);
    
    // Include test breakdown
    result.test_summary = {
      routine_tests: testCosts.routine.length,
      type_tests: testCosts.type.length,
      acceptance_tests: testCosts.acceptance.length,
      special_tests: testCosts.special.length,
      total_cost: testCosts.summary.grandTotal,
      percentage_of_project: testPercentage
    };
    
    // Add findings
    result.details.push({
      finding: `Test coverage at ${testPercentage.toFixed(1)}% of project value`,
      impact: result.status === 'ADEQUATE' ? 'Proper quality assurance' : 
              result.status === 'EXCESSIVE' ? 'May increase costs unnecessarily' :
              'May not catch all quality issues',
      action: result.status === 'ADEQUATE' ? 'Test plan is appropriate' :
              result.status === 'EXCESSIVE' ? 'Review if all tests are necessary' :
              'Consider adding more tests for critical applications'
    });
    
    return result;
  }
  
  /**
   * Calculate overall score
   */
  calculateOverallScore(components) {
    let totalScore = 0;
    let totalWeight = 0;
    
    for (const [key, component] of Object.entries(components)) {
      totalScore += component.contribution || 0;
      totalWeight += component.weight || 0;
    }
    
    const overallScore = Math.round((totalScore / totalWeight) * 100);
    
    // Determine risk level
    let riskLevel = 'HIGH';
    let riskInfo = RISK_LEVELS.HIGH;
    
    if (overallScore >= RISK_LEVELS.LOW.min) {
      riskLevel = 'LOW';
      riskInfo = RISK_LEVELS.LOW;
    } else if (overallScore >= RISK_LEVELS.MEDIUM.min) {
      riskLevel = 'MEDIUM';
      riskInfo = RISK_LEVELS.MEDIUM;
    }
    
    // Generate recommendation
    let recommendation = '';
    let goNoGo = 'EVALUATE';
    
    if (overallScore >= 80) {
      recommendation = 'STRONGLY RECOMMENDED: Excellent match across all criteria. Proceed with bid preparation.';
      goNoGo = 'GO';
    } else if (overallScore >= 65) {
      recommendation = 'RECOMMENDED: Good overall fit with manageable gaps. Address specific issues before bidding.';
      goNoGo = 'GO';
    } else if (overallScore >= 50) {
      recommendation = 'CONDITIONAL: Significant areas need attention. Carefully evaluate risks and negotiate terms.';
      goNoGo = 'EVALUATE';
    } else {
      recommendation = 'NOT RECOMMENDED: Major gaps in specifications, pricing, or credibility. Consider alternatives.';
      goNoGo = 'NO_GO';
    }
    
    return {
      score: overallScore,
      risk_level: riskLevel,
      risk_color: riskInfo.color,
      risk_icon: riskInfo.icon,
      recommendation,
      go_no_go: goNoGo,
      score_breakdown: {
        spec_match: components.spec_match?.contribution || 0,
        price_analysis: components.price_analysis?.contribution || 0,
        credibility: components.credibility?.contribution || 0,
        test_coverage: components.test_coverage?.contribution || 0
      }
    };
  }
  
  /**
   * Generate action items
   */
  generateActionItems(analysis) {
    const items = [];
    let priority = 1;
    
    // Add items from each component
    for (const [key, component] of Object.entries(analysis.components)) {
      if (component.details) {
        for (const detail of component.details) {
          if (detail.action && !detail.action.includes('Proceed')) {
            items.push({
              priority: priority++,
              category: key,
              action: detail.action,
              urgency: component.score < 50 ? 'HIGH' : component.score < 70 ? 'MEDIUM' : 'LOW'
            });
          }
        }
      }
    }
    
    // Sort by urgency
    const urgencyOrder = { 'HIGH': 0, 'MEDIUM': 1, 'LOW': 2 };
    items.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);
    
    // Re-number priorities
    items.forEach((item, idx) => item.priority = idx + 1);
    
    return items;
  }
  
  /**
   * Create summary table for display
   */
  createSummaryTable(analysis) {
    return {
      headers: ['Factor', 'Score', 'Weight', 'Contribution', 'Status'],
      rows: [
        {
          factor: 'Specification Match',
          score: `${analysis.components.spec_match.score}%`,
          weight: `${analysis.components.spec_match.weight}%`,
          contribution: `${analysis.components.spec_match.contribution}`,
          status: analysis.components.spec_match.status
        },
        {
          factor: 'Price Competitiveness',
          score: `${analysis.components.price_analysis.score}%`,
          weight: `${analysis.components.price_analysis.weight}%`,
          contribution: `${analysis.components.price_analysis.contribution}`,
          status: analysis.components.price_analysis.status
        },
        {
          factor: 'Vendor Credibility',
          score: `${analysis.components.credibility.score}%`,
          weight: `${analysis.components.credibility.weight}%`,
          contribution: `${analysis.components.credibility.contribution}`,
          status: analysis.components.credibility.status
        },
        {
          factor: 'Test Coverage',
          score: `${analysis.components.test_coverage.score}%`,
          weight: `${analysis.components.test_coverage.weight}%`,
          contribution: `${analysis.components.test_coverage.contribution}`,
          status: analysis.components.test_coverage.status
        }
      ],
      totals: {
        overall_score: `${analysis.overall.score}%`,
        risk_level: analysis.overall.risk_level,
        decision: analysis.overall.go_no_go
      }
    };
  }
}

// Export singleton
let rubricInstance = null;

export function getAnalysisRubric() {
  if (!rubricInstance) {
    rubricInstance = new AnalysisRubric();
  }
  return rubricInstance;
}

export const analyzeRFP = async (params) => 
  getAnalysisRubric().generateCompleteAnalysis(params);

export default {
  AnalysisRubric,
  getAnalysisRubric,
  analyzeRFP,
  RUBRIC_WEIGHTS,
  RISK_LEVELS
};







