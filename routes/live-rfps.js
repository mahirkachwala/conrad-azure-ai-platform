import express from 'express';
import fs from 'fs';
import path from 'path';
import { scrapeCPPPWithRetry } from '../adapters/cppp-scraper.js';
import { searchCompany, verifyAndEnhanceCompany } from '../services/opencorporates.js';
import { getVendorsForTags, SEED_VENDORS } from '../config/vendor-mapping.js';

const router = express.Router();

const DATA_DIR = path.join(process.cwd(), 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const OC_CACHE_FILE = path.join(CACHE_DIR, 'oc-companies.json');

let companyCache = {};
try {
  if (fs.existsSync(OC_CACHE_FILE)) {
    companyCache = JSON.parse(fs.readFileSync(OC_CACHE_FILE, 'utf-8'));
  }
} catch (error) {
  console.log('No company cache found, starting fresh');
}

function saveCompanyCache() {
  try {
    fs.writeFileSync(OC_CACHE_FILE, JSON.stringify(companyCache, null, 2));
  } catch (error) {
    console.error('Error saving company cache:', error);
  }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchCompanyWithCache(companyName) {
  if (companyCache[companyName]) {
    console.log(`  ↻ Using cached data for: ${companyName}`);
    return companyCache[companyName];
  }
  
  await delay(300);
  
  try {
    console.log(`  🔍 Fetching: ${companyName}`);
    
    const searchResult = await searchCompany(companyName, 'in');
    
    if (!searchResult.success || searchResult.companies.length === 0) {
      const result = {
        name: companyName,
        credibilityLabel: 'UNKNOWN',
        rawScore: 0,
        verified: false
      };
      companyCache[companyName] = result;
      saveCompanyCache();
      return result;
    }
    
    const verification = await verifyAndEnhanceCompany(companyName, { credibility_score: 5.0 });
    
    if (verification.verified) {
      const result = {
        name: verification.verification.name,
        jurisdiction: verification.verification.jurisdiction,
        company_number: verification.verification.companyNumber,
        oc_url: verification.verification.opencorporatesUrl,
        status: verification.verification.status,
        incorporation_date: verification.verification.incorporationDate,
        age_years: verification.verification.companyAge,
        signals: verification.signals,
        rawScore: verification.rawScore,
        credibilityLabel: verification.credibilityLabel,
        enhancedCredibility: verification.enhancedCredibility,
        verified: true
      };
      
      companyCache[companyName] = result;
      saveCompanyCache();
      return result;
    }
  } catch (error) {
    console.error(`  ❌ Error fetching ${companyName}:`, error.message);
  }
  
  const fallback = {
    name: companyName,
    credibilityLabel: 'UNKNOWN',
    rawScore: 0,
    verified: false
  };
  companyCache[companyName] = fallback;
  saveCompanyCache();
  return fallback;
}

router.get('/collect', async (req, res) => {
  try {
    const keywords = (req.query.keywords || 'cable,transformer,switchgear,conductor,oil')
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);
    
    const maxResults = Math.min(parseInt(req.query.limit || '50'), 100);
    
    console.log('🚀 Starting live RFP collection...');
    console.log(`   Keywords: ${keywords.join(', ')}`);
    console.log(`   Max results: ${maxResults}`);
    
    const tenders = await scrapeCPPPWithRetry({ keywords, maxResults });
    
    const outputPath = path.join(DATA_DIR, 'live-tenders.json');
    fs.writeFileSync(outputPath, JSON.stringify(tenders, null, 2));
    
    console.log(`✅ Collected ${tenders.length} live RFPs`);
    console.log(`   Saved to: ${outputPath}`);
    
    res.json({
      success: true,
      count: tenders.length,
      tenders: tenders,
      cached_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ RFP collection error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/shortlist-companies', async (req, res) => {
  try {
    const { resource_tags = [], limit = 60 } = req.body || {};
    
    console.log('🏢 Starting company shortlisting...');
    console.log(`   Tags: ${resource_tags.join(', ') || 'all'}`);
    console.log(`   Limit: ${limit}`);
    
    const targetVendors = resource_tags.length > 0
      ? getVendorsForTags(resource_tags)
      : SEED_VENDORS;
    
    const vendorsToFetch = targetVendors.slice(0, Math.min(limit, targetVendors.length));
    
    console.log(`   Fetching ${vendorsToFetch.length} companies...`);
    
    const results = [];
    for (const vendorName of vendorsToFetch) {
      const companyData = await fetchCompanyWithCache(vendorName);
      results.push(companyData);
    }
    
    const outputPath = path.join(DATA_DIR, 'live-companies.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    
    const labelCounts = results.reduce((acc, c) => {
      acc[c.credibilityLabel] = (acc[c.credibilityLabel] || 0) + 1;
      return acc;
    }, {});
    
    console.log(`✅ Shortlisted ${results.length} companies`);
    console.log(`   Labels: ${JSON.stringify(labelCounts)}`);
    console.log(`   Saved to: ${outputPath}`);
    
    res.json({
      success: true,
      count: results.length,
      companies: results,
      label_distribution: labelCounts
    });
    
  } catch (error) {
    console.error('❌ Company shortlisting error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/match', async (req, res) => {
  try {
    console.log('🎯 Starting RFP-to-vendor matching...');
    
    const tendersPath = path.join(DATA_DIR, 'live-tenders.json');
    const companiesPath = path.join(DATA_DIR, 'live-companies.json');
    
    if (!fs.existsSync(tendersPath) || !fs.existsSync(companiesPath)) {
      return res.status(400).json({
        success: false,
        error: 'Please run /collect and /shortlist-companies first'
      });
    }
    
    const tenders = JSON.parse(fs.readFileSync(tendersPath, 'utf-8'));
    const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf-8'));
    
    const matches = tenders.map(rfp => {
      const tags = (rfp.resource_tags || []).map(t => t.toLowerCase());
      
      const preferredVendors = getVendorsForTags(tags);
      
      const rankedCompanies = companies
        .map(company => {
          const isPreferred = preferredVendors.includes(company.name);
          const preferenceBonus = isPreferred ? 20 : 0;
          
          const rankScore = (company.rawScore || 0) + preferenceBonus;
          
          return {
            ...company,
            isPreferred,
            rankScore
          };
        })
        .sort((a, b) => b.rankScore - a.rankScore);
      
      const shortlist = rankedCompanies.slice(0, 8);
      
      return {
        rfp_id: rfp.tender_id,
        portal: rfp.portal,
        title: rfp.title,
        organization: rfp.organisation,
        category: rfp.category,
        tags: rfp.resource_tags,
        due_date: rfp.due_date,
        days_remaining: rfp.days_remaining,
        url: rfp.detail_url,
        shortlist: shortlist.map(c => ({
          name: c.name,
          label: c.credibilityLabel,
          score: c.rawScore,
          rank_score: c.rankScore,
          is_preferred: c.isPreferred,
          verified: c.verified,
          oc_url: c.oc_url
        }))
      };
    });
    
    const outputPath = path.join(DATA_DIR, 'rfp-matches.json');
    fs.writeFileSync(outputPath, JSON.stringify(matches, null, 2));
    
    console.log(`✅ Matched ${matches.length} RFPs to vendors`);
    console.log(`   Saved to: ${outputPath}`);
    
    res.json({
      success: true,
      count: matches.length,
      matches
    });
    
  } catch (error) {
    console.error('❌ Matching error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/cache-stats', (req, res) => {
  res.json({
    cached_companies: Object.keys(companyCache).length,
    companies: Object.values(companyCache).map(c => ({
      name: c.name,
      label: c.credibilityLabel,
      verified: c.verified
    }))
  });
});

router.delete('/cache', (req, res) => {
  companyCache = {};
  if (fs.existsSync(OC_CACHE_FILE)) {
    fs.unlinkSync(OC_CACHE_FILE);
  }
  res.json({ success: true, message: 'Cache cleared' });
});

export default router;
