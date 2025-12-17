export const TAG_TO_VENDORS = {
  cable: [
    'Polycab India Limited',
    'KEI Industries Limited',
    'Havells India Limited',
    'Finolex Cables Limited',
    'RR Kabel Limited',
    'Universal Cables Limited',
    'Torrent Cables Limited',
    'Gloster Cables Limited'
  ],
  xlpe: [
    'Polycab India Limited',
    'KEI Industries Limited',
    'Universal Cables Limited'
  ],
  transformer: [
    'ABB India Limited',
    'Siemens Limited',
    'CG Power and Industrial Solutions Limited',
    'Bharat Heavy Electricals Limited',
    'Voltamp Transformers Limited',
    'Transformers and Rectifiers (India) Limited',
    'Kirloskar Electric Company Limited'
  ],
  switchgear: [
    'Larsen & Toubro Limited',
    'Schneider Electric India Private Limited',
    'ABB India Limited',
    'Siemens Limited',
    'Eaton Power Quality Private Limited',
    'GE T&D India Limited'
  ],
  breaker: [
    'Larsen & Toubro Limited',
    'Schneider Electric India Private Limited',
    'ABB India Limited',
    'Siemens Limited'
  ],
  conductor: [
    'Apar Industries Limited',
    'Sterlite Power Transmission Limited',
    'Diamond Power Infrastructure Limited',
    'KEI Industries Limited'
  ],
  aac: [
    'Apar Industries Limited',
    'Sterlite Power Transmission Limited'
  ],
  acsr: [
    'Apar Industries Limited',
    'Sterlite Power Transmission Limited',
    'Diamond Power Infrastructure Limited'
  ],
  oil: [
    'Indian Oil Corporation Limited',
    'Bharat Petroleum Corporation Limited',
    'Hindustan Petroleum Corporation Limited'
  ],
  lubricant: [
    'Indian Oil Corporation Limited',
    'Bharat Petroleum Corporation Limited',
    'Hindustan Petroleum Corporation Limited',
    'Castrol India Limited'
  ]
};

// Additional vendors to ensure we have 30+ for proper distribution
const ADDITIONAL_VENDORS = [
  'Tata Power Company Limited',
  'Reliance Infrastructure Limited',
  'Power Grid Corporation of India Limited',
  'Adani Transmission Limited',
  'Crompton Greaves Consumer Electricals Limited'
];

export const SEED_VENDORS = Array.from(new Set([...Object.values(TAG_TO_VENDORS).flat(), ...ADDITIONAL_VENDORS]));

export function getVendorsForTags(tags = []) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return SEED_VENDORS;
  }
  
  const vendors = new Set();
  tags.forEach(tag => {
    const tagLower = tag.toLowerCase();
    const vendorList = TAG_TO_VENDORS[tagLower];
    if (vendorList) {
      vendorList.forEach(v => vendors.add(v));
    }
  });
  
  return Array.from(vendors);
}

export function inferCategoryFromTitle(title = '') {
  const text = title.toLowerCase();
  
  if (text.includes('cable') || text.includes('xlpe') || text.includes('pvc')) {
    return 'Wires & Cables';
  }
  if (text.includes('transformer')) {
    return 'Transformers';
  }
  if (text.includes('switchgear') || text.includes('breaker')) {
    return 'Switchgear';
  }
  if (text.includes('conductor') || text.includes('aac') || text.includes('acsr')) {
    return 'Conductors';
  }
  if (text.includes('lubricant') || text.includes('oil')) {
    return 'Lubricants';
  }
  
  return 'Electrical';
}

export function inferTagsFromTitle(title = '') {
  const text = title.toLowerCase();
  const tags = [];
  
  const keywords = ['cable', 'xlpe', 'lt', 'ht', 'transformer', 'breaker', 'switchgear', 
                    'conductor', 'aac', 'acsr', 'oil', 'lubricant', 'pvc'];
  
  keywords.forEach(keyword => {
    if (text.includes(keyword)) {
      tags.push(keyword);
    }
  });
  
  return Array.from(new Set(tags));
}
