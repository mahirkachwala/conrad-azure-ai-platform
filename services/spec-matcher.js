/**
 * Spec Matcher Module
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Implements the EY-required Spec Match Metric:
 * spec_match = (matched_spec_count / total_spec_count) * 100
 * 
 * This is critical for Round 2 scoring (25% of marks)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PATHS } from '../configs/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache for OEM specs
let oemSpecsCache = null;

/**
 * Parse CSV to array of objects
 */
function parseCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => {
      let val = values[i] || '';
      // Convert numeric values
      if (/^\d+$/.test(val)) val = parseInt(val, 10);
      else if (/^\d+\.\d+$/.test(val)) val = parseFloat(val);
      obj[h] = val;
    });
    return obj;
  });
}

/**
 * Load OEM specs from CSV
 */
function loadOEMSpecs() {
  if (oemSpecsCache) return oemSpecsCache;
  
  try {
    const dataPath = PATHS.data || path.join(__dirname, '..', 'data');
    const csvPath = path.join(dataPath, 'oem_specs.csv');
    const content = fs.readFileSync(csvPath, 'utf8');
    oemSpecsCache = parseCSV(content);
    return oemSpecsCache;
  } catch (error) {
    console.error('Error loading OEM specs:', error.message);
    return [];
  }
}

/**
 * Parse RFP requirement text to extract specifications
 * @param {string} requirementText - Raw RFP product requirement text
 * @returns {Object} Parsed specifications
 */
export function parseRFPSpecs(requirementText) {
  const text = requirementText.toLowerCase();
  const specs = {};
  
  // Voltage extraction (V or kV)
  const kvMatch = text.match(/(\d+(?:\.\d+)?)\s*kv/i);
  const vMatch = text.match(/(\d+)\s*v(?:olt)?/i);
  if (kvMatch) {
    specs.voltage = parseFloat(kvMatch[1]) * 1000;
  } else if (vMatch) {
    specs.voltage = parseInt(vMatch[1], 10);
  }
  
  // Cross-section area (sq mm, sqmm, mm2)
  const areaMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*mm|sqmm|mm2|mm²)/i);
  if (areaMatch) {
    specs.cross_section_area = parseFloat(areaMatch[1]);
  }
  
  // Number of cores
  const coreMatch = text.match(/(\d+)\s*(?:core|c\b|cores)/i);
  if (coreMatch) {
    specs.no_of_cores = parseInt(coreMatch[1], 10);
  }
  
  // Conductor material
  if (text.includes('copper') || text.includes(' cu ') || text.includes('cu-')) {
    specs.conductor_material = 'Copper';
  } else if (text.includes('aluminium') || text.includes('aluminum') || text.includes(' al ') || text.includes('al-')) {
    specs.conductor_material = 'Aluminium';
  }
  
  // Insulation material
  if (text.includes('xlpe')) {
    specs.insulation_material = 'XLPE';
  } else if (text.includes('pvc')) {
    specs.insulation_material = 'PVC';
  }
  
  // Armoured
  if (text.includes('armoured') || text.includes('armored') || text.includes('swa')) {
    specs.armoured = true;
  } else if (text.includes('unarmoured') || text.includes('unarmored')) {
    specs.armoured = false;
  }
  
  // Temperature rating
  const tempMatch = text.match(/(\d+)\s*°?c/i);
  if (tempMatch) {
    specs.temperature_rating = parseInt(tempMatch[1], 10);
  }
  
  // Standard
  if (text.includes('is 7098')) specs.standard = 'IS 7098';
  else if (text.includes('is 694')) specs.standard = 'IS 694';
  else if (text.includes('is 1554')) specs.standard = 'IS 1554';
  else if (text.includes('iec 60840')) specs.standard = 'IEC 60840';
  
  // Application type detection
  if (text.includes('control')) specs.application = 'Control';
  else if (text.includes('instrument')) specs.application = 'Instrumentation';
  else if (text.includes('power') || text.includes('distribution')) specs.application = 'Power Distribution';
  else if (text.includes('transmission') || text.includes('ehv')) specs.application = 'Transmission';
  else if (text.includes('industrial')) specs.application = 'Industrial';
  else if (text.includes('building')) specs.application = 'Building';
  
  return specs;
}

/**
 * Calculate spec match score between RFP requirement and OEM product
 * This is the KEY METRIC for EY judging (25% of marks)
 * 
 * @param {Object} rfpSpecs - Parsed RFP specifications
 * @param {Object} oemProduct - OEM product specifications
 * @returns {Object} Match details with score
 */
export function calculateSpecMatch(rfpSpecs, oemProduct) {
  const matchDetails = {
    matched: [],
    unmatched: [],
    partial: [],
    total_specs: 0,
    matched_count: 0,
    partial_count: 0,
    spec_match_percentage: 0
  };
  
  // Define spec comparisons with weights
  const specChecks = [
    {
      name: 'voltage',
      weight: 1,
      check: () => {
        if (rfpSpecs.voltage === undefined) return null;
        const rfpV = rfpSpecs.voltage;
        const oemV = oemProduct.voltage;
        if (rfpV === oemV) return { match: 'exact', score: 1 };
        // ±10% tolerance
        if (Math.abs(rfpV - oemV) / rfpV <= 0.1) return { match: 'partial', score: 0.8 };
        // ±20% for close match
        if (Math.abs(rfpV - oemV) / rfpV <= 0.2) return { match: 'partial', score: 0.5 };
        return { match: 'none', score: 0 };
      }
    },
    {
      name: 'cross_section_area',
      weight: 1,
      check: () => {
        if (rfpSpecs.cross_section_area === undefined) return null;
        const rfpArea = rfpSpecs.cross_section_area;
        const oemArea = oemProduct.cross_section_area;
        if (rfpArea === oemArea) return { match: 'exact', score: 1 };
        // Standard sizes nearby
        const tolerance = rfpArea * 0.15;
        if (Math.abs(rfpArea - oemArea) <= tolerance) return { match: 'partial', score: 0.7 };
        return { match: 'none', score: 0 };
      }
    },
    {
      name: 'conductor_material',
      weight: 1,
      check: () => {
        if (!rfpSpecs.conductor_material) return null;
        const rfpMat = rfpSpecs.conductor_material.toLowerCase();
        const oemMat = (oemProduct.conductor_material || '').toLowerCase();
        if (rfpMat === oemMat) return { match: 'exact', score: 1 };
        return { match: 'none', score: 0 };
      }
    },
    {
      name: 'insulation_material',
      weight: 1,
      check: () => {
        if (!rfpSpecs.insulation_material) return null;
        const rfpIns = rfpSpecs.insulation_material.toLowerCase();
        const oemIns = (oemProduct.insulation_material || '').toLowerCase();
        if (rfpIns === oemIns) return { match: 'exact', score: 1 };
        return { match: 'none', score: 0 };
      }
    },
    {
      name: 'no_of_cores',
      weight: 1,
      check: () => {
        if (rfpSpecs.no_of_cores === undefined) return null;
        if (rfpSpecs.no_of_cores === oemProduct.no_of_cores) return { match: 'exact', score: 1 };
        return { match: 'none', score: 0 };
      }
    },
    {
      name: 'armoured',
      weight: 0.5,
      check: () => {
        if (rfpSpecs.armoured === undefined) return null;
        const oemArmoured = oemProduct.armoured === 'Yes' || oemProduct.armoured === true;
        if (rfpSpecs.armoured === oemArmoured) return { match: 'exact', score: 1 };
        return { match: 'none', score: 0 };
      }
    },
    {
      name: 'temperature_rating',
      weight: 0.5,
      check: () => {
        if (rfpSpecs.temperature_rating === undefined) return null;
        const rfpTemp = rfpSpecs.temperature_rating;
        const oemTemp = oemProduct.temperature_rating;
        if (oemTemp >= rfpTemp) return { match: 'exact', score: 1 };
        if (oemTemp >= rfpTemp * 0.9) return { match: 'partial', score: 0.7 };
        return { match: 'none', score: 0 };
      }
    },
    {
      name: 'standard',
      weight: 0.5,
      check: () => {
        if (!rfpSpecs.standard) return null;
        const rfpStd = rfpSpecs.standard.toLowerCase();
        const oemStd = (oemProduct.standard || '').toLowerCase();
        if (oemStd.includes(rfpStd) || rfpStd.includes(oemStd)) return { match: 'exact', score: 1 };
        return { match: 'none', score: 0 };
      }
    }
  ];
  
  let totalWeight = 0;
  let matchedWeight = 0;
  
  for (const spec of specChecks) {
    const result = spec.check();
    if (result === null) continue; // Spec not specified in RFP
    
    totalWeight += spec.weight;
    matchDetails.total_specs++;
    
    if (result.match === 'exact') {
      matchedWeight += spec.weight * result.score;
      matchDetails.matched_count++;
      matchDetails.matched.push({
        spec: spec.name,
        rfp_value: rfpSpecs[spec.name],
        oem_value: oemProduct[spec.name]
      });
    } else if (result.match === 'partial') {
      matchedWeight += spec.weight * result.score;
      matchDetails.partial_count++;
      matchDetails.partial.push({
        spec: spec.name,
        rfp_value: rfpSpecs[spec.name],
        oem_value: oemProduct[spec.name],
        score: result.score
      });
    } else {
      matchDetails.unmatched.push({
        spec: spec.name,
        rfp_value: rfpSpecs[spec.name],
        oem_value: oemProduct[spec.name]
      });
    }
  }
  
  // Calculate final percentage
  matchDetails.spec_match_percentage = totalWeight > 0 
    ? Math.round((matchedWeight / totalWeight) * 100)
    : 0;
  
  return matchDetails;
}

/**
 * Find top N matching SKUs for an RFP requirement
 * 
 * @param {string} requirementText - RFP product requirement text
 * @param {number} topN - Number of top matches to return (default: 3)
 * @returns {Array} Array of matched products with scores
 */
export function findTopMatches(requirementText, topN = 3) {
  const oemProducts = loadOEMSpecs();
  if (oemProducts.length === 0) {
    return [];
  }
  
  // Parse RFP requirement
  const rfpSpecs = parseRFPSpecs(requirementText);
  
  // Calculate match score for each OEM product
  const scoredProducts = oemProducts.map(product => {
    const matchDetails = calculateSpecMatch(rfpSpecs, product);
    return {
      sku_id: product.sku_id,
      product_name: product.product_name,
      spec_match_percentage: matchDetails.spec_match_percentage,
      match_details: matchDetails,
      unit_price: product.unit_price,
      oem_specs: {
        voltage: product.voltage,
        conductor_material: product.conductor_material,
        insulation_material: product.insulation_material,
        cross_section_area: product.cross_section_area,
        no_of_cores: product.no_of_cores,
        armoured: product.armoured,
        temperature_rating: product.temperature_rating,
        standard: product.standard,
        application: product.application
      }
    };
  });
  
  // Sort by spec match percentage (descending)
  scoredProducts.sort((a, b) => b.spec_match_percentage - a.spec_match_percentage);
  
  // Return top N
  return scoredProducts.slice(0, topN);
}

/**
 * Generate comparison table for top matches
 * This is the format EY expects in the output
 * 
 * @param {string} rfpProduct - RFP product description
 * @param {Array} topMatches - Array of top matched products
 * @returns {Object} Comparison table structure
 */
export function generateComparisonTable(rfpProduct, topMatches) {
  return {
    rfp_product: rfpProduct,
    comparison: topMatches.map((match, idx) => ({
      rank: idx + 1,
      sku_id: match.sku_id,
      product_name: match.product_name,
      spec_match: `${match.spec_match_percentage}%`,
      matched_specs: match.match_details.matched.map(m => m.spec).join(', '),
      unmatched_specs: match.match_details.unmatched.map(m => m.spec).join(', ') || 'None',
      unit_price: match.unit_price
    })),
    recommended_sku: topMatches[0]?.sku_id || null,
    recommended_product: topMatches[0]?.product_name || null,
    recommendation_score: topMatches[0]?.spec_match_percentage || 0
  };
}

/**
 * Full spec matching pipeline for Technical Agent
 * 
 * @param {Array} rfpProducts - Array of RFP product requirements
 * @returns {Object} Complete matching results
 */
export function matchRFPToSKUs(rfpProducts) {
  const results = {
    timestamp: new Date().toISOString(),
    total_rfp_products: rfpProducts.length,
    matches: [],
    summary_table: [],
    average_spec_match: 0
  };
  
  let totalMatchScore = 0;
  
  for (const rfpProduct of rfpProducts) {
    const productText = typeof rfpProduct === 'string' ? rfpProduct : rfpProduct.description;
    const topMatches = findTopMatches(productText, 3);
    const comparison = generateComparisonTable(productText, topMatches);
    
    results.matches.push({
      rfp_product: productText,
      parsed_specs: parseRFPSpecs(productText),
      top_3_matches: topMatches,
      comparison_table: comparison
    });
    
    // Build summary row
    if (topMatches.length > 0) {
      const best = topMatches[0];
      results.summary_table.push({
        rfp_product: productText.substring(0, 50) + (productText.length > 50 ? '...' : ''),
        recommended_sku: best.sku_id,
        spec_match: `${best.spec_match_percentage}%`,
        unit_price: best.unit_price
      });
      totalMatchScore += best.spec_match_percentage;
    }
  }
  
  results.average_spec_match = rfpProducts.length > 0 
    ? Math.round(totalMatchScore / rfpProducts.length)
    : 0;
  
  return results;
}

// Clear cache utility
export function clearOEMCache() {
  oemSpecsCache = null;
}

// Export for use by agents
export default {
  parseRFPSpecs,
  calculateSpecMatch,
  findTopMatches,
  generateComparisonTable,
  matchRFPToSKUs,
  loadOEMSpecs,
  clearOEMCache
};











