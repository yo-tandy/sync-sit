import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { Input, Card, Badge, Button, Avatar, Dialog, Textarea, Select } from '@ejm/shared-ui';
import type { TutorLookupResult } from '@ejm/study-core';

/**
 * "Already know your tutor?" lookup (issue #235, parity A2) — sit's
 * lookupBabysitter section ported. A family finds a tutor they already know
 * by name substring or exact email/ejemEmail, without needing a subject
 * search to surface them. Resolving never bypasses the two-stage model: a
 * result only carries display fields plus the pair's request status, and
 * contact goes through the ordinary sendTutorContactRequest flow — with
 * subject and level chosen HERE (unlike TutorCard, there is no matched
 * subject to inherit), constrained to what the tutor actually offers.
 */
export type { TutorLookupResult };

export function TutorLookup() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TutorLookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [requestTarget, setRequestTarget] = useState<TutorLookupResult | null>(null);
  const [lookupError, setLookupError] = useState<'generic' | 'rateLimited' | false>(false);
  const [truncated, setTruncated] = useState(false);
  // Monotonic sequence guarding against BOTH the pre-debounce cancel and a
  // stale in-flight response overwriting a newer query (PR #254 round 1).
  const seq = useRef(0);
  // uids whose request was sent through THIS dialog — render 'pending'
  // immediately without refetching (sit's optimistic idiom).
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  // Auto-search with debounce (sit's 400ms idiom).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      // Invalidate any in-flight call AND clear the spinner -- returning
      // early without setSearching(false) left "Searching..." stuck when a
      // keystroke dropped the query under 2 chars mid-debounce (PR #254
      // round 1).
      seq.current += 1;
      setResults([]);
      setHasSearched(false);
      setSearching(false);
      setLookupError(false);
      setTruncated(false);
      return;
    }
    setSearching(true);
    const mySeq = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const fn = httpsCallable<{ query: string }, { results?: TutorLookupResult[]; truncated?: boolean }>(
          functions,
          'lookupTutor',
        );
        const res = await fn({ query: q });
        if (seq.current !== mySeq) return; // stale response, newer query owns the UI
        setResults(res.data.results || []);
        setTruncated(res.data.truncated === true);
        setHasSearched(true);
        setLookupError(false);
      } catch (err: unknown) {
        if (seq.current !== mySeq) return;
        // A failed lookup must not leave the PREVIOUS query's rows standing
        // as though they answered this one (PR #254 round 1). The per-uid
        // throttle gets its own copy -- "something went wrong" would send
        // a fast typer into retry loops that keep the window spent.
        setResults([]);
        setHasSearched(false);
        setTruncated(false);
        setLookupError(
          (err as { code?: string })?.code === 'functions/resource-exhausted'
            ? 'rateLimited'
            : 'generic',
        );
      } finally {
        if (seq.current === mySeq) setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const statusOf = (r: TutorLookupResult): TutorLookupResult['requestStatus'] =>
    sentTo.has(r.uid) ? 'pending' : r.requestStatus;

  return (
    <div className="mt-8">
      <h3 className="mb-1 text-sm font-semibold text-gray-700">{t('family.lookup.title')}</h3>
      <p className="mb-3 text-xs text-gray-500">{t('family.lookup.hint')}</p>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('family.lookup.placeholder')}
        aria-label={t('family.lookup.title')}
      />
      {searching && <p className="mt-2 text-xs text-gray-500">{t('family.lookup.searching')}</p>}
      {!searching && hasSearched && results.length === 0 && (
        <p className="mt-2 text-xs text-gray-500">{t('family.lookup.noResults')}</p>
      )}
      {!searching && lookupError && (
        <p className="mt-2 text-xs text-brand-600">
          {t(lookupError === 'rateLimited' ? 'family.lookup.rateLimited' : 'family.search.error')}
        </p>
      )}
      {truncated && (
        <p className="mt-2 text-xs text-gray-500">{t('family.lookup.refine')}</p>
      )}
      {results.length > 0 && (
        <div className="mt-3 space-y-2">
          {results.map((r) => {
            const status = statusOf(r);
            return (
              <Card key={r.uid}>
                {/* flex-wrap + a real min-width on the name block: a wide
                    status control (the incoming link) drops below the name
                    instead of crushing it to "Lu..." -- min-w-0 alone would
                    let the name shrink forever and the row would never wrap. */}
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar
                    initials={`${(r.firstName || '')[0] || ''}${(r.lastName || '')[0] || ''}`}
                    src={r.photoUrl || undefined}
                  />
                  <div className="min-w-[55%] flex-1">
                    <p className="truncate font-semibold text-gray-900">
                      {r.firstName} {r.lastName}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {r.classLevel}
                      {r.languages.length > 0 && <> · {r.languages.join(', ')}</>}
                    </p>
                  </div>
                  <div className="ml-auto shrink-0">
                    {status === 'none' && (
                      <Button size="sm" variant="outline" onClick={() => setRequestTarget(r)}>
                        {t('family.search.card.request')}
                      </Button>
                    )}
                    {status === 'pending' && (
                      <Badge variant="gray">{t('family.search.card.pending')}</Badge>
                    )}
                    {status === 'incoming' && (
                      <Link to="/family/requests" className="text-xs font-semibold text-brand-600 underline">
                        {t('family.search.card.incoming')}
                      </Link>
                    )}
                    {status === 'accepted' && (
                      // Not a dead end: the family this feature serves is
                      // disproportionately one ALREADY connected -- link
                      // straight to where the contact details live.
                      <span className="flex items-center gap-2">
                        <Badge variant="green">{t('family.lookup.connected')}</Badge>
                        <Link to="/family/requests" className="text-xs font-semibold text-brand-600 underline">
                          {t('family.lookup.viewContact')}
                        </Link>
                      </span>
                    )}
                    {status === 'declined' && (
                      // searchTutors surfaces declined pairs the same way:
                      // the CTA promises a RETRY (cooldown may reject it),
                      // never a clean first send.
                      <Button size="sm" variant="outline" onClick={() => setRequestTarget(r)}>
                        {t('family.search.card.requestAgain')}
                      </Button>
                    )}
                  </div>
                </div>
                {status === 'declined' && (
                  <p className="mt-2 text-xs text-gray-500">{t('family.search.card.declinedHint')}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {requestTarget && (
        <LookupRequestDialog
          tutor={requestTarget}
          onClose={() => setRequestTarget(null)}
          onSent={() => {
            setSentTo((prev) => new Set(prev).add(requestTarget.uid));
            setRequestTarget(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Contact-request dialog for a lookup result: same callable and error copy
 * as TutorCard's ContactRequestDialog, but subject/level are SELECTED from
 * the tutor's offered list instead of inherited from a search match.
 */
function LookupRequestDialog({
  tutor,
  onClose,
  onSent,
}: {
  tutor: TutorLookupResult;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState(tutor.subjects[0]?.subject ?? '');
  const levelsFor = (s: string) => tutor.subjects.find((o) => o.subject === s)?.levels ?? [];
  const [level, setLevel] = useState(levelsFor(tutor.subjects[0]?.subject ?? '')[0] ?? '');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setSending(true);
    setError(null);
    const trimmed = message.trim();
    try {
      const fn = httpsCallable(functions, 'sendTutorContactRequest');
      await fn({
        tutorUserId: tutor.uid,
        subject,
        level,
        ...(trimmed ? { message: trimmed } : {}),
      });
      onSent();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      setError(t(lookupErrorKey(code)));
      setSending(false);
    }
  };

  return (
    <Dialog open onClose={onClose}>
      <h3 className="mb-4 text-lg font-bold">
        {t('family.search.contactDialog.title', { name: tutor.firstName })}
      </h3>
      <Select
        label={t('family.search.subjectLabel')}
        value={subject}
        onChange={(e) => {
          setSubject(e.target.value);
          setLevel(levelsFor(e.target.value)[0] ?? '');
        }}
        options={tutor.subjects.map((o) => ({
          value: o.subject,
          label: t(`tutor.subjects.names.${o.subject}`),
        }))}
      />
      <Select
        label={t('family.search.levelLabel')}
        value={level}
        onChange={(e) => setLevel(e.target.value)}
        options={levelsFor(subject).map((l) => ({ value: l, label: l }))}
      />
      <Textarea
        label={t('family.search.contactDialog.messageLabel')}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={1000}
        placeholder={t('family.search.contactDialog.messagePlaceholder')}
      />
      {error && <p className="mb-3 text-sm text-brand-600">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={handleSend} disabled={sending || !subject || !level} className="flex-1">
          {sending
            ? t('family.search.contactDialog.sending')
            : t('family.search.contactDialog.send')}
        </Button>
        <Button variant="ghost" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}

/** Same mapping as TutorCard's errorKeyForCode (kept local — not exported there). */
function lookupErrorKey(code: string | undefined): string {
  switch (code) {
    // Unlike TutorCard (only reachable AFTER a verified search), the lookup
    // renders for unverified families too -- the callable deliberately has
    // no verification gate -- so the denied path needs its own copy instead
    // of the generic error (PR #254 round 1).
    case 'functions/permission-denied':
      return 'family.lookup.errorVerify';
    case 'functions/already-exists':
      return 'family.search.contactDialog.errorAlreadyExists';
    case 'functions/resource-exhausted':
      return 'family.search.contactDialog.errorCooldown';
    case 'functions/failed-precondition':
      return 'family.search.contactDialog.errorPrecondition';
    default:
      return 'family.search.error';
  }
}
