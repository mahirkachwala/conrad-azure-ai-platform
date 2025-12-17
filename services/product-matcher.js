/**
 * Product Matcher Module
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * This module provides semantic matching between RFP product requirements
 * and SKU database using embeddings + rule-based filtering.
 * 
 * Supports:
 * - OpenAI text-embedding-3-large
 * - Google/Gemini embeddings
 * - Fallback to rule-based matching
 */

import { getCableDataset } from './cable-dataset-loader.js';
import { AI_CONFIG } from '../configs/settings.js';

// Embedding cache to avoid redundant API calls
const embeddingCache = new Map();
const CACHE_SIZE_LIMIT = 500;

/**
 * Product Matcher Class
 * Matches RFP requirements to SKU products using semantic similarity
 */
export class ProductMatcher {
  constructor(options = {}) {
    this.dataset = getCableDataset();
    this.useEmbeddings = options.useEmbeddings !== false;
    this.embeddingModel = options.embeddingModel || 'text-embedding-3-small';
    this.productEmbeddings = new Map();
    this.initialized = false;
  }
  
  /**
   * Initialize product embeddings (call once at startup for better performance)
   */
  async initialize() {
    if (this.initialized) return;
    
    // Pre-compute embeddings for all products if API is available
    if (this.useEmbeddings && AI_CONFIG.openai?.apiKey) {
      console.log('🔄 Pre-computing product embeddings...');
      const products = this.dataset.getProducts();
      
      for (const product of products) {
        try {
          const embedding = await this.getEmbedding(product.search_text || product.description);
          this.productEmbeddings.set(product.sku_id, embedding);
        } catch (err) {
          // Continue without embedding for this product
        }
      }
      console.log(`✅ Computed embeddings for ${this.productEmbeddings.size} products`);
    }
    
    this.initialized = true;
  }
  
  /**
   * Get embedding for text using OpenAI API
   */
  async getEmbedding(text) {
    if (!text) return null;
    
    // Check cache first
    const cacheKey = text.substring(0, 200); // Use truncated text as key
    if (embeddingCache.has(cacheKey)) {
      return embeddingCache.get(cacheKey);
    }
    
    // Check if OpenAI API is available
    if (!AI_CONFIG.openai?.apiKey) {
      return null;
    }
    
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AI_CONFIG.openai.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: text.substring(0, 8000) // Limit input length
        })
      });
      
      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status}`);
      }
      
      const data = await response.json();
      const embedding = data.data[0].embedding;
      
      // Cache the result (with size limit)
      if (embeddingCache.size >= CACHE_SIZE_LIMIT) {
        const firstKey = embeddingCache.keys().next().value;
        embeddingCache.delete(firstKey);
      }
      embeddingCache.set(cacheKey, embedding);
      
      return embedding;
    } catch (error) {
      console.error('Embedding error:', error.message);
      return null;
    }
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
  
  /**
   * Extract technical specs from RFP description text
   */
  parseRequirementText(text) {
    const specs = {};
    const lowerText = text.toLowerCase();
    
    // Extract number of cores (e.g., "3 core", "3C", "4 core")
    const coreMatch = lowerText.match(/(\d+)\s*(?:core|c\s|cores)/i);
    if (coreMatch) {
      specs.cores = parseInt(coreMatch[1], 10);
    }
    
    // Extract conductor area (e.g., "95 sq mm", "95sqmm", "95 mm2")
    const areaMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*mm|sqmm|mm2|mm²)/i);
    if (areaMatch) {
      specs.conductor_area = parseFloat(areaMatch[1]);
    }
    
    // Extract voltage (e.g., "11kV", "1.1kV", "11 kV", "1100V")
    const kvMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*kv/i);
    if (kvMatch) {
      specs.voltage_rating = parseFloat(kvMatch[1]);
    } else {
      const vMatch = lowerText.match(/(\d+)\s*v(?:olt)?/i);
      if (vMatch) {
        const volts = parseInt(vMatch[1], 10);
        if (volts >= 1000) {
          specs.voltage_rating = volts / 1000;
        }
      }
    }
    
    // Detect conductor material
    if (lowerText.includes('copper') || lowerText.includes('cu ')) {
      specs.conductor_material = 'copper';
    } else if (lowerText.includes('aluminium') || lowerText.includes('aluminum') || lowerText.includes('al ')) {
      specs.conductor_material = 'aluminium';
    }
    
    // Detect insulation type
    if (lowerText.includes('xlpe')) {
      specs.insulation = 'XLPE';
    } else if (lowerText.includes('pvc')) {
      specs.insulation = 'PVC';
    }
    
    // Detect armoured
    if (lowerText.includes('armoured') || lowerText.includes('armored') || lowerText.includes('swa')) {
      specs.armoured = true;
    } else if (lowerText.includes('unarmoured') || lowerText.includes('unarmored')) {
      specs.armoured = false;
    }
    
    // Detect cable type
    if (lowerText.includes('ht cable') || lowerText.includes('high tension') || lowerText.includes('high voltage')) {
      specs.type = 'ht cable';
    } else if (lowerText.includes('lt cable') || lowerText.includes('low tension') || lowerText.includes('low voltage')) {
      specs.type = 'lt cable';
    } else if (lowerText.includes('control cable')) {
      specs.type = 'control cable';
    } else if (lowerText.includes('instrumentation')) {
      specs.type = 'instrumentation cable';
    } else if (lowerText.includes('ehv') || lowerText.includes('extra high')) {
      specs.type = 'ehv cable';
    }
    
    // Detect standards
    if (lowerText.includes('is 7098')) {
      specs.standard = 'IS 7098';
    } else if (lowerText.includes('is 694')) {
      specs.standard = 'IS 694';
    } else if (lowerText.includes('is 1554')) {
      specs.standard = 'IS 1554';
    } else if (lowerText.includes('iec 60502')) {
      specs.standard = 'IEC 60502';
    }
    
    return specs;
  }
  
  /**
   * Calculate rule-based match score
   */
  calculateRuleScore(product, specs) {
    let score = 0;
    let maxScore = 0;
    
    // Core count (high importance)
    if (specs.cores !== undefined) {
      maxScore += 25;
      if (product.no_of_cores === specs.cores) {
        score += 25;
      } else if (Math.abs(product.no_of_cores - specs.cores) <= 1) {
        score += 10;
      }
    }
    
    // Conductor area (high importance)
    if (specs.conductor_area !== undefined) {
      maxScore += 25;
      if (product.conductor_area_mm2 === specs.conductor_area) {
        score += 25;
      } else if (Math.abs(product.conductor_area_mm2 - specs.conductor_area) / specs.conductor_area <= 0.1) {
        score += 15;
      }
    }
    
    // Voltage rating (high importance)
    if (specs.voltage_rating !== undefined) {
      maxScore += 20;
      if (product.voltage_rating_kv === specs.voltage_rating) {
        score += 20;
      } else if (product.voltage_rating_kv >= specs.voltage_rating) {
        score += 10;
      }
    }
    
    // Conductor material (medium importance)
    if (specs.conductor_material) {
      maxScore += 15;
      if (product.conductor_material === specs.conductor_material) {
        score += 15;
      }
    }
    
    // Armoured (medium importance)
    if (specs.armoured !== undefined) {
      maxScore += 10;
      if (product.armoured === specs.armoured) {
        score += 10;
      }
    }
    
    // Insulation type (medium importance)
    if (specs.insulation) {
      maxScore += 10;
      if (product.insulation === specs.insulation) {
        score += 10;
      }
    }
    
    // Cable type (medium importance)
    if (specs.type) {
      maxScore += 15;
      if (product.type === specs.type) {
        score += 15;
      } else if (product.type.includes(specs.type.split(' ')[0])) {
        score += 8;
      }
    }
    
    // Standard compliance (lower importance)
    if (specs.standard) {
      maxScore += 5;
      if (product.standard?.includes(specs.standard)) {
        score += 5;
      }
    }
    
    return maxScore > 0 ? (score / maxScore) : 0;
  }
  
  /**
   * Main matching function
   * @param {string} rfpDescription - RFP product requirement text
   * @param {Object} options - Matching options
   * @returns {Array} Top matching products with scores
   */
  async match(rfpDescription, options = {}) {
    const topK = options.topK || 5;
    const minScore = options.minScore || 0.3;
    
    // Parse specs from requirement text
    const parsedSpecs = this.parseRequirementText(rfpDescription);
    
    // Get all products
    const products = this.dataset.getProducts();
    
    // Calculate scores for each product
    const scoredProducts = [];
    
    // Try to get embedding for RFP description
    const rfpEmbedding = this.useEmbeddings ? await this.getEmbedding(rfpDescription) : null;
    
    for (const product of products) {
      // Rule-based score
      const ruleScore = this.calculateRuleScore(product, parsedSpecs);
      
      // Embedding similarity score
      let embeddingScore = 0;
      if (rfpEmbedding) {
        const productEmbedding = this.productEmbeddings.get(product.sku_id) || 
                                  await this.getEmbedding(product.search_text || product.description);
        if (productEmbedding) {
          embeddingScore = this.cosineSimilarity(rfpEmbedding, productEmbedding);
        }
      }
      
      // Combined score (weighted average)
      // If embeddings available: 40% rules + 60% embeddings
      // If no embeddings: 100% rules
      const combinedScore = rfpEmbedding 
        ? (ruleScore * 0.4 + embeddingScore * 0.6)
        : ruleScore;
      
      if (combinedScore >= minScore) {
        scoredProducts.push({
          ...product,
          match_score: Math.round(combinedScore * 100),
          rule_score: Math.round(ruleScore * 100),
          embedding_score: rfpEmbedding ? Math.round(embeddingScore * 100) : null,
          parsed_specs: parsedSpecs
        });
      }
    }
    
    // Sort by combined score and return top K
    scoredProducts.sort((a, b) => b.match_score - a.match_score);
    
    return scoredProducts.slice(0, topK);
  }
  
  /**
   * Match with structured output for agent communication
   */
  async matchForAgent(rfpRequirement, options = {}) {
    const matches = await this.match(rfpRequirement, options);
    
    // Get applicable tests for top match
    const topMatch = matches[0];
    let requiredTests = [];
    
    if (topMatch) {
      const tests = this.dataset.getTestsForProductType(topMatch.type);
      requiredTests = tests.slice(0, 5).map(t => ({
        test_id: t.test_id,
        name: t.test_name,
        cost: t.price_inr
      }));
    }
    
    return {
      product_requirement: rfpRequirement,
      parsed_specifications: matches[0]?.parsed_specs || {},
      closest_matches: matches.map(m => ({
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
      recommended_tests: requiredTests,
      match_count: matches.length
    };
  }
  
  /**
   * Quick match without embeddings (faster, rule-based only)
   */
  quickMatch(rfpDescription, topK = 5) {
    const parsedSpecs = this.parseRequirementText(rfpDescription);
    const products = this.dataset.getProducts();
    
    const scoredProducts = products.map(product => ({
      ...product,
      match_score: Math.round(this.calculateRuleScore(product, parsedSpecs) * 100),
      parsed_specs: parsedSpecs
    })).filter(p => p.match_score >= 30);
    
    scoredProducts.sort((a, b) => b.match_score - a.match_score);
    
    return scoredProducts.slice(0, topK);
  }
  
  /**
   * Get dataset statistics
   */
  getStats() {
    return {
      ...this.dataset.getStats(),
      cached_embeddings: this.productEmbeddings.size,
      embedding_cache_size: embeddingCache.size,
      embeddings_enabled: this.useEmbeddings && !!AI_CONFIG.openai?.apiKey
    };
  }
}

// Singleton instance
let matcherInstance = null;

/**
 * Get the product matcher instance (singleton)
 */
export function getProductMatcher() {
  if (!matcherInstance) {
    matcherInstance = new ProductMatcher();
  }
  return matcherInstance;
}

// Export convenience functions
export const matchProducts = async (desc, opts) => getProductMatcher().match(desc, opts);
export const matchProductsForAgent = async (desc, opts) => getProductMatcher().matchForAgent(desc, opts);
export const quickMatchProducts = (desc, topK) => getProductMatcher().quickMatch(desc, topK);

export default {
  ProductMatcher,
  getProductMatcher,
  matchProducts,
  matchProductsForAgent,
  quickMatchProducts
};











