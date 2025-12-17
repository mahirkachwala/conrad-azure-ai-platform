/**
 * Core Module Index
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * This module re-exports all core functionality from a single location.
 * Import from here instead of individual service files for cleaner imports.
 * 
 * EXAMPLE USAGE:
 * import { parseRFPDocument, matchSKU, calculatePricing, scrapePortals } from './core/index.js';
 */

// ===========================================
// AI Engine (Multi-provider support)
// ===========================================
export { aiProvider, GeminiProvider, OllamaProvider, OpenAIProvider, providerConfig } from '../services/ai-provider.js';

// Gemini-specific AI functions
export { 
  parseUserQuery, 
  answerCompanyQuestion, 
  compareCompanies, 
  compareTenders,
  generateCounterOffer 
} from '../services/gemini-ai.js';

// ===========================================
// RFP Parser (Document extraction)
// ===========================================
export { 
  extractDocumentData, 
  analyzeUploadedDocument 
} from '../services/document-extractor.js';

// ===========================================
// Web Scraper (Portal data fetching)
// ===========================================
export { 
  fetchPortalData, 
  scrapeMultiplePortals 
} from '../services/scraper.js';

// ===========================================
// SKU Matcher (Product matching)
// ===========================================
// Note: SKU matching is currently embedded in TechnicalAgent
// This export provides access to the OEM products and matching logic

export { loadOEMProducts, findCompany, findTender, filterTenders } from '../utils/data-loader.js';

// ===========================================
// Pricing Engine
// ===========================================
// Note: Pricing logic is currently in PricingAgent
// Exporting the test pricing data loader for direct access

export { loadTestPricing } from '../utils/data-loader.js';

// ===========================================
// Credibility Engine (Company verification)
// ===========================================
export {
  loadCompanyDirectory,
  getCredibilityScore,
  getAllCredibilityScores,
  getCredibilityScoreLive,
  getAllCredibilityScoresLive
} from '../services/credibility.js';

// OpenCorporates Integration
export {
  searchCompany,
  getCompanyDetails,
  verifyAndEnhanceCompany,
  getCompanyOfficers
} from '../services/opencorporates.js';

// ===========================================
// Risk Analysis
// ===========================================
export { detectRiskyClauses } from '../services/risky-clauses.js';
export { extractAssumptionsAndGaps } from '../services/assumptions.js';

// ===========================================
// Win Probability
// ===========================================
export { calculateWinProbability } from '../services/winprob.js';

// ===========================================
// Feasibility Analysis
// ===========================================
export { computeFeasibility } from '../services/feasibility.js';

// ===========================================
// Session & Memory Management
// ===========================================
export { 
  sessionMemory, 
  newSessionId, 
  normalizeCompanyName,
  resolveCompanyReference 
} from '../services/session-memory.js';

export {
  saveRfpAndChunks,
  getRfp,
  getAllRfps,
  searchChunks,
  appendConversation,
  getConversation,
  clearConversation
} from '../services/rfpMemory.js';

// ===========================================
// Data Enrichment
// ===========================================
export { default as dataEnrichmentService } from '../services/data-enrichment.js';

// ===========================================
// Reminders
// ===========================================
export { 
  scheduleReminder, 
  buildICS, 
  startReminderDaemon, 
  getReminders 
} from '../services/reminders.js';

// ===========================================
// Database
// ===========================================
export { default as db } from '../db/index.js';

// ===========================================
// Configuration
// ===========================================
export { default as config, AI_CONFIG, SERVER_CONFIG, PATHS, validateConfig } from '../configs/settings.js';











