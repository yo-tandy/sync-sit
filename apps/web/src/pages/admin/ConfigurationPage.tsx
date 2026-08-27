import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { TopNav } from '@/components/ui/TopNav';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
// Direct import: the ui barrel transitively pulls the auth store's
// module-scope onAuthStateChanged — admin pages don't need that.
import { useToast } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';

interface ConfigDef {
  default: number;
  min: number;
  max: number;
  description: string;
}

/**
 * Admin configuration (issue #250): every admin-tunable operational
 * parameter, rendered from the server's own definition table so the panel
 * can never drift from the enforced bounds. Empty input = "use the code
 * default" (the key is simply not sent); a filled value is validated
 * against the bounds client-side for immediate feedback and server-side
 * for real (updateAdminConfig re-checks everything).
 */
export function AdminConfigurationPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [defs, setDefs] = useState<Record<string, ConfigDef> | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fn = httpsCallable<
          Record<string, never>,
          { defs: Record<string, ConfigDef>; values: Record<string, number> }
        >(functions, 'getAdminConfig');
        const res = await fn({});
        if (cancelled) return;
        setDefs(res.data.defs);
        setValues(res.data.values ?? {});
        setDrafts(
          Object.fromEntries(
            Object.entries(res.data.values ?? {}).map(([k, v]) => [k, String(v)]),
          ),
        );
      } catch {
        if (!cancelled) setError(t('admin.config.loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const invalids = defs
    ? Object.entries(drafts).filter(([k, raw]) => {
        if (raw.trim() === '') return false;
        const def = defs[k];
        if (!def) return true;
        const n = Number(raw);
        return !Number.isInteger(n) || n < def.min || n > def.max;
      })
    : [];

  const handleSave = async () => {
    if (!defs) return;
    const updates: Record<string, number> = {};
    for (const [k, raw] of Object.entries(drafts)) {
      if (raw.trim() === '') continue;
      const n = Number(raw);
      // Skip unchanged values so the audit log records real changes only.
      if (values[k] === n) continue;
      updates[k] = n;
    }
    if (Object.keys(updates).length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'updateAdminConfig');
      await fn({ updates });
      setValues((prev) => ({ ...prev, ...updates }));
      toast(t('admin.config.saved'));
    } catch {
      setError(t('admin.config.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <TopNav title={t('admin.config.title')} backTo="/admin" />
      <div className="px-5 pt-4 pb-8">
        <p className="mb-4 text-sm text-gray-500">{t('admin.config.help')}</p>
        {loading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
        {!loading && defs && (
          <>
            {Object.entries(defs).map(([key, def]) => {
              const raw = drafts[key] ?? '';
              const overridden = typeof values[key] === 'number';
              const n = Number(raw);
              const invalid =
                raw.trim() !== '' && (!Number.isInteger(n) || n < def.min || n > def.max);
              return (
                <Card key={key} className="mb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-all font-mono text-sm font-semibold text-gray-900">{key}</p>
                      <p className="mt-1 text-xs text-gray-500">{def.description}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {t('admin.config.bounds', {
                          def: def.default,
                          min: def.min,
                          max: def.max,
                        })}
                        {overridden ? '' : ` · ${t('admin.config.usingDefault')}`}
                      </p>
                    </div>
                    <div className="w-28 shrink-0">
                      <Input
                        aria-label={key}
                        type="number"
                        value={raw}
                        placeholder={String(def.default)}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                  {invalid && (
                    <p className="mt-2 text-xs text-brand-600">
                      {t('admin.config.outOfBounds', { min: def.min, max: def.max })}
                    </p>
                  )}
                </Card>
              );
            })}
            {error && <p className="mb-3 text-sm text-brand-600">{error}</p>}
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || invalids.length > 0}
              className="mt-2"
            >
              {saving ? t('common.saving') : t('admin.config.save')}
            </Button>
          </>
        )}
        {!loading && !defs && error && <p className="text-sm text-brand-600">{error}</p>}
      </div>
    </div>
  );
}
