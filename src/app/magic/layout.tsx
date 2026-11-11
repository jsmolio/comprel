import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "compREL — Competitive Magic: the Gathering metagame",
  description:
    "Metagame share, decklists, and head-to-head matchup win rates across every competitive Magic: the Gathering format.",
};

export default function MagicLayout({ children }: { children: React.ReactNode }) {
  return children;
}
