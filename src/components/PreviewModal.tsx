import React, { useEffect, useState } from 'react';
import { X, Download, Film, Music } from 'lucide-react';

interface PreviewTarget {
  name: string;
  mimeType: string;
  blob: Blob;
}

interface PreviewModalProps {
  target: PreviewTarget | null;
  onClose: () => void;
}

export const PreviewModal: React.FC<PreviewModalProps> = ({ target, onClose }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(target.blob);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [target]);

  if (!target || !objectUrl) return null;

  const isAudio = target.mimeType.startsWith('audio') || target.name.toLowerCase().endsWith('.mp3');
  const isMp4 = target.mimeType === 'video/mp4' || target.name.toLowerCase().endsWith('.mp4');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="relative w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center space-x-2.5 min-w-0">
            {isAudio ? (
              <Music className="w-5 h-5 text-teal-600 shrink-0" />
            ) : (
              <Film className="w-5 h-5 text-teal-600 shrink-0" />
            )}
            <h3 className="font-semibold text-sm text-slate-900 truncate">{target.name}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 bg-slate-50 flex items-center justify-center min-h-[180px]">
          {isMp4 ? (
            <video
              controls
              autoPlay
              src={objectUrl}
              className="w-full max-h-80 rounded-xl bg-black"
            />
          ) : isAudio ? (
            <audio controls autoPlay src={objectUrl} className="w-full" />
          ) : (
            <div className="text-center text-xs text-slate-500 py-6">
              MKV playback is best opened in a desktop or mobile media player after downloading.
            </div>
          )}
        </div>

        <div className="flex items-center justify-end px-5 py-3.5 bg-white border-t border-slate-100">
          <a
            href={objectUrl}
            download={target.name}
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Save to Phone / Device</span>
          </a>
        </div>
      </div>
    </div>
  );
};
