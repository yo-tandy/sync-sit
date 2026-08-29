import { useTranslation } from 'react-i18next';
import type { OfferDoc } from '@ejm/do-core';
import { Avatar, Badge, Button, Card } from '@ejm/shared-ui';
import { OfferEndorsements } from './OfferEndorsements';

interface OfferCardProps {
  offer: OfferDoc;
  onAccept?: (offer: OfferDoc) => void;
  onDecline?: (offer: OfferDoc) => void;
}

/**
 * One offer on the family's task detail (§9.1 "the heart of the product"):
 * the §4.2 denormalized doer identity (name/photo/bio — the offer read rule
 * alone renders the card; no `users` read), price + basis, message,
 * availability note, the declared §11.3 helper WITH its disclosure copy,
 * and the three-source endorsements. Accept/decline appear for pending
 * offers; a declined card renders grey with no actions.
 */
export function OfferCard({ offer, onAccept, onDecline }: OfferCardProps) {
  const { t } = useTranslation();
  const declined = offer.status === 'declined';

  return (
    <Card className={`mb-3 ${declined ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <Avatar
          initials={(offer.doerFirstName || '?').slice(0, 2)}
          src={offer.doerPhotoUrl ?? undefined}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">{offer.doerFirstName}</p>
            <p className="shrink-0 text-sm font-bold text-brand-800">
              {offer.price} €{' '}
              <span className="text-xs font-medium text-gray-500">
                {offer.priceBasis === 'hourly'
                  ? t('family.taskDetail.offerBasisHourly')
                  : t('family.taskDetail.offerBasisFlat')}
              </span>
            </p>
          </div>
          {offer.doerBio && <p className="mt-0.5 text-xs text-gray-500">{offer.doerBio}</p>}
        </div>
      </div>

      <p className="mt-3 text-sm whitespace-pre-wrap text-gray-700">{offer.message}</p>

      {offer.availabilityNote && (
        <p className="mt-2 text-xs text-gray-500">
          <span className="font-medium">{t('family.taskDetail.offerAvailability')}:</span>{' '}
          {offer.availabilityNote}
        </p>
      )}

      {offer.helper && (
        <div className="mt-3 rounded-lg bg-amber-50 p-2.5">
          <p className="text-xs font-semibold text-amber-700">
            {t('family.taskDetail.helperTitle', {
              name: `${offer.helper.firstName} ${offer.helper.lastName}`,
              age: offer.helper.age,
            })}
          </p>
          {/* §11.3: the disclosure is stated where the helper is shown. */}
          <p className="mt-1 text-xs leading-relaxed text-amber-700">
            {t('family.taskDetail.helperDisclosure')}
          </p>
        </div>
      )}

      <div className="mt-3 border-t border-gray-100 pt-3">
        <h4 className="mb-1.5 text-xs font-semibold text-gray-700">
          {t('family.taskDetail.endorsementsTitle')}
        </h4>
        <OfferEndorsements doerUserId={offer.doerUserId} />
      </div>

      {offer.status === 'pending' && onAccept && onDecline && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => onAccept(offer)} className="flex-1">
            {t('family.taskDetail.acceptCta')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDecline(offer)} className="flex-1">
            {t('family.taskDetail.declineCta')}
          </Button>
        </div>
      )}
      {declined && (
        <div className="mt-3">
          {/* Noun-state label, NOT the imperative CTA string ('Refusée', not
              'Refuser' — PR #331 round 1). */}
          <Badge variant="gray">{t('family.taskDetail.declinedBadge')}</Badge>
        </div>
      )}
    </Card>
  );
}
