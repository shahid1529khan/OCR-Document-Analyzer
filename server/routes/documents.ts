import { Router }      from 'express';
import { requireAuth } from '../middleware/auth.js';
import { dbGetDocument, dbGetDocuments, dbGetEvents, dbInsertDocument } from '../db/supabaseDb.js';
import { processDocumentWorkflow } from '../services/pipeline.js';

export const documentRouter = Router();

documentRouter.get('/', requireAuth, async (req: any, res: any) => {
  try {
    res.json(await dbGetDocuments(req.user.id));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

documentRouter.get('/:id/events', requireAuth, async (req: any, res: any) => {
  try {
    const doc = await dbGetDocument(req.params.id);
    if (!doc || doc.user_id !== req.user.id || doc.is_deleted) return res.status(404).json({ error: 'Not found' });
    res.json(await dbGetEvents(req.params.id));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Single-document upload (no report grouping). Prefer /api/reports/:id/upload.
documentRouter.post('/upload', requireAuth, async (req: any, res: any) => {
  const { title, file_size, contentBase64 } = req.body;
  if (!title || !contentBase64) return res.status(400).json({ error: 'title and contentBase64 are required' });

  const userApiKey = req.headers['x-gemini-api-key'] || req.body.userApiKey;
  const userModel  = req.headers['x-gemini-model']   || req.body.userModel;

  try {
    const doc = await dbInsertDocument({ user_id: req.user.id, title: title.trim(), storage_path: 'pending', file_size: file_size || 0 });
    res.json({ success: true, document: doc });
    processDocumentWorkflow(doc.id, req.user.id, contentBase64, userApiKey, userModel)
      .catch(err => console.error('[upload] pipeline error:', err));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
