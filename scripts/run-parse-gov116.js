import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env BEFORE importing other modules
dotenv.config({ path: path.join(process.cwd(), '.env') });

(async () => {
  try {
    // Import pdf-parser after dotenv so it sees env vars
    const { parseRFPWithAI } = await import('../services/pdf-parser.js');

    const pdfPath = path.join(process.cwd(), 'public', 'rfps', 'GOV-116.pdf');
    console.log('Parsing:', pdfPath);
    const res = await parseRFPWithAI(pdfPath);
    console.log('=== PARSE RESULT ===');
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('Error during parsing:', e);
    process.exit(1);
  }
})();
