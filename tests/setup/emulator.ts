/**
 * Firebase emulator helpers for integration tests.
 *
 * All tests use project ID "demo-test" which triggers fully offline
 * emulator mode (no GCP credentials required).
 */
import { initializeApp, getApps, deleteApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const PROJECT_ID = 'demo-test';
export const FUNCTIONS_URL = `http://127.0.0.1:5001/${PROJECT_ID}/europe-west1`;
const FIRESTORE_URL = `http://127.0.0.1:8080`;
const AUTH_URL = `http://127.0.0.1:9099`;

// Set emulator env vars before any Firebase init
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
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
    };
    err.code = body.error.status;
    err.status = body.error.status;
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
    `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
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
