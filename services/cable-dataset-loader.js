/**
 * Cable Dataset Loader
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * This module handles loading, parsing, and normalizing cable product datasets
 * from CSV files for use by the Technical and Pricing agents.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PATHS } from '../configs/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache for loaded datasets
const datasetCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Parse CSV string into array of objects
 */
function parseCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];
  
  // Parse header - handle quoted values
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
      
      // Auto-convert numeric values
      if (/^\d+$/.test(value)) {
        value = parseInt(value, 10);
      } else if (/^\d+\.\d+$/.test(value)) {
        value = parseFloat(value);
      }
      
      row[header] = value;
    });
    
    data.push(row);
  }
  
  return data;
}

/**
 * Load and cache a CSV file
 */
function loadCachedCSV(filePath, cacheKey) {
  const cached = datasetCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const csvContent = fs.readFileSync(filePath, 'utf8');
    const data = parseCSV(csvContent);
    datasetCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.error(`Error loading ${cacheKey}:`, error.message);
    return [];
  }
}

/**
 * Cable Product Dataset Class
 * Handles loading, normalization, and querying of cable products
 */
export class CableDataset {
  constructor() {
    this.products = [];
    this.tests = [];
    this.pricingRules = [];
    this.loaded = false;
  }
  
  /**
   * Load all datasets
   */
  load() {
    const dataPath = PATHS.data || path.join(__dirname, '..', 'data');
    
    this.products = loadCachedCSV(
      path.join(dataPath, 'products.csv'),
      'cable-products'
    );
    
    this.tests = loadCachedCSV(
      path.join(dataPath, 'testing.csv'),
      'cable-tests'
    );
    
    this.pricingRules = loadCachedCSV(
      path.join(dataPath, 'pricing_rules.csv'),
      'pricing-rules'
    );
    
    // Normalize the data
    this.normalizeProducts();
    this.loaded = true;
    
    return this;
  }
  
  /**
   * Normalize product attributes for consistent matching
   */
  normalizeProducts() {
    this.products = this.products.map(p => ({
      ...p,
      // Ensure numeric fields
      conductor_area_mm2: parseFloat(p.conductor_area_mm2) || 0,
      voltage_rating_kv: parseFloat(p.voltage_rating_kv) || 0,
      no_of_cores: parseInt(p.no_of_cores, 10) || 1,
      unit_price_per_km: parseFloat(p.unit_price_per_km) || 0,
      unit_weight_kg_per_km: parseFloat(p.unit_weight_kg_per_km) || 0,
      lead_time_days: parseInt(p.lead_time_days, 10) || 14,
      
      // Normalize text fields
      type: (p.type || '').toLowerCase(),
      conductor_material: (p.conductor_material || '').toLowerCase(),
      insulation: (p.insulation || '').toUpperCase(),
      armoured: String(p.armoured || '').toLowerCase() === 'yes',
      standard: p.standard || 'IS 7098',
      
      // Generate search text for embeddings
      search_text: this.generateSearchText(p)
    }));
  }
  
  /**
   * Generate searchable text for a product
   */
  generateSearchText(product) {
    const parts = [
      product.product_name,
      product.type,
      `${product.no_of_cores} core`,
      `${product.conductor_area_mm2} sq mm`,
      `${product.conductor_area_mm2} sqmm`,
      product.conductor_material,
      `${product.voltage_rating_kv}kV`,
      `${product.voltage_rating_kv} kV`,
      product.insulation,
      product.armoured === 'Yes' ? 'armoured' : 'unarmoured',
      product.standard,
      product.description
    ];
    return parts.filter(Boolean).join(' ').toLowerCase();
  }
  
  /**
   * Get all products
   */
  getProducts() {
    if (!this.loaded) this.load();
    return this.products;
  }
  
  /**
   * Get all tests
   */
  getTests() {
    if (!this.loaded) this.load();
    return this.tests;
  }
  
  /**
   * Get pricing rules
   */
  getPricingRules() {
    if (!this.loaded) this.load();
    return this.pricingRules;
  }
  
  /**
   * Get a pricing rule by ID or parameter name
   */
  getPricingRule(identifier) {
    if (!this.loaded) this.load();
    return this.pricingRules.find(r => 
      r.rule_id === identifier || 
      r.parameter.toLowerCase() === identifier.toLowerCase()
    );
  }
  
  /**
   * Filter products by criteria
   */
  filterProducts(criteria = {}) {
    if (!this.loaded) this.load();
    
    let results = [...this.products];
    
    if (criteria.type) {
      const type = criteria.type.toLowerCase();
      results = results.filter(p => p.type.includes(type));
    }
    
    if (criteria.conductor_material) {
      const mat = criteria.conductor_material.toLowerCase();
      results = results.filter(p => p.conductor_material.includes(mat));
    }
    
    if (criteria.min_area) {
      results = results.filter(p => p.conductor_area_mm2 >= criteria.min_area);
    }
    
    if (criteria.max_area) {
      results = results.filter(p => p.conductor_area_mm2 <= criteria.max_area);
    }
    
    if (criteria.conductor_area) {
      results = results.filter(p => p.conductor_area_mm2 === criteria.conductor_area);
    }
    
    if (criteria.min_voltage) {
      results = results.filter(p => p.voltage_rating_kv >= criteria.min_voltage);
    }
    
    if (criteria.max_voltage) {
      results = results.filter(p => p.voltage_rating_kv <= criteria.max_voltage);
    }
    
    if (criteria.voltage_rating) {
      results = results.filter(p => p.voltage_rating_kv === criteria.voltage_rating);
    }
    
    if (criteria.cores) {
      results = results.filter(p => p.no_of_cores === criteria.cores);
    }
    
    if (criteria.armoured !== undefined) {
      results = results.filter(p => p.armoured === criteria.armoured);
    }
    
    if (criteria.insulation) {
      const ins = criteria.insulation.toUpperCase();
      results = results.filter(p => p.insulation === ins);
    }
    
    if (criteria.standard) {
      results = results.filter(p => 
        p.standard.toLowerCase().includes(criteria.standard.toLowerCase())
      );
    }
    
    return results;
  }
  
  /**
   * Get product by SKU ID
   */
  getProductBySKU(skuId) {
    if (!this.loaded) this.load();
    return this.products.find(p => p.sku_id === skuId);
  }
  
  /**
   * Get tests applicable for a product type
   */
  getTestsForProductType(productType) {
    if (!this.loaded) this.load();
    
    const type = productType.toLowerCase();
    return this.tests.filter(t => {
      const applicableTypes = (t.applicable_types || '').toLowerCase();
      return applicableTypes.includes(type) || 
             applicableTypes.includes('all');
    });
  }
  
  /**
   * Get test by ID
   */
  getTestById(testId) {
    if (!this.loaded) this.load();
    return this.tests.find(t => t.test_id === testId);
  }
  
  /**
   * Calculate total test cost for given test IDs
   */
  calculateTestCost(testIds = []) {
    if (!this.loaded) this.load();
    
    let totalCost = 0;
    let totalDays = 0;
    const testDetails = [];
    
    for (const testId of testIds) {
      const test = this.getTestById(testId);
      if (test) {
        totalCost += test.price_inr || 0;
        totalDays += test.duration_days || 0;
        testDetails.push({
          test_id: test.test_id,
          name: test.test_name,
          cost: test.price_inr,
          days: test.duration_days
        });
      }
    }
    
    return { totalCost, totalDays, tests: testDetails };
  }
  
  /**
   * Calculate complete pricing for a product order
   */
  calculateOrderPricing(skuId, quantityKm, options = {}) {
    if (!this.loaded) this.load();
    
    const product = this.getProductBySKU(skuId);
    if (!product) {
      return { error: 'Product not found', skuId };
    }
    
    // Base product cost
    const basePrice = product.unit_price_per_km * quantityKm;
    
    // Get pricing rules
    const gstRate = this.getPricingRule('GST_Rate')?.value || 0.18;
    const margin = this.getPricingRule('Profit_Margin')?.value || 0.12;
    const deliveryCostPerKm = this.getPricingRule('Delivery_Cost_Per_km')?.value || 300;
    const packagingCostPerKm = this.getPricingRule('Packaging_Cost_Per_km')?.value || 200;
    const insuranceRate = this.getPricingRule('Insurance_Rate')?.value || 0.005;
    const handlingRate = this.getPricingRule('Handling_Charges')?.value || 0.02;
    
    // Calculate bulk discount
    let bulkDiscount = 0;
    if (quantityKm >= 200) {
      bulkDiscount = this.getPricingRule('Bulk_Discount_200km')?.value || 0.08;
    } else if (quantityKm >= 100) {
      bulkDiscount = this.getPricingRule('Bulk_Discount_100km')?.value || 0.05;
    } else if (quantityKm >= 50) {
      bulkDiscount = this.getPricingRule('Bulk_Discount_50km')?.value || 0.03;
    }
    
    // Calculate test costs if specified
    let testCost = 0;
    let testDetails = [];
    if (options.testIds && options.testIds.length > 0) {
      const testResult = this.calculateTestCost(options.testIds);
      testCost = testResult.totalCost;
      testDetails = testResult.tests;
    }
    
    // Build pricing breakdown
    const deliveryCost = deliveryCostPerKm * quantityKm;
    const packagingCost = packagingCostPerKm * quantityKm;
    const discountAmount = basePrice * bulkDiscount;
    const discountedPrice = basePrice - discountAmount;
    const insuranceCost = discountedPrice * insuranceRate;
    const handlingCost = discountedPrice * handlingRate;
    
    const subtotal = discountedPrice + deliveryCost + packagingCost + insuranceCost + handlingCost + testCost;
    const marginAmount = subtotal * margin;
    const preGstTotal = subtotal + marginAmount;
    const gstAmount = preGstTotal * gstRate;
    const grandTotal = preGstTotal + gstAmount;
    
    return {
      sku_id: skuId,
      product_name: product.product_name,
      quantity_km: quantityKm,
      unit_price: product.unit_price_per_km,
      lead_time_days: product.lead_time_days,
      
      breakdown: {
        base_price: Math.round(basePrice),
        bulk_discount: Math.round(discountAmount),
        discounted_price: Math.round(discountedPrice),
        delivery_cost: Math.round(deliveryCost),
        packaging_cost: Math.round(packagingCost),
        insurance_cost: Math.round(insuranceCost),
        handling_cost: Math.round(handlingCost),
        test_cost: Math.round(testCost),
        subtotal: Math.round(subtotal),
        margin: Math.round(marginAmount),
        pre_gst_total: Math.round(preGstTotal),
        gst: Math.round(gstAmount),
        grand_total: Math.round(grandTotal)
      },
      
      tests: testDetails,
      
      rates_applied: {
        gst_rate: gstRate,
        margin_rate: margin,
        bulk_discount_rate: bulkDiscount,
        insurance_rate: insuranceRate
      }
    };
  }
  
  /**
   * Clear dataset cache
   */
  clearCache() {
    datasetCache.clear();
    this.loaded = false;
  }
  
  /**
   * Get dataset statistics
   */
  getStats() {
    if (!this.loaded) this.load();
    
    return {
      total_products: this.products.length,
      total_tests: this.tests.length,
      total_pricing_rules: this.pricingRules.length,
      product_types: [...new Set(this.products.map(p => p.type))],
      voltage_range: {
        min: Math.min(...this.products.map(p => p.voltage_rating_kv)),
        max: Math.max(...this.products.map(p => p.voltage_rating_kv))
      },
      conductor_area_range: {
        min: Math.min(...this.products.map(p => p.conductor_area_mm2)),
        max: Math.max(...this.products.map(p => p.conductor_area_mm2))
      },
      materials: [...new Set(this.products.map(p => p.conductor_material))]
    };
  }
}

// Singleton instance
let datasetInstance = null;

/**
 * Get the cable dataset instance (singleton)
 */
export function getCableDataset() {
  if (!datasetInstance) {
    datasetInstance = new CableDataset();
    datasetInstance.load();
  }
  return datasetInstance;
}

// Export convenience functions
export const loadCableProducts = () => getCableDataset().getProducts();
export const loadCableTests = () => getCableDataset().getTests();
export const loadPricingRules = () => getCableDataset().getPricingRules();
export const filterCableProducts = (criteria) => getCableDataset().filterProducts(criteria);
export const getProductBySKU = (skuId) => getCableDataset().getProductBySKU(skuId);
export const calculateOrderPricing = (skuId, qty, opts) => getCableDataset().calculateOrderPricing(skuId, qty, opts);

export default {
  CableDataset,
  getCableDataset,
  loadCableProducts,
  loadCableTests,
  loadPricingRules,
  filterCableProducts,
  getProductBySKU,
  calculateOrderPricing
};











