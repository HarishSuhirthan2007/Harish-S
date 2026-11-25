import type { DeviceMediaItem } from '../types';

const DB_NAME = 'MediaConverterDeviceDB';
const DB_VERSION = 1;
const STORE_NAME = 'converted_files';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open device storage.'));
  });
}

export async function saveFileToDeviceStorage(item: DeviceMediaItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to save file to device storage.'));
    };
  });
}

export async function listDeviceStorageFiles(): Promise<DeviceMediaItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const items = (req.result as DeviceMediaItem[]) || [];
      items.sort((a, b) => b.savedAt - a.savedAt);
      db.close();
      resolve(items);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error('Failed to read device storage.'));
    };
  });
}

export async function deleteDeviceStorageFile(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to delete file from device storage.'));
    };
  });
}
