import axios from 'axios';
import portalsConfig from '../config/portals.js';

const portals = portalsConfig;

// Helper: get singular/plural variants of a word
function getWordVariants(word) {
  const variants = [word];
  if (word.endsWith('s') && word.length > 3) {
    variants.push(word.slice(0, -1));
  }
  if (!word.endsWith('s') && word.length > 2) {
    variants.push(word + 's');
  }
  return variants;
}

// Helper: check if any variant of keyword matches text
function keywordMatches(keyword, text) {
  const variants = getWordVariants(keyword.toLowerCase());
  const textLower = text.toLowerCase();
  return variants.some(v => textLower.includes(v));
}

// Parse cable specs from material/title text
function parseSpecsFromText(text) {
  if (!text) return {};
  const t = text.toLowerCase();
  
  const specs = {};
  
  // Extract cores (e.g., "3 Core", "12C", "4C x")
  const coreMatch = t.match(/(\d+)\s*(?:c(?:ore)?s?)\b/i) || t.match(/(\d+)\s*core/i);
  if (coreMatch) specs.cores = parseInt(coreMatch[1]);
  
  // Extract area (e.g., "95 sqmm", "2.5mm²", "185 sq mm")
  const areaMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:sqmm|sq\.?\s*mm|mm²|mm2)/i);
  if (areaMatch) specs.area = parseFloat(areaMatch[1]);
  
  // Extract voltage (e.g., "11kV", "66kV", "1.1kV")
  const voltageMatch = t.match(/(\d+(?:\.\d+)?)\s*kv/i);
  if (voltageMatch) specs.voltage = parseFloat(voltageMatch[1]);
  
  // Extract conductor material
  if (t.includes('copper') || /\bcu\b/.test(t)) specs.conductor = 'Copper';
  else if (t.includes('aluminium') || t.includes('aluminum') || /\bal\b/.test(t)) specs.conductor = 'Aluminium';
  
  // Extract insulation type
  if (t.includes('xlpe')) specs.insulation = 'XLPE';
  else if (t.includes('pvc')) specs.insulation = 'PVC';
  else if (t.includes('pe ') || t.includes(' pe')) specs.insulation = 'PE';
  
  // Extract armoured status
  if (t.includes('armoured') || t.includes('armored')) specs.armoured = true;
  else if (t.includes('non-armoured') || t.includes('unarmoured')) specs.armoured = false;
  
  return specs;
}

async function fetchPortalData(portalId, filters = {}) {
  const portal = portals.find(p => p.id === portalId);
  if (!portal) {
    throw new Error(`Portal ${portalId} not found`);
  }

  try {
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
      : `http://localhost:${process.env.PORT || 5000}`;
    
    const dataUrl = `${baseUrl}${portal.dataFeed}`;
    const response = await axios.get(dataUrl);
    let tenders = response.data;

    tenders = tenders.map(t => ({
      ...t,
      portal_id: portal.id,
      portal_name: portal.name,
      _relevanceScore: 0 // For soft matching/sorting
    }));

    // KEYWORD SEARCH - Primary filter (flexible matching)
    // Skip keyword filtering if wireType OR specs is set (those take priority)
    const hasSpecs = filters.specs && Object.keys(filters.specs).length > 0;
    if (filters.keyword && !filters.wireType && !hasSpecs) {
      const keywords = filters.keyword.toLowerCase().split(/\s+/).filter(k => k.length > 1);
      // Remove generic cable-type words from keywords (handled by wireType)
      const genericWords = ['cable', 'cables', 'wire', 'wires', 'control', 'ht', 'lt', 'ehv', 'power'];
      const filteredKeywords = keywords.filter(k => !genericWords.includes(k));
      
      if (filteredKeywords.length > 0) {
        tenders = tenders.filter(t => {
          const searchText = `${t.title || ''} ${t.material || ''} ${t.organisation || ''} ${t.product_category || ''}`.toLowerCase();
          const matchCount = filteredKeywords.filter(kw => keywordMatches(kw, searchText)).length;
          if (matchCount > 0) {
            t._relevanceScore += matchCount * 10;
            return true;
          }
          return false;
        });
      }
    } else if (filters.keyword && (filters.wireType || hasSpecs)) {
      // When wireType/specs is set, only use non-spec keywords for relevance scoring
      const keywords = filters.keyword.toLowerCase().split(/\s+/).filter(k => k.length > 1);
      const genericWords = ['cable', 'cables', 'wire', 'wires', 'control', 'ht', 'lt', 'ehv', 'power', 'xlpe', 'pvc'];
      // Also remove spec-like keywords (numbers with units)
      const filteredKeywords = keywords.filter(k => 
        !genericWords.includes(k) && !/^\d+(?:sqmm|mm|kv|c)?$/.test(k)
      );
      
      if (filteredKeywords.length > 0) {
        tenders.forEach(t => {
          const searchText = `${t.title || ''} ${t.material || ''} ${t.organisation || ''}`.toLowerCase();
          const matchCount = filteredKeywords.filter(kw => keywordMatches(kw, searchText)).length;
          t._relevanceScore += matchCount * 10;
        });
      }
    }

    // CITY FILTER - Soft by default unless cityStrict is true
    if (filters.city) {
      const cityLower = filters.city.toLowerCase();
      if (filters.cityStrict) {
        // Strict: only show matching city
        tenders = tenders.filter(t => 
          t.city?.toLowerCase().includes(cityLower)
        );
      } else {
        // Soft: boost matching city, but include all
        tenders.forEach(t => {
          if (t.city?.toLowerCase().includes(cityLower)) {
            t._relevanceScore += 20; // Boost city matches
          }
        });
      }
    }

    // CATEGORY FILTER - Only apply if explicitly set
    if (filters.category) {
      // Soft match: boost exact matches but also include partial
      const hasExactMatches = tenders.some(t => t.product_category === filters.category);
      if (hasExactMatches) {
        tenders = tenders.filter(t => t.product_category === filters.category);
      }
      // If no exact matches, don't filter out - the keyword search is primary
    }

    // CABLE TYPE - STRICT filter when specific cable type is mentioned
    if (filters.wireType) {
      const wireTypeLower = filters.wireType.toLowerCase();
      
      // Map common names to cable_type field values
      const cableTypeMap = {
        'control': 'Control Cable',
        'control cable': 'Control Cable',
        'ht': 'HT Cable',
        'ht cable': 'HT Cable',
        'high tension': 'HT Cable',
        'lt': 'LT Cable',
        'lt cable': 'LT Cable',
        'low tension': 'LT Cable',
        'ehv': 'EHV Cable',
        'ehv cable': 'EHV Cable',
        'extra high voltage': 'EHV Cable',
        'instrumentation': 'Instrumentation Cable',
        'instrumentation cable': 'Instrumentation Cable'
      };
      
      const mappedType = cableTypeMap[wireTypeLower] || null;
      
      if (mappedType) {
        // STRICT filtering by cable_type field
        tenders = tenders.filter(t => t.cable_type === mappedType);
        console.log(`Cable type filter: ${wireTypeLower} → ${mappedType}, results: ${tenders.length}`);
      } else {
        // Fallback: search in material field
        tenders.forEach(t => {
          const materialLower = (t.material || '').toLowerCase();
          if (materialLower.includes(wireTypeLower)) {
            t._relevanceScore += 15;
          }
        });
        const wireMatches = tenders.filter(t => 
          (t.material || '').toLowerCase().includes(wireTypeLower)
        );
        if (wireMatches.length > 0) {
          tenders = wireMatches;
        }
      }
    }

    // ORGANISATION FILTER - Filter by company/organisation name
    if (filters.organisation) {
      const orgLower = filters.organisation.toLowerCase();
      tenders = tenders.filter(t => {
        const tenderOrg = (t.organisation || '').toLowerCase();
        return tenderOrg.includes(orgLower) || orgLower.includes(tenderOrg.split(' ')[0]);
      });
      console.log(`Organisation filter: ${filters.organisation}, results: ${tenders.length}`);
    }

    // SPEC-BASED FILTERING - Filter by cable specifications
    if (filters.specs) {
      const { cores, area, voltage, conductor, insulation, armoured } = filters.specs;
      
      tenders = tenders.filter(t => {
        const tenderSpecs = parseSpecsFromText(`${t.material || ''} ${t.title || ''}`);
        let matchScore = 0;
        let totalChecks = 0;
        
        // Check cores (allow ±20% tolerance or exact match)
        if (cores) {
          totalChecks++;
          if (tenderSpecs.cores) {
            const diff = Math.abs(tenderSpecs.cores - cores) / cores;
            if (diff === 0) matchScore += 1;
            else if (diff <= 0.3) matchScore += 0.7; // Close match
          }
        }
        
        // Check area (allow ±25% tolerance)
        if (area) {
          totalChecks++;
          if (tenderSpecs.area) {
            const diff = Math.abs(tenderSpecs.area - area) / area;
            if (diff === 0) matchScore += 1;
            else if (diff <= 0.25) matchScore += 0.7;
            else if (diff <= 0.5) matchScore += 0.4;
          }
        }
        
        // Check voltage (allow nearby voltages)
        if (voltage) {
          totalChecks++;
          if (tenderSpecs.voltage) {
            const diff = Math.abs(tenderSpecs.voltage - voltage) / Math.max(voltage, 1);
            if (diff === 0) matchScore += 1;
            else if (diff <= 0.2) matchScore += 0.8;
            else if (diff <= 0.5) matchScore += 0.5;
          }
        }
        
        // Check conductor material (strict)
        if (conductor) {
          totalChecks++;
          if (tenderSpecs.conductor === conductor) matchScore += 1;
        }
        
        // Check insulation type (strict)
        if (insulation) {
          totalChecks++;
          if (tenderSpecs.insulation === insulation) matchScore += 1;
        }
        
        // Check armoured status (strict)
        if (armoured !== undefined) {
          totalChecks++;
          if (tenderSpecs.armoured === armoured) matchScore += 1;
        }
        
        // Calculate match percentage
        const matchPercent = totalChecks > 0 ? (matchScore / totalChecks) : 1;
        t._specMatchPercent = Math.round(matchPercent * 100);
        t._relevanceScore += matchPercent * 30; // Boost by spec match
        
        // Require at least 50% spec match if specs were provided
        return matchPercent >= 0.5;
      });
      
      console.log(`Spec filter applied: ${JSON.stringify(filters.specs)}, results: ${tenders.length}`);
    }

    // COST FILTERS - Keep these strict as they're usually intentional
    if (filters.minCost) {
      tenders = tenders.filter(t => t.estimated_cost_inr >= filters.minCost);
    }

    if (filters.maxCost) {
      tenders = tenders.filter(t => t.estimated_cost_inr <= filters.maxCost);
    }

    // DEADLINE FILTER - Keep strict
    if (filters.deadlineBefore) {
      const deadlineDate = new Date(filters.deadlineBefore);
      tenders = tenders.filter(t => {
        const dueDate = new Date(t.due_date);
        return dueDate <= deadlineDate;
      });
    }

    // Sort by relevance score (higher first), then by due date
    tenders.sort((a, b) => {
      if (b._relevanceScore !== a._relevanceScore) {
        return b._relevanceScore - a._relevanceScore;
      }
      return new Date(a.due_date) - new Date(b.due_date);
    });

    return tenders;
  } catch (error) {
    console.error(`Error fetching from portal ${portalId}:`, error.message);
    return [];
  }
}

async function scrapeMultiplePortals(portalIds, filters = {}) {
  const promises = portalIds.map(id => fetchPortalData(id, filters));
  const results = await Promise.all(promises);
  
  const allTenders = results.flat();
  
  // Deduplicate - keep the one with highest relevance score
  const tenderMap = new Map();
  for (const tender of allTenders) {
    const existing = tenderMap.get(tender.tender_id);
    if (!existing || (tender._relevanceScore || 0) > (existing._relevanceScore || 0)) {
      tenderMap.set(tender.tender_id, tender);
    }
  }
  
  const uniqueTenders = Array.from(tenderMap.values());

  // Sort by relevance score FIRST (higher = better), then by due date
  uniqueTenders.sort((a, b) => {
    const scoreA = a._relevanceScore || 0;
    const scoreB = b._relevanceScore || 0;
    if (scoreB !== scoreA) {
      return scoreB - scoreA; // Higher relevance first
    }
    return new Date(a.due_date) - new Date(b.due_date); // Earlier due date first
  });

  return uniqueTenders;
}

export { fetchPortalData, scrapeMultiplePortals };
