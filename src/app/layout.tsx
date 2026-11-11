import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { BrandMark } from "@/components/BrandMark";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "compREL — competitive TCG metagame",
  description: "Metagame share, decklists, and head-to-head win rates for Magic: the Gathering and Riftbound.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <BrandMark size={30} />
              <span className="flex flex-col leading-tight">
                <span className="text-lg font-extrabold tracking-tight">
                  <span className="text-neutral-100">comp</span>
                  <span className="text-emerald-400">REL</span>
                </span>
                <span className="hidden text-[11px] text-neutral-500 sm:block">competitive TCG metagame</span>
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-neutral-400">
              <Link href="/magic" className="hover:text-neutral-200">
                Magic
              </Link>
              <Link href="/riftbound" className="hover:text-neutral-200">
                Riftbound
              </Link>
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
            <p>
              Riftbound tournament results via{" "}
              <a className="underline hover:text-neutral-300" href="https://boundrift.com" target="_blank" rel="noreferrer">
                BoundRift
              </a>
              . Card data &amp; images via{" "}
              <a className="underline hover:text-neutral-300" href="https://openrift.app/developers" target="_blank" rel="noreferrer">
                OpenRift
              </a>
              . Card images are hotlinked, not mirrored.
            </p>
            <p>
              compREL is an unofficial fan project. Magic: the Gathering is © Wizards of the Coast. compREL isn&apos;t
              endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially
              involved in producing or managing Riftbound. Riftbound and Riot Games are trademarks or registered trademarks
              of Riot Games, Inc.
            </p>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
