import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui';

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">{number}</div>
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
          <img src="/logo.png" alt="Sync/Sit" className="mb-3 h-20 w-20 rounded-2xl" />
          <h1 className="mb-1 text-xl font-bold text-gray-900">{fr ? 'Comment utiliser Sync/Sit' : 'How to use Sync/Sit'}</h1>
          <p className="text-center text-sm text-gray-500">{fr ? 'Guide pour les parents' : 'A guide for parents'}</p>
        </div>

        <div className="mb-6 rounded-xl bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            {fr
              ? 'Sync/Sit connecte les familles EJM avec des babysitters lycéens de confiance. Voici comment commencer.'
              : 'Sync/Sit connects EJM families with trusted student babysitters. Here\'s how to get started.'}
          </p>
        </div>

        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Premiers pas' : 'Getting Started'}</h2>

        <Step number={1} title={fr ? 'Créer un compte' : 'Create an account'}>
          <p>
            {fr
              ? 'Rendez-vous sur sync-sit.com et cliquez sur "Parent". Entrez votre email et vérifiez-le avec le code reçu. Renseignez votre nom, prénom et créez un mot de passe.'
              : 'Go to sync-sit.com and tap "Parent". Enter your email and verify it with the code you receive. Fill in your first name, last name, and create a password.'}
          </p>
        </Step>

        <Step number={2} title={fr ? 'Configurer votre famille' : 'Set up your family'}>
          <p>
            {fr
              ? 'Ajoutez vos enfants avec leur âge et les langues parlées. Ajoutez votre adresse — elle sera utilisée pour trouver des babysitters à proximité. Vous pouvez aussi ajouter un co-parent pour qu\'il puisse gérer les demandes.'
              : 'Add your children with their age and languages spoken. Add your home address — it\'s used to find nearby babysitters. You can also invite a co-parent so they can manage requests too.'}
          </p>
        </Step>

        <Step number={3} title={fr ? 'Vérifier votre famille' : 'Verify your family'}>
          <p>
            {fr
              ? 'Pour plus de sécurité, vérifiez votre lien avec l\'école EJM. Allez dans le menu et sélectionnez "Vérification". Vous pouvez vérifier par email EJM ou par parrainage d\'une famille déjà vérifiée.'
              : 'For safety, verify your connection to EJM school. Go to the menu and select "Verification". You can verify via your EJM email or through a referral from an already-verified family.'}
          </p>
        </Step>

        <hr className="my-6 border-gray-200" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Trouver un babysitter' : 'Finding a Babysitter'}</h2>

        <Step number={4} title={fr ? 'Rechercher des babysitters' : 'Search for babysitters'}>
          <p>
            {fr
              ? 'Depuis votre tableau de bord, appuyez sur "Trouver un babysitter". Sélectionnez une date et un créneau horaire. L\'application affichera les babysitters disponibles, triés par proximité. Les dates sont automatiquement étiquetées (vacances scolaires, veille d\'école, etc.).'
              : 'From your dashboard, tap "Find a Babysitter". Select a date and time slot. The app will show available babysitters sorted by distance from your home. Dates are automatically tagged (school holidays, school nights, etc.).'}
          </p>
        </Step>

        <Step number={5} title={fr ? 'Envoyer une demande' : 'Send a request'}>
          <p>
            {fr
              ? 'Choisissez un babysitter et envoyez une demande. Vous pouvez ajouter un message, choisir quels enfants seront gardés et proposer un tarif horaire. Le babysitter recevra une notification par email et push.'
              : 'Choose a babysitter and send a request. You can add a message, choose which children will be looked after, and propose an hourly rate. The babysitter will be notified by email and push notification.'}
          </p>
        </Step>

        <Step number={6} title={fr ? 'Suivre vos demandes' : 'Track your requests'}>
          <p>
            {fr
              ? 'Votre tableau de bord affiche toutes vos demandes organisées par statut : en attente, confirmées, passées et refusées. Appuyez sur une carte pour voir les détails et les coordonnées du babysitter.'
              : 'Your dashboard shows all your requests organized by status: pending, confirmed, past, and declined. Tap on a card to see details and the babysitter\'s contact information.'}
          </p>
        </Step>

        <hr className="my-6 border-gray-200" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Gérer les rendez-vous' : 'Managing Appointments'}</h2>

        <Step number={7} title={fr ? 'Modifier un rendez-vous' : 'Modify an appointment'}>
          <p>
            {fr
              ? 'Vous pouvez modifier l\'heure ou ajouter des informations sur les demandes en attente ou confirmées. Appuyez sur la carte, puis sur "Modifier". Le babysitter sera notifié des changements.'
              : 'You can change the time or add information on pending or confirmed requests. Tap the card, then "Edit". The babysitter will be notified of the changes.'}
          </p>
        </Step>

        <Step number={8} title={fr ? 'Annuler un rendez-vous' : 'Cancel an appointment'}>
          <p>
            {fr
              ? 'Pour annuler un rendez-vous confirmé, appuyez sur la carte et sélectionnez "Annuler". Vous devrez fournir une raison. Le babysitter sera notifié par email et notification push.'
              : 'To cancel a confirmed appointment, tap the card and select "Cancel". You\'ll need to provide a reason. The babysitter will be notified by email and push notification.'}
          </p>
        </Step>

        <Step number={9} title={fr ? 'Resoumettre une demande refusée' : 'Resubmit a declined request'}>
          <p>
            {fr
              ? 'Si un babysitter refuse votre demande, vous pouvez la resoumettre avec des modifications (horaire, tarif) et une note expliquant les changements. La demande originale sera remplacée par la nouvelle.'
              : 'If a babysitter declines your request, you can resubmit it with modifications (time, rate) and a note explaining the changes. The original request will be replaced by the new one.'}
          </p>
        </Step>

        <Step number={10} title={fr ? 'Ajouter au calendrier' : 'Add to calendar'}>
          <p>
            {fr
              ? 'Les rendez-vous confirmés affichent un lien "Ajouter au calendrier" qui crée un événement dans votre application de calendrier avec la date, l\'heure et l\'adresse.'
              : 'Confirmed appointments show an "Add to calendar" link that creates an event in your calendar app with the date, time, and address.'}
          </p>
        </Step>

        <hr className="my-6 border-gray-200" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Recommandations et compte' : 'Endorsements & Account'}</h2>

        <Step number={11} title={fr ? 'Laisser une recommandation' : 'Leave an endorsement'}>
          <p>
            {fr
              ? 'Après un babysitting, vous pouvez laisser une recommandation pour le/la babysitter. Vous serez invité(e) à le faire depuis votre tableau de bord, ou vous pouvez aller dans "Mes recommandations" dans le menu. Votre recommandation sera envoyée au babysitter, qui choisira de la publier ou non pour les autres parents.'
              : 'After a babysitting appointment, you can leave an endorsement for the babysitter. You\'ll be prompted from your dashboard, or you can go to "My Endorsements" in the menu. Your endorsement will be sent to the babysitter, who can choose whether to publish it for other parents to see.'}
          </p>
        </Step>

        <Step number={12} title={fr ? 'Mon compte' : 'My Account'}>
          <p>
            {fr
              ? 'Dans le menu, allez dans "Mon compte" pour gérer votre photo de profil, vos coordonnées (téléphone avec indicatif pays, WhatsApp), changer votre mot de passe, configurer les notifications push/email et choisir votre langue.'
              : 'From the menu, go to "My Account" to manage your profile photo, contact details (phone with country code, WhatsApp), change your password, configure push/email notifications, and choose your language.'}
          </p>
        </Step>

        <Step number={13} title={fr ? 'Notifications' : 'Notifications'}>
          <p>
            {fr
              ? 'Vous recevez des notifications quand un babysitter accepte ou refuse votre demande, et des rappels avant les rendez-vous. Vous pouvez activer/désactiver les notifications push et email séparément pour chaque type.'
              : 'You receive notifications when a babysitter accepts or declines your request, and reminders before appointments. You can toggle push and email notifications separately for each type.'}
          </p>
        </Step>
      </div>
    </div>
  );
}
