import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

function getRunData(sessionId) {
  try {
    const runPath = path.join(process.cwd(), 'data', 'agent-runs', `${sessionId}.json`);
    if (!fs.existsSync(runPath)) return null;
    return JSON.parse(fs.readFileSync(runPath, 'utf-8'));
  } catch (e) {
    console.error('Approval: Error reading run data:', e);
    return null;
  }
}

function saveRunData(sessionId, data) {
  try {
    const runPath = path.join(process.cwd(), 'data', 'agent-runs', `${sessionId}.json`);
    fs.writeFileSync(runPath, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('Approval: Error saving run data:', e);
    return false;
  }
}

// GET current pricing for a session
router.get('/:session', (req, res) => {
  const run = getRunData(req.params.session);
  if (!run?.pricing_table) {
    return res.status(404).json({ error: 'Session not found or no pricing data' });
  }
  
  res.json({
    pricing_table: run.pricing_table,
    grand_total: run.grand_total,
    approved: run.approved || false,
    session_id: req.params.session
  });
});

// POST edits to pricing table
// Expected body: [{ oem_sku, field, value }]
router.post('/:session/edit', express.json(), (req, res) => {
  const run = getRunData(req.params.session);
  if (!run?.pricing_table) {
    return res.status(404).json({ error: 'Session not found or no pricing data' });
  }
  
  const edits = req.body || [];
  let editCount = 0;
  const errors = [];
  
  edits.forEach(edit => {
    const row = run.pricing_table.find(r => r.oem_sku === edit.oem_sku);
    if (row && ['unit_price', 'tests_price', 'qty'].includes(edit.field)) {
      const numValue = Number(edit.value);
      
      // Validation: reject NaN, Infinity, or negative values
      if (!isFinite(numValue) || numValue < 0) {
        errors.push({
          sku: edit.oem_sku,
          field: edit.field,
          value: edit.value,
          reason: !isFinite(numValue) ? 'invalid_number' : 'negative_value'
        });
        return;
      }
      
      row[edit.field] = numValue;
      row.total = (Number(row.unit_price) * Number(row.qty)) + Number(row.tests_price);
      editCount++;
    }
  });
  
  // If there are validation errors, return them without saving
  if (errors.length > 0) {
    return res.status(400).json({
      error: 'validation_failed',
      message: 'Some edits failed validation',
      errors: errors
    });
  }
  
  // Recalculate grand total
  run.grand_total = run.pricing_table.reduce((sum, row) => sum + row.total, 0);
  
  // Save updated data
  run.last_edited = new Date().toISOString();
  run.edit_history = run.edit_history || [];
  run.edit_history.push({
    timestamp: new Date().toISOString(),
    edits_applied: editCount,
    new_total: run.grand_total
  });
  
  if (saveRunData(req.params.session, run)) {
    res.json({
      ok: true,
      edits_applied: editCount,
      grand_total: run.grand_total,
      pricing_table: run.pricing_table
    });
  } else {
    res.status(500).json({ error: 'Failed to save changes' });
  }
});

// POST approve final pricing
router.post('/:session/approve', (req, res) => {
  const run = getRunData(req.params.session);
  if (!run?.pricing_table) {
    return res.status(404).json({ error: 'Session not found or no pricing data' });
  }
  
  run.approved = true;
  run.approved_at = new Date().toISOString();
  run.approved_by = req.body?.approver || 'manager';
  
  if (saveRunData(req.params.session, run)) {
    res.json({
      ok: true,
      approved: true,
      approved_at: run.approved_at,
      grand_total: run.grand_total
    });
  } else {
    res.status(500).json({ error: 'Failed to approve' });
  }
});

// POST reject/reset approval
router.post('/:session/reject', (req, res) => {
  const run = getRunData(req.params.session);
  if (!run) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  run.approved = false;
  run.rejected_at = new Date().toISOString();
  run.rejection_reason = req.body?.reason || 'No reason provided';
  
  if (saveRunData(req.params.session, run)) {
    res.json({
      ok: true,
      approved: false,
      rejected_at: run.rejected_at
    });
  } else {
    res.status(500).json({ error: 'Failed to reject' });
  }
});

export default router;
