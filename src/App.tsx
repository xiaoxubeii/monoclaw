/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Component, useEffect } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Dashboard } from './pages/Dashboard';
import { Chat } from './pages/Chat';
import { Channels } from './pages/Channels';
import { Skills } from './pages/Skills';
import { Cron } from './pages/Cron';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { Teams } from './pages/Teams';
import { Ops } from './pages/Ops';
import { RuntimeManager } from './pages/OpenClawManager';
import { MonoclawCore } from './pages/MonoclawCore';
import { useSettingsStore } from './stores/settings';
import { useGatewayStore } from './stores/gateway';
import { APP_ROUTES, LEGACY_ROUTE_REDIRECTS } from '@/lib/navigation';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';

/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          color: '#f87171',
          background: '#0f172a',
          minHeight: '100vh',
          fontFamily: 'monospace'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Something went wrong</h1>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: '#1e293b',
            padding: '16px',
            borderRadius: '8px',
            fontSize: '14px'
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const initSettings = useSettingsStore((state) => state.init);
  const language = useSettingsStore((state) => state.language);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const initGateway = useGatewayStore((state) => state.init);
  const resolvedTheme = useResolvedTheme();

  useEffect(() => {
    initSettings();
  }, [initSettings]);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    initGateway();
  }, [initGateway]);

  // Redirect to setup wizard if not complete
  useEffect(() => {
    if (!setupComplete && !location.pathname.startsWith(APP_ROUTES.setup)) {
      navigate(APP_ROUTES.setup);
    }
  }, [setupComplete, location.pathname, navigate]);

  // Listen for navigation events from main process
  useEffect(() => {
    const handleNavigate = (...args: unknown[]) => {
      const path = args[0];
      if (typeof path === 'string') {
        navigate(path);
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on('navigate', handleNavigate);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  // Apply theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Routes>
          <Route path={`${APP_ROUTES.setup}/*`} element={<Setup />} />
          <Route path={APP_ROUTES.root} element={<Navigate to={APP_ROUTES.workspace.chat} replace />} />
          <Route path={APP_ROUTES.workspace.root} element={<Navigate to={APP_ROUTES.workspace.chat} replace />} />
          <Route path={APP_ROUTES.control.root} element={<Navigate to={APP_ROUTES.control.overview} replace />} />

          <Route element={<MainLayout />}>
            <Route path={APP_ROUTES.workspace.chat} element={<Chat />} />
            <Route path={APP_ROUTES.workspace.skills} element={<Skills />} />
            <Route path={APP_ROUTES.workspace.teams} element={<Teams />} />
            <Route path={`${APP_ROUTES.workspace.teams}/:teamId`} element={<Teams />} />
            <Route path={APP_ROUTES.workspace.automation} element={<Cron />} />

            <Route path={APP_ROUTES.control.overview} element={<Dashboard />} />
            <Route path={APP_ROUTES.control.channels} element={<Channels />} />
            <Route path={APP_ROUTES.control.settings} element={<Settings />} />
            <Route path={`${APP_ROUTES.control.settings}/*`} element={<Settings />} />
            <Route path={APP_ROUTES.control.ops} element={<Ops />} />
            <Route path={APP_ROUTES.control.monoclawCore} element={<MonoclawCore />} />
            <Route path={APP_ROUTES.control.runtimeManager} element={<RuntimeManager />} />

            <Route path="/dashboard" element={<Navigate to={LEGACY_ROUTE_REDIRECTS.dashboard} replace />} />
            <Route path="/channels" element={<Navigate to={LEGACY_ROUTE_REDIRECTS.channels} replace />} />
            <Route path="/skills" element={<Navigate to={LEGACY_ROUTE_REDIRECTS.skills} replace />} />
            <Route path="/teams" element={<Navigate to={LEGACY_ROUTE_REDIRECTS.teams} replace />} />
            <Route path="/teams/:teamId" element={<LegacyTeamRedirect />} />
            <Route path="/cron" element={<Navigate to={LEGACY_ROUTE_REDIRECTS.cron} replace />} />
            <Route path="/settings/*" element={<Navigate to={LEGACY_ROUTE_REDIRECTS.settings} replace />} />
            <Route path="/ops" element={<Navigate to={LEGACY_ROUTE_REDIRECTS.ops} replace />} />
            <Route path="/monoclaw-core" element={<Navigate to={LEGACY_ROUTE_REDIRECTS.monoclawCore} replace />} />
            <Route path="/runtime-manager" element={<Navigate to={LEGACY_ROUTE_REDIRECTS.runtimeManager} replace />} />
            <Route path="/openclaw-manager" element={<Navigate to={LEGACY_ROUTE_REDIRECTS.openclawManager} replace />} />
          </Route>
        </Routes>

        <Toaster
          position="bottom-right"
          richColors
          closeButton
          style={{ zIndex: 99999 }}
        />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

function LegacyTeamRedirect() {
  const location = useLocation();
  const teamId = location.pathname.split('/').filter(Boolean).at(-1);
  return <Navigate to={teamId ? APP_ROUTES.workspace.team(teamId) : APP_ROUTES.workspace.teams} replace />;
}

export default App;
