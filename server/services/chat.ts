import { GoogleGenAI } from '@google/genai';
import { dbMatchAcrossReports, dbMatchPageChunks } from '../db/supabaseDb.js';
import { generateEmbeddings } from './embeddings.js';

interface ChatAnswerInput {
  query: string;
  documentId?: string;
  reportIds?: string[];
  apiKey?: string;
  model?: string;
}

async function callWithRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1500): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const message = String(err?.message || '');
    const isRateLimited = err?.status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED');
    if (retries > 0 && isRateLimited) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return callWithRetry(fn, retries - 1, delay * 2);
    }
    throw err;
  }
}

export async function answerDocumentQuestion({ query, documentId, reportIds, apiKey, model }: ChatAnswerInput) {
  const [queryVector] = await generateEmbeddings([query]);
  const chunks: any[] = documentId
    ? await dbMatchPageChunks(documentId, queryVector, 6)
    : await dbMatchAcrossReports(reportIds || [], queryVector, 8);

  const contextStr = chunks.length > 0
    ? chunks.map((c: any, i: number) => `[${i + 1}] From "${c.document_title || 'document'}":\n${c.content}`).join('\n\n')
    : 'No relevant context found in the documents.';

  let answer = 'AI generation unavailable. Configure a Gemini API key in Settings.';
  if (apiKey) {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    const prompt = `You are a document analysis assistant. Answer using ONLY the context below. Cite sources as [1], [2] etc. If the answer is not in the context, say so clearly.\n\nContext:\n${contextStr}\n\nQuestion: ${query}`;
    const response = await callWithRetry(() => ai.models.generateContent({ model: model || 'gemini-1.5-flash', contents: prompt }));
    answer = response.text || 'No response generated.';
  }

  return {
    answer,
    citations: chunks.map((c: any, i: number) => ({
      index: i + 1,
      documentId: c.document_id,
      documentTitle: c.document_title || 'Unknown',
      excerpt: c.content.substring(0, 200) + '...',
    })),
  };
}
