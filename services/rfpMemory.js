import db from '../db/index.js';
import dayjs from 'dayjs';

const upsertRfp = db.prepare(`
  INSERT INTO rfps (id, portal, buyerName, title, city, dueDate, estCost, category, pdfPath, createdAt, updatedAt)
  VALUES (@id, @portal, @buyerName, @title, @city, @dueDate, @estCost, @category, @pdfPath, @now, @now)
  ON CONFLICT(id) DO UPDATE SET
    portal=@portal,
    buyerName=@buyerName,
    title=@title,
    city=@city,
    dueDate=@dueDate,
    estCost=@estCost,
    category=@category,
    pdfPath=@pdfPath,
    updatedAt=@now
`);

const insertChunk = db.prepare(`
  INSERT INTO rfp_chunks (rfpId, seq, text) VALUES (@rfpId, @seq, @text)
`);

const deleteChunks = db.prepare(`DELETE FROM rfp_chunks WHERE rfpId = ?`);

export function saveRfpAndChunks({ rfp, fullText }) {
  const now = dayjs().toISOString();
  
  const transaction = db.transaction(() => {
    upsertRfp.run({ ...rfp, now });
    
    deleteChunks.run(rfp.id);
    
    const chunkSize = 1500;
    for (let i = 0, seq = 0; i < fullText.length; i += chunkSize, seq++) {
      insertChunk.run({ 
        rfpId: rfp.id, 
        seq, 
        text: fullText.slice(i, i + chunkSize) 
      });
    }
  });
  
  transaction();
  console.log(`✅ Saved RFP ${rfp.id} with ${Math.ceil(fullText.length / 1500)} chunks`);
}

export function getRfp(id) {
  const rfp = db.prepare(`SELECT * FROM rfps WHERE id = ?`).get(id);
  const chunks = db.prepare(`SELECT * FROM rfp_chunks WHERE rfpId = ? ORDER BY seq`).all(id);
  return { rfp, chunks };
}

export function getAllRfps() {
  return db.prepare(`SELECT * FROM rfps ORDER BY dueDate ASC`).all();
}

export function searchChunks(id, query, limit = 6) {
  const rows = db.prepare(`SELECT seq, text FROM rfp_chunks WHERE rfpId = ?`).all(id);
  
  if (!query || rows.length === 0) {
    return rows.slice(0, limit);
  }
  
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = rows.map(r => {
    const text = r.text.toLowerCase();
    const score = keywords.reduce((acc, word) => {
      const count = (text.match(new RegExp(word, 'g')) || []).length;
      return acc + count;
    }, 0);
    return { ...r, score };
  });
  
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function appendConversation(rfpId, role, text) {
  db.prepare(`
    INSERT INTO conversations (rfpId, ts, role, text) 
    VALUES (?, ?, ?, ?)
  `).run(rfpId, dayjs().toISOString(), role, text);
}

export function getConversation(rfpId, limit = 12) {
  return db.prepare(`
    SELECT * FROM conversations 
    WHERE rfpId = ? 
    ORDER BY id DESC 
    LIMIT ?
  `).all(rfpId, limit).reverse();
}

export function clearConversation(rfpId) {
  db.prepare(`DELETE FROM conversations WHERE rfpId = ?`).run(rfpId);
}
