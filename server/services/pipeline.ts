import { dbUpdateDocument, dbGetDocument, dbInsertPage, dbInsertOcrResult, dbInsertEvent, dbInsertEmbedding } from '../db/supabaseDb.js';
import { processOcr }            from './ocr.js';
import { detectAndTranslate }    from './translation.js';
import { extractStructuredData } from './extraction.js';
import { chunkText, generateEmbeddings } from './embeddings.js';

export async function processDocumentWorkflow(
  documentId: string,
  userId: string,
  fileBase64?: string,
  userApiKey?: string,
  userModel?: string
) {
  try {
    console.log(`[pipeline] Starting for ${documentId}`);
    await dbUpdateDocument(documentId, { status: 'processing' });

    const docData = await dbGetDocument(documentId);
    if (!docData) throw new Error('Document record not found');

    // 1. Decode file
    let fileBuffer = Buffer.from('');
    let mimeType   = 'application/pdf';
    if (fileBase64) {
      const match = fileBase64.match(/^data:([^;]+);base64,/);
      if (match) mimeType = match[1];
      fileBuffer = Buffer.from(fileBase64.split(',')[1] || fileBase64, 'base64');
    }

    // 2. OCR
    await dbUpdateDocument(documentId, { status: 'extracting' });
    const ocrResult = await processOcr(fileBuffer, mimeType, userApiKey, userModel);

    // 3. Per-page: translate + store
    await dbUpdateDocument(documentId, { status: 'translating' });
    let allTextEn    = '';
    let detectedLang = 'en';
    let firstPageId: string | null = null;

    for (const page of ocrResult.pages) {
      const tr = await detectAndTranslate(page.text, userApiKey, userModel);
      if (page.pageNumber === 1) detectedLang = tr.detectedLanguage;
      allTextEn += tr.translatedText + '\n\n';

      const pageRecord = await dbInsertPage({
        document_id:          documentId,
        page_number:          page.pageNumber,
        ocr_status:           'complete',
        raw_text:             page.text,
        content_original:     page.text,
        content_en:           tr.translatedText,
        detected_language:    tr.detectedLanguage,
        requires_human_review: page.confidence < 0.6,
      });
      if (!firstPageId && pageRecord?.id) firstPageId = pageRecord.id;
      if (pageRecord?.id) {
        await dbInsertOcrResult({ page_id: pageRecord.id, raw_json: page.rawJson, confidence_score: page.confidence });
      }
    }

    await dbUpdateDocument(documentId, { language: detectedLang });

    // 4. AI extraction
    await dbUpdateDocument(documentId, { status: 'indexing' });
    const extraction = await extractStructuredData(allTextEn, 1, userApiKey, userModel);
    for (const ev of extraction.events.slice(0, 50)) {
      let finalDate: string | null = null;
      if (ev.date) {
        const d = new Date(ev.date);
        if (!isNaN(d.getTime())) finalDate = d.toISOString();
      }
      await dbInsertEvent({ document_id: documentId, timeline_date: finalDate, event_type: 'GENERIC', description: ev.description, page_source_ref: ev.page_source_ref, confidence: 0.9 });
    }

    // 5. Embeddings
    const chunks  = chunkText(allTextEn, 400, 50);
    const vectors = await generateEmbeddings(chunks);
    if (firstPageId) {
      for (let i = 0; i < chunks.length; i++) {
        await dbInsertEmbedding({ page_id: firstPageId, document_id: documentId, chunk_index: i, content: chunks[i], embedding_vector: vectors[i] });
      }
    }

    await dbUpdateDocument(documentId, { status: 'ready', page_count: ocrResult.pages.length });
    console.log(`[pipeline] Completed ${documentId}`);
  } catch (err) {
    console.error(`[pipeline] Failed ${documentId}:`, err);
    await dbUpdateDocument(documentId, { status: 'failed' });
  }
}
