import type { Format } from "./types";

export interface BanEvent {
  date: string; // YYYY-MM-DD announcement date
  label: string; // short summary of the change for THIS format
}

// Curated Banned & Restricted announcement history per constructed format. A date
// is listed under a format only when THAT format actually changed, so a marker on
// the timeline always means "this format's legal cards moved on this date".
// Source: official WotC B&R announcements (magic.wizards.com/en/news/announcements).
// Maintenance: add new entries as announcements land; old ones outside the chart
// window are simply ignored at render time.
export const BANS: Record<Format, BanEvent[]> = {
  Standard: [
    { date: "2025-06-30", label: "7 banned — Cori-Steel Cutter, Heartfire Hero, Monstrous Rage, Up the Beanstalk, Abuelo's Awakening, Hopeless Nightmare, This Town Ain't Big Enough" },
    { date: "2025-11-10", label: "Vivi Ornitier, Screaming Nemesis, Proft's Eidetic Memory banned" },
  ],
  Pioneer: [
    { date: "2025-11-10", label: "Heartfire Hero banned" },
    { date: "2026-05-18", label: "Cori-Steel Cutter banned" },
  ],
  Modern: [
    { date: "2026-05-18", label: "Phlage & Lotus Field banned; Violent Outburst & Umezawa's Jitte unbanned" },
  ],
  Legacy: [
    { date: "2025-11-10", label: "Entomb & Nadu, Winged Wisdom banned" },
    { date: "2026-05-18", label: "Undercity Informer banned" },
  ],
  Vintage: [],
  Pauper: [
    { date: "2025-11-10", label: "High Tide banned" },
    { date: "2026-05-18", label: "Bonder's Ornament unbanned" },
  ],
};
