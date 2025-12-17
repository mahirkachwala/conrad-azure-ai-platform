/**
 * Pricing Tools for Agentic System
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * LangChain tool definitions for pricing calculations and quotation generation.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load testing services pricing
function loadTestingPrices() {
  const testingPath = path.join(__dirname, '../../data/testing.csv');
  const tests = [];
  
  if (!fs.existsSync(testingPath)) {
    // Return default tests if file not found
    return [
      { Test_ID: 'RT-001', Test_Name: 'Conductor Resistance Test', Category: 'Routine', Price_INR: 15000 },
      { Test_ID: 'RT-002', Test_Name: 'High Voltage Test', Category: 'Routine', Price_INR: 25000 },
      { Test_ID: 'RT-003', Test_Name: 'Insulation Resistance Test', Category: 'Routine', Price_INR: 18000 },
      { Test_ID: 'TT-001', Test_Name: 'Partial Discharge Test', Category: 'Type', Price_INR: 75000 },
      { Test_ID: 'TT-002', Test_Name: 'Impulse Withstand Test', Category: 'Type', Price_INR: 120000 },
      { Test_ID: 'TT-003', Test_Name: 'Bending Test', Category: 'Type', Price_INR: 45000 },
      { Test_ID: 'AT-001', Test_Name: 'Site Acceptance Test', Category: 'Acceptance', Price_INR: 35000 },
      { Test_ID: 'AT-002', Test_Name: 'Continuity Test (Site)', Category: 'Acceptance', Price_INR: 12000 }
    ];
  }
  
  const content = fs.readFileSync(testingPath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const test = {};
    headers.forEach((h, idx) => {
      test[h] = values[idx]?.trim() || '';
    });
    tests.push(test);
  }
  
  return tests;
}

// Load product catalog for pricing
function loadProductPrices() {
  const productsDir = path.join(__dirname, '../../data/products');
  const products = [];
  
  if (!fs.existsSync(productsDir)) return products;
  
  const csvFiles = fs.readdirSync(productsDir).filter(f => f.endsWith('.csv'));
  
  for (const csvFile of csvFiles) {
    const csvPath = path.join(productsDir, csvFile);
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const product = {};
      headers.forEach((h, idx) => {
        product[h] = values[idx]?.trim() || '';
      });
      products.push(product);
    }
  }
  
  return products;
}

/**
 * Tool: Get Product Price
 * Returns pricing details for a specific SKU
 */
export const getProductPriceTool = tool(
  async ({ sku_id }) => {
    const products = loadProductPrices();
    const product = products.find(p => p.SKU_ID === sku_id);
    
    if (!product) {
      return JSON.stringify({
        found: false,
        error: `SKU ${sku_id} not found in price catalog`
      });
    }
    
    const unitPrice = parseFloat(product.Unit_Price_per_km) || 0;
    
    // Calculate market benchmarks (simulated)
    const marketLow = Math.round(unitPrice * 0.85);
    const marketHigh = Math.round(unitPrice * 1.15);
    const marketAvg = Math.round(unitPrice * 1.0);
    
    return JSON.stringify({
      found: true,
      sku_id,
      product_name: product.Product_Name,
      unit_price_per_km: unitPrice,
      currency: "INR",
      market_benchmark: {
        low: marketLow,
        average: marketAvg,
        high: marketHigh
      },
      lead_time_days: parseInt(product.Lead_Time_Days) || 14,
      min_order_quantity: parseInt(product.MOQ) || 1
    });
  },
  {
    name: "get_product_price",
    description: "Get pricing details for a specific product SKU including unit price and market benchmarks",
    schema: z.object({
      sku_id: z.string().describe("Product SKU ID")
    })
  }
);

/**
 * Tool: Calculate Line Item Price
 * Calculates total price for a product line item
 */
export const calculateLineItemPriceTool = tool(
  async ({ sku_id, quantity_km, apply_discount }) => {
    const products = loadProductPrices();
    const product = products.find(p => p.SKU_ID === sku_id);
    
    if (!product) {
      return JSON.stringify({
        error: `SKU ${sku_id} not found`
      });
    }
    
    const unitPrice = parseFloat(product.Unit_Price_per_km) || 0;
    const qty = parseFloat(quantity_km) || 1;
    
    // Calculate discount based on quantity
    let discountPercentage = 0;
    if (apply_discount) {
      if (qty >= 100) discountPercentage = 12;
      else if (qty >= 50) discountPercentage = 8;
      else if (qty >= 20) discountPercentage = 5;
      else if (qty >= 10) discountPercentage = 3;
    }
    
    const grossTotal = unitPrice * qty;
    const discountAmount = grossTotal * (discountPercentage / 100);
    const netTotal = grossTotal - discountAmount;
    
    return JSON.stringify({
      sku_id,
      product_name: product.Product_Name,
      unit_price_per_km: unitPrice,
      quantity_km: qty,
      gross_total: Math.round(grossTotal),
      discount_percentage: discountPercentage,
      discount_amount: Math.round(discountAmount),
      net_total: Math.round(netTotal),
      currency: "INR"
    });
  },
  {
    name: "calculate_line_item_price",
    description: "Calculate the total price for a product line item with optional quantity discount",
    schema: z.object({
      sku_id: z.string().describe("Product SKU ID"),
      quantity_km: z.number().describe("Quantity in kilometers"),
      apply_discount: z.boolean().optional().describe("Whether to apply quantity-based discount")
    })
  }
);

/**
 * Tool: Get Test Prices
 * Returns pricing for testing services
 */
export const getTestPricesTool = tool(
  async ({ test_categories, project_value }) => {
    const allTests = loadTestingPrices();
    
    // Filter by categories if specified
    let tests = allTests;
    if (test_categories && test_categories.length > 0) {
      tests = allTests.filter(t => 
        test_categories.some(cat => 
          (t.Category || t.category || '').toLowerCase() === cat.toLowerCase()
        )
      );
    }
    
    // Scale test prices based on project value (if provided)
    const baseProjectValue = 10000000; // 1 crore
    const scalingFactor = project_value 
      ? Math.max(0.5, Math.min(2.0, Math.sqrt(project_value / baseProjectValue)))
      : 1.0;
    
    const pricedTests = tests.map(t => ({
      test_id: t.Test_ID || t.test_id,
      test_name: t.Test_Name || t.test_name,
      category: t.Category || t.category,
      base_price: parseInt(t.Price_INR || t.price_inr) || 0,
      scaled_price: Math.round((parseInt(t.Price_INR || t.price_inr) || 0) * scalingFactor),
      scaling_factor: Math.round(scalingFactor * 100) / 100
    }));
    
    const totalBasePrice = pricedTests.reduce((sum, t) => sum + t.base_price, 0);
    const totalScaledPrice = pricedTests.reduce((sum, t) => sum + t.scaled_price, 0);
    
    return JSON.stringify({
      tests: pricedTests,
      total_tests: pricedTests.length,
      total_base_price: totalBasePrice,
      total_scaled_price: totalScaledPrice,
      scaling_factor: Math.round(scalingFactor * 100) / 100,
      project_value_used: project_value || baseProjectValue,
      currency: "INR"
    });
  },
  {
    name: "get_test_prices",
    description: "Get pricing for testing services, optionally scaled based on project value",
    schema: z.object({
      test_categories: z.array(z.string()).optional()
        .describe("Filter by test categories (e.g., ['Routine', 'Type', 'Acceptance'])"),
      project_value: z.number().optional()
        .describe("Project value in INR for scaling test prices proportionally")
    })
  }
);

/**
 * Tool: Generate Quotation
 * Creates a complete quotation with material and services
 */
export const generateQuotationTool = tool(
  async ({ products, include_tests, project_value, gst_rate }) => {
    const productPrices = loadProductPrices();
    const allTests = loadTestingPrices();
    
    // Calculate material costs
    const materialItems = [];
    let totalMaterialCost = 0;
    
    for (const item of products) {
      const product = productPrices.find(p => p.SKU_ID === item.sku_id);
      const unitPrice = product 
        ? parseFloat(product.Unit_Price_per_km) 
        : item.unit_price || 100000;
      
      const lineTotal = unitPrice * (item.quantity_km || 1);
      totalMaterialCost += lineTotal;
      
      materialItems.push({
        sku_id: item.sku_id,
        product_name: product?.Product_Name || item.product_name || 'Unknown Product',
        unit_price: Math.round(unitPrice),
        quantity_km: item.quantity_km || 1,
        line_total: Math.round(lineTotal)
      });
    }
    
    // Calculate test costs
    let testItems = [];
    let totalTestCost = 0;
    
    if (include_tests) {
      // Scale test prices based on project value
      const baseProjectValue = 10000000;
      const projVal = project_value || totalMaterialCost;
      const scalingFactor = Math.max(0.5, Math.min(2.0, Math.sqrt(projVal / baseProjectValue)));
      
      testItems = allTests.slice(0, 6).map(t => {
        const basePrice = parseInt(t.Price_INR || t.price_inr) || 20000;
        const scaledPrice = Math.round(basePrice * scalingFactor);
        totalTestCost += scaledPrice;
        
        return {
          test_id: t.Test_ID || t.test_id,
          test_name: t.Test_Name || t.test_name,
          category: t.Category || t.category,
          price: scaledPrice
        };
      });
    }
    
    // Calculate totals
    const subtotal = totalMaterialCost + totalTestCost;
    const gstPercent = gst_rate || 18;
    const gstAmount = Math.round(subtotal * (gstPercent / 100));
    const grandTotal = subtotal + gstAmount;
    
    return JSON.stringify({
      quotation: {
        generated_at: new Date().toISOString(),
        
        material: {
          items: materialItems,
          total: Math.round(totalMaterialCost)
        },
        
        services: {
          items: testItems,
          total: Math.round(totalTestCost)
        },
        
        summary: {
          subtotal: Math.round(subtotal),
          gst_rate: gstPercent,
          gst_amount: gstAmount,
          grand_total: grandTotal
        },
        
        currency: "INR",
        validity_days: 30,
        payment_terms: "30% advance, 70% on delivery"
      }
    });
  },
  {
    name: "generate_quotation",
    description: "Generate a complete quotation including material costs, test costs, and GST",
    schema: z.object({
      products: z.array(z.object({
        sku_id: z.string(),
        product_name: z.string().optional(),
        quantity_km: z.number(),
        unit_price: z.number().optional()
      })).describe("List of products with quantities"),
      include_tests: z.boolean().optional().describe("Whether to include testing services"),
      project_value: z.number().optional().describe("Project value for test cost scaling"),
      gst_rate: z.number().optional().describe("GST rate percentage. Default 18.")
    })
  }
);

/**
 * Tool: Format Currency
 * Formats numbers in Indian currency format (lakhs/crores)
 */
export const formatCurrencyTool = tool(
  async ({ amount, format }) => {
    const num = parseFloat(amount);
    
    if (isNaN(num)) {
      return JSON.stringify({ error: "Invalid amount" });
    }
    
    let formatted;
    let unit = "";
    
    if (format === "lakhs_crores" || !format) {
      if (num >= 10000000) {
        formatted = (num / 10000000).toFixed(2);
        unit = "Cr";
      } else if (num >= 100000) {
        formatted = (num / 100000).toFixed(2);
        unit = "L";
      } else if (num >= 1000) {
        formatted = (num / 1000).toFixed(2);
        unit = "K";
      } else {
        formatted = num.toFixed(0);
      }
    } else {
      // Standard Indian format
      formatted = num.toLocaleString('en-IN');
    }
    
    return JSON.stringify({
      original: num,
      formatted: `₹${formatted}${unit}`,
      unit,
      currency: "INR"
    });
  },
  {
    name: "format_currency",
    description: "Format a number as Indian currency (in lakhs/crores format)",
    schema: z.object({
      amount: z.number().describe("Amount in INR"),
      format: z.enum(["lakhs_crores", "standard"]).optional()
        .describe("Output format. Default lakhs_crores.")
    })
  }
);

export const pricingTools = [
  getProductPriceTool,
  calculateLineItemPriceTool,
  getTestPricesTool,
  generateQuotationTool,
  formatCurrencyTool
];

export default pricingTools;



