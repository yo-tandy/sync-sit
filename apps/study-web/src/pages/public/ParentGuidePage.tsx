import { useTranslation } from 'react-i18next';
import { TopNav } from '@ejm/shared-ui';

// Mirrors sit's guide pages (issue #236, parity A3): TopNav + numbered steps,
// copy inlined per locale (no i18n keys — both languages ship with the page,
// exactly like apps/web/src/pages/public/ParentGuidePage.tsx).
function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{number}</div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="ml-10 text-sm leading-relaxed text-gray-600">{children}</div>
    </div>
  );
}

export function ParentGuidePage() {
  const { i18n } = useTranslation();
  const fr = i18n.language?.startsWith('fr');

  return (
    <div>
      <TopNav title={fr ? 'Guide Parents' : 'Parent Guide'} backTo="back" />
      <div className="px-5 pt-4 pb-8">
        <div className="mb-6 flex flex-col items-center">
          <img src="/logo.png" alt="Sync/Study" className="mb-3 h-20 w-20 rounded-2xl" />
          <h1 className="mb-1 text-xl font-bold text-gray-900">{fr ? 'Comment utiliser Sync/Study' : 'How to use Sync/Study'}</h1>
          <p className="text-center text-sm text-gray-500">{fr ? 'Guide pour les parents' : 'A guide for parents'}</p>
        </div>

        <div className="mb-6 rounded-xl bg-brand-50 p-4">
          <p className="text-sm font-medium text-brand-800">
            {fr
              ? 'Sync/Study connecte les familles EJM avec des élèves tuteurs de confiance. Voici comment commencer.'
              : 'Sync/Study connects EJM families with trusted student tutors. Here\'s how to get started.'}
          </p>
        </div>

        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Premiers pas' : 'Getting Started'}</h2>

        <Step number={1} title={fr ? 'Créer un compte' : 'Create an account'}>
          <p>
            {fr
              ? 'Ouvrez Sync/Study et cliquez sur "Parent". Entrez votre email et vérifiez-le avec le code reçu. Renseignez votre nom, prénom et créez un mot de passe.'
              : 'Open Sync/Study and tap "Parent". Enter your email and verify it with the code you receive. Fill in your first name, last name, and create a password.'}
          </p>
        </Step>

        <Step number={2} title={fr ? 'Configurer votre famille' : 'Set up your family'}>
          <p>
            {fr
              ? 'Dans "Paramètres de la famille", ajoutez vos enfants et votre adresse — elle sert à trouver des tuteurs à proximité. Votre famille est partagée avec Sync/Sit : les enfants et l\'adresse renseignés ici valent pour les deux applications.'
              : 'In "Family Settings", add your children and your home address — it\'s used to find nearby tutors. Your family is shared with Sync/Sit: the children and address you enter here apply in both apps.'}
          </p>
        </Step>

        <Step number={3} title={fr ? 'Vérifier votre famille' : 'Verify your family'}>
          <p>
            {fr
              ? 'La recherche de tuteurs est bloquée tant que votre famille n\'est pas vérifiée. Allez dans le menu et sélectionnez "Vérification". Vous pouvez vous vérifier via des documents (pièce d\'identité et certificat de scolarité EJM, examinés par un administrateur) ou demander à un parent EJM déjà vérifié de se porter garant pour vous via la vérification communautaire. La vérification est partagée avec Sync/Sit : la compléter dans l\'une des applications débloque les deux.'
              : 'Tutor search is blocked until your family is verified. Go to the menu and select "Verification". You can verify through documents (an identity document and your child\'s EJM enrollment document, reviewed by an admin), or ask an already-verified EJM parent to vouch for you using community verification. Verification is shared with Sync/Sit: completing it in either app unlocks both.'}
          </p>
        </Step>

        <hr className="my-6 border-gray-200" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Trouver un tuteur' : 'Finding a Tutor'}</h2>

        <Step number={4} title={fr ? 'Rechercher des tuteurs' : 'Search for tutors'}>
          <p>
            {fr
              ? 'Depuis votre tableau de bord, lancez une recherche pour une matière et un niveau de classe. Vous pouvez filtrer par lieu de séance, tarif maximum et distance. Les résultats montrent le profil du tuteur, ses matières et ses recommandations publiées.'
              : 'From your dashboard, start a search for a subject and class level. You can filter by session location, maximum rate, and distance. Results show the tutor\'s profile, subjects, and published endorsements.'}
          </p>
        </Step>

        <Step number={5} title={fr ? 'Publier votre recherche' : 'Publish your search'}>
          <p>
            {fr
              ? 'Pas de résultat concluant ? Vous pouvez publier votre recherche pour que les tuteurs viennent à vous. Une recherche publiée est visible par un plus grand nombre de tuteurs — y compris ceux qui ne correspondent pas à vos critères — et montre votre nom de famille, votre quartier, la matière et le niveau ; votre adresse n\'est jamais affichée. Les tuteurs intéressés vous envoient alors une demande de contact, que vous acceptez ou refusez depuis votre tableau de bord. Vous pouvez avoir jusqu\'à 3 recherches publiées à la fois ; chacune reste visible une semaine et peut être retirée à tout moment.'
              : 'No luck in the results? You can publish your search so tutors come to you. A published search is visible to a larger group of tutors — including ones who don\'t match your search terms — and shows your family name, your area, and the subject and level; your address is never shown. Interested tutors then send you a contact request, which you accept or decline from your dashboard. You can have up to 3 published searches at a time; each stays up for one week and can be withdrawn at any time.'}
          </p>
        </Step>

        <Step number={6} title={fr ? 'Envoyer une demande de contact' : 'Send a contact request'}>
          <p>
            {fr
              ? 'Choisissez un tuteur et envoyez une demande de contact pour la matière et le niveau concernés, avec un message optionnel. Le tuteur est notifié par email et notification push. Vous pouvez retirer votre demande tant qu\'elle est en attente — le retrait appartient toujours à celui qui a ouvert la demande, et il ne déclenche aucun délai d\'attente.'
              : 'Choose a tutor and send a contact request for the subject and level you need, with an optional message. The tutor is notified by email and push notification. You can withdraw your request while it\'s pending — withdrawal always belongs to whoever opened the request, and it triggers no waiting period.'}
          </p>
        </Step>

        <Step number={7} title={fr ? 'L\'approbation débloque la relation' : 'Approval unlocks the relationship'}>
          <p>
            {fr
              ? 'Si le tuteur accepte, la relation est débloquée : vous voyez ses coordonnées (email, téléphone, WhatsApp) et vous pouvez réserver des séances avec lui. S\'il refuse, vous devrez attendre 7 jours avant de lui renvoyer une demande.'
              : 'If the tutor accepts, the relationship is unlocked: you can see their contact details (email, phone, WhatsApp) and book sessions with them. If they decline, you must wait 7 days before sending them another request.'}
          </p>
        </Step>

        <hr className="my-6 border-gray-200" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Réserver et gérer les séances' : 'Booking & Managing Sessions'}</h2>

        <Step number={8} title={fr ? 'Réserver une séance' : 'Book a session'}>
          <p>
            {fr
              ? 'Les séances se réservent uniquement auprès des tuteurs qui vous ont approuvé(e). Choisissez une séance ponctuelle ou hebdomadaire récurrente sur les créneaux disponibles du tuteur, au moins 24 heures à l\'avance. Le tarif horaire de la matière est fixé au moment de la demande. La séance reste en attente jusqu\'à la confirmation du tuteur.'
              : 'Sessions can only be booked with tutors who have approved you. Pick a one-time or weekly recurring session within the tutor\'s available slots, at least 24 hours ahead. The subject\'s hourly rate is locked in when you request. The session stays pending until the tutor confirms.'}
          </p>
        </Step>

        <Step number={9} title={fr ? 'Propositions du tuteur' : 'Tutor proposals'}>
          <p>
            {fr
              ? 'Un tuteur peut aussi vous proposer une séance. Vous la confirmez en choisissant quels enfants y participent, ou vous la refusez. Le tuteur peut retirer sa proposition tant qu\'elle est en attente.'
              : 'A tutor can also propose a session to you. You confirm it by picking which children attend, or decline it. The tutor can withdraw their proposal while it\'s still pending.'}
          </p>
        </Step>

        <Step number={10} title={fr ? 'Suivre vos séances' : 'Track your sessions'}>
          <p>
            {fr
              ? 'La page "Vos cours" regroupe tout : demandes en attente, séances confirmées à venir et historique. Les séances récurrentes affichent la liste de leurs dates.'
              : 'The "Your sessions" page shows everything: pending requests, upcoming confirmed sessions, and history. Recurring sessions expand into their list of dates.'}
          </p>
        </Step>

        <Step number={11} title={fr ? 'Modifier ou annuler' : 'Modify or cancel'}>
          <p>
            {fr
              ? 'Vous pouvez modifier une séance ponctuelle confirmée : le tuteur est informé des changements et devra les confirmer, et votre séance reste réservée. Pour annuler, donnez une courte raison — le tuteur est notifié. Chaque tuteur affiche un délai de préavis d\'annulation ; les annulations tardives sont signalées, alors annulez le plus tôt possible. Une demande encore en attente peut être retirée à tout moment.'
              : 'You can modify a confirmed one-time session: the tutor is notified of the changes and asked to acknowledge them, and your session stays booked. To cancel, give a short reason — the tutor is notified. Each tutor shows a cancellation notice window; late cancellations are flagged, so cancel as early as you can. A request that is still pending can be withdrawn at any time.'}
          </p>
        </Step>

        <hr className="my-6 border-gray-200" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Recommandations et compte' : 'Endorsements & Account'}</h2>

        <Step number={12} title={fr ? 'Laisser une recommandation' : 'Leave an endorsement'}>
          <p>
            {fr
              ? 'Une fois votre demande de contact acceptée par un tuteur, vous pouvez lui laisser une recommandation (une par tuteur) depuis "Mes recommandations" dans le menu. Elle est envoyée au tuteur, qui choisit de la publier ou non pour les autres familles.'
              : 'Once a tutor has accepted your contact request, you can leave them one endorsement from "My endorsements" in the menu. It is sent to the tutor, who chooses whether to publish it for other families to see.'}
          </p>
        </Step>

        <Step number={13} title={fr ? 'Si votre enfant devient tuteur' : 'If your child becomes a tutor'}>
          <p>
            {fr
              ? 'Depuis "Comptes supervisés" dans le menu, vous pouvez inviter votre propre enfant à créer un compte tuteur supervisé : vous suivez son activité de tutorat et pouvez refuser des demandes en son nom — mais jamais accepter à sa place.'
              : 'From "Supervised kids" in the menu, you can invite your own child to create a supervised tutor account: you can follow their tutoring activity and decline requests on their behalf — but never accept in their place.'}
          </p>
        </Step>

        <Step number={14} title={fr ? 'Mon compte et notifications' : 'My Account & notifications'}>
          <p>
            {fr
              ? 'Dans "Mon compte", gérez votre photo, vos coordonnées, votre mot de passe et la langue de l\'application. Vous êtes notifié(e) quand un tuteur répond à vos demandes et avant vos séances — push et email se règlent séparément.'
              : 'In "My Account", manage your photo, contact details, password, and app language. You\'re notified when a tutor responds to your requests and before your sessions — push and email are configured separately.'}
          </p>
        </Step>
      </div>
    </div>
  );
}
