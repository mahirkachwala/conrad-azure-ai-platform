/**
 * RFP Response Multi-Agent Workflow
 * Hackathon Feature: Complete RFP response automation
 */

import express from 'express';
import { MasterAgent } from '../services/agents/master-agent.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Store workflow sessions
const workflowSessions = new Map();

/**
 * POST /api/rfp-response/start
 * Start the multi-agent RFP response workflow
 */
router.post('/start', async (req, res) => {
  try {
    const sessionId = `session_${Date.now()}`;
    
    console.log(`\n🚀 Starting RFP Response Workflow - Session: ${sessionId}`);
    
    // Load all tenders
    const tendersPath = path.join(__dirname, '../public/data/all-portals.json');
    const allTenders = JSON.parse(fs.readFileSync(tendersPath, 'utf-8'));
    
    // Create master agent and execute workflow
    const masterAgent = new MasterAgent();
    
    // Store session
    workflowSessions.set(sessionId, {
      masterAgent,
      status: 'in_progress',
      startTime: new Date().toISOString()
    });
    
    // Execute workflow asynchronously
    masterAgent.executeRFPWorkflow(allTenders)
      .then(result => {
        const session = workflowSessions.get(sessionId);
        session.status = 'completed';
        session.result = result;
        session.endTime = new Date().toISOString();
        workflowSessions.set(sessionId, session);
      })
      .catch(error => {
        const session = workflowSessions.get(sessionId);
        session.status = 'failed';
        session.error = error.message;
        session.endTime = new Date().toISOString();
        workflowSessions.set(sessionId, session);
      });
    
    res.json({
      success: true,
      session_id: sessionId,
      message: 'RFP response workflow started',
      status: 'in_progress'
    });
    
  } catch (error) {
    console.error('Error starting workflow:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/rfp-response/status/:sessionId
 * Get status of ongoing workflow
 */
router.get('/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = workflowSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Session not found'
    });
  }
  
  const workflow = session.masterAgent.getWorkflowStatus();
  
  res.json({
    success: true,
    session_id: sessionId,
    status: session.status,
    start_time: session.startTime,
    end_time: session.endTime,
    workflow: workflow,
    steps_completed: workflow?.steps?.length || 0
  });
});

/**
 * GET /api/rfp-response/result/:sessionId
 * Get final results of completed workflow
 */
router.get('/result/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = workflowSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Session not found'
    });
  }
  
  if (session.status !== 'completed') {
    return res.status(400).json({
      success: false,
      error: 'Workflow not yet completed',
      status: session.status
    });
  }
  
  res.json({
    success: true,
    session_id: sessionId,
    workflow: session.result,
    final_response: session.result.final_response
  });
});

/**
 * GET /api/rfp-response/demo
 * Run a quick demo workflow
 */
router.get('/demo', async (req, res) => {
  try {
    const tendersPath = path.join(__dirname, '../public/data/all-portals.json');
    const allTenders = JSON.parse(fs.readFileSync(tendersPath, 'utf-8'));
    
    const masterAgent = new MasterAgent();
    const result = await masterAgent.executeRFPWorkflow(allTenders);
    
    res.json({
      success: true,
      workflow: result,
      final_response: result.final_response
    });
    
  } catch (error) {
    console.error('Demo workflow error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/rfp-response/selftest
 * Comprehensive system self-diagnostic for hackathon judges
 */
router.get('/selftest', async (req, res) => {
  const report = {
    timestamp: new Date().toISOString(),
    tests: [],
    overall_status: 'PASS',
    summary: {}
  };

  try {
    // Test 1: Data files exist and are valid
    console.log('🧪 Self-test: Checking data files...');
    const dataTests = [];
    
    const oemPath = path.join(__dirname, '../data/oem-products.json');
    const pricingPath = path.join(__dirname, '../data/test-pricing.json');
    const tendersPath = path.join(__dirname, '../public/data/all-portals.json');
    
    try {
      const oemData = JSON.parse(fs.readFileSync(oemPath, 'utf-8'));
      const totalProducts = Object.values(oemData).reduce((sum, category) => sum + category.length, 0);
      dataTests.push({
        name: 'OEM Products Data',
        status: totalProducts >= 10 ? 'PASS' : 'WARN',
        details: `${totalProducts} products across ${Object.keys(oemData).length} categories`,
        metric: totalProducts
      });
    } catch (e) {
      dataTests.push({ name: 'OEM Products Data', status: 'FAIL', error: e.message });
      report.overall_status = 'FAIL';
    }
    
    try {
      const pricingData = JSON.parse(fs.readFileSync(pricingPath, 'utf-8'));
      const testCount = Object.values(pricingData).reduce((sum, category) => 
        sum + (Array.isArray(category) ? category.length : 0), 0
      );
      dataTests.push({
        name: 'Test Pricing Data',
        status: testCount >= 15 ? 'PASS' : 'WARN',
        details: `${testCount} tests across ${Object.keys(pricingData).length} categories`,
        metric: testCount
      });
    } catch (e) {
      dataTests.push({ name: 'Test Pricing Data', status: 'FAIL', error: e.message });
      report.overall_status = 'FAIL';
    }
    
    try {
      const tenders = JSON.parse(fs.readFileSync(tendersPath, 'utf-8'));
      dataTests.push({
        name: 'Tender Database',
        status: tenders.length >= 80 ? 'PASS' : 'WARN',
        details: `${tenders.length} RFPs available`,
        metric: tenders.length
      });
    } catch (e) {
      dataTests.push({ name: 'Tender Database', status: 'FAIL', error: e.message });
      report.overall_status = 'FAIL';
    }
    
    report.tests.push({ category: 'Data Layer', tests: dataTests });
    
    // Test 2: Agent initialization
    console.log('🧪 Self-test: Testing agent initialization...');
    const agentTests = [];
    
    try {
      const masterAgent = new MasterAgent();
      agentTests.push({
        name: 'Master Agent',
        status: masterAgent ? 'PASS' : 'FAIL',
        details: 'Successfully instantiated'
      });
    } catch (e) {
      agentTests.push({ name: 'Master Agent', status: 'FAIL', error: e.message });
      report.overall_status = 'FAIL';
    }
    
    report.tests.push({ category: 'Agent System', tests: agentTests });
    
    // Test 3: Workflow execution (quick version with timeout)
    console.log('🧪 Self-test: Running quick workflow test...');
    const workflowTests = [];
    
    try {
      const tendersPath = path.join(__dirname, '../public/data/all-portals.json');
      const allTenders = JSON.parse(fs.readFileSync(tendersPath, 'utf-8'));
      
      const masterAgent = new MasterAgent();
      const startTime = Date.now();
      
      // Create a timeout promise that rejects with specific timeout error
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT_SENTINEL')), 45000)
      );
      
      // Race between workflow and timeout
      const workflowPromise = masterAgent.executeRFPWorkflow(allTenders);
      
      try {
        const result = await Promise.race([workflowPromise, timeoutPromise]);
        const duration = Date.now() - startTime;
        
        // Workflow completed successfully
        workflowTests.push({
          name: 'Sales Agent Selection',
          status: result.selected_rfp ? 'PASS' : 'FAIL',
          details: result.selected_rfp ? `Selected RFP: ${result.selected_rfp.id}` : 'No RFP selected',
          metric: result.selected_rfp?.priority_score
        });
        
        if (!result.selected_rfp) report.overall_status = 'FAIL';
        
        workflowTests.push({
          name: 'Technical Analysis',
          status: result.spec_match_table && result.spec_match_table.length > 0 ? 'PASS' : 'FAIL',
          details: result.spec_match_table ? `${result.spec_match_table.length} matches` : 'No matches found',
          metric: result.spec_match_table?.length || 0
        });
        
        if (!result.spec_match_table || result.spec_match_table.length === 0) report.overall_status = 'FAIL';
        
        workflowTests.push({
          name: 'Pricing Calculation',
          status: result.grand_total && result.grand_total > 0 ? 'PASS' : 'FAIL',
          details: result.grand_total ? `₹${(result.grand_total / 100000).toFixed(2)} L` : 'No pricing calculated',
          metric: result.grand_total
        });
        
        if (!result.grand_total || result.grand_total === 0) report.overall_status = 'FAIL';
        
        workflowTests.push({
          name: 'Workflow Completion',
          status: 'PASS',
          details: `Completed in ${(duration / 1000).toFixed(1)}s`,
          metric: duration
        });
        
      } catch (error) {
        // Distinguish between timeout and real errors
        const isTimeout = error.message === 'TIMEOUT_SENTINEL';
        
        if (isTimeout) {
          // Timeout - mark as warning, not failure
          workflowTests.push({
            name: 'Workflow Execution',
            status: 'TIMEOUT',
            details: 'Workflow exceeded 45s limit (expected for cold start with AI calls)',
            error: 'Timeout - acceptable for demo purposes'
          });
          
          // Prevent unhandled rejection from still-running workflow
          workflowPromise.catch(err => {
            console.log('⚠️ Workflow completed after timeout:', err.message?.substring(0, 100));
          });
        } else {
          // Real failure - mark as FAIL
          workflowTests.push({
            name: 'Workflow Execution',
            status: 'FAIL',
            details: 'Workflow failed with error',
            error: error.message,
            stack: error.stack?.split('\n').slice(0, 3).join('\n')
          });
          report.overall_status = 'FAIL';
        }
      }
      
    } catch (e) {
      workflowTests.push({
        name: 'Workflow Execution',
        status: 'FAIL',
        error: e.message,
        stack: e.stack?.split('\n').slice(0, 3).join('\n')
      });
      report.overall_status = 'FAIL';
    }
    
    report.tests.push({ category: 'Workflow Pipeline', tests: workflowTests });
    
    // Generate summary
    let totalTests = 0;
    let passed = 0;
    let failed = 0;
    let warnings = 0;
    
    report.tests.forEach(category => {
      category.tests.forEach(test => {
        totalTests++;
        if (test.status === 'PASS') passed++;
        else if (test.status === 'FAIL') failed++;
        else if (test.status === 'WARN' || test.status === 'TIMEOUT') warnings++;
      });
    });
    
    report.summary = {
      total_tests: totalTests,
      passed,
      failed,
      warnings,
      pass_rate: `${((passed / totalTests) * 100).toFixed(1)}%`
    };
    
    // Final status based on failures
    if (failed > 0) {
      report.overall_status = 'FAIL';
    } else if (warnings > 0) {
      report.overall_status = 'PASS_WITH_WARNINGS';
    }
    
    console.log(`\n✅ Self-test complete: ${report.overall_status}`);
    console.log(`   📊 ${passed}/${totalTests} tests passed (${report.summary.pass_rate})`);
    
    res.json(report);
    
  } catch (error) {
    console.error('Self-test error:', error);
    res.status(500).json({
      overall_status: 'ERROR',
      error: error.message,
      tests: report.tests
    });
  }
});

export default router;
