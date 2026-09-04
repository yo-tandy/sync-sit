import { useTranslation } from 'react-i18next';
import { TopNav } from '../components/TopNav.js';

interface TermsPageProps {
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
    titleEn: '1. Acceptance of Terms',
    titleFr: '1. Acceptation des conditions',
    contentEn:
      'By creating an account on {{brand}} or using the platform in any way, you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree with any part of these terms, you must not use the platform.\n\n' +
      'These terms constitute a legally binding agreement between you and Tandy SARL, the operator of {{brand}}, based in Paris, France. Please read them carefully before using the service.',
    contentFr:
      'En créant un compte sur {{brand}} ou en utilisant la plateforme de quelque manière que ce soit, vous acceptez d\'être lié(e) par les présentes Conditions Générales d\'Utilisation et notre Politique de confidentialité. Si vous n\'acceptez pas tout ou partie de ces conditions, vous ne devez pas utiliser la plateforme.\n\n' +
      'Les présentes conditions constituent un accord juridiquement contraignant entre vous et Tandy SARL, l\'exploitant de {{brand}}, basée à Paris, France. Veuillez les lire attentivement avant d\'utiliser le service.',
  },
  {
    titleEn: '2. Description of Service',
    titleFr: '2. Description du service',
    contentEn:
      '{{brand}} is one of the Sync apps: a set of non-commercial platforms that connect families of the École Jeannine Manuel (EJM) community in Paris with EJM student service providers. The Sync apps are:\n\n' +
      '- Sync/Sit — babysitting\n' +
      '- Sync/Study — tutoring\n' +
      '- Sync/Do — help with everyday tasks: gardening and plant care; packing, moving and clearing boxes; flat-pack furniture assembly; help at parties; IT and device help; errands; and pet care and house checks (no overnight stays)\n\n' +
      'The three apps share one Sync account, one family verification, and these single Terms of Service. Accepting them on any one app means accepting them for all three.\n\n' +
      'The platform provides the following features:\n' +
      '- Profile creation for families and service providers\n' +
      '- School affiliation verification for families and service providers\n' +
      '- Proximity-based search for service providers, and a way for families to publish what they are looking for\n' +
      '- Scheduling and management of appointments, tutoring sessions and tasks\n' +
      '- In-app communication via notifications\n' +
      '- Community verification through peer vouching\n' +
      '- Parental supervision of a student\'s account, where the student has a supervised account\n\n' +
      '{{brand}} is a facilitator only. It introduces families to service providers and then gets out of the way: it does not employ, supervise, direct, or manage any service provider, and it takes no part in the work that follows. Section 8 sets this out in full.',
    contentFr:
      '{{brand}} fait partie des applications Sync : un ensemble de plateformes non commerciales qui mettent en relation les familles de la communauté de l\'École Jeannine Manuel (EJM) à Paris avec des élèves de l\'EJM proposant leurs services. Les applications Sync sont :\n\n' +
      '- Sync/Sit — garde d\'enfants\n' +
      '- Sync/Study — soutien scolaire\n' +
      '- Sync/Do — coups de main du quotidien : jardinage et entretien des plantes ; emballage, déménagement et débarras de cartons ; montage de meubles en kit ; aide lors de fêtes ; assistance informatique ; courses ; et garde d\'animaux et visites à domicile (sans hébergement de nuit)\n\n' +
      'Les trois applications partagent un même compte Sync, une même vérification des familles et les présentes Conditions Générales d\'Utilisation uniques. Les accepter sur l\'une des applications vaut acceptation pour les trois.\n\n' +
      'La plateforme offre les fonctionnalités suivantes :\n' +
      '- Création de profils pour les familles et les prestataires\n' +
      '- Vérification de l\'affiliation scolaire des familles et des prestataires\n' +
      '- Recherche de prestataires par proximité géographique, et possibilité pour les familles de publier ce qu\'elles recherchent\n' +
      '- Gestion des disponibilités, des rendez-vous, des séances de soutien scolaire et des missions\n' +
      '- Communication via notifications dans l\'application\n' +
      '- Vérification communautaire par parrainage entre pairs\n' +
      '- Supervision parentale du compte d\'un élève, lorsque celui-ci dispose d\'un compte supervisé\n\n' +
      '{{brand}} agit uniquement en tant qu\'intermédiaire. La plateforme présente les familles aux prestataires puis se retire : elle n\'emploie, ne supervise, ne dirige et ne gère aucun prestataire, et ne prend aucune part au travail qui s\'ensuit. La section 8 expose ce principe en détail.',
  },
  {
    titleEn: '3. Eligibility',
    titleFr: '3. Conditions d\'éligibilité',
    contentEn:
      'To use {{brand}}, you must meet the following eligibility requirements:\n\n' +
      'Parents:\n' +
      '- Must be a parent or legal guardian within the EJM community\n' +
      '- Must provide a valid email address for verification\n' +
      '- Must complete the identity verification process before searching for a service provider or publishing a request or task\n\n' +
      'Service providers (babysitters, tutors and doers):\n' +
      '- Must be a currently enrolled student at École Jeannine Manuel, unless we have specifically approved their email address in advance\n' +
      '- Must verify their school affiliation through their EJM school email address (@ejm.org), unless we have pre-approved a different address\n' +
      '- Must be at least 15 years of age to sign up on their own; a younger student may take part only through a supervised account, created and governed by their parent from the parent\'s own account\n' +
      '- Must have a date of birth that stays consistent with their EJM school year on all three apps — in practice, aged 15 to 18 — for the account to be usable: Sync/Study and Sync/Do both refuse the enrollment outright, while Sync/Sit accepts it and stops showing the provider to families instead. An administrator may grant an exemption on any of the three apps.\n\n' +
      'In accordance with French law (Article 8 of the GDPR, as implemented in France), individuals aged 15 and over may consent to the processing of their personal data. A service provider aged 15 or over therefore creates their account with their own consent. For a supervised account, the supervising parent consents on the student\'s behalf, and supervision may be ended once the student is 15 or older.',
    contentFr:
      'Pour utiliser {{brand}}, vous devez remplir les conditions d\'éligibilité suivantes :\n\n' +
      'Parents :\n' +
      '- Être parent ou représentant légal au sein de la communauté EJM\n' +
      '- Fournir une adresse e-mail valide pour la vérification\n' +
      '- Compléter le processus de vérification d\'identité avant de rechercher un prestataire ou de publier une demande ou une mission\n\n' +
      'Prestataires (babysitters, tuteurs et « doers ») :\n' +
      '- Être un(e) élève actuellement inscrit(e) à l\'École Jeannine Manuel, sauf si nous avons expressément approuvé son adresse e-mail au préalable\n' +
      '- Vérifier son affiliation scolaire par son adresse e-mail scolaire EJM (@ejm.org), sauf si nous avons approuvé au préalable une autre adresse\n' +
      '- Être âgé(e) d\'au moins 15 ans pour s\'inscrire de sa propre initiative ; un élève plus jeune ne peut participer que par l\'intermédiaire d\'un compte supervisé, créé et administré par son parent depuis le compte de ce dernier\n' +
      '- Avoir, sur les trois applications, une date de naissance qui reste cohérente avec son année scolaire à l\'EJM — en pratique, être âgé(e) de 15 à 18 ans — pour que le compte soit utilisable : Sync/Study et Sync/Do refusent tous deux purement et simplement l\'inscription, tandis que Sync/Sit l\'accepte mais cesse de présenter le prestataire aux familles. Un administrateur peut accorder une dérogation sur l\'une quelconque des trois applications.\n\n' +
      'Conformément au droit français (article 8 du RGPD, tel que transposé en France), les personnes âgées de 15 ans et plus peuvent consentir au traitement de leurs données personnelles. Un prestataire de 15 ans ou plus crée donc son compte avec son propre consentement. Pour un compte supervisé, le parent superviseur consent pour le compte de l\'élève, et la supervision peut prendre fin dès que l\'élève a 15 ans ou plus.',
  },
  {
    titleEn: '4. Account Creation and Verification',
    titleFr: '4. Création de compte et vérification',
    contentEn:
      'All users must create an account to access {{brand}}. Account creation requires:\n\n' +
      '- Providing accurate and complete personal information\n' +
      '- Verifying your email address through a magic link sent to your email\n' +
      '- For service providers: verifying their school affiliation through their @ejm.org email address, or a pre-approved address\n' +
      '- For parents: completing the parent verification process\n\n' +
      'You are responsible for maintaining the security of your account. You must not share your authentication links with anyone. You must notify us immediately at {{supportEmail}} if you suspect unauthorised access to your account.\n\n' +
      'We reserve the right to refuse, suspend, or terminate any account that fails verification or provides false information.',
    contentFr:
      'Tous les utilisateurs doivent créer un compte pour accéder à {{brand}}. La création de compte nécessite :\n\n' +
      '- La fourniture d\'informations personnelles exactes et complètes\n' +
      '- La vérification de votre adresse e-mail via un lien magique envoyé à votre adresse\n' +
      '- Pour les prestataires : la vérification de leur affiliation scolaire par leur adresse e-mail @ejm.org, ou par une adresse pré-approuvée\n' +
      '- Pour les parents : la réalisation du processus de vérification parentale\n\n' +
      'Vous êtes responsable de la sécurité de votre compte. Vous ne devez en aucun cas partager vos liens d\'authentification. Vous devez nous notifier immédiatement à {{supportEmail}} si vous soupçonnez un accès non autorisé à votre compte.\n\n' +
      'Nous nous réservons le droit de refuser, suspendre ou résilier tout compte qui échoue à la vérification ou fournit de fausses informations.',
  },
  {
    titleEn: '5. User Responsibilities',
    titleFr: '5. Responsabilités des utilisateurs',
    contentEn:
      'All users of {{brand}} agree to:\n\n' +
      '- Provide accurate, current, and complete information in their profile\n' +
      '- Update their information promptly if it changes\n' +
      '- Treat all other users with respect and courtesy\n' +
      '- Use the platform only for its intended purpose of arranging the services described in section 2 within the EJM community\n' +
      '- Not use the platform for any commercial, fraudulent, or illegal purpose\n' +
      '- Not harass, threaten, or intimidate other users\n' +
      '- Comply with all applicable laws and regulations, including French law on childcare, on animal welfare, and on the occasional work of minors',
    contentFr:
      'Tous les utilisateurs de {{brand}} s\'engagent à :\n\n' +
      '- Fournir des informations exactes, à jour et complètes dans leur profil\n' +
      '- Mettre à jour leurs informations dans les meilleurs délais en cas de changement\n' +
      '- Traiter tous les autres utilisateurs avec respect et courtoisie\n' +
      '- Utiliser la plateforme uniquement aux fins prévues d\'organisation des services décrits à la section 2 au sein de la communauté EJM\n' +
      '- Ne pas utiliser la plateforme à des fins commerciales, frauduleuses ou illégales\n' +
      '- Ne pas harceler, menacer ou intimider d\'autres utilisateurs\n' +
      '- Respecter toutes les lois et réglementations applicables, y compris le droit français relatif à la garde d\'enfants, au bien-être animal et au travail occasionnel des mineurs',
  },
  {
    titleEn: '6. Service Provider Responsibilities',
    titleFr: '6. Responsabilités des prestataires',
    contentEn:
      'Service providers using {{brand}} agree to:\n\n' +
      '- Be reliable and honour confirmed appointments, sessions and tasks\n' +
      '- Inform families promptly if they need to cancel or reschedule\n' +
      '- Only accept work they can carry out safely and competently, and say so before accepting if they cannot\n' +
      '- Behave appropriately and responsibly, and take care of the family\'s home, belongings and animals\n' +
      '- When caring for children: maintain their safety and well-being at all times\n' +
      '- Not consume alcohol, drugs, or any impairing substance before or during any engagement\n' +
      '- Contact the family and, if necessary, emergency services immediately in case of any incident\n' +
      '- Keep all personal information about families, children and their homes confidential — including anything seen while helping with a device, an account or a household task\n' +
      '- Accurately represent their availability, experience and qualifications\n' +
      '- Where the student has a supervised account, obtain their supervising parent\'s approval where the platform requires it before an offer reaches the family\n\n' +
      'On Sync/Do, a student may declare one helper who would come with them. A student who does so agrees to name that helper only with the helper\'s knowledge and, if the helper is a minor, with their parent\'s agreement; to give their real first name, last name and age; and to remain personally responsible for the task and for the helper\'s conduct. The helper is not a verified Sync member, has no account, and has no relationship with {{brand}}.',
    contentFr:
      'Les prestataires utilisant {{brand}} s\'engagent à :\n\n' +
      '- Être fiables et honorer les rendez-vous, séances et missions confirmés\n' +
      '- Informer les familles dans les meilleurs délais en cas d\'annulation ou de report nécessaire\n' +
      '- N\'accepter que des travaux qu\'ils peuvent réaliser en sécurité et avec compétence, et le signaler avant d\'accepter si ce n\'est pas le cas\n' +
      '- Se comporter de manière appropriée et responsable, et prendre soin du logement, des biens et des animaux de la famille\n' +
      '- Lorsqu\'ils gardent des enfants : assurer en permanence leur sécurité et leur bien-être\n' +
      '- Ne pas consommer d\'alcool, de drogues ou de toute substance altérant les capacités avant ou pendant une intervention\n' +
      '- Contacter la famille et, si nécessaire, les services d\'urgence immédiatement en cas d\'incident\n' +
      '- Garder confidentielles toutes les informations personnelles concernant les familles, les enfants et leur logement — y compris tout ce qui est vu à l\'occasion d\'une aide sur un appareil, un compte ou une tâche domestique\n' +
      '- Représenter fidèlement leurs disponibilités, leur expérience et leurs compétences\n' +
      '- Lorsque l\'élève dispose d\'un compte supervisé, obtenir l\'approbation de son parent superviseur, lorsque la plateforme l\'exige, avant que sa proposition ne parvienne à la famille\n\n' +
      'Sur Sync/Do, un élève peut déclarer un accompagnant qui viendrait avec lui. L\'élève qui le fait s\'engage à ne désigner cet accompagnant qu\'avec la connaissance de ce dernier et, s\'il est mineur, avec l\'accord de son parent ; à indiquer ses véritables prénom, nom et âge ; et à demeurer personnellement responsable de la mission ainsi que du comportement de l\'accompagnant. L\'accompagnant n\'est pas un membre Sync vérifié, ne dispose d\'aucun compte et n\'entretient aucune relation avec {{brand}}.',
  },
  {
    titleEn: '7. Family Responsibilities',
    titleFr: '7. Responsabilités des familles',
    contentEn:
      'Families using {{brand}} agree to:\n\n' +
      '- Describe accurately and completely what they are asking for, including anything that makes it harder, heavier, longer or riskier than it looks\n' +
      '- Provide accurate information about their children (names, ages, languages, any special needs or instructions), and about any animal a service provider would be looking after\n' +
      '- Clearly communicate expectations, house rules, and emergency procedures before each appointment, session or task\n' +
      '- Ensure the service provider has all necessary contact numbers and instructions\n' +
      '- Be reachable by phone for the duration of the engagement\n' +
      '- Return home at the agreed-upon time or communicate any delays promptly, where the engagement requires them to be away\n' +
      '- Pay the service provider directly and promptly as agreed between the parties\n' +
      '- Complete the verification process to help maintain community trust\n' +
      '- Hold their own insurance covering people working at their home, and resolve any damage, loss or injury directly, as set out in section 8\n' +
      '- Not ask a student to do anything unsafe, unlawful, or beyond what they agreed to — including work at height, work with power tools or hazardous substances, driving on the family\'s behalf, or handling the family\'s money or payment cards beyond what was agreed in writing\n' +
      '- Treat service providers with respect, keeping in mind that they are students and, in most cases, minors',
    contentFr:
      'Les familles utilisant {{brand}} s\'engagent à :\n\n' +
      '- Décrire de manière exacte et complète ce qu\'elles demandent, y compris tout ce qui rend la tâche plus difficile, plus lourde, plus longue ou plus risquée qu\'il n\'y paraît\n' +
      '- Fournir des informations exactes concernant leurs enfants (prénoms, âges, langues, besoins particuliers ou instructions spécifiques) et concernant tout animal dont un prestataire aurait la charge\n' +
      '- Communiquer clairement les attentes, les règles de la maison et les procédures d\'urgence avant chaque rendez-vous, séance ou mission\n' +
      '- S\'assurer que le prestataire dispose de tous les numéros de téléphone et instructions nécessaires\n' +
      '- Rester joignables par téléphone pendant toute la durée de l\'intervention\n' +
      '- Rentrer à l\'heure convenue ou communiquer tout retard dans les meilleurs délais, lorsque l\'intervention suppose leur absence\n' +
      '- Rémunérer le prestataire directement et sans délai selon les modalités convenues entre les parties\n' +
      '- Compléter le processus de vérification afin de contribuer à la confiance au sein de la communauté\n' +
      '- Disposer de leur propre assurance couvrant les personnes intervenant à leur domicile, et régler directement tout dommage, perte ou préjudice, comme indiqué à la section 8\n' +
      '- Ne pas demander à un élève d\'accomplir quoi que ce soit de dangereux, d\'illégal ou dépassant ce qui a été convenu — notamment le travail en hauteur, l\'utilisation d\'outils électroportatifs ou de substances dangereuses, la conduite pour le compte de la famille, ou la manipulation de l\'argent ou des cartes de paiement de la famille au-delà de ce qui a été convenu par écrit\n' +
      '- Traiter les prestataires avec respect, en gardant à l\'esprit qu\'il s\'agit d\'élèves et, dans la plupart des cas, de mineurs',
  },
  {
    titleEn: '8. Platform Role and Limitation of Liability',
    titleFr: '8. Rôle de la plateforme et limitation de responsabilité',
    contentEn:
      '{{brand}} performs the introduction, and nothing else. It brings a family and a student service provider together within the EJM community and then steps aside. Everything that happens afterwards — the babysitting, the tutoring, the task, the payment, and any problem arising from any of them — is between the family and the service provider.\n\n' +
      '{{brand}}:\n\n' +
      '- Is not an employer, agency, staffing business, or contractor of any service provider, and no employment relationship arises between {{brand}} and any user\n' +
      '- Does not supervise, direct, schedule, instruct, or control any babysitting, tutoring, or task work\n' +
      '- Does not guarantee the quality, safety, timeliness, or outcome of any engagement arranged through the platform\n' +
      '- Does not participate in, hold, process, or mediate any payment between users\n' +
      '- Does not verify the suitability of any service provider for any particular child, family, home, animal, device, or task, and does not assess whether a student is competent to carry out a given piece of work\n' +
      '- Does not insure any user, any home, any belongings, any animal, or any service provider, and holds no insurance for the benefit of users\n' +
      '- Provides no damage-claim process, dispute queue, or mediation service, and does not adjudicate between users. This is deliberate: building one would imply a responsibility {{brand}} does not accept. Administrators can show the two parties the record of what was agreed, and that is the limit of what they will do.\n\n' +
      'The engagement is exclusively between the family and the service provider. Families are responsible for interviewing, selecting, briefing, and supervising the service providers they choose, for judging whether a student is up to the work, and for the safety of their own home and premises.\n\n' +
      'Insurance is the family\'s responsibility. A family that invites a service provider into its home should hold insurance covering accidental injury to that person and damage to property, exactly as it should for anyone working at its home. If something is damaged, lost, or broken, or if anyone is injured, the family and the service provider resolve it directly between themselves, through their own insurers where applicable. {{brand}} is not a party to that and will not arbitrate it.\n\n' +
      'To the maximum extent permitted by applicable law, including Articles 1240 and following of the French Civil Code, {{brand}} and its operator shall not be held liable for:\n' +
      '- Any damage, injury, loss, theft, or harm arising from any engagement arranged through the platform, whether to a person, a child, an animal, a home, or any property\n' +
      '- The conduct, actions, or omissions of any user, whether family or service provider, and of any helper a service provider brings with them\n' +
      '- The accuracy or completeness of information provided by users, including the description of a task and the experience a service provider claims\n' +
      '- Any agreement reached between users, including the price, the scope of the work, and the handling of money or expenses\n' +
      '- Service interruptions, technical errors, or data loss\n\n' +
      'Nothing in these terms excludes or limits liability for death or personal injury caused by negligence, fraud, or any other liability that cannot be excluded or limited under French law. Nothing in these terms displaces any protection a consumer or a minor enjoys under French law that the parties cannot contract out of.',
    contentFr:
      '{{brand}} assure la mise en relation, et rien d\'autre. La plateforme réunit une famille et un élève prestataire au sein de la communauté EJM, puis s\'efface. Tout ce qui se produit ensuite — la garde d\'enfants, le soutien scolaire, la mission, le paiement, ainsi que tout problème en découlant — relève exclusivement de la famille et du prestataire.\n\n' +
      '{{brand}} :\n\n' +
      '- N\'est ni l\'employeur, ni l\'agence, ni une entreprise de mise à disposition de personnel, ni le prestataire d\'aucun intervenant, et aucune relation de travail ne naît entre {{brand}} et un utilisateur\n' +
      '- Ne supervise, ne dirige, ne planifie, n\'encadre et ne contrôle aucune garde d\'enfants, aucun soutien scolaire et aucune mission\n' +
      '- Ne garantit ni la qualité, ni la sécurité, ni la ponctualité, ni le résultat d\'une intervention organisée via la plateforme\n' +
      '- Ne participe à aucun paiement entre utilisateurs, n\'en détient, n\'en traite et n\'en assure la médiation d\'aucun\n' +
      '- Ne vérifie l\'adéquation d\'aucun prestataire pour un enfant, une famille, un logement, un animal, un appareil ou une mission en particulier, et n\'évalue pas si un élève est compétent pour réaliser un travail donné\n' +
      '- N\'assure ni les utilisateurs, ni les logements, ni les biens, ni les animaux, ni les prestataires, et ne détient aucune assurance au bénéfice des utilisateurs\n' +
      '- N\'offre aucune procédure de réclamation, aucun service de traitement des litiges et aucune médiation, et ne tranche pas entre utilisateurs. Ce choix est délibéré : mettre en place un tel dispositif reviendrait à endosser une responsabilité que {{brand}} n\'accepte pas. Les administrateurs peuvent présenter aux deux parties l\'enregistrement de ce qui avait été convenu ; c\'est la limite de leur intervention.\n\n' +
      'L\'intervention est exclusivement établie entre la famille et le prestataire. Les familles sont responsables de l\'entretien, de la sélection, de l\'information et de la supervision des prestataires qu\'elles choisissent, de l\'appréciation de la capacité d\'un élève à effectuer le travail, ainsi que de la sécurité de leur propre domicile et de leurs locaux.\n\n' +
      'L\'assurance incombe à la famille. Une famille qui accueille un prestataire à son domicile doit disposer d\'une assurance couvrant les dommages corporels accidentels causés à cette personne ainsi que les dommages matériels, exactement comme elle le devrait pour toute personne intervenant chez elle. En cas de dommage, de perte, de casse ou de blessure, la famille et le prestataire règlent la situation directement entre eux, le cas échéant par l\'intermédiaire de leurs assureurs respectifs. {{brand}} n\'y est pas partie et ne l\'arbitrera pas.\n\n' +
      'Dans la limite maximale autorisée par le droit applicable, y compris les articles 1240 et suivants du Code civil français, {{brand}} et son exploitant ne sauraient être tenus responsables :\n' +
      '- De tout dommage, blessure, perte, vol ou préjudice résultant d\'une intervention organisée via la plateforme, qu\'il concerne une personne, un enfant, un animal, un logement ou tout bien\n' +
      '- Du comportement, des actes ou des omissions de tout utilisateur, qu\'il s\'agisse d\'une famille ou d\'un prestataire, ainsi que de tout accompagnant qu\'un prestataire amène avec lui\n' +
      '- De l\'exactitude ou de l\'exhaustivité des informations fournies par les utilisateurs, y compris la description d\'une mission et l\'expérience dont se prévaut un prestataire\n' +
      '- De tout accord conclu entre utilisateurs, y compris le prix, l\'étendue du travail et la gestion de l\'argent ou des frais\n' +
      '- Des interruptions de service, erreurs techniques ou pertes de données\n\n' +
      'Rien dans les présentes conditions n\'exclut ou ne limite la responsabilité en cas de décès ou de dommage corporel causé par une négligence, une fraude, ou toute autre responsabilité qui ne peut être exclue ou limitée en vertu du droit français. Rien dans les présentes conditions n\'écarte les protections dont bénéficient un consommateur ou un mineur en droit français et auxquelles les parties ne peuvent renoncer.',
  },
  {
    titleEn: '9. Payment',
    titleFr: '9. Rémunération',
    contentEn:
      '{{brand}} is a free, non-commercial platform. It does not charge any fees, commissions, or subscriptions.\n\n' +
      'Payment for any service is arranged and made directly between the family and the service provider. {{brand}} does not process, hold, facilitate, or mediate any financial transaction.\n\n' +
      'Families and service providers are solely responsible for agreeing on compensation, payment method, and timing. Where a task involves the family\'s money — buying something on the family\'s behalf, or being reimbursed for an expense — that arrangement is theirs alone to agree, in writing, before the work starts. {{brand}} has no visibility into these arrangements, mediates no dispute about them, and accepts no liability for them.\n\n' +
      'Users are responsible for complying with all applicable tax, social-security and employment regulations, including French rules on the occasional work of minors.',
    contentFr:
      '{{brand}} est une plateforme gratuite et non commerciale. Elle ne facture aucun frais, commission ou abonnement.\n\n' +
      'La rémunération de tout service est convenue et versée directement entre la famille et le prestataire. {{brand}} ne traite, ne détient, ne facilite et n\'assure la médiation d\'aucune transaction financière.\n\n' +
      'Les familles et les prestataires sont seuls responsables de convenir de la rémunération, du mode de paiement et des délais. Lorsqu\'une mission implique l\'argent de la famille — un achat effectué pour son compte ou le remboursement d\'une dépense — cet arrangement leur appartient exclusivement et doit être convenu par écrit avant le début du travail. {{brand}} n\'a aucune visibilité sur ces arrangements, n\'assure la médiation d\'aucun litige à leur sujet et n\'accepte aucune responsabilité à leur égard.\n\n' +
      'Les utilisateurs sont responsables du respect de toutes les réglementations fiscales, sociales et du travail applicables, y compris les règles françaises relatives au travail occasionnel des mineurs.',
  },
  {
    titleEn: '10. Prohibited Uses',
    titleFr: '10. Utilisations interdites',
    contentEn:
      'The following uses of {{brand}} are strictly prohibited:\n\n' +
      '- Creating a fake or misleading profile\n' +
      '- Impersonating another person or providing false identity documents\n' +
      '- Using the platform for any purpose other than arranging the services described in section 2 within the EJM community\n' +
      '- Soliciting users for commercial services, advertising, or spam\n' +
      '- Attempting to circumvent the verification process\n' +
      '- Harassing, bullying, or threatening any user\n' +
      '- Collecting or storing personal data of other users outside the platform\n' +
      '- Attempting to access the accounts of other users or the platform\'s administrative functions\n' +
      '- Using automated tools (bots, scrapers) to access the platform\n' +
      '- Any activity that violates applicable French or European law',
    contentFr:
      'Les utilisations suivantes de {{brand}} sont strictement interdites :\n\n' +
      '- Créer un profil faux ou trompeur\n' +
      '- Usurper l\'identité d\'une autre personne ou fournir de faux documents d\'identité\n' +
      '- Utiliser la plateforme à toute fin autre que l\'organisation des services décrits à la section 2 au sein de la communauté EJM\n' +
      '- Solliciter des utilisateurs à des fins commerciales, publicitaires ou de spam\n' +
      '- Tenter de contourner le processus de vérification\n' +
      '- Harceler, intimider ou menacer tout utilisateur\n' +
      '- Collecter ou stocker des données personnelles d\'autres utilisateurs en dehors de la plateforme\n' +
      '- Tenter d\'accéder aux comptes d\'autres utilisateurs ou aux fonctions administratives de la plateforme\n' +
      '- Utiliser des outils automatisés (robots, scrapers) pour accéder à la plateforme\n' +
      '- Toute activité contraire au droit français ou européen applicable',
  },
  {
    titleEn: '11. Community Verification Obligations',
    titleFr: '11. Obligations relatives à la vérification communautaire',
    contentEn:
      '{{brand}} offers a community verification feature allowing verified members to vouch for other users. When you vouch for another user, you:\n\n' +
      '- Confirm that you personally know the individual\n' +
      '- Attest to your genuine belief that they are a trustworthy member of the EJM community\n' +
      '- Accept that your name may be recorded and visible to administrators in connection with the vouching\n\n' +
      'Vouching must be honest and made in good faith. Providing false vouches or vouching for individuals you do not know personally is a violation of these terms and may result in account suspension or termination.\n\n' +
      'Community verification is an additional trust signal and does not replace the platform\'s formal identity and school verification process.',
    contentFr:
      '{{brand}} propose une fonctionnalité de vérification communautaire permettant aux membres vérifiés de se porter garants d\'autres utilisateurs. Lorsque vous vous portez garant d\'un autre utilisateur, vous :\n\n' +
      '- Confirmez que vous connaissez personnellement cette personne\n' +
      '- Attestez de votre conviction sincère qu\'il s\'agit d\'un membre digne de confiance de la communauté EJM\n' +
      '- Acceptez que votre nom puisse être enregistré et visible par les administrateurs dans le cadre du parrainage\n\n' +
      'Le parrainage doit être honnête et effectué de bonne foi. Fournir de faux parrainages ou se porter garant de personnes que vous ne connaissez pas personnellement constitue une violation des présentes conditions et peut entraîner la suspension ou la résiliation de votre compte.\n\n' +
      'La vérification communautaire est un indicateur de confiance supplémentaire et ne remplace pas le processus formel de vérification d\'identité et de scolarité de la plateforme.',
  },
  {
    titleEn: '12. Account Suspension and Termination',
    titleFr: '12. Suspension et résiliation de compte',
    contentEn:
      'We reserve the right to suspend or terminate your account at our discretion if:\n\n' +
      '- You violate any provision of these Terms of Service\n' +
      '- You provide false or misleading information\n' +
      '- You engage in conduct that is harmful to other users or to the platform\n' +
      '- Your verification is revoked or found to be invalid\n' +
      '- We receive credible complaints about your conduct\n\n' +
      'You may delete your account at any time through the app settings. Upon deletion, all your personal data will be permanently erased in accordance with our Privacy Policy.\n\n' +
      'We will endeavour to notify you of any suspension or termination and provide the reason, except where doing so would compromise safety or an ongoing investigation.',
    contentFr:
      'Nous nous réservons le droit de suspendre ou de résilier votre compte à notre discrétion si :\n\n' +
      '- Vous enfreignez toute disposition des présentes Conditions Générales d\'Utilisation\n' +
      '- Vous fournissez des informations fausses ou trompeuses\n' +
      '- Vous adoptez un comportement nuisible envers d\'autres utilisateurs ou la plateforme\n' +
      '- Votre vérification est révoquée ou jugée invalide\n' +
      '- Nous recevons des plaintes crédibles concernant votre conduite\n\n' +
      'Vous pouvez supprimer votre compte à tout moment via les paramètres de l\'application. Lors de la suppression, toutes vos données personnelles seront définitivement effacées conformément à notre Politique de confidentialité.\n\n' +
      'Nous nous efforcerons de vous notifier toute suspension ou résiliation et d\'en fournir le motif, sauf lorsque cela compromettrait la sécurité ou une enquête en cours.',
  },
  {
    titleEn: '13. Intellectual Property',
    titleFr: '13. Propriété intellectuelle',
    contentEn:
      'The {{brand}} name, logo, design, and all software code and visual elements of the platform are the intellectual property of its operator and are protected by applicable intellectual property laws.\n\n' +
      'You may not copy, modify, distribute, or create derivative works from any part of the platform without prior written consent.\n\n' +
      'Content you upload to the platform (profile photos, documents) remains your property. By uploading content, you grant {{brand}} a limited, non-exclusive licence to store, display, and process this content solely for the purpose of providing the service.',
    contentFr:
      'Le nom {{brand}}, le logo, le design et l\'ensemble du code logiciel et des éléments visuels de la plateforme sont la propriété intellectuelle de son exploitant et sont protégés par les lois applicables en matière de propriété intellectuelle.\n\n' +
      'Vous ne pouvez pas copier, modifier, distribuer ou créer des oeuvres dérivées de tout ou partie de la plateforme sans consentement écrit préalable.\n\n' +
      'Le contenu que vous téléchargez sur la plateforme (photos de profil, documents) reste votre propriété. En téléchargeant du contenu, vous accordez à {{brand}} une licence limitée et non exclusive pour stocker, afficher et traiter ce contenu aux seules fins de fourniture du service.',
  },
  {
    titleEn: '14. Modifications to Terms',
    titleFr: '14. Modifications des conditions',
    contentEn:
      'We may modify these Terms of Service at any time. When we make material changes, we will notify you through the app and update the "Last updated" date at the top of this page.\n\n' +
      'Your continued use of {{brand}} after the publication of modified terms constitutes acceptance of the changes. If you do not agree with the modified terms, you must stop using the platform and delete your account.\n\n' +
      'We encourage you to review these terms periodically.',
    contentFr:
      'Nous pouvons modifier les présentes Conditions Générales d\'Utilisation à tout moment. En cas de modification substantielle, nous vous en informerons via l\'application et mettrons à jour la date de « Dernière mise à jour » en haut de cette page.\n\n' +
      'Votre utilisation continue de {{brand}} après la publication des conditions modifiées vaut acceptation des modifications. Si vous n\'acceptez pas les conditions modifiées, vous devez cesser d\'utiliser la plateforme et supprimer votre compte.\n\n' +
      'Nous vous encourageons à consulter régulièrement les présentes conditions.',
  },
  {
    titleEn: '15. Governing Law and Jurisdiction',
    titleFr: '15. Droit applicable et juridiction compétente',
    contentEn:
      'These Terms of Service are governed by and construed in accordance with the laws of France, without regard to conflict of law provisions.\n\n' +
      'Any dispute arising out of or in connection with these terms shall be subject to the exclusive jurisdiction of the courts of Paris, France.\n\n' +
      'In accordance with the provisions of the French Consumer Code (Code de la consommation), you may also have the right to resort to a consumer mediation process before initiating court proceedings.',
    contentFr:
      'Les présentes Conditions Générales d\'Utilisation sont régies par le droit français et interprétées conformément à celui-ci, sans égard aux dispositions relatives aux conflits de lois.\n\n' +
      'Tout litige découlant des présentes conditions ou en rapport avec celles-ci relève de la compétence exclusive des tribunaux de Paris, France.\n\n' +
      'Conformément aux dispositions du Code de la consommation, vous pouvez également avoir le droit de recourir à un processus de médiation de la consommation avant d\'engager une procédure judiciaire.',
  },
  {
    titleEn: '16. Disclaimer of Warranties',
    titleFr: '16. Exclusion de garanties',
    contentEn:
      '{{brand}} is provided on an "as is" and "as available" basis. To the maximum extent permitted by applicable law, we make no warranties, express or implied, regarding the platform, including but not limited to:\n\n' +
      '- The availability, reliability, or continuity of the service\n' +
      '- The accuracy, completeness, or timeliness of any information on the platform\n' +
      '- The suitability of any service provider for any particular family, child, home, animal or task\n' +
      '- The absence of errors, bugs, or security vulnerabilities\n\n' +
      'The verification processes on {{brand}} (identity verification, school enrollment verification, community vouching) are designed to enhance trust within the community but do not constitute a guarantee of any user\'s character, reliability, or competence.',
    contentFr:
      '{{brand}} est fourni « en l\'état » et « selon disponibilité ». Dans la limite maximale autorisée par le droit applicable, nous ne donnons aucune garantie, expresse ou implicite, concernant la plateforme, y compris mais sans s\'y limiter :\n\n' +
      '- La disponibilité, la fiabilité ou la continuité du service\n' +
      '- L\'exactitude, l\'exhaustivité ou l\'actualité des informations présentes sur la plateforme\n' +
      '- L\'adéquation d\'un prestataire pour une famille, un enfant, un logement, un animal ou une mission en particulier\n' +
      '- L\'absence d\'erreurs, de bugs ou de failles de sécurité\n\n' +
      'Les processus de vérification de {{brand}} (vérification d\'identité, vérification de scolarité, parrainage communautaire) sont conçus pour renforcer la confiance au sein de la communauté mais ne constituent pas une garantie du caractère, de la fiabilité ou des compétences d\'un utilisateur.',
  },
  {
    titleEn: '17. Contact',
    titleFr: '17. Contact',
    contentEn:
      'For any questions about these Terms of Service, please contact us at:\n\n' +
      'Email: {{supportEmail}}',
    contentFr:
      'Pour toute question relative aux présentes Conditions Générales d\'Utilisation, veuillez nous contacter à :\n\n' +
      'E-mail : {{supportEmail}}',
  },
];

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export function TermsPage({ brand, supportEmail }: TermsPageProps) {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language?.startsWith('fr');
  const vars = { brand, supportEmail };

  return (
    <div>
      <TopNav title={t('menu.terms')} backTo="back" />
      <div className="px-6 pt-4 pb-8">
        <h2 className="mb-2 text-xl font-bold">
          {isFr ? 'Conditions Générales d\'Utilisation' : 'Terms of Service'}
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
