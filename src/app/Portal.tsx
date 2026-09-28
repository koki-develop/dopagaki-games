import { GAMES } from './site.ts';
import Link from './ui/Link.tsx';

export default function Portal() {
  return (
    <main className="portal">
      <h1 className="portal-logo">
        <span className="portal-logo-main">DOPAGAKI</span>
        <span className="portal-logo-sub">GAMES</span>
      </h1>

      <ol className="portal-games">
        {GAMES.map((g, i) => (
          <li key={g.id}>
            <Link className="portal-game" to={g.id}>
              <span className="portal-game-no">{String(i + 1).padStart(2, '0')}</span>
              <span className="portal-game-title">{g.title}</span>
              <span className="portal-game-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
