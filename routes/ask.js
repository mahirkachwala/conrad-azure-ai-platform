import express from 'express';
import { getRfp, searchChunks, appendConversation, getConversation, clearConversation } from '../services/rfpMemory.js';
import { GoogleGenAI } from '@google/genai';

const router = express.Router();

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
let genAI = null;

if (apiKey) {
  genAI = new GoogleGenAI({ apiKey });
}

router.post('/', express.json(), async (req, res) => {
  try {
    const { rfpId, question } = req.body || {};
    
    if (!rfpId || !question) {
      return res.status(400).json({ error: 'rfpId and question required' });
    }
    
    const { rfp, chunks } = getRfp(rfpId);
    
    if (!rfp) {
      return res.status(404).json({ error: 'RFP not found in database' });
    }
    
    const contextChunks = searchChunks(rfpId, question, 8);
    const contextText = contextChunks.map(c => c.text).join('\n---\n');
    
    const history = getConversation(rfpId, 8);
    const historyText = history.map(h => `${h.role.toUpperCase()}: ${h.text}`).join('\n');
    
    const prompt = `You are a helpful tender/RFP assistant. Use ONLY the provided context from the RFP document to answer questions.

RFP Information:
- Tender ID: ${rfp.id}
- Buyer: ${rfp.buyerName || 'N/A'}
- Title: ${rfp.title || 'N/A'}
- Due Date: ${rfp.dueDate || 'N/A'}
- Estimated Cost: ${rfp.estCost ? '₹' + rfp.estCost.toLocaleString() : 'N/A'}

Document Context:
${contextText}

Previous Conversation:
${historyText || 'None'}

QUESTION: ${question}

Provide a concise, accurate answer based on the RFP document. If information is missing from the document, clearly state which section or detail is not available.`;
    
    let answer = 'AI service is not configured.';
    
    if (genAI) {
      try {
        const result = await genAI.generateContent({
          model: 'gemini-2.0-flash-exp',
          prompt
        });
        answer = result?.text || 'No response from AI.';
      } catch (aiError) {
        console.error('AI error:', aiError);
        answer = `AI error: ${aiError.message}. Please try rephrasing your question.`;
      }
    }
    
    appendConversation(rfpId, 'user', question);
    appendConversation(rfpId, 'assistant', answer);
    
    res.json({ 
      rfpId, 
      question, 
      answer,
      rfpInfo: {
        id: rfp.id,
        title: rfp.title,
        buyer: rfp.buyerName,
        dueDate: rfp.dueDate
      }
    });
    
  } catch (error) {
    console.error('Error in /api/ask:', error);
    res.status(500).json({ error: 'Failed to process question: ' + error.message });
  }
});

router.get('/history/:rfpId', (req, res) => {
  try {
    const conversation = getConversation(req.params.rfpId, 50);
    res.json({ rfpId: req.params.rfpId, conversation });
  } catch (error) {
    console.error('Error getting conversation:', error);
    res.status(500).json({ error: 'Failed to get conversation history' });
  }
});

router.delete('/history/:rfpId', (req, res) => {
  try {
    clearConversation(req.params.rfpId);
    res.json({ ok: true, message: 'Conversation cleared' });
  } catch (error) {
    console.error('Error clearing conversation:', error);
    res.status(500).json({ error: 'Failed to clear conversation' });
  }
});

export default router;
