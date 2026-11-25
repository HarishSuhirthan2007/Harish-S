export type ConversionMode = 'mkv-to-mp4' | 'mp4-to-mp3' | 'mp4-to-mkv';

export type SaveDestination = 'device' | 'drive';

export interface ConversionJobState {
  id: string;
  originalName: string;
  mode: ConversionMode;
  status: 'queued' | 'uploading' | 'analyzing' | 'converting' | 'completed' | 'error';
  progress: number;
  stageMessage: string;
  inputSize: number;
  outputSize?: number;
  outputFileName?: string;
  mimeType?: string;
  createdAt: number;
  completedAt?: number;
  durationSeconds?: number;
  error?: string;
}

export interface DeviceMediaItem {
  id: string;
  name: string;
  originalName: string;
  mode: ConversionMode;
  mimeType: string;
  size: number;
  savedAt: number;
  blob: Blob;
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  webViewLink?: string;
}
