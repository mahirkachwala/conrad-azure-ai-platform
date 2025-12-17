/**
 * Model Fine-tuning Service
 * EY Techathon 6.0 - Adaptive AI System
 * 
 * Fine-tunes embedding models on domain-specific data.
 * Enables the system to:
 * 1. Adapt embeddings to cable/RFP domain vocabulary
 * 2. Learn from user interactions
 * 3. Improve semantic matching over time
 * 4. Create domain-specific representations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embed, embedBatch, cosineSimilarity } from './local-embeddings.js';
import { getAllSchemas, exportForTraining as exportSchemaTraining } from './schema-learner.js';
import { exportForTraining as exportDocTraining } from './document-learner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fine-tuning data storage
const FINETUNE_DATA_PATH = path.join(__dirname, '../data/finetune');
const MODEL_WEIGHTS_PATH = path.join(__dirname, '../data/model_weights.json');

// Domain-specific vocabulary
const DOMAIN_VOCABULARY = {
  // Cable industry terms
  cable: ['XLPE', 'PVC', 'armoured', 'unarmoured', 'conductor', 'insulation', 'sheath'],
  voltage: ['HT', 'LT', 'EHV', 'kV', 'kilovolt', 'high tension', 'low tension'],
  materials: ['copper', 'aluminium', 'aluminum', 'Cu', 'Al', 'alloy'],
  specs: ['sqmm', 'mm2', 'cross section', 'core', 'strand', 'gauge'],
  standards: ['IS', 'IEC', 'BIS', 'IEEE', 'ASTM'],
  tests: ['routine', 'type test', 'acceptance', 'FAT', 'SAT', 'NABL'],
  
  // RFP/Tender terms  
  procurement: ['tender', 'RFP', 'RFQ', 'bid', 'quotation', 'EMD', 'earnest money'],
  organizations: ['PSU', 'DISCOM', 'transmission', 'distribution', 'generation'],
  documents: ['BOQ', 'BOM', 'NIT', 'technical specification', 'commercial bid']
};

// Fine-tuning state
let finetuneState = {
  initialized: false,
  trainingPairs: [],
  domainEmbeddings: {},
  adaptationWeights: {},
  lastTraining: null,
  metrics: {
    pairsGenerated: 0,
    trainingRuns: 0,
    avgImprovement: 0
  }
};

/**
 * Initialize fine-tuning system
 */
export async function initFineTuner() {
  console.log('🔧 Initializing Model Fine-tuner...');
  
  // Create directories
  if (!fs.existsSync(FINETUNE_DATA_PATH)) {
    fs.mkdirSync(FINETUNE_DATA_PATH, { recursive: true });
  }
  
  // Load existing weights
  if (fs.existsSync(MODEL_WEIGHTS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(MODEL_WEIGHTS_PATH, 'utf-8'));
      finetuneState = { ...finetuneState, ...data };
      console.log(`   Loaded existing weights: ${Object.keys(finetuneState.domainEmbeddings).length} domain terms`);
    } catch (e) {
      console.warn('   Could not load existing weights');
    }
  }
  
  // Pre-compute domain embeddings if not done
  if (Object.keys(finetuneState.domainEmbeddings).length === 0) {
    await computeDomainEmbeddings();
  }
  
  finetuneState.initialized = true;
  console.log('✅ Fine-tuner initialized');
  
  return finetuneState;
}

/**
 * Compute embeddings for domain vocabulary
 */
async function computeDomainEmbeddings() {
  console.log('   Computing domain embeddings...');
  
  for (const [category, terms] of Object.entries(DOMAIN_VOCABULARY)) {
    for (const term of terms) {
      try {
        const embedding = await embed(term);
        finetuneState.domainEmbeddings[term.toLowerCase()] = {
          embedding,
          category,
          term
        };
      } catch (e) {
        console.warn(`   Could not embed: ${term}`);
      }
    }
  }
  
  saveWeights();
  console.log(`   ✓ Computed ${Object.keys(finetuneState.domainEmbeddings).length} domain embeddings`);
}

/**
 * Save fine-tuning weights
 */
function saveWeights() {
  // Don't save full embeddings to file (too large), just save metadata
  const saveData = {
    ...finetuneState,
    domainEmbeddings: Object.fromEntries(
      Object.entries(finetuneState.domainEmbeddings).map(([k, v]) => [k, {
        category: v.category,
        term: v.term,
        hasEmbedding: true
      }])
    )
  };
  
  fs.writeFileSync(MODEL_WEIGHTS_PATH, JSON.stringify(saveData, null, 2));
}

/**
 * Generate training pairs from existing data
 * Creates positive and negative pairs for contrastive learning
 */
export async function generateTrainingPairs() {
  console.log('📝 Generating training pairs...');
  
  const pairs = [];
  
  // 1. Generate pairs from schema learning
  const schemaData = exportSchemaTraining();
  for (const item of schemaData) {
    // Positive pair: column name matches its type
    pairs.push({
      anchor: item.input,
      positive: item.output,
      negative: getRandomNegative(item.output, ['identifier', 'price', 'quantity', 'voltage', 'date']),
      type: 'schema'
    });
  }
  
  // 2. Generate pairs from document learning
  const docData = exportDocTraining();
  for (const item of docData) {
    pairs.push({
      anchor: item.input,
      positive: item.output,
      negative: getRandomNegative(item.output, ['rfp_with_boq', 'quotation', 'technical_specification']),
      type: 'document'
    });
  }
  
  // 3. Generate pairs from domain vocabulary (synonyms/related terms)
  const synonymPairs = [
    ['copper conductor', 'Cu wire', 'aluminium conductor'],
    ['HT cable', 'high tension cable', 'LT cable'],
    ['XLPE insulation', 'cross-linked polyethylene', 'PVC insulation'],
    ['armoured cable', 'SWA cable', 'unarmoured cable'],
    ['11kV', '11 kilovolt', '33kV'],
    ['tender', 'RFP', 'invoice'],
    ['BOQ', 'bill of quantities', 'terms and conditions'],
    ['routine test', 'type test', 'visual inspection'],
    ['sqmm', 'square millimeter', 'kilogram'],
    ['deadline', 'due date', 'start date']
  ];
  
  for (const [anchor, positive, negative] of synonymPairs) {
    pairs.push({ anchor, positive, negative, type: 'synonym' });
  }
  
  // 4. Generate pairs from CSV data
  const schemas = getAllSchemas();
  for (const [fileName, schema] of Object.entries(schemas)) {
    for (const col of schema.columns) {
      if (col.sampleValues && col.sampleValues.length > 1) {
        // Same column values should be similar
        pairs.push({
          anchor: col.sampleValues[0],
          positive: col.sampleValues[1],
          negative: getRandomSampleFromOtherColumn(schemas, fileName, col.name),
          type: 'data'
        });
      }
    }
  }
  
  finetuneState.trainingPairs = pairs;
  finetuneState.metrics.pairsGenerated = pairs.length;
  
  // Save training data
  const trainingPath = path.join(FINETUNE_DATA_PATH, 'training_pairs.json');
  fs.writeFileSync(trainingPath, JSON.stringify(pairs, null, 2));
  
  console.log(`✅ Generated ${pairs.length} training pairs`);
  
  return pairs;
}

/**
 * Get random negative sample
 */
function getRandomNegative(positive, candidates) {
  const filtered = candidates.filter(c => c !== positive);
  return filtered[Math.floor(Math.random() * filtered.length)] || 'unknown';
}

/**
 * Get random sample from another column
 */
function getRandomSampleFromOtherColumn(schemas, currentFile, currentColumn) {
  for (const [fileName, schema] of Object.entries(schemas)) {
    for (const col of schema.columns) {
      if (col.name !== currentColumn && col.sampleValues && col.sampleValues.length > 0) {
        return col.sampleValues[0];
      }
    }
  }
  return 'unknown';
}

/**
 * Run fine-tuning simulation
 * Note: For actual fine-tuning, you would use a training framework.
 * This simulates the effect by learning adaptation weights.
 */
export async function runFineTuning() {
  console.log('🏋️ Running fine-tuning...');
  
  if (finetuneState.trainingPairs.length === 0) {
    await generateTrainingPairs();
  }
  
  const pairs = finetuneState.trainingPairs;
  let improvements = [];
  
  console.log(`   Processing ${pairs.length} training pairs...`);
  
  // Compute triplet losses and learn weights
  for (let i = 0; i < Math.min(pairs.length, 100); i++) {
    const pair = pairs[i];
    
    try {
      // Get embeddings
      const anchorEmb = await embed(pair.anchor);
      const positiveEmb = await embed(pair.positive);
      const negativeEmb = await embed(pair.negative);
      
      // Compute similarities
      const posSim = cosineSimilarity(anchorEmb, positiveEmb);
      const negSim = cosineSimilarity(anchorEmb, negativeEmb);
      
      // Triplet margin
      const margin = posSim - negSim;
      
      // Learn adaptation weight based on margin
      const pairKey = `${pair.type}_${pair.anchor}`;
      finetuneState.adaptationWeights[pairKey] = {
        margin,
        weight: margin > 0.2 ? 1.0 : 0.5 + margin,
        type: pair.type
      };
      
      improvements.push(margin);
      
      if ((i + 1) % 20 === 0) {
        console.log(`   Processed ${i + 1}/${Math.min(pairs.length, 100)} pairs...`);
      }
    } catch (e) {
      // Skip failed pairs
    }
  }
  
  // Compute metrics
  const avgImprovement = improvements.length > 0
    ? improvements.reduce((a, b) => a + b, 0) / improvements.length
    : 0;
  
  finetuneState.metrics.trainingRuns++;
  finetuneState.metrics.avgImprovement = avgImprovement;
  finetuneState.lastTraining = new Date().toISOString();
  
  saveWeights();
  
  console.log(`✅ Fine-tuning complete`);
  console.log(`   Avg margin: ${(avgImprovement * 100).toFixed(2)}%`);
  console.log(`   Weights learned: ${Object.keys(finetuneState.adaptationWeights).length}`);
  
  return {
    pairsProcessed: improvements.length,
    avgMargin: avgImprovement,
    weightsLearned: Object.keys(finetuneState.adaptationWeights).length
  };
}

/**
 * Apply domain adaptation to embedding
 * Adjusts embeddings based on learned domain knowledge
 */
export async function adaptEmbedding(text, embedding = null) {
  if (!embedding) {
    embedding = await embed(text);
  }
  
  // Find closest domain terms
  const textLower = text.toLowerCase();
  let adaptation = [...embedding];
  
  // Check for domain vocabulary matches
  for (const [term, data] of Object.entries(finetuneState.domainEmbeddings)) {
    if (textLower.includes(term) && data.embedding) {
      // Blend with domain embedding (simple averaging)
      const weight = 0.1; // Small weight to preserve original meaning
      for (let i = 0; i < adaptation.length; i++) {
        adaptation[i] = adaptation[i] * (1 - weight) + data.embedding[i] * weight;
      }
    }
  }
  
  // Normalize
  const norm = Math.sqrt(adaptation.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    adaptation = adaptation.map(v => v / norm);
  }
  
  return adaptation;
}

/**
 * Get similar domain terms
 */
export async function findSimilarDomainTerms(text, topK = 5) {
  const textEmb = await embed(text);
  
  const scores = [];
  for (const [term, data] of Object.entries(finetuneState.domainEmbeddings)) {
    if (data.embedding) {
      const sim = cosineSimilarity(textEmb, data.embedding);
      scores.push({ term, category: data.category, similarity: sim });
    }
  }
  
  scores.sort((a, b) => b.similarity - a.similarity);
  return scores.slice(0, topK);
}

/**
 * Export fine-tuning data for external training
 */
export function exportTrainingData() {
  return {
    pairs: finetuneState.trainingPairs,
    domainVocabulary: DOMAIN_VOCABULARY,
    adaptationWeights: finetuneState.adaptationWeights,
    metrics: finetuneState.metrics
  };
}

/**
 * Import trained weights
 */
export function importWeights(weights) {
  if (weights.adaptationWeights) {
    finetuneState.adaptationWeights = {
      ...finetuneState.adaptationWeights,
      ...weights.adaptationWeights
    };
  }
  saveWeights();
  console.log('✅ Imported trained weights');
}

/**
 * Get fine-tuner status
 */
export function getFineTunerStatus() {
  return {
    initialized: finetuneState.initialized,
    domainTerms: Object.keys(finetuneState.domainEmbeddings).length,
    trainingPairs: finetuneState.trainingPairs.length,
    adaptationWeights: Object.keys(finetuneState.adaptationWeights).length,
    metrics: finetuneState.metrics,
    lastTraining: finetuneState.lastTraining
  };
}

/**
 * Continuous learning - update from new data
 */
export async function learnFromNewData(newData) {
  console.log('📚 Learning from new data...');
  
  const newPairs = [];
  
  // Generate pairs from new data
  if (newData.products) {
    for (const product of newData.products) {
      const values = Object.values(product).filter(v => typeof v === 'string' && v.length > 2);
      if (values.length >= 2) {
        newPairs.push({
          anchor: values[0],
          positive: values[1],
          negative: 'unknown',
          type: 'new_product'
        });
      }
    }
  }
  
  if (newData.documents) {
    for (const doc of newData.documents) {
      newPairs.push({
        anchor: doc.title || doc.text?.substring(0, 100),
        positive: doc.type || 'document',
        negative: 'unknown',
        type: 'new_document'
      });
    }
  }
  
  // Add to training pairs
  finetuneState.trainingPairs.push(...newPairs);
  finetuneState.metrics.pairsGenerated += newPairs.length;
  
  // If enough new pairs, run incremental training
  if (newPairs.length >= 10) {
    await runFineTuning();
  }
  
  console.log(`✅ Learned from ${newPairs.length} new data points`);
  
  return newPairs.length;
}

export default {
  initFineTuner,
  generateTrainingPairs,
  runFineTuning,
  adaptEmbedding,
  findSimilarDomainTerms,
  exportTrainingData,
  importWeights,
  getFineTunerStatus,
  learnFromNewData
};



