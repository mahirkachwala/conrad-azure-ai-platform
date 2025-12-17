/**
 * Enhanced Spec Matcher Service
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Provides intelligent specification matching with:
 * - Detailed deviation analysis for each specification
 * - Clear indicators of what matches and what doesn't
 * - Intelligent suggestions on which compromises are better
 * - Configurable matching priorities based on application
 */

import { getOEMProducts } from './oem-datasheets.js';

// Specification importance weights by application type
// Higher weight = more important to match exactly
const SPEC_IMPORTANCE = {
  // For power cables, conductor material is critical
  'power_distribution': {
    conductor_material: 100,     // Must match - copper vs aluminum matters for conductivity
    voltage_rating: 95,          // Must match - safety critical
    insulation_material: 85,     // Very important for durability
    cross_section_area: 75,      // Important but can size up
    no_of_cores: 70,             // Can sometimes adjust
    armour: 60,                  // Important for protection
    temperature_rating: 55       // Can usually go higher
  },
  // For control cables, core count is critical
  'control': {
    no_of_cores: 100,            // Must match - need exact I/O count
    voltage_rating: 90,
    cross_section_area: 80,
    conductor_material: 70,      // Usually copper preferred but less critical
    insulation_material: 65,
    armour: 60,
    temperature_rating: 50
  },
  // For instrumentation, shielding and signal integrity matter
  'instrumentation': {
    no_of_cores: 95,
    voltage_rating: 85,
    conductor_material: 80,      // Copper preferred for signal
    insulation_material: 75,
    cross_section_area: 70,
    armour: 65,
    temperature_rating: 50
  },
  // Default for general applications
  'default': {
    voltage_rating: 100,
    conductor_material: 90,
    cross_section_area: 85,
    insulation_material: 80,
    no_of_cores: 75,
    armour: 60,
    temperature_rating: 50
  }
};

// Acceptable deviation thresholds for each spec
const DEVIATION_THRESHOLDS = {
  cross_section_area: {
    exact: 0,              // 0% deviation = exact match
    acceptable: 0.10,      // ±10% is acceptable
    marginal: 0.20,        // ±20% is marginal
    // Beyond marginal = mismatch
    canSizeUp: true,       // Usually can use larger size
    sizeUpPenalty: 0.1     // 10% penalty for sizing up
  },
  voltage_rating: {
    exact: 0,
    acceptable: 0,         // Must meet minimum
    canExceed: true,       // Can exceed (safer)
    exceedPenalty: 0       // No penalty for higher voltage rating
  },
  no_of_cores: {
    exact: 0,
    acceptable: 0,         // Usually must match exactly
    canExceed: true,       // Can have more cores (but wasteful)
    exceedPenalty: 0.15    // 15% penalty per extra core
  },
  temperature_rating: {
    exact: 0,
    acceptable: 0,         // Must meet minimum
    canExceed: true,       // Can exceed
    exceedPenalty: 0       // No penalty for higher temp rating
  }
};

/**
 * Main class for enhanced specification matching
 */
export class EnhancedSpecMatcher {
  constructor() {
    this.oemProducts = getOEMProducts();
  }
  
  /**
   * Parse specifications from RFP requirement text
   * @param {string} requirementText - Raw requirement text
   * @returns {Object} Parsed specifications
   */
  parseRequirement(requirementText) {
    const text = requirementText.toLowerCase();
    const specs = {};
    
    // Voltage (kV or V)
    const kvMatch = text.match(/(\d+(?:\.\d+)?)\s*kv/i);
    const vMatch = text.match(/(\d+)\s*v(?:olt)?(?!\s*a)/i);
    if (kvMatch) {
      specs.voltage_rating = parseFloat(kvMatch[1]) * 1000;
      specs.voltage_display = `${kvMatch[1]}kV`;
    } else if (vMatch && parseInt(vMatch[1]) >= 100) {
      specs.voltage_rating = parseInt(vMatch[1]);
      specs.voltage_display = `${vMatch[1]}V`;
    }
    
    // Cross-section area (sq mm, sqmm, mm², mm2)
    const areaMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*mm|sqmm|mm2|mm²)/i);
    if (areaMatch) {
      specs.cross_section_area = parseFloat(areaMatch[1]);
    }
    
    // Number of cores
    const coreMatch = text.match(/(\d+)\s*(?:core|c\b|cores)/i);
    if (coreMatch) {
      specs.no_of_cores = parseInt(coreMatch[1]);
    }
    
    // Conductor material
    if (text.includes('copper') || text.match(/\bcu\b/) || text.includes('cu-')) {
      specs.conductor_material = 'Copper';
    } else if (text.includes('aluminium') || text.includes('aluminum') || text.match(/\bal\b/) || text.includes('al-')) {
      specs.conductor_material = 'Aluminium';
    }
    
    // Insulation material
    if (text.includes('xlpe')) {
      specs.insulation_material = 'XLPE';
    } else if (text.includes('pvc')) {
      specs.insulation_material = 'PVC';
    }
    
    // Armour
    if (text.includes('armoured') || text.includes('armored') || text.includes('swa')) {
      specs.armoured = true;
    } else if (text.includes('unarmoured') || text.includes('unarmored')) {
      specs.armoured = false;
    }
    
    // Temperature rating
    const tempMatch = text.match(/(\d+)\s*°?c(?:\s|$)/i);
    if (tempMatch && parseInt(tempMatch[1]) >= 50 && parseInt(tempMatch[1]) <= 150) {
      specs.temperature_rating = parseInt(tempMatch[1]);
    }
    
    // Detect application type for weight prioritization
    specs._application = this.detectApplication(text);
    
    return specs;
  }
  
  /**
   * Detect application type from requirement text
   */
  detectApplication(text) {
    if (text.includes('control') || text.includes('plc') || text.includes('automation')) {
      return 'control';
    }
    if (text.includes('instrument') || text.includes('signal') || text.includes('transmitter')) {
      return 'instrumentation';
    }
    if (text.includes('ht') || text.includes('high tension') || text.includes('power') || text.includes('distribution')) {
      return 'power_distribution';
    }
    return 'default';
  }
  
  /**
   * Calculate detailed match for a single specification
   */
  calculateSpecMatch(rfpValue, oemValue, specName, importance) {
    const result = {
      spec_name: specName,
      rfp_requirement: rfpValue,
      oem_value: oemValue,
      importance: importance,
      match_status: 'UNKNOWN',
      match_score: 0,
      deviation: null,
      deviation_percent: null,
      suggestion: null
    };
    
    // Handle undefined values
    if (rfpValue === undefined || rfpValue === null) {
      result.match_status = 'NOT_SPECIFIED';
      result.match_score = 100; // If not specified, any value works
      return result;
    }
    
    if (oemValue === undefined || oemValue === null) {
      result.match_status = 'NOT_AVAILABLE';
      result.match_score = 0;
      result.suggestion = `OEM product does not specify ${specName}`;
      return result;
    }
    
    // Handle different types of comparisons
    switch (specName) {
      case 'conductor_material':
      case 'insulation_material':
        return this.matchMaterial(rfpValue, oemValue, specName, importance);
      
      case 'voltage_rating':
        return this.matchVoltage(rfpValue, oemValue, importance);
      
      case 'cross_section_area':
        return this.matchCrossSection(rfpValue, oemValue, importance);
      
      case 'no_of_cores':
        return this.matchCores(rfpValue, oemValue, importance);
      
      case 'temperature_rating':
        return this.matchTemperature(rfpValue, oemValue, importance);
      
      case 'armoured':
        return this.matchArmour(rfpValue, oemValue, importance);
      
      default:
        // Generic string/number comparison
        if (typeof rfpValue === 'string') {
          const matches = rfpValue.toLowerCase() === String(oemValue).toLowerCase();
          result.match_status = matches ? 'EXACT_MATCH' : 'MISMATCH';
          result.match_score = matches ? 100 : 0;
        } else if (typeof rfpValue === 'number') {
          const matches = rfpValue === oemValue;
          result.match_status = matches ? 'EXACT_MATCH' : 'MISMATCH';
          result.match_score = matches ? 100 : 0;
        }
        return result;
    }
  }
  
  /**
   * Match material specifications (conductor, insulation)
   */
  matchMaterial(rfpValue, oemValue, specName, importance) {
    const result = {
      spec_name: specName,
      rfp_requirement: rfpValue,
      oem_value: oemValue,
      importance,
      match_status: 'UNKNOWN',
      match_score: 0,
      deviation: null,
      suggestion: null
    };
    
    const rfpLower = String(rfpValue).toLowerCase();
    const oemLower = String(oemValue).toLowerCase();
    
    if (rfpLower === oemLower) {
      result.match_status = 'EXACT_MATCH';
      result.match_score = 100;
      return result;
    }
    
    // Material mismatches - provide specific guidance
    if (specName === 'conductor_material') {
      result.match_status = 'MISMATCH';
      result.match_score = 0;
      
      if (rfpLower.includes('copper') && oemLower.includes('aluminium')) {
        result.suggestion = 'OEM offers Aluminium instead of Copper. Aluminium has higher resistance and requires larger cross-section for same current capacity. NOT RECOMMENDED for critical power applications.';
        result.deviation = 'MATERIAL_DOWNGRADE';
      } else if (rfpLower.includes('aluminium') && oemLower.includes('copper')) {
        result.suggestion = 'OEM offers Copper instead of Aluminium. Copper is better conductor but more expensive. ACCEPTABLE upgrade if budget allows.';
        result.deviation = 'MATERIAL_UPGRADE';
        result.match_score = 70; // Partial credit for upgrade
      }
    } else if (specName === 'insulation_material') {
      result.match_status = 'MISMATCH';
      result.match_score = 0;
      
      if (rfpLower.includes('xlpe') && oemLower.includes('pvc')) {
        result.suggestion = 'OEM offers PVC instead of XLPE. PVC has lower temperature rating (70°C vs 90°C) and shorter lifespan. NOT RECOMMENDED for high-load or outdoor applications.';
        result.deviation = 'INSULATION_DOWNGRADE';
      } else if (rfpLower.includes('pvc') && oemLower.includes('xlpe')) {
        result.suggestion = 'OEM offers XLPE instead of PVC. XLPE is superior with higher temperature rating and longer life. ACCEPTABLE upgrade.';
        result.deviation = 'INSULATION_UPGRADE';
        result.match_score = 80; // Good partial credit
      }
    }
    
    return result;
  }
  
  /**
   * Match voltage rating
   */
  matchVoltage(rfpValue, oemValue, importance) {
    const result = {
      spec_name: 'voltage_rating',
      rfp_requirement: `${rfpValue}V`,
      oem_value: `${oemValue}V`,
      importance,
      match_status: 'UNKNOWN',
      match_score: 0,
      deviation: null,
      deviation_percent: null,
      suggestion: null
    };
    
    if (oemValue === rfpValue) {
      result.match_status = 'EXACT_MATCH';
      result.match_score = 100;
      return result;
    }
    
    if (oemValue > rfpValue) {
      // OEM exceeds requirement - acceptable
      const excessPercent = ((oemValue - rfpValue) / rfpValue) * 100;
      result.match_status = 'EXCEEDS_REQUIREMENT';
      result.match_score = 100; // No penalty for higher voltage rating
      result.deviation = `+${Math.round(excessPercent)}%`;
      result.suggestion = `OEM voltage rating (${oemValue}V) exceeds requirement (${rfpValue}V). ACCEPTABLE - provides safety margin.`;
    } else {
      // OEM below requirement - NOT acceptable
      const shortfall = ((rfpValue - oemValue) / rfpValue) * 100;
      result.match_status = 'BELOW_REQUIREMENT';
      result.match_score = 0;
      result.deviation = `-${Math.round(shortfall)}%`;
      result.suggestion = `OEM voltage rating (${oemValue}V) is BELOW requirement (${rfpValue}V). NOT ACCEPTABLE - safety critical.`;
    }
    
    return result;
  }
  
  /**
   * Match cross-section area with tolerance
   */
  matchCrossSection(rfpValue, oemValue, importance) {
    const result = {
      spec_name: 'cross_section_area',
      rfp_requirement: `${rfpValue} sq.mm`,
      oem_value: `${oemValue} sq.mm`,
      importance,
      match_status: 'UNKNOWN',
      match_score: 0,
      deviation: null,
      deviation_percent: null,
      suggestion: null
    };
    
    if (oemValue === rfpValue) {
      result.match_status = 'EXACT_MATCH';
      result.match_score = 100;
      return result;
    }
    
    const deviationPercent = ((oemValue - rfpValue) / rfpValue) * 100;
    result.deviation_percent = Math.round(deviationPercent * 100) / 100;
    
    if (oemValue > rfpValue) {
      // Larger size
      result.deviation = `+${Math.round(deviationPercent)}%`;
      
      if (deviationPercent <= 15) {
        result.match_status = 'ACCEPTABLE_LARGER';
        result.match_score = 90 - deviationPercent; // Small penalty
        result.suggestion = `OEM size is ${Math.round(deviationPercent)}% larger than required. ACCEPTABLE - better current capacity but slightly higher cost.`;
      } else if (deviationPercent <= 30) {
        result.match_status = 'MARGINAL_LARGER';
        result.match_score = 70 - (deviationPercent - 15);
        result.suggestion = `OEM size is ${Math.round(deviationPercent)}% larger than required. MARGINAL - may be oversized for application. Consider cost implications.`;
      } else {
        result.match_status = 'OVERSIZED';
        result.match_score = 40;
        result.suggestion = `OEM size (${oemValue} sq.mm) is significantly larger than required (${rfpValue} sq.mm). NOT RECOMMENDED - oversized and costly.`;
      }
    } else {
      // Smaller size
      result.deviation = `${Math.round(deviationPercent)}%`;
      const shortfall = Math.abs(deviationPercent);
      
      if (shortfall <= 10) {
        result.match_status = 'MARGINAL_SMALLER';
        result.match_score = 60 - shortfall * 2;
        result.suggestion = `OEM size is ${Math.round(shortfall)}% smaller than required. CONDITIONAL - verify current capacity is sufficient.`;
      } else {
        result.match_status = 'UNDERSIZED';
        result.match_score = 0;
        result.suggestion = `OEM size (${oemValue} sq.mm) is BELOW requirement (${rfpValue} sq.mm). NOT ACCEPTABLE - insufficient current capacity.`;
      }
    }
    
    return result;
  }
  
  /**
   * Match number of cores
   */
  matchCores(rfpValue, oemValue, importance) {
    const result = {
      spec_name: 'no_of_cores',
      rfp_requirement: `${rfpValue} core`,
      oem_value: `${oemValue} core`,
      importance,
      match_status: 'UNKNOWN',
      match_score: 0,
      deviation: null,
      suggestion: null
    };
    
    if (oemValue === rfpValue) {
      result.match_status = 'EXACT_MATCH';
      result.match_score = 100;
      return result;
    }
    
    if (oemValue > rfpValue) {
      const extra = oemValue - rfpValue;
      result.deviation = `+${extra} cores`;
      
      if (extra <= 2) {
        result.match_status = 'ACCEPTABLE_MORE_CORES';
        result.match_score = 85 - (extra * 10);
        result.suggestion = `OEM has ${extra} extra core(s). ACCEPTABLE - spare capacity available but slightly higher cost.`;
      } else {
        result.match_status = 'EXCESSIVE_CORES';
        result.match_score = 50;
        result.suggestion = `OEM has ${extra} extra cores. MARGINAL - significantly oversized. Consider if spare capacity is needed.`;
      }
    } else {
      const shortfall = rfpValue - oemValue;
      result.deviation = `-${shortfall} cores`;
      result.match_status = 'INSUFFICIENT_CORES';
      result.match_score = 0;
      result.suggestion = `OEM has ${shortfall} fewer cores than required. NOT ACCEPTABLE - insufficient I/O capacity.`;
    }
    
    return result;
  }
  
  /**
   * Match temperature rating
   */
  matchTemperature(rfpValue, oemValue, importance) {
    const result = {
      spec_name: 'temperature_rating',
      rfp_requirement: `${rfpValue}°C`,
      oem_value: `${oemValue}°C`,
      importance,
      match_status: 'UNKNOWN',
      match_score: 0,
      deviation: null,
      suggestion: null
    };
    
    if (oemValue >= rfpValue) {
      if (oemValue === rfpValue) {
        result.match_status = 'EXACT_MATCH';
      } else {
        result.match_status = 'EXCEEDS_REQUIREMENT';
        result.deviation = `+${oemValue - rfpValue}°C`;
      }
      result.match_score = 100;
      result.suggestion = oemValue > rfpValue 
        ? `OEM temperature rating exceeds requirement. ACCEPTABLE - provides margin for overload conditions.`
        : null;
    } else {
      result.match_status = 'BELOW_REQUIREMENT';
      result.match_score = 0;
      result.deviation = `-${rfpValue - oemValue}°C`;
      result.suggestion = `OEM temperature rating (${oemValue}°C) is BELOW requirement (${rfpValue}°C). NOT ACCEPTABLE - may fail under load.`;
    }
    
    return result;
  }
  
  /**
   * Match armour requirement
   */
  matchArmour(rfpValue, oemValue, importance) {
    const result = {
      spec_name: 'armoured',
      rfp_requirement: rfpValue ? 'Armoured' : 'Unarmoured',
      oem_value: oemValue ? 'Armoured' : 'Unarmoured',
      importance,
      match_status: 'UNKNOWN',
      match_score: 0,
      deviation: null,
      suggestion: null
    };
    
    // Normalize OEM value (might be string like "Steel Wire Armoured")
    const oemArmoured = typeof oemValue === 'string' 
      ? oemValue.toLowerCase().includes('armour') 
      : oemValue === true;
    
    if (rfpValue === oemArmoured) {
      result.match_status = 'EXACT_MATCH';
      result.match_score = 100;
    } else if (rfpValue && !oemArmoured) {
      result.match_status = 'MISSING_ARMOUR';
      result.match_score = 0;
      result.suggestion = 'RFP requires armoured cable but OEM product is unarmoured. NOT ACCEPTABLE for buried/industrial installations.';
    } else if (!rfpValue && oemArmoured) {
      result.match_status = 'HAS_ARMOUR';
      result.match_score = 90;
      result.suggestion = 'OEM product has armour not required by RFP. ACCEPTABLE - extra protection but slightly higher cost.';
    }
    
    return result;
  }
  
  /**
   * Find and analyze matches for an RFP requirement
   * @param {string} requirementText - RFP requirement description
   * @param {Object} options - Matching options
   * @returns {Object} Comprehensive matching results
   */
  findMatches(requirementText, options = {}) {
    const topN = options.topN || 5;
    const rfpSpecs = this.parseRequirement(requirementText);
    const applicationType = rfpSpecs._application;
    const weights = SPEC_IMPORTANCE[applicationType] || SPEC_IMPORTANCE.default;
    
    const results = {
      rfp_requirement: requirementText,
      parsed_specs: rfpSpecs,
      application_type: applicationType,
      matching_weights: weights,
      matches: [],
      best_match: null,
      compromise_analysis: null
    };
    
    // Calculate match for each OEM product
    const scoredProducts = [];
    
    for (const oem of this.oemProducts) {
      const oemSpecs = oem.specifications || oem;
      const specMatches = [];
      let totalWeight = 0;
      let weightedScore = 0;
      
      // Match each specification
      const specsToCheck = [
        { key: 'voltage_rating', rfp: rfpSpecs.voltage_rating, oem: oemSpecs.voltage_rating_v || oemSpecs.voltage },
        { key: 'cross_section_area', rfp: rfpSpecs.cross_section_area, oem: oemSpecs.conductor_cross_section_mm2 || oemSpecs.cross_section_area },
        { key: 'conductor_material', rfp: rfpSpecs.conductor_material, oem: oemSpecs.conductor_material },
        { key: 'insulation_material', rfp: rfpSpecs.insulation_material, oem: oemSpecs.insulation_material },
        { key: 'no_of_cores', rfp: rfpSpecs.no_of_cores, oem: oemSpecs.no_of_cores },
        { key: 'temperature_rating', rfp: rfpSpecs.temperature_rating, oem: oemSpecs.temperature_rating_c || oemSpecs.temperature_rating },
        { key: 'armoured', rfp: rfpSpecs.armoured, oem: oemSpecs.armour_type || oemSpecs.armoured }
      ];
      
      for (const spec of specsToCheck) {
        if (spec.rfp === undefined) continue;
        
        const importance = weights[spec.key] || 50;
        const matchResult = this.calculateSpecMatch(spec.rfp, spec.oem, spec.key, importance);
        specMatches.push(matchResult);
        
        totalWeight += importance;
        weightedScore += (matchResult.match_score / 100) * importance;
      }
      
      const overallScore = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;
      
      // Categorize match quality
      let matchCategory = 'POOR';
      if (overallScore >= 90) matchCategory = 'EXCELLENT';
      else if (overallScore >= 75) matchCategory = 'GOOD';
      else if (overallScore >= 60) matchCategory = 'ACCEPTABLE';
      else if (overallScore >= 40) matchCategory = 'MARGINAL';
      
      // Identify mismatches and partial matches
      const exactMatches = specMatches.filter(s => s.match_status === 'EXACT_MATCH');
      const partialMatches = specMatches.filter(s => 
        s.match_status.includes('ACCEPTABLE') || 
        s.match_status === 'EXCEEDS_REQUIREMENT'
      );
      const mismatches = specMatches.filter(s => 
        s.match_score === 0 && s.match_status !== 'NOT_SPECIFIED'
      );
      
      scoredProducts.push({
        sku_id: oem.sku_id,
        product_name: oem.product_name,
        category: oem.category,
        overall_score: overallScore,
        match_category: matchCategory,
        unit_price: oem.unit_price_inr_per_km,
        lead_time_days: oem.lead_time_days,
        
        // Detailed breakdown
        spec_matches: specMatches,
        summary: {
          exact_matches: exactMatches.length,
          partial_matches: partialMatches.length,
          mismatches: mismatches.length,
          total_specs_checked: specMatches.length
        },
        
        // Quick reference for issues
        issues: mismatches.map(m => ({
          spec: m.spec_name,
          problem: m.match_status,
          suggestion: m.suggestion
        })),
        
        // Partial matches that might be acceptable
        compromises: partialMatches.map(p => ({
          spec: p.spec_name,
          deviation: p.deviation,
          suggestion: p.suggestion
        }))
      });
    }
    
    // Sort by overall score
    scoredProducts.sort((a, b) => b.overall_score - a.overall_score);
    
    // Get top N matches
    results.matches = scoredProducts.slice(0, topN);
    results.best_match = results.matches[0] || null;
    
    // Generate compromise analysis
    results.compromise_analysis = this.generateCompromiseAnalysis(results.matches, rfpSpecs);
    
    return results;
  }
  
  /**
   * Generate analysis of best compromises to make
   */
  generateCompromiseAnalysis(matches, rfpSpecs) {
    if (matches.length === 0) return null;
    
    const analysis = {
      recommendation: '',
      preferred_compromise: null,
      compromise_options: []
    };
    
    // Look at what specs are most commonly mismatched
    const specMismatchCount = {};
    const specPartialCount = {};
    
    for (const match of matches) {
      for (const spec of match.spec_matches) {
        if (spec.match_score === 0 && spec.match_status !== 'NOT_SPECIFIED') {
          specMismatchCount[spec.spec_name] = (specMismatchCount[spec.spec_name] || 0) + 1;
        } else if (spec.match_score > 0 && spec.match_score < 100) {
          specPartialCount[spec.spec_name] = (specPartialCount[spec.spec_name] || 0) + 1;
        }
      }
    }
    
    // Identify best compromise option
    const compromiseRanking = [
      { spec: 'cross_section_area', reason: 'Sizing up provides better capacity with minimal cost impact', priority: 1 },
      { spec: 'temperature_rating', reason: 'Higher rating provides safety margin with minimal impact', priority: 2 },
      { spec: 'no_of_cores', reason: 'Extra cores provide spare capacity for future expansion', priority: 3 },
      { spec: 'armoured', reason: 'Extra armour provides protection but adds cost', priority: 4 },
      { spec: 'insulation_material', reason: 'XLPE upgrade over PVC is generally beneficial', priority: 5 },
      { spec: 'conductor_material', reason: 'Material changes significantly impact performance - avoid if possible', priority: 6 },
      { spec: 'voltage_rating', reason: 'Voltage rating is safety critical - never compromise downward', priority: 7 }
    ];
    
    // Determine recommendation
    const bestMatch = matches[0];
    
    if (bestMatch.match_category === 'EXCELLENT') {
      analysis.recommendation = 'EXACT MATCH AVAILABLE: Top product matches all specifications with minimal or no deviation.';
    } else if (bestMatch.match_category === 'GOOD') {
      analysis.recommendation = 'GOOD MATCH: Top product has minor acceptable deviations that do not affect functionality.';
    } else if (bestMatch.match_category === 'ACCEPTABLE') {
      // Analyze what compromises are being made
      const issues = bestMatch.issues;
      const compromises = bestMatch.compromises;
      
      if (issues.length > 0) {
        analysis.recommendation = `COMPROMISES REQUIRED: ${issues.length} specification(s) do not match exactly. `;
        
        // Find best compromise to make
        for (const cr of compromiseRanking) {
          if (specPartialCount[cr.spec] > 0 && !specMismatchCount[cr.spec]) {
            analysis.preferred_compromise = {
              spec: cr.spec,
              reason: cr.reason
            };
            analysis.recommendation += `Recommended: Accept ${cr.spec} deviation. ${cr.reason}.`;
            break;
          }
        }
      }
    } else {
      analysis.recommendation = 'NO GOOD MATCH: Consider requesting alternative products from vendor or revising specifications.';
    }
    
    // List compromise options
    for (const cr of compromiseRanking) {
      if (specPartialCount[cr.spec]) {
        analysis.compromise_options.push({
          spec: cr.spec,
          frequency: specPartialCount[cr.spec],
          reason: cr.reason,
          recommended: cr.priority <= 3
        });
      }
    }
    
    return analysis;
  }
}

// Export singleton instance
let matcherInstance = null;

export function getEnhancedMatcher() {
  if (!matcherInstance) {
    matcherInstance = new EnhancedSpecMatcher();
  }
  return matcherInstance;
}

export const matchWithDeviation = (requirement, options) => 
  getEnhancedMatcher().findMatches(requirement, options);

export default {
  EnhancedSpecMatcher,
  getEnhancedMatcher,
  matchWithDeviation,
  SPEC_IMPORTANCE,
  DEVIATION_THRESHOLDS
};







