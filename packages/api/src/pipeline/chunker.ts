import type { ParsedPage } from './parser';

/**
 * RAG stage 2 — CHUNK.
 *
 * Retrieval works on passages, not whole documents, so each document is split
 * into chunks. Legal text has a structure that tells us where the natural
 * boundaries are, so we split in two passes:
 *
 *   1. Structure first: every article heading ("Article 7 — Termination",
 *      "## Article 7", "ARTICLE VII") and every numbered clause ("7.2 ...")
 *      starts a new section. A clause is the unit lawyers cite, so a chunk
 *      that maps to exactly one clause gives precise citations like
 *      "Art. 7.2 — Termination for convenience".
 *   2. Size second: a section longer than `maxChars` is split at sentence
 *      boundaries into several chunks that repeat a small overlap, so a
 *      sentence cut at a boundary still appears whole in one of the chunks.
 *      Every piece keeps the section label of the clause it came from.
 *
 * Why not fixed-size windows? They cut clauses in half and mix two clauses in
 * one chunk, which blurs both retrieval and citations.
 */

export interface ChunkerOptions {
  /** Maximum characters per chunk. nomic-embed-text sees ~2k tokens, so ~1.2k chars is comfortably safe. */
  maxChars: number;
  /** Characters repeated from the end of the previous piece when a long section is split. */
  overlapChars: number;
}

export const DEFAULT_CHUNKER_OPTIONS: ChunkerOptions = { maxChars: 1200, overlapChars: 150 };

export interface TextChunk {
  /** Human-readable citation label, e.g. "Art. 7.2 — Termination for convenience". */
  section: string;
  /** Enclosing headings (e.g. the article a clause belongs to), used as extra context for embedding. */
  context: string[];
  /** Page the section starts on, or null when the format has no pages. */
  page: number | null;
  text: string;
}

/** "Article 7 — Termination", "## ARTICLE VII: Termination", "Section 3. Fees", "**Article 2**". */
const ARTICLE_HEADING =
  /^(?:#{1,6}\s+)?(?:\*\*)?(article|section)\s+(\d+|[IVXLCDM]+)\b\.?\s*(?:[—–:.-]\s*)?(.*)$/i;
/** "7.2 **Termination for convenience.** Either party may ..." or "7.2. Either party may ...". */
const CLAUSE_START = /^(?:#{1,6}\s+)?(\d+(?:\.\d+)+)\.?\s+(.*)$/;
/** Any other Markdown heading ("# Mutual Non-Disclosure Agreement", "## Schedule 1"). */
const MARKDOWN_HEADING = /^(#{1,6})\s+(.*)$/;
/** A bold lead-in at the start of a clause is its title: "**Termination for convenience.**". */
const BOLD_TITLE = /^\*\*(.+?)\*\*/;
/** Headings are short; a long line starting with "Article 2 ..." is prose that refers to an article. */
const MAX_HEADING_LENGTH = 120;

interface Article {
  /** "Art." or "Section", the prefix used in labels for this article and its clauses. */
  prefix: string;
  number: string;
  title: string;
  label: string;
}

interface Section {
  label: string;
  context: string[];
  page: number | null;
  lines: string[];
  /** True once the section holds more than just its heading line. */
  hasBody: boolean;
}

/** Strips Markdown emphasis and trailing punctuation from a heading or clause title. */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\*\*|__/g, '')
    .replace(/[\s.:—–-]+$/, '')
    .trim();
}

function withTitle(base: string, title: string | undefined): string {
  return title ? `${base} — ${title}` : base;
}

/** Splits the parsed pages into sections along article and clause boundaries (pass 1). */
function splitIntoSections(pages: ParsedPage[]): Section[] {
  const sections: Section[] = [];
  let article: Article | undefined;
  let current: Section | undefined;

  const startSection = (label: string, context: string[], page: number | null, heading: string) => {
    current = { label, context, page, lines: [heading], hasBody: false };
    sections.push(current);
  };

  for (const { page, text } of pages) {
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();

      const articleMatch = line.length <= MAX_HEADING_LENGTH ? ARTICLE_HEADING.exec(line) : null;
      if (articleMatch) {
        const [, kind = '', number = '', rawTitle = ''] = articleMatch;
        const prefix = kind.toLowerCase() === 'article' ? 'Art.' : 'Section';
        const title = cleanTitle(rawTitle);
        article = { prefix, number, title, label: withTitle(`${prefix} ${number}`, title) };
        startSection(article.label, [], page, line.replace(/^#{1,6}\s+/, ''));
        continue;
      }

      const clauseMatch = CLAUSE_START.exec(line);
      // Inside "Article 7", only "7.x" starts a clause, so "2.5 million" in prose is not mistaken for one.
      const belongsToArticle =
        !article ||
        !/^\d+$/.test(article.number) ||
        clauseMatch?.[1]?.split('.')[0] === article.number;
      if (clauseMatch && belongsToArticle) {
        const [, number = '', rest = ''] = clauseMatch;
        const clauseTitle = BOLD_TITLE.exec(rest)?.[1];
        const title = clauseTitle ? cleanTitle(clauseTitle) : article?.title;
        const label = withTitle(`${article?.prefix ?? 'Clause'} ${number}`, title);
        startSection(label, article ? [article.label] : [], page, line.replace(/^#{1,6}\s+/, ''));
        current!.hasBody = true; // the clause line carries its own text
        continue;
      }

      const headingMatch = MARKDOWN_HEADING.exec(line);
      // A document title (an H1 before any section) is kept as part of the preamble.
      if (headingMatch && (headingMatch[1] !== '#' || current)) {
        article = undefined;
        startSection(
          cleanTitle(headingMatch[2] ?? ''),
          [],
          page,
          cleanTitle(headingMatch[2] ?? ''),
        );
        continue;
      }

      if (!current) startSection('Preamble', [], page, '');
      if (line) current!.hasBody = true;
      current!.lines.push(headingMatch ? cleanTitle(headingMatch[2] ?? '') : line);
    }
  }

  // Sections that are only a heading (an article whose text is all in its clauses) produce no chunk.
  return sections.filter((s) => s.hasBody);
}

/** Collapses the section's lines into paragraphs separated by blank lines. */
function sectionText(section: Section): string {
  return section.lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Splits text that is longer than `maxChars` into overlapping pieces at sentence boundaries (pass 2). */
function splitWithOverlap(text: string, { maxChars, overlapChars }: ChunkerOptions): string[] {
  if (text.length <= maxChars) return [text];

  // Sentences (or list items ending in ";") are the smallest units we prefer not to cut.
  // A single sentence that is still too long is cut at word boundaries.
  const unitMax = maxChars - overlapChars;
  const units = text
    .split(/(?<=[.!?;])\s+|\n+/)
    .filter(Boolean)
    .flatMap((sentence) => hardWrap(sentence, unitMax));

  const pieces: string[] = [];
  let piece = '';
  for (const unit of units) {
    if (piece && piece.length + 1 + unit.length > maxChars) {
      pieces.push(piece);
      // Start the next piece with the tail of the previous one (snapped to a word start).
      const tail = piece.slice(-overlapChars);
      const firstSpace = tail.indexOf(' ');
      piece = firstSpace >= 0 ? tail.slice(firstSpace + 1) : tail;
    }
    piece = piece ? `${piece} ${unit}` : unit;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function hardWrap(sentence: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  // A "word" longer than the limit (e.g. a long URL) is cut into limit-sized slices.
  const words = sentence.split(/\s+/).flatMap((w) => w.match(new RegExp(`.{1,${max}}`, 'g')) ?? []);
  for (const word of words) {
    if (line && line.length + 1 + word.length > max) {
      out.push(line);
      line = '';
    }
    line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

export function chunkDocument(
  pages: ParsedPage[],
  options: ChunkerOptions = DEFAULT_CHUNKER_OPTIONS,
): TextChunk[] {
  return splitIntoSections(pages).flatMap((section) =>
    splitWithOverlap(sectionText(section), options).map((text) => ({
      section: section.label,
      context: section.context,
      page: section.page,
      text,
    })),
  );
}
