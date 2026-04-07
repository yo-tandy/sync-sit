import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui';

function StepCard({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">{number}</div>
      <div className="text-sm leading-relaxed text-gray-700">{children}</div>
    </div>
  );
}

export function AddToHomescreenPage() {
  const { i18n } = useTranslation();
  const fr = i18n.language?.startsWith('fr');
  const [tab, setTab] = useState<'ios' | 'android'>('ios');

  return (
    <div>
      <TopNav title={fr ? 'Ajouter à l\'écran d\'accueil' : 'Add to Home Screen'} backTo="back" />

      <div className="px-5 pt-4 pb-8">
        <div className="mb-5 flex flex-col items-center">
          <img src="/logo.png" alt="Sync/Sit" className="mb-3 h-16 w-16 rounded-xl" />
          <p className="text-center text-sm text-gray-500">
            {fr
              ? 'Installez Sync/Sit sur votre téléphone pour un accès rapide, comme une application native.'
              : 'Install Sync/Sit on your phone for quick access, just like a native app.'}
          </p>
        </div>

        {/* Tab selector */}
        <div className="mb-6 flex rounded-lg bg-gray-100 p-[3px]">
          <button
            onClick={() => setTab('ios')}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${
              tab === 'ios' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500'
            }`}
          >
            iPhone / iPad
          </button>
          <button
            onClick={() => setTab('android')}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${
              tab === 'android' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500'
            }`}
          >
            Android
          </button>
        </div>

        {tab === 'ios' ? (
          <div>
            <h3 className="mb-4 text-base font-bold text-gray-900">
              {fr ? 'Safari (iPhone / iPad)' : 'Safari (iPhone / iPad)'}
            </h3>

            <StepCard number={1}>
              <p>
                {fr
                  ? <>Ouvrez <strong>sync-sit.com</strong> dans <strong>Safari</strong>. Cette fonctionnalité ne marche pas avec Chrome ou d'autres navigateurs sur iOS.</>
                  : <>Open <strong>sync-sit.com</strong> in <strong>Safari</strong>. This feature doesn't work with Chrome or other browsers on iOS.</>}
              </p>
            </StepCard>

            <StepCard number={2}>
              <p>
                {fr
                  ? <>Appuyez sur le bouton <strong>Partager</strong> (l'icône carré avec une flèche vers le haut) en bas de l'écran.</>
                  : <>Tap the <strong>Share</strong> button (the square icon with an arrow pointing up) at the bottom of the screen.</>}
              </p>
            </StepCard>

            <StepCard number={3}>
              <p>
                {fr
                  ? <>Faites défiler vers le bas et appuyez sur <strong>"Sur l'écran d'accueil"</strong>.</>
                  : <>Scroll down and tap <strong>"Add to Home Screen"</strong>.</>}
              </p>
            </StepCard>

            <StepCard number={4}>
              <p>
                {fr
                  ? <>Appuyez sur <strong>"Ajouter"</strong> en haut à droite. L'icône Sync/Sit apparaîtra sur votre écran d'accueil.</>
                  : <>Tap <strong>"Add"</strong> in the top right. The Sync/Sit icon will appear on your home screen.</>}
              </p>
            </StepCard>

            <div className="mt-4 rounded-lg bg-blue-50 p-4">
              <p className="text-xs text-blue-700">
                {fr
                  ? '💡 L\'application s\'ouvrira en plein écran, comme une application native, avec des notifications push.'
                  : '💡 The app will open full-screen, just like a native app, with push notifications.'}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <h3 className="mb-4 text-base font-bold text-gray-900">
              {fr ? 'Chrome (Android)' : 'Chrome (Android)'}
            </h3>

            <StepCard number={1}>
              <p>
                {fr
                  ? <>Ouvrez <strong>sync-sit.com</strong> dans <strong>Chrome</strong>.</>
                  : <>Open <strong>sync-sit.com</strong> in <strong>Chrome</strong>.</>}
              </p>
            </StepCard>

            <StepCard number={2}>
              <p>
                {fr
                  ? <>Appuyez sur le <strong>menu ⋮</strong> (trois points) en haut à droite de Chrome.</>
                  : <>Tap the <strong>⋮ menu</strong> (three dots) in the top right corner of Chrome.</>}
              </p>
            </StepCard>

            <StepCard number={3}>
              <p>
                {fr
                  ? <>Appuyez sur <strong>"Ajouter à l'écran d'accueil"</strong> ou <strong>"Installer l'application"</strong>.</>
                  : <>Tap <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong>.</>}
              </p>
            </StepCard>

            <StepCard number={4}>
              <p>
                {fr
                  ? <>Confirmez en appuyant sur <strong>"Ajouter"</strong> ou <strong>"Installer"</strong>. L'icône Sync/Sit apparaîtra sur votre écran d'accueil.</>
                  : <>Confirm by tapping <strong>"Add"</strong> or <strong>"Install"</strong>. The Sync/Sit icon will appear on your home screen.</>}
              </p>
            </StepCard>

            <div className="mt-4 rounded-lg bg-blue-50 p-4">
              <p className="text-xs text-blue-700">
                {fr
                  ? '💡 Sur certains téléphones Android, Chrome peut aussi afficher une bannière "Installer" automatiquement en bas de l\'écran.'
                  : '💡 On some Android phones, Chrome may also show an "Install" banner automatically at the bottom of the screen.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
