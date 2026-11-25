import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { Film, LogOut, ChevronDown } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface HeaderProps {
  user: User | null;
  hasDriveToken: boolean;
  isLoggingIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

export const GoogleSignInButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}> = ({ onClick, disabled, label = 'Sign in with Google' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="gsi-material-button"
  >
    <div className="gsi-material-button-state"></div>
    <div className="gsi-material-button-content-wrapper">
      <div className="gsi-material-button-icon">
        <svg
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 48 48"
          style={{ display: 'block' }}
        >
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
          <path fill="none" d="M0 0h48v48H0z" />
        </svg>
      </div>
      <span className="gsi-material-button-contents">{label}</span>
    </div>
  </button>
);

function getInitialsDataUrl(name?: string | null): string {
  const safe = (name || 'U')
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#0d9488"/><text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="system-ui, sans-serif" font-size="30" font-weight="700">${safe}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  hasDriveToken,
  isLoggingIn,
  onLogin,
  onLogout,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full bg-white/90 backdrop-blur-md border-b border-slate-200/80">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Clean Brand Logo */}
        <div className="flex items-center space-x-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-600 to-emerald-600 flex items-center justify-center text-white shadow-sm">
            <Film className="w-5 h-5" />
          </div>
          <span className="text-lg font-extrabold tracking-tight text-slate-900">
            MediaConverter
          </span>
        </div>

        {/* Right Actions: Install App + Auth Control */}
        <div className="flex items-center gap-2.5">
          <PWAInstallButton />
          {user && hasDriveToken ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center space-x-2.5 py-1.5 pl-1.5 pr-3 rounded-full bg-slate-50 border border-slate-200 hover:border-teal-500/50 transition-colors cursor-pointer"
              >
                <img
                  src={user.photoURL || getInitialsDataUrl(user.displayName)}
                  alt={user.displayName || 'Google User'}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = getInitialsDataUrl(user.displayName);
                  }}
                  className="w-7 h-7 rounded-full object-cover"
                />
                <span className="hidden sm:inline text-xs font-semibold text-slate-700 max-w-[140px] truncate">
                  {user.displayName || user.email}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-60 rounded-xl bg-white border border-slate-200 shadow-lg p-1.5 z-40">
                    <div className="px-3 py-2 border-b border-slate-100">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {user.displayName || 'Google Account'}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full mt-1 flex items-center space-x-2 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <GoogleSignInButton
              onClick={onLogin}
              disabled={isLoggingIn}
              label={isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
            />
          )}
        </div>
      </div>
    </header>
  );
};
