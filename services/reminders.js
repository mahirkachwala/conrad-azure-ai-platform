import db from '../db/index.js';
import cron from 'node-cron';
import dayjs from 'dayjs';
import { getRfp } from './rfpMemory.js';
import ics from 'ics';

const addReminder = db.prepare(`
  INSERT INTO reminders (rfpId, remindAt, channel, status, createdAt) 
  VALUES (?, ?, ?, ?, ?)
`);

const listDue = db.prepare(`
  SELECT r.*, f.buyerName, f.title, f.dueDate
  FROM reminders r 
  JOIN rfps f ON r.rfpId = f.id
  WHERE r.status = 'scheduled' AND r.remindAt <= ? 
  ORDER BY r.remindAt ASC
`);

const markSent = db.prepare(`
  UPDATE reminders SET status = 'sent' WHERE id = ?
`);

const getRemindersForRfp = db.prepare(`
  SELECT * FROM reminders WHERE rfpId = ? ORDER BY remindAt ASC
`);

export function scheduleReminder({ rfpId, remindAt, channel = 'ui' }) {
  const now = dayjs().toISOString();
  addReminder.run(rfpId, remindAt, channel, 'scheduled', now);
  console.log(`⏰ Reminder scheduled for ${rfpId} at ${remindAt}`);
}

export function getReminders(rfpId) {
  return getRemindersForRfp.all(rfpId);
}

let reminderCallback = null;

export function startReminderDaemon(notifyFn) {
  reminderCallback = notifyFn;
  
  cron.schedule('* * * * *', () => {
    const now = dayjs().toISOString();
    const due = listDue.all(now);
    
    for (const reminder of due) {
      if (reminderCallback) {
        reminderCallback(reminder);
      }
      markSent.run(reminder.id);
      console.log(`✅ Reminder sent for ${reminder.rfpId} (${reminder.channel})`);
    }
  });
  
  console.log('⏰ Reminder daemon started (checking every minute)');
}

export async function buildICS({ rfpId }) {
  const { rfp } = getRfp(rfpId);
  
  if (!rfp?.dueDate) {
    return { ok: false, msg: 'No due date found' };
  }
  
  try {
    const dateMatch = rfp.dueDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!dateMatch) {
      return { ok: false, msg: 'Invalid date format' };
    }
    
    const [, year, month, day] = dateMatch;
    
    const event = {
      title: `RFP Deadline: ${rfp.title || rfp.id}`,
      description: `Buyer: ${rfp.buyerName || 'N/A'} | Tender ID: ${rfp.id}\nEstimated Cost: ${rfp.estCost ? '₹' + rfp.estCost.toLocaleString() : 'N/A'}`,
      start: [parseInt(year), parseInt(month), parseInt(day), 10, 0],
      duration: { hours: 1 },
      status: 'CONFIRMED',
      categories: ['Tender', 'Deadline']
    };
    
    return new Promise((resolve) => {
      ics.createEvent(event, (error, value) => {
        if (error) {
          resolve({ ok: false, msg: String(error) });
        } else {
          resolve({ ok: true, ics: value });
        }
      });
    });
  } catch (error) {
    return { ok: false, msg: error.message };
  }
}
