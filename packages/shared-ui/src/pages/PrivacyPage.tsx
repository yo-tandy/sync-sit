import { useTranslation } from 'react-i18next';
import { TopNav } from '../components/TopNav.js';

interface PrivacyPageProps {
  brand: string;
  supportEmail: string;
}

interface Section {
  titleEn: string;
  titleFr: string;
  contentEn: string;
  contentFr: string;
}

const sections: Section[] = [
  {
    titleEn: '1. Data Controller',
    titleFr: '1. Responsable du traitement',
    contentEn:
      '{{brand}} is operated by Tandy SARL, a company based in Paris, France. The data controller within the meaning of the General Data Protection Regulation (GDPR) and the French Data Protection Act (Loi Informatique et Libertés) can be contacted at: {{supportEmail}}.\n\n' +
      '{{brand}} is one of the Sync apps: a set of non-commercial platforms designed to connect families of the École Jeannine Manuel (EJM) community in Paris with EJM student service providers. The Sync apps are:\n\n' +
      '- Sync/Sit — babysitting\n' +
      '- Sync/Study — tutoring\n' +
      '- Sync/Do — help with everyday tasks: gardening and plant care; packing, moving and clearing boxes; flat-pack furniture assembly; help at parties; IT and device help; errands; and pet care and house checks (no overnight stays)\n\n' +
      'The three apps share one Sync account, one family verification, and this single privacy policy. This policy therefore describes everything the Sync apps collect; which parts apply to you depends on the apps and the role you use.',
    contentFr:
      '{{brand}} est exploitée par la société Tandy SARL, basée à Paris, France. Le responsable du traitement au sens du Règlement Général sur la Protection des Données (RGPD) et de la loi Informatique et Libertés est joignable à l\'adresse : {{supportEmail}}.\n\n' +
      '{{brand}} fait partie des applications Sync : un ensemble de plateformes non commerciales destinées à mettre en relation les familles de la communauté de l\'École Jeannine Manuel (EJM) à Paris avec des élèves de l\'EJM proposant leurs services. Les applications Sync sont :\n\n' +
      '- Sync/Sit — garde d\'enfants\n' +
      '- Sync/Study — soutien scolaire\n' +
      '- Sync/Do — coups de main du quotidien : jardinage et entretien des plantes ; emballage, déménagement et débarras de cartons ; montage de meubles en kit ; aide lors de fêtes ; assistance informatique ; courses ; et garde d\'animaux et visites à domicile (sans hébergement de nuit)\n\n' +
      'Les trois applications partagent un même compte Sync, une même vérification des familles et la présente politique de confidentialité unique. Cette politique décrit donc l\'ensemble des données collectées par les applications Sync ; les parties qui vous concernent dépendent des applications et du rôle que vous utilisez.',
  },
  {
    titleEn: '2. Personal Data Collected',
    titleFr: '2. Données personnelles collectées',
    contentEn:
      'We collect the following categories of personal data. Some categories exist only in one of the Sync apps; all of them are held on your single shared Sync account.\n\n' +
      '- Identity data: first name, last name, date of birth\n' +
      '- Contact data: email address, phone number, residential address (including GPS coordinates for proximity-based search)\n' +
      '- Profile data: profile photo, biography, spoken languages\n' +
      '- Service offer data: what a service provider publishes about the service they offer — for tutors, the subjects and levels taught, session lengths, location preferences and hourly rate; and, for all providers, the areas they are willing to work in\n' +
      '- Verification documents: government-issued ID scans and school enrollment certificates (for families only). Service providers are verified through their @ejm.org school email address.\n' +
      '- Data about children in a family profile: first names, ages, and spoken languages of the children a parent enters\n' +
      '- Scheduling data: the availability a service provider publishes, and the history of babysitting appointments, tutoring sessions and tasks\n' +
      '- Request and task content: the free text a family writes to describe what it needs, the photos a family uploads to illustrate a Sync/Do task (for example a garden, a room, or a flat-pack box), an indicative budget and the price agreed, and the free-text message a service provider sends with an offer. Free text and photos are seen by service providers, so please do not include anything you would not want them to see — a Sync/Do task and its photos are visible to every enrolled student, not only to the student who takes it on.\n' +
      '- Location context: your address is not shown in search results, on profiles, or on the Sync/Do task board. What is shown there is an area label such as an arrondissement or commune, plus an approximate distance. Your full address is shared with a service provider only once you accept them for a specific engagement — see section 5. Photos you upload are re-encoded on our servers and all embedded metadata, including EXIF location data, is removed before the photo is published or shown to anyone (see section 11).\n' +
      '- Notes: free text a family or service provider attaches to a booking, such as notes on a tutoring session\n' +
      '- References and endorsements: names and contact details of referees provided by service providers, and free-text endorsements written by families about a named service provider\n' +
      '- Details of a declared helper: on Sync/Do, a student making an offer may declare one additional person who would come with them. That person\'s first name, last name and age are recorded on the offer and shown to the family. See section 10.\n' +
      '- Community verification data: vouching records from other verified members\n' +
      '- Technical data: Firebase Cloud Messaging (FCM) tokens for push notifications\n' +
      '- Authentication data: email-based authentication tokens managed by Firebase Auth',
    contentFr:
      'Nous collectons les catégories de données personnelles suivantes. Certaines catégories n\'existent que dans l\'une des applications Sync ; toutes sont conservées sur votre compte Sync unique et partagé.\n\n' +
      '- Données d\'identité : prénom, nom, date de naissance\n' +
      '- Données de contact : adresse e-mail, numéro de téléphone, adresse postale (y compris les coordonnées GPS pour la recherche de proximité)\n' +
      '- Données de profil : photo de profil, biographie, langues parlées\n' +
      '- Données relatives à l\'offre de services : ce qu\'un prestataire publie au sujet du service qu\'il propose — pour les tuteurs, les matières et niveaux enseignés, les durées de séance, les préférences de lieu et le tarif horaire ; et, pour tous les prestataires, les secteurs dans lesquels ils acceptent d\'intervenir\n' +
      '- Documents de vérification : copies de pièces d\'identité officielles et certificats de scolarité (pour les familles uniquement). Les prestataires sont vérifiés par leur adresse e-mail scolaire @ejm.org.\n' +
      '- Données relatives aux enfants figurant dans un profil de famille : prénoms, âges et langues parlées des enfants saisis par le parent\n' +
      '- Données de planification : les disponibilités publiées par un prestataire, ainsi que l\'historique des gardes d\'enfants, des séances de soutien scolaire et des missions\n' +
      '- Contenu des demandes et des missions : le texte libre par lequel une famille décrit son besoin, les photos qu\'elle télécharge pour illustrer une mission Sync/Do (par exemple un jardin, une pièce ou un meuble en kit), un budget indicatif et le prix convenu, ainsi que le message en texte libre qu\'un prestataire joint à sa proposition. Le texte libre et les photos sont visibles par les prestataires : n\'y faites donc figurer rien que vous ne souhaiteriez pas leur montrer — une mission Sync/Do et ses photos sont visibles par tous les élèves inscrits, et pas seulement par celui qui s\'en chargera.\n' +
      '- Contexte de localisation : votre adresse n\'apparaît ni dans les résultats de recherche, ni sur les profils, ni sur le tableau des missions Sync/Do. N\'y figurent qu\'un libellé de secteur (arrondissement ou commune) et une distance approximative. Votre adresse complète n\'est communiquée à un prestataire qu\'une fois que vous l\'avez accepté pour une intervention déterminée — voir la section 5. Les photos que vous téléchargez sont réencodées sur nos serveurs et toutes les métadonnées intégrées, y compris les données de géolocalisation EXIF, sont supprimées avant que la photo ne soit publiée ou montrée à quiconque (voir la section 11).\n' +
      '- Notes : le texte libre qu\'une famille ou un prestataire attache à une réservation, par exemple les notes d\'une séance de soutien scolaire\n' +
      '- Références et recommandations : noms et coordonnées des personnes de référence fournies par les prestataires, ainsi que les recommandations en texte libre rédigées par les familles au sujet d\'un prestataire nommément désigné\n' +
      '- Informations sur un accompagnant déclaré : sur Sync/Do, un élève qui fait une proposition peut déclarer une personne supplémentaire qui l\'accompagnerait. Les prénom, nom et âge de cette personne sont enregistrés sur la proposition et communiqués à la famille. Voir la section 10.\n' +
      '- Données de vérification communautaire : attestations de parrainage par d\'autres membres vérifiés\n' +
      '- Données techniques : jetons Firebase Cloud Messaging (FCM) pour les notifications push\n' +
      '- Données d\'authentification : jetons d\'authentification par e-mail gérés par Firebase Auth',
  },
  {
    titleEn: '3. Purposes of Processing',
    titleFr: '3. Finalités du traitement',
    contentEn:
      'Your personal data is processed for the following purposes:\n\n' +
      '- Account creation and management: to create, maintain, and authenticate your account\n' +
      '- Matching and search: to enable families to find service providers near their home who match what they are looking for, and to enable service providers to see the requests and tasks families have published\n' +
      '- Affiliation verification: to verify the school affiliation of both families and service providers — families through identity documents and enrollment certificates, service providers through their @ejm.org school email\n' +
      '- Community verification: to facilitate peer vouching between verified community members\n' +
      '- Communication: to send transactional emails (verification codes, booking confirmations) and push notifications\n' +
      '- Safety and trust: to verify that service providers are enrolled EJM students and meet the age rules described in section 9, and to record a supervising parent\'s approval where one is required\n' +
      '- Administration: to allow platform administrators to review verification requests and manage user accounts',
    contentFr:
      'Vos données personnelles sont traitées aux fins suivantes :\n\n' +
      '- Création et gestion de compte : pour créer, maintenir et authentifier votre compte\n' +
      '- Mise en relation et recherche : pour permettre aux familles de trouver à proximité de leur domicile des prestataires correspondant à ce qu\'elles recherchent, et pour permettre aux prestataires de consulter les demandes et missions publiées par les familles\n' +
      '- Vérification d\'affiliation : pour vérifier l\'affiliation scolaire des familles et des prestataires — les familles par le biais de documents d\'identité et de certificats de scolarité, les prestataires par leur adresse e-mail scolaire @ejm.org\n' +
      '- Vérification communautaire : pour faciliter le parrainage entre membres vérifiés de la communauté\n' +
      '- Communication : pour envoyer des e-mails transactionnels (codes de vérification, confirmations de réservation) et des notifications push\n' +
      '- Sécurité et confiance : pour vérifier que les prestataires sont bien des élèves inscrits à l\'EJM et qu\'ils respectent les règles d\'âge décrites à la section 9, et pour enregistrer l\'accord d\'un parent superviseur lorsque celui-ci est requis\n' +
      '- Administration : pour permettre aux administrateurs de la plateforme d\'examiner les demandes de vérification et de gérer les comptes utilisateurs',
  },
  {
    titleEn: '4. Legal Basis for Processing',
    titleFr: '4. Base légale du traitement',
    contentEn:
      'We process your data on the following legal grounds under Article 6 of the GDPR:\n\n' +
      '- Consent (Article 6(1)(a)): you provide explicit consent when you create your account and accept this privacy policy. You may withdraw consent at any time by deleting your account or contacting us.\n' +
      '- Contract performance (Article 6(1)(b)): processing is necessary to provide the services you signed up for, including matching, scheduling, and communication features.\n' +
      '- Legitimate interest (Article 6(1)(f)): we have a legitimate interest in verifying the school affiliation of families and service providers to ensure the safety of the children, families and students using the platform. This includes collecting and reviewing ID documents and school enrollment certificates from families, and verifying service providers through their @ejm.org school email.\n\n' +
      'For data about children in a family profile (names and ages), we rely on parental consent provided by the parent who creates the account and enters this information.\n\n' +
      'For a service provider under the age of 15, or for any supervised student account, we rely on the consent and approval of the supervising parent, which is recorded on the account and — where a task requires it — on the individual offer. Section 9 explains when this applies.',
    contentFr:
      'Nous traitons vos données sur les bases légales suivantes au titre de l\'article 6 du RGPD :\n\n' +
      '- Consentement (article 6, paragraphe 1, point a) : vous donnez votre consentement explicite lors de la création de votre compte et de l\'acceptation de la présente politique de confidentialité. Vous pouvez retirer votre consentement à tout moment en supprimant votre compte ou en nous contactant.\n' +
      '- Exécution du contrat (article 6, paragraphe 1, point b) : le traitement est nécessaire à la fourniture des services auxquels vous vous êtes inscrit(e), y compris les fonctionnalités de mise en relation, de planification et de communication.\n' +
      '- Intérêt légitime (article 6, paragraphe 1, point f) : nous avons un intérêt légitime à vérifier l\'affiliation scolaire des familles et des prestataires afin de garantir la sécurité des enfants, des familles et des élèves utilisant la plateforme. Cela inclut la collecte et l\'examen de copies de pièces d\'identité et de certificats de scolarité des familles, ainsi que la vérification des prestataires par leur adresse e-mail scolaire @ejm.org.\n\n' +
      'Pour les données relatives aux enfants figurant dans un profil de famille (prénoms et âges), nous nous fondons sur le consentement parental donné par le parent qui crée le compte et saisit ces informations.\n\n' +
      'Pour un prestataire de moins de 15 ans, ou pour tout compte d\'élève supervisé, nous nous fondons sur le consentement et l\'approbation du parent superviseur, qui sont enregistrés sur le compte et — lorsqu\'une mission l\'exige — sur la proposition elle-même. La section 9 précise les cas concernés.',
  },
  {
    titleEn: '5. Data Recipients',
    titleFr: '5. Destinataires des données',
    contentEn:
      'Your personal data may be shared with or accessed by the following recipients:\n\n' +
      '- Platform administrators: for verification review (family ID documents and school certificates) and user account management\n' +
      '- Other users: your profile information (name, photo, bio, languages, availability, and the service details a provider publishes) is visible to other verified users of the platform. Your address is not displayed to them; only an area label and an approximate distance are. The one exception is a provider you accept — see the next entry.\n' +
      '- Enrolled students, on the Sync/Do task board: a task you publish — its title, description, photos, area label, timing and indicative budget, and your family name — is visible to every enrolled student, not only to the one who ends up doing it. Offers, including the price quoted, the message, and any declared helper, are visible only to you, to the student who made the offer, to that student\'s supervising parent where an approval is required, and to platform administrators.\n' +
      '- The other party to an engagement you accept: once a family accepts a service provider for a specific appointment, session or task, the two are shown each other\'s contact details — the family\'s address and its parents\' names, email, phone and WhatsApp number, and the service provider\'s name, email, phone and WhatsApp number. On Sync/Do this exchange is served live at the moment you look at it and is never stored on the offer; it stays available while the task is assigned and after it is completed, until the task itself is deleted under section 7, and for seven days after a cancellation. On Sync/Sit the address you accepted with is recorded on the appointment itself, and goes when that appointment does under section 7.\n- A supervising parent: if a service provider has a supervised account, their supervising parent can see the offers that require their approval, including the task they relate to.\n' +
      '- Google LLC (Firebase): provides hosting, database (Firestore), authentication, file storage (Cloud Storage), and push notification services (FCM). Data is stored in the EU region (europe-west1).\n' +
      '- Resend Inc.: provides transactional email delivery for verification codes, appointment notifications, and account-related communications.\n\n' +
      'We do not sell, rent, or trade your personal data to any third party. We do not use your data for advertising or marketing purposes.',
    contentFr:
      'Vos données personnelles peuvent être partagées avec ou consultées par les destinataires suivants :\n\n' +
      '- Administrateurs de la plateforme : pour l\'examen des vérifications (pièces d\'identité et certificats de scolarité des familles) et la gestion des comptes utilisateurs\n' +
      '- Autres utilisateurs : vos informations de profil (nom, photo, biographie, langues, disponibilités et les détails du service publiés par un prestataire) sont visibles par les autres utilisateurs vérifiés de la plateforme. Votre adresse ne leur est pas affichée ; seuls un libellé de secteur et une distance approximative le sont. La seule exception est un prestataire que vous acceptez — voir l\'entrée suivante.\n' +
      '- Les élèves inscrits, sur le tableau des missions Sync/Do : une mission que vous publiez — son titre, sa description, ses photos, son libellé de secteur, ses horaires, son budget indicatif et votre nom de famille — est visible par tous les élèves inscrits, et pas seulement par celui qui s\'en chargera. Les propositions, y compris le prix proposé, le message et tout accompagnant déclaré, ne sont visibles que par vous, par l\'élève auteur de la proposition, par le parent superviseur de cet élève lorsqu\'une approbation est requise, et par les administrateurs de la plateforme.\n' +
      '- L\'autre partie à une intervention que vous acceptez : lorsqu\'une famille accepte un prestataire pour un rendez-vous, une séance ou une mission déterminés, les deux parties se voient communiquer leurs coordonnées respectives — l\'adresse de la famille ainsi que les nom, prénom, e-mail, téléphone et numéro WhatsApp de ses parents, et les nom, prénom, e-mail, téléphone et numéro WhatsApp du prestataire. Sur Sync/Do, cet échange est servi en direct au moment où vous le consultez et n\'est jamais enregistré sur la proposition ; il reste accessible pendant que la mission est attribuée et après son achèvement, jusqu\'à la suppression de la mission elle-même au titre de la section 7, ainsi que pendant sept jours après une annulation. Sur Sync/Sit, l\'adresse pour laquelle vous avez donné votre accord est enregistrée sur le rendez-vous lui-même et disparaît en même temps que ce rendez-vous, au titre de la section 7.\n- Un parent superviseur : si un prestataire dispose d\'un compte supervisé, son parent superviseur peut consulter les propositions soumises à son approbation, ainsi que la mission concernée.\n' +
      '- Google LLC (Firebase) : fournit l\'hébergement, la base de données (Firestore), l\'authentification, le stockage de fichiers (Cloud Storage) et les services de notifications push (FCM). Les données sont stockées dans la région UE (europe-west1).\n' +
      '- Resend Inc. : fournit le service d\'envoi d\'e-mails transactionnels pour les codes de vérification, les notifications de rendez-vous et les communications liées aux comptes.\n\n' +
      'Nous ne vendons, ne louons et ne commercialisons aucune de vos données personnelles auprès de tiers. Nous n\'utilisons pas vos données à des fins publicitaires ou commerciales.',
  },
  {
    titleEn: '6. Data Transfers Outside the EU',
    titleFr: '6. Transferts de données hors de l\'UE',
    contentEn:
      'Your data is primarily stored and processed within the European Union (Firebase europe-west1 region). However, some processing by Google LLC and Resend Inc. may involve transfers to the United States.\n\n' +
      'These transfers are governed by appropriate safeguards in compliance with the GDPR, including:\n' +
      '- Standard Contractual Clauses (SCCs) adopted by the European Commission\n' +
      '- The EU-US Data Privacy Framework where applicable\n\n' +
      'You may request a copy of the applicable safeguards by contacting us at {{supportEmail}}.',
    contentFr:
      'Vos données sont principalement stockées et traitées au sein de l\'Union européenne (région Firebase europe-west1). Toutefois, certains traitements effectués par Google LLC et Resend Inc. peuvent impliquer des transferts vers les États-Unis.\n\n' +
      'Ces transferts sont encadrés par des garanties appropriées conformément au RGPD, notamment :\n' +
      '- Les Clauses Contractuelles Types (CCT) adoptées par la Commission européenne\n' +
      '- Le cadre de protection des données UE-États-Unis (Data Privacy Framework), le cas échéant\n\n' +
      'Vous pouvez demander une copie des garanties applicables en nous contactant à {{supportEmail}}.',
  },
  {
    titleEn: '7. Data Retention',
    titleFr: '7. Durée de conservation',
    contentEn:
      'We retain your personal data for the following periods:\n\n' +
      '- Active account data (profile, children, schedule, documents): retained as long as your account is active. Deleted promptly upon account deletion request.\n' +
      '- Notifications and audit logs: retained for 30 days, then automatically deleted\n' +
      '- Completed engagements — babysitting appointments, tutoring sessions and Sync/Do tasks: retained for 6 months after they take place, then automatically deleted. For a Sync/Do task this also deletes the offers made on it, the photos attached to it, and any declared helper\'s details recorded on the accepted offer.\n' +
      '- Cancelled appointment and cancelled task records: retained for 30 days, then automatically deleted\n' +
      '- Published requests and unclaimed tasks: deleted automatically once they expire\n' +
      '- Notes attached to a booking: on Sync/Sit, a note on a past or cancelled appointment is removed once that appointment has left every screen in the app. On Sync/Study, session notes are part of the session record and leave only when it does.\n' +
      '- Expired verification codes and magic links: deleted immediately upon expiration\n' +
      '- Verification documents (ID scans, school certificates): retained for the duration of account activity. Deleted upon account deletion.\n' +
      '- FCM tokens: retained while the account is active, deleted upon logout or account deletion\n\n' +
      'Some records have no automatic expiry and are kept until you delete your account or the record itself: a pending babysitting request and any note written on it, an ongoing recurring arrangement that has no end date, a task that was assigned but that neither side ever closed, and a cancelled or declined tutoring session.\n\n' +
      'When you delete your account, all associated personal data is permanently erased from our systems (hard deletion). This includes your profile, documents, verification records, data about your children, the photos you uploaded, and the references and endorsements connected to your account.',
    contentFr:
      'Nous conservons vos données personnelles pendant les durées suivantes :\n\n' +
      '- Données de compte actif (profil, enfants, planification, documents) : conservées tant que votre compte est actif. Supprimées dans les meilleurs délais suite à une demande de suppression de compte.\n' +
      '- Notifications et journaux d\'audit : conservés pendant 30 jours, puis automatiquement supprimés\n' +
      '- Prestations terminées — gardes d\'enfants, séances de soutien scolaire et missions Sync/Do : conservées pendant 6 mois après leur déroulement, puis automatiquement supprimées. Pour une mission Sync/Do, cette suppression emporte également les propositions reçues, les photos qui y étaient jointes et les informations relatives à tout accompagnant déclaré sur la proposition acceptée.\n' +
      '- Enregistrements de rendez-vous annulés et de missions annulées : conservés pendant 30 jours, puis automatiquement supprimés\n' +
      '- Demandes publiées et missions non pourvues : supprimées automatiquement à leur expiration\n' +
      '- Notes attachées à une réservation : sur Sync/Sit, une note portant sur un rendez-vous passé ou annulé est supprimée dès que ce rendez-vous n\'apparaît plus sur aucun écran de l\'application. Sur Sync/Study, les notes de séance font partie de l\'enregistrement de la séance et ne disparaissent qu\'avec lui.\n' +
      '- Codes de vérification et liens magiques expirés : supprimés immédiatement à l\'expiration\n' +
      '- Documents de vérification (copies de pièces d\'identité, certificats de scolarité) : conservés pendant toute la durée d\'activité du compte. Supprimés lors de la suppression du compte.\n' +
      '- Jetons FCM : conservés tant que le compte est actif, supprimés lors de la déconnexion ou de la suppression du compte\n\n' +
      'Certains enregistrements n\'ont pas d\'expiration automatique et sont conservés jusqu\'à ce que vous supprimiez votre compte ou l\'enregistrement lui-même : une demande de garde en attente ainsi que toute note qui s\'y rapporte, un arrangement récurrent en cours sans date de fin, une mission attribuée que ni l\'une ni l\'autre des parties n\'a clôturée, et une séance de soutien scolaire annulée ou refusée.\n\n' +
      'Lorsque vous supprimez votre compte, toutes les données personnelles associées sont définitivement effacées de nos systèmes (suppression irréversible). Cela inclut votre profil, vos documents, vos enregistrements de vérification, les données relatives à vos enfants, les photos que vous avez téléchargées, ainsi que les références et recommandations liées à votre compte.',
  },
  {
    titleEn: '8. Your Rights Under GDPR',
    titleFr: '8. Vos droits en vertu du RGPD',
    contentEn:
      'Under the GDPR and French data protection law, you have the following rights regarding your personal data:\n\n' +
      '- Right of access (Article 15): you may request a copy of all personal data we hold about you\n' +
      '- Right to rectification (Article 16): you may request correction of inaccurate or incomplete data\n' +
      '- Right to erasure (Article 17): you may request deletion of your personal data. You can do this directly by deleting your account in the app, or by contacting us.\n' +
      '- Right to data portability (Article 20): you may request your data in a structured, machine-readable format. An in-app export feature is available in your account settings.\n' +
      '- Right to restriction of processing (Article 18): you may request that we limit the processing of your data in certain circumstances\n' +
      '- Right to object (Article 21): you may object to processing based on legitimate interest\n' +
      '- Right to withdraw consent: you may withdraw your consent at any time, without affecting the lawfulness of processing carried out prior to withdrawal\n\n' +
      'To exercise any of these rights, you may:\n' +
      '- Use the in-app data export and account deletion features in your profile settings\n' +
      '- Contact us at {{supportEmail}}\n\n' +
      'We will respond to your request within 30 days. If you believe your rights have not been respected, you have the right to lodge a complaint with the Commission Nationale de l\'Informatique et des Libertés (CNIL), the French data protection authority: www.cnil.fr.',
    contentFr:
      'En vertu du RGPD et de la loi française sur la protection des données, vous disposez des droits suivants concernant vos données personnelles :\n\n' +
      '- Droit d\'accès (article 15) : vous pouvez demander une copie de l\'ensemble des données personnelles que nous détenons à votre sujet\n' +
      '- Droit de rectification (article 16) : vous pouvez demander la correction de données inexactes ou incomplètes\n' +
      '- Droit à l\'effacement (article 17) : vous pouvez demander la suppression de vos données personnelles. Vous pouvez le faire directement en supprimant votre compte dans l\'application, ou en nous contactant.\n' +
      '- Droit à la portabilité des données (article 20) : vous pouvez demander vos données dans un format structuré et lisible par machine. Une fonctionnalité d\'export est disponible dans les paramètres de votre compte.\n' +
      '- Droit à la limitation du traitement (article 18) : vous pouvez demander la limitation du traitement de vos données dans certaines circonstances\n' +
      '- Droit d\'opposition (article 21) : vous pouvez vous opposer au traitement fondé sur l\'intérêt légitime\n' +
      '- Droit de retrait du consentement : vous pouvez retirer votre consentement à tout moment, sans que cela n\'affecte la licéité du traitement effectué avant le retrait\n\n' +
      'Pour exercer l\'un de ces droits, vous pouvez :\n' +
      '- Utiliser les fonctionnalités d\'export de données et de suppression de compte disponibles dans les paramètres de votre profil\n' +
      '- Nous contacter à {{supportEmail}}\n\n' +
      'Nous répondrons à votre demande dans un délai de 30 jours. Si vous estimez que vos droits n\'ont pas été respectés, vous avez le droit d\'introduire une réclamation auprès de la Commission Nationale de l\'Informatique et des Libertés (CNIL), autorité française de protection des données : www.cnil.fr.',
  },
  {
    titleEn: '9. Children and Minors',
    titleFr: '9. Enfants et mineurs',
    contentEn:
      '{{brand}} collects limited data about the children in a family\'s profile — their first names, ages, and spoken languages — for the sole purpose of arranging the services described in section 1. This data is entered exclusively by their parent or legal guardian.\n\n' +
      'We do not collect this data directly from the children it describes. All of it is provided with parental consent as part of the parent\'s account creation and profile management.\n\n' +
      'It is visible only to verified service providers on the platform and to platform administrators, and it is deleted immediately when the parent deletes their account.\n\n' +
      'Service providers on the Sync apps are themselves EJM students, and most of them are minors. Two rules apply:\n\n' +
      '- A student who signs up on their own must be at least 15. That is the age of digital consent under French law (Article 8 of the GDPR as implemented in France), so a student aged 15 or over creates their account with their own consent, and no parental consent is required for them under French law.\n' +
      '- A student under 15 can take part only through a supervised account, which a parent creates and governs from their own account. In that case the parent gives consent on the student\'s behalf, and the supervision is recorded on the account. Supervision can be ended once the student is 15 or older.\n\n' +
      'There is no single upper age limit, because the apps differ. On Sync/Sit and Sync/Study a provider\'s date of birth must also be consistent with their EJM school year, so enrollment in practice accepts students aged 15 to 18 and refuses a date of birth outside that window; an administrator can grant an exemption. On Sync/Do there is no upper limit.\n\n' +
      'On Sync/Do, some kinds of task additionally require the supervising parent of a supervised student to approve that specific offer before the family sees it. The approval, and who gave it, is recorded on the offer.',
    contentFr:
      '{{brand}} collecte des données limitées concernant les enfants figurant dans le profil d\'une famille — leurs prénoms, âges et langues parlées — dans le seul but d\'organiser les services décrits à la section 1. Ces données sont saisies exclusivement par leur parent ou représentant légal.\n\n' +
      'Nous ne collectons pas ces données directement auprès des enfants qu\'elles concernent. Elles sont toutes fournies avec le consentement parental dans le cadre de la création du compte et de la gestion du profil du parent.\n\n' +
      'Elles ne sont visibles que par les prestataires vérifiés de la plateforme et par les administrateurs, et elles sont supprimées immédiatement lorsque le parent supprime son compte.\n\n' +
      'Les prestataires des applications Sync sont eux-mêmes des élèves de l\'EJM, et la plupart d\'entre eux sont mineurs. Deux règles s\'appliquent :\n\n' +
      '- Un élève qui s\'inscrit de sa propre initiative doit avoir au moins 15 ans. Il s\'agit de l\'âge du consentement numérique en droit français (article 8 du RGPD, tel que transposé en France) : un élève de 15 ans ou plus crée donc son compte avec son propre consentement, et aucun consentement parental n\'est requis pour lui en droit français.\n' +
      '- Un élève de moins de 15 ans ne peut participer que par l\'intermédiaire d\'un compte supervisé, créé et administré par un parent depuis son propre compte. Dans ce cas, le parent consent pour le compte de l\'élève, et la supervision est enregistrée sur le compte. La supervision peut prendre fin dès que l\'élève a 15 ans ou plus.\n\n' +
      'Il n\'existe pas de limite d\'âge supérieure unique, car les applications diffèrent. Sur Sync/Sit et Sync/Study, la date de naissance d\'un prestataire doit en outre être cohérente avec son année scolaire à l\'EJM : l\'inscription n\'accepte donc en pratique que des élèves de 15 à 18 ans et refuse une date de naissance hors de cette fenêtre ; un administrateur peut accorder une dérogation. Sur Sync/Do, il n\'existe aucune limite supérieure.\n\n' +
      'Sur Sync/Do, certains types de missions exigent en outre que le parent superviseur d\'un élève supervisé approuve la proposition concernée avant que la famille n\'en ait connaissance. L\'approbation, et son auteur, sont enregistrés sur la proposition.',
  },
  {
    titleEn: '10. People Named by Others',
    titleFr: '10. Personnes désignées par des tiers',
    contentEn:
      'On Sync/Do, a student making an offer may declare one helper who would come with them. We record that person\'s first name, last name and age, and we show all three to the family before it accepts.\n\n' +
      'That person has no Sync account, no relationship with us, and no way to use the in-app rights tools described in section 8. They are frequently a minor. We hold their data only because the student entered it, so that the family knows who to expect at their home.\n\n' +
      'What that means in practice:\n\n' +
      '- Their details are stored on the offer only. They are never copied onto the task, so they never appear on the task board.\n' +
      '- Their details are visible to the family that receives the offer, to the student who made it, to that student\'s supervising parent where an approval is required, and to platform administrators — and to no one else.\n' +
      '- Their details are deleted when the offer is deleted: six months after the task is completed, or thirty days after it is cancelled. If a task is assigned but neither side ever closes it, the offer — and these details with it — is kept until someone does, or until the student deletes their account (see section 7).\n' +
      '- A student must not name a helper without that person\'s knowledge and, where the helper is a minor, without their parent\'s agreement.\n\n' +
      'If you have been named as a helper and want to know what we hold about you, or want it erased, contact us at {{supportEmail}} and we will act on your request under section 8.',
    contentFr:
      'Sur Sync/Do, un élève qui fait une proposition peut déclarer un accompagnant qui viendrait avec lui. Nous enregistrons les prénom, nom et âge de cette personne, et nous communiquons ces trois informations à la famille avant qu\'elle n\'accepte.\n\n' +
      'Cette personne n\'a aucun compte Sync, n\'entretient aucune relation avec nous et ne peut pas utiliser les outils intégrés à l\'application décrits à la section 8. Il s\'agit fréquemment d\'un mineur. Nous détenons ses données uniquement parce que l\'élève les a saisies, afin que la famille sache qui se présentera à son domicile.\n\n' +
      'Concrètement :\n\n' +
      '- Ces informations sont stockées uniquement sur la proposition. Elles ne sont jamais recopiées sur la mission et n\'apparaissent donc jamais sur le tableau des missions.\n' +
      '- Elles sont visibles par la famille destinataire de la proposition, par l\'élève qui l\'a formulée, par le parent superviseur de cet élève lorsqu\'une approbation est requise, et par les administrateurs de la plateforme — et par personne d\'autre.\n' +
      '- Elles sont supprimées en même temps que la proposition : six mois après l\'achèvement de la mission, ou trente jours après son annulation. Si une mission est attribuée mais que ni l\'une ni l\'autre des parties ne la clôture, la proposition — et ces informations avec elle — est conservée jusqu\'à ce que quelqu\'un le fasse, ou jusqu\'à ce que l\'élève supprime son compte (voir la section 7).\n' +
      '- Un élève ne doit pas déclarer un accompagnant à l\'insu de celui-ci ni, lorsque l\'accompagnant est mineur, sans l\'accord de son parent.\n\n' +
      'Si vous avez été désigné(e) comme accompagnant et souhaitez savoir ce que nous détenons à votre sujet, ou en demander l\'effacement, contactez-nous à {{supportEmail}} : nous donnerons suite à votre demande au titre de la section 8.',
  },
  {
    titleEn: '11. Security Measures',
    titleFr: '11. Mesures de sécurité',
    contentEn:
      'We implement appropriate technical and organisational measures to protect your personal data, including:\n\n' +
      '- Authentication via Firebase Auth with email-based magic links (no passwords stored)\n' +
      '- All data transmitted over encrypted HTTPS connections (TLS)\n' +
      '- Role-based access control: only administrators can access verification documents and manage accounts\n' +
      '- Firestore security rules restricting data access based on user role and ownership\n' +
      '- Verification requirements: service providers must verify their school affiliation through their @ejm.org email address; families must provide government ID and school enrollment proof before their profiles are published\n' +
      '- Secure file storage via Firebase Cloud Storage with restricted access rules. Photos uploaded to a Sync/Do task are quarantined, re-encoded server-side to remove all embedded metadata (including EXIF location data), and only then published. They are never given a permanent public address: the app reaches them through short-lived links, valid for fifteen minutes, that our servers issue only to someone entitled to see that photo.\n\n' +
      'While we take reasonable steps to protect your data, no system is completely secure. We encourage you to use a secure email provider and to contact us immediately at {{supportEmail}} if you suspect any unauthorised access to your account.',
    contentFr:
      'Nous mettons en oeuvre des mesures techniques et organisationnelles appropriées pour protéger vos données personnelles, notamment :\n\n' +
      '- Authentification via Firebase Auth par liens magiques envoyés par e-mail (aucun mot de passe stocké)\n' +
      '- Toutes les données transmises via des connexions HTTPS chiffrées (TLS)\n' +
      '- Contrôle d\'accès basé sur les rôles : seuls les administrateurs peuvent accéder aux documents de vérification et gérer les comptes\n' +
      '- Règles de sécurité Firestore limitant l\'accès aux données en fonction du rôle et de la propriété de l\'utilisateur\n' +
      '- Exigences de vérification : les prestataires doivent vérifier leur affiliation scolaire par leur adresse e-mail @ejm.org ; les familles doivent fournir une pièce d\'identité officielle et un justificatif de scolarité avant la publication de leur profil\n' +
      '- Stockage sécurisé des fichiers via Firebase Cloud Storage avec des règles d\'accès restreintes. Les photos téléchargées pour une mission Sync/Do sont placées en quarantaine, réencodées côté serveur afin de supprimer toutes les métadonnées intégrées (y compris les données de géolocalisation EXIF), puis seulement publiées. Elles ne reçoivent jamais d\'adresse publique permanente : l\'application y accède par des liens de courte durée, valables quinze minutes, que nos serveurs ne délivrent qu\'à une personne habilitée à voir la photo concernée.\n\n' +
      'Bien que nous prenions des mesures raisonnables pour protéger vos données, aucun système n\'est totalement infaillible. Nous vous encourageons à utiliser un fournisseur de messagerie sécurisé et à nous contacter immédiatement à {{supportEmail}} si vous soupçonnez un accès non autorisé à votre compte.',
  },
  {
    titleEn: '12. Cookies and Local Storage',
    titleFr: '12. Cookies et stockage local',
    contentEn:
      '{{brand}} does not use cookies.\n\n' +
      'We use browser local storage (localStorage) exclusively for the following purposes:\n' +
      '- Storing your language preference (English or French)\n' +
      '- Storing a limited error log for troubleshooting (recent client-side errors, automatically cleared)\n\n' +
      'This data remains on your device and is not transmitted to our servers. Firebase Auth may use local storage or IndexedDB to maintain your authentication session; this is managed by Firebase and is necessary for the service to function.',
    contentFr:
      '{{brand}} n\'utilise pas de cookies.\n\n' +
      'Nous utilisons le stockage local du navigateur (localStorage) exclusivement aux fins suivantes :\n' +
      '- Stockage de votre préférence linguistique (anglais ou français)\n' +
      '- Stockage d\'un journal d\'erreurs limité pour le dépannage (erreurs récentes côté client, automatiquement effacé)\n\n' +
      'Ces données restent sur votre appareil et ne sont pas transmises à nos serveurs. Firebase Auth peut utiliser le stockage local ou IndexedDB pour maintenir votre session d\'authentification ; cela est géré par Firebase et est nécessaire au fonctionnement du service.',
  },
  {
    titleEn: '13. Community Verification',
    titleFr: '13. Vérification communautaire',
    contentEn:
      '{{brand}} includes a community verification feature that allows verified members to vouch for other users they know personally. When a member vouches for another user:\n\n' +
      '- The vouching member\'s name is recorded and may be visible to administrators\n' +
      '- The fact that a user has been vouched for (and the number of vouches) may be visible on their profile\n' +
      '- The identity of the vouching member is not disclosed to other regular users\n\n' +
      'Community vouching is voluntary. By vouching for another user, you confirm that you know them personally and believe they are a trustworthy member of the EJM community.',
    contentFr:
      '{{brand}} inclut une fonctionnalité de vérification communautaire qui permet aux membres vérifiés de se porter garants d\'autres utilisateurs qu\'ils connaissent personnellement. Lorsqu\'un membre se porte garant d\'un autre utilisateur :\n\n' +
      '- Le nom du membre garant est enregistré et peut être visible par les administrateurs\n' +
      '- Le fait qu\'un utilisateur ait été parrainé (et le nombre de parrainages) peut être visible sur son profil\n' +
      '- L\'identité du membre garant n\'est pas divulguée aux autres utilisateurs ordinaires\n\n' +
      'Le parrainage communautaire est volontaire. En vous portant garant d\'un autre utilisateur, vous confirmez que vous le connaissez personnellement et que vous le considérez comme un membre digne de confiance de la communauté EJM.',
  },
  {
    titleEn: '14. Verification Documents',
    titleFr: '14. Documents de vérification',
    contentEn:
      'Families are required to submit identity documents (government-issued ID scan) and school enrollment certificates as part of the verification process. Service providers — babysitters, tutors and doers alike — verify their school affiliation through their @ejm.org email address and do not submit identity documents. Family verification documents are:\n\n' +
      '- Uploaded securely to Firebase Cloud Storage with restricted access\n' +
      '- Accessible only to platform administrators for the purpose of identity and enrollment verification\n' +
      '- Not shared with other users or third parties\n' +
      '- Permanently deleted when the family\'s account is deleted\n\n' +
      'Administrators review these documents solely to confirm that families are part of the EJM community and that their identity matches their profile information.',
    contentFr:
      'Les familles doivent soumettre des documents d\'identité (copie d\'une pièce d\'identité officielle) et des certificats de scolarité dans le cadre du processus de vérification. Les prestataires — babysitters, tuteurs et « doers » — vérifient leur affiliation scolaire par leur adresse e-mail @ejm.org et ne soumettent pas de documents d\'identité. Les documents de vérification des familles sont :\n\n' +
      '- Téléchargés de manière sécurisée sur Firebase Cloud Storage avec un accès restreint\n' +
      '- Accessibles uniquement aux administrateurs de la plateforme à des fins de vérification d\'identité et de scolarité\n' +
      '- Non partagés avec d\'autres utilisateurs ou des tiers\n' +
      '- Définitivement supprimés lors de la suppression du compte de la famille\n\n' +
      'Les administrateurs examinent ces documents uniquement pour confirmer que les familles font partie de la communauté EJM et que leur identité correspond aux informations de leur profil.',
  },
  {
    titleEn: '15. Changes to This Policy',
    titleFr: '15. Modifications de la présente politique',
    contentEn:
      'We may update this privacy policy from time to time to reflect changes to our practices or for legal, regulatory, or operational reasons. When we make material changes, we will notify you through the app.\n\n' +
      'The "Last updated" date at the top of this policy indicates when the most recent revision was made. We encourage you to review this policy periodically.\n\n' +
      'Your continued use of {{brand}} after any changes to this policy constitutes your acceptance of the updated terms.',
    contentFr:
      'Nous pouvons mettre à jour la présente politique de confidentialité de temps à autre pour refléter des changements dans nos pratiques ou pour des raisons juridiques, réglementaires ou opérationnelles. En cas de modification substantielle, nous vous en informerons via l\'application.\n\n' +
      'La date de « Dernière mise à jour » en haut de cette politique indique la date de la révision la plus récente. Nous vous encourageons à consulter régulièrement cette politique.\n\n' +
      'Votre utilisation continue de {{brand}} après toute modification de la présente politique vaut acceptation des conditions mises à jour.',
  },
  {
    titleEn: '16. Contact',
    titleFr: '16. Contact',
    contentEn:
      'For any questions about this privacy policy, or to exercise your data protection rights, please contact us at:\n\n' +
      'Email: {{supportEmail}}\n\n' +
      'You also have the right to lodge a complaint with the CNIL:\n' +
      'Commission Nationale de l\'Informatique et des Libertés\n' +
      '3 Place de Fontenoy, TSA 80715\n' +
      '75334 Paris Cedex 07\n' +
      'www.cnil.fr',
    contentFr:
      'Pour toute question relative à la présente politique de confidentialité, ou pour exercer vos droits en matière de protection des données, veuillez nous contacter à :\n\n' +
      'E-mail : {{supportEmail}}\n\n' +
      'Vous disposez également du droit d\'introduire une réclamation auprès de la CNIL :\n' +
      'Commission Nationale de l\'Informatique et des Libertés\n' +
      '3 Place de Fontenoy, TSA 80715\n' +
      '75334 Paris Cedex 07\n' +
      'www.cnil.fr',
  },
];

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export function PrivacyPage({ brand, supportEmail }: PrivacyPageProps) {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language?.startsWith('fr');
  const vars = { brand, supportEmail };

  return (
    <div>
      <TopNav title={t('menu.privacyPolicy')} backTo="back" />
      <div className="px-6 pt-4 pb-8">
        <h2 className="mb-2 text-xl font-bold">
          {isFr ? 'Politique de confidentialité' : 'Privacy Policy'}
        </h2>
        <p className="mb-6 text-xs text-gray-500">
          {isFr ? 'Dernière mise à jour : 29 août 2026' : 'Last updated: August 29, 2026'}
        </p>

        <div className="space-y-6">
          {sections.map((section, idx) => (
            <div key={idx}>
              <h3 className="mb-2 text-sm font-semibold text-gray-800">
                {isFr ? section.titleFr : section.titleEn}
              </h3>
              <div className="whitespace-pre-line text-sm leading-relaxed text-gray-600">
                {interpolate(isFr ? section.contentFr : section.contentEn, vars)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
