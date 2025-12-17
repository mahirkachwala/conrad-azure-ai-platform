import express from 'express';
import { 
  getCredibilityScore, 
  getAllCredibilityScores,
  getCredibilityScoreLive,
  getAllCredibilityScoresLive
} from '../services/credibility.js';
import enrichmentService from '../services/data-enrichment.js';

const router = express.Router();

// Get credibility score for a specific company (synthetic/cached data)
router.get('/company/:name', (req, res) => {
  try {
    const companyName = decodeURIComponent(req.params.name);
    const result = getCredibilityScore(companyName);
    res.json(result);
  } catch (error) {
    console.error('Error getting credibility score:', error);
    res.status(500).json({ error: 'Failed to calculate credibility score' });
  }
});

// Get credibility score with live OpenCorporates enrichment
router.get('/company/:name/live', async (req, res) => {
  try {
    const companyName = decodeURIComponent(req.params.name);
    const result = await getCredibilityScoreLive(companyName);
    res.json(result);
  } catch (error) {
    console.error('Error getting live credibility score:', error);
    res.status(500).json({ error: 'Failed to calculate live credibility score' });
  }
});

// Get all credibility scores (synthetic/cached data)
router.get('/all', (req, res) => {
  try {
    const results = getAllCredibilityScores();
    res.json(results);
  } catch (error) {
    console.error('Error getting all credibility scores:', error);
    res.status(500).json({ error: 'Failed to calculate credibility scores' });
  }
});

// Get first 10 companies with live enrichment
router.get('/all/live', async (req, res) => {
  try {
    const results = await getAllCredibilityScoresLive();
    res.json(results);
  } catch (error) {
    console.error('Error getting live credibility scores:', error);
    res.status(500).json({ error: 'Failed to calculate live credibility scores' });
  }
});

// Get API status and usage
router.get('/api/status', (req, res) => {
  try {
    const status = enrichmentService.getApiStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting API status:', error);
    res.status(500).json({ error: 'Failed to get API status' });
  }
});

export default router;
