import express from 'express';
import dayjs from 'dayjs';
import { scheduleReminder, buildICS, startReminderDaemon, getReminders } from '../services/reminders.js';

const router = express.Router();

startReminderDaemon((reminder) => {
  console.log(`⏰ Reminder triggered: ${reminder.rfpId} (${reminder.channel}) at ${reminder.remindAt}`);
});

router.post('/', express.json(), (req, res) => {
  try {
    const { rfpId, minutesBefore = 120, channel = 'ui' } = req.body || {};
    
    if (!rfpId) {
      return res.status(400).json({ error: 'rfpId required' });
    }
    
    const remindAt = dayjs().add(minutesBefore, 'minute').toISOString();
    scheduleReminder({ rfpId, remindAt, channel });
    
    res.json({ 
      ok: true, 
      remindAt, 
      message: `Reminder set for ${dayjs(remindAt).format('MMM DD, YYYY HH:mm')}` 
    });
  } catch (error) {
    console.error('Error scheduling reminder:', error);
    res.status(500).json({ error: 'Failed to schedule reminder' });
  }
});

router.get('/:rfpId', (req, res) => {
  try {
    const reminders = getReminders(req.params.rfpId);
    res.json({ rfpId: req.params.rfpId, reminders });
  } catch (error) {
    console.error('Error getting reminders:', error);
    res.status(500).json({ error: 'Failed to get reminders' });
  }
});

router.get('/ics/:rfpId', async (req, res) => {
  try {
    const result = await buildICS({ rfpId: req.params.rfpId });
    
    if (!result.ok) {
      return res.status(400).send(result.msg);
    }
    
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="RFP-${req.params.rfpId}.ics"`);
    res.send(result.ics);
  } catch (error) {
    console.error('Error generating ICS:', error);
    res.status(500).send('Failed to generate calendar file');
  }
});

export default router;
