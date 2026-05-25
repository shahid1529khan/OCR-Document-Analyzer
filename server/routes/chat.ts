import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { requireAuth } from '../middleware/auth.js';
import { dbGetDocument, dbGetReport } from '../db/supabaseDb.js';
import { answerDocumentQuestion } from '../services/chat.js';

export const chatRouter = Router();

chatRouter.post('/', requireAuth, async (req: any, res: any) => {
  const { documentId, reportId, query } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: 'query is required' });
  if (!documentId && !reportId) return res.status(400).json({ error: 'documentId or reportId is required' });
  if (documentId && reportId) return res.status(400).json({ error: 'Provide either documentId or reportId, not both.' });

  const userApiKey = req.headers['x-gemini-api-key'] || req.body.userApiKey || process.env.GEMINI_API_KEY;
  const modelChoice = req.headers['x-gemini-model'] || req.body.userModel || process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  try {
    if (documentId) {
      const doc = await dbGetDocument(documentId);
      if (!doc || doc.user_id !== req.user.id || doc.is_deleted) return res.status(404).json({ error: 'Not found' });
    }

    if (reportId) {
      const report = await dbGetReport(reportId);
      if (!report || report.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    }

    res.json(await answerDocumentQuestion({
      query,
      documentId,
      reportIds: reportId ? [reportId] : undefined,
      apiKey: userApiKey,
      model: modelChoice,
    }));
  } catch (err: any) {
    console.error('[chat]', err);
    res.status(500).json({ error: err.message });
  }
});

chatRouter.post('/validate-key', async (req: any, res: any) => {
  const key = req.headers['x-gemini-api-key'] || req.body.userApiKey;
  const model = req.headers['x-gemini-model'] || req.body.userModel || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  if (!key) return res.status(400).json({ valid: false, error: 'No API key provided' });

  try {
    const ai = new GoogleGenAI({ apiKey: key, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    const resp = await ai.models.generateContent({
      model,
      contents: 'Reply with only: {"status":"ok"}',
      config: { responseMimeType: 'application/json' },
    });
    res.json({ valid: !!resp.text });
  } catch (err: any) {
    res.status(400).json({ valid: false, error: err?.message || String(err) });
  }
});
