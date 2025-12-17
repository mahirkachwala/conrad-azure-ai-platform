import express from 'express';
import { getAllRfps } from '../services/rfpMemory.js';
import dayjs from 'dayjs';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const rfps = getAllRfps();
    
    const items = rfps.map(rfp => {
      const now = dayjs();
      const dueDate = rfp.dueDate ? dayjs(rfp.dueDate) : null;
      const daysLeft = dueDate ? dueDate.diff(now, 'day') : -1;
      
      const urgency = daysLeft < 0 ? 100 : 
                     daysLeft <= 3 ? 80 : 
                     daysLeft <= 7 ? 50 : 
                     daysLeft <= 14 ? 30 : 10;
      
      const riskScore = Math.min(100, 
        (rfp.estCost > 10000000 ? 40 : 20) + 
        urgency * 0.5
      );
      
      return {
        id: rfp.id,
        title: rfp.title || 'Untitled',
        buyerName: rfp.buyerName || 'Unknown',
        portal: rfp.portal || 'N/A',
        city: rfp.city || 'N/A',
        category: rfp.category || 'General',
        estCost: rfp.estCost || null,
        dueDate: rfp.dueDate,
        daysLeft,
        risk: Math.round(riskScore),
        competition: Math.floor(Math.random() * 40) + 30,
        urgency: Math.round(urgency)
      };
    });
    
    const sorted = req.query.sortBy === 'cost' ? items.sort((a, b) => (b.estCost || 0) - (a.estCost || 0)) :
                   req.query.sortBy === 'risk' ? items.sort((a, b) => b.risk - a.risk) :
                   req.query.sortBy === 'urgency' ? items.sort((a, b) => b.urgency - a.urgency) :
                   items.sort((a, b) => a.daysLeft - b.daysLeft);
    
    const stats = {
      total: items.length,
      avgCost: Math.round(items.reduce((sum, i) => sum + (i.estCost || 0), 0) / items.length),
      highRisk: items.filter(i => i.risk >= 70).length,
      urgent: items.filter(i => i.daysLeft >= 0 && i.daysLeft <= 7).length,
      overdue: items.filter(i => i.daysLeft < 0).length
    };
    
    res.json({ items: sorted, stats });
  } catch (error) {
    console.error('Error in comparison API:', error);
    res.status(500).json({ error: 'Failed to generate comparison data' });
  }
});

router.get('/analytics', (req, res) => {
  try {
    const rfps = getAllRfps();
    
    const byPortal = rfps.reduce((acc, rfp) => {
      const portal = rfp.portal || 'Unknown';
      acc[portal] = (acc[portal] || 0) + 1;
      return acc;
    }, {});
    
    const byCategory = rfps.reduce((acc, rfp) => {
      const category = rfp.category || 'General';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});
    
    const costDistribution = rfps
      .filter(r => r.estCost)
      .map(r => ({
        id: r.id,
        cost: r.estCost,
        title: r.title
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);
    
    res.json({ 
      byPortal, 
      byCategory, 
      costDistribution,
      totalRfps: rfps.length
    });
  } catch (error) {
    console.error('Error in analytics API:', error);
    res.status(500).json({ error: 'Failed to generate analytics' });
  }
});

export default router;
