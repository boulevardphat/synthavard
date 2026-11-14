import type {Metadata} from 'next';
import { Archivo } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css'; // Global styles

const archivo = Archivo({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: 'variable',
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-archivo',
});

const p22Typewriter = localFont({
  src: '../public/P22 Typewriter Regular.ttf',
  weight: '400',
  style: 'normal',
  display: 'swap',
  variable: '--font-p22-typewriter',
});

export const metadata: Metadata = {
  title: 'synthavard',
  description: 'Pitch black workspace with Archivo font',
  openGraph: {
    title: 'synthavard',
    description: 'Pitch black workspace with Archivo font',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'synthavard',
    description: 'Pitch black workspace with Archivo font',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${archivo.variable} ${p22Typewriter.variable}`}>
      <body suppressHydrationWarning className="bg-black text-white min-h-screen selection:bg-neutral-800 selection:text-white font-sans">
        {children}
      </body>
    </html>
  );
}
