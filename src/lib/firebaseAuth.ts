import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import type { DriveFileItem } from '../types';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file');

let isSigningIn = false;
// Keep Google OAuth access token strictly in memory (never localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthChange: (user: User | null, hasDriveToken: boolean) => void
) => {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedAccessToken = null;
      onAuthChange(null, false);
    } else if (cachedAccessToken) {
      onAuthChange(user, true);
    } else if (!isSigningIn) {
      onAuthChange(user, false);
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Drive permission token. Please try again.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => cachedAccessToken;

export const logout = async () => {
  cachedAccessToken = null;
  await auth.signOut();
};

export const listDriveFiles = async (): Promise<DriveFileItem[]> => {
  if (!cachedAccessToken) {
    throw new Error('Google Drive authorization required.');
  }

  const params = new URLSearchParams({
    q: 'trashed = false',
    orderBy: 'createdTime desc',
    pageSize: '25',
    fields: 'files(id,name,mimeType,size,createdTime,webViewLink)',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${cachedAccessToken}`,
    },
  });

  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Session expired. Please sign in with Google again.');
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Failed to load files from Google Drive.');
  }

  return data.files || [];
};

export const deleteDriveFile = async (fileId: string): Promise<void> => {
  if (!cachedAccessToken) {
    throw new Error('Google Drive authorization required.');
  }

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${cachedAccessToken}`,
    },
  });

  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Session expired. Please sign in with Google again.');
  }

  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || 'Failed to delete file from Google Drive.');
  }
};

export const downloadDriveFileBlob = async (fileId: string): Promise<Blob> => {
  if (!cachedAccessToken) {
    throw new Error('Google Drive authorization required.');
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${cachedAccessToken}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error('Failed to download file from Google Drive.');
  }
  return res.blob();
};
