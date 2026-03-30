import { Button, Input } from '@/components/ui';
import type { ParentFormData } from '../ParentEnrollment';

interface StepParentEmailProps {
  data: ParentFormData;
  onChange: (partial: Partial<ParentFormData>) => void;
  onNext: () => void;
  loading: boolean;
  error: string | null;
}

export function StepParentEmail({ data, onChange, onNext, loading, error }: StepParentEmailProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">Your account</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        Enter your email address. We'll send a code to verify it.
      </p>

      <Input
        label="Email address *"
        type="email"
        value={data.email}
        onChange={(e) => onChange({ email: e.target.value })}
        placeholder="your@email.com"
        error={error ?? undefined}
        required
      />

      <Button type="submit" disabled={loading || !data.email}>
        {loading ? 'Sending...' : 'Send verification code'}
      </Button>
    </form>
  );
}
