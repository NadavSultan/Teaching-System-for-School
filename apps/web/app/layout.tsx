import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = { title: 'סביבת הוראה', description: 'תשתית מאובטחת למורים' };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <a className="skip-link" href="#main">
          דלגו לתוכן
        </a>
        {children}
      </body>
    </html>
  );
}
