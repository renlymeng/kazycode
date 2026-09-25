'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from '../contexts/LocaleContext';

interface Game {
  id: string;
  slug: string;
  nameEn: string;
  nameKh: string;
  iconUrl: string;
  isHot: boolean;
}

export default function HomePage() {
  const { locale, t } = useLocale();
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/games`)
      .then((res) => res.json())
      .then((data) => setGames(data))
      .catch(() => setGames([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <section style={{ padding: '16px' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{t('featured_games')}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('tagline')}</p>
      </section>

      {loading && <p style={{ padding: 16 }}>Loading…</p>}

      <div className="game-grid">
        {games.map((game) => (
          <Link key={game.id} href={`/game/${game.slug}`} className="game-card">
            {game.isHot && <span className="game-card__badge">{t('hot')}</span>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={game.iconUrl} alt={locale === 'en' ? game.nameEn : game.nameKh} />
            <div className="game-card__name">{locale === 'en' ? game.nameEn : game.nameKh}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
