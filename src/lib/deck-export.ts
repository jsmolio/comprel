import type { BoardCard } from "./types";

/**
 * Decklist text for Magic clients.
 *
 * Published cards have a name, image, type line, and price. They do not include
 * an Arena-legal set code or collector number, and they do not include an MTGO
 * catalog id. Arena's `4 Name (SET) 123` form and MTGO's `.dek` XML both need
 * those ids to pick a real printing, so those files are not produced here.
 * Arena also accepts the name-only `Deck` / `Sideboard` list.
 *
 * Names are rewritten only where a client would otherwise miss the card:
 * `Wear/Tear` becomes `Wear // Tear`, an omen printed as `A // B // A` becomes
 * `A // B`, and a double-faced card becomes its front face. Split, adventure,
 * room, and omen cards keep both faces.
 */

export interface ExportDeck {
  mainboard: readonly BoardCard[];
  sideboard: readonly BoardCard[];
}

/** Name → Scryfall type line for cards we actually know. Missing keys are unknown. */
export type TypeLines = Readonly<Record<string, string | null | undefined>>;

export interface DeckFileLabel {
  format?: string | null;
  archetype?: string | null;
  player?: string | null;
  event?: string | null;
  date?: string | null;
}

const FACE = " // ";

/** Names whose type line may decide how Arena spells a multi-face card. */
export function lookupNames(name: string): string[] {
  const trimmed = clean(name);
  const expanded = expandCompactSplit(trimmed);
  const collapsed = collapseRepeatedFace(expanded);
  const faces = splitFaces(collapsed);
  return [...new Set([trimmed, expanded, collapsed, faces[0] ?? ""].filter(Boolean))];
}

export function exportCardName(name: string, types?: TypeLines): string {
  const trimmed = clean(name);
  const expanded = expandCompactSplit(trimmed);
  const collapsed = collapseRepeatedFace(expanded);
  const faces = splitFaces(collapsed);
  if (faces.length < 2) return collapsed;

  const typeLine = knownType(types, collapsed) ?? knownType(types, expanded) ?? knownType(types, trimmed);
  if (typeLine && keepBothFaces(typeLine)) return faces.join(FACE);
  if (typeLine && frontFaceOnly(typeLine)) return faces[0];

  // A combined DFC name is often absent from the catalog, while the front face
  // is stored on its own (`Delver of Secrets`). Omen cards printed three times
  // are not that case: the repeated face was already collapsed above.
  const didCollapse = collapsed !== expanded;
  if (!didCollapse && faces.length === 2 && !hasType(types, collapsed) && !hasType(types, expanded) && !hasType(types, trimmed)) {
    const frontType = knownType(types, faces[0]);
    if (frontType && !frontType.includes("//")) return faces[0];
  }
  return faces.join(FACE);
}

/** Arena import text. Name only, with Deck and Sideboard sections. */
export function formatArena(deck: ExportDeck, types?: TypeLines): string {
  const main = cardLines(deck.mainboard, types);
  const side = cardLines(deck.sideboard, types);
  const lines = ["Deck", ...main];
  if (side.length > 0) lines.push("", "Sideboard", ...side);
  return `${lines.join("\n")}\n`;
}

/**
 * Magic Online text import. Main deck, a blank line, then the sideboard.
 * No section titles. An empty main deck still leads with the blank line so
 * the following cards stay in the sideboard.
 */
export function formatMtgo(deck: ExportDeck, types?: TypeLines): string {
  const main = cardLines(deck.mainboard, types);
  const side = cardLines(deck.sideboard, types);
  if (main.length > 0 && side.length > 0) return `${main.join("\n")}\n\n${side.join("\n")}\n`;
  if (side.length > 0) return `\n${side.join("\n")}\n`;
  if (main.length === 0) return "";
  return `${main.join("\n")}\n`;
}

/** Plain `count name` lines. A Sideboard heading introduces that section. */
export function formatPlain(deck: ExportDeck, types?: TypeLines): string {
  const main = cardLines(deck.mainboard, types);
  const side = cardLines(deck.sideboard, types);
  const lines = [...main];
  if (side.length > 0) lines.push("", "Sideboard", ...side);
  if (lines.length === 0) return "";
  return `${lines.join("\n")}\n`;
}

export function typeLinesFor(
  cards: readonly BoardCard[],
  typeOf: (name: string) => string | null | undefined,
): TypeLines {
  const lines: Record<string, string | null> = {};
  for (const card of cards) {
    for (const name of lookupNames(card.name ?? "")) {
      if (name in lines) continue;
      const typeLine = typeOf(name);
      if (typeLine) lines[name] = typeLine;
    }
  }
  return lines;
}

export function deckExportFilename(label: DeckFileLabel): string {
  const parts = [label.format, label.archetype, label.player, label.event, label.date]
    .map((part) => sanitizeFilePart(part ?? ""))
    .filter(Boolean);
  const base = (parts.join(" - ") || "deck").slice(0, 150).replace(/[. ]+$/g, "");
  return `${base || "deck"}.txt`;
}

function cardLines(cards: readonly BoardCard[], types?: TypeLines): string[] {
  const lines: string[] = [];
  for (const card of cards) {
    if (!card || !Number.isInteger(card.count) || card.count <= 0) continue;
    const name = exportCardName(card.name ?? "", types);
    if (!name) continue;
    lines.push(`${card.count} ${name}`);
  }
  return lines;
}

function clean(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function splitFaces(name: string): string[] {
  if (!name.includes(FACE)) return [name];
  return name
    .split(FACE)
    .map((face) => face.trim())
    .filter(Boolean);
}

/** `Wear/Tear` is the same split card as `Wear // Tear`. `Summon: Choco/Mog` is not. */
function expandCompactSplit(name: string): string {
  const match = name.match(/^([^\s/]+)\/([^\s/]+)$/u);
  if (!match) return name;
  return `${match[1]}${FACE}${match[2]}`;
}

/** MTGO sometimes prints an omen as `Front // Spell // Front`. */
function collapseRepeatedFace(name: string): string {
  const faces = splitFaces(name);
  if (faces.length === 3 && faces[0] === faces[2]) return `${faces[0]}${FACE}${faces[1]}`;
  return name;
}

function knownType(types: TypeLines | undefined, name: string): string | null {
  const typeLine = types?.[name];
  return typeof typeLine === "string" && typeLine.trim() ? typeLine : null;
}

function hasType(types: TypeLines | undefined, name: string): boolean {
  return knownType(types, name) !== null;
}

function keepBothFaces(typeLine: string): boolean {
  if (/\b(Room|Adventure|Omen)\b/.test(typeLine)) return true;
  if (!typeLine.includes(FACE)) return false;
  const [left, right] = typeLine.split(FACE);
  if (isSpell(left) && isSpell(right)) return true;
  if (isPermanent(left) && isSpell(right)) return true;
  return false;
}

function frontFaceOnly(typeLine: string): boolean {
  return typeLine.includes(FACE) && !keepBothFaces(typeLine);
}

function isSpell(typeSide: string): boolean {
  return /^(Instant|Sorcery)\b/.test(typeSide.trim());
}

function isPermanent(typeSide: string): boolean {
  return /^(?:(?:Legendary|Snow|Basic|World|Ongoing|Token)\s+)*(?:Creature|Land|Artifact|Enchantment|Planeswalker|Battle|Kindred|Tribal)\b/.test(
    typeSide.trim(),
  );
}

function sanitizeFilePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
