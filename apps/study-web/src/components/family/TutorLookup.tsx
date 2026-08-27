import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type { TutorLookupResult, TutorSearchResult } from '@ejm/study-core';
import { Card, Button, Input, Select } from '@ejm/shared-ui';
import { TutorCard } from '@/components/family/TutorCard';

/**
 * Direct tutor lookup by personal code (issue #235, parity A2) — the entry
 * point for a family whose tutor was found OFFLINE: the tutor reads their
 * code off their account page, the family types it here, and the resolved
 * card offers the exact same consent-gated flow a search result does.
 *
 * The card is the shared TutorCard, deliberately: its CTA mints the NORMAL
 * contact request (sendTutorContactRequest with all its guards), so the code
 * path cannot drift into a bypass of the approvedFamilies unlock. What a
 * search result carries as its MATCHED subject/level has no equivalent here
 * (the family arrived via a code, not a query), so the lookup result ships
 * the tutor's full offerings and the family picks the subject and level
 * before the card is built from that choice.
 */
export function TutorLookup() {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  // 'denied' => not verified / not a parent (same recovery copy as search);
  // 'invalid' => malformed code; 'notFound' => the uniform server not-found
  // (unknown code OR hidden/suspended tutor — the server deliberately does
  // not say which, see lookupTutor).
  const [error, setError] = useState<'notFound' | 'invalid' | 'denied' | 'generic' | null>(null);
  const [result, setResult] = useState<TutorLookupResult | null>(null);
  const [subject, setSubject] = useState('');
  const [level, setLevel] = useState('');

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fn = httpsCallable<{ code: string }, { result: TutorLookupResult }>(
        functions,
        'lookupTutor',
      );
      const res = await fn({ code: code.trim() });
      const r = res.data.result;
      setResult(r);
      // Default the pickers to the first offering — a one-subject tutor (the
      // common case) needs no further input before the card's CTA works.
      setSubject(r.subjects[0]?.subject ?? '');
      setLevel(r.subjects[0]?.levels[0] ?? '');
    } catch (err: unknown) {
      const errCode = (err as { code?: string })?.code;
      setError(
        errCode === 'functions/not-found'
          ? 'notFound'
          : errCode === 'functions/invalid-argument'
            ? 'invalid'
            : errCode === 'functions/permission-denied'
              ? 'denied'
              : 'generic',
      );
    } finally {
      setLoading(false);
    }
  };

  const offering = result?.subjects.find((o) => o.subject === subject);

  // The shared card's shape, assembled from the lookup result + the picked
  // offering. Built inline (cheap) rather than memoized state so a picker
  // change re-derives it without sync effects.
  const cardResult: TutorSearchResult | null =
    result && offering && level
      ? {
          uid: result.uid,
          firstName: result.firstName,
          lastName: result.lastName,
          photoUrl: result.photoUrl,
          languages: result.languages,
          aboutMe: result.aboutMe,
          classLevel: result.classLevel,
          subject,
          level,
          rate: offering.rate,
          levels: offering.levels,
          sessionLengthsMin: result.sessionLengthsMin,
          locationPrefs: result.locationPrefs,
          distance: result.distance,
          endorsementCount: result.endorsementCount,
          cancellationNoticeHours: result.cancellationNoticeHours,
          requestStatus: result.requestStatus,
          contactEmail: result.contactEmail,
          contactPhone: result.contactPhone,
          whatsapp: result.whatsapp,
        }
      : null;

  return (
    <Card className="mb-6">
      <h3 className="mb-1 text-sm font-semibold text-gray-700">
        {t('family.search.lookup.title')}
      </h3>
      <p className="mb-3 text-xs text-gray-500">{t('family.search.lookup.desc')}</p>

      <form onSubmit={handleLookup} className="flex items-start gap-2">
        <div className="flex-1">
          <Input
            id="tutor-lookup-code"
            aria-label={t('family.search.lookup.codeLabel')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('family.search.lookup.placeholder')}
            maxLength={16}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          fullWidth={false}
          disabled={!code.trim() || loading}
          className="mt-1 shrink-0"
        >
          {loading ? t('family.search.lookup.looking') : t('family.search.lookup.submit')}
        </Button>
      </form>

      {error === 'notFound' && (
        <p className="mt-2 text-sm text-brand-600">{t('family.search.lookup.notFound')}</p>
      )}
      {error === 'invalid' && (
        <p className="mt-2 text-sm text-brand-600">{t('family.search.lookup.invalid')}</p>
      )}
      {error === 'generic' && (
        <p className="mt-2 text-sm text-brand-600">{t('family.search.error')}</p>
      )}
      {/* Same recovery path the search denial shows: verification is the
          missing step, and the code will still be here afterwards. */}
      {error === 'denied' && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-800">
          <p className="mb-1 text-sm font-semibold">{t('family.dashboard.verifyBannerTitle')}</p>
          <p className="mb-3 text-xs text-amber-700">{t('family.dashboard.verifyBannerDesc')}</p>
          <Link to="/family/verification" className="text-xs font-semibold text-amber-900 underline">
            {t('family.search.verifyCta')}
          </Link>
        </div>
      )}

      {result && (
        <div className="mt-4">
          {result.subjects.length === 0 ? (
            // A resolvable tutor with zero offerings should not exist (search
            // requires an offering match to surface anyone), but the code
            // path has no query to filter on — degrade to copy, not a crash.
            <p className="text-sm text-gray-600">{t('family.search.lookup.noSubjects')}</p>
          ) : (
            <>
              <div className="flex gap-3">
                <div className="flex-1">
                  {/* Explicit ids: the Select derives its id from the label
                      text, and these labels also appear on the main search
                      form — two elements must not share an id. */}
                  <Select
                    id="tutor-lookup-subject"
                    label={t('family.search.subjectLabel')}
                    value={subject}
                    onChange={(e) => {
                      const next = e.target.value;
                      setSubject(next);
                      // Each offering carries its own levels; keep the level
                      // picker honest by resetting to the new offering's first.
                      setLevel(
                        result.subjects.find((o) => o.subject === next)?.levels[0] ?? '',
                      );
                    }}
                    options={result.subjects.map((o) => ({
                      value: o.subject,
                      label: t(`tutor.subjects.names.${o.subject}`),
                    }))}
                  />
                </div>
                <div className="flex-1">
                  <Select
                    id="tutor-lookup-level"
                    label={t('family.search.levelLabel')}
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    options={(offering?.levels ?? []).map((l) => ({ value: l, label: l }))}
                  />
                </div>
              </div>
              {/* Keyed by tutor only — NOT by subject/level: the card's local
                  request-status state is per (family, tutor) pair, so it must
                  survive an offering switch (a request just sent stays
                  "pending" when the family flips the subject picker). */}
              {cardResult && <TutorCard key={result.uid} result={cardResult} />}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
