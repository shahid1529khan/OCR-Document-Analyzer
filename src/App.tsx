import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthPage }     from './pages/Auth';
import { Dashboard }    from './pages/Dashboard';
import { DocumentView } from './pages/DocumentView';
import { SettingsPage } from './pages/Settings';
import { ReportPage }   from './pages/ReportPage';
import { useAuthStore } from './store/auth';

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuthStore();
  if (loading) return <div className="h-screen flex items-center justify-center bg-gray-50 text-gray-400 text-sm">Loading workspace…</div>;
  if (!session) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

export default function App() {
  const { session, loading } = useAuthStore();
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public — no auth required */}
          <Route path="/report/:token" element={<ReportPage />} />
          {/* Auth */}
          <Route path="/auth" element={!loading && session ? <Navigate to="/" replace /> : <AuthPage />} />
          {/* Protected */}
          <Route path="/"             element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/document/:id" element={<ProtectedRoute><DocumentView /></ProtectedRoute>} />
          <Route path="/settings"     element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
