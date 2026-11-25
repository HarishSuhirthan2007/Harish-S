import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-teal-600" />
          <span>Install</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-3">
              <h3 className="text-base font-bold text-slate-900">Install on iPhone / iPad</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                1. Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
                <br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-xl bg-slate-100 hover:bg-slate-200 py-2 text-xs font-semibold text-slate-800 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
