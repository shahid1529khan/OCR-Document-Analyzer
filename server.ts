import 'dotenv/config';
import express from 'express';
import path    from 'path';
import { createServer as createViteServer } from 'vite';
import { documentRouter } from './server/routes/documents.js';
import { chatRouter }     from './server/routes/chat.js';
import { reportRouter }   from './server/routes/reports.js';

async function startServer() {
  const app  = express();
  const parsedPort = Number(process.env.PORT || 5000);
  const PORT = Number.isFinite(parsedPort) ? parsedPort : 5000;

  app.set('trust proxy', true);
  app.use(express.json({ limit: '100mb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', message: 'Document Processing API Online' }));

  app.use('/api/documents', documentRouter);
  app.use('/api/chat',      chatRouter);
  app.use('/api/reports',   reportRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${PORT}`));
}

startServer().catch(err => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
