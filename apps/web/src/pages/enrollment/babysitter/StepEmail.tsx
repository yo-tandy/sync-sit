import { Button, Input, InfoBanner } from '@/components/ui';
import type { BabysitterFormData } from '../BabysitterEnrollment';

interface StepEmailProps {
  data: BabysitterFormData;
  onChange: (partial: Partial<BabysitterFormData>) => void;
  onNext: () => void;
  loading: boolean;
  error: string | null;
}

export function StepEmail({ data, onChange, onNext, loading, error }: StepEmailProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">Verify your school</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        Enter your EJM email address. We'll send a code to verify you're a
        current student.
      </p>

      <Input
        label="EJM Email"
        type="email"
        value={data.ejemEmail}
        onChange={(e) => onChange({ ejemEmail: e.target.value })}
        placeholder="name@ejm.org"
        error={error ?? undefined}
        required
      />

      <InfoBanner className="mb-6">
        Use your official EJM email. The last 2 digits must be your graduation
        year (currently 26–29).
      </InfoBanner>

      <Button type="submit" disabled={loading || !data.ejemEmail}>
        {loading ? 'Sending...' : 'Send verification code'}
      </Button>
    </form>
  );
}
