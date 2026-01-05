import 'dotenv/config'; // Must be FIRST - loads .env immediately

import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import { spawn } from "child_process";
import './db/index.js';
import { sessionMemory, newSessionId } from './services/session-memory.js';

// ============= VOICE SERVICE (DISABLED - Using Azure Cognitive Services) =============
// FasterWhisper local service is no longer required.
// Voice input is now powered by Azure Cognitive Services – Speech.
// The voice-service folder is kept for reference but not auto-started.
let voiceServiceProcess = null;

function startVoiceService() {
  // DISABLED: Azure Cognitive Services – Speech is now used instead
  console.log('🎤 Voice input is powered by Azure Cognitive Services – Speech');
  // Original FasterWhisper service startup code disabled
}
// ============= END VOICE SERVICE =============

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// Session middleware
app.use((req, res, next) => {
  let sessionId = req.cookies.sessionId || req.headers['x-session-id'] || req.body.sessionId;
  if (!sessionId) {
    sessionId = newSessionId();
    res.cookie('sessionId', sessionId, { 
      httpOnly: true, 
      sameSite: 'Lax',
      maxAge: 30 * 60 * 1000 // 30 minutes
    });
  }
  req.sessionId = sessionId;
  next();
});

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (filePath.endsWith(".json")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    // Disable caching for development
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Serve dataset CSV files for download
app.get("/data/:filename", (req, res) => {
  const filename = req.params.filename;
  const allowedFiles = ['products.csv', 'oem_specs.csv', 'pricing_rules.csv', 'testing.csv', 'rfp_requirements.csv'];
  
  if (!allowedFiles.includes(filename)) {
    return res.status(404).send('File not found');
  }
  
  const filePath = path.join(__dirname, 'data', filename);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error serving file:', err);
      res.status(404).send('File not found');
    }
  });
});

// Serve product CSV files for download
app.get("/data/products/:filename", (req, res) => {
  const filename = req.params.filename;
  const allowedFiles = ['lt_cables.csv', 'ht_cables.csv', 'control_cables.csv', 'ehv_cables.csv', 'instrumentation_cables.csv'];
  
  if (!allowedFiles.includes(filename)) {
    return res.status(404).send('File not found');
  }
  
  const filePath = path.join(__dirname, 'data', 'products', filename);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error serving file:', err);
      res.status(404).send('File not found');
    }
  });
});

import { handleChatMessage } from './routes/chat.js';
import { handleAnalyzeRequest } from './routes/analyze.js';
import uploadRouter from './routes/upload.js';
import credibilityRouter from './routes/credibility.js';
import askRouter from './routes/ask.js';
import remindersRouter from './routes/reminders.js';
import feasibilityRouter from './routes/feasibility.js';
import compareRouter from './routes/compare.js';
import aiStatusRouter from './routes/ai-status.js';
import rfpResponseRouter from './routes/rfp-response.js';
import exportsRouter from './routes/exports.js';
import approvalRouter from './routes/approval.js';
import liveRfpsRouter from './routes/live-rfps.js';
import agenticRouter from './routes/agentic.js';
import datasetRouter from './routes/dataset.js';
import demoRouter from './routes/demo.js';
import agentStreamRouter from './routes/agent-stream.js';
import rfpAnalysisRouter from './routes/rfp-analysis.js';
import pdfRouter from './routes/pdf.js';
import aiSearchRouter from './routes/ai-search.js';
import rfpProceedRouter from './routes/rfp-proceed.js';
import vectorStoreRouter from './routes/vector-store.js';
import learningRouter from './routes/learning.js';
import generatePdfRouter from './routes/generate-pdf.js';
import adaptiveDataRouter from './routes/adaptive-data.js';
import speechRouter from './routes/speech.js';

app.post("/api/chat", handleChatMessage);
app.post("/api/analyze", handleAnalyzeRequest);
app.use("/api/upload", uploadRouter);
app.use("/api/credibility", credibilityRouter);
app.use("/api/ask", askRouter);
app.use("/api/reminders", remindersRouter);
app.use("/api/feasibility", feasibilityRouter);
app.use("/api/compare", compareRouter);
app.use("/api/ai", aiStatusRouter);
app.use("/api/rfp-response", rfpResponseRouter);
app.use("/api/export", exportsRouter);
app.use("/api/approval", approvalRouter);
app.use("/api/live", liveRfpsRouter);
app.use("/api/agentic", agenticRouter);
app.use("/api/dataset", datasetRouter);
app.use("/api/demo", demoRouter);
app.use("/api/agent-stream", agentStreamRouter);
app.use("/api/analysis", rfpAnalysisRouter);
app.use("/api/pdf", pdfRouter);
app.use("/api/ai-search", aiSearchRouter);
app.use("/api/rfp-proceed", rfpProceedRouter);
app.use("/api/vector", vectorStoreRouter);
app.use("/api/learning", learningRouter);
app.use("/api/generate-pdf", generatePdfRouter);
app.use("/api/adaptive", adaptiveDataRouter);
app.use("/api/speech", speechRouter);

// Context management endpoints
app.post("/api/context/clear", (req, res) => {
  sessionMemory.clear(req.sessionId);
  res.json({ success: true, message: 'Context cleared' });
});

app.get("/api/context", (req, res) => {
  const context = sessionMemory.get(req.sessionId);
  res.json({ 
    hasContext: !!context.companyName,
    context: context 
  });
});

// Self-test endpoint for context
app.get("/api/selftest/context", async (req, res) => {
  const testSessionId = 'test-' + Date.now();
  sessionMemory.set(testSessionId, { 
    companyName: 'ABB India Limited',
    lastActivity: 'test' 
  });
  
  const { resolveCompanyReference } = await import('./services/session-memory.js');
  const resolved = resolveCompanyReference(testSessionId, 'same company');
  
  sessionMemory.clear(testSessionId);
  
  res.json({ 
    test: 'context_resolution',
    expected: 'ABB India Limited',
    got: resolved.companyName,
    pass: resolved.companyName === 'ABB India Limited',
    source: resolved.source
  });
});

app.get("/rfp/:tenderId.html", async (req, res) => {
  try {
    const tenderId = req.params.tenderId;
    const dataPath = path.join(__dirname, 'public/data/all-portals.json');
    const dataContent = await fs.readFile(dataPath, 'utf-8');
    const allTenders = JSON.parse(dataContent);
    
    const tender = allTenders.find(t => t.tender_id === tenderId);
    
    if (!tender) {
      return res.status(404).send('<h1>Tender Not Found</h1><p>The requested tender does not exist.</p>');
    }
    
    const html = generateTenderDetailHTML(tender);
    res.send(html);
  } catch (error) {
    console.error('Error loading tender detail:', error);
    res.status(500).send('<h1>Error</h1><p>Failed to load tender details.</p>');
  }
});

function generateTenderDetailHTML(tender) {
  const dueDate = new Date(tender.due_date);
  const publishDate = new Date(tender.publish_date);
  const formattedDueDate = dueDate.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  const formattedPublishDate = publishDate.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  const formattedCost = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(tender.estimated_cost_inr);
  
  const portalColors = {
    'government': '#2e7d32',
    'private': '#1976d2',
    'utility': '#d84315'
  };
  const primaryColor = portalColors[tender.source_type] || '#1976d2';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tender.tender_id} - ${tender.title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; line-height: 1.6; }
    .container { max-width: 1000px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor}dd 100%); color: white; padding: 40px 30px; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .tender-id { font-size: 14px; opacity: 0.9; margin-bottom: 10px; letter-spacing: 1px; }
    .tender-title { font-size: 28px; font-weight: 700; margin-bottom: 15px; }
    .tender-org { font-size: 18px; opacity: 0.95; }
    .content-card { background: white; border-radius: 8px; padding: 30px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .section-title { font-size: 20px; font-weight: 600; color: #333; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid ${primaryColor}; }
    .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 25px; }
    .info-item { }
    .info-label { font-size: 12px; text-transform: uppercase; color: #666; margin-bottom: 5px; letter-spacing: 0.5px; }
    .info-value { font-size: 16px; color: #222; font-weight: 500; }
    .status-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-top: 5px; }
    .status-active { background: #e8f5e9; color: #2e7d32; }
    .status-closing-soon { background: #fff3e0; color: #e65100; }
    .cost-highlight { font-size: 32px; font-weight: 700; color: ${primaryColor}; }
    .actions { display: flex; gap: 15px; margin-top: 30px; flex-wrap: wrap; }
    .btn { display: inline-block; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; text-align: center; transition: all 0.3s; cursor: pointer; border: none; font-size: 15px; }
    .btn-primary { background: ${primaryColor}; color: white; }
    .btn-primary:hover { background: ${primaryColor}dd; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .btn-secondary { background: #f5f5f5; color: #333; border: 1px solid #ddd; }
    .btn-secondary:hover { background: #eeeeee; }
    .material-detail { background: #f9f9f9; padding: 15px; border-radius: 6px; border-left: 4px solid ${primaryColor}; }
    .back-link { display: inline-block; margin-bottom: 20px; color: ${primaryColor}; text-decoration: none; font-weight: 500; }
    .back-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back-link">← Back to Home</a>
    
    <div class="header">
      <div class="tender-id">RFP ID: ${tender.tender_id}</div>
      <h1 class="tender-title">${tender.title}</h1>
      <div class="tender-org">${tender.organisation}</div>
    </div>
    
    <div class="content-card">
      <h2 class="section-title">Tender Information</h2>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Estimated Cost</div>
          <div class="cost-highlight">${formattedCost}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Due Date</div>
          <div class="info-value">${formattedDueDate}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Published Date</div>
          <div class="info-value">${formattedPublishDate}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Status</div>
          <div><span class="status-badge status-${tender.status || 'active'}">${(tender.status || 'active').toUpperCase().replace('-', ' ')}</span></div>
        </div>
      </div>
      
      <h3 class="section-title" style="margin-top: 30px;">Material & Category</h3>
      <div class="material-detail">
        <div class="info-label">Material Description</div>
        <div class="info-value" style="font-size: 18px; margin-bottom: 10px;">${tender.material}</div>
        <div class="info-label">Product Category</div>
        <div class="info-value">${tender.product_category}</div>
      </div>
      
      <h3 class="section-title" style="margin-top: 30px;">Location & Contact</h3>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">City</div>
          <div class="info-value">${tender.city}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Contact Email</div>
          <div class="info-value">${tender.contact_email}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Contact Phone</div>
          <div class="info-value">${tender.contact_phone}</div>
        </div>
      </div>
      
      <div class="actions">
        <a href="${tender.pdf_url || tender.submission?.pdf_url || tender.documents?.[0] || '#'}" class="btn btn-primary" download>📄 Download RFP Document (PDF)</a>
        <a href="/chat.html" class="btn btn-secondary">💬 Analyze with AI Chat</a>
      </div>
      
      ${tender.submission ? `
      <div class="submission-info" style="margin-top: 30px; background: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #1976d2;">
        <h3 style="margin-bottom: 15px; color: #1565c0;">📋 Submission Instructions</h3>
        <div style="margin-bottom: 10px;">
          <strong>Submission Mode:</strong> ${tender.submission.mode?.replace(/_/g, ' ')}
        </div>
        <div style="margin-bottom: 10px; color: #666;">
          ${tender.submission.submission_notes || ''}
        </div>
        ${tender.submission.submission_email ? `<div><strong>Submit to:</strong> ${tender.submission.submission_email}</div>` : ''}
        ${tender.submission.submission_address ? `<div><strong>Courier to:</strong> ${tender.submission.submission_address}</div>` : ''}
        ${tender.submission.vendor_portal_url ? `<div><strong>Portal:</strong> <a href="${tender.submission.vendor_portal_url}" target="_blank">${tender.submission.vendor_portal_url}</a></div>` : ''}
        ${tender.submission.meeting_email ? `<div><strong>Meeting Request:</strong> ${tender.submission.meeting_email}</div>` : ''}
      </div>
      ` : ''}
    </div>
  </div>
</body>
</html>`;
}

app.post("/api/scrape-portal", async (req, res) => {
  try {
    const { url } = req.body;
    
    const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
    const targetUrl = url || `${baseUrl}/`;

    const response = await axios.get(targetUrl);
    const html = response.data;
    const $ = cheerio.load(html);

    const scrapedData = {
      pageTitle: $('title').text(),
      tenderCount: $('.tender-card').length,
      tenders: []
    };

    $('.tender-card').each((index, element) => {
      const tenderId = $(element).find('.t-title').text().split('-')[0].trim();
      const title = $(element).find('.t-title').text();
      const organisation = $(element).find('.t-org').text().replace('Issuer:', '').trim();
      const city = $(element).find('.t-city').text().replace('City:', '').trim();
      const material = $(element).find('.t-material').text().replace('Material:', '').trim();
      const cost = $(element).find('.t-cost').text().replace('Estimated Cost:', '').trim();
      const status = $(element).find('.t-status').text().replace('Status:', '').trim();

      scrapedData.tenders.push({
        tenderId,
        title,
        organisation,
        city,
        material,
        cost,
        status
      });
    });

    scrapedData.scrapedAt = new Date().toISOString();
    scrapedData.sourceUrl = targetUrl;

    res.json(scrapedData);
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape portal data' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    ConRad Server Started                   ║
╠════════════════════════════════════════════════════════════╣
║  🌐 Main Server: http://localhost:${PORT}                     ║
║  💬 Chat: http://localhost:${PORT}/chat.html                  ║
║  📊 Orchestration: http://localhost:${PORT}/agent-orchestration.html
╚════════════════════════════════════════════════════════════╝
  `);
  
  // Voice input is powered by Azure Cognitive Services – Speech
  console.log('🎤 Voice input is powered by Azure Cognitive Services – Speech');
});
