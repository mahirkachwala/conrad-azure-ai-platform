import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'rfp.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS rfps (
  id TEXT PRIMARY KEY,
  portal TEXT,
  buyerName TEXT,
  title TEXT,
  city TEXT,
  dueDate TEXT,
  estCost INTEGER,
  category TEXT,
  pdfPath TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS rfp_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfpId TEXT,
  seq INTEGER,
  text TEXT,
  FOREIGN KEY (rfpId) REFERENCES rfps(id)
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfpId TEXT,
  remindAt TEXT,
  channel TEXT,
  status TEXT,
  createdAt TEXT,
  FOREIGN KEY (rfpId) REFERENCES rfps(id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfpId TEXT,
  ts TEXT,
  role TEXT,
  text TEXT,
  FOREIGN KEY (rfpId) REFERENCES rfps(id)
);

CREATE INDEX IF NOT EXISTS idx_chunks_rfpId ON rfp_chunks(rfpId);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status, remindAt);
CREATE INDEX IF NOT EXISTS idx_conversations_rfpId ON conversations(rfpId);
`);

console.log('✅ RFP Database initialized successfully');

export default db;
