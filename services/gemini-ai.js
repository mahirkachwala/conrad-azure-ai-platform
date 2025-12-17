import { GoogleGenAI } from '@google/genai';
import { verifyAndEnhanceCompany } from './opencorporates.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function parseUserQuery(userMessage, companiesData = [], conversationContext = null, currentDateTime = null, userLocation = null) {
  const dateTimeInfo = currentDateTime ? `

CURRENT DATE & TIME:
- Today's Date: ${currentDateTime.date}
- Current Time: ${currentDateTime.time}
- Timezone: ${currentDateTime.timezone}

RELATIVE DATE PARSING:
- "3 months from now" → Calculate date 3 months after ${currentDateTime.date}
- "next month" → Calculate next month from ${currentDateTime.date}
- "this month" → Use ${currentDateTime.date}'s month end
- "by end of [month]" → Calculate last day of specified month
- "in 30 days" → Add 30 days to ${currentDateTime.date}
- "closing soon" → Next 7 days from ${currentDateTime.date}` : '';

  const locationInfo = userLocation ? `
  
USER LOCATION:
- City: ${userLocation.city || 'Unknown'}
- State: ${userLocation.state || 'Unknown'}
- Country: ${userLocation.country || 'India'}` : '';

  const systemPrompt = `You are an AI assistant for a tender/RFP search system with 3 portals (Government, Industrial, Utilities).${dateTimeInfo}${locationInfo}

You can handle multiple intents in ONE query:

1. CONVERSATIONAL queries (greetings, questions, general chat)
2. COMPANY_QUESTION queries (asking about a specific company)
3. SEARCH queries (user wants to find/show tenders)
4. COMPANY_COMPARISON queries (comparing two companies)
5. COMPANY_TENDERS queries (show all tenders from a specific company)
6. TENDER_COMPARISON queries (comparing two specific tenders)

${conversationContext ? `
CONVERSATION CONTEXT: 
${conversationContext.lastActivity === 'document_upload' ? `- The user just uploaded a document: "${conversationContext.lastUploadedFileName}"
- The document is from: "${conversationContext.companyName}"
- Tender ID: ${conversationContext.lastUploadedTender}
- If they ask "what company", "which company", "what organization", "company details", "tell me about this company"
- YOU MUST set intentType to "company_question" and companyName to: "${conversationContext.companyName}"` : `- The user was previously discussing: "${conversationContext.companyName}"`}
- If they refer to "this company", "that company", "the company", "same company", "their tenders", "its tenders", "that organization", "this tender", "that document", etc.
- YOU MUST set companyName to: "${conversationContext.companyName}"
- DO NOT leave companyName as null or undefined when user refers to the contextual company!
` : ''}

Respond with JSON:
{
  "intentType": "conversation | search | company_question | multi_intent | company_comparison | company_tenders | tender_comparison",
  "keyword": "extracted keywords for product search - ALWAYS include all search terms here (null if no search)",
  "category": "wires-cables | transformers | fmcg-packaging | null - ONLY set if user explicitly asks for category filtering",
  "city": "Mumbai | Delhi | Bangalore | Chennai | Kolkata | Hyderabad | Pune | Ahmedabad | Nagpur | Jaipur | null",
  "cityStrict": false - set true ONLY if user says 'only in [city]' or 'exclusively in [city]'",
  "portals": ["gov", "industrial", "utilities"] or specific portal(s),
  "wireType": "copper | aluminum | xlpe | pvc | steel | null - include this in keyword too for better matching",
  "minCost": number or null,
  "maxCost": number or null,
  "deadlineBefore": "YYYY-MM-DD or null",
  "conversationalResponse": "friendly natural response",
  "companyName": "exact company name if asking about a specific company, null otherwise",
  "companyName2": "second company name for comparison (null if not comparing)",
  "tenderIds": ["tender_id1", "tender_id2"] for tender comparison (null if not comparing tenders)
}

CRITICAL SEARCH RULES - READ CAREFULLY:
1. ALWAYS set "keyword" with ALL product/item search terms. Example: "copper cables" → keyword: "copper cable"
2. DO NOT set "category" unless user explicitly says "category" or "only [category] tenders"
3. For product searches like "cables", "transformers", "copper wire" → ONLY use keyword, NOT category
4. Only set "wireType" if searching for wire-specific attributes AND include it in keyword too

IGNORE THESE GENERIC WORDS AS KEYWORDS (set keyword to null instead):
- "tenders", "tender", "rfp", "rfps", "bids", "bid", "contracts", "contract"
- "all", "any", "available", "show", "find", "get", "list"
- These are NOT product names! "mumbai tenders" → keyword: null, city: "Mumbai"
- "show all tenders in Delhi" → keyword: null, city: "Delhi"
- "available bids in Pune" → keyword: null, city: "Pune"

CITY EXTRACTION - VERY IMPORTANT:
- "cables in Mumbai" → keyword: "cable", city: "Mumbai"
- "transformers in Delhi" → keyword: "transformer", city: "Delhi"  
- "[product] in [city]" → ALWAYS extract city from "in [city]" pattern
- "[product] at [city]" → ALWAYS extract city
- "[product] for [city]" → ALWAYS extract city
- "[product] near [city]" → ALWAYS extract city
- "Mumbai cables" or "[city] [product]" → ALSO extract city
- City names: Mumbai, Delhi, Bangalore, Chennai, Kolkata, Hyderabad, Pune, Ahmedabad, Nagpur, Jaipur, Lucknow, Coimbatore

CITY STRICTNESS:
- When user EXPLICITLY mentions a city → cityStrict: true (ONLY show that city)
  - "cables in Mumbai" → keyword: "cable", city: "Mumbai", cityStrict: true
  - "mumbai tenders" → keyword: null, city: "Mumbai", cityStrict: true
  - "transformers in Delhi" → keyword: "transformer", city: "Delhi", cityStrict: true
  - "find cables for Bangalore" → keyword: "cable", city: "Bangalore", cityStrict: true
- cityStrict: false ONLY when:
  - User says "prefer Mumbai" or "prioritize Delhi" (soft preference)
  - City is auto-detected from user location (not explicitly stated)
  - User says "show all cities, Mumbai first"

IMPORTANT RULES:
- If user says "this company", "that company", "same company", "the company", "their tenders", "its tenders" → ALWAYS use the company name from CONVERSATION CONTEXT
- If user says "other tenders by same company" → intentType: "company_tenders", companyName: [from context]
- If user says "show tenders from [company]" or "tenders by [company]" → intentType: "company_tenders", set companyName
- If user says "compare [company1] and [company2]" → intentType: "company_comparison", set companyName and companyName2
- If user says "compare tender [id1] and [id2]" → intentType: "tender_comparison", set tenderIds array
- If user asks about company AND wants tenders → intentType: "multi_intent", set both companyName AND search filters
- If user only asks about company → intentType: "company_question", companyName: exact name
- If user only wants tenders → intentType: "search", set search filters

MATERIAL TYPES:
- Wire types: copper (wire/cable), aluminum (wire/cable), XLPE cable, PVC cable, steel wire
- Transformers: power transformer, distribution transformer, step-up, step-down
- Packaging: FMCG packaging, boxes, containers, labels

COST CONVERSIONS:
- 1 lakh = 100,000 (₹1,00,000)
- 1 crore = 10,000,000 (₹1,00,00,000)
- "under 50 lakhs" → maxCost: 5000000
- "between 10-50 lakhs" → minCost: 1000000, maxCost: 5000000
- "above 1 crore" → minCost: 10000000

DATE UNDERSTANDING:
- "this month" → End of current month
- "next 30 days" → Today + 30 days
- "by end of March" → 2025-03-31 (if current year)
- "3 months from now" → Today + 3 months
- "closing soon" → Today + 7 days
- "next month" → End of next month

LOCATION VARIATIONS:
- Understand: "Mumbai", "Bombay" → city: "Mumbai"
- "Bangalore", "Bengaluru" → city: "Bangalore"
- "near me", "my location" → Use userLocation.city

NATURAL LANGUAGE PATTERNS:
- "I need", "looking for", "want to find", "show me", "get me" → intentType: "search"
- "what about", "info on", "details of", "tell me about" → intentType: "company_question" (if company) or "conversation"
- "which is better", "versus", "vs", "or" → intentType: "company_comparison" or "tender_comparison"
- Numbers with units: "50L" = 5000000, "10Cr" = 100000000, "5M" = 5000000

Examples:
"hello" → intentType: "conversation"
"tell me about XYZ Power and their tenders under 10 crores" → intentType: "multi_intent", companyName: "XYZ Power Corporation (Govt PSU)", maxCost: 100000000
"show me tenders by Maharashtra Power" → intentType: "company_tenders", companyName: "Maharashtra State Electricity Board"
"other tenders by same company" (with context) → intentType: "company_tenders", companyName: [use from CONVERSATION CONTEXT]
"their other tenders" (with context) → intentType: "company_tenders", companyName: [use from CONVERSATION CONTEXT]
"compare XYZ Power and State Transmission" → intentType: "company_comparison", companyName: "XYZ Power Corporation (Govt PSU)", companyName2: "State Transmission Utility"
"compare GOV-001 and IND-005" → intentType: "tender_comparison", tenderIds: ["GOV-001", "IND-005"]
"find copper cables closing 3 months from now under 50 lakhs" → intentType: "search", wireType: "copper", deadlineBefore: [3 months from today], maxCost: 5000000
"tenders in my city" → intentType: "search", city: [from userLocation]

Available companies: ${companiesData.map(c => c.name).join(', ')}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            intentType: { type: 'string', enum: ['conversation', 'search', 'company_question', 'multi_intent', 'company_comparison', 'company_tenders', 'tender_comparison'] },
            keyword: { type: 'string', nullable: true },
            category: { type: 'string', nullable: true },
            city: { type: 'string', nullable: true },
            cityStrict: { type: 'boolean', nullable: true },
            portals: { type: 'array', items: { type: 'string' } },
            wireType: { type: 'string', nullable: true },
            minCost: { type: 'number', nullable: true },
            maxCost: { type: 'number', nullable: true },
            deadlineBefore: { type: 'string', nullable: true },
            conversationalResponse: { type: 'string' },
            companyName: { type: 'string', nullable: true },
            companyName2: { type: 'string', nullable: true },
            tenderIds: { type: 'array', items: { type: 'string' }, nullable: true }
          },
          required: ['intentType', 'portals', 'conversationalResponse']
        }
      },
      contents: userMessage
    });

    const result = JSON.parse(response.text);
    return result;
  } catch (error) {
    console.error('Gemini AI error:', error);
    return {
      intentType: 'conversation',
      keyword: null,
      category: null,
      city: null,
      portals: ['gov', 'industrial', 'utilities'],
      wireType: null,
      minCost: null,
      maxCost: null,
      deadlineBefore: null,
      conversationalResponse: "I'm here to help! You can ask me about tenders, companies, or just have a conversation. What would you like to know?",
      companyName: null
    };
  }
}

export async function answerCompanyQuestion(question, companyData, includeVerification = true) {
  if (!companyData) {
    return "I couldn't find information about that company. Please check the company name and try again.";
  }

  let verificationData = null;
  if (includeVerification) {
    try {
      verificationData = await verifyAndEnhanceCompany(companyData.name, companyData);
    } catch (error) {
      console.log('Verification unavailable:', error.message);
    }
  }

  const redFlags = companyData.red_flags?.length > 0 
    ? companyData.red_flags.map(flag => `  • ${flag}`).join('\n') 
    : '  • None';
  
  const greenFlags = companyData.green_flags?.length > 0
    ? companyData.green_flags.map(flag => `  • ${flag}`).join('\n')
    : '  • None';

  const formattedInfo = `
📋 Company Profile: ${companyData.name}

✅ OpenCorporates Verification:
  • Credibility: ${companyData.credibility_label || 'UNKNOWN'} (Score: ${companyData.raw_score || 0}/100)
  • Status: ${companyData.status || 'Unknown'}
  • Jurisdiction: ${companyData.jurisdiction || 'Unknown'}
  • Incorporated: ${companyData.incorporation_date || 'Unknown'}
  • Company Age: ${companyData.age_years || 'Unknown'} years
  • Company Type: ${companyData.company_type || 'Unknown'}
  • Registry Link: ${companyData.oc_url || 'Not available'}

Verification Signals:
  • Has Registered Address: ${companyData.hasAddress ? 'Yes ✓' : 'No'}
  • Has Previous Names: ${companyData.hasPreviousNames ? 'Yes' : 'No'}
  • Is Branch: ${companyData.isBranch ? 'Yes' : 'No'}
  • Number of Filings: ${companyData.filingsCount || 0}

Risk Assessment:
${redFlags}

Green Flags:
${greenFlags}${companyData.oc_url ? '\n\n🔗 View full company details on OpenCorporates: ' + companyData.oc_url : ''}`;

  return { response: formattedInfo, verification: verificationData };
}

export async function compareCompanies(company1Data, company2Data) {
  if (!company1Data || !company2Data) {
    return "I couldn't find one or both companies. Please check the company names and try again.";
  }

  let verify1 = null;
  let verify2 = null;
  
  try {
    verify1 = await verifyAndEnhanceCompany(company1Data.name, company1Data);
  } catch (error) {
    console.log('Verification unavailable for company 1');
  }
  
  try {
    verify2 = await verifyAndEnhanceCompany(company2Data.name, company2Data);
  } catch (error) {
    console.log('Verification unavailable for company 2');
  }

  const score1 = company1Data.raw_score || 0;
  const score2 = company2Data.raw_score || 0;

  const comparison = `
📊 Company Comparison

${company1Data.name} vs ${company2Data.name}

OpenCorporates Verification:
  • ${company1Data.name}: ${company1Data.credibility_label || 'UNKNOWN'} - ${company1Data.status || 'Unknown'} (${company1Data.age_years || 'Unknown'} years old)
  • ${company2Data.name}: ${company2Data.credibility_label || 'UNKNOWN'} - ${company2Data.status || 'Unknown'} (${company2Data.age_years || 'Unknown'} years old)

Credibility Score:
  • ${company1Data.name}: ${score1}/100
  • ${company2Data.name}: ${score2}/100
  ${score1 > score2 ? '✓ Winner: ' + company1Data.name : score1 < score2 ? '✓ Winner: ' + company2Data.name : '✓ Tie'}

Jurisdiction:
  • ${company1Data.name}: ${company1Data.jurisdiction || 'Unknown'}
  • ${company2Data.name}: ${company2Data.jurisdiction || 'Unknown'}

Company Type:
  • ${company1Data.name}: ${company1Data.company_type || 'Unknown'}
  • ${company2Data.name}: ${company2Data.company_type || 'Unknown'}

Verification Signals:
  • ${company1Data.name}: ${company1Data.filingsCount || 0} filings${company1Data.hasAddress ? ', Has Address ✓' : ''}
  • ${company2Data.name}: ${company2Data.filingsCount || 0} filings${company2Data.hasAddress ? ', Has Address ✓' : ''}

Red Flags:
  • ${company1Data.name}: ${company1Data.red_flags?.length || 0} flags
  • ${company2Data.name}: ${company2Data.red_flags?.length || 0} flags

📝 Summary: ${score1 > score2 ? company1Data.name + ' has a higher credibility score (' + company1Data.credibility_label + ') and appears to be the more reliable choice.' : score2 > score1 ? company2Data.name + ' has a higher credibility score (' + company2Data.credibility_label + ') and appears to be the more reliable choice.' : 'Both companies have equal credibility scores. Consider other verification signals and risk factors.'}

🔗 View Details:
  • ${company1Data.name}: ${company1Data.oc_url || 'Not available'}
  • ${company2Data.name}: ${company2Data.oc_url || 'Not available'}`;

  return { response: comparison, verification: { company1: verify1, company2: verify2 } };
}

export async function compareTenders(tender1, tender2, allCompanies) {
  if (!tender1 || !tender2) {
    return "I couldn't find one or both tenders. Please check the tender IDs and try again.";
  }

  const company1 = allCompanies.find(c => 
    c.name.toLowerCase() === tender1.organisation?.toLowerCase() ||
    tender1.organisation?.toLowerCase().includes(c.name.toLowerCase().split('(')[0].trim())
  );
  
  const company2 = allCompanies.find(c => 
    c.name.toLowerCase() === tender2.organisation?.toLowerCase() ||
    tender2.organisation?.toLowerCase().includes(c.name.toLowerCase().split('(')[0].trim())
  );

  const marketValue = (tender1.estimated_cost_inr + tender2.estimated_cost_inr) / 2;
  const variance1 = ((tender1.estimated_cost_inr - marketValue) / marketValue * 100).toFixed(1);
  const variance2 = ((tender2.estimated_cost_inr - marketValue) / marketValue * 100).toFixed(1);

  const comparison = `
⚖️ Tender Comparison

${tender1.tender_id} vs ${tender2.tender_id}

Tender Details:
  • ${tender1.tender_id}: ${tender1.title}
    Organization: ${tender1.organisation}
    Material: ${tender1.material}
    
  • ${tender2.tender_id}: ${tender2.title}
    Organization: ${tender2.organisation}
    Material: ${tender2.material}

Cost Analysis:
  • ${tender1.tender_id}: ₹${tender1.estimated_cost_inr.toLocaleString('en-IN')} (${variance1 > 0 ? '+' : ''}${variance1}% vs market)
  • ${tender2.tender_id}: ₹${tender2.estimated_cost_inr.toLocaleString('en-IN')} (${variance2 > 0 ? '+' : ''}${variance2}% vs market)
  • Market Reference Value: ₹${marketValue.toLocaleString('en-IN')}

Location:
  • ${tender1.tender_id}: ${tender1.city}
  • ${tender2.tender_id}: ${tender2.city}

Deadline:
  • ${tender1.tender_id}: ${new Date(tender1.due_date).toLocaleDateString('en-IN')}
  • ${tender2.tender_id}: ${new Date(tender2.due_date).toLocaleDateString('en-IN')}

Company Credibility (OpenCorporates):
  • ${tender1.organisation}: ${company1 ? company1.credibility_label + ' (' + (company1.raw_score || 0) + '/100)' : 'Not available'}
  • ${tender2.organisation}: ${company2 ? company2.credibility_label + ' (' + (company2.raw_score || 0) + '/100)' : 'Not available'}

💡 Recommendation: ${tender1.estimated_cost_inr < tender2.estimated_cost_inr 
  ? (company1 && company1.raw_score >= 80 
    ? `${tender1.tender_id} offers better value with ${company1.credibility_label || 'verified'} company credibility.`
    : `${tender1.tender_id} is cheaper, but verify company credibility before proceeding.`)
  : (company2 && company2.raw_score >= 80 
    ? `${tender2.tender_id} offers better value with ${company2.credibility_label || 'verified'} company credibility.`
    : `${tender2.tender_id} is cheaper, but verify company credibility before proceeding.`)}`;

  return comparison;
}

export async function generateCounterOffer(tender, marketRate, companyScore) {
  const prompt = `Generate a professional counter offer email for this tender:

Tender: ${tender.title}
Organization: ${tender.organisation}
Tender Cost: ₹${tender.estimated_cost_inr.toLocaleString('en-IN')}
Market Rate: ₹${marketRate.toLocaleString('en-IN')}
Company Credibility Score: ${companyScore}/100

Suggest an optimal counter offer price and write a professional email template.
Response JSON format:
{
  "suggestedPrice": number,
  "discount": number (percentage),
  "emailSubject": "string",
  "emailBody": "professional email text"
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            suggestedPrice: { type: 'number' },
            discount: { type: 'number' },
            emailSubject: { type: 'string' },
            emailBody: { type: 'string' }
          }
        }
      },
      contents: prompt
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error('Counter offer generation error:', error);
    return null;
  }
}
