import { lazy, Suspense, useEffect } from 'react';
import Portal from './app/Portal.tsx';
import { canonicalHash, useRoute } from './app/router.ts';
import LoadingScreen from './app/ui/LoadingScreen.tsx';
import RouteErrorBoundary from './app/ui/RouteErrorBoundary.tsx';

// three.js を含むゲーム本体は、ゲームを開いたときに初めて読み込む
const BreakoutScreen = lazy(() => import('./app/breakout/BreakoutScreen.tsx'));

export default function App() {
  const route = useRoute();

  useEffect(() => {
    document.documentElement.dataset.route = route;
    // #/breakout/ や知らないハッシュは、表示している画面の正規の URL に置き換える
    const canonical = canonicalHash(window.location.hash);
    if (canonical !== null) window.history.replaceState(window.history.state, '', canonical);
  }, [route]);

  if (route === 'breakout') {
    return (
      <RouteErrorBoundary key={route}>
        <Suspense fallback={<LoadingScreen />}>
          <BreakoutScreen />
        </Suspense>
      </RouteErrorBoundary>
    );
  }
  return <Portal />;
}
