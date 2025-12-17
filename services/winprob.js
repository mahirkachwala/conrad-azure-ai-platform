/**
 * Win Probability Calculator
 * Deterministic scoring based on spec match, price competitiveness, credibility, and timeline
 */

export function calculateWinProbability({ 
  bestMatchPct = 80, 
  priceRank = 1, 
  credibilityScore = 75, 
  daysLeft = 10 
}) {
  // Normalize spec match to 0-1
  const matchScore = Math.max(0, Math.min(1, bestMatchPct / 100));
  
  // Price competitiveness (rank-based)
  const priceScore = priceRank === 1 ? 1.0 : 
                     priceRank === 2 ? 0.8 : 
                     priceRank === 3 ? 0.6 : 0.4;
  
  // Normalize credibility to 0-1
  const credScore = Math.max(0, Math.min(1, credibilityScore / 100));
  
  // Timeline urgency penalty (more time = better)
  const timelineScore = Math.max(0, Math.min(1, daysLeft / 30));
  
  // Weighted formula
  const weights = {
    match: 0.45,      // Spec match most important
    price: 0.30,      // Price competitiveness
    credibility: 0.15, // Company credibility
    timeline: 0.10    // Timeline adequacy
  };
  
  const totalScore = 
    (weights.match * matchScore) +
    (weights.price * priceScore) +
    (weights.credibility * credScore) +
    (weights.timeline * timelineScore);
  
  const percentage = Math.round(totalScore * 100);
  
  return {
    probability: percentage,
    breakdown: {
      spec_match_contribution: Math.round(weights.match * matchScore * 100),
      price_contribution: Math.round(weights.price * priceScore * 100),
      credibility_contribution: Math.round(weights.credibility * credScore * 100),
      timeline_contribution: Math.round(weights.timeline * timelineScore * 100)
    },
    badge: getBadge(percentage),
    recommendation: getRecommendation(percentage)
  };
}

function getBadge(probability) {
  if (probability >= 75) return { color: '#10b981', label: 'HIGH', icon: '🎯' };
  if (probability >= 50) return { color: '#f59e0b', label: 'MEDIUM', icon: '⚡' };
  return { color: '#ef4444', label: 'LOW', icon: '⚠️' };
}

function getRecommendation(probability) {
  if (probability >= 75) {
    return 'Strong bid recommended. Excellent spec match and competitive positioning.';
  } else if (probability >= 50) {
    return 'Proceed with caution. Consider improving spec match or pricing strategy.';
  } else {
    return 'High risk bid. Recommend focusing on better-matched opportunities.';
  }
}
