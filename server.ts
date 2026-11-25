import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { spawn } from 'child_process';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Ephemeral temp directories (auto-cleaned after conversion/transfer)
const TEMP_DIR = path.join('/tmp', 'mediaconvert');
const UPLOAD_DIR = path.join(TEMP_DIR, 'uploads');
const CHUNK_DIR = path.join(TEMP_DIR, 'chunks');
const OUTPUT_DIR = path.join(TEMP_DIR, 'outputs');
const SAMPLES_DIR = path.join(TEMP_DIR, 'samples');

[TEMP_DIR, UPLOAD_DIR, CHUNK_DIR, OUTPUT_DIR, SAMPLES_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use(cors());
app.use(express.json());

export interface ConversionJob {
  id: string;
  originalName: string;
  mode: 'mkv-to-mp4' | 'mp4-to-mp3' | 'mp4-to-mkv';
  status: 'queued' | 'uploading' | 'analyzing' | 'converting' | 'completed' | 'error';
  progress: number;
  stageMessage: string;
  inputSize: number;
  outputSize?: number;
  inputPath: string;
  outputPath?: string;
  outputFileName: string;
  mimeType: string;
  createdAt: number;
  completedAt?: number;
  durationSeconds?: number;
  error?: string;
}

interface ChunkSession {
  uploadId: string;
  fileName: string;
  totalSize: number;
  totalChunks: number;
  mode: ConversionJob['mode'];
  tempFilePath: string;
  receivedChunks: Set<number>;
  createdAt: number;
}

const jobs = new Map<string, ConversionJob>();
const chunkSessions = new Map<string, ChunkSession>();

const ALLOWED_EXTENSIONS = new Set([
  'mkv', 'mp4', 'mov', 'webm', 'avi', 'm4v', 'flv', 'ts', 'wmv', 'mpeg', 'mpg', '3gp',
]);

function isAllowedMediaFile(filename: string, mimetype?: string): boolean {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  if (ALLOWED_EXTENSIONS.has(ext)) return true;
  if (mimetype && (mimetype.startsWith('video/') || mimetype.startsWith('audio/'))) return true;
  return false;
}

function sanitizeBaseName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_') || 'media';
}

function safeUnlink(filePath?: string) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.error(`Failed to delete temp file ${filePath}:`, e);
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const sanitized = sanitizeBaseName(file.originalname);
    cb(null, `${uniqueSuffix}-${sanitized}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMediaFile(file.originalname, file.mimetype)) {
      cb(null, true);
    } else {
      const ext = path.extname(file.originalname).toLowerCase() || 'unknown';
      cb(new Error(`Unsupported file type (${ext}). Please upload an MKV, MP4, MOV, WebM, or AVI file.`));
    }
  },
});

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

interface MediaProbe {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

function probeMedia(filePath: string): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-i', filePath]);
    let output = '';

    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', () => {
      let duration = 10;
      const match = output.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      if (match) {
        const hours = parseFloat(match[1]);
        const mins = parseFloat(match[2]);
        const secs = parseFloat(match[3]);
        const totalSecs = hours * 3600 + mins * 60 + secs;
        if (totalSecs > 0) duration = totalSecs;
      }

      const hasVideo = /Stream #\d+:\d+.*Video:/i.test(output);
      const hasAudio = /Stream #\d+:\d+.*Audio:/i.test(output);

      resolve({ duration, hasVideo, hasAudio });
    });

    proc.on('error', () => {
      resolve({ duration: 10, hasVideo: true, hasAudio: true });
    });
  });
}

function parseTimeToSeconds(timeStr: string): number | null {
  const match = timeStr.trim().match(/(\d+):(\d+):(\d+\.?\d*)/);
  if (!match) return null;
  const h = parseFloat(match[1]);
  const m = parseFloat(match[2]);
  const s = parseFloat(match[3]);
  return h * 3600 + m * 60 + s;
}

function runFfmpegProcess(
  job: ConversionJob,
  ffmpegArgs: string[],
  totalDuration: number
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const ffmpegProc = spawn('ffmpeg', ffmpegArgs);

    let stdoutBuffer = '';
    ffmpegProc.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('out_time=')) {
          const currentSecs = parseTimeToSeconds(line.split('=')[1] || '');
          if (currentSecs !== null && currentSecs >= 0 && totalDuration > 0) {
            const pct = Math.min(96, Math.max(10, Math.round((currentSecs / totalDuration) * 100)));
            if (pct >= job.progress) {
              job.progress = pct;
              job.stageMessage = `Converting... ${pct}%`;
            }
          }
        } else if (line.startsWith('progress=end')) {
          job.progress = 98;
          job.stageMessage = 'Finalizing file...';
        }
      }
    });

    let stderrLogs = '';
    ffmpegProc.stderr.on('data', (data) => {
      const text = data.toString();
      stderrLogs += text;
      const match = text.match(/time=(\d+:\d+:\d+\.?\d*)/);
      if (match && totalDuration > 0) {
        const currentSecs = parseTimeToSeconds(match[1]);
        if (currentSecs !== null) {
          const pct = Math.min(96, Math.max(10, Math.round((currentSecs / totalDuration) * 100)));
          if (pct > job.progress) {
            job.progress = pct;
            job.stageMessage = `Converting... ${pct}%`;
          }
        }
      }
    });

    ffmpegProc.on('close', (code) => {
      resolve({ code, stderr: stderrLogs });
    });

    ffmpegProc.on('error', (err) => {
      resolve({ code: -1, stderr: err.message });
    });
  });
}

function buildUserFriendlyFfmpegError(stderr: string, mode: ConversionJob['mode']): string {
  const lower = stderr.toLowerCase();
  if (lower.includes('invalid data found') || lower.includes('moov atom not found')) {
    return 'The uploaded file appears corrupted or is not a valid media file.';
  }
  if (lower.includes('does not contain any stream') || lower.includes('matches no streams')) {
    if (mode === 'mp4-to-mp3') {
      return 'This video does not contain an audio track to extract as MP3.';
    }
    return 'No compatible video/audio streams were found in this file.';
  }
  return `Conversion failed. ${stderr.trim().split('\n').slice(-2).join(' ').slice(0, 200)}`;
}

async function processConversion(job: ConversionJob) {
  try {
    job.status = 'analyzing';
    job.stageMessage = 'Reading media file...';
    job.progress = 5;

    const probe = await probeMedia(job.inputPath);
    job.durationSeconds = probe.duration;

    if (job.mode === 'mp4-to-mp3' && !probe.hasAudio) {
      job.status = 'error';
      job.stageMessage = 'Audio extraction failed.';
      job.error = 'This video does not contain an audio track to extract.';
      safeUnlink(job.inputPath);
      return;
    }

    if ((job.mode === 'mkv-to-mp4' || job.mode === 'mp4-to-mkv') && !probe.hasVideo && !probe.hasAudio) {
      job.status = 'error';
      job.stageMessage = 'Invalid media file.';
      job.error = 'No readable video or audio streams found.';
      safeUnlink(job.inputPath);
      return;
    }

    job.status = 'converting';
    job.stageMessage = 'Converting... 10%';
    job.progress = 10;

    const baseName = sanitizeBaseName(path.parse(job.originalName).name);
    let outputExtension = 'mp4';
    let mimeType = 'video/mp4';
    let ffmpegArgs: string[] = ['-y', '-i', job.inputPath];

    if (job.mode === 'mkv-to-mp4') {
      outputExtension = 'mp4';
      mimeType = 'video/mp4';
      ffmpegArgs.push(
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart'
      );
    } else if (job.mode === 'mp4-to-mp3') {
      outputExtension = 'mp3';
      mimeType = 'audio/mpeg';
      ffmpegArgs.push(
        '-vn',
        '-sn',
        '-dn',
        '-map', '0:a:0',
        '-c:a', 'libmp3lame',
        '-q:a', '2'
      );
    } else if (job.mode === 'mp4-to-mkv') {
      outputExtension = 'mkv';
      mimeType = 'video/x-matroska';
      ffmpegArgs.push(
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c', 'copy'
      );
    }

    const outputFileName = `${baseName}.${outputExtension}`;
    const outputPath = path.join(OUTPUT_DIR, `${job.id}_${outputFileName}`);

    job.outputPath = outputPath;
    job.outputFileName = outputFileName;
    job.mimeType = mimeType;

    let result = await runFfmpegProcess(
      job,
      [...ffmpegArgs, '-progress', 'pipe:1', outputPath],
      probe.duration
    );

    if ((result.code !== 0 || !fs.existsSync(outputPath)) && job.mode === 'mp4-to-mkv') {
      safeUnlink(outputPath);
      job.progress = 15;
      job.stageMessage = 'Converting to MKV...';
      const fallbackArgs = [
        '-y',
        '-i', job.inputPath,
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-progress', 'pipe:1',
        outputPath,
      ];
      result = await runFfmpegProcess(job, fallbackArgs, probe.duration);
    }

    // Immediately clean up original uploaded input file
    safeUnlink(job.inputPath);

    if (result.code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      const stats = fs.statSync(outputPath);
      job.outputSize = stats.size;
      job.progress = 100;
      job.status = 'completed';
      job.completedAt = Date.now();
      job.stageMessage = 'Ready to save';
    } else {
      safeUnlink(outputPath);
      job.status = 'error';
      job.stageMessage = 'Conversion failed.';
      job.error = buildUserFriendlyFfmpegError(result.stderr, job.mode);
    }
  } catch (err: any) {
    safeUnlink(job.inputPath);
    job.status = 'error';
    job.stageMessage = 'Conversion failed.';
    job.error = err.message || 'Unknown error occurred';
  }
}

function enqueueConversionJob(params: {
  originalName: string;
  mode: ConversionJob['mode'];
  inputSize: number;
  inputPath: string;
}): ConversionJob {
  const validModes: ConversionJob['mode'][] = ['mkv-to-mp4', 'mp4-to-mp3', 'mp4-to-mkv'];
  const safeMode = validModes.includes(params.mode) ? params.mode : 'mkv-to-mp4';
  const jobId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  const job: ConversionJob = {
    id: jobId,
    originalName: params.originalName,
    mode: safeMode,
    status: 'queued',
    progress: 0,
    stageMessage: 'Preparing conversion...',
    inputSize: params.inputSize,
    inputPath: params.inputPath,
    outputFileName: '',
    mimeType: '',
    createdAt: Date.now(),
  };

  jobs.set(jobId, job);
  processConversion(job);
  return job;
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// Sample clip generator for instant testing
app.get('/api/sample/:type', async (req, res) => {
  const type = req.params.type;
  if (type !== 'mkv' && type !== 'mp4') {
    return res.status(400).json({ error: 'Type must be mkv or mp4' });
  }

  const samplePath = path.join(SAMPLES_DIR, `sample_test_video.${type}`);

  if (!fs.existsSync(samplePath)) {
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('ffmpeg', [
          '-y',
          '-f', 'lavfi',
          '-i', 'testsrc=duration=4:size=640x360:rate=30',
          '-f', 'lavfi',
          '-i', 'sine=frequency=440:duration=4',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-shortest',
          samplePath,
        ]);
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Failed to generate sample, exit code ${code}`));
        });
        proc.on('error', reject);
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Could not generate sample video: ' + err.message });
    }
  }

  res.setHeader('Content-Type', type === 'mkv' ? 'video/x-matroska' : 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="sample_media.${type}"`);
  fs.createReadStream(samplePath).pipe(res);
});

// Direct upload and start conversion
app.post('/api/convert', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No media file provided.' });
  }

  const job = enqueueConversionJob({
    originalName: req.file.originalname,
    mode: req.body.mode as ConversionJob['mode'],
    inputSize: req.file.size,
    inputPath: req.file.path,
  });

  res.status(202).json({
    job: {
      id: job.id,
      originalName: job.originalName,
      mode: job.mode,
      status: job.status,
      progress: job.progress,
      stageMessage: job.stageMessage,
      inputSize: job.inputSize,
      createdAt: job.createdAt,
    },
  });
});

// Chunked upload endpoints (supports up to 500MB safely)
app.post('/api/upload/init', (req, res) => {
  const { fileName, totalSize, totalChunks, mode } = req.body || {};
  if (!fileName || typeof totalSize !== 'number' || typeof totalChunks !== 'number') {
    return res.status(400).json({ error: 'Invalid upload initialization parameters.' });
  }
  if (!isAllowedMediaFile(fileName)) {
    return res.status(400).json({ error: 'Unsupported media file format.' });
  }
  if (totalSize > 500 * 1024 * 1024) {
    return res.status(400).json({ error: 'File exceeds the 500MB maximum limit.' });
  }

  const uploadId = 'upl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const sanitized = sanitizeBaseName(fileName);
  const tempFilePath = path.join(CHUNK_DIR, `${uploadId}_${sanitized}`);
  fs.writeFileSync(tempFilePath, Buffer.alloc(0));

  chunkSessions.set(uploadId, {
    uploadId,
    fileName,
    totalSize,
    totalChunks,
    mode: mode || 'mkv-to-mp4',
    tempFilePath,
    receivedChunks: new Set(),
    createdAt: Date.now(),
  });

  res.json({ uploadId });
});

app.post('/api/upload/chunk', chunkUpload.single('chunk'), (req, res) => {
  const { uploadId, chunkIndex } = req.body || {};
  const idx = parseInt(chunkIndex, 10);
  const session = chunkSessions.get(uploadId);

  if (!session || !req.file || isNaN(idx)) {
    return res.status(400).json({ error: 'Invalid chunk upload payload or expired upload session.' });
  }

  try {
    fs.appendFileSync(session.tempFilePath, req.file.buffer);
    session.receivedChunks.add(idx);
    res.json({
      received: session.receivedChunks.size,
      totalChunks: session.totalChunks,
    });
  } catch (err: any) {
    safeUnlink(session.tempFilePath);
    chunkSessions.delete(uploadId);
    res.status(500).json({ error: 'Failed to write file chunk: ' + err.message });
  }
});

app.post('/api/upload/complete', (req, res) => {
  const { uploadId } = req.body || {};
  const session = chunkSessions.get(uploadId);
  if (!session) {
    return res.status(404).json({ error: 'Upload session not found.' });
  }

  chunkSessions.delete(uploadId);
  const finalInputPath = path.join(UPLOAD_DIR, `${Date.now()}-${sanitizeBaseName(session.fileName)}`);
  try {
    fs.renameSync(session.tempFilePath, finalInputPath);
  } catch {
    fs.copyFileSync(session.tempFilePath, finalInputPath);
    safeUnlink(session.tempFilePath);
  }

  const job = enqueueConversionJob({
    originalName: session.fileName,
    mode: session.mode,
    inputSize: session.totalSize,
    inputPath: finalInputPath,
  });

  res.status(202).json({
    job: {
      id: job.id,
      originalName: job.originalName,
      mode: job.mode,
      status: job.status,
      progress: job.progress,
      stageMessage: job.stageMessage,
      inputSize: job.inputSize,
      createdAt: job.createdAt,
    },
  });
});

// Check job status
app.get('/api/jobs/:id/status', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Conversion job not found.' });
  }

  res.json({
    id: job.id,
    originalName: job.originalName,
    mode: job.mode,
    status: job.status,
    progress: job.progress,
    stageMessage: job.stageMessage,
    inputSize: job.inputSize,
    outputSize: job.outputSize,
    outputFileName: job.outputFileName,
    mimeType: job.mimeType,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    durationSeconds: job.durationSeconds,
    error: job.error,
  });
});

// Download converted file to user's phone/device (auto-cleans temp server file)
app.get('/api/jobs/:id/download', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Conversion job not found.' });
  }

  if (job.status !== 'completed' || !job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(410).json({ error: 'Temporary file has already been transferred or cleaned up.' });
  }

  const fileName = job.outputFileName || 'converted_file';
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const fileSize = fs.statSync(job.outputPath).size;

  res.setHeader('Content-Type', job.mimeType || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );
  res.setHeader('Content-Length', fileSize);

  const fileStream = fs.createReadStream(job.outputPath);
  fileStream.pipe(res);

  fileStream.on('error', (err) => {
    console.error('Download stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download file stream.' });
    }
  });

  // Automatically remove temporary server file after transfer completes
  if (req.query.keep !== 'true') {
    res.on('finish', () => {
      setTimeout(() => {
        safeUnlink(job.outputPath);
      }, 3000);
    });
  }
});

// Upload converted file directly to the user's Google Drive using their Bearer token
app.post('/api/jobs/:id/save-to-drive', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Google Drive authorization required.' });
  }

  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'completed' || !job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'Converted file not found or already cleaned up.' });
  }

  try {
    const fileSize = fs.statSync(job.outputPath).size;

    // Step 1: Initiate Google Drive Resumable Upload session
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,createdTime,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': job.mimeType || 'application/octet-stream',
          'X-Upload-Content-Length': String(fileSize),
        },
        body: JSON.stringify({
          name: job.outputFileName,
          mimeType: job.mimeType || 'application/octet-stream',
          description: 'Converted with MediaConverter',
        }),
      }
    );

    if (!initRes.ok) {
      const errBody = await initRes.json().catch(() => ({}));
      const msg = errBody.error?.message || 'Google Drive rejected the upload initialization.';
      return res.status(initRes.status).json({ error: msg });
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      return res.status(502).json({ error: 'Did not receive upload location from Google Drive.' });
    }

    // Step 2: Stream file bytes directly to Google Drive
    const fileStream = fs.createReadStream(job.outputPath);
    const webStream = Readable.toWeb(fileStream) as any;

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': job.mimeType || 'application/octet-stream',
        'Content-Length': String(fileSize),
      },
      body: webStream,
      duplex: 'half',
    } as any);

    if (!uploadRes.ok) {
      const errBody = await uploadRes.json().catch(() => ({}));
      return res.status(uploadRes.status).json({
        error: errBody.error?.message || 'Failed uploading file to Google Drive.',
      });
    }

    const driveFile = await uploadRes.json();

    // Immediately clean up temporary server file now that it's stored in user's Google Drive
    safeUnlink(job.outputPath);

    res.json({ file: driveFile });
  } catch (err: any) {
    console.error('Google Drive upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to upload to Google Drive.' });
  }
});

// Cleanup endpoint if user discards job
app.delete('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) {
    safeUnlink(job.inputPath);
    safeUnlink(job.outputPath);
    jobs.delete(req.params.id);
  }
  res.json({ success: true });
});

app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Express Error]', err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File exceeds the 500MB upload size limit.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  res.status(err.status || 400).json({
    error: err.message || 'An unexpected server error occurred.',
  });
});

// Clean up abandoned temp files older than 15 minutes
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) {
      safeUnlink(job.inputPath);
      safeUnlink(job.outputPath);
      jobs.delete(id);
    }
  }
  for (const [uploadId, sess] of chunkSessions.entries()) {
    if (sess.createdAt < cutoff) {
      safeUnlink(sess.tempFilePath);
      chunkSessions.delete(uploadId);
    }
  }
}, 5 * 60 * 1000);

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const distPath = path.resolve(__dirname, 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

  if (isProduction && hasDist) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      plugins: [
        {
          name: 'disable-hmr-websocket',
          enforce: 'post',
          transform(code, id) {
            if (id.includes('/vite/dist/client/client.mjs')) {
              return code.replace(
                /const transport = normalizeModuleRunnerTransport\([\s\S]*?(?=let willUnload)/,
                'const transport = { async connect() {}, async disconnect() {}, async send() {}, async invoke() {} };\n'
              );
            }
          },
        },
      ],
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MediaConverter server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
