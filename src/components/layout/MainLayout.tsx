/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import type { CSSProperties } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { cn } from '@/lib/utils';
import { resolveShellMode } from '@/lib/navigation';
import { useResolvedTheme, type ResolvedTheme } from '@/hooks/useResolvedTheme';

type ShellVars = CSSProperties & Record<string, string>;
type ShellMode = 'workspace' | 'control';

const shellVarsByMode: Record<ShellMode, Record<ResolvedTheme, ShellVars>> = {
  workspace: {
    dark: {
      colorScheme: 'dark',
      '--background': '197 46% 8%',
      '--foreground': '210 40% 96%',
      '--card': '197 42% 10%',
      '--card-foreground': '210 40% 96%',
      '--popover': '197 42% 10%',
      '--popover-foreground': '210 40% 96%',
      '--primary': '188 95% 56%',
      '--primary-foreground': '198 58% 8%',
      '--secondary': '191 30% 15%',
      '--secondary-foreground': '210 40% 96%',
      '--muted': '191 28% 14%',
      '--muted-foreground': '198 18% 72%',
      '--accent': '188 28% 16%',
      '--accent-foreground': '210 40% 96%',
      '--border': '192 30% 18%',
      '--input': '192 30% 18%',
      '--ring': '188 95% 56%',
    },
    light: {
      colorScheme: 'light',
      '--background': '225 60% 97%',
      '--foreground': '230 34% 14%',
      '--card': '0 0% 100%',
      '--card-foreground': '230 34% 14%',
      '--popover': '0 0% 100%',
      '--popover-foreground': '230 34% 14%',
      '--primary': '227 78% 58%',
      '--primary-foreground': '0 0% 100%',
      '--secondary': '228 42% 93%',
      '--secondary-foreground': '230 30% 21%',
      '--muted': '228 38% 95%',
      '--muted-foreground': '228 16% 45%',
      '--accent': '228 50% 92%',
      '--accent-foreground': '230 36% 20%',
      '--border': '228 27% 86%',
      '--input': '228 27% 86%',
      '--ring': '227 78% 58%',
    },
  },
  control: {
    dark: {
      colorScheme: 'dark',
      '--background': '197 46% 8%',
      '--foreground': '210 40% 96%',
      '--card': '197 42% 10%',
      '--card-foreground': '210 40% 96%',
      '--popover': '197 42% 10%',
      '--popover-foreground': '210 40% 96%',
      '--primary': '188 95% 56%',
      '--primary-foreground': '198 58% 8%',
      '--secondary': '191 30% 15%',
      '--secondary-foreground': '210 40% 96%',
      '--muted': '191 28% 14%',
      '--muted-foreground': '198 18% 72%',
      '--accent': '188 28% 16%',
      '--accent-foreground': '210 40% 96%',
      '--border': '192 30% 18%',
      '--input': '192 30% 18%',
      '--ring': '188 95% 56%',
    },
    light: {
      colorScheme: 'light',
      '--background': '225 60% 97%',
      '--foreground': '230 34% 14%',
      '--card': '0 0% 100%',
      '--card-foreground': '230 34% 14%',
      '--popover': '0 0% 100%',
      '--popover-foreground': '230 34% 14%',
      '--primary': '227 78% 58%',
      '--primary-foreground': '0 0% 100%',
      '--secondary': '228 42% 93%',
      '--secondary-foreground': '230 30% 21%',
      '--muted': '228 38% 95%',
      '--muted-foreground': '228 16% 45%',
      '--accent': '228 50% 92%',
      '--accent-foreground': '230 36% 20%',
      '--border': '228 27% 86%',
      '--input': '228 27% 86%',
      '--ring': '227 78% 58%',
    },
  },
};

const shellSurfaceClass: Record<ShellMode, Record<ResolvedTheme, string>> = {
  workspace: {
    dark: 'bg-[#06131b]',
    light: 'bg-[#f4f7ff]',
  },
  control: {
    dark: 'bg-[#06131b]',
    light: 'bg-[#f4f7ff]',
  },
};

const shellAuraClass: Record<ShellMode, Record<ResolvedTheme, string>> = {
  workspace: {
    dark: 'bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.1),transparent_24%),linear-gradient(180deg,rgba(2,6,23,0.92)_0%,rgba(6,19,27,0.98)_100%)]',
    light: 'bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(129,140,248,0.11),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,247,255,0.99)_100%)]',
  },
  control: {
    dark: 'bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.1),transparent_24%),linear-gradient(180deg,rgba(2,6,23,0.92)_0%,rgba(6,19,27,0.98)_100%)]',
    light: 'bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(129,140,248,0.11),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,247,255,0.99)_100%)]',
  },
};

const shellGridClass: Record<ShellMode, Record<ResolvedTheme, string>> = {
  workspace: {
    dark: 'bg-[linear-gradient(rgba(34,211,238,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.045)_1px,transparent_1px)] [background-size:36px_36px]',
    light: 'bg-[linear-gradient(rgba(99,102,241,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.06)_1px,transparent_1px)] [background-size:28px_28px]',
  },
  control: {
    dark: 'bg-[linear-gradient(rgba(34,211,238,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.045)_1px,transparent_1px)] [background-size:36px_36px]',
    light: 'bg-[linear-gradient(rgba(99,102,241,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.06)_1px,transparent_1px)] [background-size:28px_28px]',
  },
};

export function MainLayout() {
  const location = useLocation();
  const resolvedTheme = useResolvedTheme();
  const shellMode = (resolveShellMode(location.pathname) ?? 'workspace') as ShellMode;
  const shellVars = shellVarsByMode[shellMode][resolvedTheme];

  return (
    <div
      className={cn(
        'relative flex h-screen flex-col overflow-hidden text-foreground',
        shellSurfaceClass[shellMode][resolvedTheme]
      )}
      style={shellVars}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0',
          shellAuraClass[shellMode][resolvedTheme]
        )}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 opacity-40',
          shellGridClass[shellMode][resolvedTheme]
        )}
      />

      <div className="relative z-10 flex h-full flex-col overflow-hidden">
        <TitleBar />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="relative flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
