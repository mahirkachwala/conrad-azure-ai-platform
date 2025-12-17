/**
 * Initialize Vector Store Script
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Run this script to:
 * 1. Initialize ChromaDB
 * 2. Initialize local embedding model
 * 3. Index all products into vector database
 * 4. Index all portal tenders into vector database
 * 
 * Usage:
 *   node scripts/init-vector-store.js
 */

import 'dotenv/config';
import { initializeVectorStore, getCollectionStats, searchProducts, searchTenders } from '../services/chroma-vector-store.js';

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  ConRad - Vector Store Initialization                            ║');
  console.log('║  ChromaDB + HuggingFace Transformers                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  const startTime = Date.now();
  
  try {
    // Initialize everything
    await initializeVectorStore();
    
    // Run test queries
    console.log('');
    console.log('🧪 Running test queries...');
    console.log('');
    
    // Test product search
    console.log('📦 Product Search: "HT cable 11kV copper armoured"');
    const productResults = await searchProducts('HT cable 11kV copper armoured', 3);
    for (const result of productResults) {
      console.log(`   → ${result.metadata.sku_id}: ${result.metadata.product_name} (${Math.round(result.similarity * 100)}% match)`);
    }
    
    console.log('');
    
    // Test tender search
    console.log('📋 Tender Search: "power cable supply Mumbai"');
    const tenderResults = await searchTenders('power cable supply Mumbai', 3);
    for (const result of tenderResults) {
      console.log(`   → ${result.metadata.tender_id}: ${result.metadata.title?.substring(0, 40)}... (${Math.round(result.similarity * 100)}% match)`);
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ Vector Store Initialized Successfully!                       ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`   Time: ${duration}s`);
    console.log('   The vector store is now ready for semantic search!');
    console.log('');
    console.log('   You can now use:');
    console.log('   - searchProducts(query) for product matching');
    console.log('   - searchTenders(query) for RFP discovery');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Error initializing vector store:', error.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('1. Make sure you have run: npm install');
    console.error('2. Check that product CSVs exist in data/products/');
    console.error('3. Check that portal JSONs exist in public/data/portals/');
    console.error('4. Ensure you have internet connection (for first model download)');
    console.error('');
    process.exit(1);
  }
}

main();



