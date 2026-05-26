import { GoogleGenAI } from '@google/genai';
import {
  dbGetDocument,
  dbGetPagesByDocument,
  dbGetReportDocuments,
  dbMatchAcrossReports,
  dbMatchPageChunks,
} from '../db/supabaseDb.js';
import { generateEmbeddings } from './embeddings.js';
import { callGeminiWithRetry } from './gemini.js';

interface ChatAnswerInput {
  query: string;
  documentId?: string;
  reportIds?: string[];
  apiKey?: string;
  model?: string;
}

interface RetrievalChunk {
  document_id?: string;
  document_title?: string;
  page_number?: number;
  content: string;
}

function normalizePageText(page: any) {
  return String(page.content_en || page.raw_text || page.content_original || '').trim();
}

async function getFallbackChunks(documentId?: string, reportIds?: string[]) {
  const chunks: RetrievalChunk[] = [];

  if (documentId) {
    const [doc, pages] = await Promise.all([
      dbGetDocument(documentId),
      dbGetPagesByDocument(documentId),
    ]);

    for (const page of pages) {
      const text = normalizePageText(page);
      if (!text) continue;
      chunks.push({
        document_id: documentId,
        document_title: doc?.title || 'document',
        page_number: page.page_number,
        content: `Page ${page.page_number}\n${text}`,
      });
    }
  }

  for (const reportId of reportIds || []) {
    const docs = await dbGetReportDocuments(reportId);
    for (const doc of docs) {
      const pages = await dbGetPagesByDocument(doc.id);
      for (const page of pages) {
        const text = normalizePageText(page);
        if (!text) continue;
        chunks.push({
          document_id: doc.id,
          document_title: doc.title,
          page_number: page.page_number,
          content: `Page ${page.page_number}\n${text}`,
        });
      }
    }
  }

  return chunks;
}

function buildContext(chunks: RetrievalChunk[]) {
  let totalChars = 0;
  const maxChars = 60000;
  const selected: RetrievalChunk[] = [];

  for (const chunk of chunks) {
    if (totalChars >= maxChars) break;
    const remaining = maxChars - totalChars;
    const content = chunk.content.length > remaining ? chunk.content.slice(0, remaining) : chunk.content;
    selected.push({ ...chunk, content });
    totalChars += content.length;
  }

  return {
    selected,
    contextStr: selected.length > 0
      ? selected.map((c, i) => `[${i + 1}] From "${c.document_title || 'document'}"${c.page_number ? ` page ${c.page_number}` : ''}:\n${c.content}`).join('\n\n')
      : 'No relevant context found in the documents.',
  };
}

export async function answerDocumentQuestion({ query, documentId, reportIds, apiKey, model }: ChatAnswerInput) {
  let chunks: RetrievalChunk[] = [];

  if (process.env.VOYAGE_API_KEY) {
    try {
      const [queryVector] = await generateEmbeddings([query]);
      chunks = documentId
        ? await dbMatchPageChunks(documentId, queryVector, 6)
        : await dbMatchAcrossReports(reportIds || [], queryVector, 8);
    } catch (err: any) {
      console.warn(`[chat] Vector retrieval failed, falling back to OCR text: ${err?.message || err}`);
    }
  }

  if (chunks.length === 0) {
    chunks = await getFallbackChunks(documentId, reportIds);
  }

  const { selected, contextStr } = buildContext(chunks);

  let answer = 'AI generation unavailable. Configure a Gemini API key in Settings.';
  if (apiKey) {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    const prompt = `You are a document analysis assistant. Answer using ONLY the context below. Cite sources as [1], [2] etc. If the answer is not in the context, say so clearly.\n\nContext:\n${contextStr}\n\nQuestion: ${query}`;
    const response = await callGeminiWithRetry(
      () => ai.models.generateContent({ model: model || 'gemini-1.5-flash', contents: prompt }),
      'gemini-chat'
    );
    answer = response.text || 'No response generated.';
  }

  return {
    answer,
    citations: selected.map((c: any, i: number) => ({
      index: i + 1,
      documentId: c.document_id,
      documentTitle: c.document_title || 'Unknown',
      pageNumber: c.page_number,
      excerpt: c.content.substring(0, 200) + '...',
    })),
  };
}
