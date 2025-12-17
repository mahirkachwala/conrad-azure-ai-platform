/**
 * Assumptions & Clarifications Auto-Detector
 * Scans RFP text for missing/unclear critical information
 */

export function extractAssumptionsAndGaps(rfpText = '', rfpData = {}) {
  const gaps = [];
  const assumptions = [];
  const text = rfpText.toLowerCase();
  
  // Check for EMD (Earnest Money Deposit)
  if (!/(emd|earnest money|bid security|tender fee)/i.test(rfpText)) {
    gaps.push('EMD/Bid Security amount not specified');
    assumptions.push('Assuming standard 2% EMD of contract value');
  }
  
  // Check for payment terms
  if (!/payment (terms|schedule|milestone)|within \d+ days|net \d+/i.test(rfpText)) {
    gaps.push('Payment terms not clearly specified');
    assumptions.push('Assuming standard NET 30 payment terms');
  }
  
  // Check for warranty/guarantee
  if (!/warranty|guarantee|defect liability/i.test(rfpText)) {
    gaps.push('Warranty/Guarantee period not mentioned');
    assumptions.push('Assuming industry-standard 12-month warranty');
  }
  
  // Check for delivery timeline
  if (!/delivery|lead time|days from (po|purchase order)|weeks from award/i.test(rfpText)) {
    gaps.push('Delivery timeline/lead time not specified');
    assumptions.push('Assuming 60-90 days from PO');
  }
  
  // Check for installation/commissioning
  if (text.includes('transformer') || text.includes('switchgear')) {
    if (!/installation|commissioning|testing|erection/i.test(rfpText)) {
      gaps.push('Installation/Commissioning scope unclear');
      assumptions.push('Assuming supply-only basis (no installation)');
    }
  }
  
  // Check for technical standards (use stricter patterns to avoid false matches)
  if (!/(IS[\s:-]\d+|IEC[\s:-]\d+|ANSI[\s:-]|IEEE[\s:-]\d+|as per (IS|IEC|ANSI|IEEE)|conforming to (IS|IEC|ANSI|IEEE))/i.test(rfpText)) {
    gaps.push('Technical standards/specifications not referenced');
    assumptions.push('Assuming IS/IEC standards as applicable');
  }
  
  // Check for inspection/testing
  if (!/(factory|acceptance|routine|type) test/i.test(rfpText)) {
    gaps.push('Testing requirements not detailed');
    assumptions.push('Assuming routine tests as per applicable standards');
  }
  
  // Check for penalties/liquidated damages
  if (!/penalty|liquidated damages|ld clause/i.test(rfpText)) {
    gaps.push('Penalty/LD clause not mentioned');
    assumptions.push('Assuming no penalty or standard 0.5% per week LD');
  }
  
  return {
    gaps_identified: gaps,
    assumptions_made: assumptions,
    clarifications_needed: gaps.length > 0,
    risk_level: gaps.length >= 5 ? 'HIGH' : gaps.length >= 3 ? 'MEDIUM' : 'LOW'
  };
}
