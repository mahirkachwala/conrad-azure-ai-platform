/**
 * Adaptive Pricing Service
 * Calculates pricing using Material Cost + Testing Cost + Profit + GST
 * 
 * Features:
 * - Uses testing.csv for test cost calculation
 * - Uses pricing_rules.csv for pricing parameters
 * - Adaptive learning from user modifications
 * - Dynamic profit margin and discount handling
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { getCSVData, hasSessionOverride, getSessionStatus } from './adaptive-csv-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data paths (fallback when no session override)
const TESTING_CSV = path.join(__dirname, '../data/testing.csv');
const PRICING_RULES_CSV = path.join(__dirname, '../data/pricing_rules.csv');
const CABLE_CSVS = {
  'HT Cable': path.join(__dirname, '../data/products/ht_cables.csv'),
  'LT Cable': path.join(__dirname, '../data/products/lt_cables.csv'),
  'Control Cable': path.join(__dirname, '../data/products/control_cables.csv'),
  'EHV Cable': path.join(__dirname, '../data/products/ehv_cables.csv'),
  'Instrumentation Cable': path.join(__dirname, '../data/products/instrumentation_cables.csv')
};

// Map cable types to CSV override keys
const CABLE_TYPE_TO_CSV_KEY = {
  'HT Cable': 'ht_cables',
  'LT Cable': 'lt_cables',
  'Control Cable': 'control_cables',
  'EHV Cable': 'ehv_cables',
  'Instrumentation Cable': 'instrumentation_cables'
};

// Cached data
let testingData = [];
let pricingRules = {};
let cableProducts = {};

// Pricing knowledge (learned adjustments)
let pricingKnowledge = {
  marginAdjustments: {},
  preferredTests: {},
  discountPatterns: [],
  lastUpdated: null
};

const PRICING_KNOWLEDGE_PATH = path.join(__dirname, '../data/pricing_knowledge.json');

/**
 * Initialize the adaptive pricing system
 */
export async function initAdaptivePricing() {
  console.log('💰 Initializing Adaptive Pricing System...');
  
  // Load testing data
  loadTestingData();
  
  // Load pricing rules
  loadPricingRules();
  
  // Load cable products
  loadCableProducts();
  
  // Load learned knowledge
  loadPricingKnowledge();
  
  console.log(`   ✓ Loaded ${testingData.length} test types`);
  console.log(`   ✓ Loaded ${Object.keys(pricingRules).length} pricing rules`);
  console.log(`   ✓ Loaded ${Object.values(cableProducts).flat().length} cable products`);
  console.log('✅ Adaptive Pricing System initialized');
  
  return true;
}

/**
 * Load testing data from CSV (uses session override if available)
 */
function loadTestingData() {
  try {
    // Check for session override first
    if (hasSessionOverride('testing')) {
      testingData = getCSVData('testing');
      console.log('   📊 Using session-uploaded testing data');
      return;
    }
    
    // Fall back to default
    const content = fs.readFileSync(TESTING_CSV, 'utf-8');
    testingData = parse(content, { columns: true, skip_empty_lines: true });
  } catch (e) {
    console.warn('   ⚠️ Could not load testing.csv:', e.message);
    testingData = [];
  }
}

/**
 * Force reload testing data (for when session override changes)
 */
export function reloadTestingData() {
  loadTestingData();
  console.log(`   ✓ Reloaded ${testingData.length} test types`);
  return testingData.length;
}

/**
 * Load pricing rules from CSV
 */
function loadPricingRules() {
  try {
    const content = fs.readFileSync(PRICING_RULES_CSV, 'utf-8');
    const parsed = parse(content, { columns: true, skip_empty_lines: true });
    
    parsed.forEach(rule => {
      pricingRules[rule.Rule_ID] = {
        parameter: rule.Parameter,
        value: parseFloat(rule.Value),
        type: rule.Type,
        description: rule.Description
      };
    });
  } catch (e) {
    console.warn('   ⚠️ Could not load pricing_rules.csv:', e.message);
    pricingRules = getDefaultPricingRules();
  }
}

/**
 * Get default pricing rules as fallback
 */
function getDefaultPricingRules() {
  return {
    'P002': { parameter: 'GST_Rate', value: 0.18, type: 'percentage' },
    'P003': { parameter: 'Profit_Margin', value: 0.12, type: 'percentage' },
    'P001': { parameter: 'Delivery_Cost_Per_km', value: 300, type: 'fixed' },
    'P004': { parameter: 'Packaging_Cost_Per_km', value: 200, type: 'fixed' }
  };
}

/**
 * Load cable products from CSVs (uses session override if available)
 */
function loadCableProducts() {
  for (const [type, csvPath] of Object.entries(CABLE_CSVS)) {
    try {
      const csvKey = CABLE_TYPE_TO_CSV_KEY[type];
      
      // Check for session override first
      if (csvKey && hasSessionOverride(csvKey)) {
        cableProducts[type] = getCSVData(csvKey);
        console.log(`   📊 Using session-uploaded ${type} data`);
        continue;
      }
      
      // Fall back to default
      if (fs.existsSync(csvPath)) {
        const content = fs.readFileSync(csvPath, 'utf-8');
        cableProducts[type] = parse(content, { columns: true, skip_empty_lines: true });
      }
    } catch (e) {
      console.warn(`   ⚠️ Could not load ${type} CSV:`, e.message);
      cableProducts[type] = [];
    }
  }
}

/**
 * Force reload cable products (for when session override changes)
 */
export function reloadCableProducts() {
  loadCableProducts();
  const total = Object.values(cableProducts).flat().length;
  console.log(`   ✓ Reloaded ${total} cable products`);
  return total;
}

/**
 * Load learned pricing knowledge
 */
function loadPricingKnowledge() {
  try {
    if (fs.existsSync(PRICING_KNOWLEDGE_PATH)) {
      pricingKnowledge = JSON.parse(fs.readFileSync(PRICING_KNOWLEDGE_PATH, 'utf-8'));
    }
  } catch (e) {
    console.warn('   ⚠️ Could not load pricing knowledge');
  }
}

/**
 * Save pricing knowledge
 */
function savePricingKnowledge() {
  pricingKnowledge.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PRICING_KNOWLEDGE_PATH, JSON.stringify(pricingKnowledge, null, 2));
}

/**
 * Get applicable tests for a cable type
 * @param {string} cableType - e.g., 'HT Cable', 'LT Cable'
 * @param {string} testCategory - 'type_test', 'routine_test', 'acceptance_test', or 'custom'
 * @returns {array} - Applicable tests with prices
 */
export function getApplicableTests(cableType, testCategory = 'type_test') {
  if (!testingData.length) {
    loadTestingData();
  }
  
  const applicableTests = testingData.filter(test => {
    const types = (test.Applicable_Types || '').split(',').map(t => t.trim());
    return types.some(t => cableType.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(cableType.toLowerCase()));
  });
  
  // Filter by category if specified
  if (testCategory === 'type_test') {
    return applicableTests.filter(t => 
      t.Test_Name.includes('Type Test') || 
      ['T001', 'T002', 'T003', 'T004', 'T006', 'T007', 'T008', 'T009', 'T010', 'T011', 'T012', 'T013'].includes(t.Test_ID)
    );
  } else if (testCategory === 'routine_test') {
    return applicableTests.filter(t => 
      t.Test_Name.includes('Routine') || 
      ['T002', 'T003', 'T005', 'T014', 'T020', 'T021'].includes(t.Test_ID)
    );
  } else if (testCategory === 'acceptance_test') {
    return applicableTests.filter(t => 
      t.Test_Name.includes('Acceptance') || 
      ['T030'].includes(t.Test_ID)
    );
  }
  
  return applicableTests;
}

/**
 * Calculate testing cost for a cable
 * @param {string} cableType - Cable type
 * @param {array} requiredTests - Array of test IDs or 'type_test', 'routine_test'
 * @returns {object} - Testing cost breakdown
 */
export function calculateTestingCost(cableType, requiredTests = ['type_test', 'routine_test']) {
  const tests = [];
  let totalCost = 0;
  let totalDays = 0;
  
  for (const testReq of requiredTests) {
    if (['type_test', 'routine_test', 'acceptance_test'].includes(testReq)) {
      const applicableTests = getApplicableTests(cableType, testReq);
      
      // Use package tests if available
      const packageTest = applicableTests.find(t => t.Test_Name.includes('Package'));
      if (packageTest) {
        tests.push({
          id: packageTest.Test_ID,
          name: packageTest.Test_Name,
          standard: packageTest.Standard,
          price: parseFloat(packageTest.Price_INR),
          duration: parseInt(packageTest.Duration_Days)
        });
        totalCost += parseFloat(packageTest.Price_INR);
        totalDays = Math.max(totalDays, parseInt(packageTest.Duration_Days));
      } else {
        // Individual tests
        applicableTests.forEach(test => {
          tests.push({
            id: test.Test_ID,
            name: test.Test_Name,
            standard: test.Standard,
            price: parseFloat(test.Price_INR),
            duration: parseInt(test.Duration_Days)
          });
          totalCost += parseFloat(test.Price_INR);
          totalDays = Math.max(totalDays, parseInt(test.Duration_Days));
        });
      }
    } else {
      // Specific test ID
      const test = testingData.find(t => t.Test_ID === testReq);
      if (test) {
        tests.push({
          id: test.Test_ID,
          name: test.Test_Name,
          standard: test.Standard,
          price: parseFloat(test.Price_INR),
          duration: parseInt(test.Duration_Days)
        });
        totalCost += parseFloat(test.Price_INR);
        totalDays = Math.max(totalDays, parseInt(test.Duration_Days));
      }
    }
  }
  
  return {
    tests,
    totalCost,
    totalDays,
    cableType
  };
}

/**
 * Calculate testing cost from BUYER'S REQUIRED TESTS (from RFP)
 * This uses ACTUAL prices from testing.csv - NO scaling!
 * 
 * @param {array} requiredTestIds - Array of test IDs from RFP (e.g., ['T001', 'T002', 'T003'])
 * @param {number} itemCount - Number of cable items (tests may need to run for each item)
 * @returns {object} - Testing cost breakdown with actual CSV prices
 */
export function calculateTestingCostFromRFP(requiredTestIds, itemCount = 1) {
  if (!testingData.length) {
    loadTestingData();
  }
  
  const tests = [];
  let totalCost = 0;
  let totalDays = 0;
  
  // Parse test IDs if passed as comma-separated string
  const testIds = Array.isArray(requiredTestIds) 
    ? requiredTestIds 
    : requiredTestIds.split(',').map(t => t.trim());
  
  for (const testId of testIds) {
    const test = testingData.find(t => t.Test_ID === testId);
    if (test) {
      const price = parseFloat(test.Price_INR) || 0;
      const duration = parseInt(test.Duration_Days) || 1;
      
      tests.push({
        id: test.Test_ID,
        name: test.Test_Name,
        description: test.Description,
        standard: test.Standard,
        price: price,
        duration: duration,
        applicableTypes: test.Applicable_Types
      });
      
      totalCost += price;
      totalDays = Math.max(totalDays, duration);
    } else {
      console.warn(`[Pricing] Test ${testId} not found in testing.csv`);
    }
  }
  
  return {
    tests,
    testIds,
    totalCost,
    totalDays,
    itemCount,
    source: 'testing.csv',
    note: 'Calculated from buyer-specified tests using actual CSV prices'
  };
}

/**
 * Get test price by ID
 * @param {string} testId - Test ID (e.g., 'T001')
 * @returns {object|null} - Test data with price
 */
export function getTestById(testId) {
  if (!testingData.length) {
    loadTestingData();
  }
  
  const test = testingData.find(t => t.Test_ID === testId);
  if (test) {
    return {
      id: test.Test_ID,
      name: test.Test_Name,
      description: test.Description,
      standard: test.Standard,
      price: parseFloat(test.Price_INR) || 0,
      duration: parseInt(test.Duration_Days) || 1,
      applicableTypes: test.Applicable_Types
    };
  }
  return null;
}

/**
 * Find product by specifications
 * @param {string} cableType - Cable type
 * @param {object} specs - Specifications to match
 * @returns {object} - Matched product with price
 */
export function findProduct(cableType, specs = {}) {
  const products = cableProducts[cableType] || [];
  
  if (!products.length) {
    // Return estimate based on cable type
    return {
      found: false,
      estimatedPrice: getEstimatedPrice(cableType, specs),
      cableType
    };
  }
  
  // Try to match specifications
  let bestMatch = null;
  let bestScore = 0;
  
  for (const product of products) {
    let score = 0;
    
    // Match voltage
    if (specs.voltage) {
      const productVoltage = product.Voltage_Grade || product.Voltage || '';
      if (productVoltage.toLowerCase().includes(specs.voltage.toLowerCase())) {
        score += 3;
      }
    }
    
    // Match size/cross-section
    if (specs.size) {
      const productSize = product.Cross_Section || product.Size || '';
      if (productSize.includes(specs.size)) {
        score += 2;
      }
    }
    
    // Match cores
    if (specs.cores) {
      const productCores = product.Cores || product.Core || '';
      if (productCores.toString() === specs.cores.toString()) {
        score += 2;
      }
    }
    
    // Match conductor material
    if (specs.conductor) {
      const productConductor = product.Conductor_Material || product.Conductor || '';
      if (productConductor.toLowerCase().includes(specs.conductor.toLowerCase())) {
        score += 1;
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = product;
    }
  }
  
  if (bestMatch) {
    const price = parseFloat(bestMatch.Price_Per_Meter || bestMatch.Price_Per_km || bestMatch.Price || 0);
    return {
      found: true,
      product: bestMatch,
      pricePerMeter: price < 1000 ? price : price / 1000, // Normalize to per meter
      pricePerKm: price >= 1000 ? price : price * 1000,
      cableType
    };
  }
  
  return {
    found: false,
    estimatedPrice: getEstimatedPrice(cableType, specs),
    cableType
  };
}

/**
 * Calculate material cost from RFP cable requirements
 * Uses ACTUAL prices from cable CSVs with proper matching
 * 
 * @param {array} cableRequirements - Array of {cable_type, voltage, cores, size, conductor, quantity_km}
 * @returns {object} - Material cost breakdown with actual prices
 */
export function calculateMaterialCostFromRFP(cableRequirements) {
  const items = [];
  let totalCost = 0;
  
  for (const req of cableRequirements) {
    // Determine cable type category
    let cableTypeKey = 'LT Cable';
    const voltage = parseFloat(req.voltage) || 1.1;
    
    if (voltage >= 66) {
      cableTypeKey = 'EHV Cable';
    } else if (voltage >= 11) {
      cableTypeKey = 'HT Cable';
    } else if (req.cable_type?.toLowerCase().includes('control') || req.cores >= 7) {
      cableTypeKey = 'Control Cable';
    } else if (req.cable_type?.toLowerCase().includes('instrument')) {
      cableTypeKey = 'Instrumentation Cable';
    }
    
    const products = cableProducts[cableTypeKey] || [];
    
    // Find best matching product
    let bestMatch = null;
    let bestScore = 0;
    
    for (const product of products) {
      let score = 0;
      
      // Voltage match
      const productVoltage = parseFloat(product.Voltage_Rating_kV) || 1.1;
      if (Math.abs(productVoltage - voltage) < 0.5) {
        score += 30;
      } else if (Math.abs(productVoltage - voltage) < 2) {
        score += 15;
      }
      
      // Cores match
      const productCores = parseInt(product.No_of_Cores) || 0;
      const reqCores = parseInt(req.cores) || 0;
      if (productCores === reqCores) {
        score += 25;
      } else if (Math.abs(productCores - reqCores) <= 2) {
        score += 12;
      }
      
      // Size match
      const productSize = parseFloat(product.Conductor_Area_mm2) || 0;
      const reqSize = parseFloat(req.size) || 0;
      if (productSize === reqSize) {
        score += 25;
      } else if (Math.abs(productSize - reqSize) / reqSize < 0.2) {
        score += 12;
      }
      
      // Conductor match
      const productConductor = (product.Conductor_Material || '').toLowerCase();
      const reqConductor = (req.conductor || '').toLowerCase();
      if (reqConductor && productConductor.includes(reqConductor)) {
        score += 20;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = product;
      }
    }
    
    const quantityKm = parseFloat(req.quantity_km) || 1;
    let pricePerKm = 0;
    let matchPercent = 0;
    let productInfo = null;
    
    if (bestMatch) {
      pricePerKm = parseFloat(bestMatch.Unit_Price_per_km) || 0;
      matchPercent = bestScore;
      productInfo = {
        sku: bestMatch.SKU_ID,
        name: bestMatch.Product_Name,
        type: bestMatch.Type,
        voltage: bestMatch.Voltage_Rating_kV,
        cores: bestMatch.No_of_Cores,
        size: bestMatch.Conductor_Area_mm2,
        conductor: bestMatch.Conductor_Material
      };
    } else {
      // Fallback estimate
      pricePerKm = getEstimatedPrice(cableTypeKey, { voltage, cores: req.cores, size: req.size }) * 1000;
    }
    
    const lineCost = pricePerKm * quantityKm;
    totalCost += lineCost;
    
    items.push({
      requirement: req,
      cableTypeKey,
      matchedProduct: productInfo,
      matchPercentage: matchPercent,
      pricePerKm,
      quantityKm,
      lineCost,
      source: bestMatch ? 'csv' : 'estimated'
    });
  }
  
  return {
    items,
    totalCost,
    itemCount: items.length,
    allFromCSV: items.every(i => i.source === 'csv'),
    note: 'Calculated from actual CSV prices based on RFP requirements'
  };
}

/**
 * Get estimated price when product not found
 */
function getEstimatedPrice(cableType, specs) {
  const baseRates = {
    'HT Cable': 850, // per meter
    'LT Cable': 320,
    'Control Cable': 280,
    'EHV Cable': 2500,
    'Instrumentation Cable': 180
  };
  
  let base = baseRates[cableType] || 400;
  
  // Adjust for voltage
  if (specs.voltage) {
    const voltage = parseInt(specs.voltage);
    if (voltage >= 66) base *= 3;
    else if (voltage >= 33) base *= 2;
    else if (voltage >= 11) base *= 1.5;
  }
  
  // Adjust for size
  if (specs.size) {
    const size = parseFloat(specs.size);
    if (size >= 400) base *= 2.5;
    else if (size >= 185) base *= 1.8;
    else if (size >= 95) base *= 1.4;
  }
  
  return base;
}

/**
 * Calculate complete pricing quotation
 * @param {object} params - Pricing parameters
 * @returns {object} - Complete pricing breakdown
 */
export function calculateQuotation(params) {
  const {
    cableType,
    specs = {},
    quantity = 1000, // in meters
    requiredTests = ['type_test', 'routine_test'],
    customProfitMargin = null,
    discount = 0,
    includeDelivery = true,
    includePackaging = true
  } = params;
  
  // 1. Get material cost
  const productInfo = findProduct(cableType, specs);
  const pricePerMeter = productInfo.pricePerMeter || productInfo.estimatedPrice;
  const materialCost = pricePerMeter * quantity;
  
  // 2. Get testing cost
  const testingInfo = calculateTestingCost(cableType, requiredTests);
  const testingCost = testingInfo.totalCost;
  
  // 3. Get pricing rules
  const gstRate = pricingRules['P002']?.value || 0.18;
  const profitMarginRate = customProfitMargin !== null 
    ? customProfitMargin / 100 
    : (pricingRules['P003']?.value || 0.12);
  const deliveryCostPerKm = pricingRules['P001']?.value || 300;
  const packagingCostPerKm = pricingRules['P004']?.value || 200;
  
  // 4. Calculate costs
  const quantityInKm = quantity / 1000;
  const deliveryCost = includeDelivery ? deliveryCostPerKm * Math.max(1, quantityInKm) : 0;
  const packagingCost = includePackaging ? packagingCostPerKm * Math.max(1, quantityInKm) : 0;
  
  // 5. Apply bulk discount
  let bulkDiscount = 0;
  if (quantityInKm >= 200) bulkDiscount = pricingRules['P009']?.value || 0.08;
  else if (quantityInKm >= 100) bulkDiscount = pricingRules['P008']?.value || 0.05;
  else if (quantityInKm >= 50) bulkDiscount = pricingRules['P007']?.value || 0.03;
  
  // 6. Subtotal before profit
  const subtotal = materialCost + testingCost + deliveryCost + packagingCost;
  
  // 7. Apply discounts
  const totalDiscount = subtotal * (bulkDiscount + (discount / 100));
  const afterDiscount = subtotal - totalDiscount;
  
  // 8. Add profit margin
  const profit = afterDiscount * profitMarginRate;
  const beforeGST = afterDiscount + profit;
  
  // 9. Add GST
  const gst = beforeGST * gstRate;
  const grandTotal = beforeGST + gst;
  
  return {
    summary: {
      cableType,
      quantity: `${quantity} meters (${quantityInKm.toFixed(2)} km)`,
      pricePerMeter: `₹${pricePerMeter.toFixed(2)}`,
      grandTotal: `₹${grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
    },
    
    breakdown: {
      materialCost: {
        label: 'Material Cost',
        value: materialCost,
        formatted: `₹${materialCost.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
        details: `${pricePerMeter.toFixed(2)}/m × ${quantity}m`
      },
      testingCost: {
        label: 'Testing Cost',
        value: testingCost,
        formatted: `₹${testingCost.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
        tests: testingInfo.tests,
        totalDays: testingInfo.totalDays
      },
      deliveryCost: {
        label: 'Delivery Cost',
        value: deliveryCost,
        formatted: `₹${deliveryCost.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
      },
      packagingCost: {
        label: 'Packaging Cost',
        value: packagingCost,
        formatted: `₹${packagingCost.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
      },
      subtotal: {
        label: 'Subtotal',
        value: subtotal,
        formatted: `₹${subtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
      },
      discount: {
        label: `Discount (${((bulkDiscount + discount/100) * 100).toFixed(1)}%)`,
        value: totalDiscount,
        formatted: `-₹${totalDiscount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
      },
      profit: {
        label: `Profit Margin (${(profitMarginRate * 100).toFixed(1)}%)`,
        value: profit,
        formatted: `₹${profit.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
      },
      gst: {
        label: `GST (${(gstRate * 100).toFixed(0)}%)`,
        value: gst,
        formatted: `₹${gst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
      },
      grandTotal: {
        label: 'Grand Total',
        value: grandTotal,
        formatted: `₹${grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
        highlight: true
      }
    },
    
    testing: testingInfo,
    productInfo,
    
    // For adaptive modifications
    modifiable: {
      profitMargin: profitMarginRate * 100,
      discount: discount + (bulkDiscount * 100),
      quantity,
      includeDelivery,
      includePackaging
    }
  };
}

/**
 * Learn from pricing modification
 */
export function learnPricingAdjustment(cableType, adjustment) {
  if (!pricingKnowledge.marginAdjustments[cableType]) {
    pricingKnowledge.marginAdjustments[cableType] = [];
  }
  
  pricingKnowledge.marginAdjustments[cableType].push({
    adjustment,
    timestamp: new Date().toISOString()
  });
  
  savePricingKnowledge();
}

/**
 * Get all tests data for display
 */
export function getAllTests() {
  return testingData.map(test => ({
    id: test.Test_ID,
    name: test.Test_Name,
    description: test.Description,
    standard: test.Standard,
    price: parseFloat(test.Price_INR),
    duration: parseInt(test.Duration_Days),
    applicableTypes: (test.Applicable_Types || '').split(',').map(t => t.trim())
  }));
}

/**
 * Get pricing rules for display
 */
export function getPricingRules() {
  return pricingRules;
}

/**
 * Get pricing system status
 */
export function getPricingStatus() {
  return {
    testsLoaded: testingData.length,
    rulesLoaded: Object.keys(pricingRules).length,
    productsLoaded: Object.values(cableProducts).flat().length,
    knowledgePatterns: {
      marginAdjustments: Object.keys(pricingKnowledge.marginAdjustments).length,
      preferredTests: Object.keys(pricingKnowledge.preferredTests).length,
      discountPatterns: pricingKnowledge.discountPatterns.length
    }
  };
}

export default {
  initAdaptivePricing,
  getApplicableTests,
  calculateTestingCost,
  calculateTestingCostFromRFP,
  getTestById,
  findProduct,
  calculateMaterialCostFromRFP,
  calculateQuotation,
  learnPricingAdjustment,
  getAllTests,
  getPricingRules,
  getPricingStatus,
  reloadTestingData,
  reloadCableProducts
};


