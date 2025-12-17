/**
 * Adaptive Email & Calendar Service
 * Learns email templates, calendar patterns, and user preferences
 * 
 * Features:
 * - Learns email templates from previous compositions
 * - Adapts calendar reminder timing based on user behavior
 * - Generates contextual email content based on RFP/tender data
 * - Integrates with Gmail and Google Calendar
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Knowledge storage paths
const EMAIL_KNOWLEDGE_PATH = path.join(__dirname, '../data/email_knowledge.json');
const CALENDAR_KNOWLEDGE_PATH = path.join(__dirname, '../data/calendar_knowledge.json');

// Default email templates by context
const DEFAULT_EMAIL_TEMPLATES = {
  tender_inquiry: {
    subject: 'Inquiry regarding {tender_id} - {tender_title}',
    body: `Dear {organisation} Team,

I am writing to express our interest in the tender {tender_id} - {tender_title}.

We would like to request additional information regarding:
- Technical specifications and requirements
- Submission guidelines and format
- Clarification on evaluation criteria

The deadline for this tender is {due_date}. We look forward to your response at your earliest convenience.

Best regards,
{sender_name}
{sender_company}
{sender_email}`
  },
  bid_submission: {
    subject: 'Bid Submission for {tender_id} - {tender_title}',
    body: `Dear {organisation},

Please find attached our bid submission for:

Tender Reference: {tender_id}
Title: {tender_title}
Submission Date: {current_date}

Our bid includes:
1. Technical Proposal
2. Commercial Proposal
3. Company Credentials
4. Required Certifications

Total Bid Value: {bid_value}

We confirm that this bid is valid for 90 days from the submission date.

Thank you for the opportunity.

Best regards,
{sender_name}
{sender_company}`
  },
  meeting_request: {
    subject: 'Meeting Request - {tender_id} Pre-Bid Discussion',
    body: `Dear {contact_name},

We would like to request a meeting to discuss the requirements for {tender_id}.

Proposed Meeting Details:
- Purpose: Pre-bid discussion and clarification
- Preferred Dates: {preferred_dates}
- Duration: 30-60 minutes
- Mode: Video call / In-person

Please let us know your availability.

Best regards,
{sender_name}`
  },
  counter_offer: {
    subject: 'Counter Offer - {tender_id}',
    body: `Dear {organisation},

Thank you for sharing the tender {tender_id}.

After careful analysis, we would like to propose the following:

Original Price: {original_price}
Our Counter Offer: {counter_price}
Discount: {discount_percentage}%

This offer is valid until {validity_date}.

We believe this represents excellent value while maintaining quality standards.

Best regards,
{sender_name}`
  },
  testing_quote_request: {
    subject: 'Request for Testing Quote - {tender_id}',
    body: `Dear Testing Lab Team,

We require testing services for our cable products for tender {tender_id}.

Testing Requirements:
{testing_requirements}

Cable Details:
- Type: {cable_type}
- Voltage: {voltage}
- Size: {size}

Please provide:
1. Testing quotation
2. Timeline
3. Available dates for sample submission

Best regards,
{sender_name}
{sender_company}`
  }
};

// Calendar reminder patterns
const DEFAULT_CALENDAR_PATTERNS = {
  tender_deadline: {
    title: 'DEADLINE: {tender_id} Submission',
    reminder_days_before: [7, 3, 1],
    description: 'Tender submission deadline for {tender_id} - {tender_title}\nOrganisation: {organisation}\nEstimated Value: {value}'
  },
  pre_bid_meeting: {
    title: 'Pre-Bid Meeting: {tender_id}',
    reminder_days_before: [3, 1],
    description: 'Pre-bid meeting for {tender_id}\nVenue: {venue}\nPrepare: Technical queries'
  },
  document_preparation: {
    title: 'Prepare Documents: {tender_id}',
    reminder_days_before: [5, 2],
    description: 'Prepare bid documents for {tender_id}\nChecklist:\n- Technical proposal\n- Commercial bid\n- Certificates'
  },
  follow_up: {
    title: 'Follow-up: {tender_id}',
    reminder_days_before: [14],
    description: 'Follow up on submitted bid for {tender_id}\nContact: {contact_email}'
  }
};

// Email knowledge state
let emailKnowledge = {
  templates: {},
  customTemplates: [],
  sentEmails: [],
  preferredStyle: 'formal',
  signature: '',
  lastUpdated: null
};

// Calendar knowledge state
let calendarKnowledge = {
  patterns: {},
  reminderPreferences: {},
  createdEvents: [],
  lastUpdated: null
};

/**
 * Initialize the adaptive email/calendar system
 */
export async function initAdaptiveEmailCalendar() {
  console.log('📧 Initializing Adaptive Email/Calendar System...');
  
  // Load existing knowledge
  loadEmailKnowledge();
  loadCalendarKnowledge();
  
  // Merge defaults with learned patterns
  emailKnowledge.templates = { ...DEFAULT_EMAIL_TEMPLATES, ...emailKnowledge.templates };
  calendarKnowledge.patterns = { ...DEFAULT_CALENDAR_PATTERNS, ...calendarKnowledge.patterns };
  
  console.log(`   ✓ Loaded ${Object.keys(emailKnowledge.templates).length} email templates`);
  console.log(`   ✓ Loaded ${Object.keys(calendarKnowledge.patterns).length} calendar patterns`);
  console.log('✅ Adaptive Email/Calendar System initialized');
  
  return true;
}

/**
 * Load email knowledge from file
 */
function loadEmailKnowledge() {
  try {
    if (fs.existsSync(EMAIL_KNOWLEDGE_PATH)) {
      emailKnowledge = JSON.parse(fs.readFileSync(EMAIL_KNOWLEDGE_PATH, 'utf-8'));
    }
  } catch (e) {
    console.warn('   ⚠️ Could not load email knowledge:', e.message);
  }
}

/**
 * Load calendar knowledge from file
 */
function loadCalendarKnowledge() {
  try {
    if (fs.existsSync(CALENDAR_KNOWLEDGE_PATH)) {
      calendarKnowledge = JSON.parse(fs.readFileSync(CALENDAR_KNOWLEDGE_PATH, 'utf-8'));
    }
  } catch (e) {
    console.warn('   ⚠️ Could not load calendar knowledge:', e.message);
  }
}

/**
 * Save email knowledge
 */
function saveEmailKnowledge() {
  emailKnowledge.lastUpdated = new Date().toISOString();
  fs.writeFileSync(EMAIL_KNOWLEDGE_PATH, JSON.stringify(emailKnowledge, null, 2));
}

/**
 * Save calendar knowledge
 */
function saveCalendarKnowledge() {
  calendarKnowledge.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CALENDAR_KNOWLEDGE_PATH, JSON.stringify(calendarKnowledge, null, 2));
}

/**
 * Generate adaptive email content
 * @param {string} type - Email type (tender_inquiry, bid_submission, etc.)
 * @param {object} data - Data to fill template
 * @returns {object} - { subject, body, to }
 */
export function generateEmail(type, data) {
  const template = emailKnowledge.templates[type] || emailKnowledge.templates.tender_inquiry;
  
  let subject = template.subject;
  let body = template.body;
  
  // Replace all placeholders
  for (const [key, value] of Object.entries(data)) {
    const placeholder = new RegExp(`{${key}}`, 'g');
    subject = subject.replace(placeholder, value || '');
    body = body.replace(placeholder, value || '');
  }
  
  // Add signature if configured
  if (emailKnowledge.signature) {
    body += '\n\n' + emailKnowledge.signature;
  }
  
  return {
    subject,
    body,
    to: data.contact_email || data.email || '',
    type,
    generated_at: new Date().toISOString()
  };
}

/**
 * Generate Gmail compose URL
 */
export function generateGmailUrl(emailData) {
  const { to, subject, body } = emailData;
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  const encodedTo = encodeURIComponent(to);
  
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedTo}&su=${encodedSubject}&body=${encodedBody}`;
}

/**
 * Learn from a sent email to improve templates
 */
export function learnFromEmail(emailType, emailContent) {
  emailKnowledge.sentEmails.push({
    type: emailType,
    content: emailContent,
    timestamp: new Date().toISOString()
  });
  
  // Keep last 100 emails for learning
  if (emailKnowledge.sentEmails.length > 100) {
    emailKnowledge.sentEmails = emailKnowledge.sentEmails.slice(-100);
  }
  
  saveEmailKnowledge();
  
  return { success: true, message: 'Email pattern learned' };
}

/**
 * Create a custom email template
 */
export function createCustomTemplate(name, subject, body) {
  emailKnowledge.templates[name] = { subject, body };
  emailKnowledge.customTemplates.push(name);
  saveEmailKnowledge();
  
  return { success: true, templateName: name };
}

/**
 * Generate calendar event for tender
 * @param {string} type - Event type
 * @param {object} tenderData - Tender/RFP data
 * @returns {object} - Calendar event details with Google Calendar URL
 */
export function generateCalendarEvent(type, tenderData) {
  const pattern = calendarKnowledge.patterns[type] || calendarKnowledge.patterns.tender_deadline;
  
  let title = pattern.title;
  let description = pattern.description;
  
  // Replace placeholders
  for (const [key, value] of Object.entries(tenderData)) {
    const placeholder = new RegExp(`{${key}}`, 'g');
    title = title.replace(placeholder, value || '');
    description = description.replace(placeholder, value || '');
  }
  
  // Calculate event date based on deadline
  const deadline = tenderData.due_date ? new Date(tenderData.due_date) : new Date();
  const reminderDays = pattern.reminder_days_before[0] || 3;
  const eventDate = new Date(deadline.getTime() - reminderDays * 24 * 60 * 60 * 1000);
  
  // Create Google Calendar URL
  const gcalUrl = createGoogleCalendarUrl(title, description, eventDate);
  
  return {
    title,
    description,
    eventDate: eventDate.toISOString(),
    deadline: deadline.toISOString(),
    reminderDays: pattern.reminder_days_before,
    googleCalendarUrl: gcalUrl,
    type
  };
}

/**
 * Create Google Calendar URL
 */
function createGoogleCalendarUrl(title, description, startDate) {
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour event
  
  const formatDate = (d) => d.toISOString().replace(/-|:|\.\d+/g, '');
  
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${formatDate(startDate)}/${formatDate(endDate)}`,
    details: description
  });
  
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Learn from calendar event feedback
 */
export function learnFromCalendarFeedback(eventType, feedback) {
  calendarKnowledge.createdEvents.push({
    type: eventType,
    feedback,
    timestamp: new Date().toISOString()
  });
  
  // Adjust reminder timing based on feedback
  if (feedback.reminderTooEarly) {
    const pattern = calendarKnowledge.patterns[eventType];
    if (pattern) {
      pattern.reminder_days_before = pattern.reminder_days_before.map(d => Math.max(1, d - 1));
    }
  } else if (feedback.reminderTooLate) {
    const pattern = calendarKnowledge.patterns[eventType];
    if (pattern) {
      pattern.reminder_days_before = pattern.reminder_days_before.map(d => d + 1);
    }
  }
  
  saveCalendarKnowledge();
  
  return { success: true, message: 'Calendar preference updated' };
}

/**
 * Get all email templates
 */
export function getEmailTemplates() {
  return {
    templates: Object.keys(emailKnowledge.templates),
    customTemplates: emailKnowledge.customTemplates,
    totalSent: emailKnowledge.sentEmails.length
  };
}

/**
 * Get calendar patterns
 */
export function getCalendarPatterns() {
  return {
    patterns: Object.keys(calendarKnowledge.patterns),
    totalEvents: calendarKnowledge.createdEvents.length
  };
}

/**
 * Get system status
 */
export function getEmailCalendarStatus() {
  return {
    email: {
      templates: Object.keys(emailKnowledge.templates).length,
      customTemplates: emailKnowledge.customTemplates.length,
      sentCount: emailKnowledge.sentEmails.length,
      lastUpdated: emailKnowledge.lastUpdated
    },
    calendar: {
      patterns: Object.keys(calendarKnowledge.patterns).length,
      eventsCreated: calendarKnowledge.createdEvents.length,
      lastUpdated: calendarKnowledge.lastUpdated
    }
  };
}

export default {
  initAdaptiveEmailCalendar,
  generateEmail,
  generateGmailUrl,
  learnFromEmail,
  createCustomTemplate,
  generateCalendarEvent,
  learnFromCalendarFeedback,
  getEmailTemplates,
  getCalendarPatterns,
  getEmailCalendarStatus
};



