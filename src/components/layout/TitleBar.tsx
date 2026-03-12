/**
 * TitleBar Component
 * macOS: empty drag region with shell label.
 * Windows/Linux: icon + app/shell label on left, window controls on right.
 */
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Minus, Square, X, Copy } from 'lucide-react';
import logoSvg from '@/assets/logo.svg';
import { cn } from '@/lib/utils';
import { resolveShellMode } from '@/lib/navigation';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';

const isMac = window.electron?.platform === 'darwin';

export function TitleBar() {
  const location = useLocation();
  const resolvedTheme = useResolvedTheme();
  const shellMode = resolveShellMode(location.pathname);

  if (isMac) {
    return (
      <div
        className={cn(
          'drag-region flex h-10 shrink-0 items-center justify-between border-b px-3 backdrop-blur-xl',
          shellMode === 'control'
            ? resolvedTheme === 'dark'
              ? 'border-indigo-500/12 bg-slate-950/70'
              : 'border-indigo-200/80 bg-white/78'
            : resolvedTheme === 'dark'
              ? 'border-cyan-500/10 bg-slate-950/52'
              : 'border-indigo-200/80 bg-white/78'
        )}
      >
        <div className="no-drag flex items-center gap-2 opacity-0">
          <img src={logoSvg} alt="Monoclaw" className="h-5 w-auto" />
        </div>
        <div className="pointer-events-none w-10" />
        <div className="no-drag w-10" />
      </div>
    );
  }

  return <WindowsTitleBar shellMode={shellMode} resolvedTheme={resolvedTheme} />;
}

function WindowsTitleBar({
  shellMode,
  resolvedTheme,
}: {
  shellMode: 'workspace' | 'control' | null;
  resolvedTheme: 'light' | 'dark';
}) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.electron.ipcRenderer.invoke('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  const handleMinimize = () => {
    window.electron.ipcRenderer.invoke('window:minimize');
  };

  const handleMaximize = () => {
    window.electron.ipcRenderer.invoke('window:maximize').then(() => {
      window.electron.ipcRenderer.invoke('window:isMaximized').then((val) => {
        setMaximized(val as boolean);
      });
    });
  };

  const handleClose = () => {
    window.electron.ipcRenderer.invoke('window:close');
  };

  return (
    <div
      className={cn(
        'drag-region flex h-10 shrink-0 items-center justify-between border-b backdrop-blur-xl',
        shellMode === 'control'
          ? resolvedTheme === 'dark'
            ? 'border-indigo-500/12 bg-slate-950/72'
            : 'border-indigo-200/80 bg-white/80'
          : resolvedTheme === 'dark'
            ? 'border-cyan-500/10 bg-slate-950/54'
            : 'border-indigo-200/80 bg-white/80'
      )}
    >
      <div className="no-drag flex items-center gap-3 pl-3">
        <img src={logoSvg} alt="Monoclaw" className="h-5 w-auto" />
        <span className="select-none text-xs font-semibold text-foreground">Monoclaw</span>
      </div>

      <div className="no-drag flex h-full">
        <button
          onClick={handleMinimize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent"
          title="Minimize"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent"
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-red-500 hover:text-white"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
