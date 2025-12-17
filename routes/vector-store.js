/**
 * Vector Store API Routes
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Provides REST API endpoints for:
 * - Semantic product search
 * - Semantic tender search
 * - Vector store statistics
 * - Re-indexing
 */

import express from 'express';
import { 
  searchProducts, 
  searchTenders, 
  getCollectionStats, 
  indexProducts, 
  indexPortalTenders,
  initializeVectorStore 
} from '../services/chroma-vector-store.js';

export const vectorStoreRouter = express.Router();

/**
 * POST /api/vector/search/products
 * Semantic search for products
 */
vectorStoreRouter.post('/search/products', async (req, res) => {
  try {
    const { query, topK = 10, filters } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const results = await searchProducts(query, topK, filters);
    
    res.json({
      success: true,
      query,
      count: results.length,
      results: results.map(r => ({
        sku_id: r.metadata.sku_id,
        product_name: r.metadata.product_name,
        type: r.metadata.type,
        voltage_kv: r.metadata.voltage_kv,
        material: r.metadata.material,
        price_per_km: r.metadata.price_per_km,
        similarity: Math.round(r.similarity * 100),
        document: r.document
      }))
    });
  } catch (error) {
    console.error('Product search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/vector/search/tenders
 * Semantic search for tenders
 */
vectorStoreRouter.post('/search/tenders', async (req, res) => {
  try {
    const { query, topK = 10, filters } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const results = await searchTenders(query, topK, filters);
    
    res.json({
      success: true,
      query,
      count: results.length,
      results: results.map(r => ({
        tender_id: r.metadata.tender_id,
        title: r.metadata.title,
        organisation: r.metadata.organisation,
        city: r.metadata.city,
        portal: r.metadata.portal,
        due_date: r.metadata.due_date,
        estimated_cost: r.metadata.estimated_cost,
        similarity: Math.round(r.similarity * 100),
        document: r.document
      }))
    });
  } catch (error) {
    console.error('Tender search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/vector/stats
 * Get vector store statistics
 */
vectorStoreRouter.get('/stats', async (req, res) => {
  try {
    const stats = await getCollectionStats();
    res.json({
      success: true,
      collections: stats
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/vector/reindex/products
 * Re-index all products
 */
vectorStoreRouter.post('/reindex/products', async (req, res) => {
  try {
    const count = await indexProducts();
    res.json({
      success: true,
      message: `Re-indexed ${count} products`
    });
  } catch (error) {
    console.error('Reindex error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/vector/reindex/tenders
 * Re-index all tenders
 */
vectorStoreRouter.post('/reindex/tenders', async (req, res) => {
  try {
    const count = await indexPortalTenders();
    res.json({
      success: true,
      message: `Re-indexed ${count} tenders`
    });
  } catch (error) {
    console.error('Reindex error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/vector/initialize
 * Initialize the entire vector store
 */
vectorStoreRouter.post('/initialize', async (req, res) => {
  try {
    const stats = await initializeVectorStore();
    res.json({
      success: true,
      message: 'Vector store initialized',
      stats
    });
  } catch (error) {
    console.error('Initialize error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default vectorStoreRouter;



