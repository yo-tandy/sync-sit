import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionInstanceList } from '../SessionInstanceList';
import type { StudySessionInstanceDoc } from '@/types/studySession';

const copy = {
  noOccurrences: 'None yet',
  cancelInstance: 'Cancel this date',
  statusCompleted: 'Completed',
  statusSkipped: 'Skipped',
  statusCancelled: 'Cancelled',
  trial: 'Trial',
  cancelledLate: 'Cancelled late',
};

function instance(overrides: Partial<StudySessionInstanceDoc> = {}): StudySessionInstanceDoc {
  return {
    instanceId: '2026-08-05',
    sessionId: 'sR',
    date: '2026-08-05',
    startTime: '17:00',
    endTime: '18:00',
    status: 'scheduled',
    location: 'online',
    ...overrides,
  };
}

function renderList(instances: StudySessionInstanceDoc[]) {
  return render(
    <SessionInstanceList
      sessionId="sR"
      instances={instances}
      today="2026-08-01"
      cancelKey={null}
      onCancelInstance={vi.fn()}
      formatDate={(d) => d}
      copy={copy}
    />,
  );
}

describe('SessionInstanceList late badge', () => {
  it('renders a "Cancelled late" badge on a late-cancelled occurrence', () => {
    renderList([instance({ status: 'cancelled', statusReason: 'cancelled_by_family', lateCancellation: true })]);
    expect(screen.getByText('Cancelled late')).toBeInTheDocument();
  });

  it('renders no late badge on an on-time cancelled occurrence', () => {
    renderList([instance({ status: 'cancelled', statusReason: 'cancelled_by_tutor' })]);
    expect(screen.queryByText('Cancelled late')).not.toBeInTheDocument();
    // The ordinary cancelled status chip still shows.
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('renders no late badge on a scheduled occurrence', () => {
    renderList([instance({ status: 'scheduled' })]);
    expect(screen.queryByText('Cancelled late')).not.toBeInTheDocument();
  });
});
