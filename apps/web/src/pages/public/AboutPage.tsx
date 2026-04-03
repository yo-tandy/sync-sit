import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui';
import { ShieldIcon, SearchIcon, UsersIcon, CalendarIcon } from '@/components/ui/Icons';

export function AboutPage() {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language?.startsWith('fr');

  return (
    <div>
      <TopNav title={t('about.title')} backTo="back" />
      <div className="px-6 pt-4 pb-8">
        {/* Logo + tagline */}
        <div className="mb-6 flex flex-col items-center">
          <img src="/logo.png" alt="Sync/Sit" className="mb-3 h-24 w-24 rounded-2xl" />
          <p className="text-center text-sm text-gray-500">
            {isFr
              ? 'Connecter les familles avec des babysitters de confiance'
              : 'Connecting families with trusted student babysitters'}
          </p>
        </div>

        {/* The story */}
        <h2 className="mb-3 text-lg font-bold text-gray-900">
          {isFr ? 'Notre histoire' : 'Our Story'}
        </h2>
        <p className="mb-3 text-sm leading-relaxed text-gray-600">
          {isFr
            ? 'Sync/Sit est né d\'un constat simple : de nombreux parents nous ont partagé leurs difficultés à trouver des babysitters de confiance. Beaucoup souhaitaient pouvoir faire appel aux élèves plus âgés du lycée pour garder leurs plus jeunes enfants — des jeunes qu\'ils croisent tous les jours à l\'école, issus de familles qu\'ils connaissent.'
            : 'Sync/Sit was born from a simple observation: many parents shared their struggles finding trustworthy babysitters. Many wished they could connect with older high school students to help with their younger children — teens they see every day at school, from families they already know.'}
        </p>
        <p className="mb-6 text-sm leading-relaxed text-gray-600">
          {isFr
            ? 'C\'est de cette idée qu\'est née Sync/Sit — une plateforme qui facilite la mise en relation entre les familles et les élèves babysitters au sein de la même communauté scolaire. Simple, sûr, et fait pour notre communauté.'
            : 'That\'s how Sync/Sit came to be — a platform that makes it easy to connect families with student babysitters within the same school community. Simple, safe, and built for our community.'}
        </p>

        {/* Features */}
        <h2 className="mb-3 text-lg font-bold text-gray-900">
          {isFr ? 'Ce que Sync/Sit offre' : 'What Sync/Sit Offers'}
        </h2>
        <div className="mb-6 space-y-3">
          <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
            <SearchIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {isFr ? 'Recherche intelligente' : 'Smart Search'}
              </p>
              <p className="text-xs text-gray-500">
                {isFr
                  ? 'Trouvez des babysitters par proximité, disponibilité, âge et langues parlées.'
                  : 'Find babysitters by proximity, availability, age, and spoken languages.'}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
            <CalendarIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {isFr ? 'Gestion simple' : 'Easy Scheduling'}
              </p>
              <p className="text-xs text-gray-500">
                {isFr
                  ? 'Demandes ponctuelles ou récurrentes, confirmations et rappels — tout au même endroit.'
                  : 'One-time or recurring requests, confirmations, and reminders — all in one place.'}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
            <UsersIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {isFr ? 'Vérification communautaire' : 'Community Verification'}
              </p>
              <p className="text-xs text-gray-500">
                {isFr
                  ? 'Les parents vérifiés peuvent se porter garants les uns pour les autres, renforçant la confiance au sein de la communauté.'
                  : 'Verified parents can vouch for each other, strengthening trust within the community.'}
              </p>
            </div>
          </div>
        </div>

        {/* Safety */}
        <h2 className="mb-3 text-lg font-bold text-gray-900">
          <ShieldIcon className="-mt-0.5 mr-1.5 inline h-5 w-5 text-red-500" />
          {isFr ? 'La sécurité avant tout' : 'Safety First'}
        </h2>
        <p className="mb-2 text-sm leading-relaxed text-gray-600">
          {isFr
            ? 'La sécurité des enfants et des babysitters est notre priorité absolue. Voici comment nous la garantissons :'
            : 'The safety of children and babysitters is our top priority. Here\'s how we ensure it:'}
        </p>
        <ul className="mb-6 space-y-1.5 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <span className="mt-1 text-red-500">•</span>
            {isFr
              ? 'Les babysitters vérifient leur affiliation scolaire via leur adresse e-mail officielle'
              : 'Babysitters verify their school affiliation through their official school email'}
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 text-red-500">•</span>
            {isFr
              ? 'Les familles sont vérifiées par documents d\'identité, certificats de scolarité ou parrainage communautaire'
              : 'Families are verified through ID documents, enrollment certificates, or community vouching'}
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 text-red-500">•</span>
            {isFr
              ? 'Les recherches sont bloquées tant que la vérification n\'est pas complète'
              : 'Search is blocked until verification is complete'}
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 text-red-500">•</span>
            {isFr
              ? 'Les données personnelles sont protégées conformément au RGPD et à la loi française'
              : 'Personal data is protected in compliance with GDPR and French law'}
          </li>
        </ul>

        {/* How-to Guides */}
        <h2 className="mb-3 text-lg font-bold text-gray-900">
          {isFr ? 'Guides d\'utilisation' : 'How-to Guides'}
        </h2>
        <div className="mb-6 space-y-2">
          <Link to="/guide/parents" className="flex items-center gap-3 rounded-lg bg-gray-50 p-3 active:bg-gray-100">
            <UsersIcon className="h-5 w-5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-red-600">{isFr ? 'Guide Parents' : 'Parent Guide'}</p>
              <p className="text-xs text-gray-500">{isFr ? 'Comment trouver et gérer les babysitters' : 'How to find and manage babysitters'}</p>
            </div>
          </Link>
          <Link to="/guide/babysitters" className="flex items-center gap-3 rounded-lg bg-gray-50 p-3 active:bg-gray-100">
            <SearchIcon className="h-5 w-5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-red-600">{isFr ? 'Guide Babysitters' : 'Babysitter Guide'}</p>
              <p className="text-xs text-gray-500">{isFr ? 'Comment recevoir et gérer les demandes' : 'How to receive and manage requests'}</p>
            </div>
          </Link>
        </div>

        {/* Disclaimer */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs leading-relaxed text-gray-500">
            {isFr
              ? 'Sync/Sit est une initiative indépendante destinée aux familles de la communauté EJM. Cette application n\'est pas officiellement affiliée à l\'École Jeannine Manuel ni à l\'association de parents d\'élèves. Elle est simplement le fruit d\'une initiative visant à rendre la vie des familles EJM un peu plus facile.'
              : 'Sync/Sit is an independent initiative for families in the EJM community. This app is not officially affiliated with or managed by École Jeannine Manuel or the Parents\' Association. It is simply an initiative to make life a little easier for EJM families.'}
          </p>
        </div>

        {/* Contact + version */}
        <div className="text-center">
          <p className="mb-1 text-xs text-gray-400">
            {isFr ? 'Exploité par Tandy SARL, Paris' : 'Operated by Tandy SARL, Paris'}
          </p>
          <p className="mb-1 text-xs text-gray-400">
            <a href="mailto:support@sync-sit.com" className="text-red-500 hover:underline">support@sync-sit.com</a>
          </p>
          <p className="text-xs text-gray-400">Version 1.0.0</p>
        </div>
      </div>
    </div>
  );
}
