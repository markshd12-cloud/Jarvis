import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

import { ScrollbarAutoHide } from "@/components/scrollbar-autohide";

// Inter é fonte variável: cobre todos os pesos; o padrão 500 é aplicado no globals.css.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Jarvis",
  description: "HUB de IAs corporativo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Tema padrão Dark; respeita preferência "light" salva no cache do usuário.
            Roda antes da pintura para evitar flash de tema (FOUC). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'){document.documentElement.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ScrollbarAutoHide />
        {children}
      </body>
    </html>
  );
}
