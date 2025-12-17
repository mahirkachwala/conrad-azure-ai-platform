/**
 * Utilities & Infrastructure Hub Portal - Traditional Workflow
 */

const portalId = 'utilities';
const dataFeed = '/data/portals/utilities.json?v=' + Date.now();

let allTenders = [];

async function loadTenders() {
  try {
    const response = await fetch(dataFeed);
    allTenders = await response.json();
    console.log(`Loaded ${allTenders.length} tenders from ${portalId}`);
    return allTenders;
  } catch (error) {
    console.error('Error loading tenders:', error);
    return [];
  }
}

/**
 * Search tenders based on filter criteria
 * Searches through ALL cable requirements (not just primary)
 * So searching "Control Cable 1.1kV" finds RFPs with Control Cable as 2nd/3rd item
 */
function searchTenders(filters) {
  let results = [...allTenders];
  
  console.log('Searching with filters:', filters);

  // Keyword filter - searches through all cable requirements
  // ALL keywords must match (AND logic)
  if (filters.keyword && filters.keyword.trim() !== '') {
    const keywords = filters.keyword.toLowerCase().split(/\s+/).filter(k => k.length > 0);
    results = results.filter(tender => {
      let searchText = [
        tender.title || '',
        tender.material || '',
        tender.organisation || '',
        tender.cable_type || '',
        tender.city || '',
        tender.search_index || '',
        tender.combined_title || ''
      ].join(' ').toLowerCase();
      
      // Add text from cable_requirements array
      if (tender.cable_requirements && Array.isArray(tender.cable_requirements)) {
        tender.cable_requirements.forEach(req => {
          searchText += ` ${req.cable_type} ${req.voltage} ${req.conductor} ${req.size} ${req.cores} ${req.insulation}`.toLowerCase();
        });
      }
      
      // ALL keywords must be found (AND logic)
      return keywords.every(kw => {
        const kwSingular = kw.endsWith('s') && kw.length > 3 ? kw.slice(0, -1) : kw;
        return searchText.includes(kw) || searchText.includes(kwSingular);
      });
    });
  }

  // Category filter
  if (filters.category && filters.category !== '') {
    const categoryMap = {
      'wires-cables': ['Wires & Cables', 'wires-cables', 'cables', 'wire'],
      'transformers': ['Transformers', 'transformers', 'transformer'],
      'fmcg-packaging': ['FMCG Packaging', 'fmcg-packaging', 'fmcg']
    };
    const validValues = categoryMap[filters.category] || [filters.category];
    results = results.filter(tender => {
      const cat = (tender.product_category || tender.category || '').toLowerCase();
      return validValues.some(v => cat.includes(v.toLowerCase()));
    });
  }

  // Cable Type filter - searches ALL cable requirements
  if (filters.cableType && filters.cableType !== '') {
    const cableTypeMap = {
      'ht-cable': ['ht cable', 'high tension'],
      'lt-cable': ['lt cable', 'low tension'],
      'control-cable': ['control cable'],
      'ehv-cable': ['ehv cable', 'extra high'],
      'instrumentation-cable': ['instrumentation cable', 'instrumentation']
    };
    const searchTerms = cableTypeMap[filters.cableType] || [filters.cableType];
    
    results = results.filter(tender => {
      const primaryType = (tender.cable_type || '').toLowerCase();
      if (searchTerms.some(term => primaryType.includes(term.toLowerCase()))) {
        return true;
      }
      
      if (tender.cable_requirements && Array.isArray(tender.cable_requirements)) {
        return tender.cable_requirements.some(req => {
          const reqType = (req.cable_type || '').toLowerCase();
          return searchTerms.some(term => reqType.includes(term.toLowerCase()));
        });
      }
      
      const text = (tender.title + ' ' + tender.material).toLowerCase();
      return searchTerms.some(term => text.includes(term.toLowerCase()));
    });
  }

  // Voltage filter - searches ALL cable requirements
  if (filters.voltage && filters.voltage !== '') {
    const voltageValue = filters.voltage.toLowerCase().replace('kv', '');
    
    results = results.filter(tender => {
      const text = (tender.title + ' ' + tender.material).toLowerCase();
      if (text.includes(voltageValue + 'kv') || text.includes(voltageValue + ' kv')) {
        return true;
      }
      
      if (tender.cable_requirements && Array.isArray(tender.cable_requirements)) {
        return tender.cable_requirements.some(req => {
          const reqVoltage = (req.voltage || '').toLowerCase();
          return reqVoltage.includes(voltageValue);
        });
      }
      
      return false;
    });
  }

  // City filter
  if (filters.city && filters.city.trim() !== '') {
    const citySearch = filters.city.toLowerCase().trim();
    results = results.filter(tender => {
      const tenderCity = (tender.city || '').toLowerCase();
      return tenderCity.includes(citySearch);
    });
  }

  // Due date filter
  if (filters.dueDate && filters.dueDate !== '') {
    const filterDate = new Date(filters.dueDate);
    filterDate.setHours(23, 59, 59);
    results = results.filter(tender => {
      const tenderDate = new Date(tender.due_date);
      return tenderDate <= filterDate;
    });
  }

  console.log('Search results:', results.length);
  return results;
}

/**
 * Render tender cards - UTILITIES PORTAL: MEDIUM INFO
 * Shows: RFP ID, Buyer, ALL Cable Types Required, Location, Due Date, Download button
 * Due date matches exactly what's in the PDF
 */
function renderTenders(tenders) {
  const listEl = document.getElementById('tender-list');
  const countEl = document.getElementById('result-count');

  countEl.textContent = tenders.length;

  if (tenders.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No tenders found matching your criteria.</div>';
    return;
  }

  listEl.innerHTML = tenders.map(tender => {
    // Format date exactly as it appears in the PDF
    const dueDate = new Date(tender.due_date);
    const formattedDate = dueDate.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
    const formattedTime = dueDate.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    
    // Get ALL cable types from cable_requirements
    let cableTypesHTML = '';
    const itemCount = tender.cable_requirements ? tender.cable_requirements.length : 1;
    
    if (tender.cable_requirements && tender.cable_requirements.length > 0) {
      cableTypesHTML = tender.cable_requirements.map((req, idx) => 
        `<div class="cable-item">
          <span class="item-num">${idx + 1}.</span>
          <span class="cable-name">${req.cable_type}</span>
          <span class="cable-voltage">${req.voltage}</span>
        </div>`
      ).join('');
    } else {
      const cableType = tender.cable_type || extractCableType(tender.title || tender.material);
      cableTypesHTML = `<div class="cable-item"><span class="cable-name">${cableType}</span></div>`;
    }
    
    return `
    <div class="tender-card" data-tender-id="${tender.tender_id}">
      <div class="card-header">
        <span class="rfp-id">${tender.tender_id}</span>
        ${itemCount > 1 ? `<span class="multi-item-badge">${itemCount} Items</span>` : ''}
      </div>
      
      <div class="buyer-section">
        <div class="buyer-label">BUYER ORGANIZATION</div>
        <div class="buyer-name">${tender.organisation || 'Utility Company'}</div>
      </div>
      
      <div class="card-info">
        <div class="info-row cable-requirements">
          <span class="info-label">Cable Requirements:</span>
          <div class="cable-list">${cableTypesHTML}</div>
        </div>
        <div class="info-row">
          <span class="info-label">Location:</span>
          <span class="info-value">${tender.city || 'India'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Due Date:</span>
          <span class="info-value">${formattedDate} at ${formattedTime}</span>
        </div>
      </div>

      <div class="card-actions">
        <a href="${tender.pdf_url || '/rfps/' + tender.tender_id + '.pdf'}" class="btn-download-rfp" target="_blank">
          Download RFP PDF
        </a>
      </div>
    </div>
  `}).join('');
}

/**
 * Extract cable type from title/material string
 */
function extractCableType(text) {
  if (!text) return 'Power Cable';
  const lower = text.toLowerCase();
  if (lower.includes('ehv') || lower.includes('66kv') || lower.includes('110kv') || lower.includes('132kv')) return 'EHV Cable';
  if (lower.includes('ht') || lower.includes('11kv') || lower.includes('22kv') || lower.includes('33kv')) return 'HT Cable';
  if (lower.includes('control')) return 'Control Cable';
  if (lower.includes('instrument')) return 'Instrumentation Cable';
  if (lower.includes('lt') || lower.includes('1.1kv')) return 'LT Cable';
  return 'Power Cable';
}

/**
 * Toggle cable filters visibility
 */
function toggleCableFilters() {
  const category = document.getElementById('category').value;
  const cableFilters = document.getElementById('cable-filters');
  
  if (category === 'wires-cables') {
    cableFilters.style.display = 'block';
  } else {
    cableFilters.style.display = 'none';
    document.getElementById('cable-type').value = '';
    document.getElementById('voltage').value = '';
  }
}

function clearError(field) {
  if (!field) return;
  field.classList.remove('field-error');
  const errorMsg = field.parentElement.querySelector('.error-message');
  if (errorMsg) errorMsg.remove();
}

function showError(field, message) {
  if (!field) return;
  field.classList.add('field-error');
  const existingError = field.parentElement.querySelector('.error-message');
  if (existingError) existingError.remove();
  
  const errorEl = document.createElement('span');
  errorEl.className = 'error-message';
  errorEl.textContent = message;
  field.parentElement.appendChild(errorEl);
}

// Add styles
const portalStyles = document.createElement('style');
portalStyles.textContent = `
  .field-error { border: 2px solid #dc3545 !important; background-color: #fff5f5 !important; }
  .error-message { color: #dc3545; font-size: 12px; display: block; margin-top: 4px; }
  .required { color: #dc3545; }
  .required-note { color: #666; font-size: 12px; margin: 10px 0; }
  
  .tender-card {
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 15px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
    padding-bottom: 10px;
    border-bottom: 1px solid #eee;
  }
  .rfp-id {
    font-family: monospace;
    font-size: 14px;
    font-weight: bold;
    color: #744210;
    background: #fffbeb;
    padding: 4px 10px;
    border-radius: 4px;
  }
  .deadline-badge {
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 4px;
    font-weight: 500;
  }
  .deadline-badge.far { background: #d4edda; color: #155724; }
  .deadline-badge.normal { background: #cce5ff; color: #004085; }
  .deadline-badge.action { background: #fff3cd; color: #856404; }
  .deadline-badge.close { background: #ffe5d0; color: #d35400; }
  .deadline-badge.urgent { background: #f8d7da; color: #721c24; font-weight: bold; }
  .deadline-badge.closed { background: #6c757d; color: white; }
  .cable-type { color: #d69e2e; font-weight: 600; }
  .buyer-section { margin-bottom: 15px; }
  .buyer-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .buyer-name { font-size: 18px; font-weight: 600; color: #744210; }
  .card-info { margin-bottom: 15px; }
  .info-row { display: flex; gap: 10px; margin-bottom: 6px; font-size: 14px; }
  .info-label { color: #666; min-width: 80px; }
  .info-value { color: #333; font-weight: 500; }
  .card-actions { text-align: center; }
  .btn-download-rfp {
    display: inline-block;
    background: #d69e2e;
    color: white;
    padding: 10px 24px;
    border-radius: 5px;
    text-decoration: none;
    font-weight: 500;
  }
  .btn-download-rfp:hover { background: #b7791f; }
  .cable-filters {
    background: #fffbeb;
    padding: 15px;
    border-radius: 5px;
    margin: 10px 0;
    border: 1px dashed #d69e2e;
  }
  .empty-state { text-align: center; padding: 40px; color: #666; }
  
  /* Multi-item badge */
  .multi-item-badge {
    background: #28a745;
    color: white;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 10px;
    font-weight: 600;
  }
  
  /* Cable requirements list */
  .cable-requirements {
    flex-direction: column;
    align-items: flex-start;
  }
  .cable-list {
    margin-top: 5px;
    width: 100%;
  }
  .cable-item {
    display: flex;
    gap: 8px;
    padding: 5px 10px;
    margin-bottom: 4px;
    background: #fffbeb;
    border-radius: 4px;
    border-left: 3px solid #d69e2e;
    font-size: 13px;
  }
  .item-num {
    color: #666;
    font-weight: 600;
  }
  .cable-name {
    color: #744210;
    font-weight: 600;
  }
  .cable-voltage {
    color: #666;
  }
`;
document.head.appendChild(portalStyles);

// Event listeners
document.getElementById('category').addEventListener('change', toggleCableFilters);

document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  
  const keyword = document.getElementById('keyword');
  const category = document.getElementById('category');
  const cableType = document.getElementById('cable-type');
  const voltage = document.getElementById('voltage');
  const city = document.getElementById('city');
  const dueDate = document.getElementById('due-date');
  
  [keyword, category, cableType, voltage, city, dueDate].forEach(clearError);
  
  let isValid = true;
  
  if (!keyword.value.trim()) { showError(keyword, 'Keywords required'); isValid = false; }
  if (!category.value) { showError(category, 'Category required'); isValid = false; }
  if (!city.value.trim()) { showError(city, 'City required'); isValid = false; }
  if (!dueDate.value) { showError(dueDate, 'Due date required'); isValid = false; }
  
  if (!isValid) return;
  
  const filters = {
    keyword: keyword.value,
    category: category.value,
    cableType: cableType ? cableType.value : '',
    voltage: voltage ? voltage.value : '',
    city: city.value,
    dueDate: dueDate.value
  };

  renderTenders(searchTenders(filters));
});

// Initialize
loadTenders().then(() => {
  renderTenders(allTenders);
  
  const dueDateField = document.getElementById('due-date');
  if (dueDateField) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 180); // Extended to 6 months
    dueDateField.value = futureDate.toISOString().split('T')[0];
  }
});
