document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('analysis-form');
  const loading = document.getElementById('loading');
  const results = document.getElementById('results');
  const errorDiv = document.getElementById('error');
  const analyzeBtn = document.getElementById('analyze-btn');

  form.addEventListener('submit', async function(event) {
    event.preventDefault();
    
    const keyword = document.getElementById('search-keyword').value.trim();
    const category = document.getElementById('search-category').value;
    const city = document.getElementById('search-city').value.trim();

    loading.classList.add('active');
    results.style.display = 'none';
    errorDiv.style.display = 'none';
    analyzeBtn.disabled = true;

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ keyword, category, city })
      });

      if (!response.ok) {
        throw new Error('Analysis failed');
      }

      const data = await response.json();
      displayResults(data);
    } catch (error) {
      console.error('Error:', error);
      showError('Failed to scrape and analyze tender data. Please try again.');
    } finally {
      loading.classList.remove('active');
      analyzeBtn.disabled = false;
    }
  });

  function displayResults(data) {
    results.style.display = 'block';
    
    const statsDiv = document.getElementById('stats');
    statsDiv.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${data.totalTenders}</div>
        <div class="stat-label">Total Tenders Found</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">₹${formatCurrency(data.totalValue)}</div>
        <div class="stat-label">Total Estimated Value</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">₹${formatCurrency(data.avgValue)}</div>
        <div class="stat-label">Average Tender Value</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${data.categories.length}</div>
        <div class="stat-label">Product Categories</div>
      </div>
    `;

    const tenderList = document.getElementById('tender-list');
    if (data.tenders.length === 0) {
      tenderList.innerHTML = '<p>No tenders found matching your criteria.</p>';
      return;
    }

    tenderList.innerHTML = '<h3>Scraped Tender Data</h3>';
    data.tenders.forEach(tender => {
      const tenderDiv = document.createElement('div');
      tenderDiv.classList.add('tender-item');
      
      tenderDiv.innerHTML = `
        <h3>${tender.tender_id} - ${tender.title}</h3>
        <div class="tender-meta">
          <div class="tender-meta-item">
            <strong>Organization:</strong> ${tender.organisation}
          </div>
          <div class="tender-meta-item">
            <strong>Category:</strong> ${tender.product_category}
          </div>
          <div class="tender-meta-item">
            <strong>City:</strong> ${tender.city}
          </div>
          <div class="tender-meta-item">
            <strong>Material:</strong> ${tender.material}
          </div>
          <div class="tender-meta-item">
            <strong>Estimated Cost:</strong> ₹${formatCurrency(tender.estimated_cost_inr)}
          </div>
          <div class="tender-meta-item">
            <strong>Due Date:</strong> ${new Date(tender.due_date).toLocaleDateString('en-IN')}
          </div>
          <div class="tender-meta-item">
            <strong>Status:</strong> ${tender.status}
          </div>
          <div class="tender-meta-item">
            <strong>Contact:</strong> ${tender.contact_email}
          </div>
        </div>
        <div style="margin-top: 12px;">
          <a href="${tender.detail_url}" target="_blank" style="color: #009688; text-decoration: none; font-weight: 600;">
            View Full Details →
          </a>
        </div>
      `;
      
      tenderList.appendChild(tenderDiv);
    });
  }

  function showError(message) {
    errorDiv.style.display = 'block';
    document.getElementById('error-message').textContent = message;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: 0
    }).format(value);
  }
});
