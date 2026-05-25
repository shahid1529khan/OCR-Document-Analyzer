# AI Document Processing SaaS — System Architecture & Implementation Plan

**Note on Framework:** While Next.js 15 is a standard choice, to support optimal real-time AI streaming, isolated worker execution, and independent container scaling within this specific infrastructure environment, the architecture is decoupled into a **React 18 SPA (Vite)** frontend and an **Express.js API** backend. The backend interfaces with **Supabase**, **pgvector**, **Trigger.dev**, and **Google Cloud AI**.

---

## SECTION 1 — SYSTEM ARCHITECTURE

### High-Level Architecture
The system employs a deeply decoupled, event-driven monolith for the API, paired with a React SPA.

1. **Frontend (React 18 / Vite / Tailwind / shadcn/ui):**
   Handles all presentation, optimistic caching via React Query, and real-time state synchronization via Supabase Realtime via WebSockets.
2. **API Gateways (Express.js cluster):**
   Stateless API layer handling authentication, synchronous fast-queries, and dispatching heavy workloads. It acts directly as a facade to Supabase.
3. **Database (Supabase PostgreSQL):**
   Single source of truth. Utilizes `pgvector` for embedding proximity search. Enforces data isolation via Row Level Security (RLS).
4. **Async Engine & Queue Orchestrator (Trigger.dev / Edge Functions):**
   Manages the long-running Document AI pipelines. Handled as isolated, suspendable tasks using Trigger.dev v3.
5. **AI/OCR Subsystem:**
   Google Document AI extracts structured layouts. Gemini 2.5 Pro digests the OCR output into structured JSON schemas. OpenAI `text-embedding-3-small` generates embeddings.

### Flow of a Document Upload
1. Frontend generates a signed upload URL via Supabase Storage.
2. User uploads PDF directly to Supabase Storage bucket (bypassing Express memory limits).
3. Supabase Webhook fires on `insert` to the `documents` table, notifying the Express API.
4. Express API dispatches a Trigger.dev task (`document.process`).
5. Trigger.dev coordinates the worker: Document AI -> Page Splitting -> Translation -> Extraction -> Embedding -> DB updates.
6. Supabase Realtime alerts the frontend of status changes (`processing`, `ocr_done`, `indexing_done`, `ready`).

---

## SECTION 2 — DATABASE DESIGN

**PostgreSQL (Supabase) + pgvector**

**Core Tables:**
*   `users` (managed by Supabase Auth): Core identity.
*   `upload_batches` (UUID, user_id, status, total_docs, created_at)
*   `documents` (UUID, batch_id, user_id, storage_path, file_size, page_count, status, language, created_at)
*   `pages` (UUID, document_id, page_number, ocr_status, raw_text, storage_preview_path)
*   `ocr_results` (UUID, page_id, raw_json, confidence_score)
*   `extracted_events` (UUID, document_id, timeline_date, event_type, parameters, confidence)
*   `embeddings` (UUID, page_id, chunk_index, content, embedding_vector: `vector(1536)`)
*   `chat_sessions` (UUID, document_id, created_at)
*   `chat_messages` (UUID, session_id, role, content, citations_jsonb)
*   `share_tokens` (UUID, document_id, token_hash, expires_at, permissions_jsonb)

**Scaling Concerns & RLS:**
*   *Soft Delete Strategy:* Every table has an `is_deleted` boolean. Background chronicles prune `is_deleted=true` > 30 days.
*   *RLS Policies:* `create policy "Users can view own documents" on documents for select using (auth.uid() = user_id);`
*   *Vector Scaling:* HNSW index applied over the `embedding_vector` using euclidean distance or inner product dependent on normalization.

---

## SECTION 3 — ASYNC PROCESSING DESIGN

**Tool: Trigger.dev (v3)**
Chosen over Inngest due to pure serverless suspend/resume architecture, which handles 10+ minute Document AI and extraction workflows without eating HTTP execution timeouts.

**Pipeline Orchestration (`document.process` flow):**
1. **Queue Configuration:** `concurrencyLimit: 50` for OCR to avoid GCP rate limits.
2. **Idempotency:** Trigger.dev uses `runId`. We pass the `document_id` as the payload. Steps use `context.run.id`.
3. **Yielding:** Long-running translations or extractions `yield` back to the Trigger.dev engine.
4. **Dead-Letter:** Tasks failing 3x (with exponential backoff) are routed to a generic `dlq.handle` task that updates `documents.status = 'failed'` and flags alerting.

---

## SECTION 4 — OCR PIPELINE

**Google Document AI Integration:**
1. **Pre-processing:** PDF is streamed to GCP Document AI (batch process for >15 pages).
2. **Parsing:** Extracts structured text, maintaining bounding boxes, paragraphs, and tables. Ensures layout preservation.
3. **Handwriting Analysis:** Handled natively by Doc AI. If confidence < 60%, flags DB `pages.requires_human_review = true`.
4. **Language Detection:** We use Google Cloud Translation API to detect page languages and uniformly translate everything required to English, storing both `content_original` and `content_en` in the DB.

---

## SECTION 5 — AI EXTRACTION PIPELINE

**Gemini 2.5 Pro via Application API:**
1. **Prompt Strategy:** We use strict `response_mime_type: "application/json"` with predefined Zod schemas.
2. **Schema:**
   ```json
   {
     "events": [
       {"date": "ISO8601", "description": "fact", "page_source_ref": 1}
     ],
     "entities": [{"name": "string", "type": "PERSON|ORG"}]
   }
   ```
3. **Chunking & Token limits:** Even with Gemini's 1M+ context window, we pipeline 20 pages max per extract call to preserve extreme accuracy and avoid instruction drift.
4. **Validation:** Zod safely parses the response back in the worker. Failures result in immediate deterministic retry with a modified prompt instructing format compliance.

---

## SECTION 6 — RAG + CHAT ARCHITECTURE

**Hybrid Search Pipeline:**
1. **Chunking:** Semantic chunking over layout-aware text (derived from Doc AI paragraph bounding boxes, not arbitrary length). Overlap: 15%. Size: ~500 tokens.
2. **Embeddings:** `text-embedding-3-small` (1536 dim).
3. **Hybrid Retrieval:**
   *   *Vector similarity* (pgvector HNSW over Euclidean).
   *   *Full-text search* (Postgres `to_tsvector` over english dictionaries).
   *   *Reranking:* A fast lightweight reranker scores the joined top-K (K=30).
4. **Citation Engine:** Every chunk strictly correlates to a `page_id`. When Gemini 2.5 Pro answers, we inject context blocks formatted as `[DocID:PageNum] Context...`. The prompt strictly enforces citations like `...which was proven to be true [14:2].`

---

## SECTION 7 — SECURITY ARCHITECTURE

1. **Authentication:** Supabase Auth (JWT).
2. **Share Tokens:** Cryptographically signed short-lived URLs. Lookups go to a specific fast-path endpoint that validates token expiration and enforces read-only access.
3. **RLS:** All DB tables verify `auth.uid()`.
4. **Upload Validation:** Express gateway validates mime-type limits, utilizing `multer` or direct presigned URLs with strict bucket policies (e.g. `mime_type = "application/pdf"` AND `length < 100MB`).

---

## SECTION 8 — FRONTEND ARCHITECTURE

1. **Routing:** React Router (SPA over Vite).
2. **State Management:** React Query (TanStack) for server-state caching. Zustand for ephemeral UI state (e.g. sidebar toggles).
3. **Real-time UX:** `supabase.channel('public:documents').on('postgres_changes', ...)`. This allows progress bars to move automatically as the backend processes documents.
4. **Components:** Radix UI primitives styled via Tailwind CSS, strictly encapsulated in `shadcn/ui` wrappers (`/src/components/ui/`).
5. **Timeline UI:** D3.js or Recharts customized chronologies to visualize the `extracted_events` tables.

---

## SECTION 9 — IMPLEMENTATION ROADMAP

*   **Week 1 (Infrastructure & Uploads):** Express Backend, Supabase Init, Auth flows, S3 Bucket presigned uploads, Trigger.dev setup.
*   **Week 2 (Processing Pipeline - OCR):** Google Document AI integration. Converting PDFs to organized `pages` arrays in Postgres.
*   **Week 3 (Intelligence):** Gemini 2.5 Pro pipeline for extraction. Zod validation layer.
*   **Week 4 (RAG System):** Embdeds via OpenAI, pgvector indexing, HNSW setup.
*   **Week 5 (Frontend Chat & Viewers):** Document Viewer (react-pdf), Chat interface with citation linking, Status timeline.
*   **Week 6 (Security & Polish):** Share tokens, rate limiting webhook boundaries, production testing.

---

## SECTION 10 — CODEBASE STRUCTURE

```text
/
|-- frontend/           (React / Vite / Tailwind)
|   |-- src/
|   |   |-- components/  (UI primitives)
|   |   |-- hooks/       (React Query wrappers)
|   |   |-- lib/         (Supabase client, utils)
|   |   `-- pages/       (Route views: Dashboard, Document, Report)
|-- server/             (Express API and services)
|   |-- routes/          (REST API)
|   |-- services/        (OCR, extraction, embeddings, chat)
|   `-- db/              (Supabase Admin client and data layer)
`-- supabase/           (Database migrations)
```

---

## SECTION 11 — API DESIGN

**Endpoints:**
*   `POST /api/documents/presigned-url` -> Returns `{ url, docId }`
*   `POST /api/webhooks/supabase/document-insert` (Fires Trigger.dev sequence)
*   `GET  /api/documents/:id` (Metadata)
*   `POST /api/chat/stream` (Streams LLM output using SSE, enforcing auth and token rate-limits).
*   `POST /api/share/create` (Generates short-lived View token)

---

## SECTION 12 — FAILURE SCENARIOS

1. **DocAI times out over 100 pages:** Mitigated by pre-flight PDF spliting using `pdf-lib` into 15-page chunks before submitting to DocAI.
2. **Gemini refuses extraction prompt (Safety filters):** We disable unnecessary filters in the SDK config for standard data extraction, logging strict exceptions.
3. **Database connection exhaustion:** Handled by moving heavy transactions via Supabase PgBouncer pool.
4. **Vector index collapse (HNSW memory limit):** We track chunk bloat and ensure `work_mem` on Supabase allows large vector builds.

---

## SECTION 13 — OBSERVABILITY

*   **Logging:** Winston or Pino outputting pure JSON to stdout -> ingested by Datadog or GCP Logging.
*   **Tracing:** Trigger.dev provides native span tracing for entire jobs.
*   **AI Cost Tracking:** Every AI call records token metrics into an `audit_logs` table linked to the `user_id` for accurate per-tenant compute billing scaling.

---

## SECTION 14 — FUTURE SCALE & REDESIGN CRITIQUE

**Critique & Bottlenecks:**
*   *Bottleneck:* Using Postgres for large arbitrary JSON structures (`ocr_results`) can cause row bloat over millions of pages.
*   *V2 Redesign:* The raw OCR JSON output shouldn't live in Postgres. It should be written back to Supabase Storage (S3) as a JSON file, with Postgres only holding a reference string pointer to the storage path. This avoids massive table bloat.
*   *Technical Debt Warning:* Creating hybrid search engines manually forces a lot of tuning (weighing vector scores vs FTS scores). A managed engine for the actual semantic layer (like Pinecone) might prove cheaper at extreme scale, but pgvector is strictly best for V1-V3 MVPs to prevent infrastructure sprawl.
