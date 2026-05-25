import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Calendar, Globe, MessageCircle, Send, X, ChevronDown, ChevronUp, AlertCircle, Loader2 } from 'lucide-react';

interface ReportDoc { id: string; title: string; language?: string; page_count?: number; status: string; created_at: string; pages?: any[]; }
interface ReportEvent { id: string; document_id: string; timeline_date: string | null; description: string; event_type: string; page_source_ref?: number; }
interface ReportData {
  report: { id: string; title: string; description?: string; created_at: string };
  documents: ReportDoc[];
  events: ReportEvent[];
  stats: { totalDocuments: number; totalEvents: number; dateRange: { earliest: string; latest: string } | null; languages: string[] };
  permissions: { view_events: boolean; view_source_text: boolean; view_chat: boolean };
}

export function ReportPage() {
  const { token } = useParams<{ token: string }>();
  const [data,    setData]    = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [chatOpen,    setChatOpen]    = useState(false);
  const [chatInput,   setChatInput]   = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [messages,    setMessages]    = useState<{ role: 'user' | 'assistant'; text: string; citations?: any[] }[]>([]);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/reports/public/${token}`)
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || 'Failed'); }))
      .then(setData).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-3" /><p className="text-gray-500 text-sm">Loading report…</p></div>
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-sm px-4">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <h1 className="text-lg font-semibold text-gray-800 mb-1">Report not found</h1>
        <p className="text-sm text-gray-500">{error || 'This link may have expired or been revoked.'}</p>
      </div>
    </div>
  );

  const { report, documents, events, stats, permissions } = data;

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatLoading(true);
    try {
      const r = await fetch(`/api/reports/public/${token}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: userMsg }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Chat failed');
      setMessages(prev => [...prev, { role: 'assistant', text: d.answer, citations: d.citations }]);
    } catch { setMessages(prev => [...prev, { role: 'assistant', text: 'Something went wrong. Please try again.' }]); }
    finally { setChatLoading(false); }
  };

  const fmtDate = (iso: string | null) => { if (!iso) return 'Unknown date'; try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; } };
  const docForEvent = (id: string) => documents.find(d => d.id === id);

  const eventsByYear = events.reduce<Record<string, ReportEvent[]>>((acc, ev) => {
    const y = ev.timeline_date ? new Date(ev.timeline_date).getFullYear().toString() : 'Unknown';
    acc[y] = [...(acc[y] || []), ev]; return acc;
  }, {});
  const years = Object.keys(eventsByYear).sort((a, b) => a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : Number(a) - Number(b));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{report.title}</h1>
            {report.description && <p className="text-sm text-gray-500 mt-0.5">{report.description}</p>}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400 shrink-0">
            <span>{stats.totalDocuments} doc{stats.totalDocuments !== 1 ? 's' : ''}</span>
            <span>·</span><span>{stats.totalEvents} events</span>
            {stats.languages.length > 0 && <><span>·</span><span className="flex items-center gap-1"><Globe className="w-3 h-3" />{stats.languages.join(', ')}</span></>}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        <div className="grid grid-cols-3 gap-4">
          {[{ label: 'Documents', value: stats.totalDocuments }, { label: 'Events', value: stats.totalEvents }, { label: 'Date range', value: stats.dateRange ? `${fmtDate(stats.dateRange.earliest)} – ${fmtDate(stats.dateRange.latest)}` : 'N/A' }].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className="text-sm font-semibold text-gray-800">{s.value}</p>
            </div>
          ))}
        </div>

        {permissions.view_events && events.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-5">Timeline</h2>
            <div className="space-y-8">
              {years.map(year => (
                <div key={year}>
                  <div className="text-xs font-bold text-blue-600 bg-blue-50 rounded-full px-3 py-1 inline-block mb-4">{year}</div>
                  <div className="relative pl-6 space-y-4 before:absolute before:left-[7px] before:top-0 before:bottom-0 before:w-px before:bg-gray-200">
                    {eventsByYear[year].map(ev => {
                      const doc = docForEvent(ev.document_id);
                      return (
                        <div key={ev.id} className="relative">
                          <div className="absolute -left-[19px] top-1.5 w-2.5 h-2.5 rounded-full bg-blue-400 border-2 border-white" />
                          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm text-gray-800 leading-relaxed">{ev.description}</p>
                              {ev.timeline_date && <span className="text-xs text-gray-400 shrink-0 mt-0.5 flex items-center gap-1"><Calendar className="w-3 h-3" />{fmtDate(ev.timeline_date)}</span>}
                            </div>
                            {doc && <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1"><FileText className="w-3 h-3" />{doc.title}{ev.page_source_ref ? ` · p.${ev.page_source_ref}` : ''}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {permissions.view_source_text && documents.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Source documents</h2>
            <div className="space-y-3">
              {documents.map(doc => (
                <div key={doc.id} className="bg-white rounded-xl border border-gray-200">
                  <button onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)} className="w-full px-4 py-3 flex items-center justify-between text-left">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium text-gray-800">{doc.title}</span>
                      {doc.language && doc.language !== 'en' && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">{doc.language}</span>}
                    </div>
                    {expandedDoc === doc.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>
                  {expandedDoc === doc.id && doc.pages && (
                    <div className="border-t border-gray-100 px-4 py-4 space-y-4">
                      {doc.pages.map((page: any) => (
                        <div key={page.page_number}>
                          <p className="text-xs text-gray-400 mb-1">Page {page.page_number}</p>
                          {page.content_original && page.content_original !== page.content_en && (
                            <div className="mb-2">
                              <p className="text-xs text-gray-400 mb-1">Original ({page.detected_language})</p>
                              <p className="text-xs text-gray-600 bg-gray-50 rounded p-2 whitespace-pre-wrap font-mono leading-relaxed">{page.content_original}</p>
                            </div>
                          )}
                          <div>
                            {page.content_original !== page.content_en && <p className="text-xs text-gray-400 mb-1">English translation</p>}
                            <p className="text-xs text-gray-700 bg-gray-50 rounded p-2 whitespace-pre-wrap font-mono leading-relaxed">{page.content_en || page.content_original}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {permissions.view_chat && (
        <>
          {!chatOpen && (
            <button onClick={() => setChatOpen(true)} className="fixed bottom-6 right-6 w-12 h-12 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-blue-700 transition-colors" aria-label="Open chat">
              <MessageCircle className="w-5 h-5" />
            </button>
          )}
          {chatOpen && (
            <div className="fixed bottom-6 right-6 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col" style={{ height: '420px' }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div><p className="text-sm font-semibold text-gray-800">Ask about this report</p><p className="text-xs text-gray-400">Searches all documents</p></div>
                <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {messages.length === 0 && <div className="text-center text-xs text-gray-400 mt-6"><MessageCircle className="w-6 h-6 mx-auto mb-2 opacity-50" />Ask a question about the documents.</div>}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                      {m.text}
                      {m.citations && m.citations.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-200 space-y-1">
                          {m.citations.map((c: any) => <p key={c.index} className="text-gray-500 text-[10px]">[{c.index}] {c.documentTitle}</p>)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {chatLoading && <div className="flex justify-start"><div className="bg-gray-100 px-3 py-2 rounded-xl"><Loader2 className="w-3 h-3 animate-spin text-gray-400" /></div></div>}
                <div ref={chatEndRef} />
              </div>
              <form onSubmit={handleChat} className="px-3 pb-3">
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                  <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask a question…" className="flex-1 bg-transparent text-xs outline-none text-gray-800 placeholder-gray-400" disabled={chatLoading} />
                  <button type="submit" disabled={chatLoading || !chatInput.trim()} className="text-blue-500 disabled:opacity-30"><Send className="w-3.5 h-3.5" /></button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
