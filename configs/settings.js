/**
 * Centralized Settings Configuration
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * This module loads all environment variables and provides
 * a single source of truth for configuration across the app.
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from project root
config({ path: path.join(__dirname, '..', '.env') });

// ===========================================
// AI Provider Configuration
// ===========================================
export const AI_CONFIG = {
  provider: process.env.AI_PROVIDER || 'gemini',
  
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    model: 'gemini-2.5-flash',
    proModel: 'gemini-2.5-pro'
  },
  
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  },
  
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.1:8b'
  }
};

// ===========================================
// External API Configuration
// ===========================================
export const EXTERNAL_APIS = {
  openCorporates: {
    apiKey: process.env.OPENCORPORATES_API_KEY || '',
    baseUrl: 'https://api.opencorporates.com/v0.4',
    timeout: 10000
  }
};

// ===========================================
// Server Configuration
// ===========================================
export const SERVER_CONFIG = {
  port: parseInt(process.env.PORT, 10) || 5000,
  host: '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production'
};

// ===========================================
// Feature Flags
// ===========================================
export const FEATURE_FLAGS = {
  enableRealData: process.env.ENABLE_REAL_DATA === 'true',
  enableDebugLogs: process.env.NODE_ENV !== 'production'
};

// ===========================================
// Path Configuration
// ===========================================
export const PATHS = {
  root: path.join(__dirname, '..'),
  data: path.join(__dirname, '..', 'data'),
  public: path.join(__dirname, '..', 'public'),
  publicData: path.join(__dirname, '..', 'public', 'data'),
  uploads: path.join(__dirname, '..', 'uploads'),
  templates: path.join(__dirname, '..', 'templates'),
  fonts: path.join(__dirname, '..', 'fonts')
};

// ===========================================
// Session Configuration
// ===========================================
export const SESSION_CONFIG = {
  ttlMs: 30 * 60 * 1000, // 30 minutes
  maxSessions: 500,
  cookieName: 'sessionId'
};

// ===========================================
// RFP Processing Configuration
// ===========================================
export const RFP_CONFIG = {
  chunkSize: 1500, // Characters per chunk for document storage
  maxUploadSize: 10 * 1024 * 1024, // 10MB
  allowedFileTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ],
  deadlineWindowDays: 90 // Default RFP scanning window
};

// ===========================================
// Pricing & Business Logic
// ===========================================
export const BUSINESS_CONFIG = {
  defaultCurrency: 'INR',
  emdPercentage: 0.02, // 2% EMD
  standardPaymentTerms: 'NET 30',
  warrantyMonths: 12,
  ldPercentagePerWeek: 0.005 // 0.5% LD per week
};

// ===========================================
// Win Probability Weights
// ===========================================
export const WIN_PROB_WEIGHTS = {
  specMatch: 0.45,
  priceCompetitiveness: 0.30,
  credibility: 0.15,
  timeline: 0.10
};

// ===========================================
// Validation Helper
// ===========================================
export function validateConfig() {
  const warnings = [];
  const errors = [];
  
  // Check for required API keys based on provider
  if (AI_CONFIG.provider === 'gemini' && !AI_CONFIG.gemini.apiKey) {
    warnings.push('⚠️  GEMINI_API_KEY not set - AI features will not work');
  }
  
  if (AI_CONFIG.provider === 'openai' && !AI_CONFIG.openai.apiKey) {
    errors.push('❌ OPENAI_API_KEY required when AI_PROVIDER=openai');
  }
  
  if (!EXTERNAL_APIS.openCorporates.apiKey) {
    warnings.push('⚠️  OPENCORPORATES_API_KEY not set - Company verification will use cached data');
  }
  
  return { warnings, errors, isValid: errors.length === 0 };
}

// ===========================================
// Replit Detection
// ===========================================
export const REPLIT_CONFIG = {
  isReplit: !!process.env.REPLIT_DEV_DOMAIN,
  devDomain: process.env.REPLIT_DEV_DOMAIN || null,
  getBaseUrl: () => {
    if (process.env.REPLIT_DEV_DOMAIN) {
      return `https://${process.env.REPLIT_DEV_DOMAIN}`;
    }
    return `http://localhost:${SERVER_CONFIG.port}`;
  }
};

// ===========================================
// Default Export
// ===========================================
export default {
  ai: AI_CONFIG,
  apis: EXTERNAL_APIS,
  server: SERVER_CONFIG,
  features: FEATURE_FLAGS,
  paths: PATHS,
  session: SESSION_CONFIG,
  rfp: RFP_CONFIG,
  business: BUSINESS_CONFIG,
  winProb: WIN_PROB_WEIGHTS,
  replit: REPLIT_CONFIG,
  validate: validateConfig
};











