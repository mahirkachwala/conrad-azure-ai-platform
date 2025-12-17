/**
 * Pre-compute Product Embeddings Script
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Run this script ONCE to build the embeddings cache for semantic search.
 * This enables fast semantic product matching without API calls.
 * 
 * Usage:
 *   node scripts/precompute-embeddings.js
 */

import { precomputeProductEmbeddings, getModelInfo } from '../services/local-embeddings.js';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  ConRad - Pre-compute Product Embeddings                         ║');
  console.log('║  Using: HuggingFace Transformers.js (all-MiniLM-L6-v2)           ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  const startTime = Date.now();
  
  try {
    console.log('🚀 Starting embedding generation...');
    console.log('   (First run will download the model - ~23MB)');
    console.log('');
    
    await precomputeProductEmbeddings();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const info = getModelInfo();
    
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ Embeddings Generated Successfully!                           ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`   Model: ${info.model}`);
    console.log(`   Dimensions: ${info.dimensions}`);
    console.log(`   Products Cached: ${info.cachedProducts}`);
    console.log(`   Time: ${duration}s`);
    console.log('');
    console.log('   The embeddings are saved to: data/embeddings_cache.json');
    console.log('   Semantic search is now ready!');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Error generating embeddings:', error.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('1. Make sure you have run: npm install');
    console.error('2. Check that product CSVs exist in data/products/');
    console.error('3. Ensure you have internet connection (for first model download)');
    console.error('');
    process.exit(1);
  }
}

main();



