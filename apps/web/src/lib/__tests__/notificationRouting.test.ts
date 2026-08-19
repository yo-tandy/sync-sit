import { describe, it, expect } from 'vitest';
import { VISIBLE_NOTIFICATION_TYPES, notificationRoute } from '../notificationRouting';

// Pins the sit type→route map shipped for issue #127 (UX F13). A wrong entry
// here is a wrong deep link in production, so the WHOLE map is asserted.
describe('sit notificationRouting', () => {
  it('lists exactly the sit + guardian types', () => {
    expect([...VISIBLE_NOTIFICATION_TYPES].sort()).toEqual(
      [
        'new_request',
        'request_accepted',
        'request_declined',
        'request_cancelled',
        'appointment_cancelled',
        'appointment_modified',
        'reminder',
        'general',
        'reference_received',
        'contact_sharing_request',
        'family_submitted',
        'supervision_request',
        'supervision_confirmed',
        'supervision_revoked',
        'guardian_invite_accepted',
        'guardian_mirror',
        'guardian_action',
        'guardian_searchable',
      ].sort(),
    );
  });

  it('never lists study-world types', () => {
    for (const t of ['study_session_cancelled', 'study_contact_request', 'tutor_endorsement_received']) {
      expect(VISIBLE_NOTIFICATION_TYPES.has(t)).toBe(false);
    }
  });

  it.each([
    ['new_request', '/babysitter'],
    ['request_cancelled', '/babysitter'],
    ['appointment_cancelled', '/babysitter'],
    ['appointment_modified', '/babysitter'],
    ['reminder', '/babysitter'],
    ['general', '/babysitter'],
    ['reference_received', '/babysitter/endorsements'],
    ['contact_sharing_request', '/babysitter/families'],
    ['supervision_request', '/babysitter'],
    ['family_submitted', null],
    ['guardian_action', null],
    ['guardian_searchable', null],
    ['supervision_revoked', null], // kid-side copy: nothing left to act on
  ] as const)('babysitter: %s -> %s', (type, route) => {
    expect(notificationRoute(type, {}, 'babysitter')).toBe(route);
  });

  it.each([
    ['request_accepted', '/family'],
    ['request_declined', '/family'],
    ['request_cancelled', '/family'],
    ['appointment_cancelled', '/family'],
    ['appointment_modified', '/family'],
    ['reminder', '/family'],
    ['general', '/family'],
    ['supervision_confirmed', '/family/governance'],
    ['supervision_revoked', '/family/governance'],
    ['guardian_invite_accepted', '/family/governance'],
    ['guardian_action', null],
    ['guardian_searchable', null],
  ] as const)('parent: %s -> %s', (type, route) => {
    expect(notificationRoute(type, {}, 'parent')).toBe(route);
  });

  it('guardian_mirror deep-links the parent to the mirrored kid when present', () => {
    expect(notificationRoute('guardian_mirror', { mirroredFrom: 'kid1' }, 'parent')).toBe(
      '/family/governance/kid1',
    );
    expect(notificationRoute('guardian_mirror', {}, 'parent')).toBe('/family/governance');
    expect(notificationRoute('guardian_mirror', undefined, 'parent')).toBe('/family/governance');
  });

  it('admin and unknown roles never navigate', () => {
    expect(notificationRoute('new_request', {}, 'admin')).toBeNull();
    expect(notificationRoute('new_request', {}, null)).toBeNull();
    expect(notificationRoute('new_request', {}, undefined)).toBeNull();
  });
});
