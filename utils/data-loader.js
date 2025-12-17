/**
 * Centralized Data Loader
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * This module consolidates all data loading functions that were
 * previously duplicated across multiple files:
 * - routes/chat.js
 * - routes/analyze.js
 * - services/credibility.js
 * - services/document-extractor.js
 * 
 * Use this module instead of creating local loadCompanies() functions!
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PATHS } from '../configs/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache for loaded data to avoid repeated file reads
const dataCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generic cached data loader
 */
function loadCachedData(filePath, cacheKey) {
  const cached = dataCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    dataCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.error(`Error loading ${cacheKey}:`, error.message);
    return null;
  }
}

/**
 * Load company directory from companies.json
 * @returns {Array} Array of company objects with credibility data
 */
export function loadCompanies() {
  const companiesPath = path.join(__dirname, '..', 'public', 'data', 'companies.json');
  return loadCachedData(companiesPath, 'companies') || [];
}

/**
 * Load all tenders from all-portals.json
 * @returns {Array} Array of all tender objects
 */
export function loadAllTenders() {
  const tendersPath = path.join(__dirname, '..', 'public', 'data', 'all-portals.json');
  return loadCachedData(tendersPath, 'all-tenders') || [];
}

/**
 * Load tenders for specific portal
 * @param {string} portal - Portal ID: 'gov', 'industrial', or 'utilities'
 * @returns {Array} Array of tender objects for that portal
 */
export function loadPortalTenders(portal) {
  const portalPath = path.join(__dirname, '..', 'public', 'data', 'portals', `${portal}.json`);
  return loadCachedData(portalPath, `portal-${portal}`) || [];
}

/**
 * Load OEM products database
 * @returns {Object} OEM products organized by category
 */
export function loadOEMProducts() {
  const oemPath = path.join(__dirname, '..', 'data', 'oem-products.json');
  return loadCachedData(oemPath, 'oem-products') || {};
}

/**
 * Load test pricing database
 * @returns {Object} Test pricing organized by category
 */
export function loadTestPricing() {
  const pricingPath = path.join(__dirname, '..', 'data', 'test-pricing.json');
  return loadCachedData(pricingPath, 'test-pricing') || {};
}

/**
 * Find company by name (fuzzy match)
 * @param {string} companyQuery - Company name or partial name
 * @returns {Object|null} Matched company object or null
 */
export function findCompany(companyQuery) {
  if (!companyQuery) return null;
  
  const companies = loadCompanies();
  const query = companyQuery.toLowerCase().trim();
  
  // Exact match first
  let match = companies.find(c => c.name.toLowerCase() === query);
  if (match) return match;
  
  // Partial match
  match = companies.find(c => c.name.toLowerCase().includes(query));
  if (match) return match;
  
  // Reverse partial match (query contains company name prefix)
  match = companies.find(c => {
    const prefix = c.name.toLowerCase().split('(')[0].trim();
    return query.includes(prefix);
  });
  
  return match || null;
}

/**
 * Find tender by ID
 * @param {string} tenderId - Tender ID (e.g., 'GOV-001', 'IND-005')
 * @returns {Object|null} Tender object or null
 */
export function findTender(tenderId) {
  if (!tenderId) return null;
  const tenders = loadAllTenders();
  return tenders.find(t => t.tender_id === tenderId) || null;
}

/**
 * Find all tenders from a specific organization
 * @param {string} orgName - Organization name
 * @returns {Array} Array of matching tenders
 */
export function findTendersByOrganization(orgName) {
  if (!orgName) return [];
  
  const tenders = loadAllTenders();
  const query = orgName.toLowerCase();
  
  return tenders.filter(t => {
    const tenderOrg = (t.organisation || '').toLowerCase();
    return tenderOrg.includes(query) || query.includes(tenderOrg.split('(')[0].trim());
  });
}

/**
 * Get tenders due within specified days
 * @param {number} days - Number of days to look ahead
 * @returns {Array} Array of tenders due within window
 */
export function getTendersWithinDeadline(days = 90) {
  const tenders = loadAllTenders();
  const now = new Date();
  const targetDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  
  return tenders.filter(t => {
    if (!t.due_date) return false;
    const dueDate = new Date(t.due_date);
    return dueDate > now && dueDate <= targetDate;
  });
}

// Helper: get singular/plural variants of a word
function getWordVariants(word) {
  const variants = [word];
  if (word.endsWith('s') && word.length > 3) {
    variants.push(word.slice(0, -1));
  }
  if (!word.endsWith('s') && word.length > 2) {
    variants.push(word + 's');
  }
  return variants;
}

// Helper: check if any variant of keyword matches text
function keywordMatches(keyword, text) {
  const variants = getWordVariants(keyword.toLowerCase());
  const textLower = text.toLowerCase();
  return variants.some(v => textLower.includes(v));
}

/**
 * Filter tenders by criteria
 * @param {Object} filters - Filter criteria
 * @returns {Array} Filtered tender array
 */
export function filterTenders(filters = {}) {
  let tenders = loadAllTenders();
  
  // Add relevance score for sorting
  tenders = tenders.map(t => ({ ...t, _relevanceScore: 0 }));
  
  // KEYWORD SEARCH - Primary filter (flexible OR matching)
  if (filters.keyword) {
    const keywords = filters.keyword.toLowerCase().split(/\s+/).filter(k => k.length > 1);
    tenders = tenders.filter(t => {
      const searchText = `${t.title || ''} ${t.material || ''} ${t.organisation || ''} ${t.product_category || ''}`.toLowerCase();
      const matchCount = keywords.filter(kw => keywordMatches(kw, searchText)).length;
      if (matchCount > 0) {
        t._relevanceScore += matchCount * 10;
        return true;
      }
      return false;
    });
  }
  
  // CITY FILTER - Soft by default
  if (filters.city) {
    const cityLower = filters.city.toLowerCase();
    if (filters.cityStrict) {
      tenders = tenders.filter(t => 
        t.city?.toLowerCase().includes(cityLower)
      );
    } else {
      tenders.forEach(t => {
        if (t.city?.toLowerCase().includes(cityLower)) {
          t._relevanceScore += 20;
        }
      });
    }
  }
  
  // CATEGORY FILTER - Only if explicitly set
  if (filters.category) {
    const hasExactMatches = tenders.some(t => t.product_category === filters.category);
    if (hasExactMatches) {
      tenders = tenders.filter(t => t.product_category === filters.category);
    }
  }
  
  // WIRE TYPE - Boost matches rather than strict filter
  if (filters.wireType) {
    const type = filters.wireType.toLowerCase();
    tenders.forEach(t => {
      if (t.material?.toLowerCase().includes(type)) {
        t._relevanceScore += 15;
      }
    });
  }
  
  if (filters.minCost) {
    tenders = tenders.filter(t => t.estimated_cost_inr >= filters.minCost);
  }
  
  if (filters.maxCost) {
    tenders = tenders.filter(t => t.estimated_cost_inr <= filters.maxCost);
  }
  
  if (filters.deadlineBefore) {
    const deadline = new Date(filters.deadlineBefore);
    tenders = tenders.filter(t => {
      const dueDate = new Date(t.due_date);
      return dueDate <= deadline;
    });
  }
  
  if (filters.portal) {
    const prefix = filters.portal.toUpperCase().slice(0, 3);
    tenders = tenders.filter(t => t.tender_id?.startsWith(prefix));
  }
  
  // Sort by relevance then due date
  tenders.sort((a, b) => {
    if (b._relevanceScore !== a._relevanceScore) {
      return b._relevanceScore - a._relevanceScore;
    }
    return new Date(a.due_date) - new Date(b.due_date);
  });
  
  return tenders;
}

/**
 * Get portal metadata for a tender
 * @param {Object} tender - Tender object
 * @returns {Object} Portal name and ID
 */
export function getPortalInfo(tender) {
  const id = tender.tender_id || '';
  
  if (id.startsWith('GOV')) {
    return { portal_id: 'gov', portal_name: 'Government Portal' };
  } else if (id.startsWith('IND')) {
    return { portal_id: 'industrial', portal_name: 'Industrial Portal' };
  } else if (id.startsWith('UTL') || id.startsWith('UTI')) {
    return { portal_id: 'utilities', portal_name: 'Utilities Portal' };
  }
  
  return { portal_id: 'unknown', portal_name: 'Unknown Portal' };
}

/**
 * Clear data cache (useful for testing or after data updates)
 */
export function clearCache() {
  dataCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  const stats = {};
  for (const [key, value] of dataCache) {
    stats[key] = {
      age: Math.round((Date.now() - value.timestamp) / 1000),
      itemCount: Array.isArray(value.data) ? value.data.length : Object.keys(value.data).length
    };
  }
  return stats;
}

// Re-export cable dataset functions for convenience
export { 
  getCableDataset,
  loadCableProducts,
  loadCableTests,
  loadPricingRules,
  filterCableProducts,
  getProductBySKU,
  calculateOrderPricing
} from '../services/cable-dataset-loader.js';

export {
  getProductMatcher,
  matchProducts,
  matchProductsForAgent,
  quickMatchProducts
} from '../services/product-matcher.js';

// Default export for convenience
export default {
  loadCompanies,
  loadAllTenders,
  loadPortalTenders,
  loadOEMProducts,
  loadTestPricing,
  findCompany,
  findTender,
  findTendersByOrganization,
  getTendersWithinDeadline,
  filterTenders,
  getPortalInfo,
  clearCache,
  getCacheStats
};

