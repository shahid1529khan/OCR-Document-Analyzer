-- Complete Supabase schema for the document processing app.
-- Safe to run more than once in the Supabase SQL editor.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS upload_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  total_docs INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES upload_batches(id) ON DELETE SET NULL,
  report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  page_count INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'uploaded',
  language TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  ocr_status TEXT NOT NULL DEFAULT 'pending',
  raw_text TEXT,
  content_original TEXT,
  content_en TEXT,
  detected_language TEXT,
  storage_preview_path TEXT,
  requires_human_review BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS ocr_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  raw_json JSONB NOT NULL,
  confidence_score FLOAT
);

CREATE TABLE IF NOT EXISTS extracted_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  timeline_date TIMESTAMPTZ,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  parameters JSONB,
  confidence FLOAT,
  page_source_ref INT
);

CREATE TABLE IF NOT EXISTS extracted_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  metadata JSONB
);

-- Voyage AI voyage-3 returns 1024 dimensions. Keep this in sync with server/services/embeddings.ts.
CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding_vector vector(1024)
);

CREATE TABLE IF NOT EXISTS share_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  permissions JSONB NOT NULL DEFAULT '{"view_events":true,"view_source_text":false,"view_chat":false}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_jsonb JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_report_id ON documents(report_id);
CREATE INDEX IF NOT EXISTS idx_pages_document_id ON pages(document_id);
CREATE INDEX IF NOT EXISTS idx_events_document_id ON extracted_events(document_id);
CREATE INDEX IF NOT EXISTS idx_events_timeline_date ON extracted_events(timeline_date);
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON share_tokens(token);
CREATE INDEX IF NOT EXISTS idx_embeddings_doc_id ON embeddings(document_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw
  ON embeddings USING hnsw (embedding_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_reports_updated_at ON reports;
CREATE TRIGGER set_reports_updated_at
BEFORE UPDATE ON reports
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_documents_updated_at ON documents;
CREATE TRIGGER set_documents_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_reports_select ON reports;
DROP POLICY IF EXISTS owner_reports_insert ON reports;
DROP POLICY IF EXISTS owner_reports_update ON reports;
DROP POLICY IF EXISTS owner_reports_delete ON reports;
CREATE POLICY owner_reports_select ON reports FOR SELECT USING (auth.uid() = user_id AND NOT is_deleted);
CREATE POLICY owner_reports_insert ON reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY owner_reports_update ON reports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY owner_reports_delete ON reports FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS owner_docs_select ON documents;
DROP POLICY IF EXISTS owner_docs_insert ON documents;
DROP POLICY IF EXISTS owner_docs_update ON documents;
DROP POLICY IF EXISTS owner_docs_delete ON documents;
CREATE POLICY owner_docs_select ON documents FOR SELECT USING (auth.uid() = user_id AND NOT is_deleted);
CREATE POLICY owner_docs_insert ON documents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY owner_docs_update ON documents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY owner_docs_delete ON documents FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS owner_pages_select ON pages;
CREATE POLICY owner_pages_select ON pages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM documents
    WHERE documents.id = pages.document_id
      AND documents.user_id = auth.uid()
      AND NOT documents.is_deleted
  )
);

DROP POLICY IF EXISTS owner_ocr_select ON ocr_results;
CREATE POLICY owner_ocr_select ON ocr_results FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM pages
    JOIN documents ON documents.id = pages.document_id
    WHERE pages.id = ocr_results.page_id
      AND documents.user_id = auth.uid()
      AND NOT documents.is_deleted
  )
);

DROP POLICY IF EXISTS owner_events_select ON extracted_events;
CREATE POLICY owner_events_select ON extracted_events FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM documents
    WHERE documents.id = extracted_events.document_id
      AND documents.user_id = auth.uid()
      AND NOT documents.is_deleted
  )
);

DROP POLICY IF EXISTS owner_entities_select ON extracted_entities;
CREATE POLICY owner_entities_select ON extracted_entities FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM documents
    WHERE documents.id = extracted_entities.document_id
      AND documents.user_id = auth.uid()
      AND NOT documents.is_deleted
  )
);

DROP POLICY IF EXISTS owner_embeddings_select ON embeddings;
CREATE POLICY owner_embeddings_select ON embeddings FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM documents
    WHERE documents.id = embeddings.document_id
      AND documents.user_id = auth.uid()
      AND NOT documents.is_deleted
  )
);

DROP POLICY IF EXISTS owner_tokens_select ON share_tokens;
DROP POLICY IF EXISTS owner_tokens_insert ON share_tokens;
DROP POLICY IF EXISTS owner_tokens_delete ON share_tokens;
CREATE POLICY owner_tokens_select ON share_tokens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY owner_tokens_insert ON share_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY owner_tokens_delete ON share_tokens FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS owner_sessions_select ON chat_sessions;
DROP POLICY IF EXISTS owner_sessions_insert ON chat_sessions;
CREATE POLICY owner_sessions_select ON chat_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY owner_sessions_insert ON chat_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS owner_messages_select ON chat_messages;
CREATE POLICY owner_messages_select ON chat_messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM chat_sessions
    WHERE chat_sessions.id = chat_messages.session_id
      AND chat_sessions.user_id = auth.uid()
  )
);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

CREATE OR REPLACE FUNCTION match_embeddings(
  query_embedding vector(1024),
  match_threshold float,
  match_count int,
  filter_document uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  page_id uuid,
  chunk_index int,
  content text,
  similarity float,
  document_title text
)
LANGUAGE sql STABLE AS $$
  SELECT
    e.id,
    e.document_id,
    e.page_id,
    e.chunk_index,
    e.content,
    1 - (e.embedding_vector <=> query_embedding) AS similarity,
    d.title AS document_title
  FROM embeddings e
  JOIN documents d ON d.id = e.document_id
  WHERE (filter_document IS NULL OR e.document_id = filter_document)
    AND NOT d.is_deleted
    AND 1 - (e.embedding_vector <=> query_embedding) > match_threshold
  ORDER BY e.embedding_vector <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION match_embeddings_by_reports(
  query_embedding vector(1024),
  match_threshold float,
  match_count int,
  report_ids uuid[]
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  page_id uuid,
  chunk_index int,
  content text,
  similarity float,
  document_title text
)
LANGUAGE sql STABLE AS $$
  SELECT
    e.id,
    e.document_id,
    e.page_id,
    e.chunk_index,
    e.content,
    1 - (e.embedding_vector <=> query_embedding) AS similarity,
    d.title AS document_title
  FROM embeddings e
  JOIN documents d ON d.id = e.document_id
  WHERE d.report_id = ANY(report_ids)
    AND NOT d.is_deleted
    AND 1 - (e.embedding_vector <=> query_embedding) > match_threshold
  ORDER BY e.embedding_vector <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION match_page_chunks(
  query_embedding vector(1024),
  match_threshold float,
  match_count int,
  p_doc_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  page_id uuid,
  content text,
  similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT id, document_id, page_id, content, similarity
  FROM match_embeddings(query_embedding, match_threshold, match_count, p_doc_id);
$$;
