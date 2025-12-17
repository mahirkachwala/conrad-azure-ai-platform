import axios from 'axios';

const BASE_URL = 'https://api.opencorporates.com/v0.4';
const API_KEY = process.env.OPENCORPORATES_API_KEY || null;

export class OpenCorporatesClient {
  constructor() {
    this.baseURL = BASE_URL;
    this.apiKey = API_KEY;
    this.requestCount = 0;
    this.dailyLimit = API_KEY ? 10000 : 500;
  }

  async searchCompany(companyName, jurisdictionCode = 'in') {
    if (this.requestCount >= this.dailyLimit) {
      console.warn('OpenCorporates daily limit reached, using fallback data');
      return null;
    }

    try {
      const params = {
        q: companyName,
        jurisdiction_code: jurisdictionCode,
        order: 'score'
      };

      if (this.apiKey) {
        params.api_token = this.apiKey;
      }

      const response = await axios.get(`${this.baseURL}/companies/search`, {
        params,
        timeout: 5000
      });

      this.requestCount++;

      if (response.data?.results?.companies?.length > 0) {
        const bestMatch = response.data.results.companies[0];
        return this.normalizeCompanyData(bestMatch.company);
      }

      return null;
    } catch (error) {
      if (error.response?.status === 429) {
        console.warn('OpenCorporates rate limit hit');
      } else if (error.response?.status === 401) {
        console.warn('OpenCorporates API key invalid');
      } else {
        console.warn('OpenCorporates API error:', error.message);
      }
      return null;
    }
  }

  async getCompanyByNumber(companyNumber, jurisdictionCode = 'in') {
    if (this.requestCount >= this.dailyLimit) {
      return null;
    }

    try {
      const params = this.apiKey ? { api_token: this.apiKey } : {};
      
      const response = await axios.get(
        `${this.baseURL}/companies/${jurisdictionCode}/${companyNumber}`,
        { params, timeout: 5000 }
      );

      this.requestCount++;

      if (response.data?.results?.company) {
        return this.normalizeCompanyData(response.data.results.company);
      }

      return null;
    } catch (error) {
      console.warn('OpenCorporates company lookup failed:', error.message);
      return null;
    }
  }

  normalizeCompanyData(rawData) {
    const incorporationDate = rawData.incorporation_date 
      ? new Date(rawData.incorporation_date)
      : null;

    const yearsInOperation = incorporationDate 
      ? new Date().getFullYear() - incorporationDate.getFullYear()
      : null;

    const isActive = rawData.current_status?.toLowerCase() === 'active' ||
                     rawData.current_status?.toLowerCase() === 'live';

    return {
      name: rawData.name,
      companyNumber: rawData.company_number,
      incorporationDate: rawData.incorporation_date,
      yearsInOperation,
      status: rawData.current_status,
      isActive,
      jurisdictionCode: rawData.jurisdiction_code,
      registeredAddress: rawData.registered_address_in_full,
      companyType: rawData.company_type,
      officers: rawData.officers || [],
      source: 'opencorporates',
      dataFreshness: rawData.retrieved_at || new Date().toISOString(),
      ocUrl: `https://opencorporates.com/companies/${rawData.jurisdiction_code}/${rawData.company_number}`
    };
  }

  getRemainingCalls() {
    return this.dailyLimit - this.requestCount;
  }

  resetDailyCounter() {
    this.requestCount = 0;
  }
}

export default new OpenCorporatesClient();
