import { lazy, Suspense, useEffect } from 'react';
import NotFound from './app/NotFound.tsx';
import Portal from './app/Portal.tsx';
import { useRoute } from './app/router.ts';
import { documentTitle, isGameRoute } from './app/site.ts';
import type { Route } from './app/site.ts';
import LoadingScreen from './app/ui/LoadingScreen.tsx';
import RouteAnnouncer from './app/ui/RouteAnnouncer.tsx';
import RouteErrorBoundary from './app/ui/RouteErrorBoundary.tsx';

// three.js を含むゲーム本体は、ゲームを開いたときに初めて読み込む
const BreakoutScreen = lazy(() => import('./app/breakout/BreakoutScreen.tsx'));
const ReversiScreen = lazy(() => import('./app/reversi/ReversiScreen.tsx'));

export default function App() {
  const route = useRoute();
  const title = documentTitle(route);

  // 読み込んだときの値はビルド時に HTML へ書いてあるので、ここではページ内の遷移に合わせて書き換える
  useEffect(() => {
    document.documentElement.toggleAttribute('data-game', isGameRoute(route));
    document.title = title;
  }, [route, title]);

  return (
    <>
      <RouteView route={route} />
      <RouteAnnouncer title={title} />
    </>
  );
}

function RouteView({ route }: { route: Route }) {
  switch (route) {
    case 'breakout':
      return (
        <RouteErrorBoundary key={route}>
          <Suspense fallback={<LoadingScreen />}>
            <BreakoutScreen />
          </Suspense>
        </RouteErrorBoundary>
      );
    case 'reversi':
      return (
        <RouteErrorBoundary key={route}>
          <Suspense fallback={<LoadingScreen />}>
            <ReversiScreen />
          </Suspense>
        </RouteErrorBoundary>
      );
    case 'portal':
      return <Portal />;
    case 'notFound':
      return <NotFound />;
  }
}
