/**
 * Azure Document Intelligence Service
 * Wrapper for @azure/ai-form-recognizer
 * 
 * Provides extraction of text and tables from PDFs/Images using Azure's prebuilt models.
 */

import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

// Initialize client lazily to avoid blocking server start
let client = null;

function getClient() {
  if (client) return client;
  
  const endpoint = process.env.AZURE_DOC_ENDPOINT;
  const key = process.env.AZURE_DOC_KEY;
  
  if (!endpoint || !key) {
    console.warn('⚠️ Azure Document Intelligence credentials missing (AZURE_DOC_ENDPOINT, AZURE_DOC_KEY)');
    return null;
  }

  try {
    client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
    console.log('📄 Azure Document Intelligence Client Initialized');
    return client;
  } catch (error) {
    console.error('❌ Failed to initialize Azure Document Intelligence:', error.message);
    return null;
  }
}

/**
 * Analyze a PDF buffer using Azure Document Intelligence
 * @param {Buffer} buffer - The PDF file buffer
 * @param {string} modelId - The model to use (default: prebuilt-document)
 * @returns {Promise<Object>} Extracted content in a standardized format
 */
export async function analyzePdf(buffer, modelId = "prebuilt-document") {
  const analyzer = getClient();
  if (!analyzer) {
    throw new Error("Azure Document Intelligence not configured");
  }

  try {
    console.log(`📄 Azure Doc Init: Utilizing ${modelId}...`);
    // Ensure buffer is passed as Uint8Array/Stream and set contentType for PDFs
    const documentData = (buffer instanceof Uint8Array) ? buffer : new Uint8Array(buffer);
    const pollOperation = await analyzer.beginAnalyzeDocument(modelId, documentData, { contentType: 'application/pdf' });
    const result = await pollOperation.pollUntilDone();

    if (!result) {
      throw new Error("Empty result from Azure Document Intelligence");
    }

    // Format output to be useful for our parser
    // We combine page content to mimic simple text extraction, but we can also use tables/kv pairs
    // Some SDK responses provide `pages` with `lines`, some provide `content` directly.
    let fullText = '';
    if (result.pages && result.pages.length) {
      fullText = result.pages.map(page =>
        (page.lines || []).map(line => line.content).join(' ')
      ).join('\n\n');
    } else if (result.content) {
      fullText = result.content;
    } else if (result.paragraphs && result.paragraphs.length) {
      fullText = result.paragraphs.map(p => p.content).join('\n\n');
    }

    console.log('📄 Azure Document Intelligence: ACTIVE - Successfully extracted content');
    
    return {
      success: true,
      text: fullText, // Compatible with existing regex parsers
      tables: result.tables || [],
      keyValuePairs: result.keyValuePairs || [], // Available if using prebuilt-document
      pages: result.pages || [],
      raw: result,
      source: 'azure-document-intelligence'
    };

  } catch (error) {
    // Log full error for easier debugging (includes statusCode, code, details)
    console.error('⚠️ Azure Document Intelligence failed, using fallback:', error);
    throw error;
  }
}

export default {
  analyzePdf
};
