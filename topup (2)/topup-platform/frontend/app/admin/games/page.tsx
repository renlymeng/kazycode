'use client';

import { useEffect, useState } from 'react';

interface AdminGame {
  id: string;
  nameEn: string;
  slug: string;
  isActive: boolean;
}

const API = process.env.NEXT_PUBLIC_API_URL;

/**
 * Admin dashboard is served at /admin — this route additionally expects
 * a valid session cookie/JWT with role ADMIN|SUPER_ADMIN and mfaVerified=true
 * (enforced server-side by RolesGuard; this page is UI only and re-checks
 * via a 401/403 redirect on fetch failure, never trusts the client alone).
 */
export default function AdminGamesPage() {
  const [games, setGames] = useState<AdminGame[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadGames();
  }, []);

  async function loadGames() {
    const res = await fetch(`${API}/games/admin/all`, { credentials: 'include' });
    if (res.status === 401 || res.status === 403) {
      window.location.href = '/admin/login';
      return;
    }
    setGames(await res.json());
  }

  async function toggleGame(id: string, next: boolean) {
    setError(null);
    const res = await fetch(`${API}/games/admin/${id}/toggle`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: next }),
    });
    if (!res.ok) {
      setError('Failed to update — check your session and try again.');
      return;
    }
    setGames((prev) => prev.map((g) => (g.id === id ? { ...g, isActive: next } : g)));
  }

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Game Availability</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        Toggling a game OFF immediately hides it from the storefront and blocks new purchases.
      </p>
      {error && <p style={{ color: '#ff5a5a' }}>{error}</p>}

      <div style={{ marginTop: 16 }}>
        {games.map((g) => (
          <div
            key={g.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{g.nameEn}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.slug}</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <span style={{ fontSize: 12, color: g.isActive ? '#2ecc71' : '#999' }}>
                {g.isActive ? 'ON' : 'OFF'}
              </span>
              <input
                type="checkbox"
                checked={g.isActive}
                onChange={(e) => toggleGame(g.id, e.target.checked)}
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
