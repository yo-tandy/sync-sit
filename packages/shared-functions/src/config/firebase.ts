import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';

const app = initializeApp();
export const db = getFirestore(app);
export const adminAuth = getAuth(app);
export const messaging = getMessaging(app);
