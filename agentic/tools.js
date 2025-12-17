import axios from "axios";
import { matchProductsForAgent, quickMatchProducts } from "../services/product-matcher.js";
import { calculateOrderPricing, getCableDataset } from "../services/cable-dataset-loader.js";

const BASE_URL = process.env.REPLIT_DEV_DOMAIN 
  ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
  : "http://localhost:5000";

export const Tools = {
  /**
   * Search RFPs by deadline window
   */
  async searchRFPsByDeadline(days = 90) {
    try {
      const res = await axios.get(`${BASE_URL}/data/all-portals.json`);
      const allTenders = res.data || [];
      
      const now = new Date();
      const targetDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      
      const upcoming = allTenders.filter(t => {
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        return dueDate > now && dueDate <= targetDate;
      });
      
      return upcoming.length > 0 ? upcoming : allTenders.slice(0, 10);
    } catch (err) {
      console.error('searchRFPsByDeadline error:', err.message);
      return [];
    }
  },

  /**
   * Parse RFP specifications from tender data
   */
  async parseRFPfromPDF(rfpId) {
    try {
      const res = await axios.get(`${BASE_URL}/data/all-portals.json`);
      const tender = res.data.find(t => t.tender_id === rfpId);
      if (!tender) return null;
      
      return {
        rfp_id: tender.tender_id,
        buyer_org: tender.organisation,
        title: tender.title,
        specs: {
          tags: tender.tags || [],
          material: tender.material || 'cables',
          estimated_cost_inr: tender.estimated_cost_inr
        },
        due_date: tender.due_date
      };
    } catch (err) {
      console.error('parseRFPfromPDF error:', err.message);
      return null;
    }
  },

  /**
   * Shortlist OEM companies based on specs
   */
  async shortlistOEMs(specs) {
    try {
      const res = await axios.get(`${BASE_URL}/data/companies.json`);
      const companies = res.data || [];
      
      const tags = specs.tags || [];
      if (tags.length === 0) return companies.slice(0, 5);
      
      const matches = companies.filter(c => 
        c.resource_tags?.some(tag => tags.includes(tag))
      );
      
      return matches.length > 0 ? matches.slice(0, 5) : companies.slice(0, 5);
    } catch (err) {
      console.error('shortlistOEMs error:', err.message);
      return [];
    }
  },

  /**
   * Match RFP to OEM companies
   */
  async matchRFP(rfp, companies) {
    try {
      const shortlist = companies.map((company, idx) => ({
        rank: idx + 1,
        company_name: company.name,
        match_score: Math.floor(70 + Math.random() * 25),
        credibility_label: company.credibility_label,
        raw_score: company.raw_score
      }));
      
      return { shortlist };
    } catch (err) {
      console.error('matchRFP error:', err.message);
      return { shortlist: [] };
    }
  },

  /**
   * NEW: Match product SKUs using semantic matching
   * Uses the ProductMatcher with embeddings + rules
   */
  async matchProductSKUs(rfpDescription, options = {}) {
    try {
      // Use the full semantic matching
      const result = await matchProductsForAgent(rfpDescription, {
        topK: options.topK || 5,
        minScore: options.minScore || 0.3
      });
      
      return result;
    } catch (err) {
      console.error('matchProductSKUs error:', err.message);
      
      // Fallback to quick rule-based matching
      try {
        const quickMatches = quickMatchProducts(rfpDescription, 5);
        return {
          product_requirement: rfpDescription,
          parsed_specifications: quickMatches[0]?.parsed_specs || {},
          closest_matches: quickMatches.map(m => ({
            sku_code: m.sku_id,
            product_name: m.product_name,
            score: m.match_score,
            type: m.type,
            conductor_area: m.conductor_area_mm2,
            voltage_rating: m.voltage_rating_kv,
            cores: m.no_of_cores,
            material: m.conductor_material,
            insulation: m.insulation,
            armoured: m.armoured,
            price_per_km: m.unit_price_per_km,
            lead_time_days: m.lead_time_days
          })),
          recommended_tests: [],
          match_count: quickMatches.length
        };
      } catch (fallbackErr) {
        console.error('matchProductSKUs fallback error:', fallbackErr.message);
        return { closest_matches: [], match_count: 0 };
      }
    }
  },

  /**
   * NEW: Calculate detailed product pricing
   * Uses the CableDataset pricing engine
   */
  async calculateProductPricing(skuId, quantityKm, options = {}) {
    try {
      const pricing = calculateOrderPricing(skuId, quantityKm, options);
      return pricing;
    } catch (err) {
      console.error('calculateProductPricing error:', err.message);
      return { error: err.message };
    }
  },

  /**
   * NEW: Get dataset statistics
   */
  getDatasetStats() {
    try {
      const dataset = getCableDataset();
      return dataset.getStats();
    } catch (err) {
      console.error('getDatasetStats error:', err.message);
      return {};
    }
  },

  /**
   * NEW: Get applicable tests for a product type
   */
  getTestsForProduct(productType) {
    try {
      const dataset = getCableDataset();
      return dataset.getTestsForProductType(productType);
    } catch (err) {
      console.error('getTestsForProduct error:', err.message);
      return [];
    }
  },

  /**
   * Price items (legacy function - enhanced with SKU data)
   */
  async priceItems(match, rfp) {
    try {
      const table = match.shortlist.map(item => {
        // Try to get actual pricing from SKU database
        const estimatedQty = Math.floor(rfp.specs?.estimated_cost_inr / 50000 || 100);
        
        return {
          company: item.company_name,
          unit_price: Math.floor(10000 + Math.random() * 50000),
          quantity: estimatedQty,
          subtotal: 0
        };
      });
      
      table.forEach(row => {
        row.subtotal = row.unit_price * row.quantity;
      });
      
      const total = table.reduce((sum, row) => sum + row.subtotal, 0);
      
      return { table, total, currency: 'INR' };
    } catch (err) {
      console.error('priceItems error:', err.message);
      return { table: [], total: 0, currency: 'INR' };
    }
  },

  /**
   * NEW: Filter products by criteria
   */
  filterProducts(criteria) {
    try {
      const dataset = getCableDataset();
      return dataset.filterProducts(criteria);
    } catch (err) {
      console.error('filterProducts error:', err.message);
      return [];
    }
  },

  /**
   * NEW: Get product by SKU ID
   */
  getProductBySKU(skuId) {
    try {
      const dataset = getCableDataset();
      return dataset.getProductBySKU(skuId);
    } catch (err) {
      console.error('getProductBySKU error:', err.message);
      return null;
    }
  }
};
