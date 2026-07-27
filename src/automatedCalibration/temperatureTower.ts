// ---------------------------------------------------------------------------
// Automated Calibration Pipeline — temperature-tower parameterization (Stage 6).
//
// A temperature tower is a bare model (Orca ships `temperature_tower.stl`): the
// geometry alone is inert. The test is created by changing the hotend
// temperature at each height band, which Orca encodes in a project 3mf as
// `Metadata/custom_gcode_per_layer.xml` — a list of per-layer custom g-code
// entries. This module produces that XML for a tower: given the band geometry
// and the start/end/step temperatures, it computes the Z height of each band top
// and the temperature to set there, then serializes the exact XML shape Orca
// writes (verified against a shipped Orca project: `type="4"` = a Custom g-code
// entry, an `M104 S<temp>` no-wait set in `extra`).
//
// Pure module (no fs, no native): the caller supplies the model's band geometry
// and the material's temperature range; native assembly (wrapping the STL into a
// project 3mf that embeds this XML plus the resolved config) is the next step.
//
// NOTE: the band GEOMETRY (band height, base height before the first change) is
// a property of Orca's specific shipped tower model and must be confirmed by a
// real slice before this is wired into `prepareProject`. The math and the XML
// format here are model-agnostic and correct given those constants.
// ---------------------------------------------------------------------------

/**
 * Orca's sentinel `extruder` value for a per-layer entry that isn't tied to a
 * specific extruder (0xCCCCCCCC read as a signed i32) — copied verbatim from a
 * shipped Orca project so the entry round-trips identically.
 */
export const UNSET_EXTRUDER = -858993460;

/** A Custom g-code per-layer entry (Orca `type="4"`). */
export const CUSTOM_GCODE_TYPE = 4;

export interface TemperatureTowerGeometry {
  /** Printed height of each temperature band (mm). */
  bandHeightMm: number;
  /**
   * Height (mm) printed before the first temperature CHANGE takes effect — the
   * base plus the first band, which print at `startTemp`. The first change is
   * emitted at `baseHeightMm`.
   */
  baseHeightMm: number;
  /** Layer height (mm), used to snap band boundaries to actual layer tops. */
  layerHeightMm: number;
}

export interface TemperatureRange {
  /** Temperature of the first (bottom) band, °C — the hottest. */
  startTemp: number;
  /** Temperature of the last (top) band, °C — the coolest. */
  endTemp: number;
  /** Positive °C decrement between adjacent bands. */
  step: number;
}

export interface TemperatureBand {
  /** Z height (mm) at which this band's temperature is set. */
  topZ: number;
  /** Hotend temperature to set at `topZ` (°C). */
  temperature: number;
}

/** Snap a raw Z to the nearest layer top at the given layer height. Rounded to
 *  µm to shed floating-point noise (e.g. 51 * 0.2 = 10.200000000000001). */
function snapToLayer(z: number, layerHeightMm: number): number {
  if (layerHeightMm <= 0) return z;
  return Number((Math.round(z / layerHeightMm) * layerHeightMm).toFixed(4));
}

/** Format a number the compact way Orca writes Z values (no trailing zeros). */
function formatZ(n: number): string {
  // Round to 3 decimals (µm precision) then strip trailing zeros.
  return String(Number(n.toFixed(3)));
}

/**
 * Compute the temperature-change bands for a tower. The first band prints at
 * `startTemp` (set in the project/filament config, not here); each subsequent
 * band gets a change entry at its base Z. Descends by `step` from `startTemp`
 * toward `endTemp` (inclusive when the range divides evenly). Returns the
 * changes only — the count is `ceil((startTemp-endTemp)/step)` entries.
 */
export function buildTemperatureBands(
  range: TemperatureRange,
  geometry: TemperatureTowerGeometry
): TemperatureBand[] {
  const { startTemp, endTemp, step } = range;
  if (step <= 0) throw new Error('TEMP_TOWER: step must be positive');
  if (startTemp < endTemp) throw new Error('TEMP_TOWER: startTemp must be >= endTemp');
  const { bandHeightMm, baseHeightMm, layerHeightMm } = geometry;
  if (bandHeightMm <= 0) throw new Error('TEMP_TOWER: bandHeightMm must be positive');

  const bands: TemperatureBand[] = [];
  let temperature = startTemp - step;
  let index = 0;
  // Emit one change per subsequent band while still above endTemp.
  while (temperature >= endTemp - 1e-9) {
    const rawZ = baseHeightMm + index * bandHeightMm;
    bands.push({ topZ: snapToLayer(rawZ, layerHeightMm), temperature });
    temperature -= step;
    index += 1;
  }
  return bands;
}

/** Escape the five XML entities for text placed in an attribute value. */
function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Serialize temperature bands into Orca's `custom_gcode_per_layer.xml`. Each
 * band becomes a Custom (`type="4"`) entry that sets the hotend temperature with
 * a no-wait `M104 S<temp>` at the band's top_z, matching the shape Orca writes.
 */
export function serializeCustomGcodePerLayer(bands: TemperatureBand[], plateId = 1): string {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<custom_gcodes_per_layer>',
    '<plate>',
    `<plate_info id="${plateId}"/>`
  ];
  for (const band of bands) {
    const extra = escapeXmlAttr(`M104 S${band.temperature}`);
    lines.push(
      `<layer top_z="${formatZ(band.topZ)}" type="${CUSTOM_GCODE_TYPE}" ` +
        `extruder="${UNSET_EXTRUDER}" color="" extra="${extra}"/>`
    );
  }
  lines.push('</plate>', '</custom_gcodes_per_layer>', '');
  return lines.join('\n');
}

/** Convenience: bands + XML in one call. */
export function generateTemperatureTowerGcode(
  range: TemperatureRange,
  geometry: TemperatureTowerGeometry
): { bands: TemperatureBand[]; xml: string } {
  const bands = buildTemperatureBands(range, geometry);
  return { bands, xml: serializeCustomGcodePerLayer(bands) };
}
