import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { PlusIcon, XIcon } from '@/components/ui/Icons';
import { useHolidays } from '@/hooks/useHolidays';
import { useAdminStore } from '@/stores/adminStore';

interface EditablePeriod {
  name: string;
  startDate: string;
  endDate: string;
}

export function AdminHolidaysPage() {
  const { t } = useTranslation();
  const { periods: existingPeriods, loading, schoolYear: currentSchoolYear } = useHolidays();
  const { updateHolidays } = useAdminStore();

  const [schoolYear, setSchoolYear] = useState(currentSchoolYear);
  const [periods, setPeriods] = useState<EditablePeriod[]>([]);
  const [saving, setSaving] = useState(false);

  // Populate periods from existing data
  useEffect(() => {
    if (!loading && existingPeriods.length > 0) {
      setPeriods(
        existingPeriods.map((p: any) => ({
          name: p.name || '',
          startDate: p.startDate || '',
          endDate: p.endDate || '',
        }))
      );
    }
  }, [loading, existingPeriods]);

  const handleAddPeriod = () => {
    setPeriods((prev) => [...prev, { name: '', startDate: '', endDate: '' }]);
  };

  const handleRemovePeriod = (index: number) => {
    setPeriods((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePeriodChange = (index: number, field: keyof EditablePeriod, value: string) => {
    setPeriods((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateHolidays(schoolYear, 'A', periods);
    } finally {
      setSaving(false);
    }
  };

  // Generate school year options
  const now = new Date();
  const baseYear = now.getFullYear();
  const schoolYearOptions = [
    { value: `${baseYear - 1}-${baseYear}`, label: `${baseYear - 1}-${baseYear}` },
    { value: `${baseYear}-${baseYear + 1}`, label: `${baseYear}-${baseYear + 1}` },
    { value: `${baseYear + 1}-${baseYear + 2}`, label: `${baseYear + 1}-${baseYear + 2}` },
  ];

  if (loading) {
    return (
      <div>
        <TopNav title={t('admin.holidays')} backTo="/admin" />
        <div className="flex justify-center py-8">
          <Spinner className="h-8 w-8 text-red-600" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title={t('admin.holidays')} backTo="/admin" />

      <div className="px-5 pb-8">
        <Select
          label={t('admin.schoolYear')}
          options={schoolYearOptions}
          value={schoolYear}
          onChange={(e) => setSchoolYear(e.target.value)}
        />

        <div className="space-y-3">
          {periods.map((period, index) => (
            <Card key={index}>
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-2">
                  <Input
                    placeholder={t('admin.periodName')}
                    value={period.name}
                    onChange={(e) => handlePeriodChange(index, 'name', e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="date"
                      placeholder={t('admin.startDate')}
                      value={period.startDate}
                      onChange={(e) => handlePeriodChange(index, 'startDate', e.target.value)}
                    />
                    <Input
                      type="date"
                      placeholder={t('admin.endDate')}
                      value={period.endDate}
                      onChange={(e) => handlePeriodChange(index, 'endDate', e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="ml-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  onClick={() => handleRemovePeriod(index)}
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={handleAddPeriod}
        >
          <PlusIcon className="h-4 w-4" />
          {t('admin.addPeriod')}
        </Button>

        <Button
          variant="primary"
          className="mt-6"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <Spinner className="h-5 w-5" /> : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
