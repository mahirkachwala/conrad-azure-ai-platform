/**
 * Local Embeddings Service
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Uses HuggingFace Transformers.js to run embedding models locally.
 * No API calls needed - runs entirely on CPU/GPU locally.
 * 
 * Model: all-MiniLM-L6-v2 (384 dimensions, fast, good for semantic search)
 */

import { pipeline, env } from '@huggingface/transformers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure transformers.js
env.cacheDir = path.join(__dirname, '../.cache/models');
env.allowLocalModels = true;

// Singleton embedding pipeline
let embeddingPipeline = null;
let isInitializing = false;
let initPromise = null;

// Pre-computed embeddings cache
const EMBEDDINGS_CACHE_PATH = path.join(__dirname, '../data/embeddings_cache.json');
let embeddingsCache = null;

/**
 * Initialize the embedding pipeline (lazy loading)
 * Uses all-MiniLM-L6-v2 - a lightweight but effective model
 */
export async function initEmbeddings() {
  if (embeddingPipeline) return embeddingPipeline;
  
  if (isInitializing) {
    return initPromise;
  }
  
  isInitializing = true;
  console.log('🚀 Initializing local embedding model (all-MiniLM-L6-v2)...');
  console.log('   First run will download the model (~23MB)');
  
  initPromise = (async () => {
    try {
      embeddingPipeline = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { 
          quantized: true,  // Use quantized model for faster inference
        }
      );
      console.log('✅ Local embedding model loaded successfully');
      return embeddingPipeline;
    } catch (error) {
      console.error('❌ Failed to load embedding model:', error.message);
      isInitializing = false;
      throw error;
    }
  })();
  
  return initPromise;
}

/**
 * Generate embeddings for a single text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - 384-dimensional embedding vector
 */
export async function embed(text) {
  const pipe = await initEmbeddings();
  
  // Generate embedding
  const output = await pipe(text, { 
    pooling: 'mean', 
    normalize: true 
  });
  
  // Convert to array
  return Array.from(output.data);
}

/**
 * Generate embeddings for multiple texts (batch processing)
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
export async function embedBatch(texts) {
  const pipe = await initEmbeddings();
  
  const embeddings = [];
  
  // Process in batches of 32 for memory efficiency
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    for (const text of batch) {
      const output = await pipe(text, { 
        pooling: 'mean', 
        normalize: true 
      });
      embeddings.push(Array.from(output.data));
    }
    
    // Progress logging for large batches
    if (texts.length > 100 && i % 100 === 0) {
      console.log(`   Embedded ${i + batch.length}/${texts.length} texts...`);
    }
  }
  
  return embeddings;
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} - Similarity score (0-1)
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Find most similar items from a collection
 * @param {number[]} queryEmbedding - Query vector
 * @param {Array<{id: string, embedding: number[], data: any}>} items - Items with embeddings
 * @param {number} topK - Number of results to return
 * @returns {Array<{id: string, score: number, data: any}>}
 */
export function findSimilar(queryEmbedding, items, topK = 5) {
  const scores = items.map(item => ({
    id: item.id,
    score: cosineSimilarity(queryEmbedding, item.embedding),
    data: item.data
  }));
  
  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  
  return scores.slice(0, topK);
}

/**
 * Load embeddings cache from disk
 */
export function loadEmbeddingsCache() {
  if (embeddingsCache) return embeddingsCache;
  
  try {
    if (fs.existsSync(EMBEDDINGS_CACHE_PATH)) {
      const data = fs.readFileSync(EMBEDDINGS_CACHE_PATH, 'utf-8');
      embeddingsCache = JSON.parse(data);
      console.log(`📦 Loaded ${Object.keys(embeddingsCache.products || {}).length} product embeddings from cache`);
      return embeddingsCache;
    }
  } catch (error) {
    console.warn('⚠️ Could not load embeddings cache:', error.message);
  }
  
  embeddingsCache = { products: {}, rfps: {}, version: '1.0' };
  return embeddingsCache;
}

/**
 * Save embeddings cache to disk
 */
export function saveEmbeddingsCache() {
  try {
    fs.writeFileSync(EMBEDDINGS_CACHE_PATH, JSON.stringify(embeddingsCache, null, 2));
    console.log('💾 Saved embeddings cache to disk');
  } catch (error) {
    console.error('❌ Could not save embeddings cache:', error.message);
  }
}

/**
 * Pre-compute embeddings for all products in CSVs
 * Run this once to build the cache
 */
export async function precomputeProductEmbeddings() {
  console.log('🔄 Pre-computing product embeddings...');
  
  const productsDir = path.join(__dirname, '../data/products');
  const csvFiles = fs.readdirSync(productsDir).filter(f => f.endsWith('.csv'));
  
  loadEmbeddingsCache();
  
  let totalProducts = 0;
  
  for (const csvFile of csvFiles) {
    const csvPath = path.join(productsDir, csvFile);
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    console.log(`   Processing ${csvFile}...`);
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const product = {};
      headers.forEach((h, idx) => {
        product[h] = values[idx]?.trim() || '';
      });
      
      const skuId = product.SKU_ID || product.sku_id || `${csvFile}-${i}`;
      
      // Skip if already cached
      if (embeddingsCache.products[skuId]) continue;
      
      // Create searchable text from product attributes
      const searchText = [
        product.Product_Name || product.product_name,
        product.Type || product.type,
        product.Voltage_Rating_kV ? `${product.Voltage_Rating_kV}kV` : '',
        product.Conductor_Material || product.conductor_material,
        product.Insulation || product.insulation,
        product.Conductor_Area_mm2 ? `${product.Conductor_Area_mm2}sqmm` : '',
        product.No_of_Cores ? `${product.No_of_Cores} core` : '',
        product.Armoured === 'Yes' ? 'armoured' : ''
      ].filter(Boolean).join(' ');
      
      // Generate embedding
      const embedding = await embed(searchText);
      
      embeddingsCache.products[skuId] = {
        embedding,
        searchText,
        data: product
      };
      
      totalProducts++;
    }
  }
  
  // Save cache
  saveEmbeddingsCache();
  
  console.log(`✅ Pre-computed embeddings for ${totalProducts} new products`);
  console.log(`   Total cached: ${Object.keys(embeddingsCache.products).length} products`);
  
  return embeddingsCache;
}

/**
 * Semantic search for products
 * @param {string} query - Search query (e.g., "HT cable 11kV copper armoured")
 * @param {number} topK - Number of results
 * @returns {Promise<Array>} - Matching products with scores
 */
export async function semanticProductSearch(query, topK = 10) {
  // Ensure embeddings are loaded
  loadEmbeddingsCache();
  
  // If no cached embeddings, build them
  if (Object.keys(embeddingsCache.products).length === 0) {
    console.log('⚠️ No product embeddings found. Building cache...');
    await precomputeProductEmbeddings();
  }
  
  // Embed the query
  const queryEmbedding = await embed(query);
  
  // Convert cache to searchable format
  const items = Object.entries(embeddingsCache.products).map(([id, item]) => ({
    id,
    embedding: item.embedding,
    data: item.data
  }));
  
  // Find similar products
  const results = findSimilar(queryEmbedding, items, topK);
  
  return results.map(r => ({
    sku_id: r.id,
    similarity_score: Math.round(r.score * 100),
    ...r.data
  }));
}

/**
 * Check if embeddings model is ready
 */
export function isModelReady() {
  return embeddingPipeline !== null;
}

/**
 * Get model info
 */
export function getModelInfo() {
  return {
    model: 'all-MiniLM-L6-v2',
    dimensions: 384,
    provider: 'HuggingFace Transformers.js',
    quantized: true,
    loaded: isModelReady(),
    cachedProducts: embeddingsCache ? Object.keys(embeddingsCache.products).length : 0
  };
}

export default {
  initEmbeddings,
  embed,
  embedBatch,
  cosineSimilarity,
  findSimilar,
  semanticProductSearch,
  precomputeProductEmbeddings,
  loadEmbeddingsCache,
  saveEmbeddingsCache,
  isModelReady,
  getModelInfo
};



