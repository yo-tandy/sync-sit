/**
 * Firebase emulator helpers for integration tests.
 *
 * All tests use project ID "demo-test" which triggers fully offline
 * emulator mode (no GCP credentials required).
 */
import { initializeApp, getApps, deleteApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export const PROJECT_ID = 'demo-test';
const FIRESTORE_PORT = process.env.TEST_FIRESTORE_PORT ?? '8080';
const AUTH_PORT = process.env.TEST_AUTH_PORT ?? '9099';
const FUNCTIONS_PORT = process.env.TEST_FUNCTIONS_PORT ?? '5001';
const STORAGE_PORT = process.env.TEST_STORAGE_PORT ?? '9199';
export const FUNCTIONS_URL = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/europe-west1`;
const FIRESTORE_URL = `http://127.0.0.1:${FIRESTORE_PORT}`;
const AUTH_URL = `http://127.0.0.1:${AUTH_PORT}`;

// The default bucket the FUNCTIONS emulator resolves for this project
// (firebase-tools injects FIREBASE_CONFIG.storageBucket =
// `${projectId}.appspot.com` into the functions runtime) — tests must use
// the SAME name or the do* photo callables and the doStripTaskPhoto
// trigger look at a different bucket than the one a test seeded.
export const STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;

// Set emulator env vars before any Firebase init
process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${AUTH_PORT}`;
process.env.FIREBASE_STORAGE_EMULATOR_HOST = `127.0.0.1:${STORAGE_PORT}`;
process.env.GCLOUD_PROJECT = PROJECT_ID;

let app: App;

export function getApp() {
  if (!app) {
    // Delete any existing apps to avoid conflicts
    for (const existing of getApps()) {
      deleteApp(existing);
    }
    app = initializeApp({ projectId: PROJECT_ID });
  }
  return app;
}

export function getDb() {
  return getFirestore(getApp());
}

export function getAdminAuth() {
  return getAuth(getApp());
}

/** A bucket via the Storage emulator (sync-do photo pipeline). Defaults to
 * the functions emulator's default bucket; pass a side-bucket name to seed
 * objects the doStripTaskPhoto trigger will NOT consume (it watches only
 * the default bucket — the sweep tests use this to hold quarantine residue
 * the trigger would otherwise eat). */
export function getBucket(name: string = STORAGE_BUCKET) {
  return getStorage(getApp()).bucket(name);
}

/**
 * Delete every object under a prefix (`do-uploads/`, `do-photos/`) —
 * per-suite cleanup; the Storage emulator has no clear-all REST endpoint
 * the way Firestore/Auth do.
 */
export async function clearStoragePrefix(prefix: string) {
  const [files] = await getBucket().getFiles({ prefix });
  await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
}

/**
 * Clear all Firestore data in the emulator.
 */
export async function clearFirestoreData() {
  const res = await fetch(
    `${FIRESTORE_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    throw new Error(`Failed to clear Firestore: ${res.status} ${await res.text()}`);
  }
}

/**
 * Clear all auth users in the emulator.
 */
export async function clearAuthUsers() {
  const res = await fetch(
    `${AUTH_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    throw new Error(`Failed to clear auth users: ${res.status} ${await res.text()}`);
  }
}

/**
 * Clear all emulator data (Firestore + Auth).
 */
export async function clearAll() {
  await Promise.all([clearFirestoreData(), clearAuthUsers()]);
}

/**
 * Call a Cloud Function via the emulator HTTP endpoint.
 * Uses the Firebase callable protocol (JSON with { data: ... }).
 */
export async function callFunction<T = unknown>(
  name: string,
  data: Record<string, unknown> = {},
  authToken?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  });

  const body = await res.json();

  if (body.error) {
    const err = new Error(body.error.message || 'Function error') as Error & {
      code: string;
      status: string;
      details?: unknown;
    };
    err.code = body.error.status;
    err.status = body.error.status;
    err.details = body.error.details;
    throw err;
  }

  return body.result as T;
}

/**
 * Create an auth user and get an ID token for them (for authenticated function calls).
 * Uses the emulator's REST API to exchange a custom token.
 */
export async function getIdToken(uid: string): Promise<string> {
  const auth = getAdminAuth();
  const customToken = await auth.createCustomToken(uid);

  // Exchange custom token for ID token via Auth emulator REST API
  const res = await fetch(
    `${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );

  const data = await res.json();
  if (!data.idToken) {
    throw new Error(`Failed to get ID token: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

/**
 * Paris-wall-clock date string N days from now (issue: the Paris-midnight
 * CI flake window). The domain's dates are Paris wall dates, but fixtures
 * built with `new Date(...).toISOString()` are UTC dates -- between Paris
 * midnight and 02:00 (CEST) the two disagree by a day, so "tomorrow"
 * fixtures reference Paris-TODAY and same-day fixtures reference
 * Paris-YESTERDAY ("date is already past"). Every near-now fixture must
 * use this instead of a UTC slice.
 */
export function parisDateFromNow(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts; // en-CA formats as YYYY-MM-DD
}
