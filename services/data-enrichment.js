import openCorporatesClient from './opencorporates-client.js';
import { loadCompanyDirectory } from './credibility.js';

export class DataEnrichmentService {
  constructor() {
    this.enableRealData = process.env.ENABLE_REAL_DATA === 'true';
  }

  async enrichCompany(companyName, fallbackData = null) {
    if (!fallbackData) {
      const directory = loadCompanyDirectory();
      fallbackData = directory.find(c => c.name === companyName);
    }

    if (!this.enableRealData || !fallbackData) {
      return fallbackData;
    }

    const enrichedData = { ...fallbackData };
    let dataSourcesUsed = ['synthetic'];
    let dataCoverage = 40;

    try {
      const ocData = await openCorporatesClient.searchCompany(companyName, 'in');
      
      if (ocData) {
        dataSourcesUsed.push('opencorporates');
        dataCoverage = 75;

        if (ocData.yearsInOperation !== null) {
          enrichedData.years = ocData.yearsInOperation;
          dataCoverage += 5;
        }

        if (ocData.isActive !== null) {
          enrichedData.isActive = ocData.isActive;
          dataCoverage += 5;
        }

        if (ocData.officers && ocData.officers.length > 0) {
          enrichedData.directorCount = ocData.officers.length;
          dataCoverage += 5;
        }

        enrichedData.ocData = {
          companyNumber: ocData.companyNumber,
          incorporationDate: ocData.incorporationDate,
          status: ocData.status,
          jurisdictionCode: ocData.jurisdictionCode,
          registeredAddress: ocData.registeredAddress,
          companyType: ocData.companyType,
          url: ocData.ocUrl,
          dataFreshness: ocData.dataFreshness
        };
      }
    } catch (error) {
      console.warn(`Enrichment failed for ${companyName}:`, error.message);
    }

    enrichedData._enrichment = {
      sources: dataSourcesUsed,
      coverage: Math.min(dataCoverage, 100),
      timestamp: new Date().toISOString()
    };

    return enrichedData;
  }

  async enrichMultipleCompanies(companyNames) {
    const results = await Promise.all(
      companyNames.map(name => this.enrichCompany(name))
    );
    return results;
  }

  isEnabled() {
    return this.enableRealData;
  }

  getApiStatus() {
    return {
      enabled: this.enableRealData,
      openCorporates: {
        available: true,
        remainingCalls: openCorporatesClient.getRemainingCalls(),
        dailyLimit: openCorporatesClient.dailyLimit,
        hasApiKey: !!openCorporatesClient.apiKey
      }
    };
  }
}

export default new DataEnrichmentService();
