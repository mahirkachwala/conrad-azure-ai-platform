import crypto from 'crypto';

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 500;

class SessionMemory {
  constructor() {
    this.store = new Map();
  }

  _prune() {
    const now = Date.now();
    for (const [key, value] of this.store) {
      if (now - value.timestamp > TTL_MS) {
        this.store.delete(key);
      }
    }
    while (this.store.size > MAX_SESSIONS) {
      const firstKey = this.store.keys().next().value;
      this.store.delete(firstKey);
    }
  }

  _ensure(sessionId) {
    if (!this.store.has(sessionId)) {
      this.store.set(sessionId, {
        timestamp: Date.now(),
        data: {}
      });
    }
    return this.store.get(sessionId);
  }

  get(sessionId) {
    this._prune();
    const session = this.store.get(sessionId);
    return session ? session.data : {};
  }

  set(sessionId, data) {
    this._prune();
    const session = this._ensure(sessionId);
    session.timestamp = Date.now();
    session.data = { ...session.data, ...data };
  }

  update(sessionId, key, value) {
    this._prune();
    const session = this._ensure(sessionId);
    session.timestamp = Date.now();
    session.data[key] = value;
  }

  clear(sessionId) {
    this.store.delete(sessionId);
  }

  has(sessionId) {
    this._prune();
    return this.store.has(sessionId);
  }
}

export const sessionMemory = new SessionMemory();

export function normalizeCompanyName(name = '') {
  if (!name) return '';
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.&()/-]/g, '')
    .toUpperCase();
}

export function newSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

export function resolveCompanyReference(sessionId, queryCompany) {
  console.log('resolveCompanyReference called with:', queryCompany);
  
  // Check if it's a contextual phrase (referring to previous company)
  const contextualPhrases = [
    'this company', 'that company', 'same company', 'the company',
    'by this', 'by that', 'from this', 'from that',
    'their tenders', 'its tenders', 'company tenders',
    'tenders by this', 'tenders from this', 'tenders by the', 'tenders from the'
  ];
  
  const isContextualPhrase = queryCompany && contextualPhrases.some(p => 
    queryCompany.toLowerCase().includes(p)
  );
  
  const contextualPattern = /^(same|this|that|their|the|its)\s*(company|buyer|org|organisation|organization|vendor|supplier)?$/i;
  const isContextualWord = queryCompany && contextualPattern.test(queryCompany.trim());
  
  // If it's a contextual reference, use session memory
  if (isContextualPhrase || isContextualWord || !queryCompany || queryCompany === 'undefined' || queryCompany === 'null') {
    const context = sessionMemory.get(sessionId);
    console.log('Resolving company from context:', context);
    
    if (context && context.companyName) {
      console.log('Using company from context:', context.companyName);
      return {
        companyName: context.companyName,
        normalized: normalizeCompanyName(context.companyName),
        source: 'context',
        contextInfo: {
          lastUploadedFile: context.lastUploadedFileName,
          uploadTime: context.uploadTime
        }
      };
    }
    
    // No context available
    console.log('No company found in context');
    return {
      companyName: null,
      normalized: null,
      source: 'none'
    };
  }
  
  // If we have a valid company name (not contextual), use it directly
  if (queryCompany && queryCompany.trim().length > 2) {
    console.log('Using explicit company name:', queryCompany);
    return {
      companyName: queryCompany,
      normalized: normalizeCompanyName(queryCompany),
      source: 'explicit'
    };
  }
  
  // Fallback - no context available
  console.log('No company found');
  return {
    companyName: null,
    normalized: null,
    source: 'none'
  };
}
