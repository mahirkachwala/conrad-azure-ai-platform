/**
 * AI-Powered Email Modifier
 * Uses Gemini + OpenAI fallback to intelligently modify email drafts
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Multi-provider setup
const geminiKey = process.env.GEMINI_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

console.log(`📧 Email Modifier: Gemini ${geminiKey ? '✅' : '❌'} | OpenAI ${openaiKey ? '✅' : '❌'}`);

/**
 * Generate with multi-provider fallback
 */
async function generateWithFallback(prompt) {
  const errors = [];
  
  // Try Gemini first
  if (genAI) {
    try {
      console.log('   🤖 Trying Gemini...');
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      console.log('   ✅ Gemini success');
      return response.text();
    } catch (error) {
      console.warn('   ⚠️ Gemini failed:', error.message);
      errors.push(`Gemini: ${error.message}`);
    }
  }
  
  // Try OpenAI fallback
  if (openai) {
    try {
      console.log('   🤖 Trying OpenAI...');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.3
      });
      console.log('   ✅ OpenAI success');
      return response.choices[0]?.message?.content || '';
    } catch (error) {
      console.warn('   ⚠️ OpenAI failed:', error.message);
      errors.push(`OpenAI: ${error.message}`);
    }
  }
  
  throw new Error(`All AI providers failed: ${errors.join('; ')}`);
}

// System prompt for email modification
const EMAIL_MODIFIER_PROMPT = `You are an expert business email writer specializing in B2B communications, tender submissions, and professional correspondence in the cable and power equipment industry.

Your task is to modify an existing email draft based on the user's instructions.

IMPORTANT RULES:
1. Only modify what the user asks - preserve other content
2. Maintain professional tone unless explicitly asked to change it
3. Keep the email structure intact (greeting, body, closing, signature)
4. If asked to "make it more formal/polite/professional", enhance the language appropriately
5. If asked to mention a person, add them contextually in a natural way
6. If asked to change a specific part, only change that part
7. Preserve all factual information (tender IDs, dates, company details) unless asked to change them
8. Return ONLY the modified email text, no explanations or comments

TONE MODIFICATIONS:
- "more formal": Use formal business language, honorifics, structured sentences
- "more polite": Add courteous phrases, express gratitude, softer language
- "more casual/informal": Conversational tone while maintaining professionalism
- "more urgent": Add urgency indicators, emphasize deadlines
- "more concise": Shorten sentences, remove redundancy
- "more detailed": Expand explanations, add context

OUTPUT FORMAT:
Return the complete modified email in this exact format:
---EMAIL_START---
[Subject line if modified, or original]
---
[Complete email body]
---EMAIL_END---`;

/**
 * Modify email using AI
 * @param {object} currentEmail - Current email draft {to, subject, body}
 * @param {string} instruction - User's modification instruction
 * @param {object} context - Additional context (tender details, company info)
 * @returns {object} Modified email {to, subject, body, changes}
 */
export async function modifyEmailWithAI(currentEmail, instruction, context = {}) {
  try {
    const prompt = `${EMAIL_MODIFIER_PROMPT}

CURRENT EMAIL:
To: ${currentEmail.to || 'Not specified'}
Subject: ${currentEmail.subject || 'Not specified'}

Body:
${currentEmail.body || ''}

CONTEXT (for reference only):
- Tender ID: ${context.tenderId || 'N/A'}
- Company: ${context.companyName || 'Cable Solutions Pvt Ltd'}
- Contact Person: ${context.contactPerson || 'Rajesh Kumar'}

USER'S MODIFICATION REQUEST:
"${instruction}"

Now modify the email according to the user's request. Return ONLY the modified email in the specified format.`;

    // Use multi-provider fallback (Gemini -> OpenAI)
    const text = await generateWithFallback(prompt);
    
    // Parse the response
    const emailMatch = text.match(/---EMAIL_START---([\s\S]*?)---EMAIL_END---/);
    
    if (emailMatch) {
      const emailContent = emailMatch[1].trim();
      const parts = emailContent.split('---');
      
      let newSubject = currentEmail.subject;
      let newBody = emailContent;
      
      if (parts.length >= 2) {
        const firstPart = parts[0].trim();
        // Check if first part looks like a subject line
        if (firstPart.length < 200 && !firstPart.includes('\n\n')) {
          newSubject = firstPart;
          newBody = parts.slice(1).join('---').trim();
        }
      }
      
      return {
        success: true,
        to: currentEmail.to,
        subject: newSubject,
        body: newBody,
        changes: detectChanges(currentEmail, { subject: newSubject, body: newBody }),
        instruction: instruction
      };
    }
    
    // Fallback: use the entire response as the new body
    return {
      success: true,
      to: currentEmail.to,
      subject: currentEmail.subject,
      body: text.trim(),
      changes: ['Body modified based on your instructions'],
      instruction: instruction
    };
    
  } catch (error) {
    console.error('[AI Email Modifier] Error:', error.message);
    
    // Check for quota/overload errors
    const errorMsg = error.message || '';
    const isQuotaError = errorMsg.includes('503') || errorMsg.includes('overload') || 
                         errorMsg.includes('UNAVAILABLE') || errorMsg.includes('quota') ||
                         errorMsg.includes('Resource has been exhausted');
    
    return {
      success: false,
      error: isQuotaError 
        ? '503 - Gemini API quota exhausted. Try again tomorrow or use simple field changes.'
        : error.message,
      isQuotaError: isQuotaError,
      to: currentEmail.to,
      subject: currentEmail.subject,
      body: currentEmail.body  // Return original body unchanged
    };
  }
}

/**
 * Detect what changed between original and modified email
 */
function detectChanges(original, modified) {
  const changes = [];
  
  if (original.subject !== modified.subject) {
    changes.push('Subject line modified');
  }
  
  if (original.body !== modified.body) {
    // Detect type of change
    const origLen = (original.body || '').length;
    const newLen = (modified.body || '').length;
    
    if (newLen > origLen * 1.2) {
      changes.push('Content expanded');
    } else if (newLen < origLen * 0.8) {
      changes.push('Content condensed');
    }
    
    // Check for tone changes
    const formalWords = ['hereby', 'kindly', 'respectfully', 'esteemed', 'honored'];
    const newBodyLower = (modified.body || '').toLowerCase();
    const origBodyLower = (original.body || '').toLowerCase();
    
    const formalCountNew = formalWords.filter(w => newBodyLower.includes(w)).length;
    const formalCountOrig = formalWords.filter(w => origBodyLower.includes(w)).length;
    
    if (formalCountNew > formalCountOrig) {
      changes.push('Made more formal');
    }
    
    if (changes.length === 0 || (changes.length === 1 && !changes[0].includes('Subject'))) {
      changes.push('Email body updated');
    }
  }
  
  return changes.length > 0 ? changes : ['No significant changes detected'];
}

/**
 * Quick tone adjustment without full AI call (for simple requests)
 */
export function quickToneAdjust(body, tone) {
  const toneAdjustments = {
    'formal': {
      replacements: [
        [/\bhi\b/gi, 'Dear Sir/Madam'],
        [/\bhello\b/gi, 'Dear Sir/Madam'],
        [/\bthanks\b/gi, 'Thank you'],
        [/\basap\b/gi, 'at your earliest convenience'],
        [/\bplease\b/gi, 'Kindly'],
        [/\bwant\b/gi, 'would like'],
        [/\bneed\b/gi, 'require'],
        [/\bget back to\b/gi, 'respond to'],
      ],
      prefix: '',
      suffix: '\n\nWe remain at your disposal for any further clarification.'
    },
    'polite': {
      replacements: [
        [/\bplease\b/gi, 'Kindly'],
        [/\bwant\b/gi, 'would appreciate'],
      ],
      prefix: 'I hope this message finds you well.\n\n',
      suffix: '\n\nThank you for your time and consideration.'
    },
    'urgent': {
      replacements: [],
      prefix: '**URGENT RESPONSE REQUIRED**\n\n',
      suffix: '\n\nWe kindly request your immediate attention to this matter as the deadline is approaching.'
    },
    'concise': {
      replacements: [
        [/We would like to inform you that /gi, ''],
        [/Please be informed that /gi, ''],
        [/I am writing to /gi, ''],
        [/We are writing to /gi, ''],
      ],
      prefix: '',
      suffix: ''
    }
  };
  
  const adjustment = toneAdjustments[tone];
  if (!adjustment) return body;
  
  let modified = body;
  for (const [pattern, replacement] of adjustment.replacements) {
    modified = modified.replace(pattern, replacement);
  }
  
  return adjustment.prefix + modified + adjustment.suffix;
}

/**
 * Generate email from scratch based on context and intent
 */
export async function generateEmail(intent, context) {
  try {
    const intentPrompts = {
      'inquiry': 'Write a professional inquiry email',
      'follow_up': 'Write a polite follow-up email',
      'quotation': 'Write a quotation submission email',
      'meeting_request': 'Write a meeting request email',
      'counter_offer': 'Write a professional counter-offer/negotiation email'
    };
    
    const prompt = `${intentPrompts[intent] || 'Write a professional business email'} for the following context:

Tender ID: ${context.tenderId || 'N/A'}
Tender Title: ${context.tenderTitle || 'N/A'}
Buyer/Organization: ${context.organization || 'N/A'}
Due Date: ${context.dueDate || 'N/A'}

Our Company: ${context.companyName || 'Cable Solutions Pvt Ltd'}
Contact Person: ${context.contactPerson || 'Rajesh Kumar'}
Designation: ${context.designation || 'Sales Manager'}
Phone: ${context.phone || '+91-124-4567890'}
Email: ${context.email || 'sales@cablesolutions.in'}

Additional Notes: ${context.notes || 'None'}

Write a professional, well-structured email. Include appropriate greeting, clear purpose, relevant details, and professional closing.

Return in this format:
SUBJECT: [subject line]
---
[email body]`;

    // Use multi-provider fallback (Gemini -> OpenAI)
    const text = await generateWithFallback(prompt);
    
    // Parse response
    const subjectMatch = text.match(/SUBJECT:\s*(.+)/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : `Regarding ${context.tenderId || 'Tender Inquiry'}`;
    
    const bodyMatch = text.split('---');
    const body = bodyMatch.length > 1 ? bodyMatch.slice(1).join('---').trim() : text;
    
    return {
      success: true,
      subject,
      body,
      to: context.recipientEmail || ''
    };
    
  } catch (error) {
    console.error('[Generate Email] Error:', error.message);
    return { success: false, error: error.message };
  }
}

export default {
  modifyEmailWithAI,
  quickToneAdjust,
  generateEmail
};

