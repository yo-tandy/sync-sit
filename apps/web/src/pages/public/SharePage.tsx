import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav, Button, Card, InfoBanner } from '@/components/ui';

export function SharePage() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const shareText = t('menu.shareText', { link: window.location.origin });
  const shareSubject = 'EJM Babysitting';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
    } catch {
      const input = document.createElement('input');
      input.value = shareText;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div>
      <TopNav title={t('menu.shareApp')} backTo="back" />
      <div className="px-5 pt-4 pb-8">
        <p className="mb-6 text-sm text-gray-500">
          {t('share.desc')}
        </p>

        <Card className="mb-4">
          <p className="mb-2 text-xs font-medium text-gray-500">{t('share.messagePreview')}</p>
          <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-800">{shareText}</p>
        </Card>

        {copied && <InfoBanner className="mb-4">{t('share.copied')}</InfoBanner>}

        <div className="flex flex-col gap-3">
          <Button onClick={handleCopy}>
            {copied ? t('share.copied') : t('share.copyMessage')}
          </Button>
          <Button
            variant="outline"
            onClick={() => window.open(`mailto:?subject=${encodeURIComponent(shareSubject)}&body=${encodeURIComponent(shareText)}`, '_self')}
          >
            {t('share.shareByEmail')}
          </Button>
        </div>
      </div>
    </div>
  );
}
