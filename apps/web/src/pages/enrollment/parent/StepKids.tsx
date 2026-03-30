import { Button, Input, Card } from '@/components/ui';
import { PlusIcon, XIcon } from '@/components/ui/Icons';
import { LanguagePicker } from '@/components/forms/LanguagePicker';
import type { ParentFormData, KidFormData } from '../ParentEnrollment';

interface StepKidsProps {
  data: ParentFormData;
  onChange: (partial: Partial<ParentFormData>) => void;
  onNext: () => void;
  loading: boolean;
  error: string | null;
}

export function StepKids({ data, onChange, onNext, loading, error }: StepKidsProps) {
  const updateKid = (index: number, partial: Partial<KidFormData>) => {
    const newKids = [...data.kids];
    newKids[index] = { ...newKids[index], ...partial };
    onChange({ kids: newKids });
  };

  const addKid = () => {
    onChange({ kids: [...data.kids, { firstName: '', age: 0, languages: [] }] });
  };

  const removeKid = (index: number) => {
    if (data.kids.length <= 1) return;
    onChange({ kids: data.kids.filter((_, i) => i !== index) });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const isValid = data.kids.every(
    (kid) => kid.firstName && kid.age > 0 && kid.languages.length > 0
  );

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">Your kids</h2>
      <p className="mb-6 text-sm text-gray-500">
        Add your children so babysitters know who they'll be caring for.
      </p>

      {data.kids.map((kid, index) => (
        <Card key={index} className="mb-4 border-[1.5px] border-gray-200">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">Child {index + 1}</span>
            {data.kids.length > 1 && (
              <button
                type="button"
                onClick={() => removeKid(index)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XIcon className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex gap-3">
            <div className="flex-[2]">
              <Input
                label="First name *"
                value={kid.firstName}
                onChange={(e) => updateKid(index, { firstName: e.target.value })}
                required
              />
            </div>
            <div className="flex-1">
              <Input
                label="Age *"
                type="number"
                value={kid.age || ''}
                onChange={(e) => updateKid(index, { age: parseInt(e.target.value) || 0 })}
                min={0}
                max={18}
                required
              />
            </div>
          </div>

          <div>
            <LanguagePicker
              label="Languages *"
              selected={kid.languages}
              onChange={(languages) => updateKid(index, { languages })}
            />
          </div>
        </Card>
      ))}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={addKid}
        className="mb-6 w-full"
      >
        <PlusIcon className="h-4 w-4" />
        Add another child
      </Button>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={loading || !isValid} className="mb-8">
        {loading ? 'Creating account...' : 'Complete sign up'}
      </Button>
    </form>
  );
}
