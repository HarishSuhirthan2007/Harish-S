import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { User } from 'firebase/auth';
import type {
  ConversionMode,
  SaveDestination,
  ConversionJobState,
  DeviceMediaItem,
  DriveFileItem,
} from './types';
import {
  initAuth,
  googleSignIn,
  getAccessToken,
  logout,
  listDriveFiles,
  deleteDriveFile,
  downloadDriveFileBlob,
} from './lib/firebaseAuth';
import {
  saveFileToDeviceStorage,
  listDeviceStorageFiles,
  deleteDeviceStorageFile,
} from './lib/deviceStorage';
import { Header } from './components/Header';
import { ConfirmModal } from './components/ConfirmModal';
import { PreviewModal } from './components/PreviewModal';
import { SavedStoragePanel } from './components/SavedStoragePanel';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  UploadCloud,
  FileVideo,
  X,
  CheckCircle2,
  Download,
  Smartphone,
  Cloud,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Play,
} from 'lucide-react';

const CHUNK_SIZE = 4 * 1024 * 1024;
const DIRECT_UPLOAD_LIMIT = 15 * 1024 * 1024;

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      res.status >= 400
        ? `Request failed (${res.status}). Please try again.`
        : 'Unexpected response from server.'
    );
  }
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function App() {
  // Auth state (Firebase + in-memory Google Drive access token)
  const [user, setUser] = useState<User | null>(null);
  const [hasDriveToken, setHasDriveToken] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Converter inputs
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [mode, setMode] = useState<ConversionMode>('mkv-to-mp4');
  const [destination, setDestination] = useState<SaveDestination>('device');
  const [loadingSample, setLoadingSample] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Job progress & completion
  const [phase, setPhase] = useState<'idle' | 'working' | 'saving' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [completedJob, setCompletedJob] = useState<ConversionJobState | null>(null);
  const [savedDriveLink, setSavedDriveLink] = useState<string | null>(null);
  const [savedDeviceItem, setSavedDeviceItem] = useState<DeviceMediaItem | null>(null);

  // Storage lists
  const [deviceFiles, setDeviceFiles] = useState<DeviceMediaItem[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);

  // Modals
  const [previewTarget, setPreviewTarget] = useState<{
    name: string;
    mimeType: string;
    blob: Blob;
  } | null>(null);

  const [pendingDelete, setPendingDelete] = useState<{
    type: 'device' | 'drive';
    id: string;
    name: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDeviceFiles = useCallback(async () => {
    try {
      const items = await listDeviceStorageFiles();
      setDeviceFiles(items);
    } catch (e) {
      console.error('Device storage read error:', e);
    }
  }, []);

  const loadDriveFiles = useCallback(async () => {
    if (!getAccessToken()) return;
    setIsLoadingDrive(true);
    setDriveError(null);
    try {
      const files = await listDriveFiles();
      setDriveFiles(files);
    } catch (err: any) {
      setDriveError(err.message || 'Could not load Google Drive files.');
      if (!getAccessToken()) setHasDriveToken(false);
    } finally {
      setIsLoadingDrive(false);
    }
  }, []);

  useEffect(() => {
    loadDeviceFiles();
    const unsub = initAuth((authUser, tokenReady) => {
      setUser(authUser);
      setHasDriveToken(tokenReady);
      if (tokenReady) {
        loadDriveFiles();
      } else {
        setDriveFiles([]);
      }
    });
    return () => {
      unsub();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [loadDeviceFiles, loadDriveFiles]);

  const handleGoogleLogin = async (): Promise<string | null> => {
    setIsLoggingIn(true);
    setErrorText(null);
    try {
      const result = await googleSignIn();
      setUser(result.user);
      setHasDriveToken(true);
      await loadDriveFiles();
      return result.accessToken;
    } catch (err: any) {
      setErrorText(err.message || 'Google sign-in was cancelled or blocked.');
      return null;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setHasDriveToken(false);
    setDriveFiles([]);
    if (destination === 'drive') setDestination('device');
  };

  const validateAndSelectFile = (f: File) => {
    setErrorText(null);
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    const allowed = ['mkv', 'mp4', 'mov', 'webm', 'avi', 'm4v', 'flv', 'ts', 'wmv'];
    if (!allowed.includes(ext) && !f.type.startsWith('video/')) {
      setErrorText('Please choose a valid video file (.mkv, .mp4, .mov, .webm, or .avi).');
      return;
    }
    if (f.size > 500 * 1024 * 1024) {
      setErrorText('File size exceeds 500 MB limit.');
      return;
    }
    setFile(f);
    if (ext === 'mkv') {
      setMode('mkv-to-mp4');
    } else if (ext === 'mp4' && mode === 'mkv-to-mp4') {
      setMode('mp4-to-mp3');
    }
  };

  const handleLoadSample = async (type: 'mkv' | 'mp4') => {
    setLoadingSample(true);
    setErrorText(null);
    try {
      const res = await fetch(`/api/sample/${type}`);
      if (!res.ok) throw new Error('Could not load sample file');
      const blob = await res.blob();
      const sampleFile = new File([blob], `sample_clip.${type}`, {
        type: type === 'mkv' ? 'video/x-matroska' : 'video/mp4',
      });
      validateAndSelectFile(sampleFile);
    } catch (err: any) {
      setErrorText(err.message || 'Failed to load sample clip.');
    } finally {
      setLoadingSample(false);
    }
  };

  const uploadDirectWithProgress = (targetFile: File): Promise<any> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', targetFile);
      formData.append('mode', mode);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/convert');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setProgress(Math.max(5, Math.min(20, Math.round(pct * 0.2))));
          setStatusText(`Uploading file... ${pct}%`);
        }
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            reject(new Error(data.error || `Upload failed (${xhr.status})`));
          }
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload.'));
      xhr.send(formData);
    });
  };

  const uploadInChunks = async (targetFile: File): Promise<any> => {
    const totalChunks = Math.ceil(targetFile.size / CHUNK_SIZE);
    const initRes = await fetch('/api/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: targetFile.name,
        totalSize: targetFile.size,
        totalChunks,
        mode,
      }),
    });
    const initData = await safeJson(initRes);
    if (!initRes.ok) throw new Error(initData.error || 'Failed to start upload.');

    for (let idx = 0; idx < totalChunks; idx++) {
      const start = idx * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, targetFile.size);
      const chunkForm = new FormData();
      chunkForm.append('uploadId', initData.uploadId);
      chunkForm.append('chunkIndex', String(idx));
      chunkForm.append('chunk', targetFile.slice(start, end), `chunk_${idx}`);

      const chunkRes = await fetch('/api/upload/chunk', {
        method: 'POST',
        body: chunkForm,
      });
      const chunkData = await safeJson(chunkRes);
      if (!chunkRes.ok) throw new Error(chunkData.error || 'Chunk upload failed.');

      const pct = Math.round(((idx + 1) / totalChunks) * 100);
      setProgress(Math.max(5, Math.min(20, Math.round(pct * 0.2))));
      setStatusText(`Uploading file... ${pct}%`);
    }

    const completeRes = await fetch('/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: initData.uploadId }),
    });
    const completeData = await safeJson(completeRes);
    if (!completeRes.ok) throw new Error(completeData.error || 'Failed to finalize upload.');
    return completeData;
  };

  const finalizeDestinationSave = async (
    jobData: ConversionJobState,
    targetDest: SaveDestination,
    driveToken: string | null
  ) => {
    setPhase('saving');
    setProgress(96);

    if (targetDest === 'drive') {
      if (!driveToken) {
        throw new Error('Google Drive authorization is required.');
      }
      setStatusText('Uploading to your Google Drive...');
      const res = await fetch(`/api/jobs/${jobData.id}/save-to-drive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${driveToken}`,
        },
      });
      const data = await safeJson(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save to Google Drive.');
      }
      setSavedDriveLink(data.file?.webViewLink || 'https://drive.google.com');
      setSavedDeviceItem(null);
      await loadDriveFiles();
    } else {
      setStatusText('Saving to your phone / device...');
      const dlRes = await fetch(`/api/jobs/${jobData.id}/download`);
      if (!dlRes.ok) {
        const errData = await safeJson(dlRes).catch(() => ({}));
        throw new Error(errData.error || 'Failed to transfer file to device.');
      }
      const blob = await dlRes.blob();
      const fileName = jobData.outputFileName || 'converted_media';
      const item: DeviceMediaItem = {
        id: jobData.id,
        name: fileName,
        originalName: jobData.originalName,
        mode: jobData.mode,
        mimeType: jobData.mimeType || blob.type || 'application/octet-stream',
        size: blob.size,
        savedAt: Date.now(),
        blob,
      };
      await saveFileToDeviceStorage(item);
      await loadDeviceFiles();
      setSavedDeviceItem(item);
      setSavedDriveLink(null);
      triggerBrowserDownload(blob, fileName);
    }

    setProgress(100);
    setCompletedJob(jobData);
    setPhase('done');
  };

  const handleConvert = async () => {
    if (!file) return;
    setErrorText(null);

    let driveToken = getAccessToken();
    if (destination === 'drive' && !driveToken) {
      driveToken = await handleGoogleLogin();
      if (!driveToken) return;
    }

    setPhase('working');
    setProgress(5);
    setStatusText('Uploading file...');
    setCompletedJob(null);
    setSavedDriveLink(null);
    setSavedDeviceItem(null);

    try {
      const uploadRes =
        file.size > DIRECT_UPLOAD_LIMIT
          ? await uploadInChunks(file)
          : await uploadDirectWithProgress(file);

      const jobId = uploadRes.job.id;
      setStatusText('Converting...');

      if (pollTimerRef.current) clearInterval(pollTimerRef.current);

      pollTimerRef.current = setInterval(async () => {
        try {
          const stRes = await fetch(`/api/jobs/${jobId}/status`);
          if (!stRes.ok) return;
          const jobData = (await safeJson(stRes)) as ConversionJobState;

          if (jobData.status === 'analyzing' || jobData.status === 'converting') {
            const mapped = Math.max(20, Math.min(92, jobData.progress));
            setProgress((prev) => Math.max(prev, mapped));
            setStatusText(jobData.stageMessage || 'Converting...');
          } else if (jobData.status === 'completed') {
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            try {
              await finalizeDestinationSave(jobData, destination, driveToken);
            } catch (saveErr: any) {
              setPhase('error');
              setErrorText(saveErr.message || 'Conversion finished, but saving failed.');
            }
          } else if (jobData.status === 'error') {
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            setPhase('error');
            setErrorText(jobData.error || 'Conversion failed.');
          }
        } catch (err) {
          console.error('Status poll error:', err);
        }
      }, 600);
    } catch (err: any) {
      setPhase('error');
      setErrorText(err.message || 'Could not start conversion.');
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  };

  const handleReset = () => {
    setFile(null);
    setPhase('idle');
    setProgress(0);
    setStatusText('');
    setErrorText(null);
    setCompletedJob(null);
    setSavedDriveLink(null);
    setSavedDeviceItem(null);
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const handleDownloadDriveFile = async (item: DriveFileItem) => {
    try {
      const blob = await downloadDriveFileBlob(item.id);
      triggerBrowserDownload(blob, item.name);
    } catch (err: any) {
      setDriveError(err.message || 'Failed to download file from Google Drive.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      if (pendingDelete.type === 'device') {
        await deleteDeviceStorageFile(pendingDelete.id);
        await loadDeviceFiles();
        if (savedDeviceItem?.id === pendingDelete.id) {
          setSavedDeviceItem(null);
        }
      } else {
        await deleteDriveFile(pendingDelete.id);
        await loadDriveFiles();
      }
      setPendingDelete(null);
    } catch (err: any) {
      setErrorText(err.message || 'Failed to delete file.');
      setPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const isBusy = phase === 'working' || phase === 'saving';

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-slate-900 flex flex-col">
      <PreviewModal target={previewTarget} onClose={() => setPreviewTarget(null)} />

      <ConfirmModal
        isOpen={!!pendingDelete}
        title={
          pendingDelete?.type === 'drive'
            ? 'Delete from Google Drive?'
            : 'Remove from Device?'
        }
        message={
          pendingDelete?.type === 'drive'
            ? `Are you sure you want to delete "${pendingDelete.name}" from your Google Drive? This action cannot be undone.`
            : `Remove "${pendingDelete?.name}" from this device's saved storage?`
        }
        confirmLabel="Delete"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => !isDeleting && setPendingDelete(null)}
      />

      <Header
        user={user}
        hasDriveToken={hasDriveToken}
        isLoggingIn={isLoggingIn}
        onLogin={handleGoogleLogin}
        onLogout={handleLogout}
      />

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        {/* Clean, Focused Title */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Convert Video &amp; Audio
          </h1>
          <p className="text-sm text-slate-600">
            MKV to MP4, MP4 to MP3, or MP4 to MKV — saved directly to your phone or Google Drive.
          </p>
        </div>

        {/* Single Clean Converter Card */}
        <div className="rounded-3xl bg-white border border-slate-200/90 shadow-sm p-5 sm:p-7 space-y-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mkv,.mp4,.mov,.webm,.avi,.m4v,video/*"
            className="hidden"
            disabled={isBusy}
            onChange={(e) => {
              if (e.target.files?.[0]) validateAndSelectFile(e.target.files[0]);
              e.target.value = '';
            }}
          />

          {phase === 'done' && completedJob ? (
            /* Completed State */
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex items-center space-x-3">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-slate-900 truncate">
                      {completedJob.outputFileName}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {formatFileSize(completedJob.outputSize)} •{' '}
                      {savedDriveLink
                        ? 'Saved to your Google Drive'
                        : 'Saved to your phone / device'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5">
                {savedDeviceItem && (
                  <>
                    <button
                      type="button"
                      onClick={() => triggerBrowserDownload(savedDeviceItem.blob, savedDeviceItem.name)}
                      className="flex-1 inline-flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download to Phone</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewTarget({
                          name: savedDeviceItem.name,
                          mimeType: savedDeviceItem.mimeType,
                          blob: savedDeviceItem.blob,
                        })
                      }
                      className="inline-flex items-center justify-center space-x-2 py-3 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors cursor-pointer"
                    >
                      <Play className="w-4 h-4" />
                      <span>Play</span>
                    </button>
                  </>
                )}

                {savedDriveLink && (
                  <a
                    href={savedDriveLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>Open in Google Drive</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center justify-center space-x-2 py-3 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Convert Another</span>
                </button>
              </div>
            </div>
          ) : isBusy ? (
            /* Converting / Saving Progress State */
            <div className="py-4 space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-800 truncate pr-4">
                  {file?.name || 'Converting media'}
                </span>
                <span className="font-bold text-teal-700 tabular-nums">{progress}%</span>
              </div>

              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-300"
                  style={{ width: `${Math.max(5, Math.min(100, progress))}%` }}
                />
              </div>

              <p className="text-xs text-slate-500">{statusText}</p>
            </div>
          ) : (
            /* Ready / File Input State */
            <>
              {/* Drop Zone */}
              {file ? (
                <div className="p-4 rounded-2xl bg-teal-50/60 border border-teal-200 flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-teal-600 text-white flex items-center justify-center shrink-0">
                      <FileVideo className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {file.name}
                      </div>
                      <div className="text-xs text-slate-500">{formatFileSize(file.size)}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setErrorText(null);
                    }}
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-white transition-colors cursor-pointer"
                    title="Remove file"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDragOver(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragOver(false);
                      if (e.dataTransfer.files?.[0]) {
                        validateAndSelectFile(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
                      isDragOver
                        ? 'border-teal-500 bg-teal-50/70'
                        : 'border-slate-200 hover:border-teal-400 bg-slate-50/60 hover:bg-teal-50/30'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 text-teal-600 flex items-center justify-center mx-auto mb-3 shadow-xs">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <div className="text-sm font-semibold text-slate-800">
                      Drop your video here or tap to choose
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Supports MKV, MP4, MOV, WebM up to 500 MB
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-3 text-xs text-slate-500">
                    <span>Try with a sample:</span>
                    <button
                      type="button"
                      disabled={loadingSample}
                      onClick={() => handleLoadSample('mkv')}
                      className="font-semibold text-teal-700 hover:underline cursor-pointer disabled:opacity-50"
                    >
                      Sample MKV
                    </button>
                    <span>•</span>
                    <button
                      type="button"
                      disabled={loadingSample}
                      onClick={() => handleLoadSample('mp4')}
                      className="font-semibold text-teal-700 hover:underline cursor-pointer disabled:opacity-50"
                    >
                      Sample MP4
                    </button>
                  </div>
                </div>
              )}

              {/* Clean Controls Row: Conversion Mode + Storage Destination */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="mode-select"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Convert To
                  </label>
                  <select
                    id="mode-select"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as ConversionMode)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:border-teal-500 focus:bg-white transition-colors cursor-pointer"
                  >
                    <option value="mkv-to-mp4">MKV to MP4 (Video)</option>
                    <option value="mp4-to-mp3">MP4 to MP3 (Audio)</option>
                    <option value="mp4-to-mkv">MP4 to MKV (Remux)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-xs font-semibold text-slate-700">
                    Save Converted File To
                  </span>
                  <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100">
                    <button
                      type="button"
                      onClick={() => setDestination('device')}
                      className={`flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        destination === 'device'
                          ? 'bg-white text-teal-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>Phone / Device</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDestination('drive')}
                      className={`flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        destination === 'drive'
                          ? 'bg-white text-emerald-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      <span>Google Drive</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Error Banner */}
              {errorText && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorText}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorText(null)}
                    className="font-semibold hover:underline shrink-0 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Primary Convert Button */}
              <button
                type="button"
                disabled={!file}
                onClick={handleConvert}
                className={`w-full py-3.5 px-6 rounded-2xl text-sm font-bold flex items-center justify-center space-x-2 transition-all ${
                  file
                    ? 'bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white shadow-sm cursor-pointer active:scale-[0.99]'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              >
                <span>
                  {file
                    ? destination === 'drive'
                      ? 'Convert & Save to Google Drive'
                      : 'Convert & Save to Phone / Device'
                    : 'Select a file to convert'}
                </span>
                {file && <ArrowRight className="w-4 h-4" />}
              </button>
            </>
          )}
        </div>

        {/* User's Own Storage: Phone/Device + Google Drive */}
        <SavedStoragePanel
          deviceFiles={deviceFiles}
          driveFiles={driveFiles}
          user={user}
          hasDriveToken={hasDriveToken}
          isLoadingDrive={isLoadingDrive}
          driveError={driveError}
          onRefreshDrive={loadDriveFiles}
          onLogin={handleGoogleLogin}
          onPreviewDeviceFile={(item) =>
            setPreviewTarget({
              name: item.name,
              mimeType: item.mimeType,
              blob: item.blob,
            })
          }
          onDownloadDeviceFile={(item) => triggerBrowserDownload(item.blob, item.name)}
          onRequestDeleteDeviceFile={(item) =>
            setPendingDelete({ type: 'device', id: item.id, name: item.name })
          }
          onDownloadDriveFile={handleDownloadDriveFile}
          onRequestDeleteDriveFile={(item) =>
            setPendingDelete({ type: 'drive', id: item.id, name: item.name })
          }
        />
      </main>

      <footer className="py-6 text-center text-xs text-slate-400">
        MediaConverter • Converted files are stored only on your device or your Google Drive.
      </footer>

      <OfflineIndicator />
    </div>
  );
}
