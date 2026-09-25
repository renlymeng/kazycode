'use client';

import { useState } from 'react';
import { Search, Sun, Moon, Sparkles, User, Menu, Globe } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useLocale } from '../contexts/LocaleContext';

export default function Header() {
  const { theme, toggleTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="topup-header">
      <div className="topup-header__inner">
        <a href="/" className="topup-header__logo">
          <span className="topup-header__logo-badge">S</span>
          <span className="topup-header__logo-text">TopUpStore</span>
        </a>

        <div className="topup-header__actions">
          {/* Language switcher */}
          <button
            className="topup-icon-btn topup-icon-btn--lang"
            onClick={() => setLocale(locale === 'en' ? 'km' : 'en')}
            aria-label="Switch language"
          >
            <Globe size={16} />
            <span>{locale === 'en' ? 'EN' : 'ខ្មែរ'}</span>
          </button>

          {/* Theme toggle — sun/moon like the reference */}
          <button className="topup-icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Hot picks / sparkle */}
          <button className="topup-icon-btn topup-icon-btn--accent" aria-label="Hot picks">
            <Sparkles size={18} />
          </button>

          {/* Account */}
          <a href="/account" className="topup-icon-btn" aria-label="Account">
            <User size={18} />
          </a>

          {/* Menu */}
          <button className="topup-icon-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            <Menu size={18} />
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="topup-header__search">
        <Search size={16} />
        <input
          type="text"
          placeholder={t('search_placeholder')}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setSearchOpen(false)}
        />
      </div>

      {menuOpen && (
        <nav className="topup-header__menu">
          <a href="/">{t('all_games')}</a>
          <a href="/orders">Order Lookup</a>
          <a href="/account">{t('login')}</a>
        </nav>
      )}
    </header>
  );
}
