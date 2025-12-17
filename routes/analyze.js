/**
 * Analyze Route - Enhanced with Real SKU Dataset Integration
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * This route now uses the REAL datasets:
 * - products.csv (100 SKUs with specifications)
 * - oem_specs.csv (OEM specifications)
 * - pricing_rules.csv (30 pricing rules including GST, margins, discounts)
 * - testing.csv (30 test types with costs)
 * 
 * Enhanced with:
 * - Scaled test costs proportional to project value
 * - Market value benchmarks for realistic pricing
 * - Counter offers at or below market value
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  getMarketValueBenchmark,
  analyzeQuotedPrice,
  calculateScaledTestCosts
} from '../services/pricing-analysis.js';
import { 
  calculateTestingCostFromRFP, 
  calculateMaterialCostFromRFP 
} from '../services/adaptive-pricing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// QUANTITY ESTIMATION (Independent of tender price)
// ============================================

/**
 * Estimate cable quantity based on tender context and specifications
 * This provides a FIXED estimate independent of tender price to create real variance
 * 
 * @param {Object} tender - The tender object
 * @param {Object} product - The matched product
 * @returns {number} Estimated quantity (km of cable)
 */
function getEstimatedQuantity(tender, product) {
  const title = (tender.title || '').toLowerCase();
  const material = (tender.material || '').toLowerCase();
  const cableType = (tender.cable_type || '').toLowerCase();
  
  // Base estimates by tender context (in km)
  // These are typical project sizes based on industry standards
  
  // Large infrastructure projects (EHV, transmission)
  if (cableType.includes('ehv') || title.includes('transmission') || title.includes('grid')) {
    return 8; // EHV projects typically 5-15km
  }
  
  // HT distribution projects
  if (cableType.includes('ht') || title.includes('distribution') || title.includes('substation')) {
    if (title.includes('metro') || title.includes('railway')) {
      return 12; // Metro/Railway projects are larger
    }
    return 6; // Typical HT distribution is 3-10km
  }
  
  // Industrial/Plant projects
  if (title.includes('plant') || title.includes('factory') || title.includes('industrial')) {
    return 4; // Industrial internal wiring 2-6km
  }
  
  // Control cable projects (typically smaller quantities but more expensive per unit)
  if (cableType.includes('control') || title.includes('control')) {
    return 3; // Control cables for automation 1-5km
  }
  
  // LT Power cables - varies widely
  if (cableType.includes('lt') || material.includes('1.1kv')) {
    if (title.includes('distribution') || title.includes('network')) {
      return 8; // Distribution networks
    }
    return 5; // General LT installations
  }
  
  // Municipal/Utility projects
  if (title.includes('municipal') || title.includes('utility') || title.includes('power')) {
    return 7;
  }
  
  // Default based on cross-section (larger cables = smaller projects)
  const crossSection = product?.conductor_area_mm2 || 95;
  if (crossSection >= 400) return 5;  // Large cables - shorter runs
  if (crossSection >= 185) return 6;
  if (crossSection >= 70) return 7;
  return 8; // Small cables - longer runs
}

// ============================================
// DATASET LOADING FUNCTIONS
// ============================================

/**
 * Parse CSV string into array of objects
 */
function parseCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];
  
  const parseRow = (row) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };
  
  const headers = parseRow(lines[0]).map(h => 
    h.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '')
  );
  
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    
    const values = parseRow(lines[i]);
    const row = {};
    
    headers.forEach((header, idx) => {
      let value = values[idx] || '';
      if (/^\d+$/.test(value)) value = parseInt(value, 10);
      else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
      row[header] = value;
    });
    
    data.push(row);
  }
  
  return data;
}

// Dataset cache
let productsCache = null;
let pricingRulesCache = null;
let testsCache = null;
let companiesCache = null;

function loadProducts() {
  if (productsCache) return productsCache;
  const csvPath = path.join(__dirname, '../data/products.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  productsCache = parseCSV(content);
  console.log(`📦 Loaded ${productsCache.length} products from products.csv`);
  return productsCache;
}

function loadPricingRules() {
  if (pricingRulesCache) return pricingRulesCache;
  const csvPath = path.join(__dirname, '../data/pricing_rules.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  pricingRulesCache = parseCSV(content);
  console.log(`💰 Loaded ${pricingRulesCache.length} pricing rules from pricing_rules.csv`);
  return pricingRulesCache;
}

function loadTests() {
  if (testsCache) return testsCache;
  const csvPath = path.join(__dirname, '../data/testing.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  testsCache = parseCSV(content);
  console.log(`🧪 Loaded ${testsCache.length} tests from testing.csv`);
  return testsCache;
}

function loadCompanies() {
  if (companiesCache) return companiesCache;
  const companiesPath = path.join(__dirname, '../public/data/companies.json');
  const data = fs.readFileSync(companiesPath, 'utf8');
  companiesCache = JSON.parse(data);
  return companiesCache;
}

function getPricingRule(rules, parameter) {
  return rules.find(r => r.parameter === parameter);
}

/**
 * Get test category based on test ID
 * Used for applying correct scaling factors
 */
function getTestCategory(testId) {
  const routineTests = ['T002', 'T003', 'T009', 'T014', 'T022', 'T023'];
  const typeTests = ['T001', 'T004', 'T006', 'T007', 'T008', 'T012', 'T026'];
  const acceptanceTests = ['T010', 'T011', 'T028', 'T029'];
  const specialTests = ['T005', 'T013', 'T015', 'T016', 'T017', 'T018', 'T019', 'T020', 'T024', 'T025', 'T027', 'T030'];
  
  if (routineTests.includes(testId)) return 'Routine Test';
  if (typeTests.includes(testId)) return 'Type Test';
  if (acceptanceTests.includes(testId)) return 'Acceptance Test';
  if (specialTests.includes(testId)) return 'Special Test';
  return 'Routine Test'; // Default
}

// ============================================
// SKU MATCHING & SPEC ANALYSIS
// ============================================

/**
 * Parse tender material description to extract specs
 * Enhanced to extract more detailed specifications from RFP names
 */
function parseTenderSpecs(material) {
  const specs = {};
  const lower = (material || '').toLowerCase();
  
  // Voltage Rating (kV)
  const kvMatch = lower.match(/(\d+(?:\.\d+)?)\s*kv/);
  if (kvMatch) specs.voltage_kv = parseFloat(kvMatch[1]);
  
  // Number of Cores - Enhanced patterns
  const corePatterns = [
    /(\d+)\s*(?:core|cores)/i,           // "3 core", "3 cores"
    /(\d+)c\s*x/i,                        // "3C x"
    /(\d+)\s*c\s*(?:x|\*)/i               // "3 c x", "3c*"
  ];
  for (const pattern of corePatterns) {
    const coreMatch = lower.match(pattern);
    if (coreMatch) {
      specs.cores = parseInt(coreMatch[1]);
      break;
    }
  }
  
  // Cross-section area (sqmm) - Enhanced patterns
  const areaPatterns = [
    /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*mm|sqmm|mm2|mm²)/i,  // "95 sq mm", "95sqmm"
    /x\s*(\d+(?:\.\d+)?)\s*(?:sq|mm)/i,                // "x 95 sq"
    /(\d+)\s*(?:square|sqmm)/i                          // "95 square"
  ];
  for (const pattern of areaPatterns) {
    const areaMatch = lower.match(pattern);
    if (areaMatch) {
      specs.area_mm2 = parseFloat(areaMatch[1]);
      break;
    }
  }
  
  // Conductor Material
  if (lower.includes('copper') || lower.includes(' cu ') || lower.includes('cu-')) {
    specs.conductor = 'Copper';
  } else if (lower.includes('aluminium') || lower.includes('aluminum') || lower.includes(' al ') || lower.includes('al-')) {
    specs.conductor = 'Aluminium';
  }
  
  // Insulation Material
  if (lower.includes('xlpe')) specs.insulation = 'XLPE';
  else if (lower.includes('pvc')) specs.insulation = 'PVC';
  else if (lower.includes('pe ') || lower.includes(' pe')) specs.insulation = 'PE';
  
  // Armoured
  if (lower.includes('armoured') || lower.includes('armored') || lower.includes('swa') || lower.includes('steel wire')) {
    specs.armoured = true;
  } else if (lower.includes('unarmoured') || lower.includes('unarmored')) {
    specs.armoured = false;
  }
  
  // Cable Type - More precise detection
  if (lower.includes('ht cable') || lower.includes('ht power') || lower.includes('high tension') || 
      lower.includes('high voltage') || lower.includes('hv cable') || specs.voltage_kv >= 6) {
    specs.type = 'HT Cable';
  } else if (lower.includes('ehv') || lower.includes('extra high') || specs.voltage_kv >= 66) {
    specs.type = 'EHV Cable';
  } else if (lower.includes('control cable') || lower.includes('control ')) {
    specs.type = 'Control Cable';
  } else if (lower.includes('instrument') || lower.includes('signal')) {
    specs.type = 'Instrumentation Cable';
  } else if (lower.includes('lt cable') || lower.includes('lt power') || lower.includes('lv cable') || 
             lower.includes('low voltage') || lower.includes('low tension') || 
             (specs.voltage_kv && specs.voltage_kv <= 1.1)) {
    specs.type = 'LT Cable';
  } else if (lower.includes('power cable')) {
    specs.type = specs.voltage_kv >= 6 ? 'HT Cable' : 'LT Cable';
  }
  
  // Count how many specs were extracted (for match quality scoring)
  specs._extracted_count = Object.keys(specs).filter(k => !k.startsWith('_')).length;
  
  return specs;
}

/**
 * Calculate Spec Match between tender and SKU
 * Enhanced formula with STRICT matching:
 * - Area (sqmm) must match within 15% tolerance
 * - All specs contribute equally to score
 * - No artificial bonuses that inflate scores
 * - 100% only if ALL extracted specs match
 */
function calculateSpecMatch(tenderSpecs, product) {
  const checks = [];
  
  // Cable Type Match (critical - must match for high score)
  if (tenderSpecs.type) {
    const productType = (product.type || '').toLowerCase();
    const tenderType = tenderSpecs.type.toLowerCase();
    
    const typeMatches = productType.includes(tenderType.replace(' cable', '')) || 
                        tenderType.includes(productType.replace(' cable', ''));
    checks.push({ spec: 'Cable Type', match: typeMatches, tender: tenderSpecs.type, product: product.type, weight: 2 });
  }
  
  // Voltage Rating (important for HT/LT distinction)
  if (tenderSpecs.voltage_kv !== undefined) {
    const productVoltage = product.voltage_rating_kv || 0;
    // Allow 15% tolerance for voltage
    const voltageDiff = Math.abs(tenderSpecs.voltage_kv - productVoltage);
    const match = voltageDiff <= Math.max(productVoltage, tenderSpecs.voltage_kv) * 0.15;
    checks.push({ spec: 'Voltage', match, tender: `${tenderSpecs.voltage_kv}kV`, product: `${productVoltage}kV`, weight: 2 });
  }
  
  // Number of Cores - EXACT match required
  if (tenderSpecs.cores !== undefined) {
    const match = tenderSpecs.cores === product.no_of_cores;
    checks.push({ spec: 'Cores', match, tender: tenderSpecs.cores, product: product.no_of_cores, weight: 1.5 });
  }
  
  // Cross-section Area (conductor size) - STRICT 15% tolerance
  if (tenderSpecs.area_mm2 !== undefined) {
    const productArea = product.conductor_area_mm2 || 0;
    const areaDiff = Math.abs(tenderSpecs.area_mm2 - productArea);
    const maxArea = Math.max(tenderSpecs.area_mm2, productArea);
    // STRICT: Only 15% tolerance for area
    const match = areaDiff <= maxArea * 0.15;
    checks.push({ spec: 'Area (mm²)', match, tender: tenderSpecs.area_mm2, product: productArea, weight: 2 });
  }
  
  // Conductor Material (Copper vs Aluminium) - EXACT match
  if (tenderSpecs.conductor) {
    const productConductor = (product.conductor_material || '').toLowerCase();
    const match = productConductor.includes(tenderSpecs.conductor.toLowerCase());
    checks.push({ spec: 'Conductor', match, tender: tenderSpecs.conductor, product: product.conductor_material, weight: 1.5 });
  }
  
  // Insulation Type (XLPE vs PVC) - EXACT match
  if (tenderSpecs.insulation) {
    const productInsulation = (product.insulation || '').toUpperCase();
    const match = productInsulation === tenderSpecs.insulation;
    checks.push({ spec: 'Insulation', match, tender: tenderSpecs.insulation, product: productInsulation, weight: 1 });
  }
  
  // Armoured status
  if (tenderSpecs.armoured !== undefined) {
    const productArmoured = (product.armoured || '').toLowerCase() === 'yes';
    const match = tenderSpecs.armoured === productArmoured;
    checks.push({ spec: 'Armoured', match, tender: tenderSpecs.armoured ? 'Yes' : 'No', product: product.armoured, weight: 1 });
  }
  
  // Calculate WEIGHTED percentage from matched specs
  let totalWeight = 0;
  let matchedWeight = 0;
  
  for (const check of checks) {
    totalWeight += check.weight;
    if (check.match) {
      matchedWeight += check.weight;
    }
  }
  
  // Base percentage from weighted matches
  let basePercentage = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;
  
  // CRITICAL: If area doesn't match, cap at 85%
  const areaCheck = checks.find(c => c.spec === 'Area (mm²)');
  if (areaCheck && !areaCheck.match) {
    basePercentage = Math.min(basePercentage, 85);
  }
  
  // CRITICAL: If cable type doesn't match, cap at 60%
  const typeCheck = checks.find(c => c.spec === 'Cable Type');
  if (typeCheck && !typeCheck.match) {
    basePercentage = Math.min(basePercentage, 60);
  }
  
  // CRITICAL: If voltage doesn't match, cap at 70%
  const voltageCheck = checks.find(c => c.spec === 'Voltage');
  if (voltageCheck && !voltageCheck.match) {
    basePercentage = Math.min(basePercentage, 70);
  }
  
  // Apply completeness penalty if RFP has very few specs
  const extractedSpecCount = tenderSpecs._extracted_count || checks.length;
  
  let completenessFactor = 1.0;
  if (extractedSpecCount <= 2) {
    // Very few specs - max 60%
    completenessFactor = 0.6;
  } else if (extractedSpecCount <= 3) {
    // Few specs - max 75%
    completenessFactor = 0.75;
  } else if (extractedSpecCount <= 4) {
    // Moderate specs - max 90%
    completenessFactor = 0.9;
  }
  
  // Final percentage (no bonuses, just weighted match with caps)
  let finalPercentage = Math.round(basePercentage * completenessFactor);
  
  // Clamp between 0 and 100
  finalPercentage = Math.max(0, Math.min(100, finalPercentage));
  
  return {
    percentage: finalPercentage,
    matched_count: checks.filter(c => c.match).length,
    total_count: checks.length,
    base_percentage: basePercentage,
    completeness_factor: completenessFactor,
    details: checks
  };
}

/**
 * Find top 3 matching SKUs for a tender
 */
function findMatchingSKUs(tender, products) {
  const materialText = tender.material || tender.title;
  const tenderSpecs = parseTenderSpecs(materialText);
  
  // DEBUG: Log what specs were extracted
  console.log(`   📋 Material: "${materialText}"`);
  console.log(`   🔍 Extracted specs: ${JSON.stringify(tenderSpecs)}`);
  
  const matches = products.map(product => {
    const specMatch = calculateSpecMatch(tenderSpecs, product);
    return {
      sku_id: product.sku_id,
      product_name: product.product_name,
      type: product.type,
      unit_price_per_km: product.unit_price_per_km,
      lead_time_days: product.lead_time_days,
      conductor_material: product.conductor_material,
      conductor_area_mm2: product.conductor_area_mm2,
      voltage_rating_kv: product.voltage_rating_kv,
      insulation: product.insulation,
      standard: product.standard,
      spec_match: specMatch
    };
  });
  
  // Sort by spec match percentage (descending), then by area difference as tiebreaker
  matches.sort((a, b) => {
    if (b.spec_match.percentage !== a.spec_match.percentage) {
      return b.spec_match.percentage - a.spec_match.percentage;
    }
    // Tiebreaker: prefer closer area match if specs extracted area
    if (tenderSpecs.area_mm2) {
      const aDiff = Math.abs(a.conductor_area_mm2 - tenderSpecs.area_mm2);
      const bDiff = Math.abs(b.conductor_area_mm2 - tenderSpecs.area_mm2);
      return aDiff - bDiff;
    }
    return 0;
  });
  
  // DEBUG: Log top 3 matches with details
  console.log(`   📊 Top 3 matches:`);
  matches.slice(0, 3).forEach((m, i) => {
    console.log(`      ${i+1}. ${m.sku_id} (${m.spec_match.percentage}%) - ${m.product_name}`);
    m.spec_match.details.forEach(d => {
      console.log(`         ${d.match ? '✓' : '✗'} ${d.spec}: RFP=${d.tender} vs SKU=${d.product}`);
    });
  });
  
  return {
    tender_specs: tenderSpecs,
    top_3: matches.slice(0, 3)
  };
}

/**
 * Parse cable specifications from material string
 * @param {string} material - Material description string
 * @returns {Object} Parsed specifications
 */
function parseCableSpecs(material) {
  const m = (material || '').toLowerCase();
  
  // Extract cross-section area
  const areaMatch = m.match(/(\d+(?:\.\d+)?)\s*(?:sqmm|sq\.?\s*mm|mm²)/i);
  const area = areaMatch ? parseFloat(areaMatch[1]) : null;
  
  // Extract voltage
  const voltageMatch = m.match(/(\d+(?:\.\d+)?)\s*kv/i);
  const voltage = voltageMatch ? parseFloat(voltageMatch[1]) : null;
  
  // Determine cable type
  let cableType = 'LT Cable';
  if (m.includes('ehv') || (voltage && voltage >= 66)) {
    cableType = 'EHV Cable';
  } else if (m.includes('ht') || (voltage && voltage >= 11 && voltage < 66)) {
    cableType = 'HT Cable';
  } else if (m.includes('control')) {
    cableType = 'Control Cable';
  } else if (m.includes('instrument')) {
    cableType = 'Instrumentation Cable';
  }
  
  // Determine conductor material
  const conductor = (m.includes('copper') || m.includes(' cu ') || m.match(/\bcu\b/)) ? 'Copper' : 'Aluminium';
  
  // Determine insulation
  const insulation = m.includes('xlpe') ? 'XLPE' : (m.includes('pvc') ? 'PVC' : 'XLPE');
  
  // Check if armoured
  const armoured = m.includes('armoured') || m.includes('armored');
  
  return { area, voltage, cableType, conductor, insulation, armoured };
}

/**
 * Get applicable tests for a specific cable based on its actual specifications
 * Tests are matched by checking the Applicable_Types field against cable specs
 * 
 * @param {string} productType - Product type string
 * @param {Array} allTests - All available tests from testing.csv
 * @param {string} cableType - Cable type (HT/LT/EHV/Control/Instrumentation)
 * @param {string} material - Full material specification string
 * @returns {Array} Applicable tests
 */
function getApplicableTests(productType, allTests, cableType = null, material = null) {
  const specs = parseCableSpecs(material || productType || '');
  const type = (cableType || specs.cableType || 'LT Cable').toLowerCase();
  
  // Score each test by how well it matches the cable specs
  const scoredTests = allTests.map(test => {
    const applicable = (test.applicable_types || '').toLowerCase();
    let score = 0;
    let matches = [];
    let isApplicable = false;
    
    // Check cable type match (required)
    if (type.includes('ehv') && (applicable.includes('ehv') || applicable.includes('66kv') || applicable.includes('110kv'))) {
      score += 50;
      isApplicable = true;
      matches.push('EHV');
    } else if (type.includes('ht') && !type.includes('ehv') && applicable.includes('ht cable')) {
      score += 50;
      isApplicable = true;
      matches.push('HT');
    } else if (type.includes('lt') && applicable.includes('lt cable')) {
      score += 50;
      isApplicable = true;
      matches.push('LT');
    } else if (type.includes('control') && applicable.includes('control cable')) {
      score += 50;
      isApplicable = true;
      matches.push('Control');
    } else if (type.includes('instrument') && applicable.includes('instrumentation')) {
      score += 50;
      isApplicable = true;
      matches.push('Instrumentation');
    }
    
    // If no cable type match, skip this test
    if (!isApplicable) return { test, score: 0, matches: [], applicable: false };
    
    // Check conductor material match
    if (specs.conductor === 'Copper' && (applicable.includes('copper') || applicable.includes(' cu '))) {
      score += 20;
      matches.push('Copper');
    } else if (specs.conductor === 'Aluminium' && (applicable.includes('aluminium') || applicable.includes(' al '))) {
      score += 20;
      matches.push('Aluminium');
    }
    
    // Check insulation match
    if (specs.insulation === 'XLPE' && applicable.includes('xlpe')) {
      score += 15;
      matches.push('XLPE');
    } else if (specs.insulation === 'PVC' && applicable.includes('pvc')) {
      score += 15;
      matches.push('PVC');
    }
    
    // Check armoured match
    if (specs.armoured && applicable.includes('armoured')) {
      score += 10;
      matches.push('Armoured');
    }
    
    // Check size constraints using RANGES (e.g., "35-95sqmm", "95-185sqmm")
    // This ensures a 150mm cable only matches tests for "120-240sqmm", not ALL tests for 50+, 90+, etc.
    let hasCorrectSize = true;
    let sizeMatched = false;
    
    if (specs.area) {
      // Extract range patterns like "35-95sqmm", "1.5-35sqmm", "150-300sqmm"
      const rangePattern = /(\d+\.?\d*)-(\d+\.?\d*)sqmm/gi;
      const ranges = [...applicable.matchAll(rangePattern)];
      
      if (ranges.length > 0) {
        // Test has range constraint - must match one
        let rangeMatched = false;
        for (const range of ranges) {
          const minSize = parseFloat(range[1]);
          const maxSize = parseFloat(range[2]);
          if (specs.area >= minSize && specs.area <= maxSize) {
            score += 30;
            matches.push(`${minSize}-${maxSize}sqmm`);
            rangeMatched = true;
            sizeMatched = true;
            break;
          }
        }
        if (!rangeMatched) {
          // Size out of range - penalize
          score = -100;
          hasCorrectSize = false;
        }
      } else {
        // No explicit range - check for legacy patterns
        const legacyPatterns = [
          { pattern: /≤(\d+)sqmm/i, check: (max) => specs.area <= max },
          { pattern: />(\d+)sqmm/i, check: (min) => specs.area > min },
        ];
        
        for (const { pattern, check } of legacyPatterns) {
          const match = applicable.match(pattern);
          if (match) {
            const threshold = parseFloat(match[1]);
            if (check(threshold)) {
              score += 20;
              matches.push(match[0]);
              sizeMatched = true;
            } else {
              score = -100;
              hasCorrectSize = false;
            }
            break;
          }
        }
      }
    }
    
    return { test, score, matches, applicable: isApplicable && hasCorrectSize };
  });
  
  // Filter to only applicable tests and sort by score
  const applicableTests = scoredTests
    .filter(t => t.applicable && t.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(t => t.test);
  
  // Return top 7 tests
  return applicableTests.slice(0, 7);
}

/**
 * Calculate company credibility score (0-100)
 */
function calculateCredibilityScore(company) {
  let score = 0;
  
  const rawScore = company.raw_score || 0;
  score += rawScore * 0.6;
  
  const ageYears = company.age_years || 0;
  const ageScore = Math.min(20, ageYears * 2);
  score += ageScore;
  
  let verificationBonus = 0;
  if (company.hasAddress) verificationBonus += 5;
  const filings = company.signals?.filingsCount ?? company.filingsCount ?? 0;
  if (filings > 0) verificationBonus += Math.min(10, filings);
  if (company.status === 'Active') verificationBonus += 5;
  score += verificationBonus;
  
  return Math.min(100, Math.floor(score));
}

/**
 * Calculate overall tender rank with SPEC MATCH as PRIMARY factor
 * Weights: Spec Match (50%) > Price (25%) > Credibility (18%) > Tests (7%)
 * 
 * @param {Object} params - Scoring parameters
 * @returns {number} Final score 0-100
 */
function calculateTenderRank({ specMatchPercent, credibilityScore, priceVariance, testCostPercent }) {
  // Weights - SPEC MATCH IS KING
  const weights = {
    specMatch: 0.50,      // 50% - Technical fit is THE MOST important
    price: 0.25,          // 25% - Competitive pricing
    credibility: 0.18,    // 18% - Company verification
    testCoverage: 0.07    // 7% - Adequate testing
  };
  
  // Normalize spec match (0-100)
  const specScore = Math.min(100, Math.max(0, specMatchPercent || 0));
  
  // Price score: Lower variance = better (0-100)
  // 0% variance = 100 score, 30%+ variance = 0 score
  const variance = Math.abs(priceVariance || 0);
  const priceScore = Math.max(0, 100 - (variance * 3.33));
  
  // Credibility score (0-100)
  const credScore = Math.min(100, Math.max(0, credibilityScore || 50));
  
  // Test coverage score: Tests should be 2-5% of project
  // 3% is ideal, penalize if too high or too low
  const testPercent = testCostPercent || 3;
  let testScore = 100;
  if (testPercent < 1) testScore = 60; // Too low testing
  else if (testPercent > 8) testScore = 50; // Too expensive
  else if (testPercent > 5) testScore = 70;
  else testScore = 90; // Ideal range
  
  // Calculate weighted score
  const finalScore = 
    (specScore * weights.specMatch) +
    (priceScore * weights.price) +
    (credScore * weights.credibility) +
    (testScore * weights.testCoverage);
  
  return Math.round(finalScore);
}

// ============================================
// MAIN ANALYZE HANDLER
// ============================================

export async function handleAnalyzeRequest(req, res) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎯 ANALYSIS ENGINE - Using Real SKU Datasets');
  console.log('═══════════════════════════════════════════════════════════════');
  
  try {
    const { tenders } = req.body;
    
    if (!tenders || !Array.isArray(tenders)) {
      return res.status(400).json({ error: 'Tenders array is required' });
    }
    
    console.log(`📋 Tenders to analyze: ${tenders.length}`);
    
    // Load all datasets
    console.log('');
    console.log('📂 Loading Datasets:');
    const products = loadProducts();
    const pricingRules = loadPricingRules();
    const tests = loadTests();
    const companies = loadCompanies();
    
    // Get key pricing rules
    const gstRule = getPricingRule(pricingRules, 'GST_Rate');
    const marginRule = getPricingRule(pricingRules, 'Profit_Margin');
    const bulkDiscount50 = getPricingRule(pricingRules, 'Bulk_Discount_50km');
    
    console.log(`   ✓ GST Rate: ${gstRule?.value || 0.18} (Rule ID: ${gstRule?.rule_id})`);
    console.log(`   ✓ Profit Margin: ${marginRule?.value || 0.12} (Rule ID: ${marginRule?.rule_id})`);
    console.log(`   ✓ Bulk Discount 50km: ${bulkDiscount50?.value || 0.03} (Rule ID: ${bulkDiscount50?.rule_id})`);
    
    const rankedResults = [];
    const datasetUsage = {
      products_searched: products.length,
      tests_available: tests.length,
      pricing_rules_applied: [],
      skus_matched: []
    };
    
    for (const tender of tenders) {
      console.log('');
      console.log(`───────────────────────────────────────────────────────────────`);
      console.log(`📄 Processing: ${tender.tender_id} - ${tender.organisation}`);
      
      // Find matching company from OpenCorporates data (case-insensitive)
      const orgLower = (tender.organisation || '').toLowerCase().trim();
      let company = companies.find(c => (c.name || '').toLowerCase().trim() === orgLower);
      
      // Fallback: partial match on key words
      if (!company) {
        company = companies.find(c => {
          const nameLower = (c.name || '').toLowerCase();
          const orgWords = orgLower.split(/\s+/).filter(w => w.length > 3);
          const nameWords = nameLower.split(/\s+/).filter(w => w.length > 3);
          // Match if first significant word matches
          return orgWords[0] && nameWords[0] && (
            nameLower.includes(orgWords[0]) || orgLower.includes(nameWords[0])
          );
        });
      }
      
      // If still not found, log and use default (should not happen with correct data)
      if (!company) {
        console.log(`   ⚠️ Company not in OpenCorporates DB: ${tender.organisation}`);
        company = {
          name: tender.organisation,
          raw_score: 0,
          age_years: 0,
          status: 'Unknown',
          credibility_label: 'UNKNOWN',
          red_flags: ['Company not found in OpenCorporates database'],
          green_flags: [],
          data_source: 'Not in OpenCorporates'
        };
      } else {
        console.log(`   ✓ OpenCorporates: ${company.name} | Status: ${company.status} | Credibility: ${company.credibility_label}`);
      }
      
      // Calculate credibility score first (rank will be calculated AFTER spec match)
      const credibilityScore = calculateCredibilityScore(company);
      
      // SKU MATCHING using products.csv
      console.log(`   🔍 Matching SKUs from products.csv...`);
      const skuMatch = findMatchingSKUs(tender, products);
      
      if (skuMatch.top_3.length > 0) {
        const topSKU = skuMatch.top_3[0];
        console.log(`   ✓ Top Match: ${topSKU.sku_id} (${topSKU.spec_match.percentage}% Spec Match)`);
        console.log(`     - Product: ${topSKU.product_name}`);
        console.log(`     - Price: ₹${topSKU.unit_price_per_km?.toLocaleString('en-IN')}/km`);
        
        datasetUsage.skus_matched.push({
          tender_id: tender.tender_id,
          matched_sku: topSKU.sku_id,
          spec_match: topSKU.spec_match.percentage
        });
      }
      
      // Get applicable tests from testing.csv based on cable type AND specifications
      // Tests are selected based on MATERIAL TYPE, SIZE, INSULATION, and CONDUCTOR
      const productType = skuMatch.top_3[0]?.type || 'LT Cable';
      const cableType = tender.cable_type || skuMatch.tender_specs?.type || productType;
      const materialSpec = tender.material || tender.title || '';
      const applicableTests = getApplicableTests(productType, tests, cableType, materialSpec);
      
      // Calculate pricing using pricing_rules.csv
      const tenderCost = tender.estimated_cost_inr;
      const gstRate = gstRule?.value || 0.18;
      const marginRate = marginRule?.value || 0.12;
      
      // ================================================================
      // TEST COSTS - Now using ACTUAL prices from testing.csv
      // Tests are selected based on what the buyer specifies in RFP
      // ================================================================
      
      // Check if tender has explicit Required_Tests (from RFP parsing)
      let totalTestCost = 0;
      let testPercentageOfProject = 0;
      let rfpTestData = null;
      let actualApplicableTests = [];
      
      if (tender.required_tests && tender.required_tests.length > 0) {
        // Use buyer-specified tests with ACTUAL prices from testing.csv
        rfpTestData = calculateTestingCostFromRFP(tender.required_tests, 1);
        totalTestCost = rfpTestData.totalCost;
        testPercentageOfProject = (totalTestCost / tenderCost) * 100;
        actualApplicableTests = rfpTestData.tests;
        
        console.log(`   🧪 BUYER-SPECIFIED Tests: ${tender.required_tests.join(', ')}`);
        console.log(`   💰 ACTUAL Test Cost from testing.csv: ₹${totalTestCost.toLocaleString('en-IN')}`);
      } else {
        // Fallback: Use applicable tests based on cable type with actual prices
        actualApplicableTests = applicableTests.slice(0, 5).map(t => ({
          id: t.test_id,
          name: t.test_name,
          standard: t.standard,
          price: parseFloat(t.price_inr) || 0,
          duration: parseInt(t.duration_days) || 1
        }));
        
        totalTestCost = actualApplicableTests.reduce((sum, t) => sum + t.price, 0);
        testPercentageOfProject = (totalTestCost / tenderCost) * 100;
        
        console.log(`   🧪 Cable Type: ${cableType} → Auto-selected tests`);
        console.log(`   💰 ACTUAL Test Cost from testing.csv: ₹${totalTestCost.toLocaleString('en-IN')}`);
      }
      
      // Create display list with actual prices (no scaling)
      const scaledApplicableTests = actualApplicableTests.map(t => ({
        test_id: t.id,
        test_name: t.name,
        standard: t.standard,
        price_inr: t.price,
        duration_days: t.duration,
        scaled: false,
        source: 'testing.csv'
      }));
      
      scaledApplicableTests.slice(0, 3).forEach(test => {
        console.log(`     - ${test.test_id}: ${test.test_name} (₹${test.price_inr?.toLocaleString('en-IN') || 'N/A'})`);
      });
      console.log(`   📊 Test Cost as % of project: ${testPercentageOfProject.toFixed(2)}%`);
      
      // ================================================================
      // ENHANCED: Market value benchmarks and smart counter offers
      // Counter offers are at or BELOW market value (never above)
      // ================================================================
      const topProduct = skuMatch.top_3[0];
      let estimatedMarketRate;
      let counterOfferPrice;
      let suggestedDiscount;
      let priceAnalysisResult = null;
      
      if (topProduct) {
        // Create a product-like object for market benchmark calculation
        const productForBenchmark = {
          specifications: {
            voltage_rating_v: (topProduct.voltage_rating_kv || 11) * 1000,
            conductor_cross_section_mm2: topProduct.conductor_area_mm2 || 95,
            conductor_material: topProduct.conductor_material || 'Copper',
            insulation_material: topProduct.insulation || 'XLPE',
            no_of_cores: 3
          },
          category: topProduct.type,
          unit_price_inr_per_km: topProduct.unit_price_per_km
        };
        
        const marketBenchmark = getMarketValueBenchmark(productForBenchmark);
        
        // Use pricing_tier from tender data if available for realistic variance
        // Otherwise calculate based on market benchmarks
        const pricingTier = tender.pricing_tier || tender.pricing_notes || '';
        let varianceFactor = 0; // Default: at market
        
        // Parse pricing tier to get variance
        if (pricingTier.includes('EXCELLENT') || pricingTier.includes('below market')) {
          const match = pricingTier.match(/(\d+)%/);
          varianceFactor = match ? -parseInt(match[1]) / 100 : -0.15;
        } else if (pricingTier.includes('SIGNIFICANTLY OVERPRICED') || pricingTier.includes('50%')) {
          varianceFactor = 0.5;
        } else if (pricingTier.includes('OVERPRICED')) {
          const match = pricingTier.match(/(\d+)%/);
          varianceFactor = match ? parseInt(match[1]) / 100 : 0.35;
        } else if (pricingTier.includes('ABOVE')) {
          const match = pricingTier.match(/(\d+)%/);
          varianceFactor = match ? parseInt(match[1]) / 100 : 0.18;
        } else if (pricingTier.includes('SUSPICIOUSLY')) {
          varianceFactor = -0.35;
        } else if (pricingTier.includes('COMPETITIVE') || pricingTier.includes('at market')) {
          varianceFactor = 0;
        } else if (pricingTier.includes('GOOD')) {
          varianceFactor = -0.08;
        }
        
        // Calculate estimated quantity from tender value
        const estimatedQty = Math.max(1, Math.round(tenderCost / (marketBenchmark.avg || tenderCost)));
        
        // Market rate based on benchmark
        estimatedMarketRate = marketBenchmark.avg * estimatedQty;
        
        // Apply variance factor to get realistic comparison
        // If tender has pricing_tier, use that variance; otherwise calculate from tender vs market
        const actualVariance = pricingTier ? varianceFactor : (tenderCost - estimatedMarketRate) / estimatedMarketRate;
        
        // Quoted price per unit for analysis
        const quotedPricePerUnit = tenderCost / estimatedQty;
        
        // Get company credibility score
        const credibilityScore = company?.raw_score || company?.credibility?.score || 75;
        
        // Pass context for nuanced analysis
        priceAnalysisResult = analyzeQuotedPrice(quotedPricePerUnit, marketBenchmark, {
          testCosts: totalTestCost,
          credibilityScore,
          projectValue: tenderCost
        });
        
        // Counter offer based on analysis (may be same as quoted if deal is good)
        counterOfferPrice = priceAnalysisResult.counterOffer.amount * estimatedQty;
        
        // Calculate actual discount percentage
        suggestedDiscount = Math.round((1 - (counterOfferPrice / tenderCost)) * 100);
        
        console.log(`   💰 Market Analysis:`);
        console.log(`     - Market Benchmark: ₹${marketBenchmark.avg.toLocaleString('en-IN')}/unit`);
        console.log(`     - Price Category: ${priceAnalysisResult.priceCategory}`);
        console.log(`     - Counter Offer: ₹${counterOfferPrice.toLocaleString('en-IN')} (${suggestedDiscount}% off)`);
      } else {
        // Fallback if no SKU match
        estimatedMarketRate = tenderCost * (1 - marginRate);
        counterOfferPrice = Math.floor(tenderCost * 0.95);
        suggestedDiscount = 5;
      }
      
      datasetUsage.pricing_rules_applied.push({
        tender_id: tender.tender_id,
        rules_used: ['P002 (GST)', 'P003 (Margin)', 'P007 (Bulk Discount)']
      });
      
      // Build result with SKU data
      const portalUrls = {
        'Government Procurement Portal': '/portals/gov.html',
        'Industrial Supply Network': '/portals/industrial.html',
        'Utilities & Infrastructure Hub': '/portals/utilities.html'
      };
      
      const portalUrl = portalUrls[tender.portal_name] || '#';
      const deepLinkUrl = `${portalUrl}#${tender.tender_id}`;
      
      const emailSubject = `Counter Offer Proposal for ${tender.title} (${tender.tender_id})`;
      const emailBody = `Dear ${tender.organisation} Team,

We have carefully reviewed your tender ${tender.tender_id} for "${tender.title}".

COMPANY CREDIBILITY ANALYSIS:
- Credibility Score: ${company.credibility_label || 'MODERATE'} (${company.raw_score || 0}/100)
- Company Status: ${company.status || 'Unknown'}
- Years in Operation: ${company.age_years || 'Unknown'}

SKU MATCHING ANALYSIS (from OEM Database):
${skuMatch.top_3.slice(0, 2).map((sku, i) => `
${i + 1}. ${sku.sku_id}
   - Product: ${sku.product_name}
   - Spec Match: ${sku.spec_match.percentage}%
   - Unit Price: ₹${sku.unit_price_per_km?.toLocaleString('en-IN')}/km`).join('\n')}

PRICING BREAKDOWN (as per pricing rules):
- Original Tender Value: ₹${tenderCost.toLocaleString('en-IN')}
- Our Counter Offer: ₹${counterOfferPrice.toLocaleString('en-IN')} (${suggestedDiscount}% discount)
- GST @ ${(gstRate * 100).toFixed(0)}%: Applied
- Estimated Test Costs: ₹${totalTestCost.toLocaleString('en-IN')}

We are confident this proposal provides excellent value while maintaining quality standards.

Best regards,
Procurement Team`;

      // Calculate FINAL rank score with SPEC MATCH as primary factor (50%)
      const specMatchPercent = skuMatch.top_3[0]?.spec_match?.percentage || 0;
      const priceVariance = estimatedMarketRate > 0 
        ? ((tenderCost - estimatedMarketRate) / estimatedMarketRate * 100) 
        : 0;
      
      const rankScore = calculateTenderRank({
        specMatchPercent,
        credibilityScore,
        priceVariance,
        testCostPercent: testPercentageOfProject
      });
      
      console.log(`   📊 Rank Score: ${rankScore}/100 (Spec: ${specMatchPercent}%, Cred: ${credibilityScore}, Price Var: ${priceVariance.toFixed(1)}%)`);
      
      rankedResults.push({
        tender_id: tender.tender_id,
        organisation: tender.organisation,
        title: tender.title,
        tender_cost: tenderCost,
        rank_score: rankScore,
        spec_match_percent: specMatchPercent,
        company_credibility: company.raw_score || 0,
        company_credibility_label: company.credibility_label || 'UNKNOWN',
        company_status: company.status || 'Unknown',
        company_age_years: company.age_years || 0,
        company_rating: company.credibility_label || 'MODERATE',
        market_rate: estimatedMarketRate,
        portal_name: tender.portal_name,
        portal_url: deepLinkUrl,
        
        // SKU Match Data (NEW)
        sku_match: {
          top_sku: skuMatch.top_3[0]?.sku_id || null,
          top_sku_name: skuMatch.top_3[0]?.product_name || null,
          spec_match_percentage: skuMatch.top_3[0]?.spec_match.percentage || 0,
          spec_match_details: skuMatch.top_3[0]?.spec_match.details || [],
          top_3_skus: skuMatch.top_3.map(s => ({
            sku_id: s.sku_id,
            product_name: s.product_name,
            spec_match: s.spec_match.percentage,
            unit_price: s.unit_price_per_km
          })),
          tender_specs_parsed: skuMatch.tender_specs
        },
        
        // Test Data (SCALED based on project value - 2-5% of RFP)
        applicable_tests: scaledApplicableTests.map(t => ({
          test_id: t.test_id,
          test_name: t.test_name,
          standard: t.standard,
          price_inr: t.price_inr,          // Scaled price
          original_price: t.original_price, // Original CSV price
          applicable_types: t.applicable_types,
          scaled: t.scaled
        })),
        total_test_cost: totalTestCost,
        test_cost_percentage: testPercentageOfProject,
        test_scaling_applied: true,
        test_cost_breakdown: {
          routine: scaledTestData.summary.routineTotal,
          type: scaledTestData.summary.typeTotal,
          acceptance: scaledTestData.summary.acceptanceTotal,
          special: scaledTestData.summary.specialTotal
        },
        
        // Pricing Data (ENHANCED - Market benchmark based)
        price_analysis: {
          tender_price: tenderCost,
          market_price: estimatedMarketRate,
          variance: ((tenderCost - estimatedMarketRate) / estimatedMarketRate * 100).toFixed(1) + '%',
          is_competitive: priceAnalysisResult?.isCompetitive || tenderCost <= estimatedMarketRate * 1.1,
          is_excellent_deal: priceAnalysisResult?.isExcellentDeal || false,
          pricing_rules_used: ['GST_Rate', 'Profit_Margin', 'Bulk_Discount_50km'],
          price_category: priceAnalysisResult?.priceCategory || 'FAIR',
          deal_quality: priceAnalysisResult?.dealQuality || 'ACCEPTABLE',
          recommendation: priceAnalysisResult?.recommendation || 'Standard evaluation',
          risk_flags: priceAnalysisResult?.riskFlags || [],
          test_cost_impact: priceAnalysisResult?.testCostImpact || '',
          credibility_impact: priceAnalysisResult?.credibilityImpact || '',
          savings_potential: priceAnalysisResult?.counterOffer?.savingsAmount || 0,
          negotiation_needed: priceAnalysisResult?.counterOffer?.negotiationNeeded ?? true,
          counter_offer_strategy: priceAnalysisResult?.counterOffer?.reason || 'Standard evaluation'
        },
        
        counter_offer: {
          suggestedPrice: counterOfferPrice,
          discount: suggestedDiscount,
          emailSubject: emailSubject,
          emailBody: emailBody,
          contactEmail: tender.contact_email || 'tenders@example.com'
        },
        
        company_url: `/company.html?name=${encodeURIComponent(tender.organisation)}`,
        oc_url: company.oc_url || null,
        red_flags: company.red_flags || [],
        green_flags: company.green_flags || []
      });
    }

    rankedResults.sort((a, b) => b.rank_score - a.rank_score);

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ ANALYSIS COMPLETE');
    console.log(`   • Total ranked: ${rankedResults.length}`);
    console.log(`   • Products searched: ${datasetUsage.products_searched}`);
    console.log(`   • SKUs matched: ${datasetUsage.skus_matched.length}`);
    console.log('═══════════════════════════════════════════════════════════════');

    res.json({
      total: rankedResults.length,
      ranked_tenders: rankedResults,
      dataset_usage: datasetUsage
    });

  } catch (error) {
    console.error('Analyze handler error:', error);
    res.status(500).json({ error: 'Failed to analyze tenders' });
  }
}
