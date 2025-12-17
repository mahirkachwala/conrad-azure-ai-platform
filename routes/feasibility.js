import express from 'express';
import { getRfp } from '../services/rfpMemory.js';
import { computeFeasibility } from '../services/feasibility.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

let companyDirectory = [];
try {
  const dirPath = path.join(__dirname, '..', 'public', 'data', 'companies.json');
  if (fs.existsSync(dirPath)) {
    companyDirectory = JSON.parse(fs.readFileSync(dirPath, 'utf8'));
  }
} catch (error) {
  console.error('Failed to load company directory:', error);
}

router.get('/:rfpId', (req, res) => {
  try {
    const { rfp } = getRfp(req.params.rfpId);
    
    if (!rfp) {
      return res.status(404).json({ error: 'RFP not found' });
    }
    
    const companyName = req.query.company;
    let company = null;
    
    if (companyName) {
      company = companyDirectory.find(d => 
        (d.name || '').toLowerCase() === companyName.toLowerCase()
      );
    }
    
    const result = computeFeasibility({ rfp, company });
    
    res.json({ 
      rfpId: rfp.id,
      rfpTitle: rfp.title,
      companyName: companyName || 'Not specified',
      ...result 
    });
  } catch (error) {
    console.error('Error computing feasibility:', error);
    res.status(500).json({ error: 'Failed to compute feasibility' });
  }
});

export default router;
