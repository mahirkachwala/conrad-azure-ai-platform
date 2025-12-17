document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('tender-search-form');
  const resetBtn = document.getElementById('reset-btn');
  const resultContainer = document.getElementById('tender-list');
  const resultCount = document.getElementById('result-count');

  loadAllTenders();

  form.addEventListener('submit', function(event) {
    event.preventDefault();
    performSearch();
  });

  resetBtn.addEventListener('click', function() {
    form.reset();
    loadAllTenders();
  });

  function loadAllTenders() {
    fetch('/data/rfps.json')
      .then(response => response.json())
      .then(data => {
        displayResults(data);
      })
      .catch(error => {
        console.error('Error fetching tenders:', error);
        resultContainer.innerHTML = '<p class="error">Error loading tenders. Please try again.</p>';
      });
  }

  function performSearch() {
    const keyword = document.getElementById('keyword').value.toLowerCase().trim();
    const productCategory = document.getElementById('product-category').value;
    const tenderId = document.getElementById('tender-id').value.toLowerCase().trim();
    const city = document.getElementById('city').value.toLowerCase().trim();
    const dueDate = document.getElementById('due-date').value;
    const status = document.getElementById('status').value;

    fetch('/data/rfps.json')
      .then(response => response.json())
      .then(data => {
        const filteredResults = data.filter(tender => {
          let isKeywordMatch = true;
          if (keyword) {
            const keywords = keyword.split(/\s+/);
            const searchText = (tender.title + ' ' + tender.material + ' ' + tender.organisation).toLowerCase();
            isKeywordMatch = keywords.every(kw => {
              const kwSingular = kw.endsWith('s') && kw.length > 3 ? kw.slice(0, -1) : kw;
              return searchText.includes(kw) || searchText.includes(kwSingular);
            });
          }
          
          const isProductMatch = !productCategory || 
            tender.product_category === productCategory;
          
          const isTenderIdMatch = !tenderId || 
            tender.tender_id.toLowerCase().includes(tenderId);
          
          const isCityMatch = !city || 
            tender.city.toLowerCase().includes(city);
          
          const isDueDateMatch = !dueDate || 
            new Date(tender.due_date) <= new Date(dueDate);
          
          const isStatusMatch = !status || 
            tender.status === status;

          return isKeywordMatch && isProductMatch && isTenderIdMatch && 
                 isCityMatch && isDueDateMatch && isStatusMatch;
        });

        displayResults(filteredResults);
      })
      .catch(error => {
        console.error('Error fetching tenders:', error);
        resultContainer.innerHTML = '<p class="error">Error loading tenders. Please try again.</p>';
      });
  }

  function displayResults(tenders) {
    resultCount.textContent = tenders.length;
    
    if (tenders.length === 0) {
      resultContainer.innerHTML = '<p class="no-results">No tenders found matching your criteria. Try adjusting your search filters.</p>';
      return;
    }

    resultContainer.innerHTML = '';
    
    tenders.forEach(tender => {
      const tenderCard = document.createElement('div');
      tenderCard.classList.add('tender-card');
      tenderCard.setAttribute('data-tender-id', tender.tender_id);
      
      const statusClass = tender.status === 'closing-soon' ? 'status-closing' : 'status-active';
      const statusText = tender.status === 'closing-soon' ? 'Closing Soon' : 'Active';
      
      const dueDate = new Date(tender.due_date);
      const formattedDate = dueDate.toLocaleDateString('en-IN', { 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric' 
      });
      
      const formattedCost = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
      }).format(tender.estimated_cost_inr);

      tenderCard.innerHTML = `
        <h3 class="t-title">${tender.tender_id} - ${tender.title}</h3>
        <p class="t-org"><strong>Issuer:</strong> ${tender.organisation}</p>
        <p class="t-city"><strong>City:</strong> ${tender.city}</p>
        <p class="t-material"><strong>Material:</strong> ${tender.material}</p>
        <p class="t-due"><strong>Due Date:</strong> <time datetime="${tender.due_date}">${formattedDate}</time></p>
        <p class="t-cost"><strong>Estimated Cost:</strong> ${formattedCost}</p>
        <p class="t-status ${statusClass}"><strong>Status:</strong> ${statusText}</p>
        <p class="t-contact"><strong>Contact:</strong> <a href="mailto:${tender.contact_email}">${tender.contact_email}</a></p>
        <div class="tender-actions">
          <a href="${tender.detail_url}" class="btn-detail">View Details</a>
          ${tender.documents.map(doc => {
            const fileName = doc.split('/').pop();
            return `<a href="${doc}" class="btn-doc">${fileName}</a>`;
          }).join(' ')}
        </div>
      `;
      
      resultContainer.appendChild(tenderCard);
    });
  }
});
