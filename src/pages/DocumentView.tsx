import React, { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Send, FileText, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/auth';

interface Citation {
  index: number;
  documentId?: string;
  documentTitle?: string;
  pageNumber?: number;
  excerpt?: string;
}

export function DocumentView() {
  const { id } = useParams();
  const { session } = useAuthStore();
  const [query, setQuery] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'assistant', content: string, citations?: Citation[]}[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: events, isLoading } = useQuery({
    queryKey: ['events', id],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${id}/events`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch events');
      return res.json();
    }
  });

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isChatting) return;

    const userMsg = query;
    setQuery('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsChatting(true);

    try {
      const userApiKey = localStorage.getItem('gemini_user_api_key') || '';
      const userModel = localStorage.getItem('gemini_user_model') || 'gemini-1.5-flash';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`
      };
      if (userApiKey) {
        headers['X-Gemini-API-Key'] = userApiKey;
      }
      if (userModel) {
        headers['X-Gemini-Model'] = userModel;
      }

      const res = await fetch(`/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ documentId: id, query: userMsg, userApiKey, userModel })
      });
      
      if (!res.ok) throw new Error('Chat failed');
      const data = await res.json();
      
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: data.answer,
        citations: data.citations
      }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error answering that.' }]);
    } finally {
      setIsChatting(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, isChatting]);

  return (
    <div className="flex h-screen bg-gray-50 flex-col md:flex-row">
      {/* Left: Timeline & Data */}
      <div className="flex-1 flex flex-col md:border-r border-gray-200 bg-white">
        <header className="p-4 border-b border-gray-200 flex items-center space-x-4">
          <Link to="/" className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-semibold text-gray-900 truncate">Document Analysis</h1>
        </header>
        
        <div className="flex-1 overflow-y-auto p-6">
          <h2 className="text-xl font-bold tracking-tight mb-6">Extracted Timeline</h2>
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
          ) : events?.length === 0 ? (
            <p className="text-gray-500 text-sm">No chronological events extracted.</p>
          ) : (
            <div className="space-y-4">
              {events?.map((ev: any) => (
                <div key={ev.id} className="relative pl-6 pb-6 border-l-2 border-gray-200 last:border-l-0">
                  <div className="absolute w-3 h-3 bg-blue-500 rounded-full -left-[7px] top-1.5 border-4 border-white shadow-sm" />
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-blue-700">
                        {ev.timeline_date ? new Date(ev.timeline_date).toLocaleDateString() : 'Approx Date'}
                      </span>
                      {ev.page_source_ref && (
                        <span className="inline-flex items-center text-xs text-gray-400 bg-white px-2 py-1 rounded border border-gray-200">
                          <FileText className="w-3 h-3 mr-1" /> Page {ev.page_source_ref}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800">{ev.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: RAG Chat */}
      <div className="w-full md:w-[400px] lg:w-[500px] flex flex-col bg-gray-50">
        <div className="p-4 border-b border-gray-200 bg-white">
          <h2 className="font-semibold text-gray-900">Ask Document</h2>
          <p className="text-xs text-gray-500">Powered by pgvector & {localStorage.getItem('gemini_user_model') || 'gemini-1.5-flash'}</p>
        </div>
        
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatHistory.length === 0 && (
            <div className="h-full flex items-center justify-center text-center p-6 text-gray-400 text-sm">
              Ask questions about this document.<br/>Answers will include cited page numbers.
            </div>
          )}
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === 'user' ? 'bg-blue-600 text-white shadow-sm origin-bottom-right' : 'bg-white border border-gray-200 text-gray-800 shadow-sm origin-bottom-left'
              }`}>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-1">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider mr-1 my-auto">Sources:</span>
                    {msg.citations.map((cite) => (
                      <span key={cite.index} className="inline-flex items-center text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-sm">
                        {cite.pageNumber ? `Page ${cite.pageNumber}` : `[${cite.index}]`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {isChatting && (
            <div className="flex items-start">
              <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm flex items-center space-x-2 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Thinking...</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="p-4 bg-white border-t border-gray-200">
          <form onSubmit={handleChat} className="flex space-x-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="E.g. What were the key findings?"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm shadow-sm"
              disabled={isChatting}
            />
            <button 
              type="submit" 
              disabled={isChatting || !query.trim()}
              className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              <Send className="w-4 h-4 m-1 -ml-0.5 mt-0.5 rotate-45" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
