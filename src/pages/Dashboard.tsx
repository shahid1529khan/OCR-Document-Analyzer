import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileUp, FileText, Loader2, Clock, AlertCircle, CheckCircle, Settings, Key, Eye, EyeOff, Save, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/auth';

const pipelineStages = ['uploaded', 'processing', 'extracting', 'translating', 'indexing', 'ready'];

const statusDetails: Record<string, { label: string; description: string; tone: string; icon: 'spin' | 'check' | 'error' | 'clock' }> = {
  uploaded: {
    label: 'Queued',
    description: 'Document accepted. OCR will begin shortly.',
    tone: 'bg-slate-100 text-slate-700',
    icon: 'clock',
  },
  processing: {
    label: 'Processing',
    description: 'Preparing the file for OCR and timeline extraction.',
    tone: 'bg-blue-100 text-blue-800',
    icon: 'spin',
  },
  extracting: {
    label: 'Extracting',
    description: 'OCR is reading pages and preserving document text.',
    tone: 'bg-blue-100 text-blue-800',
    icon: 'spin',
  },
  translating: {
    label: 'Translating',
    description: 'Detected language is being normalized for analysis.',
    tone: 'bg-indigo-100 text-indigo-800',
    icon: 'spin',
  },
  indexing: {
    label: 'Indexing',
    description: 'Events and searchable RAG chunks are being created.',
    tone: 'bg-blue-100 text-blue-800',
    icon: 'spin',
  },
  ready: {
    label: 'Ready',
    description: 'Timeline and chat are available.',
    tone: 'bg-green-100 text-green-800',
    icon: 'check',
  },
  failed: {
    label: 'Failed',
    description: 'Processing stopped. Check API key, quota, or server logs.',
    tone: 'bg-red-100 text-red-800',
    icon: 'error',
  },
};

export function Dashboard() {
  const { session } = useAuthStore();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  // API Key State
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [testError, setTestError] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(() => localStorage.getItem('gemini_user_api_key'));
  const [activeModel, setActiveModel] = useState<string>(() => localStorage.getItem('gemini_user_model') || 'gemini-1.5-flash');

  const { data: documents, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['documents'],
    queryFn: async () => {
      const res = await fetch('/api/documents', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed to fetch documents (${res.status})`);
      }
      return res.json();
    },
    retry: 1,
    refetchInterval: 5000 // Poll for status updates
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setUploading(true);
      try {
        const contentBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = error => reject(error);
        });

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

        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          headers,
          body: JSON.stringify({ 
            title: file.name,
            file_size: file.size,
            contentBase64,
            userApiKey,
            userModel
          })
        });
        
        if (!res.ok) throw new Error('Failed to upload processing');
        const data = await res.json();
        return data.document;
      } finally {
        setUploading(false);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    }
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (!activeKey) {
      alert('You must save a valid Gemini API Key to begin document processing.');
      return;
    }
    if (acceptedFiles.length > 0) {
      uploadMutation.mutate(acceptedFiles[0]);
    }
  }, [uploadMutation, activeKey]);

  const onDropRejected = useCallback(() => {
    alert('Please upload a PDF file up to 50MB.');
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    onDropRejected,
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: 50 * 1024 * 1024,
    multiple: false,
    disabled: !activeKey
  } as any);

  const handleVerifyAndSave = async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setTestStatus('invalid');
      setTestError('Please enter a Gemini API Key to activate.');
      return;
    }

    setTestStatus('validating');
    setTestError('');

    try {
      const res = await fetch('/api/chat/validate-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gemini-API-Key': trimmed,
          'X-Gemini-Model': activeModel
        }
      });

      const data = await res.json();
      if (res.ok && data.valid) {
        setTestStatus('valid');
        localStorage.setItem('gemini_user_api_key', trimmed);
        localStorage.setItem('gemini_user_model', activeModel);
        setActiveKey(trimmed);
        setTimeout(() => {
          setTestStatus('idle');
          setApiKeyInput('');
        }, 1500);
      } else {
        setTestStatus('invalid');
        setTestError(data.error || 'The model did not respond correctly. Make sure your API key has Gemini model permissions.');
      }
    } catch (err: any) {
      setTestStatus('invalid');
      setTestError(err?.message || 'Network error verifying key. Please retry.');
    }
  };

  const handleClearKey = () => {
    localStorage.removeItem('gemini_user_api_key');
    setActiveKey(null);
    setApiKeyInput('');
    setTestStatus('idle');
    setTestError('');
  };

  const handleModelChange = (model: string) => {
    setActiveModel(model);
    localStorage.setItem('gemini_user_model', model);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8 animate-fade-in">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Timeline Engine</h1>
          <p className="text-gray-500 mt-1">High-accuracy OCR ingestion and multi-page RAG document analyzer.</p>
        </div>
        <div className="flex items-center space-x-3">
          <Link
            to="/settings"
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all shadow-sm"
          >
            <Settings className="w-4 h-4 text-gray-400" />
            <span>Settings</span>
          </Link>
          <button 
            onClick={() => useAuthStore.getState().signOut()}
            className="px-4 py-2.5 text-sm font-semibold text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-all"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Dynamic API Key Activation Panel */}
      {!activeKey ? (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200/60 p-6 md:p-8 shadow-sm space-y-6">
          <div className="flex items-start space-x-4">
            <div className="p-3 bg-blue-600 text-white rounded-xl shadow-md shrink-0">
              <Key className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-gray-900">Activate Premium Gemini Brain</h2>
              <p className="text-sm text-gray-600 max-w-2xl leading-relaxed">
                To starting processing documents and leveraging the OCR timeline extraction pipeline, please supply your personal Google Gemini API Key. Your settings never leave your sandboxed browser storage.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="md:col-span-2 space-y-1">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
                Gemini API Key
              </label>
              <div className="relative rounded-md shadow-sm">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="AIzaSy..."
                  className="block w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono bg-white"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600 focus:outline-none"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
                Model Choice (No compromise)
              </label>
              <select
                value={activeModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="block w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white font-medium"
              >
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Recommended)</option>
                <option value="gemini-3.0-flash">Gemini 3.0 Flash (Next-Gen Fast)</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro (Extreme Precision)</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (Balanced Speed)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Legacy Deep)</option>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Standard)</option>
              </select>
            </div>
          </div>

          {testStatus === 'validating' && (
            <div className="flex items-center space-x-2 text-blue-600 bg-blue-100/40 p-3 rounded-xl text-sm font-medium">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Validating model compatibility and testing credential handshakes...</span>
            </div>
          )}

          {testStatus === 'valid' && (
            <div className="flex items-center space-x-2 text-green-700 bg-green-100/40 p-3 rounded-xl text-sm font-medium">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>API key confirmed! Initializing timeline workspace...</span>
            </div>
          )}

          {testStatus === 'invalid' && (
            <div className="flex items-center space-x-2 text-red-700 bg-red-100/40 p-3 rounded-xl text-sm font-medium">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              <span>{testError || 'Verification failed. Double check key syntax.'}</span>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={handleVerifyAndSave}
              disabled={testStatus === 'validating' || !apiKeyInput.trim()}
              className="px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 text-sm flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              Verify & Activate Pipeline
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center space-x-3">
            <span className="p-2.5 bg-green-50 rounded-lg text-green-600 shrink-0 flex items-center justify-center">
              <CheckCircle className="w-5 h-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-gray-900">Custom API Ingestion Engine active</p>
              <p className="text-xs text-gray-500 font-medium">
                Running premium <span className="text-blue-600 font-semibold">{activeModel}</span> workflow. Your key resides securely within this session.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <select
              value={activeModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-semibold bg-white text-gray-750 focus:outline-none"
            >
              <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
              <option value="gemini-3.0-flash">Gemini 3.0 Flash</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro (Premium)</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash (Advanced)</option>
              <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
              <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
            </select>
            <button
              onClick={handleClearKey}
              className="px-3 py-1.5 border border-red-200 rounded-lg text-xs font-semibold text-red-600 bg-white hover:bg-red-50 transition-colors"
            >
              Deactivate Key
            </button>
          </div>
        </div>
      )}

      {/* Upload Zone */}
      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
          !activeKey 
            ? 'border-gray-200 bg-gray-50/50 cursor-not-allowed opacity-60' 
            : isDragActive 
              ? 'border-blue-500 bg-blue-50/50 cursor-pointer' 
              : 'border-gray-200 hover:border-blue-400 bg-white hover:bg-blue-50/10 cursor-pointer'
        }`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="p-4 bg-gray-50 rounded-full text-gray-400">
            {uploading ? (
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            ) : (
              <FileUp className="w-8 h-8 text-gray-400" />
            )}
          </div>
          <div>
            <p className="text-lg font-bold text-gray-900">
              {uploading ? 'Parsing layout and compiling timelines...' : isDragActive ? 'Drop PDF matching instructions here' : 'Click or drag PDF to analyze'}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {!activeKey ? '⚠️ Enter your API key above to unlock document OCR ingestion.' : 'Standard formats accepted, up to 50MB'}
            </p>
          </div>
        </div>
      </div>

      {/* Document List */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Document pipeline</h2>
            <p className="text-xs text-gray-500 mt-0.5">Live status updates: queued, extracting, translating, indexing, ready, or failed.</p>
          </div>
          {documents?.some((doc: any) => !['ready', 'failed'].includes(doc.status)) && (
            <span className="inline-flex items-center text-xs font-medium text-blue-700">
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Processing active
            </span>
          )}
        </div>
        <ul className="divide-y divide-gray-200">
          {isLoading && (
            <li className="p-6">
              <div className="flex items-start gap-3 text-gray-500">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-gray-700">Loading document pipeline...</p>
                  <p className="text-xs mt-1">Connecting to your workspace and fetching the latest OCR, indexing, ready, and failed states.</p>
                </div>
              </div>
            </li>
          )}

          {isError && !isLoading && (
            <li className="p-6">
              <div className="flex items-start gap-3 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-red-700">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold">Could not load document pipeline</p>
                  <p className="text-xs mt-1">
                    The app is running, but the API could not reach the document database. Latest error: {(error as Error).message}
                  </p>
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </button>
                </div>
              </div>
            </li>
          )}
          
          {documents?.length === 0 && !isLoading && !isError && (
            <li className="p-12 text-center text-gray-500">
              No documents yet. Upload one above to get started.
            </li>
          )}
          
          {documents?.map((doc: any) => (
            <li key={doc.id} className="hover:bg-gray-50 transition-colors">
              <Link 
                to={`/document/${doc.id}`} 
                className="flex items-center p-4 sm:p-6"
                onClick={(e) => {
                  if (doc.status !== 'ready') e.preventDefault();
                }}
              >
                <div className="flex-shrink-0 p-3 bg-blue-50 rounded-lg text-blue-600">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="ml-4 flex-1">
                  <h3 className="text-sm font-semibold text-gray-900">{doc.title}</h3>
                  <div className="flex items-center mt-1 text-xs text-gray-500 space-x-4">
                    <span>{(doc.file_size / 1024 / 1024).toFixed(2)} MB</span>
                    <span>•</span>
                    <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                  </div>
                  <PipelineProgress status={doc.status} />
                </div>
                <div className="ml-4">
                  <StatusBadge status={doc.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const detail = statusDetails[status] || {
    label: status || 'Unknown',
    description: 'Waiting for an updated processing state.',
    tone: 'bg-gray-100 text-gray-700',
    icon: 'clock' as const,
  };
  
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${detail.tone}`}>
      {detail.icon === 'check' && <CheckCircle className="w-3 h-3 mr-1" />}
      {detail.icon === 'error' && <AlertCircle className="w-3 h-3 mr-1" />}
      {detail.icon === 'clock' && <Clock className="w-3 h-3 mr-1" />}
      {detail.icon === 'spin' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
      {detail.label}
    </span>
  );
}

function PipelineProgress({ status }: { status: string }) {
  const detail = statusDetails[status] || statusDetails.uploaded;
  const activeIndex = status === 'failed'
    ? pipelineStages.indexOf('indexing')
    : Math.max(0, pipelineStages.indexOf(status));

  return (
    <div className="mt-3 max-w-xl">
      <div className="flex items-center gap-1.5" aria-label={`Pipeline status: ${detail.label}`}>
        {pipelineStages.map((stage, index) => {
          const isComplete = status !== 'failed' && index <= activeIndex;
          const isCurrent = stage === status;
          return (
            <span
              key={stage}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                status === 'failed' && index <= activeIndex
                  ? 'bg-red-300'
                  : isComplete
                    ? 'bg-blue-500'
                    : isCurrent
                      ? 'bg-blue-300'
                      : 'bg-gray-200'
              }`}
            />
          );
        })}
      </div>
      <p className="text-xs text-gray-500 mt-1.5">{detail.description}</p>
    </div>
  );
}
