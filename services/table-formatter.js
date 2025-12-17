/**
 * Table Formatter Module
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Creates clean, structured output tables that match EY's expected format.
 * This is critical for the 25% "Structured Output" scoring category.
 */

/**
 * Format currency in Indian Rupees
 */
export function formatINR(amount, decimals = 0) {
  if (amount === null || amount === undefined) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  }).format(amount);
}

/**
 * Format large amounts in Lakhs/Crores
 */
export function formatLakhsCrores(amount) {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)} Cr`;
  } else if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(2)} L`;
  }
  return formatINR(amount);
}

/**
 * Generate SKU Recommendation Table (EY Format)
 * 
 * | RFP Product | Recommended SKU | Spec Match % | Unit Price |
 * |-------------|-----------------|--------------|------------|
 */
export function generateSKURecommendationTable(matches) {
  const table = {
    title: 'SKU RECOMMENDATION TABLE',
    headers: ['RFP Product', 'Recommended SKU', 'Spec Match %', 'Unit Price/km'],
    rows: [],
    footer: null
  };
  
  for (const match of matches) {
    table.rows.push([
      truncateText(match.rfp_product || match.rfp_product_description, 40),
      match.recommended_sku || match.sku_id,
      `${match.spec_match || match.spec_match_percentage}%`,
      formatINR(match.unit_price)
    ]);
  }
  
  // Calculate average spec match for footer
  const avgMatch = matches.length > 0
    ? Math.round(matches.reduce((sum, m) => sum + (m.spec_match || m.spec_match_percentage || 0), 0) / matches.length)
    : 0;
  
  table.footer = `Average Spec Match: ${avgMatch}% | Total Items: ${matches.length}`;
  
  return table;
}

/**
 * Generate Pricing Table (EY Format)
 * 
 * | Product | SKU | Qty (km) | Unit Price | Product Cost | Test Cost | Total |
 * |---------|-----|----------|------------|--------------|-----------|-------|
 */
export function generatePricingTable(pricingItems) {
  const table = {
    title: 'PRICING TABLE',
    headers: ['Product', 'SKU', 'Qty (km)', 'Unit Price', 'Product Cost', 'Test Cost', 'Total'],
    rows: [],
    totals: {
      total_product_cost: 0,
      total_test_cost: 0,
      grand_total: 0
    }
  };
  
  for (const item of pricingItems) {
    const productCost = (item.unit_price || 0) * (item.quantity_km || 0);
    const testCost = item.test_cost || 0;
    const total = productCost + testCost;
    
    table.rows.push([
      truncateText(item.product_name || item.rfp_product, 30),
      item.sku_id,
      item.quantity_km || 0,
      formatINR(item.unit_price),
      formatINR(productCost),
      formatINR(testCost),
      formatINR(total)
    ]);
    
    table.totals.total_product_cost += productCost;
    table.totals.total_test_cost += testCost;
    table.totals.grand_total += total;
  }
  
  return table;
}

/**
 * Generate Comparison Table for Top 3 SKUs
 * 
 * | Rank | SKU ID | Product Name | Spec Match | Matched Specs | Unmatched | Price |
 * |------|--------|--------------|------------|---------------|-----------|-------|
 */
export function generateComparisonTable(rfpProduct, topMatches) {
  const table = {
    title: `COMPARISON TABLE: ${truncateText(rfpProduct, 50)}`,
    headers: ['Rank', 'SKU ID', 'Product Name', 'Spec Match', 'Matched Specs', 'Unmatched', 'Price/km'],
    rows: [],
    recommendation: null
  };
  
  topMatches.forEach((match, idx) => {
    const matchedSpecs = match.match_details?.matched?.map(m => m.spec).join(', ') || 
                         match.matched_specs || '-';
    const unmatchedSpecs = match.match_details?.unmatched?.map(m => m.spec).join(', ') || 
                           match.unmatched_specs || 'None';
    
    table.rows.push([
      idx + 1,
      match.sku_id,
      truncateText(match.product_name, 25),
      `${match.spec_match_percentage || match.spec_match}%`,
      truncateText(matchedSpecs, 30),
      truncateText(unmatchedSpecs, 20),
      formatINR(match.unit_price)
    ]);
  });
  
  if (topMatches.length > 0) {
    table.recommendation = {
      sku: topMatches[0].sku_id,
      product: topMatches[0].product_name,
      score: topMatches[0].spec_match_percentage || topMatches[0].spec_match
    };
  }
  
  return table;
}

/**
 * Generate Final Consolidated Table (Master Agent Output)
 * This is THE KEY TABLE that EY judges will look at
 * 
 * | RFP Product | Recommended SKU | Spec Match % | Unit Price | Test Cost | Total |
 * |-------------|-----------------|--------------|------------|-----------|-------|
 */
export function generateConsolidatedTable(rfpData, skuMatches, pricingData) {
  const table = {
    title: 'CONSOLIDATED RFP RESPONSE TABLE',
    rfp_info: {
      rfp_id: rfpData.rfp_id || rfpData.tender_id,
      buyer: rfpData.buyer || rfpData.organisation,
      due_date: rfpData.due_date,
      title: rfpData.title
    },
    headers: ['RFP Product', 'Recommended SKU', 'Spec Match %', 'Unit Price', 'Test Cost', 'Total'],
    rows: [],
    summary: {
      total_line_items: 0,
      average_spec_match: 0,
      total_product_value: 0,
      total_test_value: 0,
      grand_total: 0,
      gst: 0,
      final_bid_value: 0
    }
  };
  
  let totalSpecMatch = 0;
  
  // Merge SKU matches with pricing
  for (let i = 0; i < skuMatches.length; i++) {
    const sku = skuMatches[i];
    const pricing = pricingData[i] || {};
    
    const specMatch = sku.spec_match_percentage || sku.spec_match || 0;
    const unitPrice = sku.unit_price || 0;
    const testCost = pricing.test_cost || 0;
    const quantity = pricing.quantity_km || 1;
    const productCost = unitPrice * quantity;
    const total = productCost + testCost;
    
    table.rows.push([
      truncateText(sku.rfp_product || sku.product_name, 35),
      sku.sku_id || sku.recommended_sku,
      `${specMatch}%`,
      formatINR(unitPrice),
      formatINR(testCost),
      formatINR(total)
    ]);
    
    totalSpecMatch += specMatch;
    table.summary.total_product_value += productCost;
    table.summary.total_test_value += testCost;
    table.summary.grand_total += total;
  }
  
  table.summary.total_line_items = skuMatches.length;
  table.summary.average_spec_match = skuMatches.length > 0 
    ? Math.round(totalSpecMatch / skuMatches.length) 
    : 0;
  table.summary.gst = Math.round(table.summary.grand_total * 0.18);
  table.summary.final_bid_value = table.summary.grand_total + table.summary.gst;
  
  return table;
}

/**
 * Generate Test Cost Summary Table
 */
export function generateTestCostTable(tests) {
  const table = {
    title: 'TEST COST SUMMARY',
    headers: ['Test ID', 'Test Name', 'Standard', 'Price', 'Duration'],
    rows: [],
    totals: {
      total_cost: 0,
      total_days: 0
    }
  };
  
  for (const test of tests) {
    table.rows.push([
      test.test_id,
      test.test_name || test.name,
      test.standard || '-',
      formatINR(test.price_inr || test.price || test.cost),
      `${test.duration_days || test.days || 0} days`
    ]);
    
    table.totals.total_cost += (test.price_inr || test.price || test.cost || 0);
    table.totals.total_days += (test.duration_days || test.days || 0);
  }
  
  return table;
}

/**
 * Convert table to ASCII format for console/log display
 */
export function tableToASCII(table) {
  let output = '\n';
  
  // Title
  if (table.title) {
    const titleLine = `═══ ${table.title} ═══`;
    output += titleLine + '\n';
  }
  
  // RFP Info if present
  if (table.rfp_info) {
    output += `RFP: ${table.rfp_info.rfp_id} | Buyer: ${table.rfp_info.buyer}\n`;
    output += `Title: ${table.rfp_info.title}\n`;
    output += `Due: ${table.rfp_info.due_date}\n`;
    output += '─'.repeat(70) + '\n';
  }
  
  // Calculate column widths
  const allRows = [table.headers, ...table.rows];
  const colWidths = table.headers.map((_, i) => 
    Math.max(...allRows.map(row => String(row[i] || '').length)) + 2
  );
  
  // Header row
  const headerRow = table.headers.map((h, i) => 
    String(h).padEnd(colWidths[i])
  ).join('│');
  output += '│' + headerRow + '│\n';
  output += '├' + colWidths.map(w => '─'.repeat(w)).join('┼') + '┤\n';
  
  // Data rows
  for (const row of table.rows) {
    const dataRow = row.map((cell, i) => 
      String(cell || '').padEnd(colWidths[i])
    ).join('│');
    output += '│' + dataRow + '│\n';
  }
  
  // Footer/Totals
  if (table.footer) {
    output += '─'.repeat(70) + '\n';
    output += table.footer + '\n';
  }
  
  if (table.totals) {
    output += '─'.repeat(70) + '\n';
    if (table.totals.total_cost !== undefined) {
      output += `Total Cost: ${formatINR(table.totals.total_cost)}`;
    }
    if (table.totals.grand_total !== undefined) {
      output += `Grand Total: ${formatINR(table.totals.grand_total)}`;
    }
    output += '\n';
  }
  
  if (table.summary) {
    output += '═'.repeat(70) + '\n';
    output += `SUMMARY\n`;
    output += `├ Line Items: ${table.summary.total_line_items}\n`;
    output += `├ Avg Spec Match: ${table.summary.average_spec_match}%\n`;
    output += `├ Product Value: ${formatLakhsCrores(table.summary.total_product_value)}\n`;
    output += `├ Test Value: ${formatLakhsCrores(table.summary.total_test_value)}\n`;
    output += `├ Subtotal: ${formatLakhsCrores(table.summary.grand_total)}\n`;
    output += `├ GST (18%): ${formatLakhsCrores(table.summary.gst)}\n`;
    output += `└ FINAL BID: ${formatLakhsCrores(table.summary.final_bid_value)}\n`;
  }
  
  if (table.recommendation) {
    output += '─'.repeat(70) + '\n';
    output += `★ RECOMMENDATION: ${table.recommendation.sku} - ${table.recommendation.product} (${table.recommendation.score}% match)\n`;
  }
  
  return output;
}

/**
 * Convert table to JSON for API responses
 */
export function tableToJSON(table) {
  return {
    title: table.title,
    rfp_info: table.rfp_info || null,
    data: table.rows.map(row => {
      const obj = {};
      table.headers.forEach((header, i) => {
        obj[header.toLowerCase().replace(/[^a-z0-9]/g, '_')] = row[i];
      });
      return obj;
    }),
    totals: table.totals || null,
    summary: table.summary || null,
    recommendation: table.recommendation || null,
    footer: table.footer || null
  };
}

/**
 * Convert table to HTML for web display
 */
export function tableToHTML(table) {
  let html = '<div class="ey-table-container">\n';
  
  if (table.title) {
    html += `  <h3 class="table-title">${escapeHTML(table.title)}</h3>\n`;
  }
  
  if (table.rfp_info) {
    html += `  <div class="rfp-info">
      <span class="rfp-id">RFP: ${escapeHTML(table.rfp_info.rfp_id)}</span>
      <span class="buyer">Buyer: ${escapeHTML(table.rfp_info.buyer)}</span>
      <span class="due-date">Due: ${escapeHTML(table.rfp_info.due_date)}</span>
    </div>\n`;
  }
  
  html += '  <table class="ey-table">\n';
  
  // Header
  html += '    <thead><tr>\n';
  for (const header of table.headers) {
    html += `      <th>${escapeHTML(header)}</th>\n`;
  }
  html += '    </tr></thead>\n';
  
  // Body
  html += '    <tbody>\n';
  for (const row of table.rows) {
    html += '      <tr>\n';
    for (const cell of row) {
      html += `        <td>${escapeHTML(String(cell))}</td>\n`;
    }
    html += '      </tr>\n';
  }
  html += '    </tbody>\n';
  
  html += '  </table>\n';
  
  // Summary
  if (table.summary) {
    html += `  <div class="table-summary">
      <div class="summary-row"><span>Line Items:</span> <strong>${table.summary.total_line_items}</strong></div>
      <div class="summary-row"><span>Avg Spec Match:</span> <strong>${table.summary.average_spec_match}%</strong></div>
      <div class="summary-row"><span>Grand Total:</span> <strong>${formatLakhsCrores(table.summary.grand_total)}</strong></div>
      <div class="summary-row highlight"><span>Final Bid (incl GST):</span> <strong>${formatLakhsCrores(table.summary.final_bid_value)}</strong></div>
    </div>\n`;
  }
  
  if (table.recommendation) {
    html += `  <div class="recommendation">
      <span class="star">★</span> RECOMMENDED: ${escapeHTML(table.recommendation.sku)} 
      - ${escapeHTML(table.recommendation.product)} (${table.recommendation.score}% match)
    </div>\n`;
  }
  
  html += '</div>';
  
  return html;
}

/**
 * Helper: Truncate text with ellipsis
 */
function truncateText(text, maxLen) {
  if (!text) return '';
  text = String(text);
  return text.length > maxLen ? text.substring(0, maxLen - 3) + '...' : text;
}

/**
 * Helper: Escape HTML special characters
 */
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default {
  formatINR,
  formatLakhsCrores,
  generateSKURecommendationTable,
  generatePricingTable,
  generateComparisonTable,
  generateConsolidatedTable,
  generateTestCostTable,
  tableToASCII,
  tableToJSON,
  tableToHTML
};











