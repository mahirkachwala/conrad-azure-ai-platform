/**
 * Interactive Drafts Service
 * Allows users to preview and modify emails, calendar events, and documents
 * before proceeding with the actual action
 * 
 * Features:
 * - Store draft state for emails, calendar, PDFs
 * - Natural language modification of drafts
 * - Learning from user modifications
 * - Adaptive template refinement
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Draft storage
const drafts = new Map();

// Modification patterns learned from user feedback
let modificationPatterns = {
  email: [],
  calendar: [],
  document: []
};

const PATTERNS_PATH = path.join(__dirname, '../data/modification_patterns.json');

// Load learned patterns
function loadPatterns() {
  try {
    if (fs.existsSync(PATTERNS_PATH)) {
      modificationPatterns = JSON.parse(fs.readFileSync(PATTERNS_PATH, 'utf-8'));
    }
  } catch (e) {
    console.warn('Could not load modification patterns');
  }
}

// Save learned patterns
function savePatterns() {
  fs.writeFileSync(PATTERNS_PATH, JSON.stringify(modificationPatterns, null, 2));
}

// Initialize
loadPatterns();

/**
 * Create a draft for preview
 * @param {string} sessionId - User session ID
 * @param {string} type - Type: 'email', 'calendar', 'document', 'testing_request'
 * @param {object} data - Draft data
 * @returns {object} - Draft ID and preview
 */
export function createDraft(sessionId, type, data) {
  const draftId = `draft-${type}-${Date.now()}`;
  
  const draft = {
    id: draftId,
    sessionId,
    type,
    data,
    originalData: { ...data },
    modifications: [],
    status: 'preview',
    createdAt: new Date().toISOString(),
    modifiedAt: null
  };
  
  drafts.set(draftId, draft);
  
  // Store reference in session
  const sessionDrafts = drafts.get(`session-${sessionId}`) || {};
  sessionDrafts[type] = draftId;
  drafts.set(`session-${sessionId}`, sessionDrafts);
  
  return {
    draftId,
    preview: generatePreview(type, data),
    type,
    canModify: true,
    instructions: getModificationInstructions(type)
  };
}

/**
 * Generate human-readable preview
 */
function generatePreview(type, data) {
  switch (type) {
    case 'email':
      return {
        heading: '📧 Email Draft Preview',
        sections: [
          { label: 'To', value: data.to || 'Not specified', editable: true, field: 'to' },
          { label: 'Subject', value: data.subject || 'No subject', editable: true, field: 'subject' },
          { label: 'Body', value: data.body || '', editable: true, field: 'body', multiline: true }
        ],
        actions: ['Proceed to Gmail', 'Make Changes', 'Cancel']
      };
      
    case 'calendar':
      return {
        heading: '📅 Calendar Event Preview',
        sections: [
          { label: 'Title', value: data.title || 'Event', editable: true, field: 'title' },
          { label: 'Date', value: formatDate(data.date), editable: true, field: 'date' },
          { label: 'Time', value: data.time || 'All day', editable: true, field: 'time' },
          { label: 'Reminder', value: `${data.reminderDays || 1} day(s) before`, editable: true, field: 'reminderDays' },
          { label: 'Notes', value: data.description || '', editable: true, field: 'description', multiline: true }
        ],
        actions: ['Add to Google Calendar', 'Make Changes', 'Cancel']
      };
      
    case 'document':
      return {
        heading: '📄 Document Generation Preview',
        sections: [
          { label: 'Document Type', value: data.documentType || 'Bid Document', editable: false },
          { label: 'Company', value: data.company || 'Your Company', editable: true, field: 'company' },
          { label: 'Reference', value: data.reference || 'Auto-generated', editable: true, field: 'reference' },
          { label: 'Content Sections', value: (data.sections || ['Overview', 'Specifications', 'Pricing', 'Terms']).join(', '), editable: false }
        ],
        actions: ['Generate PDF', 'Make Changes', 'Cancel']
      };
      
    case 'testing_request':
      return {
        heading: '🧪 Testing Quote Request Preview',
        sections: [
          { label: 'Lab Email', value: data.labEmail || 'testing@lab.com', editable: true, field: 'labEmail' },
          { label: 'Subject', value: data.subject || 'Testing Quote Request', editable: true, field: 'subject' },
          { label: 'Cable Type', value: data.cableType || 'HT Cable', editable: true, field: 'cableType' },
          { label: 'Tests Required', value: (data.tests || ['Type Test', 'Routine Test']).join(', '), editable: true, field: 'tests' },
          { label: 'Quantity', value: data.quantity || '1 sample', editable: true, field: 'quantity' }
        ],
        actions: ['Send Request', 'Make Changes', 'Cancel']
      };
      
    case 'quotation':
      return {
        heading: '💰 Quotation Preview',
        sections: [
          { label: 'Material Cost', value: formatCurrency(data.materialCost), editable: false },
          { label: 'Testing Cost', value: formatCurrency(data.testingCost), editable: false },
          { label: 'Profit Margin', value: `${data.profitMargin || 15}%`, editable: true, field: 'profitMargin' },
          { label: 'GST (18%)', value: formatCurrency(data.gst), editable: false },
          { label: 'Grand Total', value: formatCurrency(data.grandTotal), editable: false, highlight: true }
        ],
        actions: ['Generate Quotation', 'Adjust Margins', 'Cancel']
      };
      
    default:
      return { heading: 'Preview', sections: [], actions: ['Proceed', 'Cancel'] };
  }
}

/**
 * Get modification instructions for each type
 */
function getModificationInstructions(type) {
  const instructions = {
    email: [
      'Say "change the subject to [new subject]"',
      'Say "add [text] to the body"',
      'Say "change recipient to [email]"',
      'Say "make it more formal/casual"',
      'Say "proceed" to send'
    ],
    calendar: [
      'Say "change the date to [date]"',
      'Say "set reminder for [X] days before"',
      'Say "change title to [new title]"',
      'Say "add note: [your note]"',
      'Say "proceed" to add to calendar'
    ],
    document: [
      'Say "change company name to [name]"',
      'Say "add section for [section name]"',
      'Say "change reference to [ref]"',
      'Say "proceed" to generate PDF'
    ],
    testing_request: [
      'Say "add [test name] test"',
      'Say "remove [test name]"',
      'Say "change quantity to [qty]"',
      'Say "proceed" to send request'
    ],
    quotation: [
      'Say "change profit margin to [X]%"',
      'Say "add discount of [X]%"',
      'Say "proceed" to generate'
    ]
  };
  
  return instructions[type] || ['Say "proceed" to continue'];
}

/**
 * Apply natural language modification to draft
 * @param {string} draftId - Draft ID
 * @param {string} instruction - Natural language instruction
 * @returns {object} - Updated preview
 */
export function modifyDraft(draftId, instruction) {
  const draft = drafts.get(draftId);
  if (!draft) {
    return { error: 'Draft not found', success: false };
  }
  
  const lowerInstruction = instruction.toLowerCase();
  const modifications = parseModification(lowerInstruction, draft.type);
  
  // Apply modifications
  for (const mod of modifications) {
    if (mod.field && mod.value !== undefined) {
      draft.data[mod.field] = mod.value;
    } else if (mod.action === 'append' && mod.field) {
      draft.data[mod.field] = (draft.data[mod.field] || '') + '\n' + mod.value;
    } else if (mod.action === 'style' && mod.style) {
      draft.data = applyStyle(draft.data, mod.style, draft.type);
    }
  }
  
  // Record modification for learning
  draft.modifications.push({
    instruction,
    modifications,
    timestamp: new Date().toISOString()
  });
  draft.modifiedAt = new Date().toISOString();
  
  // Learn from this modification
  learnFromModification(draft.type, instruction, modifications);
  
  drafts.set(draftId, draft);
  
  return {
    success: true,
    draftId,
    preview: generatePreview(draft.type, draft.data),
    message: `Applied changes: ${modifications.map(m => m.description).join(', ')}`
  };
}

/**
 * Parse natural language modification instruction
 */
function parseModification(instruction, type) {
  const modifications = [];
  
  // Common patterns
  
  // "change X to Y"
  const changeMatch = instruction.match(/change\s+(?:the\s+)?(\w+)\s+to\s+(.+)/i);
  if (changeMatch) {
    const field = mapFieldName(changeMatch[1], type);
    modifications.push({
      field,
      value: changeMatch[2].trim(),
      description: `Changed ${changeMatch[1]} to "${changeMatch[2].trim()}"`
    });
  }
  
  // "set X to Y"
  const setMatch = instruction.match(/set\s+(?:the\s+)?(\w+)\s+(?:to|as|for)\s+(.+)/i);
  if (setMatch) {
    const field = mapFieldName(setMatch[1], type);
    modifications.push({
      field,
      value: parseValue(setMatch[2].trim(), field),
      description: `Set ${setMatch[1]} to "${setMatch[2].trim()}"`
    });
  }
  
  // "add X to body/notes"
  const addMatch = instruction.match(/add\s+(.+?)\s+to\s+(?:the\s+)?(\w+)/i);
  if (addMatch) {
    const field = mapFieldName(addMatch[2], type);
    modifications.push({
      action: 'append',
      field,
      value: addMatch[1].trim(),
      description: `Added to ${addMatch[2]}`
    });
  }
  
  // "make it more formal/casual"
  const styleMatch = instruction.match(/make\s+(?:it\s+)?(?:more\s+)?(\w+)/i);
  if (styleMatch && ['formal', 'casual', 'brief', 'detailed'].includes(styleMatch[1].toLowerCase())) {
    modifications.push({
      action: 'style',
      style: styleMatch[1].toLowerCase(),
      description: `Made more ${styleMatch[1]}`
    });
  }
  
  // "remove X"
  const removeMatch = instruction.match(/remove\s+(.+)/i);
  if (removeMatch) {
    const field = mapFieldName(removeMatch[1], type);
    if (Array.isArray(drafts.get(field))) {
      modifications.push({
        action: 'remove',
        field,
        value: removeMatch[1].trim(),
        description: `Removed ${removeMatch[1]}`
      });
    }
  }
  
  // Date changes
  const dateMatch = instruction.match(/(?:change|set)\s+(?:the\s+)?date\s+to\s+(.+)/i);
  if (dateMatch) {
    modifications.push({
      field: 'date',
      value: parseDate(dateMatch[1]),
      description: `Changed date to ${dateMatch[1]}`
    });
  }
  
  // Reminder days
  const reminderMatch = instruction.match(/(?:set\s+)?reminder\s+(?:for\s+)?(\d+)\s+days?\s+before/i);
  if (reminderMatch) {
    modifications.push({
      field: 'reminderDays',
      value: parseInt(reminderMatch[1]),
      description: `Set reminder ${reminderMatch[1]} days before`
    });
  }
  
  // Profit margin
  const profitMatch = instruction.match(/(?:change\s+)?(?:profit\s+)?margin\s+to\s+(\d+)\s*%?/i);
  if (profitMatch) {
    modifications.push({
      field: 'profitMargin',
      value: parseInt(profitMatch[1]),
      description: `Changed profit margin to ${profitMatch[1]}%`
    });
  }
  
  // Discount
  const discountMatch = instruction.match(/add\s+(?:a\s+)?discount\s+of\s+(\d+)\s*%/i);
  if (discountMatch) {
    modifications.push({
      field: 'discount',
      value: parseInt(discountMatch[1]),
      description: `Added ${discountMatch[1]}% discount`
    });
  }
  
  return modifications;
}

/**
 * Map user field name to actual field
 */
function mapFieldName(userField, type) {
  const fieldMaps = {
    'subject': 'subject',
    'title': 'title',
    'body': 'body',
    'content': 'body',
    'message': 'body',
    'recipient': 'to',
    'to': 'to',
    'email': 'to',
    'date': 'date',
    'time': 'time',
    'notes': 'description',
    'description': 'description',
    'reminder': 'reminderDays',
    'company': 'company',
    'reference': 'reference',
    'ref': 'reference',
    'margin': 'profitMargin',
    'profit': 'profitMargin',
    'quantity': 'quantity',
    'qty': 'quantity'
  };
  
  return fieldMaps[userField.toLowerCase()] || userField.toLowerCase();
}

/**
 * Parse value based on field type
 */
function parseValue(value, field) {
  if (['reminderDays', 'profitMargin', 'discount', 'quantity'].includes(field)) {
    const num = parseInt(value.replace(/[^\d]/g, ''));
    return isNaN(num) ? value : num;
  }
  return value;
}

/**
 * Parse date from natural language
 */
function parseDate(dateStr) {
  const lowerDate = dateStr.toLowerCase();
  const today = new Date();
  
  if (lowerDate.includes('tomorrow')) {
    today.setDate(today.getDate() + 1);
    return today.toISOString().split('T')[0];
  }
  if (lowerDate.includes('next week')) {
    today.setDate(today.getDate() + 7);
    return today.toISOString().split('T')[0];
  }
  if (lowerDate.includes('next month')) {
    today.setMonth(today.getMonth() + 1);
    return today.toISOString().split('T')[0];
  }
  
  // Try to parse as date
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  
  return dateStr;
}

/**
 * Apply style transformation
 */
function applyStyle(data, style, type) {
  if (type === 'email' && data.body) {
    switch (style) {
      case 'formal':
        data.body = data.body
          .replace(/hi\b/gi, 'Dear Sir/Madam')
          .replace(/thanks/gi, 'Thank you')
          .replace(/asap/gi, 'at your earliest convenience');
        break;
      case 'casual':
        data.body = data.body
          .replace(/Dear Sir\/Madam/gi, 'Hi')
          .replace(/Thank you for your/gi, 'Thanks for your');
        break;
      case 'brief':
        // Keep first paragraph only
        data.body = data.body.split('\n\n')[0];
        break;
    }
  }
  return data;
}

/**
 * Learn from user modification for future suggestions
 */
function learnFromModification(type, instruction, modifications) {
  modificationPatterns[type] = modificationPatterns[type] || [];
  modificationPatterns[type].push({
    instruction,
    modifications,
    timestamp: new Date().toISOString()
  });
  
  // Keep only last 100 patterns per type
  if (modificationPatterns[type].length > 100) {
    modificationPatterns[type] = modificationPatterns[type].slice(-100);
  }
  
  savePatterns();
}

/**
 * Finalize draft and get action URL/data
 * @param {string} draftId - Draft ID
 * @returns {object} - Final action data
 */
export function finalizeDraft(draftId) {
  const draft = drafts.get(draftId);
  if (!draft) {
    return { error: 'Draft not found', success: false };
  }
  
  draft.status = 'finalized';
  drafts.set(draftId, draft);
  
  // Generate final action based on type
  switch (draft.type) {
    case 'email':
    case 'testing_request':
      const gmailUrl = generateGmailUrl(draft.data);
      return {
        success: true,
        action: 'redirect',
        url: gmailUrl,
        message: 'Opening Gmail compose...',
        data: draft.data
      };
      
    case 'calendar':
      const calendarUrl = generateCalendarUrl(draft.data);
      return {
        success: true,
        action: 'redirect',
        url: calendarUrl,
        message: 'Opening Google Calendar...',
        data: draft.data
      };
      
    case 'document':
    case 'quotation':
      return {
        success: true,
        action: 'generate',
        endpoint: `/api/generate-pdf?data=${encodeURIComponent(JSON.stringify(draft.data))}`,
        message: 'Generating document...',
        data: draft.data
      };
      
    default:
      return { success: true, data: draft.data };
  }
}

/**
 * Get draft by ID
 */
export function getDraft(draftId) {
  return drafts.get(draftId);
}

/**
 * Get current draft for session and type
 */
export function getSessionDraft(sessionId, type) {
  const sessionDrafts = drafts.get(`session-${sessionId}`) || {};
  const draftId = sessionDrafts[type];
  return draftId ? drafts.get(draftId) : null;
}

/**
 * Generate Gmail compose URL
 */
function generateGmailUrl(data) {
  const to = encodeURIComponent(data.to || data.labEmail || '');
  const subject = encodeURIComponent(data.subject || '');
  const body = encodeURIComponent(data.body || '');
  
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`;
}

/**
 * Generate Google Calendar URL
 */
function generateCalendarUrl(data) {
  const formatDate = (d) => new Date(d).toISOString().replace(/-|:|\.\d+/g, '');
  
  const startDate = new Date(data.date || Date.now());
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: data.title || 'Event',
    dates: `${formatDate(startDate)}/${formatDate(endDate)}`,
    details: data.description || ''
  });
  
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Format date for display
 */
function formatDate(date) {
  if (!date) return 'Not set';
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

/**
 * Format currency
 */
function formatCurrency(amount) {
  if (!amount && amount !== 0) return '₹0';
  return '₹' + Number(amount).toLocaleString('en-IN');
}

/**
 * Cancel and delete draft
 */
export function cancelDraft(draftId) {
  const draft = drafts.get(draftId);
  if (draft) {
    draft.status = 'cancelled';
    drafts.delete(draftId);
    return { success: true, message: 'Draft cancelled' };
  }
  return { success: false, error: 'Draft not found' };
}

export default {
  createDraft,
  modifyDraft,
  finalizeDraft,
  getDraft,
  getSessionDraft,
  cancelDraft
};



