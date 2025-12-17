/**
 * Agentic Workflow API Routes
 * EY Techathon 6.0 - AI RFP Automation System
 */

import express from "express";
import { runGraphOnce, buildGraph, getWorkflowStats } from "../agentic/graph.js";

export const agenticRouter = express.Router();

/**
 * POST /api/agentic/run
 * Execute the complete agentic workflow
 */
agenticRouter.post("/run", async (req, res) => {
  try {
    console.log('\n🚀 API: Starting agentic workflow execution...');
    const result = await runGraphOnce(req.body || {});
    const stats = getWorkflowStats(result);
    
    res.json({ 
      ok: true, 
      result,
      stats,
      workflow_summary: {
        agents_executed: result.completedAgents,
        rfp_selected: result.selectedRFP?.tender_id,
        products_matched: result.recommendedSKUs?.length || 0,
        avg_spec_match: stats.technical.avg_spec_match,
        grand_total: result.consolidatedPricing?.grand_total,
        duration_ms: stats.duration_ms
      }
    });
  } catch (e) {
    console.error('Agentic graph error:', e);
    res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  }
});

/**
 * GET /api/agentic/diagram.mmd
 * Return Mermaid diagram for EY-compliant workflow visualization
 */
agenticRouter.get("/diagram.mmd", (req, res) => {
  const mmd = `flowchart TB
    subgraph ORCHESTRATION["🎯 MASTER AGENT - Orchestrator"]
        direction TB
        start([▶️ Start Workflow]):::start
        prepare[📋 Prepare Contextual<br/>Summaries]:::master
        consolidate[📊 Consolidate<br/>Final Response]:::master
        finish([✅ End Workflow]):::finish
    end
    
    subgraph WORKERS["👷 WORKER AGENTS"]
        direction TB
        
        subgraph SALES["📊 SALES AGENT"]
            s1[🔍 Scan Portal URLs]:::sales
            s2[📅 Filter RFPs<br/>Due in 90 Days]:::sales
            s3[🎯 Select ONE RFP<br/>for Response]:::sales
        end
        
        subgraph TECHNICAL["🔧 TECHNICAL AGENT"]
            t1[📦 Summarize<br/>Scope of Supply]:::tech
            t2[🎯 Match TOP 3<br/>OEM SKUs]:::tech
            t3[📊 Spec Match %<br/>Comparison Table]:::tech
            t4[✅ Select Final<br/>Recommended SKU]:::tech
        end
        
        subgraph PRICING["💰 PRICING AGENT"]
            p1[📋 Receive Test<br/>Requirements]:::pricing
            p2[💵 Assign Unit Prices<br/>from Pricing Table]:::pricing
            p3[🧪 Assign Test Prices<br/>from Services Table]:::pricing
            p4[📊 Consolidate<br/>Material + Services]:::pricing
        end
    end
    
    %% Flow connections
    start --> s1
    s1 --> s2 --> s3
    s3 -->|RFP Selected| prepare
    
    prepare -->|Products Summary| t1
    prepare -->|Tests Summary| p1
    
    t1 --> t2 --> t3 --> t4
    t4 -->|SKU Recommendations| p2
    
    p1 --> p3
    p2 --> p4
    p3 --> p4
    
    p4 -->|Consolidated Pricing| consolidate
    t4 -->|Spec Match Results| consolidate
    
    consolidate --> finish
    
    %% Styling
    classDef start fill:#22c55e,stroke:#16a34a,stroke-width:3px,color:#fff,font-weight:bold
    classDef finish fill:#10b981,stroke:#059669,stroke-width:3px,color:#fff,font-weight:bold
    classDef master fill:#8b5cf6,stroke:#7c3aed,stroke-width:2px,color:#fff
    classDef sales fill:#3b82f6,stroke:#2563eb,stroke-width:2px,color:#fff
    classDef tech fill:#f59e0b,stroke:#d97706,stroke-width:2px,color:#fff
    classDef pricing fill:#ec4899,stroke:#db2777,stroke-width:2px,color:#fff`;

  res.type("text/plain").send(mmd);
});

/**
 * GET /api/agentic/diagram-simple.mmd
 * Simple linear diagram for overview
 */
agenticRouter.get("/diagram-simple.mmd", (req, res) => {
  const mmd = `flowchart LR
    start([🎯 Start]):::s
    master1([👔 Master<br/>Start]):::master
    sales([📊 Sales<br/>Scan & Select]):::sales
    master2([👔 Master<br/>Context]):::master
    tech([🔧 Technical<br/>SKU Match]):::tech
    pricing([💰 Pricing<br/>Calculate]):::pricing
    master3([👔 Master<br/>Consolidate]):::master
    finish([✅ End]):::e
    
    start --> master1 --> sales --> master2 --> tech --> pricing --> master3 --> finish
    
    classDef s fill:#22c55e,stroke:#16a34a,stroke-width:3px,color:#fff
    classDef e fill:#10b981,stroke:#059669,stroke-width:3px,color:#fff
    classDef master fill:#8b5cf6,stroke:#7c3aed,stroke-width:2px,color:#fff
    classDef sales fill:#3b82f6,stroke:#2563eb,stroke-width:2px,color:#fff
    classDef tech fill:#f59e0b,stroke:#d97706,stroke-width:2px,color:#fff
    classDef pricing fill:#ec4899,stroke:#db2777,stroke-width:2px,color:#fff`;

  res.type("text/plain").send(mmd);
});

/**
 * GET /api/agentic/status
 * Get current system status
 */
agenticRouter.get("/status", (req, res) => {
  res.json({
    status: 'ready',
    system: 'EY Techathon - Agentic RFP Automation',
    agents: {
      master: { role: 'Orchestrator', status: 'active' },
      sales: { role: 'RFP Scanner', status: 'active' },
      technical: { role: 'SKU Matcher', status: 'active' },
      pricing: { role: 'Cost Calculator', status: 'active' }
    },
    capabilities: [
      'Portal URL Scanning',
      'RFP Filtering (90 days)',
      'TOP 3 SKU Matching',
      'Spec Match Metric (%)',
      'Comparison Tables',
      'Material + Services Pricing',
      'Consolidated Output'
    ]
  });
});

export default agenticRouter;
