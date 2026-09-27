import { hrefOf } from './router.ts';

/** 遊べるゲーム。上から番号を振って並べる */
const GAMES = [{ route: 'breakout', title: 'ブロック崩し' }] as const;

export default function Portal() {
  return (
    <main className="portal">
      <h1 className="portal-logo">
        <span className="portal-logo-main">DOPAGAKI</span>
        <span className="portal-logo-sub">GAMES</span>
      </h1>

      <ol className="portal-games">
        {GAMES.map((g, i) => (
          <li key={g.route}>
            <a className="portal-game" href={hrefOf(g.route)}>
              <span className="portal-game-no">{String(i + 1).padStart(2, '0')}</span>
              <span className="portal-game-title">{g.title}</span>
              <span className="portal-game-arrow" aria-hidden="true">
                →
              </span>
            </a>
          </li>
        ))}
      </ol>
    </main>
  );
}
