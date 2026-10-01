import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CV Geliştir & İş Eşleştir',
  description: 'AI destekli CV analizi, iyileştirme ve iş eşleştirme aracı.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
