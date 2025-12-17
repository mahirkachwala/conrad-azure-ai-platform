/**
 * ChromaDB Vector Store Service
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Provides persistent vector storage for:
 * - Product embeddings (semantic search)
 * - RFP document embeddings
 * - BOQ item embeddings
 * 
 * Uses ChromaDB for fast similarity search with metadata filtering.
 */

import { ChromaClient } from 'chromadb';
import { embed, embedBatch, initEmbeddings } from './local-embeddings.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ChromaDB client instance
let chromaClient = null;
let collections = {};

// Collection names
const COLLECTIONS = {
  PRODUCTS: 'products',
  RFPS: 'rfps',
  BOQ_ITEMS: 'boq_items',
  PORTALS: 'portal_tenders'
};

/**
 * Initialize ChromaDB client
 */
export async function initChromaDB() {
  if (chromaClient) return chromaClient;
  
  console.log('🗄️  Initializing ChromaDB...');
  
  try {
    // Initialize with persistent storage
    chromaClient = new ChromaClient({
      path: process.env.CHROMA_DB_PATH || './chroma_db'
    });
    
    // Test connection
    const heartbeat = await chromaClient.heartbeat();
    console.log('✅ ChromaDB connected:', heartbeat);
    
    return chromaClient;
  } catch (error) {
    // Fallback to ephemeral client if persistent fails
    console.warn('⚠️ Persistent ChromaDB failed, using ephemeral mode');
    chromaClient = new ChromaClient();
    return chromaClient;
  }
}

/**
 * Get or create a collection
 */
export async function getCollection(name) {
  if (collections[name]) return collections[name];
  
  const client = await initChromaDB();
  
  try {
    collections[name] = await client.getOrCreateCollection({
      name: name,
      metadata: { 
        "hnsw:space": "cosine",
        "description": `ConRad ${name} collection`
      }
    });
    
    console.log(`📦 Collection '${name}' ready`);
    return collections[name];
  } catch (error) {
    console.error(`❌ Failed to get collection '${name}':`, error.message);
    throw error;
  }
}

/**
 * Add documents to a collection with embeddings
 * @param {string} collectionName - Name of the collection
 * @param {Array} documents - Array of {id, text, metadata} objects
 */
export async function addDocuments(collectionName, documents) {
  const collection = await getCollection(collectionName);
  
  // Generate embeddings
  const texts = documents.map(d => d.text);
  const embeddings = await embedBatch(texts);
  
  // Prepare data for ChromaDB
  const ids = documents.map(d => d.id);
  const metadatas = documents.map(d => d.metadata || {});
  
  // Add to collection
  await collection.add({
    ids: ids,
    embeddings: embeddings,
    documents: texts,
    metadatas: metadatas
  });
  
  console.log(`📥 Added ${documents.length} documents to '${collectionName}'`);
  return ids;
}

/**
 * Query similar documents
 * @param {string} collectionName - Name of the collection
 * @param {string} query - Search query text
 * @param {number} topK - Number of results
 * @param {Object} whereFilter - Metadata filter
 */
export async function queryDocuments(collectionName, query, topK = 10, whereFilter = null) {
  const collection = await getCollection(collectionName);
  
  // Generate query embedding
  const queryEmbedding = await embed(query);
  
  // Build query options
  const queryOptions = {
    queryEmbeddings: [queryEmbedding],
    nResults: topK
  };
  
  if (whereFilter) {
    queryOptions.where = whereFilter;
  }
  
  // Execute query
  const results = await collection.query(queryOptions);
  
  // Format results
  const formatted = [];
  if (results.ids && results.ids[0]) {
    for (let i = 0; i < results.ids[0].length; i++) {
      formatted.push({
        id: results.ids[0][i],
        document: results.documents?.[0]?.[i] || '',
        metadata: results.metadatas?.[0]?.[i] || {},
        distance: results.distances?.[0]?.[i] || 0,
        similarity: 1 - (results.distances?.[0]?.[i] || 0) // Convert distance to similarity
      });
    }
  }
  
  return formatted;
}

/**
 * Index all products from CSV files into ChromaDB
 */
export async function indexProducts() {
  console.log('🔄 Indexing products into ChromaDB...');
  
  const productsDir = path.join(__dirname, '../data/products');
  if (!fs.existsSync(productsDir)) {
    console.warn('⚠️ Products directory not found');
    return 0;
  }
  
  const csvFiles = fs.readdirSync(productsDir).filter(f => f.endsWith('.csv'));
  const documents = [];
  
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
      
      const skuId = product.SKU_ID || `${csvFile}-${i}`;
      
      // Create searchable text
      const searchText = [
        product.Product_Name,
        product.Type,
        product.Voltage_Rating_kV ? `${product.Voltage_Rating_kV}kV` : '',
        product.Conductor_Material,
        product.Insulation,
        product.Conductor_Area_mm2 ? `${product.Conductor_Area_mm2}sqmm` : '',
        product.No_of_Cores ? `${product.No_of_Cores} core` : '',
        product.Armoured === 'Yes' ? 'armoured' : ''
      ].filter(Boolean).join(' ');
      
      documents.push({
        id: skuId,
        text: searchText,
        metadata: {
          sku_id: skuId,
          product_name: product.Product_Name || '',
          type: product.Type || '',
          voltage_kv: product.Voltage_Rating_kV || '',
          cores: product.No_of_Cores || '',
          area_sqmm: product.Conductor_Area_mm2 || '',
          material: product.Conductor_Material || '',
          insulation: product.Insulation || '',
          armoured: product.Armoured || '',
          price_per_km: product.Unit_Price_per_km || '',
          source_file: csvFile
        }
      });
    }
  }
  
  if (documents.length > 0) {
    // Clear existing and add new
    const collection = await getCollection(COLLECTIONS.PRODUCTS);
    
    // Add in batches
    const batchSize = 100;
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      await addDocuments(COLLECTIONS.PRODUCTS, batch);
    }
  }
  
  console.log(`✅ Indexed ${documents.length} products into ChromaDB`);
  return documents.length;
}

/**
 * Index portal tenders into ChromaDB
 */
export async function indexPortalTenders() {
  console.log('🔄 Indexing portal tenders into ChromaDB...');
  
  const portalsDir = path.join(__dirname, '../public/data/portals');
  if (!fs.existsSync(portalsDir)) {
    console.warn('⚠️ Portals directory not found');
    return 0;
  }
  
  const jsonFiles = fs.readdirSync(portalsDir).filter(f => f.endsWith('.json'));
  const documents = [];
  
  for (const jsonFile of jsonFiles) {
    const filePath = path.join(portalsDir, jsonFile);
    const portalName = jsonFile.replace('.json', '');
    
    try {
      const tenders = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      
      for (const tender of tenders) {
        const searchText = [
          tender.title,
          tender.organisation,
          tender.material,
          tender.city,
          tender.cable_requirements?.map(r => `${r.cable_type} ${r.voltage}`).join(' ')
        ].filter(Boolean).join(' ');
        
        documents.push({
          id: tender.tender_id,
          text: searchText,
          metadata: {
            tender_id: tender.tender_id,
            title: tender.title || '',
            organisation: tender.organisation || '',
            city: tender.city || '',
            portal: portalName,
            due_date: tender.due_date || '',
            estimated_cost: String(tender.estimated_cost_inr || ''),
            material: tender.material || ''
          }
        });
      }
    } catch (error) {
      console.error(`Error reading ${jsonFile}:`, error.message);
    }
  }
  
  if (documents.length > 0) {
    await addDocuments(COLLECTIONS.PORTALS, documents);
  }
  
  console.log(`✅ Indexed ${documents.length} tenders into ChromaDB`);
  return documents.length;
}

/**
 * Semantic search for products
 * @param {string} query - Natural language query
 * @param {number} topK - Number of results
 * @param {Object} filters - Metadata filters (e.g., {type: 'HT Cable'})
 */
export async function searchProducts(query, topK = 10, filters = null) {
  return queryDocuments(COLLECTIONS.PRODUCTS, query, topK, filters);
}

/**
 * Semantic search for tenders
 * @param {string} query - Natural language query
 * @param {number} topK - Number of results
 * @param {Object} filters - Metadata filters (e.g., {portal: 'gov', city: 'Mumbai'})
 */
export async function searchTenders(query, topK = 10, filters = null) {
  return queryDocuments(COLLECTIONS.PORTALS, query, topK, filters);
}

/**
 * Get collection statistics
 */
export async function getCollectionStats() {
  const stats = {};
  
  for (const [key, name] of Object.entries(COLLECTIONS)) {
    try {
      const collection = await getCollection(name);
      const count = await collection.count();
      stats[name] = { count };
    } catch (error) {
      stats[name] = { count: 0, error: error.message };
    }
  }
  
  return stats;
}

/**
 * Initialize all collections and index data
 */
export async function initializeVectorStore() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  Initializing ChromaDB Vector Store                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  
  // Initialize embedding model first
  await initEmbeddings();
  
  // Initialize ChromaDB
  await initChromaDB();
  
  // Check if products already indexed
  const productCollection = await getCollection(COLLECTIONS.PRODUCTS);
  const productCount = await productCollection.count();
  
  if (productCount === 0) {
    await indexProducts();
  } else {
    console.log(`📦 Products collection already has ${productCount} items`);
  }
  
  // Check if tenders already indexed
  const tenderCollection = await getCollection(COLLECTIONS.PORTALS);
  const tenderCount = await tenderCollection.count();
  
  if (tenderCount === 0) {
    await indexPortalTenders();
  } else {
    console.log(`📦 Tenders collection already has ${tenderCount} items`);
  }
  
  const stats = await getCollectionStats();
  console.log('');
  console.log('📊 Vector Store Statistics:');
  for (const [name, data] of Object.entries(stats)) {
    console.log(`   ${name}: ${data.count} documents`);
  }
  console.log('');
  
  return stats;
}

export default {
  initChromaDB,
  getCollection,
  addDocuments,
  queryDocuments,
  indexProducts,
  indexPortalTenders,
  searchProducts,
  searchTenders,
  getCollectionStats,
  initializeVectorStore,
  COLLECTIONS
};



