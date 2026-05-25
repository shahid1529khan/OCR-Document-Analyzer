# Timeline Engine

React + Express document OCR and timeline extraction app backed by Supabase, Gemini, and Voyage embeddings.

## Required Environment

Create `final/.env` for local development, and set the same values in your deployment platform:

```env
PORT=5000
APP_URL=http://localhost:5000

VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

GEMINI_API_KEY=optional-server-side-gemini-key
GEMINI_MODEL=gemini-1.5-flash
VOYAGE_API_KEY=optional-voyage-api-key
```

Supabase Auth redirect URLs should include:

```text
http://localhost:5000/auth
```

For production, also add:

```text
https://your-production-domain/auth
```

## Local Testing

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5000
```

## Verification

```powershell
npm test
npm run build
```

`npm test` runs the TypeScript check. `npm run build` creates the production bundle in `dist/`.

## Production Start

```powershell
npm run build
npm start
```

The server reads `PORT`, defaults to `5000`, serves the built frontend, and exposes the API under `/api`.

## Database

Run `supabase/migrations/00_complete_schema.sql` once in the Supabase SQL editor. The migration is idempotent and uses `vector(1024)` to match the current Voyage embedding implementation.
