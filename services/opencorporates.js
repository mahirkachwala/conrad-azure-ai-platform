import axios from 'axios';

const API_KEY = process.env.OPENCORPORATES_API_KEY;
const BASE_URL = 'https://api.opencorporates.com/v0.4';

/**
 * Search for a company by name
 * @param {string} companyName - Company name to search
 * @param {string} jurisdiction - Optional jurisdiction code (e.g., 'in' for India)
 * @returns {Object} Company search results
 */
export async function searchCompany(companyName, jurisdiction = null) {
  try {
    const params = {
      q: companyName,
      api_token: API_KEY
    };
    
    if (jurisdiction) {
      params.jurisdiction_code = jurisdiction;
    }
    
    const response = await axios.get(`${BASE_URL}/companies/search`, {
      params,
      timeout: 10000
    });
    
    if (response.data?.results?.companies?.length > 0) {
      return {
        success: true,
        companies: response.data.results.companies.map(c => ({
          name: c.company.name,
          jurisdiction: c.company.jurisdiction_code?.toUpperCase(),
          companyNumber: c.company.company_number,
          incorporationDate: c.company.incorporation_date,
          status: c.company.current_status || 'Unknown',
          companyType: c.company.company_type,
          registeredAddress: c.company.registered_address_in_full,
          opencorporatesUrl: c.company.opencorporates_url
        }))
      };
    }
    
    return {
      success: false,
      error: 'No companies found'
    };
    
  } catch (error) {
    console.error('OpenCorporates API error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get detailed company information
 * @param {string} jurisdiction - Jurisdiction code (e.g., 'in')
 * @param {string} companyNumber - Company registration number
 * @returns {Object} Detailed company information
 */
export async function getCompanyDetails(jurisdiction, companyNumber) {
  try {
    const response = await axios.get(
      `${BASE_URL}/companies/${jurisdiction}/${companyNumber}`,
      {
        params: { api_token: API_KEY },
        timeout: 10000
      }
    );
    
    const company = response.data.results.company;
    
    return {
      success: true,
      company: {
        name: company.name,
        jurisdiction: company.jurisdiction_code?.toUpperCase(),
        companyNumber: company.company_number,
        incorporationDate: company.incorporation_date,
        dissolutionDate: company.dissolution_date,
        status: company.current_status || 'Unknown',
        companyType: company.company_type,
        registeredAddress: company.registered_address_in_full,
        agentName: company.agent_name,
        agentAddress: company.agent_address,
        previousNames: company.previous_names || [],
        alternativeNames: company.alternative_names || [],
        opencorporatesUrl: company.opencorporates_url
      }
    };
    
  } catch (error) {
    console.error('OpenCorporates API error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Calculate company age in years from incorporation date
 */
function calculateCompanyAge(incorporationDate) {
  if (!incorporationDate) return null;
  const incDate = new Date(incorporationDate);
  const now = new Date();
  return Number(((now - incDate) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1));
}

/**
 * Calculate signals-based credibility score with label
 */
function calculateCredibilityScore(signals) {
  const { status, ageYears, hasAddress, hasPreviousNames, isBranch, filingsCount } = signals;
  
  let score = 0;
  
  // Status scoring (most important)
  if ((status || '').toLowerCase() === 'active') {
    score += 40;
  } else {
    score -= 60;
  }
  
  // Age scoring
  if (ageYears != null) {
    if (ageYears > 10) score += 30;
    else if (ageYears >= 3) score += 15;
    else if (ageYears >= 1) score += 5;
    else score -= 25;
  }
  
  // Address presence
  if (hasAddress) score += 5;
  
  // Previous names (potential churn indicator)
  if (hasPreviousNames) score -= 5;
  
  // Branch/subsidiary status
  if (isBranch) score -= 5;
  
  // Filings count (compliance indicator)
  if (typeof filingsCount === 'number') {
    if (filingsCount > 20) score += 15;
    else if (filingsCount >= 5) score += 5;
    else if (filingsCount === 0) score -= 5;
  }
  
  // Determine label
  let label = 'MODERATE';
  if (score >= 60) label = 'WELL_ESTABLISHED';
  else if (score < 30) label = 'RISKY';
  
  return { score, label };
}

/**
 * Verify company with enhanced signals-based scoring
 * @param {string} companyName - Company name to verify
 * @param {Object} existingData - Existing company data from local database
 * @returns {Object} Verified company data with credibility label
 */
export async function verifyAndEnhanceCompany(companyName, existingData = {}) {
  const searchResult = await searchCompany(companyName, 'in');
  
  if (!searchResult.success || searchResult.companies.length === 0) {
    return {
      verified: false,
      message: 'Company not found in OpenCorporates registry',
      existingData
    };
  }
  
  const topMatch = searchResult.companies[0];
  
  let detailData = {};
  try {
    if (topMatch.jurisdiction && topMatch.companyNumber) {
      const details = await getCompanyDetails(
        topMatch.jurisdiction.toLowerCase(),
        topMatch.companyNumber
      );
      if (details.success) {
        detailData = details.company;
      }
    }
  } catch (error) {
    console.log('Could not fetch company details:', error.message);
  }
  
  const status = detailData.status || topMatch.status || '';
  const incorporationDate = detailData.incorporationDate || topMatch.incorporationDate;
  const ageYears = calculateCompanyAge(incorporationDate);
  
  const signals = {
    status,
    ageYears,
    hasAddress: Boolean(detailData.registeredAddress || topMatch.registeredAddress),
    hasPreviousNames: Array.isArray(detailData.previousNames) && detailData.previousNames.length > 0,
    isBranch: Boolean(detailData.branch),
    filingsCount: null
  };
  
  const { score, label } = calculateCredibilityScore(signals);
  
  const baseScore = existingData.credibility_score || 5.0;
  const enhancedScore = Math.min(baseScore + (score / 10), 10.0);
  
  return {
    verified: true,
    verification: {
      name: topMatch.name,
      status: status,
      jurisdiction: topMatch.jurisdiction,
      incorporationDate: incorporationDate,
      companyAge: ageYears,
      companyType: topMatch.companyType,
      registeredAddress: detailData.registeredAddress || topMatch.registeredAddress,
      opencorporatesUrl: topMatch.opencorporatesUrl
    },
    signals,
    rawScore: score,
    credibilityLabel: label,
    enhancedCredibility: parseFloat(enhancedScore.toFixed(1)),
    originalCredibility: baseScore,
    credibilityBoost: parseFloat((enhancedScore - baseScore).toFixed(1))
  };
}

/**
 * Get company officers/directors
 * @param {string} jurisdiction - Jurisdiction code
 * @param {string} companyNumber - Company registration number
 * @returns {Object} List of company officers
 */
export async function getCompanyOfficers(jurisdiction, companyNumber) {
  try {
    const response = await axios.get(
      `${BASE_URL}/companies/${jurisdiction}/${companyNumber}/officers`,
      {
        params: { api_token: API_KEY },
        timeout: 10000
      }
    );
    
    const officers = response.data.results.officers || [];
    
    return {
      success: true,
      officers: officers.map(o => ({
        name: o.officer.name,
        position: o.officer.position,
        startDate: o.officer.start_date,
        endDate: o.officer.end_date,
        occupation: o.officer.occupation,
        address: o.officer.address
      }))
    };
    
  } catch (error) {
    console.error('OpenCorporates API error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}
