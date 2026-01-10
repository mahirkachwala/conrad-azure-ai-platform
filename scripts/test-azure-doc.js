#!/usr/bin/env node
// Simple test harness to call Azure Document Intelligence analyzePdf
// Usage: node scripts/test-azure-doc.js path/to/test.pdf

import fs from 'fs';
import path from 'path';

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: node scripts/test-azure-doc.js path/to/test.pdf');
  process.exit(1);
}

const pdfPath = path.resolve(fileArg);
if (!fs.existsSync(pdfPath)) {
  console.error('File not found:', pdfPath);
  process.exit(1);
}

(async () => {
  try {
    const { analyzePdf } = await import('../services/azure-document-intelligence.js');
    const buffer = fs.readFileSync(pdfPath);
    console.log('Calling Azure Document Intelligence...');
    const result = await analyzePdf(buffer);
    console.log('Result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error during Azure Document Intelligence call:');
    console.error(err);
    process.exit(2);
  }
})();
