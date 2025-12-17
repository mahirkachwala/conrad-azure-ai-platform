/**
 * Submission Agent
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Handles 4 different RFP submission workflows:
 * 1. EMAIL_FORM - Fill form inside PDF and email to specific address
 * 2. LETTER_COURIER - Write letter and courier to physical address
 * 3. EXTERNAL_PORTAL - Register on separate portal
 * 4. MEETING_EMAIL - Email to schedule meeting
 * 
 * Generates appropriate response artefacts for each mode
 */

import { SUBMISSION_MODES } from '../../services/pdf-parser.js';

/**
 * Submission Agent - Processes RFP and generates submission artefacts
 */
export class SubmissionAgent {
  constructor() {
    this.name = 'Submission Agent';
    this.role = 'Generates bid submission artefacts based on RFP requirements';
  }

  /**
   * Process RFP and generate submission plan
   * @param {Object} rfpSummary - Extracted RFP summary
   * @param {Object} technicalMatch - Technical agent output (SKU matching)
   * @param {Object} pricingTable - Pricing agent output
   * @param {Object} bidderInfo - Bidding company information
   * @returns {Object} Submission plan with artefacts
   */
  async processSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo = {}) {
    const submissionMode = rfpSummary.submission?.mode || this.detectSubmissionMode(rfpSummary);
    
    const baseResult = {
      rfp_id: rfpSummary.rfp_id,
      buyer_name: rfpSummary.buyer_name,
      submission_mode: submissionMode,
      due_date: rfpSummary.due_date,
      bidder: bidderInfo.name || 'Opal Cables Pvt. Ltd.',
      generated_at: new Date().toISOString()
    };

    switch (submissionMode) {
      case SUBMISSION_MODES.EMAIL_FORM:
        return this.generateEmailFormSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo, baseResult);
      
      case SUBMISSION_MODES.LETTER_COURIER:
        return this.generateLetterCourierSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo, baseResult);
      
      case SUBMISSION_MODES.EXTERNAL_PORTAL:
        return this.generatePortalSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo, baseResult);
      
      case SUBMISSION_MODES.MEETING_EMAIL:
        return this.generateMeetingEmailSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo, baseResult);
      
      default:
        return this.generateGenericSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo, baseResult);
    }
  }

  /**
   * Detect submission mode from RFP if not explicitly set
   */
  detectSubmissionMode(rfpSummary) {
    const submission = rfpSummary.submission || {};
    
    if (submission.email_to && submission.form_annexure) {
      return SUBMISSION_MODES.EMAIL_FORM;
    }
    if (submission.postal_address) {
      return SUBMISSION_MODES.LETTER_COURIER;
    }
    if (submission.portal_url) {
      return SUBMISSION_MODES.EXTERNAL_PORTAL;
    }
    if (submission.meeting_email) {
      return SUBMISSION_MODES.MEETING_EMAIL;
    }
    
    // Default to email form if we have any email
    if (submission.email_to || rfpSummary.contact_email) {
      return SUBMISSION_MODES.EMAIL_FORM;
    }
    
    return SUBMISSION_MODES.EMAIL_FORM; // Default fallback
  }

  /**
   * MODE 1: EMAIL_FORM - Fill form and email
   */
  generateEmailFormSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo, baseResult) {
    const emailTo = rfpSummary.submission?.email_to || rfpSummary.contact_email || 'tenders@example.com';
    const formAnnexure = rfpSummary.submission?.form_annexure || 'Annexure-B';
    
    // Generate filled form data
    const formData = this.generateBidResponseForm(rfpSummary, technicalMatch, pricingTable, bidderInfo);
    
    // Generate email draft
    const emailDraft = this.generateSubmissionEmail(rfpSummary, bidderInfo, 'FORM_SUBMISSION');
    
    return {
      ...baseResult,
      mode_description: 'Fill the bid response form and email to the specified address',
      actions: [
        {
          step: 1,
          action: 'FILL_FORM',
          description: `Fill ${formAnnexure} (Bid Response Form) with the data provided below`,
          status: 'AUTO_GENERATED'
        },
        {
          step: 2,
          action: 'ATTACH_DOCUMENTS',
          description: 'Attach technical compliance sheet and price schedule',
          status: 'PENDING'
        },
        {
          step: 3,
          action: 'COMPOSE_EMAIL',
          description: `Send email to ${emailTo}`,
          status: 'DRAFT_READY'
        },
        {
          step: 4,
          action: 'SUBMIT_BEFORE',
          description: `Submit before ${rfpSummary.due_date}`,
          status: 'PENDING'
        }
      ],
      artefacts: {
        form_data: formData,
        email_draft: emailDraft,
        email_to: emailTo,
        email_subject: rfpSummary.submission?.email_subject_template || 
          `Bid Submission - ${rfpSummary.rfp_id} - ${bidderInfo.name || 'Opal Cables Pvt. Ltd.'}`,
        form_annexure: formAnnexure
      },
      gmail_compose_url: this.generateGmailComposeUrl(
        emailTo,
        `Bid Submission - ${rfpSummary.rfp_id}`,
        emailDraft.body
      ),
      requires_print: false,
      requires_courier: false
    };
  }

  /**
   * MODE 2: LETTER_COURIER - Physical letter submission
   */
  generateLetterCourierSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo, baseResult) {
    const postalAddress = rfpSummary.submission?.postal_address || 
      `${rfpSummary.buyer_name}, ${rfpSummary.location || 'India'}`;
    
    // Generate formal letter
    const letterContent = this.generateFormalLetter(rfpSummary, technicalMatch, pricingTable, bidderInfo);
    
    return {
      ...baseResult,
      mode_description: 'Print the bid letter and courier to the specified physical address',
      actions: [
        {
          step: 1,
          action: 'PRINT_LETTER',
          description: 'Print the formal bid letter on company letterhead',
          status: 'LETTER_READY'
        },
        {
          step: 2,
          action: 'PREPARE_ANNEXURES',
          description: 'Print and attach technical specifications and price schedule',
          status: 'PENDING'
        },
        {
          step: 3,
          action: 'SEAL_ENVELOPE',
          description: 'Seal in envelope marked "TENDER - CONFIDENTIAL"',
          status: 'PENDING'
        },
        {
          step: 4,
          action: 'COURIER_DISPATCH',
          description: `Courier to: ${postalAddress}`,
          status: 'PENDING'
        },
        {
          step: 5,
          action: 'DELIVERY_BEFORE',
          description: `Must reach before ${rfpSummary.due_date}`,
          status: 'PENDING'
        }
      ],
      artefacts: {
        letter_content: letterContent,
        postal_address: postalAddress,
        annexures: [
          { name: 'Technical Compliance Statement', status: 'TO_GENERATE' },
          { name: 'Price Schedule', status: 'TO_GENERATE' },
          { name: 'Company Registration Documents', status: 'TO_ATTACH' },
          { name: 'Past Performance Certificates', status: 'TO_ATTACH' }
        ]
      },
      requires_print: true,
      requires_courier: true,
      courier_warning: '⚠️ This document must be PRINTED and COURIERED physically. Digital submission is NOT accepted.'
    };
  }

  /**
   * MODE 3: EXTERNAL_PORTAL - Register on vendor portal
   */
  generatePortalSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo, baseResult) {
    const portalUrl = rfpSummary.submission?.portal_url || 'https://vendor.example.com';
    
    // Generate registration checklist
    const registrationData = this.generatePortalRegistrationData(bidderInfo);
    
    return {
      ...baseResult,
      mode_description: 'Register on the vendor portal and submit bid online',
      actions: [
        {
          step: 1,
          action: 'VISIT_PORTAL',
          description: `Navigate to ${portalUrl}`,
          status: 'PENDING',
          url: portalUrl
        },
        {
          step: 2,
          action: 'REGISTER_VENDOR',
          description: 'Complete vendor registration with company details',
          status: 'DATA_READY'
        },
        {
          step: 3,
          action: 'COMPLETE_KYC',
          description: 'Upload KYC documents (PAN, GST, Bank Details)',
          status: 'PENDING'
        },
        {
          step: 4,
          action: 'LOCATE_TENDER',
          description: `Find ${rfpSummary.rfp_id} under "Open Tenders" section`,
          status: 'PENDING'
        },
        {
          step: 5,
          action: 'UPLOAD_TECHNICAL',
          description: 'Upload technical compliance document',
          status: 'TO_GENERATE'
        },
        {
          step: 6,
          action: 'UPLOAD_COMMERCIAL',
          description: 'Upload price schedule/BOQ',
          status: 'TO_GENERATE'
        },
        {
          step: 7,
          action: 'SUBMIT_BID',
          description: `Submit bid before ${rfpSummary.due_date}`,
          status: 'PENDING'
        }
      ],
      artefacts: {
        portal_url: portalUrl,
        registration_data: registrationData,
        documents_to_upload: [
          { name: 'Company PAN Card', format: 'PDF', status: 'TO_ATTACH' },
          { name: 'GST Registration', format: 'PDF', status: 'TO_ATTACH' },
          { name: 'Bank Account Details', format: 'PDF', status: 'TO_ATTACH' },
          { name: 'Technical Compliance', format: 'PDF', status: 'TO_GENERATE' },
          { name: 'Price Schedule', format: 'XLSX', status: 'TO_GENERATE' }
        ]
      },
      requires_print: false,
      requires_courier: false,
      portal_note: '🌐 This tender requires online portal submission. Ensure you register well before the deadline.'
    };
  }

  /**
   * MODE 4: MEETING_EMAIL - Schedule pre-bid meeting
   */
  generateMeetingEmailSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo, baseResult) {
    const meetingEmail = rfpSummary.submission?.meeting_email || rfpSummary.contact_email || 'prebid@example.com';
    
    // Generate meeting request email
    const meetingEmailDraft = this.generateMeetingRequestEmail(rfpSummary, bidderInfo);
    
    return {
      ...baseResult,
      mode_description: 'Request a pre-bid meeting slot before formal bid submission',
      actions: [
        {
          step: 1,
          action: 'SEND_MEETING_REQUEST',
          description: `Email ${meetingEmail} to request pre-bid meeting slot`,
          status: 'EMAIL_READY'
        },
        {
          step: 2,
          action: 'AWAIT_CONFIRMATION',
          description: 'Wait for meeting slot confirmation',
          status: 'PENDING'
        },
        {
          step: 3,
          action: 'ATTEND_MEETING',
          description: 'Attend pre-bid meeting (virtual/in-person)',
          status: 'PENDING'
        },
        {
          step: 4,
          action: 'RECEIVE_INSTRUCTIONS',
          description: 'Receive detailed bid submission instructions during meeting',
          status: 'PENDING'
        },
        {
          step: 5,
          action: 'SUBMIT_BID',
          description: 'Submit bid as per instructions received',
          status: 'PENDING'
        }
      ],
      artefacts: {
        meeting_email: meetingEmail,
        email_draft: meetingEmailDraft,
        email_subject: `Pre-bid Meeting Request - ${rfpSummary.rfp_id} - ${bidderInfo.name || 'Opal Cables Pvt. Ltd.'}`,
        company_intro: this.generateCompanyIntro(bidderInfo)
      },
      gmail_compose_url: this.generateGmailComposeUrl(
        meetingEmail,
        `Pre-bid Meeting Request - ${rfpSummary.rfp_id}`,
        meetingEmailDraft.body
      ),
      requires_print: false,
      requires_courier: false,
      meeting_note: '📅 A pre-bid meeting is required before formal submission. Request early to secure a slot.'
    };
  }

  /**
   * Generic submission fallback
   */
  generateGenericSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo, baseResult) {
    return {
      ...baseResult,
      mode_description: 'Generic bid submission process',
      actions: [
        {
          step: 1,
          action: 'PREPARE_BID',
          description: 'Prepare technical and commercial bid documents',
          status: 'PENDING'
        },
        {
          step: 2,
          action: 'CONTACT_BUYER',
          description: `Contact ${rfpSummary.contact_email || rfpSummary.buyer_name} for submission instructions`,
          status: 'PENDING'
        },
        {
          step: 3,
          action: 'SUBMIT_BID',
          description: `Submit before ${rfpSummary.due_date}`,
          status: 'PENDING'
        }
      ],
      requires_print: false,
      requires_courier: false
    };
  }

  // ============================================
  // ARTEFACT GENERATORS
  // ============================================

  /**
   * Generate bid response form data
   */
  generateBidResponseForm(rfpSummary, technicalMatch, pricingTable, bidderInfo) {
    const topMatch = technicalMatch?.top_3?.[0] || {};
    
    return {
      section_a_bidder_info: {
        company_name: bidderInfo.name || 'Opal Cables Pvt. Ltd.',
        registered_address: bidderInfo.address || '123 Industrial Area, Mumbai - 400001',
        gst_number: bidderInfo.gst || '27AABCO1234A1Z5',
        pan_number: bidderInfo.pan || 'AABCO1234A',
        contact_person: bidderInfo.contact_person || 'Mr. Procurement Manager',
        contact_email: bidderInfo.email || 'procurement@opalcables.com',
        contact_phone: bidderInfo.phone || '+91-22-12345678'
      },
      section_b_technical_offer: {
        rfp_reference: rfpSummary.rfp_id,
        item_description: rfpSummary.scope?.[0]?.description || rfpSummary.project_name,
        offered_product: topMatch.product_name || 'As per RFP specifications',
        sku_code: topMatch.sku_id || 'N/A',
        spec_match_percentage: topMatch.spec_match?.percentage || 'N/A',
        compliance_statement: 'We confirm full compliance with all technical specifications',
        deviations: topMatch.spec_match?.deviations || 'None'
      },
      section_c_commercial_offer: {
        unit_price: pricingTable?.unit_price || rfpSummary.estimated_value,
        quantity: rfpSummary.scope?.[0]?.quantity_km || 'As per RFP',
        total_price: pricingTable?.total_price || rfpSummary.estimated_value,
        gst_applicable: '18%',
        delivery_period: '60 days from PO',
        payment_terms: 'As per RFP terms',
        validity: '120 days'
      },
      section_d_declarations: {
        blacklisting: 'We declare that we are not blacklisted by any Government department',
        litigation: 'No pending litigation against the company',
        authorized_signatory: bidderInfo.authorized_signatory || 'Managing Director'
      }
    };
  }

  /**
   * Generate submission email
   */
  generateSubmissionEmail(rfpSummary, bidderInfo, type = 'FORM_SUBMISSION') {
    const companyName = bidderInfo.name || 'Opal Cables Pvt. Ltd.';
    
    return {
      to: rfpSummary.submission?.email_to || rfpSummary.contact_email,
      subject: `Bid Submission - ${rfpSummary.rfp_id} - ${companyName}`,
      body: `Dear Sir/Madam,

Subject: Bid Submission for ${rfpSummary.rfp_id} - ${rfpSummary.project_name || rfpSummary.title}

We, ${companyName}, are pleased to submit our bid for the above-referenced tender.

TENDER DETAILS:
- Tender Reference: ${rfpSummary.rfp_id}
- Project: ${rfpSummary.project_name || rfpSummary.title || 'As per NIT'}
- Buyer: ${rfpSummary.buyer_name}
- Due Date: ${rfpSummary.due_date}

SUBMISSION CONTENTS:
1. Completed Bid Response Form (${rfpSummary.submission?.form_annexure || 'Annexure-B'})
2. Technical Compliance Statement
3. Price Schedule
4. Company Registration Documents

We confirm that:
- All information provided is accurate and complete
- We have read and accepted all terms and conditions
- Our bid is valid for 120 days from the submission date

We look forward to the opportunity to serve your organization.

Best regards,
${bidderInfo.contact_person || 'Procurement Team'}
${companyName}
${bidderInfo.phone || '+91-22-12345678'}
${bidderInfo.email || 'procurement@opalcables.com'}`
    };
  }

  /**
   * Generate formal letter for courier submission
   */
  generateFormalLetter(rfpSummary, technicalMatch, pricingTable, bidderInfo) {
    const companyName = bidderInfo.name || 'Opal Cables Pvt. Ltd.';
    const today = new Date().toLocaleDateString('en-IN', { 
      day: '2-digit', month: 'long', year: 'numeric' 
    });
    
    return {
      letterhead: {
        company_name: companyName,
        address: bidderInfo.address || '123 Industrial Area, Phase II, Mumbai - 400001',
        phone: bidderInfo.phone || '+91-22-12345678',
        email: bidderInfo.email || 'info@opalcables.com',
        website: bidderInfo.website || 'www.opalcables.com',
        gst: bidderInfo.gst || '27AABCO1234A1Z5'
      },
      date: today,
      reference: `REF: ${rfpSummary.rfp_id}/BID/${new Date().getFullYear()}`,
      to: {
        designation: 'The Chief Procurement Officer',
        organization: rfpSummary.buyer_name,
        address: rfpSummary.submission?.postal_address || rfpSummary.location
      },
      subject: `Bid Submission for ${rfpSummary.rfp_id} - ${rfpSummary.project_name || 'Supply of Cables'}`,
      body: `Dear Sir/Madam,

With reference to the above-mentioned tender, we are pleased to submit our sealed bid for your kind consideration.

1. ABOUT US
${companyName} is a leading manufacturer and supplier of electrical cables with over 25 years of experience in the industry. We are an ISO 9001:2015 certified company with state-of-the-art manufacturing facilities.

2. SCOPE OF SUPPLY
As per the tender specifications, we offer to supply:
${rfpSummary.scope?.map(s => `   • ${s.description}`).join('\n') || '   • As per tender specifications'}

3. TECHNICAL COMPLIANCE
We confirm 100% compliance with all technical specifications mentioned in the tender document. Our products are manufactured as per IS 7098 / IEC 60502 standards and are type-tested from NABL accredited laboratories.

4. COMMERCIAL OFFER
Our competitive pricing is enclosed in the sealed commercial envelope. The prices quoted are inclusive of all taxes (except GST) and delivery to your specified location.

5. DELIVERY & WARRANTY
We commit to delivery within 60 days from the date of Purchase Order. Our products carry a warranty of 24 months from the date of commissioning.

6. ENCLOSURES
   i.   Technical Bid (Annexure-A)
   ii.  Commercial Bid (Annexure-B) - Sealed Envelope
   iii. Company Registration Certificate
   iv.  GST Registration
   v.   Past Performance Certificates
   vi.  Type Test Reports

We trust our offer will meet your requirements and look forward to a favorable response.

Thanking you,

Yours faithfully,
For ${companyName}


_______________________
(Authorized Signatory)
${bidderInfo.authorized_signatory || 'Managing Director'}`,
      enclosures: [
        'Technical Bid (Annexure-A)',
        'Commercial Bid (Annexure-B) - Sealed',
        'Company Registration Certificate',
        'GST Registration',
        'Past Performance Certificates',
        'Type Test Reports'
      ]
    };
  }

  /**
   * Generate portal registration data
   */
  generatePortalRegistrationData(bidderInfo) {
    return {
      company_details: {
        legal_name: bidderInfo.name || 'Opal Cables Pvt. Ltd.',
        trading_name: bidderInfo.trading_name || bidderInfo.name || 'Opal Cables',
        company_type: 'Private Limited',
        incorporation_date: bidderInfo.incorporation_date || '1998-05-15',
        cin: bidderInfo.cin || 'U31300MH1998PTC123456'
      },
      tax_details: {
        pan: bidderInfo.pan || 'AABCO1234A',
        gst: bidderInfo.gst || '27AABCO1234A1Z5',
        tan: bidderInfo.tan || 'MUMB12345A'
      },
      bank_details: {
        bank_name: bidderInfo.bank_name || 'State Bank of India',
        branch: bidderInfo.bank_branch || 'Industrial Finance Branch, Mumbai',
        account_number: '********1234',
        ifsc: bidderInfo.ifsc || 'SBIN0001234'
      },
      contact_details: {
        registered_address: bidderInfo.address || '123 Industrial Area, Mumbai - 400001',
        contact_person: bidderInfo.contact_person || 'Mr. Procurement Manager',
        designation: 'Head - Business Development',
        email: bidderInfo.email || 'procurement@opalcables.com',
        phone: bidderInfo.phone || '+91-22-12345678',
        mobile: bidderInfo.mobile || '+91-9876543210'
      },
      certifications: [
        { name: 'ISO 9001:2015', valid_till: '2026-12-31' },
        { name: 'ISO 14001:2015', valid_till: '2026-12-31' },
        { name: 'BIS License', valid_till: '2025-06-30' }
      ]
    };
  }

  /**
   * Generate meeting request email
   */
  generateMeetingRequestEmail(rfpSummary, bidderInfo) {
    const companyName = bidderInfo.name || 'Opal Cables Pvt. Ltd.';
    
    return {
      to: rfpSummary.submission?.meeting_email || rfpSummary.contact_email,
      subject: `Pre-bid Meeting Request - ${rfpSummary.rfp_id} - ${companyName}`,
      body: `Dear Sir/Madam,

Subject: Request for Pre-bid Meeting - ${rfpSummary.rfp_id}

We, ${companyName}, are interested in participating in the tender ${rfpSummary.rfp_id} for "${rfpSummary.project_name || rfpSummary.title}".

We kindly request you to allot us a slot for the pre-bid meeting to discuss the technical requirements and clarify any queries.

COMPANY PROFILE:
- Company Name: ${companyName}
- Industry: Electrical Cables & Wires Manufacturing
- Experience: 25+ years
- Certifications: ISO 9001:2015, BIS Licensed
- Annual Turnover: ₹100+ Crores

CONTACT DETAILS:
- Contact Person: ${bidderInfo.contact_person || 'Mr. Procurement Manager'}
- Email: ${bidderInfo.email || 'procurement@opalcables.com'}
- Phone: ${bidderInfo.phone || '+91-22-12345678'}

We are available for the meeting at your convenience, either virtually or at your office premises.

Looking forward to your response.

Best regards,
${bidderInfo.contact_person || 'Procurement Team'}
${companyName}`
    };
  }

  /**
   * Generate company introduction
   */
  generateCompanyIntro(bidderInfo) {
    return {
      name: bidderInfo.name || 'Opal Cables Pvt. Ltd.',
      tagline: 'Leading Manufacturer of Electrical Cables & Wires',
      established: '1998',
      headquarters: 'Mumbai, India',
      employees: '500+',
      annual_turnover: '₹100+ Crores',
      manufacturing_capacity: '10,000 MT/year',
      certifications: ['ISO 9001:2015', 'ISO 14001:2015', 'BIS Licensed', 'NABL Accredited Lab'],
      key_clients: ['State Electricity Boards', 'Power Grid Corporation', 'L&T', 'Tata Projects'],
      product_range: ['LT Power Cables', 'HT Cables', 'Control Cables', 'Instrumentation Cables']
    };
  }

  /**
   * Generate Gmail compose URL
   */
  generateGmailComposeUrl(to, subject, body) {
    const encodedTo = encodeURIComponent(to);
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body);
    
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedTo}&su=${encodedSubject}&body=${encodedBody}`;
  }
}

// Export singleton instance
const submissionAgent = new SubmissionAgent();

export async function processRFPSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo) {
  return submissionAgent.processSubmission(rfpSummary, technicalMatch, pricingTable, bidderInfo);
}

export default submissionAgent;





