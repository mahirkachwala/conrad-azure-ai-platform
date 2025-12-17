/**
 * Continuous Learning Service
 * EY Techathon 6.0 - Adaptive AI System
 * 
 * Orchestrates continuous learning across all components:
 * 1. Watches for new data files (CSVs, PDFs)
 * 2. Automatically indexes and learns from new data
 * 3. Triggers model fine-tuning when needed
 * 4. Maintains learning history and metrics
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initAdaptiveRAG, indexProducts, indexTenders, indexDocument, getRAGStatus } from './adaptive-rag.js';
import { initSchemaLearner, learnCSVSchema, learnDirectory } from './schema-learner.js';
import { initDocumentLearner, learnDocumentStructure, extractFromDocument } from './document-learner.js';
import { initFineTuner, generateTrainingPairs, runFineTuning, learnFromNewData, getFineTunerStatus } from './model-finetuner.js';
import { embed } from './local-embeddings.js';
import { initAdaptiveEmailCalendar, getEmailCalendarStatus } from './adaptive-email-calendar.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Learning configuration
const LEARNING_CONFIG = {
  dataDirectories: [
    '../data/products',
    '../data/portals',
    '../public/data'
  ],
  watchExtensions: ['.csv', '.json', '.pdf'],
  autoLearnThreshold: 5, // Number of new items before auto-training
  checkIntervalMs: 60000 // Check for new data every minute
};

// Learning state
let learningState = {
  initialized: false,
  isLearning: false,
  watcherActive: false,
  
  // Tracked files
  indexedFiles: new Set(),
  fileHashes: {},
  
  // Learning history
  history: [],
  
  // Metrics
  metrics: {
    totalFilesProcessed: 0,
    totalItemsIndexed: 0,
    lastLearnTime: null,
    learningCycles: 0,
    autoTrainingRuns: 0
  }
};

// State persistence path
const STATE_PATH = path.join(__dirname, '../data/learning_state.json');

/**
 * Initialize the continuous learning system
 */
export async function initContinuousLearning() {
  console.log('🎓 Initializing Continuous Learning System...');
  
  // Load existing state
  loadState();
  
  // Initialize all subsystems
  try {
    await initAdaptiveRAG();
    await initSchemaLearner();
    await initDocumentLearner();
    await initFineTuner();
    await initAdaptiveEmailCalendar();
    
    learningState.initialized = true;
    console.log('✅ Continuous Learning System initialized');
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize learning system:', error.message);
    return false;
  }
}

/**
 * Load persisted state
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
      learningState.indexedFiles = new Set(data.indexedFiles || []);
      learningState.fileHashes = data.fileHashes || {};
      learningState.history = data.history || [];
      learningState.metrics = { ...learningState.metrics, ...data.metrics };
      console.log(`   Loaded state: ${learningState.indexedFiles.size} tracked files`);
    }
  } catch (e) {
    console.warn('   Could not load learning state');
  }
}

/**
 * Save state to disk
 */
function saveState() {
  const saveData = {
    indexedFiles: [...learningState.indexedFiles],
    fileHashes: learningState.fileHashes,
    history: learningState.history.slice(-100), // Keep last 100 entries
    metrics: learningState.metrics
  };
  
  fs.writeFileSync(STATE_PATH, JSON.stringify(saveData, null, 2));
}

/**
 * Learn from all data sources (full scan)
 */
export async function learnFromAllData() {
  if (learningState.isLearning) {
    console.log('⏳ Learning already in progress...');
    return { status: 'busy' };
  }
  
  learningState.isLearning = true;
  console.log('📚 Starting full data learning cycle...');
  
  const results = {
    csvFiles: 0,
    jsonFiles: 0,
    documentsProcessed: 0,
    errors: []
  };
  
  try {
    // Learn from each configured directory
    for (const relDir of LEARNING_CONFIG.dataDirectories) {
      const dirPath = path.join(__dirname, relDir);
      
      if (!fs.existsSync(dirPath)) {
        console.log(`   Skipping (not found): ${relDir}`);
        continue;
      }
      
      console.log(`   Processing: ${relDir}`);
      
      // Process all files in directory
      const files = fs.readdirSync(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) continue;
        
        const ext = path.extname(file).toLowerCase();
        
        try {
          if (ext === '.csv') {
            await processCSVFile(filePath);
            results.csvFiles++;
          } else if (ext === '.json') {
            await processJSONFile(filePath);
            results.jsonFiles++;
          }
          
          // Mark as processed
          learningState.indexedFiles.add(filePath);
          learningState.fileHashes[filePath] = stat.mtimeMs;
          
        } catch (error) {
          results.errors.push({ file, error: error.message });
        }
      }
    }
    
    // Update metrics
    learningState.metrics.totalFilesProcessed += results.csvFiles + results.jsonFiles;
    learningState.metrics.lastLearnTime = new Date().toISOString();
    learningState.metrics.learningCycles++;
    
    // Add to history
    learningState.history.push({
      type: 'full_scan',
      timestamp: new Date().toISOString(),
      results
    });
    
    // Check if training needed
    const needsTraining = checkTrainingNeeded();
    if (needsTraining) {
      console.log('   🏋️ Auto-triggering model fine-tuning...');
      await runFineTuning();
      learningState.metrics.autoTrainingRuns++;
    }
    
    saveState();
    
    console.log(`✅ Learning cycle complete: ${results.csvFiles} CSVs, ${results.jsonFiles} JSONs`);
    
  } finally {
    learningState.isLearning = false;
  }
  
  return results;
}

/**
 * Process a CSV file
 */
async function processCSVFile(filePath) {
  console.log(`      📊 Learning CSV: ${path.basename(filePath)}`);
  
  // Learn schema
  const schema = await learnCSVSchema(filePath);
  
  // Index products
  await indexProducts(filePath);
  
  // Update metrics
  learningState.metrics.totalItemsIndexed += schema.rowCount;
  
  return schema;
}

/**
 * Process a JSON file
 */
async function processJSONFile(filePath) {
  const fileName = path.basename(filePath);
  console.log(`      📋 Processing JSON: ${fileName}`);
  
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  
  // Check if it's a tenders file
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (first.tender_id || first.rfp_id || first.title) {
      await indexTenders(filePath);
      learningState.metrics.totalItemsIndexed += content.length;
    }
  }
  
  return { itemCount: Array.isArray(content) ? content.length : 1 };
}

/**
 * Learn from a new uploaded file
 */
export async function learnFromUpload(filePath, fileType = null) {
  console.log(`📤 Learning from upload: ${path.basename(filePath)}`);
  
  const ext = fileType || path.extname(filePath).toLowerCase();
  let result = {};
  
  try {
    if (ext === '.csv' || ext === 'csv') {
      result = await processCSVFile(filePath);
      result.type = 'csv';
    } else if (ext === '.json' || ext === 'json') {
      result = await processJSONFile(filePath);
      result.type = 'json';
    } else if (ext === '.pdf' || ext === 'pdf' || ext === '.txt' || ext === 'txt') {
      // For PDFs, expect text to be already extracted
      const text = fs.readFileSync(filePath, 'utf-8');
      result = await indexDocument(text, { fileName: path.basename(filePath) });
      result.type = 'document';
    }
    
    // Mark as indexed
    learningState.indexedFiles.add(filePath);
    
    // Add to history
    learningState.history.push({
      type: 'upload',
      file: path.basename(filePath),
      timestamp: new Date().toISOString(),
      result
    });
    
    // Trigger learning from new data
    await learnFromNewData({
      documents: result.type === 'document' ? [result] : [],
      products: result.type === 'csv' ? result.products : []
    });
    
    saveState();
    
    return { success: true, ...result };
    
  } catch (error) {
    console.error(`   Error processing upload: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Learn from extracted PDF text
 */
export async function learnFromPDFText(text, metadata = {}) {
  console.log(`📄 Learning from PDF: ${metadata.fileName || 'document'}`);
  
  try {
    // Learn document structure
    const structure = await learnDocumentStructure(text, metadata.fileName || 'uploaded_pdf', metadata);
    
    // Index document
    const indexResult = await indexDocument(text, metadata);
    
    // Trigger learning
    await learnFromNewData({
      documents: [{
        text: text.substring(0, 1000),
        type: structure.documentType,
        title: metadata.fileName
      }]
    });
    
    // Add to history
    learningState.history.push({
      type: 'pdf_learning',
      file: metadata.fileName,
      timestamp: new Date().toISOString(),
      documentType: structure.documentType,
      sectionsFound: structure.sections.length
    });
    
    saveState();
    
    return {
      success: true,
      documentType: structure.documentType,
      sections: structure.sections.length,
      extractedFields: Object.keys(structure.extractedInfo),
      indexed: true
    };
    
  } catch (error) {
    console.error(`   Error learning from PDF: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Check if model training is needed
 */
function checkTrainingNeeded() {
  const itemsSinceLastTraining = learningState.metrics.totalItemsIndexed;
  const lastTraining = learningState.metrics.lastTrainingTime;
  
  // Train if:
  // 1. Never trained before
  // 2. Many new items since last training
  // 3. Long time since last training
  
  if (!lastTraining) return true;
  
  const hoursSinceTraining = (Date.now() - new Date(lastTraining).getTime()) / (1000 * 60 * 60);
  
  return itemsSinceLastTraining > LEARNING_CONFIG.autoLearnThreshold * 10 || hoursSinceTraining > 24;
}

/**
 * Start file watcher for automatic learning
 */
export function startWatcher() {
  if (learningState.watcherActive) {
    console.log('👁️ Watcher already active');
    return;
  }
  
  console.log('👁️ Starting data watcher...');
  
  learningState.watcherActive = true;
  
  // Check for changes periodically
  setInterval(async () => {
    if (learningState.isLearning) return;
    
    for (const relDir of LEARNING_CONFIG.dataDirectories) {
      const dirPath = path.join(__dirname, relDir);
      if (!fs.existsSync(dirPath)) continue;
      
      const files = fs.readdirSync(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        
        // Check if file is new or modified
        const lastModified = learningState.fileHashes[filePath];
        if (!lastModified || lastModified < stat.mtimeMs) {
          // File changed or new
          console.log(`🔔 Detected change: ${file}`);
          await learnFromUpload(filePath);
        }
      }
    }
  }, LEARNING_CONFIG.checkIntervalMs);
  
  console.log(`   Watching directories every ${LEARNING_CONFIG.checkIntervalMs / 1000}s`);
}

/**
 * Stop file watcher
 */
export function stopWatcher() {
  learningState.watcherActive = false;
  console.log('👁️ Watcher stopped');
}

/**
 * Get learning system status
 */
export function getLearningStatus() {
  return {
    initialized: learningState.initialized,
    isLearning: learningState.isLearning,
    watcherActive: learningState.watcherActive,
    
    files: {
      indexed: learningState.indexedFiles.size,
      tracked: Object.keys(learningState.fileHashes).length
    },
    
    metrics: learningState.metrics,
    
    subsystems: {
      rag: getRAGStatus(),
      finetuner: getFineTunerStatus(),
      emailCalendar: getEmailCalendarStatus()
    },
    
    recentHistory: learningState.history.slice(-10)
  };
}

/**
 * Force re-learn everything
 */
export async function relearAll() {
  console.log('🔄 Re-learning all data...');
  
  // Clear state
  learningState.indexedFiles.clear();
  learningState.fileHashes = {};
  
  // Full learn
  const result = await learnFromAllData();
  
  // Force training
  await generateTrainingPairs();
  await runFineTuning();
  
  return result;
}

/**
 * Export learning data for external analysis
 */
export function exportLearningData() {
  return {
    state: {
      filesIndexed: learningState.indexedFiles.size,
      metrics: learningState.metrics
    },
    history: learningState.history,
    config: LEARNING_CONFIG
  };
}

export default {
  initContinuousLearning,
  learnFromAllData,
  learnFromUpload,
  learnFromPDFText,
  startWatcher,
  stopWatcher,
  getLearningStatus,
  relearAll,
  exportLearningData
};

