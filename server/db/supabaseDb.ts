/**
 * supabaseDb.ts — real Supabase database layer.
 * Replaces localDb.ts entirely. Same function signatures throughout.
 */
import { supabaseAdmin } from './supabase.js';

function raise(error: any, label: string): never {
  throw new Error(`[db:${label}] ${error.message}`);
}

// ── Reports ───────────────────────────────────────────────────────────────────

export async function dbInsertReport(r: { user_id: string; title: string; description?: string }) {
  const { data, error } = await supabaseAdmin.from('reports').insert(r).select().single();
  if (error) raise(error, 'insertReport');
  return data;
}

export async function dbGetReport(id: string) {
  const { data, error } = await supabaseAdmin.from('reports').select('*').eq('id', id).eq('is_deleted', false).maybeSingle();
  if (error) raise(error, 'getReport');
  return data;
}

export async function dbGetUserReports(userId: string) {
  const { data, error } = await supabaseAdmin.from('reports').select('*').eq('user_id', userId).eq('is_deleted', false).order('created_at', { ascending: false });
  if (error) raise(error, 'getUserReports');
  return data ?? [];
}

export async function dbGetReportDocuments(reportId: string) {
  const { data, error } = await supabaseAdmin.from('documents').select('*').eq('report_id', reportId).eq('is_deleted', false).order('created_at', { ascending: true });
  if (error) raise(error, 'getReportDocuments');
  return data ?? [];
}

export async function dbGetReportEvents(reportId: string) {
  const { data, error } = await supabaseAdmin
    .from('extracted_events')
    .select('*, documents!inner(report_id, title, is_deleted)')
    .eq('documents.report_id', reportId)
    .eq('documents.is_deleted', false)
    .order('timeline_date', { ascending: true, nullsFirst: false });
  if (error) raise(error, 'getReportEvents');
  return data ?? [];
}

// ── Documents ─────────────────────────────────────────────────────────────────

export async function dbInsertDocument(doc: {
  user_id: string; report_id?: string; title: string;
  storage_path: string; file_size: number; status?: string;
}) {
  const { data, error } = await supabaseAdmin.from('documents').insert({ status: 'uploaded', ...doc }).select().single();
  if (error) raise(error, 'insertDocument');
  return data;
}

export async function dbGetDocument(id: string) {
  const { data, error } = await supabaseAdmin.from('documents').select('*').eq('id', id).maybeSingle();
  if (error) raise(error, 'getDocument');
  return data;
}

export async function dbGetDocuments(userId: string) {
  const { data, error } = await supabaseAdmin.from('documents').select('*').eq('user_id', userId).eq('is_deleted', false).order('created_at', { ascending: false });
  if (error) raise(error, 'getDocuments');
  return data ?? [];
}

export async function dbUpdateDocument(id: string, updates: Record<string, any>) {
  const { error } = await supabaseAdmin.from('documents').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) raise(error, 'updateDocument');
}

// ── Pages ─────────────────────────────────────────────────────────────────────

export async function dbInsertPage(page: {
  document_id: string; page_number: number; ocr_status: string;
  raw_text?: string; content_original?: string; content_en?: string;
  detected_language?: string; requires_human_review?: boolean;
}) {
  const { data, error } = await supabaseAdmin.from('pages').insert(page).select().single();
  if (error) raise(error, 'insertPage');
  return data;
}

export async function dbGetPagesByDocument(documentId: string) {
  const { data, error } = await supabaseAdmin.from('pages').select('*').eq('document_id', documentId).order('page_number', { ascending: true });
  if (error) raise(error, 'getPagesByDocument');
  return data ?? [];
}

// ── OCR results ───────────────────────────────────────────────────────────────

export async function dbInsertOcrResult(ocr: { page_id: string; raw_json: object; confidence_score?: number }) {
  const { error } = await supabaseAdmin.from('ocr_results').insert(ocr);
  if (error) raise(error, 'insertOcrResult');
}

// ── Events ────────────────────────────────────────────────────────────────────

export async function dbInsertEvent(ev: {
  document_id: string; timeline_date: string | null; event_type: string;
  description: string; page_source_ref?: number; confidence?: number;
}) {
  const { error } = await supabaseAdmin.from('extracted_events').insert(ev);
  if (error) raise(error, 'insertEvent');
}

export async function dbGetEvents(documentId: string) {
  const { data, error } = await supabaseAdmin.from('extracted_events').select('*').eq('document_id', documentId).order('timeline_date', { ascending: true, nullsFirst: false });
  if (error) raise(error, 'getEvents');
  return data ?? [];
}

// ── Embeddings ────────────────────────────────────────────────────────────────

export async function dbInsertEmbedding(emb: {
  page_id: string; document_id: string; chunk_index: number;
  content: string; embedding_vector: number[];
}) {
  const { error } = await supabaseAdmin.from('embeddings').insert({
    ...emb,
    embedding_vector: `[${emb.embedding_vector.join(',')}]`,
  });
  if (error) raise(error, 'insertEmbedding');
}

export async function dbMatchPageChunks(documentId: string | null, queryVector: number[], limit = 5) {
  const { data, error } = await supabaseAdmin.rpc('match_embeddings', {
    query_embedding: `[${queryVector.join(',')}]`,
    match_threshold: 0.5,
    match_count: limit,
    filter_document: documentId,
  });
  if (error) raise(error, 'matchPageChunks');
  return data ?? [];
}

export async function dbMatchAcrossReports(reportIds: string[], queryVector: number[], limit = 8) {
  const { data, error } = await supabaseAdmin.rpc('match_embeddings_by_reports', {
    query_embedding: `[${queryVector.join(',')}]`,
    match_threshold: 0.5,
    match_count: limit,
    report_ids: reportIds,
  });
  if (error) raise(error, 'matchAcrossReports');
  return data ?? [];
}

// ── Share tokens ──────────────────────────────────────────────────────────────

export async function dbInsertShareToken(t: {
  report_id: string; user_id: string; token: string;
  expires_at: string | null; permissions: object;
}) {
  const { data, error } = await supabaseAdmin.from('share_tokens').insert(t).select().single();
  if (error) raise(error, 'insertShareToken');
  return data;
}

export async function dbGetShareToken(token: string) {
  const { data, error } = await supabaseAdmin.from('share_tokens').select('*').eq('token', token).maybeSingle();
  if (error) raise(error, 'getShareToken');
  return data;
}

export async function dbDeleteShareToken(token: string, userId: string) {
  const { error } = await supabaseAdmin.from('share_tokens').delete().eq('token', token).eq('user_id', userId);
  if (error) raise(error, 'deleteShareToken');
}

export async function dbGetShareTokensByReport(reportId: string) {
  const { data, error } = await supabaseAdmin.from('share_tokens').select('*').eq('report_id', reportId).order('created_at', { ascending: false });
  if (error) raise(error, 'getShareTokensByReport');
  return data ?? [];
}
