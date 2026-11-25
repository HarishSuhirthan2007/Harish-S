import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import type { DeviceMediaItem, DriveFileItem } from '../types';
import {
  Smartphone,
  Cloud,
  Download,
  Trash2,
  Play,
  ExternalLink,
  RefreshCw,
  Film,
  Music,
} from 'lucide-react';
import { GoogleSignInButton } from './Header';

interface SavedStoragePanelProps {
  deviceFiles: DeviceMediaItem[];
  driveFiles: DriveFileItem[];
  user: User | null;
  hasDriveToken: boolean;
  isLoadingDrive: boolean;
  driveError: string | null;
  onRefreshDrive: () => void;
  onLogin: () => void;
  onPreviewDeviceFile: (item: DeviceMediaItem) => void;
  onDownloadDeviceFile: (item: DeviceMediaItem) => void;
  onRequestDeleteDeviceFile: (item: DeviceMediaItem) => void;
  onDownloadDriveFile: (item: DriveFileItem) => void;
  onRequestDeleteDriveFile: (item: DriveFileItem) => void;
}

function formatBytes(bytes?: number | string): string {
  const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (!num || isNaN(num)) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(num) / Math.log(k));
  return parseFloat((num / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export const SavedStoragePanel: React.FC<SavedStoragePanelProps> = ({
  deviceFiles,
  driveFiles,
  user,
  hasDriveToken,
  isLoadingDrive,
  driveError,
  onRefreshDrive,
  onLogin,
  onPreviewDeviceFile,
  onDownloadDeviceFile,
  onRequestDeleteDeviceFile,
  onDownloadDriveFile,
  onRequestDeleteDriveFile,
}) => {
  const [activeTab, setActiveTab] = useState<'device' | 'drive'>('device');

  return (
    <section className="w-full rounded-2xl bg-white border border-slate-200/90 shadow-sm overflow-hidden">
      {/* Tabs Header */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('device')}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'device'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-teal-600" />
            <span>My Device ({deviceFiles.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('drive')}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'drive'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Cloud className="w-3.5 h-3.5 text-emerald-600" />
            <span>My Google Drive{hasDriveToken ? ` (${driveFiles.length})` : ''}</span>
          </button>
        </div>

        {activeTab === 'drive' && hasDriveToken && (
          <button
            type="button"
            onClick={onRefreshDrive}
            disabled={isLoadingDrive}
            className="inline-flex items-center space-x-1.5 text-xs font-medium text-slate-600 hover:text-teal-700 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDrive ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        )}
      </div>

      {/* Tab Content */}
      {activeTab === 'device' ? (
        deviceFiles.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No converted files saved on this device yet. Files you save to Phone / Device appear here for offline access.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {deviceFiles.map((item) => {
              const isAudio = item.mimeType.startsWith('audio') || item.name.endsWith('.mp3');
              return (
                <li
                  key={item.id}
                  className="px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                      {isAudio ? <Music className="w-4 h-4" /> : <Film className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-semibold text-slate-800 truncate">
                        {item.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {formatBytes(item.size)} • Saved on this device
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onPreviewDeviceFile(item)}
                      title="Play"
                      className="p-2 rounded-lg text-slate-600 hover:text-teal-700 hover:bg-teal-50 transition-colors cursor-pointer"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownloadDeviceFile(item)}
                      title="Download to phone"
                      className="p-2 rounded-lg text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDeleteDeviceFile(item)}
                      title="Remove from device"
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : !user || !hasDriveToken ? (
        <div className="p-8 text-center space-y-3">
          <p className="text-xs text-slate-600">
            Connect your Google account to save and access converted files directly in your own Google Drive.
          </p>
          <div className="flex justify-center">
            <GoogleSignInButton onClick={onLogin} label="Connect Google Drive" />
          </div>
        </div>
      ) : driveError ? (
        <div className="p-6 text-center space-y-2">
          <p className="text-xs text-rose-600">{driveError}</p>
          <button
            type="button"
            onClick={onRefreshDrive}
            className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
          >
            Try Again
          </button>
        </div>
      ) : isLoadingDrive && driveFiles.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-500">
          Loading your Google Drive files...
        </div>
      ) : driveFiles.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-500">
          No converted files in your Google Drive yet. Choose &ldquo;My Google Drive&rdquo; when converting to store files in your cloud.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {driveFiles.map((file) => {
            const isAudio = file.mimeType.startsWith('audio') || file.name.endsWith('.mp3');
            return (
              <li
                key={file.id}
                className="px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    {isAudio ? <Music className="w-4 h-4" /> : <Film className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-semibold text-slate-800 truncate">
                      {file.name}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formatBytes(file.size)} • Stored in your Google Drive
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  {file.webViewLink && (
                    <a
                      href={file.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open in Google Drive"
                      className="p-2 rounded-lg text-slate-600 hover:text-teal-700 hover:bg-teal-50 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => onDownloadDriveFile(file)}
                    title="Download from Drive"
                    className="p-2 rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestDeleteDriveFile(file)}
                    title="Delete from Google Drive"
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
