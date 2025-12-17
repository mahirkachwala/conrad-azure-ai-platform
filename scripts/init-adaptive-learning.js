#!/usr/bin/env node
/**
 * Initialize Adaptive Learning System
 * EY Techathon 6.0 - ConRad AI System
 * 
 * Run this script to:
 * 1. Initialize all learning components
 * 2. Index existing data (CSVs, JSONs, PDFs)
 * 3. Generate training pairs
 * 4. Run initial model fine-tuning
 * 5. Start continuous learning watcher
 * 
 * Usage: npm run init-learning
 *        node scripts/init-adaptive-learning.js
 */

import { initContinuousLearning, learnFromAllData, startWatcher, getLearningStatus } from '../services/continuous-learner.js';
import { generateTrainingPairs, runFineTuning, getFineTunerStatus } from '../services/model-finetuner.js';
import { getRAGStatus, syncAllData } from '../services/adaptive-rag.js';
import { getAllSchemas } from '../services/schema-learner.js';
import { getStats as getDocStats } from '../services/document-learner.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║     ConRad AI - Adaptive Learning System Initialization          ║');
  console.log('║     EY Techathon 6.0                                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  const startTime = Date.now();
  
  try {
    // Step 1: Initialize all systems
    console.log('📦 Step 1/5: Initializing learning systems...');
    console.log('─'.repeat(60));
    await initContinuousLearning();
    console.log('');
    
    // Step 2: Learn from all existing data
    console.log('📚 Step 2/5: Learning from existing data...');
    console.log('─'.repeat(60));
    const learnResults = await learnFromAllData();
    console.log(`   CSV files processed: ${learnResults.csvFiles}`);
    console.log(`   JSON files processed: ${learnResults.jsonFiles}`);
    if (learnResults.errors.length > 0) {
      console.log(`   ⚠️ Errors: ${learnResults.errors.length}`);
    }
    console.log('');
    
    // Step 3: Sync RAG data
    console.log('🗄️ Step 3/5: Syncing vector database...');
    console.log('─'.repeat(60));
    await syncAllData();
    console.log('');
    
    // Step 4: Generate training pairs and fine-tune
    console.log('🏋️ Step 4/5: Fine-tuning models...');
    console.log('─'.repeat(60));
    const pairs = await generateTrainingPairs();
    console.log(`   Training pairs: ${pairs.length}`);
    
    const tuningResult = await runFineTuning();
    console.log(`   Pairs processed: ${tuningResult.pairsProcessed}`);
    console.log(`   Avg margin: ${(tuningResult.avgMargin * 100).toFixed(2)}%`);
    console.log('');
    
    // Step 5: Print final status
    console.log('📊 Step 5/5: Final Status');
    console.log('─'.repeat(60));
    
    const ragStatus = getRAGStatus();
    const finetuneStatus = getFineTunerStatus();
    const schemas = getAllSchemas();
    const docStats = getDocStats();
    
    console.log('');
    console.log('┌─────────────────────────────────────────────────────────────────┐');
    console.log('│  ADAPTIVE LEARNING SYSTEM - INITIALIZED                         │');
    console.log('├─────────────────────────────────────────────────────────────────┤');
    console.log(`│  Schemas Learned:        ${Object.keys(schemas).length.toString().padStart(10)}                          │`);
    console.log(`│  Products Indexed:       ${ragStatus.indexedProducts?.toString().padStart(10) || '0'}                          │`);
    console.log(`│  Documents Processed:    ${docStats.templateCount.toString().padStart(10)}                          │`);
    console.log(`│  Domain Terms:           ${finetuneStatus.domainTerms.toString().padStart(10)}                          │`);
    console.log(`│  Training Pairs:         ${finetuneStatus.trainingPairs.toString().padStart(10)}                          │`);
    console.log(`│  Adaptation Weights:     ${finetuneStatus.adaptationWeights.toString().padStart(10)}                          │`);
    console.log('├─────────────────────────────────────────────────────────────────┤');
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`│  Total Time:             ${duration.padStart(10)}s                         │`);
    console.log('└─────────────────────────────────────────────────────────────────┘');
    console.log('');
    
    // Print learned schemas
    console.log('📋 Learned Schemas:');
    for (const [fileName, schema] of Object.entries(schemas)) {
      console.log(`   • ${fileName}: ${schema.columns.length} columns, ${schema.rowCount} rows`);
    }
    console.log('');
    
    // Print document types
    console.log('📄 Document Types Learned:');
    for (const docType of docStats.documentTypes) {
      console.log(`   • ${docType}`);
    }
    console.log('');
    
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ INITIALIZATION COMPLETE                                      ║');
    console.log('║                                                                  ║');
    console.log('║  The system is now ready to:                                     ║');
    console.log('║  • Adapt to any new CSV structure                               ║');
    console.log('║  • Process any PDF/document format                              ║');
    console.log('║  • Perform semantic search across all data                      ║');
    console.log('║  • Learn continuously from new uploads                          ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('');
    
    // Optional: Start watcher
    const shouldWatch = process.argv.includes('--watch');
    if (shouldWatch) {
      console.log('👁️ Starting continuous learning watcher...');
      startWatcher();
      console.log('   Press Ctrl+C to stop');
    } else {
      console.log('💡 Run with --watch to enable automatic learning from new files');
    }
    
  } catch (error) {
    console.error('');
    console.error('❌ Initialization failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();



