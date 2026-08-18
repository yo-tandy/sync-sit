import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav, Button, Card, useToast, ShareIcon, MailIcon } from '@ejm/shared-ui';

/**
 * Share Sync/Study with other EJM families and tutors. Copy-adapted from
 * sync-sit's SharePage (apps/web/src/pages/public/SharePage.tsx) — same
 * mechanics (navigator.share when available, clipboard + mailto fallbacks),
 * retargeted to the study brand and tutoring copy. The shared link is
 * window.location.origin, so each deployment advertises its own host.
 */
export function SharePage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const isFr = i18n.language?.startsWith('fr');

  const shareText = isFr
    ? `Salut ! J'utilise Sync/Study pour trouver des tuteurs de confiance dans notre communauté scolaire. Rejoins-nous ! ${window.location.origin}`
    : `Hey! I'm using Sync/Study to find trusted tutors in our school community. Join us! ${window.location.origin}`;

  const shareSubject = 'Sync/Study — Tutoring';

  const canNativeShare = typeof navigator.share === 'function';

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title: 'Sync/Study',
        text: shareText,
        url: window.location.origin,
      });
    } catch {
      // User cancelled or not supported
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
    toast(t('share.copied'));
  };

  const handleEmail = () => {
    window.location.href = `mailto:?subject=${encodeURIComponent(shareSubject)}&body=${encodeURIComponent(shareText)}`;
  };

  return (
    <div>
      <TopNav title={t('share.title')} backTo="back" />
      <div className="px-5 pt-4 pb-8">
        <p className="mb-6 text-sm leading-relaxed text-gray-500">
          {t('share.desc')}
        </p>

        <Card className="mb-6 bg-gray-50">
          <p className="mb-2 text-xs font-medium text-gray-500">{t('share.messagePreview')}</p>
          <p className="text-sm leading-relaxed text-gray-800">{shareText}</p>
        </Card>


        <div className="flex flex-col gap-3">
          {canNativeShare && (
            <Button onClick={handleNativeShare}>
              <ShareIcon className="h-5 w-5" />
              {t('share.shareNow')}
            </Button>
          )}

          <Button variant={canNativeShare ? 'outline' : 'primary'} onClick={handleCopy}>
            {copied ? `✓ ${t('share.copied')}` : t('share.copyMessage')}
          </Button>

          <Button variant="outline" onClick={handleEmail}>
            <MailIcon className="h-5 w-5" />
            {t('share.shareByEmail')}
          </Button>
        </div>
      </div>
    </div>
  );
}
