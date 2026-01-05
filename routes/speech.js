import express from 'express';
import { speechToText } from '../services/azureSpeechAI.js';

const router = express.Router();

/**
 * POST /api/speech/transcribe
 * Transcribes speech from microphone input using Azure Cognitive Services
 */
router.post('/transcribe', async (req, res) => {
  try {
    const transcribedText = await speechToText();
    res.json({
      success: true,
      text: transcribedText
    });
  } catch (error) {
    console.error('[Speech] Transcription error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Azure Cognitive Services – Speech is required for ConRad to operate'
    });
  }
});

export default router;
