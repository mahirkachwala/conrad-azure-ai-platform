/**
 * Risky Clause Detector
 * Scans RFP text for problematic contract terms that increase bid risk
 */

export function detectRiskyClauses(rfpText = '') {
  const hits = [];
  const text = rfpText.toLowerCase();
  
  const rules = [
    {
      key: 'High Liquidated Damages',
      pattern: /liquidated\s+damages.*?(\d{1,2})\s?%/i,
      risk: 'HIGH',
      description: 'LD penalty exceeds standard threshold',
      validator: (match) => {
        const percentage = parseInt(match[1], 10);
        return percentage > 10; // Only flag if LD > 10%
      }
    },
    {
      key: 'No Advance Payment',
      pattern: /no\s+advance\s+payment|zero\s+advance|100%\s+on\s+delivery/i,
      risk: 'HIGH',
      description: 'No upfront payment creates cash flow risk'
    },
    {
      key: 'All-Risk Warranty',
      pattern: /all-?risk\s+warranty|comprehensive\s+warranty.*all\s+risks/i,
      risk: 'MEDIUM',
      description: 'Warranty covers risks beyond manufacturer control'
    },
    {
      key: 'Fixed Arbitration Venue',
      pattern: /arbitration.*?(only|exclusively|shall be).*?(mumbai|delhi|bangalore|chennai|kolkata)/i,
      risk: 'MEDIUM',
      description: 'Arbitration restricted to specific city (may increase costs)'
    },
    {
      key: 'Performance Bank Guarantee',
      pattern: /performance.*?bank\s+guarantee.*?(\d{1,2})%|pbg.*?(\d{1,2})%/i,
      risk: 'MEDIUM',
      description: 'PBG requirement ties up working capital'
    },
    {
      key: 'Unlimited Liability',
      pattern: /unlimited\s+liability|no\s+cap\s+on\s+liability/i,
      risk: 'HIGH',
      description: 'Uncapped liability exposure'
    },
    {
      key: 'Buyer Inspection Required',
      pattern: /buyer.*?inspection.*?mandatory|pre-?dispatch.*?inspection.*?buyer/i,
      risk: 'LOW',
      description: 'Buyer inspection may delay delivery timeline'
    },
    {
      key: 'Single Source Requirement',
      pattern: /single\s+source|sole\s+vendor|oem\s+only/i,
      risk: 'MEDIUM',
      description: 'Restricts product sourcing flexibility'
    }
  ];
  
  for (const rule of rules) {
    const match = rfpText.match(rule.pattern);
    if (match) {
      // Apply validator if present (e.g., for percentage thresholds)
      if (rule.validator && !rule.validator(match)) {
        continue; // Skip if validation fails
      }
      
      const startIdx = Math.max(match.index - 60, 0);
      const endIdx = Math.min(match.index + 120, rfpText.length);
      const snippet = rfpText.slice(startIdx, endIdx).replace(/\s+/g, ' ').trim();
      
      hits.push({
        key: rule.key,
        snippet: snippet,
        risk: rule.risk,
        description: rule.description,
        matchedValue: match[1] || match[2] || null
      });
    }
  }
  
  const highRiskCount = hits.filter(h => h.risk === 'HIGH').length;
  const mediumRiskCount = hits.filter(h => h.risk === 'MEDIUM').length;
  
  // Determine overall risk level
  let overallRisk = 'NONE';
  if (highRiskCount >= 1) {
    overallRisk = 'HIGH'; // Even one HIGH risk clause makes overall risk HIGH
  } else if (mediumRiskCount >= 2 || hits.length >= 3) {
    overallRisk = 'MEDIUM'; // Multiple medium risks or many total risks
  } else if (hits.length > 0) {
    overallRisk = 'LOW'; // Few low/medium risks
  }
  
  return {
    risky_clauses: hits,
    risk_count: hits.length,
    high_risk_count: highRiskCount,
    medium_risk_count: mediumRiskCount,
    overall_risk: overallRisk
  };
}
