// Types for the plain-ESM generator script so tests can import it under
// strict TypeScript. The script itself stays dependency-free JavaScript.
declare module '*generate-printer-database.mjs' {
  import type { PrinterDatabase, SpecExtruderType } from '../src/types';

  export interface RawRow {
    rowIndex: number;
    cells: Record<string, string>;
  }
  export interface BuildResult {
    data: PrinterDatabase;
    skippedEmpty: number;
    warnings: { row: number; message: string }[];
  }

  export function buildDatabase(rawRows: RawRow[]): BuildResult;
  /** Parse worksheet XML into raw rows. Exported so tests can pin cell-level
   *  parsing (notably self-closing/blank cells) without a real .xlsx fixture. */
  export function parseSheet(xml: string, shared: string[]): RawRow[];
  export function slugify(s: string): string;
  export function parseNozzleList(raw: string, rowIndex: number): number[];
  export function boolYesNo(raw: string, rowIndex: number): boolean | null;
  export function normalizeExtruder(raw: string): SpecExtruderType | null;
  /** Read a numeric cell; `field` opts into the plausibility-range check. */
  export function num(
    raw: string | undefined, rowIndex: number, label: string, field?: string
  ): number | null;
  export const SCHEMA_VERSION: number;
  export const DATA_REVISION: number;
}
