import { useEffect, useRef, useState } from 'react';
import { Settings, X } from 'lucide-react';

const THEME_KEY = 'masquerade_theme';
const CONTRAST_KEY = 'masquerade_high_contrast';
type Theme = 'light' | 'dark';

function readSetting(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function initialTheme(): Theme {
  const saved = readSetting(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [highContrast, setHighContrast] = useState(() => readSetting(CONTRAST_KEY) === 'true');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* Use the current session only. */ }
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast);
    try { localStorage.setItem(CONTRAST_KEY, String(highContrast)); } catch { /* Use the current session only. */ }
  }, [highContrast]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="appearance-settings" ref={containerRef}>
      <button ref={buttonRef} type="button" className="settings-trigger" aria-label="Appearance and accessibility settings" aria-expanded={open} aria-controls="appearance-settings-panel" onClick={() => setOpen(!open)}>
        <Settings size={18} aria-hidden="true" />
        <span className="settings-trigger-label">Settings</span>
      </button>
      {open && (
        <div id="appearance-settings-panel" className="settings-panel" role="region" aria-label="Appearance and accessibility settings">
          <div className="settings-panel-heading">
            <span>Appearance & accessibility</span>
            <button type="button" className="settings-close" aria-label="Close settings" onClick={() => { setOpen(false); buttonRef.current?.focus(); }}><X size={18} aria-hidden="true" /></button>
          </div>
          <label className="settings-option">
            <span><strong>Dark mode</strong><small>Use a darker appearance.</small></span>
            <input type="checkbox" checked={theme === 'dark'} onChange={(event) => setTheme(event.target.checked ? 'dark' : 'light')} />
          </label>
          <label className="settings-option">
            <span><strong>Higher contrast</strong><small>Increase text and border contrast.</small></span>
            <input type="checkbox" checked={highContrast} onChange={(event) => setHighContrast(event.target.checked)} />
          </label>
          <p className="settings-note">Settings are saved on this browser when available.</p>
        </div>
      )}
    </div>
  );
}
