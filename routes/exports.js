import express from 'express';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const router = express.Router();

function getRunData(sessionId) {
  try {
    const runPath = path.join(process.cwd(), 'data', 'agent-runs', `${sessionId}.json`);
    if (!fs.existsSync(runPath)) return null;
    return JSON.parse(fs.readFileSync(runPath, 'utf-8'));
  } catch (e) {
    console.error('Export: Error reading run data:', e);
    return null;
  }
}

router.get('/csv/:type/:session', (req, res) => {
  const run = getRunData(req.params.session);
  const rows = req.params.type === 'spec' ? run?.spec_match_table : run?.pricing_table;
  
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(404).json({ error: 'No data available for export' });
  }
  
  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(',')];
  
  rows.forEach(row => {
    const values = headers.map(h => {
      const val = row[h] ?? '';
      return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
    });
    csvLines.push(values.join(','));
  });
  
  const csv = csvLines.join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${req.params.session}.csv"`);
  res.send(csv);
});

router.get('/pdf/summary/:session', (req, res) => {
  const run = getRunData(req.params.session);
  
  if (!run) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const doc = new PDFDocument({ margin: 50 });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="rfp-summary-${req.params.session}.pdf"`);
  
  doc.pipe(res);
  
  doc.fontSize(20).text('RFP Response Summary', { underline: true });
  doc.moveDown();
  
  if (run.selected_rfp) {
    doc.fontSize(14).text('Selected RFP Details', { underline: true });
    doc.fontSize(10);
    doc.text(`RFP ID: ${run.selected_rfp.id || 'N/A'}`);
    doc.text(`Title: ${run.selected_rfp.title || 'N/A'}`);
    doc.text(`Organization: ${run.selected_rfp.buyer || 'N/A'}`);
    doc.text(`Estimated Value: ₹${Number(run.selected_rfp.value || 0).toLocaleString('en-IN')}`);
    doc.text(`Due Date: ${run.selected_rfp.due_date || 'N/A'}`);
    doc.moveDown();
  }
  
  if (run.win_probability) {
    doc.fontSize(14).text('Win Probability Analysis', { underline: true });
    doc.fontSize(10);
    doc.fillColor(run.win_probability.badge?.color || '#000')
       .text(`${run.win_probability.badge?.icon || ''} ${run.win_probability.probability}% - ${run.win_probability.badge?.label || 'N/A'}`, { continued: false });
    doc.fillColor('#000');
    doc.text(run.win_probability.recommendation || '');
    doc.moveDown();
  }
  
  if (run.spec_match_table && run.spec_match_table.length > 0) {
    doc.fontSize(14).text('Top Product Matches', { underline: true });
    doc.fontSize(9);
    run.spec_match_table.slice(0, 5).forEach((item, idx) => {
      doc.text(`${idx + 1}. ${item.oem_sku || 'N/A'} - Match: ${item.match_pct || 0}%`);
      doc.text(`   ${item.notes || 'No notes'}`, { indent: 20 });
    });
    doc.moveDown();
  }
  
  if (run.grand_total) {
    doc.fontSize(14).text('Financial Summary', { underline: true });
    doc.fontSize(12).fillColor('#10b981')
       .text(`Total Bid Value: ₹${Number(run.grand_total).toLocaleString('en-IN')}`);
    doc.fillColor('#000');
    doc.moveDown();
  }
  
  if (run.assumptions) {
    doc.fontSize(14).text('Assumptions & Clarifications', { underline: true });
    doc.fontSize(9);
    if (run.assumptions.gaps_identified?.length > 0) {
      doc.text('Gaps Identified:', { underline: true });
      run.assumptions.gaps_identified.forEach(gap => doc.text(`• ${gap}`, { indent: 10 }));
      doc.moveDown(0.5);
    }
    if (run.assumptions.assumptions_made?.length > 0) {
      doc.text('Assumptions Made:', { underline: true });
      run.assumptions.assumptions_made.forEach(assumption => doc.text(`• ${assumption}`, { indent: 10 }));
    }
  }
  
  // Add buyer verification section
  if (run.buyer_verification?.verified) {
    doc.moveDown();
    doc.fontSize(14).text('Buyer Organization Verification', { underline: true });
    doc.fontSize(9);
    const verif = run.buyer_verification.verification;
    doc.text(`Company: ${verif.name}`);
    doc.text(`Status: ${verif.status}`);
    doc.text(`Incorporated: ${verif.incorporationDate} (${verif.companyAge} years old)`);
    doc.text(`Jurisdiction: ${verif.jurisdiction}`);
    doc.text(`Company Type: ${verif.companyType}`);
    doc.text(`Enhanced Credibility: ${run.buyer_verification.enhancedCredibility}/10 (base ${run.buyer_verification.originalCredibility}/10 + ${run.buyer_verification.credibilityBoost} boost)`);
    doc.fontSize(7).fillColor('#666').text(`Source: ${verif.opencorporatesUrl}`, { link: verif.opencorporatesUrl });
  }
  
  doc.end();
});

// Branded One-Pager PDF
router.get('/pdf/onepager/:session', (req, res) => {
  const run = getRunData(req.params.session);
  
  if (!run) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const doc = new PDFDocument({ 
    margin: 40,
    size: 'A4'
  });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="rfp-proposal-${req.params.session}.pdf"`);
  
  doc.pipe(res);
  
  // COVER PAGE with gradient effect
  doc.rect(0, 0, 612, 200).fill('#667eea');
  
  doc.fillColor('#ffffff')
     .fontSize(32)
     .font('Helvetica-Bold')
     .text('RFP Response Proposal', 40, 60);
  
  doc.fillColor('#f0f0f0')
     .fontSize(14)
     .font('Helvetica')
     .text(`Tender: ${run.selected_rfp?.id || 'N/A'}`, 40, 110);
  
  doc.fillColor('#e0e0e0')
     .fontSize(12)
     .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 40, 135);
  
  // Reset to body
  doc.fillColor('#000000').moveDown(4);
  
  // SECTION 1: Executive Summary
  doc.addPage();
  doc.fontSize(18).fillColor('#667eea').font('Helvetica-Bold').text('1. Executive Summary', 40, 50);
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#000000').font('Helvetica');
  
  const summaryData = [
    ['RFP Reference', run.selected_rfp?.id || 'N/A'],
    ['Organization', run.selected_rfp?.buyer || 'N/A'],
    ['Title', run.selected_rfp?.title || 'N/A'],
    ['Total Bid Value', `₹${Number(run.grand_total || 0).toLocaleString('en-IN')}`],
    ['Overall Spec Match', `${run.overall_spec_match || 0}%`],
    ['Delivery Timeline', `${run.delivery_timeline_days || 0} days`]
  ];
  
  let yPos = doc.y;
  summaryData.forEach(([label, value]) => {
    doc.fontSize(9).fillColor('#666').text(label, 60, yPos);
    doc.fontSize(10).fillColor('#000').font('Helvetica-Bold').text(value, 220, yPos);
    doc.font('Helvetica');
    yPos += 20;
  });
  
  doc.y = yPos + 10;
  
  // Add buyer verification if available
  if (run.buyer_verification?.verified) {
    const verif = run.buyer_verification.verification;
    doc.fontSize(11).fillColor('#10b981').font('Helvetica-Bold').text('✓ Buyer Verified via OpenCorporates', 60);
    doc.fontSize(9).fillColor('#000').font('Helvetica');
    doc.text(`Status: ${verif.status}`, 60);
    doc.text(`Company Age: ${verif.companyAge} years`, 60);
    doc.text(`Jurisdiction: ${verif.jurisdiction}`, 60);
    doc.text(`Enhanced Credibility: ${run.buyer_verification.enhancedCredibility}/10 (+${run.buyer_verification.credibilityBoost})`, 60);
    doc.moveDown(1);
  }
  
  // Win Probability Badge
  if (run.win_probability) {
    const badge = run.win_probability.badge;
    doc.fontSize(11).fillColor('#666').text('Win Probability:', 60);
    doc.fontSize(16).fillColor(badge.color).font('Helvetica-Bold')
       .text(`${badge.icon} ${run.win_probability.probability}% - ${badge.label}`, 160);
    doc.fontSize(9).fillColor('#666').font('Helvetica')
       .text(run.win_probability.recommendation, 60, doc.y + 5, { width: 480 });
    doc.moveDown(2);
  }
  
  // SECTION 2: Spec Match Table
  doc.fontSize(18).fillColor('#667eea').font('Helvetica-Bold').text('2. Product Specification Match', 40);
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#000').font('Helvetica');
  
  if (run.spec_match_table && run.spec_match_table.length > 0) {
    const topMatches = run.spec_match_table.slice(0, 5);
    topMatches.forEach((item, idx) => {
      doc.fontSize(10).fillColor('#667eea').font('Helvetica-Bold')
         .text(`${idx + 1}. ${item.oem_sku || 'N/A'}`, 60);
      doc.fontSize(9).fillColor('#000').font('Helvetica')
         .text(`Match: ${item.match_pct || 0}% | ${item.notes || 'No notes'}`, 80, doc.y, { width: 460 });
      doc.moveDown(0.8);
    });
  }
  
  doc.moveDown();
  
  // SECTION 3: Pricing Summary
  doc.fontSize(18).fillColor('#667eea').font('Helvetica-Bold').text('3. Pricing Summary');
  doc.moveDown(0.5);
  
  if (run.pricing_table && run.pricing_table.length > 0) {
    doc.fontSize(9).fillColor('#000').font('Helvetica');
    const grandTotal = run.pricing_table.reduce((sum, item) => sum + (item.total || 0), 0);
    
    run.pricing_table.slice(0, 5).forEach(item => {
      doc.text(`• ${item.oem_sku}: ₹${Number(item.total || 0).toLocaleString('en-IN')}`, 60);
    });
    
    doc.moveDown();
    doc.fontSize(12).fillColor('#10b981').font('Helvetica-Bold')
       .text(`Grand Total: ₹${Number(grandTotal).toLocaleString('en-IN')}`, 60);
  }
  
  doc.moveDown(2);
  
  // SECTION 4: Assumptions & Clarifications
  if (run.assumptions && run.assumptions.gaps_identified.length > 0) {
    doc.fontSize(18).fillColor('#f59e0b').font('Helvetica-Bold').text('4. Assumptions & Clarifications');
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#000').font('Helvetica');
    
    doc.text(`Risk Level: ${run.assumptions.risk_level}`, 60);
    doc.moveDown(0.5);
    
    doc.fontSize(10).fillColor('#666').font('Helvetica-Bold').text('Gaps Identified:', 60);
    run.assumptions.gaps_identified.forEach(gap => {
      doc.fontSize(8).fillColor('#000').font('Helvetica').text(`• ${gap}`, 70, doc.y, { width: 460 });
    });
    
    doc.moveDown();
    doc.fontSize(10).fillColor('#666').font('Helvetica-Bold').text('Assumptions Made:', 60);
    run.assumptions.assumptions_made.forEach(assumption => {
      doc.fontSize(8).fillColor('#000').font('Helvetica').text(`• ${assumption}`, 70, doc.y, { width: 460 });
    });
  }
  
  // Buyer Verification Section (if available)
  if (run.buyer_verification?.verified) {
    doc.moveDown(2);
    doc.fontSize(18).fillColor('#10b981').font('Helvetica-Bold').text('Buyer Organization Verification');
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#000').font('Helvetica');
    
    const verif = run.buyer_verification.verification;
    doc.fontSize(10).fillColor('#10b981').font('Helvetica-Bold').text('✓ Verified via OpenCorporates Registry', 60);
    doc.fontSize(8).fillColor('#000').font('Helvetica');
    doc.text(`Organization: ${verif.name}`, 60);
    doc.text(`Status: ${verif.status}`, 60);
    doc.text(`Incorporated: ${verif.incorporationDate} (${verif.companyAge} years)`, 60);
    doc.text(`Jurisdiction: ${verif.jurisdiction}`, 60);
    doc.text(`Enhanced Buyer Credibility: ${run.buyer_verification.enhancedCredibility}/10 (+${run.buyer_verification.credibilityBoost} boost)`, 60);
  }
  
  // Risky Clauses Section
  if (run.risky_clauses && run.risky_clauses.risky_clauses.length > 0) {
    doc.addPage();
    doc.fontSize(18).fillColor('#ef4444').font('Helvetica-Bold').text('5. Risk Analysis');
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#000').font('Helvetica');
    
    doc.text(`Overall Risk: ${run.risky_clauses.overall_risk}`, 60);
    doc.text(`High Risk Clauses: ${run.risky_clauses.high_risk_count}`, 60);
    doc.moveDown(0.5);
    
    run.risky_clauses.risky_clauses.forEach(clause => {
      const color = clause.risk === 'HIGH' ? '#ef4444' : clause.risk === 'MEDIUM' ? '#f59e0b' : '#6b7280';
      doc.fontSize(9).fillColor(color).font('Helvetica-Bold').text(`${clause.risk}: ${clause.key}`, 60);
      doc.fontSize(8).fillColor('#000').font('Helvetica').text(clause.description, 70);
      doc.fontSize(7).fillColor('#666').text(`"${clause.snippet}"`, 70, doc.y, { width: 460, italic: true });
      doc.moveDown(0.8);
    });
  }
  
  // Footer on last page
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#999').text('This proposal is generated by AI-Ready Tender Hub', 40, doc.page.height - 60, {
    align: 'center'
  });
  
  doc.end();
});

export default router;
