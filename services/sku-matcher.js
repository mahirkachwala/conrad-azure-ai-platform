/**
 * SKU MATCHER SERVICE
 * 
 * Matches RFP requirements with company's product catalog (CSV).
 * Used twice:
 * 1. During search - to verify if RFP matches what we sell
 * 2. After detailed analysis - to find best matching SKU
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load all product CSVs
function loadAllProducts() {
  const csvDir = path.join(__dirname, '../data/products');
  const products = [];
  
  const csvFiles = [
    'control_cables.csv',
    'ht_cables.csv',
    'lt_cables.csv',
    'ehv_cables.csv',
    'instrumentation_cables.csv'
  ];
  
  csvFiles.forEach(file => {
    const filePath = path.join(csvDir, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim());
      
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = lines[i].split(',');
        const product = { _source: file };
        headers.forEach((h, idx) => {
          product[h] = values[idx]?.trim() || '';
        });
        products.push(product);
      }
    }
  });
  
  return products;
}

/**
 * Calculate match percentage between RFP requirement and a product
 */
function calculateMatchScore(rfpRequirement, product) {
  let score = 0;
  let maxScore = 0;
  const matchDetails = [];
  
  // Cable Type Match (25 points)
  maxScore += 25;
  const rfpType = (rfpRequirement.cable_type || '').toLowerCase();
  const productType = (product.Type || '').toLowerCase();
  if (rfpType && productType) {
    if (productType.includes(rfpType.replace(' cable', '')) || rfpType.includes(productType.replace(' cable', ''))) {
      score += 25;
      matchDetails.push({ field: 'Cable Type', match: true, rfp: rfpType, product: productType });
    } else {
      matchDetails.push({ field: 'Cable Type', match: false, rfp: rfpType, product: productType });
    }
  }
  
  // Voltage Match (25 points)
  maxScore += 25;
  const rfpVoltage = parseFloat((rfpRequirement.voltage || '').replace(/[^0-9.]/g, ''));
  const productVoltage = parseFloat(product.Voltage_Rating_kV || '0');
  if (rfpVoltage && productVoltage) {
    if (rfpVoltage === productVoltage) {
      score += 25;
      matchDetails.push({ field: 'Voltage', match: true, rfp: rfpVoltage + 'kV', product: productVoltage + 'kV' });
    } else if (Math.abs(rfpVoltage - productVoltage) <= 1) {
      score += 15; // Close match
      matchDetails.push({ field: 'Voltage', match: 'partial', rfp: rfpVoltage + 'kV', product: productVoltage + 'kV' });
    } else {
      matchDetails.push({ field: 'Voltage', match: false, rfp: rfpVoltage + 'kV', product: productVoltage + 'kV' });
    }
  }
  
  // Size Match (20 points)
  maxScore += 20;
  const rfpSize = parseFloat((rfpRequirement.size || '').replace(/[^0-9.]/g, ''));
  const productSize = parseFloat(product.Conductor_Area_mm2 || '0');
  if (rfpSize && productSize) {
    if (rfpSize === productSize) {
      score += 20;
      matchDetails.push({ field: 'Size', match: true, rfp: rfpSize + ' sqmm', product: productSize + ' sqmm' });
    } else if (Math.abs(rfpSize - productSize) / rfpSize <= 0.15) {
      score += 12; // Within 15%
      matchDetails.push({ field: 'Size', match: 'partial', rfp: rfpSize + ' sqmm', product: productSize + ' sqmm' });
    } else {
      matchDetails.push({ field: 'Size', match: false, rfp: rfpSize + ' sqmm', product: productSize + ' sqmm' });
    }
  }
  
  // Cores Match (15 points)
  maxScore += 15;
  const rfpCores = parseInt((rfpRequirement.cores || '').replace(/[^0-9]/g, ''));
  const productCores = parseInt(product.No_of_Cores || '0');
  if (rfpCores && productCores) {
    if (rfpCores === productCores) {
      score += 15;
      matchDetails.push({ field: 'Cores', match: true, rfp: rfpCores + 'C', product: productCores + 'C' });
    } else if (Math.abs(rfpCores - productCores) <= 2) {
      score += 8; // Close match
      matchDetails.push({ field: 'Cores', match: 'partial', rfp: rfpCores + 'C', product: productCores + 'C' });
    } else {
      matchDetails.push({ field: 'Cores', match: false, rfp: rfpCores + 'C', product: productCores + 'C' });
    }
  }
  
  // Conductor Material Match (15 points)
  maxScore += 15;
  const rfpConductor = (rfpRequirement.conductor || '').toLowerCase();
  const productConductor = (product.Conductor_Material || '').toLowerCase();
  if (rfpConductor && productConductor) {
    if (rfpConductor === productConductor) {
      score += 15;
      matchDetails.push({ field: 'Conductor', match: true, rfp: rfpConductor, product: productConductor });
    } else {
      matchDetails.push({ field: 'Conductor', match: false, rfp: rfpConductor, product: productConductor });
    }
  }
  
  const matchPercentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  
  return {
    score: score,
    maxScore: maxScore,
    matchPercentage: matchPercentage,
    matchDetails: matchDetails,
    product: product
  };
}

/**
 * Find best matching products for an RFP requirement
 * 
 * @param {object} rfpRequirement - {cable_type, voltage, size, cores, conductor}
 * @param {number} limit - Max number of matches to return
 * @returns {array} - Sorted array of matches with scores
 */
export function findMatchingProducts(rfpRequirement, limit = 5) {
  const allProducts = loadAllProducts();
  
  const matches = allProducts.map(product => calculateMatchScore(rfpRequirement, product));
  
  // Sort by match percentage descending
  matches.sort((a, b) => b.matchPercentage - a.matchPercentage);
  
  // Return top matches
  return matches.slice(0, limit);
}

/**
 * Match all requirements from an RFP
 * 
 * @param {array} cableRequirements - Array of {cable_type, voltage, size, cores, conductor}
 * @returns {object} - {overallMatch, itemMatches}
 */
export function matchRFPRequirements(cableRequirements) {
  if (!cableRequirements || cableRequirements.length === 0) {
    return {
      overallMatch: 0,
      canBid: false,
      reason: 'No cable requirements found in RFP',
      itemMatches: []
    };
  }
  
  const itemMatches = cableRequirements.map((req, idx) => {
    const matches = findMatchingProducts(req, 3);
    const bestMatch = matches[0];
    
    return {
      itemNo: req.item_no || idx + 1,
      requirement: req,
      bestMatch: bestMatch,
      alternativeMatches: matches.slice(1),
      hasMatch: bestMatch && bestMatch.matchPercentage >= 60
    };
  });
  
  // Calculate overall match
  const totalMatch = itemMatches.reduce((sum, m) => sum + (m.bestMatch?.matchPercentage || 0), 0);
  const overallMatch = Math.round(totalMatch / itemMatches.length);
  
  // Determine if we can bid
  const allItemsMatch = itemMatches.every(m => m.hasMatch);
  const canBid = allItemsMatch && overallMatch >= 60;
  
  let reason = '';
  if (!canBid) {
    const lowMatches = itemMatches.filter(m => !m.hasMatch);
    if (lowMatches.length > 0) {
      reason = `Low match for item(s): ${lowMatches.map(m => m.itemNo).join(', ')}. We may not have exact products for these requirements.`;
    }
  }
  
  return {
    overallMatch: overallMatch,
    canBid: canBid,
    reason: canBid ? 'Good match - we have products for all requirements' : reason,
    itemMatches: itemMatches
  };
}

/**
 * Quick match check - used during search to filter relevant RFPs
 */
export function quickMatch(rfpCableType, rfpVoltage) {
  const allProducts = loadAllProducts();
  
  const typeMatch = allProducts.some(p => {
    const pType = (p.Type || '').toLowerCase();
    return pType.includes(rfpCableType.toLowerCase().replace(' cable', ''));
  });
  
  if (!typeMatch) {
    return { matches: false, reason: `We don't sell ${rfpCableType}` };
  }
  
  const voltageNum = parseFloat((rfpVoltage || '').replace(/[^0-9.]/g, ''));
  if (voltageNum) {
    const voltageMatch = allProducts.some(p => {
      const pVoltage = parseFloat(p.Voltage_Rating_kV || '0');
      return Math.abs(pVoltage - voltageNum) <= 5; // Within 5kV
    });
    
    if (!voltageMatch) {
      return { matches: false, reason: `We don't have ${rfpVoltage} rated cables` };
    }
  }
  
  return { matches: true, reason: 'Potential match found' };
}

export default {
  findMatchingProducts,
  matchRFPRequirements,
  quickMatch
};


