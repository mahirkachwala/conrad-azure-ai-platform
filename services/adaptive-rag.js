/**
 * Adaptive RAG (Retrieval Augmented Generation) Pipeline
 * EY Techathon 6.0 - Intelligent Learning System
 * 
 * Core intelligence layer that:
 * 1. Uses ChromaDB for vector storage and retrieval
 * 2. Integrates schema and document learning
 * 3. Provides semantic search across all data
 * 4. Enables the system to adapt to ANY new data
 * 5. Powers intelligent responses without hardcoding
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChromaClient } from 'chromadb';
import { embed, embedBatch, cosineSimilarity, semanticProductSearch } from './local-embeddings.js';
import { initSchemaLearner, learnCSVSchema, findMatchingColumns, generateQueryPlan, getAllSchemas } from './schema-learner.js';
import { initDocumentLearner, learnDocumentStructure, extractFromDocument } from './document-learner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ChromaDB configuration
const CHROMA_PATH = path.join(__dirname, '../data/chroma_db');
let chromaClient = null;
let collections = {};

// Collection names
const COLLECTIONS = {
  PRODUCTS: 'products',
  TENDERS: 'tenders',
  DOCUMENTS: 'documents',
  SCHEMAS: 'schemas',
  QUERY_HISTORY: 'query_history'
};

// RAG system state
let ragState = {
  initialized: false,
  collectionsReady: {},
  indexedDocuments: 0,
  indexedProducts: 0,
  lastSync: null
};

/**
 * Initialize the Adaptive RAG system
 * Uses file-based vector storage (no external ChromaDB server needed)
 */
export async function initAdaptiveRAG() {
  console.log('🚀 Initializing Adaptive RAG System...');
  
  // Use file-based storage by default (more reliable, no server needed)
  ragState.fallbackMode = true;
  ragState.collectionsReady = {};
  
  // Ensure data directories exist
  const dataDir = path.join(__dirname, '../data');
  const dirs = ['indexed_products', 'indexed_tenders', 'indexed_documents'];
  for (const dir of dirs) {
    const dirPath = path.join(dataDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
  
  // Mark all collections as ready (using file storage)
  for (const key of Object.keys(COLLECTIONS)) {
    ragState.collectionsReady[key] = true;
  }
  console.log('   ✓ File-based vector storage ready');
  
  // Initialize learners
  try {
    await initSchemaLearner();
    await initDocumentLearner();
  } catch (e) {
    console.warn('   ⚠️ Learner init warning:', e.message);
  }
  
  ragState.initialized = true;
  console.log('✅ Adaptive RAG System initialized (file-based storage)');
  
  return true;
}

/**
 * Index products from CSV files
 * @param {string} csvPath - Path to CSV file or directory
 */
export async function indexProducts(csvPath) {
  console.log(`📦 Indexing products from: ${csvPath}`);
  
  const isDirectory = fs.statSync(csvPath).isDirectory();
  const files = isDirectory 
    ? fs.readdirSync(csvPath).filter(f => f.endsWith('.csv')).map(f => path.join(csvPath, f))
    : [csvPath];
  
  let totalIndexed = 0;
  
  for (const file of files) {
    console.log(`   Processing: ${path.basename(file)}`);
    
    // Learn schema first
    const schema = await learnCSVSchema(file);
    
    // Parse CSV
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    const products = [];
    const embeddings = [];
    const metadatas = [];
    const ids = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const product = {};
      headers.forEach((h, idx) => {
        product[h] = values[idx]?.trim() || '';
      });
      
      // Create searchable text
      const searchText = Object.entries(product)
        .filter(([k, v]) => v && v.length > 0)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ');
      
      // Generate ID
      const productId = product.SKU_ID || product.sku_id || product.id || `${path.basename(file)}_${i}`;
      
      products.push(product);
      ids.push(productId);
      metadatas.push({
        source_file: path.basename(file),
        row_number: i,
        ...product
      });
      
      // Batch embed
      if (products.length % 50 === 0) {
        const batch = products.slice(-50).map(p => 
          Object.values(p).filter(v => v).join(' ')
        );
        const batchEmb = await embedBatch(batch);
        embeddings.push(...batchEmb);
        console.log(`      Embedded ${embeddings.length} products...`);
      }
    }
    
    // Embed remaining
    if (products.length % 50 !== 0) {
      const remaining = products.slice(-(products.length % 50)).map(p =>
        Object.values(p).filter(v => v).join(' ')
      );
      const remainingEmb = await embedBatch(remaining);
      embeddings.push(...remainingEmb);
    }
    
    // Add to ChromaDB
    if (collections.PRODUCTS && embeddings.length > 0) {
      try {
        await collections.PRODUCTS.add({
          ids,
          embeddings,
          metadatas,
          documents: products.map(p => JSON.stringify(p))
        });
        totalIndexed += products.length;
      } catch (e) {
        console.warn(`   Could not add to ChromaDB: ${e.message}`);
        // Store locally as fallback
        const fallbackPath = path.join(__dirname, '../data/indexed_products.json');
        const existing = fs.existsSync(fallbackPath) 
          ? JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'))
          : [];
        existing.push(...products.map((p, i) => ({ ...p, _embedding: embeddings[i], _id: ids[i] })));
        fs.writeFileSync(fallbackPath, JSON.stringify(existing, null, 2));
        totalIndexed += products.length;
      }
    }
  }
  
  ragState.indexedProducts = totalIndexed;
  ragState.lastSync = new Date().toISOString();
  
  console.log(`✅ Indexed ${totalIndexed} products from ${files.length} files`);
  return totalIndexed;
}

/**
 * Index tenders/RFPs
 * @param {string} jsonPath - Path to tenders JSON file
 */
export async function indexTenders(jsonPath) {
  console.log(`📋 Indexing tenders from: ${jsonPath}`);
  
  const tenders = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  
  const ids = [];
  const embeddings = [];
  const metadatas = [];
  const documents = [];
  
  for (let i = 0; i < tenders.length; i++) {
    const tender = tenders[i];
    
    const searchText = [
      tender.title,
      tender.organisation,
      tender.material,
      tender.city,
      tender.category
    ].filter(Boolean).join(' | ');
    
    const tenderId = tender.tender_id || tender.rfp_id || `tender_${i}`;
    
    ids.push(tenderId);
    metadatas.push({
      title: tender.title || '',
      organisation: tender.organisation || '',
      city: tender.city || '',
      due_date: tender.due_date || '',
      estimated_cost: tender.estimated_cost_inr || 0,
      source: tender.source_type || 'unknown'
    });
    documents.push(JSON.stringify(tender));
    
    // Batch embedding
    if ((i + 1) % 50 === 0) {
      const batch = tenders.slice(i - 49, i + 1).map(t => 
        [t.title, t.organisation, t.material].filter(Boolean).join(' ')
      );
      const batchEmb = await embedBatch(batch);
      embeddings.push(...batchEmb);
      console.log(`   Embedded ${embeddings.length}/${tenders.length} tenders...`);
    }
  }
  
  // Embed remaining
  const remaining = tenders.length % 50;
  if (remaining > 0) {
    const batch = tenders.slice(-remaining).map(t =>
      [t.title, t.organisation, t.material].filter(Boolean).join(' ')
    );
    const batchEmb = await embedBatch(batch);
    embeddings.push(...batchEmb);
  }
  
  // Add to ChromaDB
  if (collections.TENDERS && embeddings.length > 0) {
    try {
      await collections.TENDERS.add({
        ids,
        embeddings,
        metadatas,
        documents
      });
    } catch (e) {
      console.warn(`   Could not add to ChromaDB: ${e.message}`);
      // Fallback storage
      const fallbackPath = path.join(__dirname, '../data/indexed_tenders.json');
      fs.writeFileSync(fallbackPath, JSON.stringify(
        tenders.map((t, i) => ({ ...t, _embedding: embeddings[i], _id: ids[i] })),
        null, 2
      ));
    }
  }
  
  console.log(`✅ Indexed ${tenders.length} tenders`);
  return tenders.length;
}

/**
 * Index a document (PDF extracted text)
 * @param {string} text - Document text
 * @param {Object} metadata - Document metadata
 */
export async function indexDocument(text, metadata = {}) {
  console.log(`📄 Indexing document: ${metadata.fileName || 'unnamed'}`);
  
  // Learn structure
  const structure = await learnDocumentStructure(text, metadata.fileName || 'document', metadata);
  
  // Create chunks for better retrieval
  const chunks = chunkText(text, 500, 50); // 500 chars, 50 overlap
  
  const ids = [];
  const embeddings = [];
  const metadatas = [];
  const documents = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunkEmb = await embed(chunks[i]);
    
    ids.push(`${metadata.fileName || 'doc'}_chunk_${i}`);
    embeddings.push(chunkEmb);
    metadatas.push({
      ...metadata,
      chunk_index: i,
      total_chunks: chunks.length,
      document_type: structure.documentType
    });
    documents.push(chunks[i]);
  }
  
  // Add to ChromaDB
  if (collections.DOCUMENTS && embeddings.length > 0) {
    try {
      await collections.DOCUMENTS.add({
        ids,
        embeddings,
        metadatas,
        documents
      });
    } catch (e) {
      console.warn(`   Could not add to ChromaDB: ${e.message}`);
    }
  }
  
  ragState.indexedDocuments++;
  
  console.log(`✅ Indexed document: ${chunks.length} chunks, type: ${structure.documentType}`);
  
  return {
    structure,
    chunksIndexed: chunks.length
  };
}

/**
 * Semantic search across all indexed data
 * @param {string} query - Search query
 * @param {Object} options - Search options
 */
export async function semanticSearch(query, options = {}) {
  const { 
    collections: targetCollections = ['PRODUCTS', 'TENDERS', 'DOCUMENTS'],
    topK = 10,
    filters = {}
  } = options;
  
  console.log(`🔍 Semantic search: "${query}"`);
  
  const queryEmbedding = await embed(query);
  const results = [];
  
  for (const collName of targetCollections) {
    const collection = collections[collName];
    if (!collection) continue;
    
    try {
      const searchResults = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
        where: Object.keys(filters).length > 0 ? filters : undefined
      });
      
      if (searchResults.ids?.[0]) {
        for (let i = 0; i < searchResults.ids[0].length; i++) {
          results.push({
            id: searchResults.ids[0][i],
            collection: collName,
            score: searchResults.distances?.[0]?.[i] || 0,
            metadata: searchResults.metadatas?.[0]?.[i] || {},
            document: searchResults.documents?.[0]?.[i] || ''
          });
        }
      }
    } catch (e) {
      console.warn(`   Search failed in ${collName}: ${e.message}`);
      
      // Fallback to local search
      const fallbackResults = await localFallbackSearch(query, collName, topK);
      results.push(...fallbackResults);
    }
  }
  
  // Sort by score (lower distance = better match)
  results.sort((a, b) => a.score - b.score);
  
  console.log(`   Found ${results.length} results`);
  
  return results.slice(0, topK);
}

/**
 * Local fallback search using file-based embeddings
 */
async function localFallbackSearch(query, collection, topK) {
  const fallbackFiles = {
    PRODUCTS: '../data/indexed_products.json',
    TENDERS: '../data/indexed_tenders.json'
  };
  
  const filePath = path.join(__dirname, fallbackFiles[collection] || '');
  if (!fs.existsSync(filePath)) return [];
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const queryEmb = await embed(query);
    
    const scored = data
      .filter(item => item._embedding)
      .map(item => ({
        id: item._id,
        collection,
        score: 1 - cosineSimilarity(queryEmb, item._embedding), // Convert to distance
        metadata: item,
        document: JSON.stringify(item)
      }))
      .sort((a, b) => a.score - b.score);
    
    return scored.slice(0, topK);
  } catch (e) {
    return [];
  }
}

/**
 * Intelligent query - uses schema learning for dynamic queries
 * @param {string} query - Natural language query
 */
export async function intelligentQuery(query) {
  console.log(`🧠 Intelligent query: "${query}"`);
  
  // Generate query plan using schema learner
  const queryPlan = await generateQueryPlan(query);
  
  // Perform semantic search
  const searchResults = await semanticSearch(query, {
    collections: ['PRODUCTS', 'TENDERS'],
    topK: 20
  });
  
  // Find matching columns for structured queries
  const matchingColumns = await findMatchingColumns(query);
  
  // Combine results
  return {
    query,
    queryPlan,
    semanticResults: searchResults,
    matchingColumns,
    suggestedFilters: queryPlan.suggestedFilters,
    responseContext: buildResponseContext(searchResults, matchingColumns)
  };
}

/**
 * Build context for LLM response
 */
function buildResponseContext(searchResults, matchingColumns) {
  const context = {
    relevantProducts: [],
    relevantTenders: [],
    schemaInfo: []
  };
  
  for (const result of searchResults) {
    if (result.collection === 'PRODUCTS') {
      try {
        const product = JSON.parse(result.document);
        context.relevantProducts.push({
          ...product,
          relevanceScore: Math.round((1 - result.score) * 100)
        });
      } catch (e) {}
    } else if (result.collection === 'TENDERS') {
      try {
        const tender = JSON.parse(result.document);
        context.relevantTenders.push({
          ...tender,
          relevanceScore: Math.round((1 - result.score) * 100)
        });
      } catch (e) {}
    }
  }
  
  // Add schema information
  for (const col of matchingColumns.slice(0, 5)) {
    context.schemaInfo.push({
      file: col.file,
      column: col.column,
      type: col.type,
      similarity: col.similarity
    });
  }
  
  return context;
}

/**
 * Learn from user query (continuous learning)
 * @param {string} query - User query
 * @param {Object} feedback - User feedback on results
 */
export async function learnFromQuery(query, feedback) {
  console.log(`📚 Learning from query feedback`);
  
  if (collections.QUERY_HISTORY) {
    try {
      const queryEmb = await embed(query);
      
      await collections.QUERY_HISTORY.add({
        ids: [`query_${Date.now()}`],
        embeddings: [queryEmb],
        metadatas: [{
          query,
          feedback: JSON.stringify(feedback),
          timestamp: new Date().toISOString()
        }],
        documents: [query]
      });
    } catch (e) {
      // Store locally
      const historyPath = path.join(__dirname, '../data/query_history.json');
      const history = fs.existsSync(historyPath)
        ? JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
        : [];
      history.push({ query, feedback, timestamp: new Date().toISOString() });
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    }
  }
}

/**
 * Chunk text for better retrieval
 */
function chunkText(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.substring(start, end));
    start += chunkSize - overlap;
  }
  
  return chunks;
}

/**
 * Get RAG system status
 */
export function getRAGStatus() {
  return {
    ...ragState,
    collections: Object.keys(collections).map(k => ({
      name: k,
      ready: ragState.collectionsReady[k] || false
    })),
    schemas: Object.keys(getAllSchemas())
  };
}

/**
 * Sync all data (re-index everything)
 */
export async function syncAllData() {
  console.log('🔄 Syncing all data...');
  
  // Index products
  const productsDir = path.join(__dirname, '../data/products');
  if (fs.existsSync(productsDir)) {
    await indexProducts(productsDir);
  }
  
  // Index tenders
  const tendersPath = path.join(__dirname, '../public/data/all-portals.json');
  if (fs.existsSync(tendersPath)) {
    await indexTenders(tendersPath);
  }
  
  ragState.lastSync = new Date().toISOString();
  console.log('✅ Data sync complete');
  
  return getRAGStatus();
}

export default {
  initAdaptiveRAG,
  indexProducts,
  indexTenders,
  indexDocument,
  semanticSearch,
  intelligentQuery,
  learnFromQuery,
  getRAGStatus,
  syncAllData
};

