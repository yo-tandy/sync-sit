import { describe, it, expect, vi } from 'vitest';

vi.mock('@ejm/shared-functions/config/firebase.js', () => ({ db: {} }));
vi.mock('@ejm/shared-functions/config/notifyParents.js', () => ({ notifyAllParents: vi.fn() }));
vi.mock('@ejm/shared-functions/admin/writeAuditLog.js', () => ({ writeUserActivity: vi.fn() }));
vi.mock('@ejm/shared-functions/config/cors.js', () => ({ getCorsOrigin: () => [] }));
vi.mock('@ejm/shared-functions/config/push.js', () => ({ sendPushNotification: vi.fn() }));

import { buildTutorContactBlock } from '../respondToTutorContactRequest.js';
import type { StudyUser } from '@ejm/study-core';

describe('buildTutorContactBlock (issue #203 shared identity)', () => {
  it('ROOT contact wins over a stale nested copy in the acceptance email', () => {
    const tutorUser = {
      contactEmail: 'fresh@x.com',
      contactPhone: '+33 6 99',
      profiles: { tutor: { contactEmail: 'stale@x.com', contactPhone: '+33 6 00', whatsapp: '+33 6 00' } },
    } as unknown as StudyUser;
    const block = buildTutorContactBlock(tutorUser);
    expect(block).toContain('fresh@x.com');
    expect(block).toContain('+33 6 99');
    expect(block).not.toContain('stale@x.com');
    // whatsapp has no root value: nested fallback still surfaces it.
    expect(block).toContain('WhatsApp:</strong> +33 6 00');
  });

  it('escapes every surfaced value', () => {
    const tutorUser = {
      contactEmail: 'a<b>@x.com',
      profiles: { tutor: {} },
    } as unknown as StudyUser;
    const block = buildTutorContactBlock(tutorUser);
    expect(block).toContain('a&lt;b&gt;@x.com');
    expect(block).not.toContain('<b>@');
  });
});
