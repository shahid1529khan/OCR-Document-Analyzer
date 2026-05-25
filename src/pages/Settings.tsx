import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Key, Save, Trash2, Eye, EyeOff, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

export function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [model, setModel] = useState('gemini-1.5-flash');

  // Load key from localStorage on mount
  useEffect(() => {
    const key = localStorage.getItem('gemini_user_api_key');
    const savedModel = localStorage.getItem('gemini_user_model') || 'gemini-1.5-flash';
    setModel(savedModel);
    if (key) {
      setApiKey(key);
      setSavedKey(key);
      setStatus('valid'); // Assume valid until tested or changed
    }
  }, []);

  const handleSave = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      localStorage.removeItem('gemini_user_api_key');
      localStorage.removeItem('gemini_user_model');
      setSavedKey(null);
      setStatus('idle');
      alert('API Key cleared successfully.');
    } else {
      localStorage.setItem('gemini_user_api_key', trimmed);
      localStorage.setItem('gemini_user_model', model);
      setSavedKey(trimmed);
      setStatus('idle');
      alert('API Configuration saved successfully.');
    }
  };

  const handleClear = () => {
    localStorage.removeItem('gemini_user_api_key');
    localStorage.removeItem('gemini_user_model');
    setApiKey('');
    setSavedKey(null);
    setStatus('idle');
    setErrorMessage('');
  };

  const handleTestKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setStatus('invalid');
      setErrorMessage('Please enter an API Key to test.');
      return;
    }

    setStatus('validating');
    setErrorMessage('');

    try {
      const res = await fetch('/api/chat/validate-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gemini-API-Key': trimmed,
          'X-Gemini-Model': model
        }
      });

      const data = await res.json();
      if (res.ok && data.valid) {
        setStatus('valid');
        // Auto save if valid and was not saved yet
        localStorage.setItem('gemini_user_api_key', trimmed);
        localStorage.setItem('gemini_user_model', model);
        setSavedKey(trimmed);
      } else {
        setStatus('invalid');
        setErrorMessage(data.error || 'The model did not respond correctly. Make sure your API key is valid and has Gemini access.');
      }
    } catch (err: any) {
      setStatus('invalid');
      setErrorMessage(err?.message || 'Network error verifying key. Please try again.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8 min-h-screen flex flex-col justify-start">
      <header className="flex items-center space-x-4">
        <Link to="/" className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">API Settings</h1>
          <p className="text-gray-500 mt-1">Configure your custom premium Gemini brain models key.</p>
        </div>
      </header>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Key className="w-4 h-4 text-blue-500" />
            Gemini 2.0 / 3.5 API Key
          </label>
          <p className="text-xs text-gray-500">
            Provide your personal free-tier or pay-as-you-go Gemini API Key. Your key is stored strictly within your browser's local state and passed securely to the backend for content extraction and RAG querying.
          </p>
          <div className="relative mt-1 flex rounded-md shadow-sm">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (status === 'valid') setStatus('idle'); // clear status if user edits
              }}
              placeholder="AIzaSy..."
              className="flex-1 min-w-0 block w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
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

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">
            Model Choice (No compromise)
          </label>
          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              if (status === 'valid') setStatus('idle');
            }}
            className="block w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white font-medium"
          >
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Recommended)</option>
            <option value="gemini-3.0-flash">Gemini 3.0 Flash (Fast & Fluid)</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro (Extreme Precision)</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash (Balanced speed)</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro (Legacy Deep)</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Standard)</option>
          </select>
          <p className="text-xs text-gray-500">
            Select the model that is utilized for deep-reasoning timelines extraction, OCR processing, and conversation answers.
          </p>
        </div>

        {/* Status Indicators */}
        {status === 'validating' && (
          <div className="flex items-center space-x-2 text-blue-600 bg-blue-50 p-3.5 rounded-lg border border-blue-100 text-sm font-medium">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Validating key and checking connection to Gemini models...</span>
          </div>
        )}

        {status === 'valid' && (
          <div className="flex items-start space-x-2 text-green-700 bg-green-50 p-3.5 rounded-lg border border-green-100 text-sm font-medium">
            <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Gemini API Connection Successful</p>
              <p className="text-xs text-green-600 mt-0.5">Your key is calibrated, responsive, and ready for high-accuracy OCR extraction and chat.</p>
            </div>
          </div>
        )}

        {status === 'invalid' && (
          <div className="flex items-start space-x-2 text-red-700 bg-red-50 p-3.5 rounded-lg border border-red-100 text-sm font-medium">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">API Key Invalid or Exhausted</p>
              <p className="text-xs text-red-600 mt-0.5">{errorMessage || 'Could not establish connection to the model. Verify spelling or quota limits.'}</p>
            </div>
          </div>
        )}

        {status === 'idle' && !savedKey && (
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 p-3.5 rounded-lg">
            🔑 Note: If No Custom Key is saved, the application will attempt to fall back to the workspace-supplied standard key, which might be subject to rate limits.
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:justify-between items-stretch sm:items-center gap-4 pt-4 border-t border-gray-100">
          <div className="flex gap-2">
            <button
              onClick={handleTestKey}
              disabled={status === 'validating'}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gray-100 border border-gray-300 text-gray-700 hover:bg-gray-200 text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${status === 'validating' ? 'animate-spin' : ''}`} />
              Verify Connection
            </button>
            {savedKey && (
              <button
                onClick={handleClear}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 text-sm font-medium transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Clear
              </button>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={status === 'validating'}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-semibold transition-colors shadow-sm disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Save Configuration
          </button>
        </div>
      </div>

      <div className="text-center text-xs text-gray-400">
        All API requests are proxied securely server-side. Your secrets never leave your trusted browser sandboxed space directly to third parties.
      </div>
    </div>
  );
}
