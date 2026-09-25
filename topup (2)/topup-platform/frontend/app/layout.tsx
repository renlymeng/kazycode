import './globals.css';
import { ThemeProvider } from '../contexts/ThemeContext';
import { LocaleProvider } from '../contexts/LocaleContext';
import Header from '../components/Header';

export const metadata = {
  title: 'TopUpStore — Instant Game Top-Up',
  description: 'Top up Mobile Legends, Free Fire, PUBG Mobile and more — instantly, via KHQR.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <LocaleProvider>
            <Header />
            <main>{children}</main>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
