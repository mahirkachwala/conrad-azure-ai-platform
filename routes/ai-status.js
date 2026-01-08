import express from 'express';

const router = express.Router();

/**
 * GET /api/ai-status
 * Returns the status of configured AI services
 */
router.get('/', (req, res) => {
  const status = {
    azure_document_intelligence: !!(process.env.AZURE_DOC_ENDPOINT && process.env.AZURE_DOC_KEY),
    azure_speech_service: !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
    gemini: !!process.env.GEMINI_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    provider: 'azure-hybrid'
  };

  res.json(status);
});

export default router;
