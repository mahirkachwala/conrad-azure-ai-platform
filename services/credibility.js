import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadCompanyDirectory() {
  const dirPath = path.join(__dirname, '..', 'public', 'data', 'companies.json');
  if (fs.existsSync(dirPath)) {
    return JSON.parse(fs.readFileSync(dirPath, 'utf8'));
  }
  return [];
}

export function getCredibilityScore(companyName) {
  const directory = loadCompanyDirectory();
  const found = directory.find(c => c.name.toLowerCase() === companyName.toLowerCase());
  
  if (!found) {
    return { 
      company: companyName, 
      score: 0, 
      label: 'UNKNOWN',
      confidence: 0, 
      signals: {}, 
      explain: ['Company not found in verified database'], 
      lastUpdated: null,
      oc_url: null
    };
  }
  
  return {
    company: found.name,
    score: found.raw_score || 0,
    label: found.credibility_label || 'UNKNOWN',
    confidence: found.verified ? 100 : 50,
    signals: found.signals || {},
    explain: found.green_flags || ['Verified via OpenCorporates'],
    lastUpdated: new Date().toISOString(),
    oc_url: found.oc_url || null,
    status: found.status || 'Unknown',
    age_years: found.age_years || null,
    jurisdiction: found.jurisdiction || null,
    incorporation_date: found.incorporation_date || null
  };
}

export function getAllCredibilityScores() {
  const directory = loadCompanyDirectory();
  return directory.map(c => getCredibilityScore(c.name));
}

export async function getCredibilityScoreLive(companyName) {
  return getCredibilityScore(companyName);
}

export async function getAllCredibilityScoresLive() {
  return getAllCredibilityScores();
}
