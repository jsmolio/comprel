import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "compREL — Competitive Magic: the Gathering metagame",
  description:
    "Metagame share, decklists, and head-to-head matchup win rates across every competitive Magic: the Gathering format.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-bold tracking-tight text-emerald-400">compREL</span>
              <span className="hidden text-xs text-neutral-500 sm:inline">competitive MTG metagame</span>
            </Link>
            <nav className="text-sm text-neutral-400">
              <a href="https://github.com/fbettega/MTG_decklistcache" className="hover:text-neutral-200" target="_blank" rel="noreferrer">
                data sources
              </a>
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

        <footer className="border-t border-neutral-800 px-4 py-6 text-xs text-neutral-500">
          <div className="mx-auto max-w-6xl space-y-1">
            <p>
              Tournament data via the open{" "}
              <a className="underline hover:text-neutral-300" href="https://github.com/fbettega/MTG_decklistcache" target="_blank" rel="noreferrer">
                MTG_decklistcache
              </a>{" "}
              (MTGO, Melee, TopDeck, Manatraders, CardsRealm) and archetype rules from{" "}
              <a className="underline hover:text-neutral-300" href="https://github.com/Badaro/MTGOFormatData" target="_blank" rel="noreferrer">
                MTGOFormatData
              </a>
              . Card data &amp; images via{" "}
              <a className="underline hover:text-neutral-300" href="https://scryfall.com" target="_blank" rel="noreferrer">
                Scryfall
              </a>
              .
            </p>
            <p>compREL is an unofficial fan project. Magic: the Gathering is © Wizards of the Coast.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
