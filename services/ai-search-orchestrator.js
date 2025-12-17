/**
 * AI SEARCH ORCHESTRATOR
 * 
 * Main service that coordinates:
 * 1. Parsing user query
 * 2. Generating permutations from CSV
 * 3. Searching portals with filters
 * 4. Converting PDFs to JSON
 * 5. SKU matching
 * 6. Ranking by due date
 * 
 * Shows the complete process: keywords used, filters applied, results found
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseUserQuery, generatePermutations, detectCableType, detectCableTypes, detectPortal, detectVoltage, detectVoltages, detectCity } from './csv-permutation-generator.js';
import { matchRFPRequirements, quickMatch } from './sku-matcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Portal JSON paths
const PORTAL_PATHS = {
  gov: path.join(__dirname, '../public/data/portals/gov.json'),
  industrial: path.join(__dirname, '../public/data/portals/industrial.json'),
  utilities: path.join(__dirname, '../public/data/portals/utilities.json')
};

const PORTAL_NAMES = {
  gov: 'Government Procurement Portal',
  industrial: 'Industrial Supply Network',
  utilities: 'Utilities & Infrastructure Hub'
};

/**
 * Load tenders from a portal JSON
 */
function loadPortalTenders(portalKey) {
  const filePath = PORTAL_PATHS[portalKey];
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Search a portal with specific filters
 * Returns matching tenders with the keywords used to find them
 */
function searchPortalWithFilters(portalKey, filters) {
  const tenders = loadPortalTenders(portalKey);
  const results = [];
  
  const cableTypeFilter = (filters.cableType || '').toLowerCase();
  const voltageFilter = (filters.voltage || '').toLowerCase().replace('kv', '');
  const cityFilter = (filters.city || '').toLowerCase();
  
  tenders.forEach(tender => {
    let matches = false;
    const matchedKeywords = [];
    
    // City filter - if specified, must match
    if (cityFilter) {
      const tenderCity = (tender.city || '').toLowerCase();
      if (!tenderCity.includes(cityFilter)) {
        return; // Skip this tender if city doesn't match
      }
      matchedKeywords.push(`City: ${tender.city}`);
    }
    
    // Check against cable_requirements array (searches ALL items in RFP)
    if (tender.cable_requirements && Array.isArray(tender.cable_requirements)) {
      tender.cable_requirements.forEach(req => {
        const reqType = (req.cable_type || '').toLowerCase();
        const reqVoltage = (req.voltage || '').toLowerCase().replace('kv', '');
        
        // Check cable type match
        if (cableTypeFilter && reqType.includes(cableTypeFilter.replace(' cable', ''))) {
          matchedKeywords.push(`Cable Type: ${req.cable_type}`);
          
          // Check voltage match if specified
          if (voltageFilter) {
            if (reqVoltage.includes(voltageFilter)) {
              matchedKeywords.push(`Voltage: ${req.voltage}`);
              matches = true;
            }
          } else {
            matches = true; // Cable type match is enough if no voltage specified
          }
        }
      });
    }
    
    // Fallback: check main tender fields
    if (!matches) {
      const searchText = `${tender.title} ${tender.material} ${tender.cable_type} ${tender.search_index || ''}`.toLowerCase();
      
      if (cableTypeFilter && searchText.includes(cableTypeFilter.replace(' cable', ''))) {
        matchedKeywords.push(`Title/Material contains: ${cableTypeFilter}`);
        
        if (voltageFilter) {
          if (searchText.includes(voltageFilter + 'kv') || searchText.includes(voltageFilter + ' kv')) {
            matchedKeywords.push(`Voltage in text: ${voltageFilter}kV`);
            matches = true;
          }
        } else {
          matches = true;
        }
      }
    }
    
    if (matches) {
      results.push({
        tender: tender,
        portal: portalKey,
        portalName: PORTAL_NAMES[portalKey],
        matchedKeywords: matchedKeywords,
        filtersUsed: {
          cableType: filters.cableType,
          voltage: filters.voltage,
          city: filters.city,
          keyword: filters.keyword
        }
      });
    }
  });
  
  return results;
}

/**
 * Main search function - orchestrates the entire flow
 */
export async function executeSearch(userQuery) {
  console.log('[AI Search] executeSearch started');
  const startTime = Date.now();
  const processLog = [];
  
  try {
    // Step 1: Parse user query
    console.log('[AI Search] Step 1: Parsing query');
    processLog.push({
      step: 1,
      action: 'PARSE_USER_QUERY',
      input: userQuery,
      timestamp: new Date().toISOString()
    });
    
    const parsedQuery = parseUserQuery(userQuery);
    console.log('[AI Search] Parsed query:', JSON.stringify(parsedQuery, null, 2));
  
  if (parsedQuery.error) {
    return {
      success: false,
      error: parsedQuery.error,
      processLog: processLog
    };
  }
  
  processLog.push({
    step: 2,
    action: 'QUERY_ANALYSIS',
    result: {
      detectedCableTypes: parsedQuery.detectedCableTypes || [parsedQuery.detectedCableType],
      detectedCableType: parsedQuery.detectedCableType,
      detectedPortal: parsedQuery.detectedPortal,
      detectedVoltages: parsedQuery.detectedVoltages || [parsedQuery.detectedVoltage].filter(Boolean),
      detectedVoltage: parsedQuery.detectedVoltage,
      detectedCity: parsedQuery.detectedCity,
      citiesToSearch: parsedQuery.citiesToSearch,
      portalsToSearch: parsedQuery.portalsToSearch
    }
  });
  
  // Step 2: Load CSV and generate permutations
  processLog.push({
    step: 3,
    action: 'LOAD_CSV_DATA',
    csvPath: parsedQuery.csvData.path,
    productsFound: parsedQuery.csvData.totalProducts,
    uniqueVoltages: parsedQuery.csvData.voltages
  });
  
  processLog.push({
    step: 4,
    action: 'GENERATE_PERMUTATIONS',
    permutationsGenerated: parsedQuery.permutations.length,
    permutations: parsedQuery.permutations
  });
  
  // Step 3: Execute searches on each portal with each permutation
  const allResults = [];
  const searchesExecuted = [];
  
  // Determine if user specified a specific voltage (strict mode)
  const userSpecifiedVoltage = parsedQuery.detectedVoltage;
  const strictVoltageFilter = userSpecifiedVoltage ? userSpecifiedVoltage.toLowerCase().replace('kv', '') : null;
  
  for (const portal of parsedQuery.portalsToSearch) {
    for (const perm of parsedQuery.permutations) {
      const searchKey = `${portal}:${perm.keyword}`;
      
      searchesExecuted.push({
        portal: portal,
        filters: perm,
        timestamp: new Date().toISOString()
      });
      
      const results = searchPortalWithFilters(portal, {
        cableType: parsedQuery.detectedCableType,
        voltage: perm.voltage,
        city: perm.city, // Use city from permutation
        keyword: perm.keyword
      });
      
      // Add results avoiding duplicates
      results.forEach(r => {
        const exists = allResults.find(ar => ar.tender.tender_id === r.tender.tender_id);
        if (!exists) {
          // If user specified a voltage, apply strict filter
          if (strictVoltageFilter) {
            const hasMatchingVoltage = r.tender.cable_requirements?.some(req => {
              const reqVoltage = (req.voltage || '').toLowerCase().replace('kv', '');
              return reqVoltage.includes(strictVoltageFilter);
            });
            if (hasMatchingVoltage) {
              allResults.push(r);
            }
          } else {
            allResults.push(r);
          }
        }
      });
    }
  }
  
  processLog.push({
    step: 5,
    action: 'EXECUTE_PORTAL_SEARCHES',
    searchesExecuted: searchesExecuted.length,
    uniqueResultsFound: allResults.length
  });
  
  // Step 4: SKU Matching for each result
  const matchedResults = allResults.map(result => {
    const skuMatch = matchRFPRequirements(result.tender.cable_requirements);
    return {
      ...result,
      skuMatch: skuMatch
    };
  });
  
  processLog.push({
    step: 6,
    action: 'SKU_MATCHING',
    totalMatched: matchedResults.filter(r => r.skuMatch.canBid).length,
    totalNotMatched: matchedResults.filter(r => !r.skuMatch.canBid).length
  });
  
  // Step 5: Sort by due date (nearest first)
  matchedResults.sort((a, b) => {
    const dateA = new Date(a.tender.due_date);
    const dateB = new Date(b.tender.due_date);
    return dateA - dateB;
  });
  
  processLog.push({
    step: 7,
    action: 'RANK_BY_DUE_DATE',
    sortedResults: matchedResults.map(r => ({
      id: r.tender.tender_id,
      dueDate: r.tender.due_date,
      skuMatch: r.skuMatch.overallMatch + '%'
    }))
  });
  
  const endTime = Date.now();
  
  return {
    success: true,
    query: userQuery,
    summary: {
      cableTypes: parsedQuery.detectedCableTypes || [parsedQuery.detectedCableType],
      cableType: parsedQuery.detectedCableType, // backwards compatibility
      voltages: parsedQuery.detectedVoltages || [],
      city: parsedQuery.detectedCity,
      cities: parsedQuery.citiesToSearch,
      portalsSearched: parsedQuery.portalsToSearch,
      permutationsUsed: parsedQuery.permutations.length,
      totalSearches: searchesExecuted.length,
      resultsFound: matchedResults.length,
      matchingProducts: matchedResults.filter(r => r.skuMatch.canBid).length,
      processingTime: endTime - startTime + 'ms'
    },
    results: matchedResults,
    processLog: processLog,
    searchDetails: {
      csvData: parsedQuery.csvData,
      permutations: parsedQuery.permutations,
      searchesExecuted: searchesExecuted
    }
  };
  
  } catch (error) {
    console.error('[AI Search] Error in executeSearch:', error);
    return {
      success: false,
      error: error.message,
      processLog: processLog
    };
  }
}

/**
 * Format results for display in chat
 */
export function formatResultsForChat(searchResult) {
  if (!searchResult.success) {
    return {
      type: 'error',
      message: searchResult.error
    };
  }
  
  const { summary, results } = searchResult;
  
  // Format cable types (supports multiple)
  const cableTypesDisplay = (summary.cableTypes || [summary.cableType]).join(', ');
  const voltagesDisplay = (summary.voltages || []).length > 0 
    ? ` (${summary.voltages.join(', ')})` 
    : '';
  const cityDisplay = summary.city ? ` in **${summary.city}**` : '';
  const citiesCount = summary.cities?.length || 0;
  const citiesInfo = summary.city 
    ? `City: ${summary.city}` 
    : `All ${citiesCount} cities`;
  
  // Build process explanation
  const processExplanation = `
## Search Process

**Step 1:** Detected cable type(s): **${cableTypesDisplay}${voltagesDisplay}**${cityDisplay}
**Step 2:** Loaded product catalog (${searchResult.searchDetails.csvData.totalProducts} products)
**Step 3:** Generated ${summary.permutationsUsed} search permutation(s) (Cable Types × Voltages × Cities)
**Step 4:** Searched ${summary.portalsSearched.length} portal(s): ${summary.portalsSearched.join(', ')} | ${citiesInfo}
**Step 5:** Found ${summary.resultsFound} RFPs
**Step 6:** SKU Matched: ${summary.matchingProducts} can be bid on
**Step 7:** Ranked by due date
`;

  // Build results list - show all matching results
  const resultsList = results.map((r, idx) => ({
    rank: idx + 1,
    tenderId: r.tender.tender_id,
    title: r.tender.title,
    buyer: r.tender.organisation,
    portal: r.portalName,
    dueDate: r.tender.due_date,
    city: r.tender.city,
    skuMatch: r.skuMatch.overallMatch,
    canBid: r.skuMatch.canBid,
    keywordsUsed: r.matchedKeywords,
    filtersUsed: r.filtersUsed,
    pdfUrl: r.tender.pdf_url,
    cableRequirements: r.tender.cable_requirements
  }));
  
  return {
    type: 'search_results',
    processExplanation: processExplanation,
    summary: summary,
    results: resultsList,
    totalResults: results.length
  };
}

export default {
  executeSearch,
  formatResultsForChat
};

