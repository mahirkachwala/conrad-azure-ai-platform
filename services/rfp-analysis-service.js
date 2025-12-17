/**
 * RFP ANALYSIS SERVICE
 * 
 * Handles the complete "Proceed with RFP" workflow:
 * 1. Parse RFP PDF → Extract all details
 * 2. Calculate pricing (material + tests + margin)
 * 3. Extract terms & conditions
 * 4. Handle 4 submission modes
 * 5. Generate required documents
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import { getCSVData, hasSessionOverride } from './adaptive-csv-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load testing data - NOW USES ADAPTIVE SESSION DATA
function loadTestingCatalog() {
  // First try to get from adaptive session (if user uploaded new data)
  if (hasSessionOverride('testing')) {
    console.log('   📋 Using SESSION OVERRIDE testing data');
    return getCSVData('testing');
  }
  
  // Fallback: read from file
  const testingPath = path.join(__dirname, '../data/testing.csv');
  if (!fs.existsSync(testingPath)) return [];
  
  const content = fs.readFileSync(testingPath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  
  const tests = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].split(',');
    const test = {};
    headers.forEach((h, idx) => {
      test[h] = values[idx]?.trim() || '';
    });
    tests.push(test);
  }
  return tests;
}

// Load product catalog - NOW USES ADAPTIVE SESSION DATA
function loadProductCatalog(cableType) {
  const key = cableType.toLowerCase().replace(' cable', '').trim();
  const csvTypeMap = {
    'control': 'control_cables',
    'ht': 'ht_cables',
    'lt': 'lt_cables',
    'ehv': 'ehv_cables',
    'instrumentation': 'instrumentation_cables'
  };
  
  const csvType = csvTypeMap[key];
  
  // First try session override
  if (csvType && hasSessionOverride(csvType)) {
    console.log(`   📋 Using SESSION OVERRIDE for ${csvType}`);
    return getCSVData(csvType);
  }
  
  // Fallback to file
  const csvPaths = {
    'control': path.join(__dirname, '../data/products/control_cables.csv'),
    'ht': path.join(__dirname, '../data/products/ht_cables.csv'),
    'lt': path.join(__dirname, '../data/products/lt_cables.csv'),
    'ehv': path.join(__dirname, '../data/products/ehv_cables.csv'),
    'instrumentation': path.join(__dirname, '../data/products/instrumentation_cables.csv')
  };
  
  const csvPath = csvPaths[key];
  if (!csvPath || !fs.existsSync(csvPath)) return [];
  
  const content = fs.readFileSync(csvPath, 'utf-8');
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

// Company preset data (for form filling)
const COMPANY_PRESET = {
  name: 'Cable Solutions Pvt Ltd',
  address: '123 Industrial Area, Phase II\nGurgaon, Haryana 122001\nIndia',
  gstin: '06AABCC1234D1ZA',
  pan: 'AABCC1234D',
  cin: 'U31300HR2020PTC123456',
  contact_person: 'Rajesh Kumar',
  designation: 'Sales Manager',
  email: 'sales@cablesolutions.in',
  phone: '+91-124-4567890',
  mobile: '+91-9876543210',
  bank_name: 'State Bank of India',
  bank_account: '1234567890123',
  bank_ifsc: 'SBIN0001234',
  iso_cert: 'ISO 9001:2015',
  bis_cert: 'BIS/CRS Registration'
};

// Testing company preset
const TESTING_COMPANY = {
  name: 'ERDA (Electrical Research and Development Association)',
  email: 'testing@erda.org',
  phone: '+91-265-2638100',
  address: 'ERDA Road, Makarpura, Vadodara, Gujarat 390010'
};

/**
 * Calculate material cost for RFP requirements
 * Uses Unit_Price_per_km from CSV multiplied by qty_km
 * Includes internal markup (hidden from customer)
 */
export function calculateMaterialCost(cableRequirements) {
  const lineItems = [];
  let totalMaterialCost = 0;
  let totalBaseCost = 0; // Cost before markup
  
  const INTERNAL_MARKUP = 1.18; // 18% markup built into unit price (hidden from customer)
  
  cableRequirements.forEach((req, idx) => {
    const products = loadProductCatalog(req.cable_type);
    
    // Find best matching product
    let bestMatch = null;
    let bestScore = 0;
    
    products.forEach(product => {
      let score = 0;
      
      // Match voltage (most important for cable type)
      const prodVoltage = parseFloat(product.Voltage_Rating_kV);
      const reqVoltage = parseFloat((req.voltage || '').replace('kV', ''));
      if (prodVoltage && reqVoltage && Math.abs(prodVoltage - reqVoltage) < 0.5) score += 35;
      
      // Match size/conductor area
      const prodSize = parseFloat(product.Conductor_Area_mm2);
      const reqSize = parseFloat((req.size || '').replace(/[^0-9.]/g, ''));
      if (prodSize && reqSize && prodSize === reqSize) score += 30;
      else if (prodSize && reqSize && Math.abs(prodSize - reqSize) / reqSize < 0.2) score += 15;
      
      // Match cores
      const prodCores = parseInt(product.No_of_Cores);
      const reqCores = parseInt((req.cores || '').replace(/[^0-9]/g, ''));
      if (prodCores && reqCores && prodCores === reqCores) score += 20;
      
      // Match conductor material
      const prodConductor = (product.Conductor_Material || '').toLowerCase();
      const reqConductor = (req.conductor || '').toLowerCase();
      if (prodConductor && reqConductor && prodConductor === reqConductor) score += 15;
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = product;
      }
    });
    
    const qtyKm = parseFloat(req.qty_km) || 1;
    // Unit price from CSV already includes our margin
    const unitPricePerKm = bestMatch ? parseFloat(bestMatch.Unit_Price_per_km) : 500000;
    const lineCost = unitPricePerKm * qtyKm;
    
    lineItems.push({
      itemNo: idx + 1,
      description: `${req.voltage} ${req.cable_type} ${req.cores}C x ${req.size}`,
      quantity: qtyKm,
      unit: 'km',
      unitPrice: unitPricePerKm,
      totalPrice: lineCost,
      matchedSKU: bestMatch?.SKU_ID || 'N/A',
      matchedProduct: bestMatch?.Product_Name || 'Generic Cable',
      matchScore: bestScore
    });
    
    totalMaterialCost += lineCost;
    totalBaseCost += lineCost / INTERNAL_MARKUP;
  });
  
  return { 
    lineItems, 
    totalMaterialCost,
    // Internal info (not shown to customer)
    _internal: {
      baseCost: totalBaseCost,
      margin: totalMaterialCost - totalBaseCost,
      marginPercent: ((totalMaterialCost - totalBaseCost) / totalBaseCost * 100).toFixed(1)
    }
  };
}

/**
 * Calculate testing cost for RFP requirements
 * 
 * LOGIC:
 * 1. FIRST: Use tests from testsRequired if provided (from uploaded PDF)
 * 2. FALLBACK: Use standardTestsMap based on cable type
 * 3. Test prices come from adaptive CSV - multiply by cable quantity
 * 
 * Formula: Test Cost = Price_Per_Km × Quantity_Km
 */
export function calculateTestingCost(cableRequirements, testsRequired) {
  const testingCatalog = loadTestingCatalog();
  const testItems = [];
  let totalTestingCost = 0;
  
  console.log('   📋 Testing catalog loaded:', testingCatalog.length, 'tests');
  console.log('   📦 Cable requirements:', cableRequirements.length, 'items');
  console.log('   🧪 Tests required from RFP:', testsRequired?.length || 0, 'tests');
  if (testsRequired?.length > 0) {
    console.log('   📝 Specified tests:', testsRequired.join(', '));
  }
  
  // Standard tests per cable type
  const standardTestsMap = {
    'ht': ['High Voltage Test', 'Insulation Resistance Test', 'Partial Discharge Test', 'Water Immersion Test'],
    'lt': ['High Voltage Test', 'Insulation Resistance Test', 'Bending Test', 'Tensile Strength Test'],
    'control': ['Spark Test', 'Voltage Drop Test', 'Bending Test', 'Tensile Strength Test'],
    'ehv': ['High Voltage Test', 'Partial Discharge Test', 'Impulse Voltage Test', 'Tan Delta Test'],
    'instrumentation': ['Spark Test', 'Insulation Resistance Test', 'Capacitance Test']
  };
  
  // Test-to-cable-type mapping (which tests apply to which cable types)
  const testToCableTypeMap = {
    // HT/EHV specific tests
    'high voltage': ['ht', 'ehv', 'lt'],
    'water immersion': ['ht', 'ehv'],
    'partial discharge': ['ht', 'ehv'],
    'impulse voltage': ['ehv'],
    'tan delta': ['ht', 'ehv'],
    'insulation resistance': ['ht', 'lt', 'ehv'],
    // Control/Instrumentation specific tests
    'spark': ['control', 'instrumentation'],
    'voltage drop': ['control'],
    'bending': ['control', 'lt'],
    'tensile': ['control', 'lt'],
    // Generic tests
    'conductor resistance': ['ht', 'lt', 'control', 'ehv', 'instrumentation']
  };
  
  // Get cable quantities by type
  const cableQuantities = {};
  cableRequirements.forEach(req => {
    const cableKey = (req.cable_type || '').toLowerCase().replace(' cable', '').replace('cable', '').trim();
    const qtyKm = parseFloat(req.qty_km) || 1;
    cableQuantities[cableKey] = qtyKm;
    console.log(`   📏 ${req.cable_type}: ${qtyKm} km`);
  });
  
  // PRIORITY 1: Use tests from RFP (testsRequired) if provided
  if (testsRequired && testsRequired.length > 0) {
    console.log(`   ✅ Using ${testsRequired.length} tests from uploaded PDF`);
    
    // Track which tests have been added to avoid duplicates
    const addedTests = new Set();
    
    testsRequired.forEach(testName => {
      const reqTestName = (typeof testName === 'string' ? testName : testName.name || '').toLowerCase();
      
      // Find test in catalog by name match
      const catalogTest = testingCatalog.find(test => {
        const catTestName = (test.Test_Name || '').toLowerCase();
        return catTestName.includes(reqTestName.split(' ')[0]) || 
               reqTestName.includes(catTestName.split(' ')[0]) ||
               catTestName.includes(reqTestName) ||
               reqTestName.includes(catTestName);
      });
      
      if (catalogTest && !addedTests.has(catalogTest.Test_ID)) {
        addedTests.add(catalogTest.Test_ID);
        const pricePerUnit = parseFloat(catalogTest.Price_INR) || 0;
        
        // Determine which cable type this test applies to
        let applicableCableType = null;
        const testNameLower = (catalogTest.Test_Name || '').toLowerCase();
        
        for (const [keyword, cableTypes] of Object.entries(testToCableTypeMap)) {
          if (testNameLower.includes(keyword) || reqTestName.includes(keyword)) {
            // Find first cable type that exists in our requirements
            for (const ct of cableTypes) {
              if (cableQuantities[ct] !== undefined) {
                applicableCableType = ct;
                break;
              }
            }
            if (applicableCableType) break;
          }
        }
        
        // Get the quantity for this specific cable type
        let qtyKm;
        let forCable;
        
        if (applicableCableType && cableQuantities[applicableCableType]) {
          qtyKm = cableQuantities[applicableCableType];
          forCable = `${applicableCableType.toUpperCase()} Cable (${qtyKm} km)`;
        } else {
          // Fallback: use first cable's quantity
          const firstCable = cableRequirements[0];
          qtyKm = parseFloat(firstCable?.qty_km) || 1;
          forCable = firstCable?.cable_type || 'Cable';
        }
        
        const totalCost = Math.round(pricePerUnit * qtyKm);
        
        console.log(`     ✓ "${testName}" → ${catalogTest.Test_Name} @ ₹${pricePerUnit}/km × ${qtyKm}km (${applicableCableType || 'default'}) = ₹${totalCost}`);
        
        testItems.push({
          testId: catalogTest.Test_ID,
          testName: catalogTest.Test_Name,
          description: catalogTest.Description,
          standard: catalogTest.Standard,
          pricePerKm: pricePerUnit,
          quantityKm: qtyKm,
          cost: totalCost,
          forCable: forCable,
          cableIndex: 0,
          matchReason: 'From RFP requirements'
        });
        
        totalTestingCost += totalCost;
      } else if (!catalogTest) {
        console.log(`     ⚠️ Test "${testName}" not found in catalog`);
      }
    });
  } else {
    // PRIORITY 2: Fallback to standard tests per cable type
    console.log(`   ⚠️ No tests specified in RFP, using standard tests per cable type`);
    
    cableRequirements.forEach((req, reqIdx) => {
      const cableKey = (req.cable_type || '').toLowerCase().replace(' cable', '').replace('cable', '').trim();
      const qtyKm = parseFloat(req.qty_km) || 1;
      
      console.log(`   🔬 Processing Item ${reqIdx + 1}: ${req.cable_type} - ${qtyKm} km`);
      
      const standardTests = standardTestsMap[cableKey] || standardTestsMap['lt'];
      const matchedTestNames = new Set();
      
      for (const standardTestName of standardTests) {
        const catalogTest = testingCatalog.find(test => {
          const testName = (test.Test_Name || '').toLowerCase();
          const standardLower = standardTestName.toLowerCase();
          return testName.includes(standardLower.split(' ')[0]) || standardLower.includes(testName.split(' ')[0]);
        });
        
        if (catalogTest && !matchedTestNames.has(catalogTest.Test_ID)) {
          matchedTestNames.add(catalogTest.Test_ID);
          
          const pricePerUnit = parseFloat(catalogTest.Price_INR) || 5000;
          const totalCost = Math.round(pricePerUnit * qtyKm);
          
          testItems.push({
            testId: catalogTest.Test_ID,
            testName: catalogTest.Test_Name,
            description: catalogTest.Description,
            standard: catalogTest.Standard,
            pricePerKm: pricePerUnit,
            quantityKm: qtyKm,
            cost: totalCost,
            forCable: `${req.voltage || ''} ${req.cable_type} (${qtyKm} km)`.trim(),
            cableIndex: reqIdx + 1,
            matchReason: `Standard test for ${cableKey.toUpperCase()} cables`
          });
          
          totalTestingCost += totalCost;
        }
      }
      
      console.log(`     ✓ ${matchedTestNames.size} tests for ${req.cable_type}`);
    });
  }
  
  // If no tests matched, add minimum required routine tests
  if (testItems.length === 0) {
    console.log('   ⚠️ No tests matched, adding default routine tests');
    const defaultTests = testingCatalog.filter(t => 
      t.Test_Name && (
        t.Test_Name.includes('Conductor Resistance') || 
        t.Test_Name.includes('Insulation Resistance') ||
        t.Test_Name.includes('High Voltage')
      )
    ).slice(0, 3);
    
    const totalQty = cableRequirements.reduce((sum, req) => sum + (parseFloat(req.qty_km) || 1), 0);
    
    defaultTests.forEach(test => {
      const pricePerUnit = parseFloat(test.Price_INR) || 5000;
      const totalCost = Math.round(pricePerUnit * totalQty);
      
      testItems.push({
        testId: test.Test_ID,
        testName: test.Test_Name,
        description: test.Description,
        standard: test.Standard,
        pricePerKm: pricePerUnit,
        quantityKm: totalQty,
        cost: totalCost,
        forCable: 'All cables',
        cableIndex: 0,
        matchReason: 'Default routine test'
      });
      totalTestingCost += totalCost;
    });
  }
  
  console.log(`   💰 Total Testing Cost: ₹${totalTestingCost.toLocaleString('en-IN')} for ${testItems.length} tests`);
  
  return { 
    testItems, 
    totalTestingCost,
    testCount: testItems.length,
    summary: `${testItems.length} test(s) × quantity = ₹${totalTestingCost.toLocaleString('en-IN')}`
  };
}

/**
 * Calculate complete quotation
 * 
 * For CUSTOMER FACING documents:
 *   - Show: Material Cost (includes hidden markup), Testing Cost, GST
 *   - Hide: Overhead, Profit margin
 * 
 * For INTERNAL analysis (AI bot display):
 *   - Show full breakdown including margins
 */
export function calculateQuotation(cableRequirements, testsRequired = [], externalTestingRequired = false) {
  const materialResult = calculateMaterialCost(cableRequirements);
  const { lineItems, totalMaterialCost } = materialResult;
  const { testItems, totalTestingCost } = calculateTestingCost(cableRequirements, testsRequired);
  
  // External testing placeholder (if required but cost unknown)
  const externalTestingEstimate = externalTestingRequired ? {
    required: true,
    estimatedRange: '₹50,000 - ₹5,00,000',
    note: 'To be confirmed by testing lab',
    placeholder: 0 // Will be added once quote received
  } : null;
  
  // Material cost ALREADY includes margin (built into Unit_Price_per_km)
  // So we just add testing and GST for customer-facing price
  
  const subtotalBeforeTax = totalMaterialCost + totalTestingCost;
  const gst = subtotalBeforeTax * 0.18; // 18% GST
  const grandTotal = subtotalBeforeTax + gst;
  
  // INTERNAL ONLY - for AI bot analysis display
  const _internalAnalysis = {
    baseMaterialCost: materialResult._internal?.baseCost || totalMaterialCost / 1.18,
    builtInMargin: materialResult._internal?.margin || totalMaterialCost * 0.18 / 1.18,
    marginPercent: materialResult._internal?.marginPercent || '18.0',
    effectiveProfit: ((grandTotal - (materialResult._internal?.baseCost || totalMaterialCost / 1.18) - totalTestingCost) / grandTotal * 100).toFixed(1) + '%'
  };
  
  return {
    // CUSTOMER FACING - for bid documents
    materialCost: {
      lineItems,
      total: totalMaterialCost
    },
    testingCost: {
      testItems,
      total: totalTestingCost,
      note: testItems.length > 0 ? 'Routine/Type tests as per specifications' : 'No testing required'
    },
    externalTesting: externalTestingEstimate,
    subtotal: subtotalBeforeTax,
    gst: {
      rate: 18,
      amount: gst
    },
    grandTotal: grandTotal,
    grandTotalWithExternalTesting: externalTestingRequired 
      ? `${grandTotal.toLocaleString('en-IN')} + External Testing (TBD)` 
      : grandTotal,
    
    // INTERNAL ONLY - for AI bot display
    _internal: _internalAnalysis,
    
    // Summary for display
    summary: {
      materialCost: totalMaterialCost,
      testingCost: totalTestingCost,
      gst: gst,
      grandTotal: grandTotal,
      externalTestingRequired: externalTestingRequired
    }
  };
}

/**
 * Extract structured terms and conditions
 */
export function extractTermsConditions(rfpData) {
  // Default terms structure
  return {
    deliveryPeriod: rfpData.delivery_period || '8-12 weeks from order confirmation',
    deliveryTerms: rfpData.delivery_terms || 'FOR Destination',
    paymentTerms: rfpData.payment_terms || '30 days from delivery',
    warrantyPeriod: rfpData.warranty || '18 months from supply or 12 months from commissioning',
    ldClause: rfpData.ld_clause || '0.5% per week, max 5%',
    performanceGuarantee: rfpData.pg || '10% of order value',
    inspectionRequirements: rfpData.inspection || 'Third party inspection by approved agency',
    insuranceRequirements: rfpData.insurance || 'Transit insurance by supplier',
    packagingRequirements: rfpData.packaging || 'Wooden drums as per IS standards',
    validityPeriod: rfpData.validity || '90 days from submission'
  };
}

/**
 * Generate submission package based on mode
 */
export function generateSubmissionPackage(rfpData, quotation, submissionMode) {
  const basePackage = {
    companyDetails: COMPANY_PRESET,
    quotation: quotation,
    terms: extractTermsConditions(rfpData),
    generatedAt: new Date().toISOString()
  };
  
  switch (submissionMode) {
    case 'LETTER_COURIER':
      return {
        ...basePackage,
        mode: 'Physical Courier',
        instructions: [
          'Print the generated bid document',
          'Sign on all pages with company seal',
          'Place in sealed envelope',
          `Mark envelope: "${rfpData.submission?.envelope_marking || 'BID DOCUMENT - DO NOT OPEN'}"`,
          'Send via registered post or courier'
        ],
        postalAddress: rfpData.submission?.submission_address || 'Address not specified',
        documentsRequired: [
          'Signed bid document',
          'Company registration certificate',
          'GST certificate',
          'ISO/BIS certificates',
          'EMD (if required)'
        ],
        generatePdf: true
      };
      
    case 'PDF_FORM_FILL':
      return {
        ...basePackage,
        mode: 'Internal Form Fill',
        instructions: [
          'Download the pre-filled form from below',
          'Review all pre-filled values',
          'Print and sign the form',
          'Scan the signed form',
          'Email to the specified address with subject line'
        ],
        prefilledValues: {
          vendorName: COMPANY_PRESET.name,
          vendorAddress: COMPANY_PRESET.address,
          gstin: COMPANY_PRESET.gstin,
          pan: COMPANY_PRESET.pan,
          contactPerson: COMPANY_PRESET.contact_person,
          contactEmail: COMPANY_PRESET.email,
          contactPhone: COMPANY_PRESET.phone,
          quotedAmount: quotation.grandTotal
        },
        submissionEmail: rfpData.submission?.submission_email || rfpData.contact_email,
        emailSubject: `Bid Submission - ${rfpData.tender_id} - ${COMPANY_PRESET.name}`,
        emailBody: generateFormFillEmailBody(rfpData, quotation, COMPANY_PRESET),
        generatePdf: true
      };
      
    case 'MEETING_EMAIL':
      return {
        ...basePackage,
        mode: 'Schedule Meeting',
        instructions: [
          'Review the email draft below',
          'Click "Compose in Gmail" to open Gmail',
          'Add any additional queries or clarifications',
          'Send the email to schedule a pre-bid meeting'
        ],
        meetingEmail: rfpData.submission?.meeting_email || rfpData.contact_email,
        emailSubject: rfpData.submission?.meeting_subject || `Pre-bid Meeting Request - ${rfpData.tender_id} - ${COMPANY_PRESET.name}`,
        emailBody: generateMeetingEmailBody(rfpData, COMPANY_PRESET),
        meetingVenue: rfpData.submission?.meeting_venue || 'To be confirmed',
        generatePdf: false
      };
      
    case 'EXTERNAL_PORTAL':
      return {
        ...basePackage,
        mode: 'External Portal Registration',
        instructions: [
          `Register on portal: ${rfpData.submission?.portal_url || 'Portal URL not specified'}`,
          'Complete vendor registration if not already done',
          'Upload required documents',
          'Fill online bid form',
          'Submit before deadline'
        ],
        portalUrl: rfpData.submission?.portal_url || '',
        tenderUrl: rfpData.submission?.tender_url || '',
        registrationOpens: rfpData.submission?.registration_opens || 'Check portal',
        registrationCloses: rfpData.submission?.registration_closes || rfpData.due_date,
        calendarReminders: {
          deadline: {
            title: `RFP Deadline: ${rfpData.tender_id}`,
            date: rfpData.due_date,
            description: `Submit bid for ${rfpData.title} before this date`
          },
          registrationStart: rfpData.submission?.registration_opens ? {
            title: `Portal Opens: ${rfpData.tender_id}`,
            date: rfpData.submission.registration_opens,
            description: `Registration opens for ${rfpData.title}`
          } : null
        },
        generatePdf: false
      };
      
    default:
      return {
        ...basePackage,
        mode: 'Unknown',
        instructions: ['Submission mode not recognized. Please check RFP document.'],
        generatePdf: false
      };
  }
}

/**
 * Generate meeting email body
 */
function generateMeetingEmailBody(rfpData, company) {
  return `Dear Sir/Madam,

Subject: Request for Pre-Bid Meeting - ${rfpData.tender_id}

We, ${company.name}, are interested in participating in the tender for:

Tender ID: ${rfpData.tender_id}
Description: ${rfpData.title}
Due Date: ${new Date(rfpData.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}

We would like to request a pre-bid meeting to discuss the technical specifications and clarify any queries before formal submission.

Our proposed meeting slots:
1. [Please suggest suitable date/time]
2. [Alternative date/time]

We can attend the meeting at your office or via video conference as per your convenience.

Company Details:
- Company: ${company.name}
- Contact Person: ${company.contact_person}
- Designation: ${company.designation}
- Phone: ${company.phone}
- Email: ${company.email}

Looking forward to your response.

Best Regards,
${company.contact_person}
${company.designation}
${company.name}
${company.phone}`;
}

/**
 * Generate email body for PDF_FORM_FILL submission mode
 */
function generateFormFillEmailBody(rfpData, quotation, company) {
  const cableDetails = (rfpData.cable_requirements || []).map((req, idx) => 
    `${idx + 1}. ${req.voltage} ${req.cable_type} ${req.cores}C x ${req.size} - ${req.qty_km || 1} km`
  ).join('\n');

  return `Dear Sir/Madam,

Subject: Bid Submission for ${rfpData.tender_id} - ${rfpData.title}

We are pleased to submit our bid for the above-referenced tender.

TENDER DETAILS:
- Tender ID: ${rfpData.tender_id}
- Description: ${rfpData.title}
- Buyer: ${rfpData.organisation}
- Due Date: ${new Date(rfpData.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}

CABLE REQUIREMENTS:
${cableDetails}

OUR QUOTATION:
- Material Supply: Rs. ${quotation?.materialCost?.total?.toLocaleString('en-IN') || 'As per attached form'}
- Testing & Certification: Rs. ${quotation?.testingCost?.total?.toLocaleString('en-IN') || 'As per attached form'}
- GST @ 18%: Rs. ${quotation?.gst?.amount?.toLocaleString('en-IN') || 'As per attached form'}
- GRAND TOTAL: Rs. ${quotation?.grandTotal?.toLocaleString('en-IN') || 'As per attached form'}

ATTACHMENTS:
1. Signed Bid Response Form (Annexure-A)
2. Company Registration Certificate
3. GST Certificate
4. ISO/BIS Certificates (as applicable)

COMPANY DETAILS:
- Company: ${company.name}
- GSTIN: ${company.gstin}
- PAN: ${company.pan}
- Contact: ${company.contact_person}
- Phone: ${company.phone}
- Email: ${company.email}

We confirm that all information provided is accurate and we agree to the terms and conditions of the tender.

Best Regards,
${company.contact_person}
${company.designation}
${company.name}
${company.phone}`;
}

/**
 * Generate external testing email
 */
export function generateTestingEmail(rfpData, cableRequirements) {
  const testingCompany = TESTING_COMPANY;
  
  const cableDetails = cableRequirements.map((req, idx) => 
    `${idx + 1}. ${req.voltage} ${req.cable_type} ${req.cores}C x ${req.size} - ${req.qty_km || 1} km`
  ).join('\n');
  
  return {
    to: testingCompany.email,
    subject: `Request for Testing Quotation - ${rfpData.tender_id}`,
    body: `Dear Sir/Madam,

We are participating in a tender and require testing services for the following cables:

Tender Reference: ${rfpData.tender_id}
Client: ${rfpData.organisation}

Cable Details:
${cableDetails}

Tests Required:
- Type Tests as per relevant IS/IEC standards
- Routine Tests
- Acceptance Tests

Please provide:
1. Quotation for all required tests
2. Expected testing duration
3. Sample requirements
4. Available slots for testing

Our Contact Details:
Company: ${COMPANY_PRESET.name}
Contact: ${COMPANY_PRESET.contact_person}
Phone: ${COMPANY_PRESET.phone}
Email: ${COMPANY_PRESET.email}

Please respond at the earliest as the tender deadline is ${new Date(rfpData.due_date).toLocaleDateString('en-IN')}.

Best Regards,
${COMPANY_PRESET.contact_person}
${COMPANY_PRESET.name}`,
    testingCompany: testingCompany
  };
}

/**
 * Complete RFP analysis
 */
export function analyzeRFP(rfpData) {
  const cableRequirements = rfpData.cable_requirements || [];
  const testsRequired = rfpData.tests_required || [];
  const externalTestingRequired = rfpData.external_testing_required || false;
  
  // Calculate quotation (pass external testing flag)
  const quotation = calculateQuotation(cableRequirements, testsRequired, externalTestingRequired);
  
  // Extract terms
  const terms = extractTermsConditions(rfpData);
  
  // Get submission mode
  const submissionMode = rfpData.submission?.mode || 'UNKNOWN';
  
  // Generate submission package
  const submissionPackage = generateSubmissionPackage(rfpData, quotation, submissionMode);
  
  // Generate testing email ONLY if external testing required
  const testingEmail = externalTestingRequired 
    ? generateTestingEmail(rfpData, cableRequirements) 
    : null;
  
  return {
    rfpId: rfpData.tender_id,
    rfpTitle: rfpData.title,
    buyer: rfpData.organisation,
    dueDate: rfpData.due_date,
    cableRequirements: cableRequirements,
    quotation: quotation,
    termsConditions: terms,
    submissionMode: submissionMode,
    submissionPackage: submissionPackage,
    externalTestingRequired: externalTestingRequired,
    externalTestingInfo: rfpData.external_testing_info || null,
    testingEmail: testingEmail,
    summary: {
      totalItems: cableRequirements.length,
      totalMaterialCost: quotation.materialCost.total,
      totalTestingCost: quotation.testingCost.total,
      grandTotal: quotation.grandTotal,
      externalTestingRequired: externalTestingRequired,
      submissionMode: submissionMode
    }
  };
}

// Named exports
export { COMPANY_PRESET, TESTING_COMPANY };

export default {
  calculateMaterialCost,
  calculateTestingCost,
  calculateQuotation,
  extractTermsConditions,
  generateSubmissionPackage,
  generateTestingEmail,
  analyzeRFP,
  COMPANY_PRESET,
  TESTING_COMPANY
};

