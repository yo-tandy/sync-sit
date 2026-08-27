import { doc, getDoc } from 'firebase/firestore';
import { createAdminConfigReader } from '@ejm/shared-ui';
import { db } from '@/config/firebase';

/**
 * This app's instance of the shared admin-config reader (issue #250) --
 * the logic and its six-case fallback matrix live once in
 * shared-ui/lib/adminConfigReader; this file only binds the app's
 * firestore handle.
 */
const reader = createAdminConfigReader(() => getDoc(doc(db, 'adminConfig', 'values')));

export const getClientConfigValue = reader.getClientConfigValue;
export const __resetAdminConfigClientCacheForTests = reader.__resetAdminConfigClientCacheForTests;
