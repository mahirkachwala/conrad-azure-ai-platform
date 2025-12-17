import dayjs from 'dayjs';

export function computeFeasibility({ rfp, company }) {
  if (!rfp) {
    return { 
      score: 0, 
      label: 'Unknown', 
      reasons: ['RFP data not available'] 
    };
  }
  
  const now = dayjs();
  const dueDate = rfp.dueDate ? dayjs(rfp.dueDate) : null;
  const daysLeft = dueDate ? dueDate.diff(now, 'day') : -1;
  
  const hasCerts = company?.bis || company?.iso9001 || 
                   (company?.certifications && company.certifications.length > 0) ? 1 : 0;
  
  const deliveryFit = rfp.city && company?.regions?.includes?.(rfp.city) ? 1 : 
                     rfp.city && company?.city === rfp.city ? 1 : 0.6;
  
  const companyCapacity = company?.avgOrderCap || company?.annual_revenue || null;
  const costOK = (rfp.estCost && companyCapacity) ? 
                 (rfp.estCost <= companyCapacity ? 1 : 0.5) : 0.6;
  
  const weights = { 
    time: 0.25, 
    certs: 0.25, 
    delivery: 0.25, 
    cost: 0.25 
  };
  
  let timeScore = 0.4;
  if (daysLeft >= 7) timeScore = 1;
  else if (daysLeft >= 3) timeScore = 0.7;
  else if (daysLeft >= 1) timeScore = 0.5;
  else if (daysLeft < 0) timeScore = 0;
  
  const score01 = weights.time * timeScore + 
                  weights.certs * hasCerts + 
                  weights.delivery * deliveryFit + 
                  weights.cost * costOK;
  
  const score = Math.round(score01 * 100);
  
  const reasons = [];
  
  if (daysLeft >= 0) {
    reasons.push(`⏰ Days remaining: ${daysLeft} ${daysLeft >= 7 ? '(Good)' : daysLeft >= 3 ? '(Moderate)' : '(Tight)'}`);
  } else {
    reasons.push(`❌ Deadline passed ${Math.abs(daysLeft)} days ago`);
  }
  
  if (hasCerts) {
    reasons.push('✅ Required certifications present (BIS/ISO)');
  } else {
    reasons.push('⚠️ Missing standard certifications (BIS/ISO)');
  }
  
  if (deliveryFit >= 1) {
    reasons.push(`✅ Delivery location is a match (${rfp.city || 'N/A'})`);
  } else if (deliveryFit > 0.5) {
    reasons.push(`⚠️ Delivery location is feasible but new (${rfp.city || 'N/A'})`);
  } else {
    reasons.push(`❌ Delivery location may be challenging (${rfp.city || 'N/A'})`);
  }
  
  if (costOK >= 1) {
    reasons.push(`✅ Estimated cost within typical capacity (₹${rfp.estCost?.toLocaleString() || 'N/A'})`);
  } else if (costOK > 0.5) {
    reasons.push(`⚠️ Estimated cost near upper capacity limit (₹${rfp.estCost?.toLocaleString() || 'N/A'})`);
  } else {
    reasons.push(`⚠️ Estimated cost requires evaluation (₹${rfp.estCost?.toLocaleString() || 'N/A'})`);
  }
  
  const label = score >= 80 ? 'High' : score >= 60 ? 'Medium' : score >= 40 ? 'Low' : 'Very Low';
  
  return { score, label, reasons };
}
