import { Router }      from 'express';
import crypto          from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import {
  dbInsertReport, dbGetReport, dbGetUserReports,
  dbGetReportDocuments, dbGetReportEvents,
  dbInsertDocument, dbInsertShareToken, dbGetShareToken,
  dbDeleteShareToken, dbGetShareTokensByReport, dbGetPagesByDocument,
} from '../db/supabaseDb.js';
import { processDocumentWorkflow } from '../services/pipeline.js';
import { answerDocumentQuestion } from '../services/chat.js';

export const reportRouter = Router();

function getAppUrl(req: any) {
  const configuredUrl = process.env.APP_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${process.env.PORT || 5000}`;
  return `${protocol}://${host}`.replace(/\/$/, '');
}

// ── Reports CRUD ──────────────────────────────────────────────────────────────

reportRouter.post('/', requireAuth, async (req: any, res: any) => {
  const { title, description } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  try {
    res.json({ report: await dbInsertReport({ user_id: req.user.id, title: title.trim(), description: description || '' }) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

reportRouter.get('/', requireAuth, async (req: any, res: any) => {
  try { res.json(await dbGetUserReports(req.user.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

reportRouter.get('/:id', requireAuth, async (req: any, res: any) => {
  try {
    const report = await dbGetReport(req.params.id);
    if (!report || report.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    const [documents, events] = await Promise.all([dbGetReportDocuments(report.id), dbGetReportEvents(report.id)]);
    res.json({ report, documents, events });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Upload into a report ──────────────────────────────────────────────────────

reportRouter.post('/:id/upload', requireAuth, async (req: any, res: any) => {
  try {
    const report = await dbGetReport(req.params.id);
    if (!report || report.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    const { title, file_size, contentBase64 } = req.body;
    if (!title || !contentBase64) return res.status(400).json({ error: 'title and contentBase64 are required' });

    const userApiKey = req.headers['x-gemini-api-key'] || req.body.userApiKey;
    const userModel  = req.headers['x-gemini-model']   || req.body.userModel;

    const doc = await dbInsertDocument({ user_id: req.user.id, report_id: report.id, title: title.trim(), storage_path: 'pending', file_size: file_size || 0 });
    res.json({ success: true, document: doc });
    processDocumentWorkflow(doc.id, req.user.id, contentBase64, userApiKey, userModel)
      .catch(err => console.error('[upload] pipeline error:', err));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Share tokens ──────────────────────────────────────────────────────────────

reportRouter.post('/:id/share', requireAuth, async (req: any, res: any) => {
  try {
    const report = await dbGetReport(req.params.id);
    if (!report || report.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    const { expiresInDays, permissions } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    let expires_at: string | null = null;
    if (expiresInDays > 0) { const d = new Date(); d.setDate(d.getDate() + Number(expiresInDays)); expires_at = d.toISOString(); }
    const shareToken = await dbInsertShareToken({ report_id: report.id, user_id: req.user.id, token, expires_at, permissions: permissions || { view_events: true, view_source_text: false, view_chat: false } });
    res.json({ token, shareUrl: `${getAppUrl(req)}/report/${token}`, shareToken });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

reportRouter.get('/:id/tokens', requireAuth, async (req: any, res: any) => {
  try {
    const report = await dbGetReport(req.params.id);
    if (!report || report.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    res.json(await dbGetShareTokensByReport(report.id));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

reportRouter.delete('/:id/tokens/:token', requireAuth, async (req: any, res: any) => {
  try {
    const report = await dbGetReport(req.params.id);
    if (!report || report.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    await dbDeleteShareToken(req.params.token, req.user.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Public report — no auth, token-gated ─────────────────────────────────────

reportRouter.get('/public/:token', async (req: any, res: any) => {
  try {
    const shareToken = await dbGetShareToken(req.params.token);
    if (!shareToken) return res.status(404).json({ error: 'Report not found or link has expired.' });
    if (shareToken.expires_at && new Date(shareToken.expires_at) < new Date()) return res.status(410).json({ error: 'This share link has expired.' });

    const report = await dbGetReport(shareToken.report_id);
    if (!report) return res.status(404).json({ error: 'Report not found.' });

    const perms = shareToken.permissions || {};
    const [documents, events] = await Promise.all([
      dbGetReportDocuments(report.id),
      perms.view_events ? dbGetReportEvents(report.id) : Promise.resolve([]),
    ]);

    const enrichedDocs = await Promise.all(documents.map(async (d: any) => {
      const base = { id: d.id, title: d.title, language: d.language, page_count: d.page_count, status: d.status, created_at: d.created_at };
      if (!perms.view_source_text) return base;
      return { ...base, pages: await dbGetPagesByDocument(d.id) };
    }));

    res.json({
      report:  { id: report.id, title: report.title, description: report.description, created_at: report.created_at },
      documents: enrichedDocs,
      events,
      stats: {
        totalDocuments: documents.length,
        totalEvents:    events.length,
        dateRange: events.length > 0 ? { earliest: events[0].timeline_date, latest: events[events.length - 1].timeline_date } : null,
        languages: [...new Set(documents.map((d: any) => d.language).filter(Boolean))],
      },
      permissions: perms,
    });
  } catch (err: any) { console.error('[public report]', err); res.status(500).json({ error: 'Failed to load report.' }); }
});

reportRouter.post('/public/:token/chat', async (req: any, res: any) => {
  const { query } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: 'query is required' });

  try {
    const shareToken = await dbGetShareToken(req.params.token);
    if (!shareToken) return res.status(404).json({ error: 'Report not found or link has expired.' });
    if (shareToken.expires_at && new Date(shareToken.expires_at) < new Date()) return res.status(410).json({ error: 'This share link has expired.' });
    if (!shareToken.permissions?.view_chat) return res.status(403).json({ error: 'Chat is not enabled for this share link.' });

    const report = await dbGetReport(shareToken.report_id);
    if (!report) return res.status(404).json({ error: 'Report not found.' });

    res.json(await answerDocumentQuestion({
      query,
      reportIds: [report.id],
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    }));
  } catch (err: any) {
    console.error('[public report chat]', err);
    res.status(500).json({ error: 'Failed to answer report question.' });
  }
});
