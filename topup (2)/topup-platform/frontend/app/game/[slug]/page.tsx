'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale } from '../../../contexts/LocaleContext';

interface Package {
  id: string;
  nameEn: string;
  nameKh: string;
  amount: string;
  currency: string;
}
interface Game {
  id: string;
  slug: string;
  nameEn: string;
  nameKh: string;
  bannerUrl: string;
  packages: Package[];
}

const API = process.env.NEXT_PUBLIC_API_URL;

export default function GamePage() {
  const { slug } = useParams<{ slug: string }>();
  const { locale, t } = useLocale();

  const [game, setGame] = useState<Game | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [playerServer, setPlayerServer] = useState('');
  const [nickname, setNickname] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [qr, setQr] = useState<{ qrString: string; qrImageUrl: string } | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    fetch(`${API}/games/${slug}`)
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(setGame)
      .catch(() => setGame(null));
  }, [slug]);

  async function handleVerifyId() {
    if (!playerId) return;
    setVerifying(true);
    setVerifyError(null);
    setNickname(null);
    try {
      const res = await fetch(`${API}/games/${slug}/validate-player-id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, playerServer: playerServer || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setVerifyError(data.message || 'Player ID not found — please check and try again.');
        return;
      }
      setNickname(data.nickname);
    } catch {
      setVerifyError('Could not verify right now. Please try again.');
    } finally {
      setVerifying(false);
    }
  }

  async function handlePay() {
    if (!nickname || !selectedPackage) return;
    setPaying(true);
    try {
      const orderRes = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameSlug: slug,
          packageId: selectedPackage,
          playerId,
          playerServer: playerServer || undefined,
        }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok) throw new Error(order.message || 'Could not create order');

      const payRes = await fetch(`${API}/payments/aba-khqr/${order.id}`, { method: 'POST' });
      const payData = await payRes.json();
      setQr(payData);
    } catch (e: any) {
      setVerifyError(e.message);
    } finally {
      setPaying(false);
    }
  }

  if (!game) return <p style={{ padding: 16 }}>Loading…</p>;

  return (
    <div style={{ padding: 16, maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>{locale === 'en' ? game.nameEn : game.nameKh}</h1>

      {/* --- Player ID entry + nickname validation --- */}
      <section style={{ marginTop: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>{t('enter_player_id')}</label>
        <input
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
          placeholder={t('player_id_placeholder')}
          style={inputStyle}
        />
        <input
          value={playerServer}
          onChange={(e) => setPlayerServer(e.target.value)}
          placeholder={t('server_placeholder')}
          style={inputStyle}
        />
        <button onClick={handleVerifyId} disabled={verifying || !playerId} style={buttonStyle}>
          {verifying ? t('verifying') : t('verify_id')}
        </button>

        {verifyError && <p style={{ color: '#ff5a5a', fontSize: 13 }}>{verifyError}</p>}
        {nickname && (
          <p style={{ color: '#2ecc71', fontSize: 14, fontWeight: 600 }}>
            {t('welcome_player')} {nickname}
          </p>
        )}
      </section>

      {/* --- Package selection (only once nickname confirmed) --- */}
      {nickname && (
        <section style={{ marginTop: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>{t('select_package')}</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            {game.packages.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => setSelectedPackage(pkg.id)}
                style={{
                  ...packageCardStyle,
                  borderColor: selectedPackage === pkg.id ? 'var(--accent-orange)' : 'var(--border)',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{locale === 'en' ? pkg.nameEn : pkg.nameKh}</div>
                <div style={{ color: 'var(--accent-orange)', fontWeight: 700 }}>
                  ${pkg.amount} {pkg.currency}
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={handlePay}
            disabled={!selectedPackage || paying}
            style={{ ...buttonStyle, background: 'var(--accent-orange)', marginTop: 16 }}
          >
            {paying ? '…' : t('pay_now')}
          </button>
        </section>
      )}

      {/* --- KHQR display --- */}
      {qr && (
        <section style={{ marginTop: 16, textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.qrImageUrl} alt="Scan to pay with KHQR" style={{ width: 220, height: 220 }} />
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Scan with any KHQR-compatible bank app</p>
        </section>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 12px',
  marginTop: 8,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  color: 'var(--text)',
  fontSize: 14,
};

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  marginTop: 10,
  borderRadius: 10,
  border: 'none',
  background: 'var(--accent-blue)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
};

const packageCardStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--card-bg)',
  color: 'var(--text)',
  textAlign: 'left',
  cursor: 'pointer',
};
