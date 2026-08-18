import { describe, it, expect } from 'vitest';
import { buildNotificationEmailHtml } from '../email.js';

// Branding pins for the shared notification email wrapper (issue #168 Phase 0).
// Study emails must carry no Sync/Sit branding and link the study host; the
// sit default must stay byte-identical in spirit to the pre-#168 wrapper.

describe('buildNotificationEmailHtml', () => {
  it('defaults to sit branding: Sync/Sit name, red accent, sync-sit.com footer link', () => {
    const html = buildNotificationEmailHtml('<p>hello</p>');
    expect(html).toContain('Sync/Sit');
    expect(html).toContain('#DC2626');
    expect(html).toContain('https://sync-sit.com');
    expect(html).toContain('Open Sync/Sit');
    expect(html).toContain('<p>hello</p>');
    expect(html).not.toContain('Sync/Study');
    expect(html).not.toContain('sync-study-app.web.app');
  });

  it("explicit 'sit' matches the default", () => {
    expect(buildNotificationEmailHtml('<p>x</p>', 'sit')).toBe(buildNotificationEmailHtml('<p>x</p>'));
  });

  it('study branding names Sync/Study, blue accent, links the study host, and carries no Sync/Sit text', () => {
    const html = buildNotificationEmailHtml('<p>hello</p>', 'study');
    expect(html).toContain('Sync/Study');
    expect(html).toContain('#2563EB');
    expect(html).toContain('https://sync-study-app.web.app');
    expect(html).toContain('Open Sync/Study');
    expect(html).toContain('<p>hello</p>');
    expect(html).not.toContain('Sync/Sit');
    expect(html).not.toContain('#DC2626');
    // The wrapper itself must not point at the sit host. "Sync/Sit" is a
    // substring-free check already; also pin the sit host absent outside the
    // caller-supplied body.
    expect(buildNotificationEmailHtml('', 'study')).not.toContain('https://sync-sit.com');
  });
});
