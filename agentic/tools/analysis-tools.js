/**
 * Analysis Tools for Agentic System
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * LangChain tool definitions for PDF extraction, SKU matching, and spec analysis.
 * Uses local embeddings for semantic product matching.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { semanticProductSearch, embed, cosineSimilarity, loadEmbeddingsCache } from '../../services/local-embeddings.js';

// Import adaptive learning components
let adaptiveRAG = null;
let schemaLearner = null;
let documentLearner = null;

// Lazy load adaptive components to avoid circular dependencies
async function getAdaptiveComponents() {
  if (!adaptiveRAG) {
    try {
      const ragModule = await import('../../services/adaptive-rag.js');
      const schemaModule = await import('../../services/schema-learner.js');
      const docModule = await import('../../services/document-learner.js');
      
      adaptiveRAG = ragModule;
      schemaLearner = schemaModule;
      documentLearner = docModule;
    } catch (e) {
      console.warn('Adaptive learning not available:', e.message);
    }
  }
  return { adaptiveRAG, schemaLearner, documentLearner };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load OEM product catalog
function loadOEMCatalog() {
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
      const product = { source_file: csvFile };
      headers.forEach((h, idx) => {
        product[h] = values[idx]?.trim() || '';
      });
      products.push(product);
    }
  }
  
  return products;
}

/**
 * Tool: Extract PDF Data
 * Simulates PDF extraction (in real impl, would use pdf-parse or Adobe API)
 */
export const extractPDFDataTool = tool(
  async ({ tender_id, pdf_url }) => {
    const { documentLearner, adaptiveRAG } = await getAdaptiveComponents();
    
    // Check if we have actual PDF text to process
    let pdfText = null;
    let useAdaptiveLearning = false;
    
    // Try to load PDF text if file exists
    const pdfDir = path.join(__dirname, '../../public/pdfs');
    const possiblePaths = [
      path.join(pdfDir, `${tender_id}.txt`),
      path.join(pdfDir, `${tender_id}_extracted.txt`)
    ];
    
    for (const pdfPath of possiblePaths) {
      if (fs.existsSync(pdfPath)) {
        pdfText = fs.readFileSync(pdfPath, 'utf-8');
        useAdaptiveLearning = true;
        break;
      }
    }
    
    // If we have PDF text and document learner, use adaptive extraction
    if (pdfText && documentLearner?.extractFromDocument) {
      try {
        const extracted = await documentLearner.extractFromDocument(pdfText, tender_id);
        
        return JSON.stringify({
          rfp_id: tender_id,
          extraction_method: "ADAPTIVE_DOCUMENT_LEARNING",
          document_type: extracted.documentType,
          sections_found: extracted.sections.length,
          confidence: extracted.confidence,
          extracted_fields: {
            buyer_name: extracted.extracted.organizations?.[0] || "Unknown Organization",
            buyer_requirements: extracted.extracted.quantities?.map((q, i) => ({
              item_no: String(i + 1),
              description: `Product requirement ${i + 1}`,
              quantity: q.value,
              unit: q.unit
            })) || [],
            tests_required: extracted.extracted.specifications?.test || [],
            submission: {
              deadline: extracted.extracted.dates?.[0] || null
            },
            amounts: extracted.extracted.amounts,
            reference_ids: extracted.extracted.reference_ids
          }
        });
      } catch (e) {
        console.warn('Adaptive extraction failed:', e.message);
      }
    }
    
    // Fallback: Simulated extraction based on patterns
    const isGov = tender_id.startsWith('GOV');
    const isInd = tender_id.startsWith('IND');
    const isUtl = tender_id.startsWith('UTL');
    
    const extractedData = {
      rfp_id: tender_id,
      extraction_method: useAdaptiveLearning ? "PARTIAL_ADAPTIVE" : "PATTERN_BASED_SIMULATION",
      extracted_fields: {
        buyer_name: isGov ? "Government PSU" : isInd ? "Industrial Corp" : "Utility Board",
        buyer_type: isGov ? "Government" : isInd ? "Private" : "Semi-Government",
        project_name: `Cable Supply Project ${tender_id}`,
        
        buyer_requirements: [
          {
            item_no: "1",
            description: "HT Power Cable 11kV 3C x 240 sqmm Copper XLPE Armoured",
            cable_type: "HT Cable",
            voltage_kv: "11",
            no_of_cores: "3",
            cross_section_sqmm: "240",
            conductor_material: "Copper",
            insulation: "XLPE",
            armoured: true,
            quantity_km: 5
          }
        ],
        
        tests_required: [
          { name: "Conductor Resistance Test", type: "Routine", mandatory: true },
          { name: "High Voltage Test", type: "Routine", mandatory: true },
          { name: "Partial Discharge Test", type: "Type", mandatory: false }
        ],
        
        submission: {
          mode: isGov ? "PDF_FORM_FILL" : isInd ? "EMAIL_SUBMISSION" : "VENDOR_PORTAL",
          deadline: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          contact_email: `procurement@${tender_id.toLowerCase()}.org`
        }
      },
      
      confidence_score: useAdaptiveLearning ? 0.75 : 0.60,
      pages_processed: 12,
      adaptive_learning_available: !!documentLearner
    };
    
    return JSON.stringify(extractedData);
  },
  {
    name: "extract_pdf_data",
    description: "Extract structured data from an RFP PDF document. Returns buyer requirements, test requirements, and submission details.",
    schema: z.object({
      tender_id: z.string().describe("The tender ID"),
      pdf_url: z.string().describe("URL or path to the PDF file")
    })
  }
);

/**
 * Tool: Semantic Product Search
 * Uses local embeddings to find matching products
 */
export const semanticProductSearchTool = tool(
  async ({ query, top_k }) => {
    const { adaptiveRAG, schemaLearner } = await getAdaptiveComponents();
    
    try {
      // Try adaptive RAG first for intelligent semantic search
      if (adaptiveRAG?.semanticSearch) {
        const ragResults = await adaptiveRAG.semanticSearch(query, {
          collections: ['PRODUCTS'],
          topK: top_k || 10
        });
        
        if (ragResults.length > 0) {
          return JSON.stringify({
            query,
            results_count: ragResults.length,
            search_method: "ADAPTIVE_RAG",
            products: ragResults.map(r => {
              const p = typeof r.document === 'string' ? JSON.parse(r.document) : r.metadata;
              return {
                sku_id: p.sku_id || p.SKU_ID || r.id,
                product_name: p.Product_Name || p.product_name,
                type: p.Type || p.type,
                voltage_kv: p.Voltage_Rating_kV || p.voltage_rating_kv,
                cores: p.No_of_Cores || p.no_of_cores,
                area_sqmm: p.Conductor_Area_mm2 || p.conductor_area_mm2,
                material: p.Conductor_Material || p.conductor_material,
                insulation: p.Insulation || p.insulation,
                armoured: p.Armoured || p.armoured,
                price_per_km: p.Unit_Price_per_km || p.unit_price_per_km,
                similarity_score: Math.round((1 - r.score) * 100)
              };
            })
          });
        }
      }
      
      // Fallback to local embeddings search
      const results = await semanticProductSearch(query, top_k || 10);
      
      return JSON.stringify({
        query,
        results_count: results.length,
        search_method: "LOCAL_EMBEDDINGS",
        products: results.map(p => ({
          sku_id: p.sku_id || p.SKU_ID,
          product_name: p.Product_Name || p.product_name,
          type: p.Type || p.type,
          voltage_kv: p.Voltage_Rating_kV || p.voltage_rating_kv,
          cores: p.No_of_Cores || p.no_of_cores,
          area_sqmm: p.Conductor_Area_mm2 || p.conductor_area_mm2,
          material: p.Conductor_Material || p.conductor_material,
          insulation: p.Insulation || p.insulation,
          armoured: p.Armoured || p.armoured,
          price_per_km: p.Unit_Price_per_km || p.unit_price_per_km,
          similarity_score: p.similarity_score
        }))
      });
    } catch (error) {
      // Final fallback to rule-based search
      const products = loadOEMCatalog();
      const queryLower = query.toLowerCase();
      
      const matches = products.filter(p => {
        const searchText = `${p.Product_Name} ${p.Type} ${p.Voltage_Rating_kV}kV ${p.Conductor_Material}`.toLowerCase();
        return searchText.includes(queryLower) || queryLower.split(' ').some(w => searchText.includes(w));
      }).slice(0, top_k || 10);
      
      return JSON.stringify({
        query,
        results_count: matches.length,
        search_method: "RULE_BASED_FALLBACK",
        products: matches.map(p => ({
          sku_id: p.SKU_ID,
          product_name: p.Product_Name,
          type: p.Type,
          voltage_kv: p.Voltage_Rating_kV,
          cores: p.No_of_Cores,
          area_sqmm: p.Conductor_Area_mm2,
          material: p.Conductor_Material,
          insulation: p.Insulation,
          armoured: p.Armoured,
          price_per_km: p.Unit_Price_per_km
        }))
      });
    }
  },
  {
    name: "semantic_product_search",
    description: "Search the product catalog using semantic similarity. Uses AI embeddings to find products matching a natural language description.",
    schema: z.object({
      query: z.string().describe("Natural language description of the product (e.g., 'HT cable 11kV copper armoured 240sqmm')"),
      top_k: z.number().optional().describe("Number of results to return. Default 10.")
    })
  }
);

/**
 * Tool: Match Specifications
 * Compares RFP requirements against a specific OEM product
 */
export const matchSpecificationsTool = tool(
  async ({ rfp_specs, oem_sku_id }) => {
    const products = loadOEMCatalog();
    const oemProduct = products.find(p => p.SKU_ID === oem_sku_id);
    
    if (!oemProduct) {
      return JSON.stringify({
        error: `SKU ${oem_sku_id} not found in catalog`
      });
    }
    
    // Define spec comparisons
    const comparisons = [
      {
        name: "Voltage Rating",
        rfp_value: rfp_specs.voltage_kv,
        oem_value: oemProduct.Voltage_Rating_kV,
        match: () => {
          if (!rfp_specs.voltage_kv) return null;
          const rfpV = parseFloat(rfp_specs.voltage_kv);
          const oemV = parseFloat(oemProduct.Voltage_Rating_kV);
          return Math.abs(rfpV - oemV) / rfpV <= 0.1;
        }
      },
      {
        name: "Number of Cores",
        rfp_value: rfp_specs.no_of_cores,
        oem_value: oemProduct.No_of_Cores,
        match: () => rfp_specs.no_of_cores == oemProduct.No_of_Cores
      },
      {
        name: "Cross-Section (sqmm)",
        rfp_value: rfp_specs.cross_section_sqmm,
        oem_value: oemProduct.Conductor_Area_mm2,
        match: () => {
          if (!rfp_specs.cross_section_sqmm) return null;
          const rfpA = parseFloat(rfp_specs.cross_section_sqmm);
          const oemA = parseFloat(oemProduct.Conductor_Area_mm2);
          return Math.abs(rfpA - oemA) / rfpA <= 0.15;
        }
      },
      {
        name: "Conductor Material",
        rfp_value: rfp_specs.conductor_material,
        oem_value: oemProduct.Conductor_Material,
        match: () => {
          if (!rfp_specs.conductor_material) return null;
          return rfp_specs.conductor_material.toLowerCase() === oemProduct.Conductor_Material?.toLowerCase();
        }
      },
      {
        name: "Insulation",
        rfp_value: rfp_specs.insulation,
        oem_value: oemProduct.Insulation,
        match: () => {
          if (!rfp_specs.insulation) return null;
          return rfp_specs.insulation.toLowerCase() === oemProduct.Insulation?.toLowerCase();
        }
      },
      {
        name: "Armoured",
        rfp_value: rfp_specs.armoured,
        oem_value: oemProduct.Armoured,
        match: () => {
          if (rfp_specs.armoured === undefined) return null;
          const oemArmoured = oemProduct.Armoured?.toLowerCase() === 'yes';
          return rfp_specs.armoured === oemArmoured;
        }
      }
    ];
    
    // Calculate match results
    let matched = 0;
    let total = 0;
    const details = [];
    
    for (const comp of comparisons) {
      const result = comp.match();
      if (result === null) continue; // Skip if RFP doesn't specify
      
      total++;
      if (result) matched++;
      
      details.push({
        spec: comp.name,
        rfp_value: comp.rfp_value,
        oem_value: comp.oem_value,
        matched: result
      });
    }
    
    const matchPercentage = total > 0 ? Math.round((matched / total) * 100) : 0;
    
    return JSON.stringify({
      oem_sku_id,
      oem_product_name: oemProduct.Product_Name,
      spec_match_percentage: matchPercentage,
      matched_specs: matched,
      total_specs: total,
      unit_price_per_km: parseFloat(oemProduct.Unit_Price_per_km) || 0,
      details,
      recommendation: matchPercentage >= 80 ? "EXCELLENT_MATCH" : 
                      matchPercentage >= 60 ? "GOOD_MATCH" : 
                      matchPercentage >= 40 ? "PARTIAL_MATCH" : "POOR_MATCH"
    });
  },
  {
    name: "match_specifications",
    description: "Compare RFP product specifications against a specific OEM product SKU. Returns spec match percentage and detailed comparison.",
    schema: z.object({
      rfp_specs: z.object({
        voltage_kv: z.string().optional(),
        no_of_cores: z.string().optional(),
        cross_section_sqmm: z.string().optional(),
        conductor_material: z.string().optional(),
        insulation: z.string().optional(),
        armoured: z.boolean().optional()
      }).describe("RFP product specifications"),
      oem_sku_id: z.string().describe("OEM product SKU ID to compare against")
    })
  }
);

/**
 * Tool: Get Product Catalog Schema
 * Returns the schema of available product attributes (for dynamic understanding)
 */
export const getProductSchemaTool = tool(
  async () => {
    const { schemaLearner } = await getAdaptiveComponents();
    
    // Try to use learned schemas first
    if (schemaLearner?.getAllSchemas) {
      const learnedSchemas = schemaLearner.getAllSchemas();
      
      if (Object.keys(learnedSchemas).length > 0) {
        const adaptiveSchema = {
          source: "ADAPTIVE_SCHEMA_LEARNING",
          csv_files: Object.keys(learnedSchemas),
          schemas: {},
          column_types: {}
        };
        
        for (const [fileName, schema] of Object.entries(learnedSchemas)) {
          adaptiveSchema.schemas[fileName] = {
            columns: schema.columns.map(c => c.name),
            row_count: schema.rowCount,
            column_details: schema.columns.map(c => ({
              name: c.name,
              detected_type: c.detectedType,
              sample_values: c.sampleValues?.slice(0, 5)
            }))
          };
          
          // Build column type mapping
          for (const col of schema.columns) {
            if (!adaptiveSchema.column_types[col.detectedType]) {
              adaptiveSchema.column_types[col.detectedType] = [];
            }
            adaptiveSchema.column_types[col.detectedType].push({
              file: fileName,
              column: col.name
            });
          }
        }
        
        return JSON.stringify(adaptiveSchema);
      }
    }
    
    // Fallback to manual parsing
    const productsDir = path.join(__dirname, '../../data/products');
    const schema = {
      source: "MANUAL_PARSING",
      csv_files: [],
      columns: {},
      unique_values: {}
    };
    
    if (!fs.existsSync(productsDir)) {
      return JSON.stringify({ error: "Products directory not found" });
    }
    
    const csvFiles = fs.readdirSync(productsDir).filter(f => f.endsWith('.csv'));
    schema.csv_files = csvFiles;
    
    for (const csvFile of csvFiles) {
      const csvPath = path.join(productsDir, csvFile);
      const content = fs.readFileSync(csvPath, 'utf-8');
      const lines = content.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim());
      
      schema.columns[csvFile] = headers;
      
      const sampleSize = Math.min(50, lines.length - 1);
      const values = {};
      
      for (let i = 1; i <= sampleSize; i++) {
        const row = lines[i].split(',');
        headers.forEach((h, idx) => {
          if (!values[h]) values[h] = new Set();
          if (row[idx]?.trim()) values[h].add(row[idx].trim());
        });
      }
      
      schema.unique_values[csvFile] = {};
      for (const [col, vals] of Object.entries(values)) {
        schema.unique_values[csvFile][col] = Array.from(vals).slice(0, 10);
      }
    }
    
    return JSON.stringify(schema);
  },
  {
    name: "get_product_schema",
    description: "Get the schema of the product catalog - what CSV files exist, what columns they have, and sample values. Use this to understand what product attributes are available.",
    schema: z.object({})
  }
);

/**
 * Tool: Find Top Matches for RFP Product
 * Combines semantic search with spec matching to find best products
 */
export const findTopMatchesTool = tool(
  async ({ product_description, rfp_specs, top_k }) => {
    const k = top_k || 3;
    
    // Step 1: Semantic search for candidates
    let candidates;
    try {
      candidates = await semanticProductSearch(product_description, k * 3);
    } catch {
      // Fallback
      const products = loadOEMCatalog();
      candidates = products.slice(0, k * 3).map(p => ({
        sku_id: p.SKU_ID,
        ...p
      }));
    }
    
    // Step 2: Calculate spec match for each candidate
    const results = [];
    
    for (const candidate of candidates) {
      const skuId = candidate.sku_id || candidate.SKU_ID;
      const products = loadOEMCatalog();
      const product = products.find(p => p.SKU_ID === skuId);
      
      if (!product) continue;
      
      // Calculate spec match
      let matched = 0;
      let total = 0;
      
      if (rfp_specs.voltage_kv && product.Voltage_Rating_kV) {
        total++;
        if (Math.abs(parseFloat(rfp_specs.voltage_kv) - parseFloat(product.Voltage_Rating_kV)) <= 1) matched++;
      }
      if (rfp_specs.no_of_cores && product.No_of_Cores) {
        total++;
        if (rfp_specs.no_of_cores == product.No_of_Cores) matched++;
      }
      if (rfp_specs.cross_section_sqmm && product.Conductor_Area_mm2) {
        total++;
        const diff = Math.abs(parseFloat(rfp_specs.cross_section_sqmm) - parseFloat(product.Conductor_Area_mm2));
        if (diff / parseFloat(rfp_specs.cross_section_sqmm) <= 0.15) matched++;
      }
      if (rfp_specs.conductor_material && product.Conductor_Material) {
        total++;
        if (rfp_specs.conductor_material.toLowerCase() === product.Conductor_Material.toLowerCase()) matched++;
      }
      if (rfp_specs.insulation && product.Insulation) {
        total++;
        if (rfp_specs.insulation.toLowerCase() === product.Insulation.toLowerCase()) matched++;
      }
      
      const specMatch = total > 0 ? Math.round((matched / total) * 100) : 50;
      const semanticScore = candidate.similarity_score || 50;
      const combinedScore = Math.round(specMatch * 0.6 + semanticScore * 0.4);
      
      results.push({
        rank: 0,
        sku_id: skuId,
        product_name: product.Product_Name,
        spec_match_percentage: specMatch,
        semantic_score: semanticScore,
        combined_score: combinedScore,
        unit_price_per_km: parseFloat(product.Unit_Price_per_km) || 0,
        specs: {
          voltage_kv: product.Voltage_Rating_kV,
          cores: product.No_of_Cores,
          area_sqmm: product.Conductor_Area_mm2,
          material: product.Conductor_Material,
          insulation: product.Insulation,
          armoured: product.Armoured
        }
      });
    }
    
    // Sort by combined score and assign ranks
    results.sort((a, b) => b.combined_score - a.combined_score);
    results.forEach((r, i) => r.rank = i + 1);
    
    return JSON.stringify({
      product_description,
      rfp_specs,
      top_matches: results.slice(0, k),
      recommended_sku: results[0]?.sku_id || null,
      recommended_match_percentage: results[0]?.spec_match_percentage || 0
    });
  },
  {
    name: "find_top_matches",
    description: "Find the top matching OEM products for an RFP product requirement. Combines semantic search with specification matching.",
    schema: z.object({
      product_description: z.string().describe("Natural language description of the RFP product requirement"),
      rfp_specs: z.object({
        voltage_kv: z.string().optional(),
        no_of_cores: z.string().optional(),
        cross_section_sqmm: z.string().optional(),
        conductor_material: z.string().optional(),
        insulation: z.string().optional(),
        armoured: z.boolean().optional()
      }).describe("Structured RFP specifications"),
      top_k: z.number().optional().describe("Number of top matches to return. Default 3.")
    })
  }
);

export const analysisTools = [
  extractPDFDataTool,
  semanticProductSearchTool,
  matchSpecificationsTool,
  getProductSchemaTool,
  findTopMatchesTool
];

export default analysisTools;

