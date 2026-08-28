import { doc, getDoc } from 'firebase/firestore';
import { createAdminConfigReader } from '@ejm/shared-ui';
import { db } from '@/config/firebase';

/**
 * This app's instance of the shared admin-config reader (issue #250) --
 * bound to the world-readable `adminConfig/client` mirror, NOT the authed
 * values doc: enrollment wizards read the resend cooldown before an
 * account exists (round-6 review), and every client-consumed key is
 * mirrored there by updateAdminConfig. The logic and its six-case
 * fallback matrix live once in
 * shared-ui/lib/adminConfigReader; this file only binds the app's
 * firestore handle.
 */
const reader = createAdminConfigReader(() => getDoc(doc(db, 'adminConfig', 'client')));

export const getClientConfigValue = reader.getClientConfigValue;
export const useClientConfigValue = reader.useClientConfigValue;
export const __resetAdminConfigClientCacheForTests = reader.__resetAdminConfigClientCacheForTests;

