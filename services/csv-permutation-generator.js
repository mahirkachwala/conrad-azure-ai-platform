/**
 * CSV PERMUTATION GENERATOR - ENHANCED
 * 
 * Supports:
 * - Multiple cable types (e.g., "LT and Control cables")
 * - Voltage-only searches (e.g., "0.6kV", "11kV")
 * - Specification searches (cores, size)
 * - Case-insensitive detection
 * - Partial matches
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CSV file paths
const CSV_PATHS = {
  'control': path.join(__dirname, '../data/products/control_cables.csv'),
  'ht': path.join(__dirname, '../data/products/ht_cables.csv'),
  'lt': path.join(__dirname, '../data/products/lt_cables.csv'),
  'ehv': path.join(__dirname, '../data/products/ehv_cables.csv'),
  'instrumentation': path.join(__dirname, '../data/products/instrumentation_cables.csv')
};

const CABLE_TYPE_LABELS = {
  'control': 'Control Cable',
  'ht': 'HT Cable',
  'lt': 'LT Cable',
  'ehv': 'EHV Cable',
  'instrumentation': 'Instrumentation Cable'
};

// Voltage ranges for cable types (for voltage-only searches)
const VOLTAGE_TO_CABLE_TYPE = {
  '0.6': ['lt', 'control', 'instrumentation'],
  '0.75': ['lt', 'control'],
  '1.1': ['lt', 'control', 'instrumentation'],
  '6.6': ['ht'],
  '11': ['ht'],
  '22': ['ht'],
  '33': ['ht'],
  '66': ['ehv'],
  '110': ['ehv'],
  '132': ['ehv'],
  '220': ['ehv'],
  '400': ['ehv']
};

// Cities available in RFP data (for location-based filtering)
const AVAILABLE_CITIES = [
  'ahmedabad', 'bangalore', 'chennai', 'coimbatore', 'delhi',
  'hyderabad', 'indore', 'jaipur', 'kolkata', 'lucknow',
  'mumbai', 'nagpur', 'pune'
];

/**
 * Parse CSV file and return array of objects
 */
function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`CSV not found: ${filePath}`);
    return [];
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  
  const products = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].split(',');
    const product = {};
    headers.forEach((h, idx) => {
      product[h] = values[idx]?.trim() || '';
    });
    products.push(product);
  }
  
  return products;
}

/**
 * Get unique voltages from CSV products
 */
function getUniqueVoltages(products) {
  const voltages = new Set();
  products.forEach(p => {
    const voltage = p.Voltage_Rating_kV;
    if (voltage) {
      voltages.add(voltage + 'kV');
    }
  });
  return Array.from(voltages);
}

/**
 * Get unique sizes from CSV products
 */
function getUniqueSizes(products) {
  const sizes = new Set();
  products.forEach(p => {
    const size = p.Conductor_Area_mm2;
    if (size) {
      sizes.add(size + ' sqmm');
    }
  });
  return Array.from(sizes);
}

/**
 * Get unique core counts from CSV products
 */
function getUniqueCores(products) {
  const cores = new Set();
  products.forEach(p => {
    const coreCount = p.No_of_Cores;
    if (coreCount) {
      cores.add(coreCount);
    }
  });
  return Array.from(cores);
}

/**
 * Detect ALL cable types from user input (supports multiple)
 * Returns array of detected types
 */
export function detectCableTypes(userInput) {
  const input = userInput.toLowerCase();
  const detected = [];
  
  // Check for each cable type
  if (input.includes('control')) detected.push('control');
  if (input.includes('ht') || input.includes('high tension') || input.includes('high-tension')) detected.push('ht');
  if (input.includes('lt') || input.includes('low tension') || input.includes('low-tension') || input.includes('power cable')) detected.push('lt');
  if (input.includes('ehv') || input.includes('extra high') || input.includes('extra-high')) detected.push('ehv');
  if (input.includes('instrument')) detected.push('instrumentation');
  
  return detected;
}

/**
 * Detect single cable type (for backwards compatibility)
 */
export function detectCableType(userInput) {
  const types = detectCableTypes(userInput);
  return types.length > 0 ? types[0] : null;
}

/**
 * Detect portal from user input
 */
export function detectPortal(userInput) {
  const input = userInput.toLowerCase();
  
  if (input.includes('gov') || input.includes('government')) return 'gov';
  if (input.includes('industrial') || input.includes('industry')) return 'industrial';
  if (input.includes('utilit')) return 'utilities';
  
  return null; // Search all portals
}

/**
 * Detect ALL voltages from user input (supports multiple)
 */
export function detectVoltages(userInput) {
  const input = userInput.toLowerCase();
  const voltages = [];
  
  // Match patterns like "1.1kv", "11kv", "0.6 kv", "11 kv"
  const voltageMatches = input.matchAll(/(\d+\.?\d*)\s*k?v/gi);
  for (const match of voltageMatches) {
    voltages.push(match[1] + 'kV');
  }
  
  return [...new Set(voltages)]; // Remove duplicates
}

/**
 * Detect single voltage (for backwards compatibility)
 */
export function detectVoltage(userInput) {
  const voltages = detectVoltages(userInput);
  return voltages.length > 0 ? voltages[0] : null;
}

/**
 * Detect cores from user input
 */
export function detectCores(userInput) {
  const input = userInput.toLowerCase();
  
  // Match patterns like "4c", "4 core", "4-core", "4 cores"
  const coreMatch = input.match(/(\d+)\s*(?:c|core|cores|-core)/i);
  if (coreMatch) {
    return coreMatch[1];
  }
  
  return null;
}

/**
 * Detect size from user input
 */
export function detectSize(userInput) {
  const input = userInput.toLowerCase();
  
  // Match patterns like "25mm", "25 sqmm", "25mm²", "25 sq mm"
  const sizeMatch = input.match(/(\d+\.?\d*)\s*(?:sqmm|sq\.?\s*mm|mm²|mm2)/i);
  if (sizeMatch) {
    return sizeMatch[1];
  }
  
  return null;
}

/**
 * Detect city from user input
 */
export function detectCity(userInput) {
  const input = userInput.toLowerCase();
  
  for (const city of AVAILABLE_CITIES) {
    // Check for exact word match (not part of another word)
    const regex = new RegExp(`\\b${city}\\b`, 'i');
    if (regex.test(input)) {
      // Return properly capitalized city name
      return city.charAt(0).toUpperCase() + city.slice(1);
    }
  }
  
  return null;
}

/**
 * Get all available cities for search filtering
 */
export function getAvailableCities() {
  return AVAILABLE_CITIES.map(c => c.charAt(0).toUpperCase() + c.slice(1));
}

/**
 * Get cable type label
 */
function getCableTypeLabel(type) {
  return CABLE_TYPE_LABELS[type.toLowerCase()] || type;
}

/**
 * Load CSV and generate search permutations
 */
export function generatePermutations(cableType, filters = {}) {
  const csvPath = CSV_PATHS[cableType.toLowerCase()];
  
  if (!csvPath) {
    return {
      error: `Unknown cable type: ${cableType}`,
      products: [],
      permutations: []
    };
  }
  
  const products = parseCSV(csvPath);
  
  if (products.length === 0) {
    return {
      error: `No products found in CSV for ${cableType}`,
      products: [],
      permutations: []
    };
  }
  
  // Extract unique values
  let voltages = getUniqueVoltages(products);
  const sizes = getUniqueSizes(products);
  const cores = getUniqueCores(products);
  
  // Apply user filters if provided
  if (filters.voltage) {
    const filterVoltage = filters.voltage.toLowerCase().replace('kv', '');
    voltages = voltages.filter(v => v.toLowerCase().replace('kv', '') === filterVoltage);
    // If no exact match, use all
    if (voltages.length === 0) {
      voltages = getUniqueVoltages(products);
    }
  }
  
  // Generate permutations
  const permutations = voltages.map(voltage => ({
    voltage: voltage,
    cableType: getCableTypeLabel(cableType),
    keyword: `${getCableTypeLabel(cableType)} ${voltage}`
  }));
  
  return {
    cableType: getCableTypeLabel(cableType),
    csvPath: csvPath,
    totalProducts: products.length,
    uniqueVoltages: voltages,
    uniqueSizes: sizes,
    uniqueCores: cores,
    permutations: permutations,
    products: products
  };
}

/**
 * Generate permutations for multiple cable types
 */
export function generateMultiTypePermutations(cableTypes, filters = {}) {
  const allPermutations = [];
  const allCsvData = {};
  let totalProducts = 0;
  
  cableTypes.forEach(type => {
    const result = generatePermutations(type, filters);
    if (!result.error) {
      allPermutations.push(...result.permutations);
      allCsvData[type] = {
        path: result.csvPath,
        products: result.totalProducts,
        voltages: result.uniqueVoltages
      };
      totalProducts += result.totalProducts;
    }
  });
  
  return {
    cableTypes: cableTypes.map(getCableTypeLabel),
    totalProducts: totalProducts,
    permutations: allPermutations,
    csvData: allCsvData
  };
}

/**
 * Parse user input and generate complete search plan
 * ENHANCED: Supports multiple cable types, voltage-only searches, etc.
 */
export function parseUserQuery(userInput) {
  const cableTypes = detectCableTypes(userInput);
  const portal = detectPortal(userInput);
  const voltages = detectVoltages(userInput);
  const cores = detectCores(userInput);
  const size = detectSize(userInput);
  const city = detectCity(userInput);
  
  // If no cable type detected but voltage is detected, infer cable types from voltage
  let finalCableTypes = cableTypes;
  if (cableTypes.length === 0 && voltages.length > 0) {
    // Infer cable type from voltage
    const voltageNum = voltages[0].replace('kV', '');
    finalCableTypes = VOLTAGE_TO_CABLE_TYPE[voltageNum] || [];
    
    if (finalCableTypes.length === 0) {
      // Fallback: determine by voltage range
      const v = parseFloat(voltageNum);
      if (v <= 1.1) finalCableTypes = ['lt', 'control'];
      else if (v <= 33) finalCableTypes = ['ht'];
      else finalCableTypes = ['ehv'];
    }
  }
  
  if (finalCableTypes.length === 0) {
    return {
      error: 'Could not detect cable type. Please specify: control, HT, LT, EHV, or instrumentation cable.',
      searchPlan: null
    };
  }
  
  // Build filters
  const filters = {};
  if (voltages.length > 0) filters.voltage = voltages[0];
  if (cores) filters.cores = cores;
  if (size) filters.size = size;
  
  // Generate permutations for all detected cable types
  const multiTypeResult = generateMultiTypePermutations(finalCableTypes, filters);
  
  if (multiTypeResult.permutations.length === 0) {
    return {
      error: 'No matching products found in catalog',
      searchPlan: null
    };
  }
  
  // Determine which portals to search
  const portalsToSearch = portal 
    ? [portal] 
    : ['gov', 'industrial', 'utilities'];
  
  // Determine cities to search
  // If user specified a city, use only that city
  // Otherwise, use all available cities in permutations
  const citiesToSearch = city 
    ? [city] 
    : AVAILABLE_CITIES.map(c => c.charAt(0).toUpperCase() + c.slice(1));
  
  // Expand permutations to include cities
  // Each cable type x voltage x city combination
  const expandedPermutations = [];
  multiTypeResult.permutations.forEach(perm => {
    citiesToSearch.forEach(searchCity => {
      expandedPermutations.push({
        ...perm,
        city: searchCity,
        keyword: `${perm.keyword} ${searchCity}`
      });
    });
  });
  
  return {
    intent: 'SEARCH_RFPS',
    detectedCableTypes: multiTypeResult.cableTypes,
    detectedCableType: multiTypeResult.cableTypes[0], // For backwards compatibility
    detectedPortal: portal,
    detectedVoltages: voltages,
    detectedVoltage: voltages[0] || null,
    detectedCores: cores,
    detectedSize: size,
    detectedCity: city,
    citiesToSearch: citiesToSearch,
    portalsToSearch: portalsToSearch,
    permutations: expandedPermutations,
    csvData: {
      totalProducts: multiTypeResult.totalProducts,
      voltages: [...new Set(multiTypeResult.permutations.map(p => p.voltage))],
      cities: citiesToSearch,
      byType: multiTypeResult.csvData
    },
    searchPlan: {
      totalSearches: expandedPermutations.length * portalsToSearch.length,
      searches: portalsToSearch.flatMap(p => 
        expandedPermutations.map(perm => ({
          portal: p,
          filters: perm,
          searchUrl: `Portal: ${p} | Filters: ${perm.keyword}`
        }))
      )
    }
  };
}

// Export for use in other modules
export default {
  parseCSV,
  generatePermutations,
  generateMultiTypePermutations,
  detectCableType,
  detectCity,
  getAvailableCities,
  detectCableTypes,
  detectPortal,
  detectVoltage,
  detectVoltages,
  detectCores,
  detectSize,
  parseUserQuery
};
