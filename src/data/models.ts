import type { ModelManifestEntry } from '../types';

/**
 * Model manifest.
 *
 * Orca Slicer generates all six calibration tests in-slicer, so NO downloads
 * are required for the core workflow. External models are optional aids
 * (mainly for Bambu Studio gaps and final verification). None are bundled:
 * common test models (3DBenchy, CNC Kitchen structures) carry licenses that
 * do not clearly permit redistribution inside an app, so we link with
 * attribution instead. The /models directory ships with this manifest so
 * users can drop their own local copies next to it.
 */
export const MODEL_MANIFEST: ModelManifestEntry[] = [
  {
    test: 'Final verification',
    localFile: null,
    bundled: false,
    sourceUrl: 'https://www.3dbenchy.com/download/',
    license: 'Creative Commons BY-ND 4.0 (free to download and print; no redistribution of modified files)',
    attribution: '#3DBenchy by Creative Tools',
    recommendedUse: 'Compact all-in-one verification: hull surfaces, overhangs, bridge (roof), small details, chimney stringing.',
    slicerCompatibility: 'Any slicer (plain STL/3MF import)',
    fileType: 'STL / 3MF'
  },
  {
    test: 'Retraction (Bambu Studio fallback)',
    localFile: null,
    bundled: false,
    sourceUrl: 'https://www.printables.com/model/2303-retraction-test',
    license: 'See model page (varies; most Printables stringing tests are CC BY or CC0 — check before redistribution)',
    attribution: 'Community stringing/retraction test models on Printables',
    recommendedUse: 'Stringing evaluation when the slicer lacks a retraction tower generator. Print repeatedly, changing only retraction distance.',
    slicerCompatibility: 'Any slicer',
    fileType: 'STL'
  },
  {
    test: 'Shrinkage (free, recommended)',
    localFile: null,
    bundled: false,
    sourceUrl: 'https://www.printables.com/model/480907-shrinkage-calculator-dimensional-calibration-tool',
    license: 'See model page (free to download and print)',
    attribution: 'ap.engineering — Shrinkage Calculator / Dimensional Calibration Tool',
    recommendedUse: 'Calibration plate with squares and diamonds at known nominal sizes (150/140/90/80/35/25 mm). Measure with calipers; the author\'s companion spreadsheet averages the scale error across all features and separates horizontal-size (radial) error — or enter measurements directly in this wizard.',
    slicerCompatibility: 'Any slicer (plain STL import; print at 100% scale with shrinkage compensation OFF)',
    fileType: 'STL'
  },
  {
    test: 'Shrinkage (paid, high precision + skew detection)',
    localFile: null,
    bundled: false,
    sourceUrl: 'https://vector3d.shop/products/califlower-calibration-tool-mk2',
    license: 'Commercial (purchase from Vector3D)',
    attribution: 'Vector3D — CaliFlower Calibration Tool MK2',
    recommendedUse: 'Paid but excellent XY dimensional tool: caliper measurements plus Vector3D\'s calculator give a precise shrinkage percentage and detect printer skew. Worth it if you calibrate many filaments.',
    slicerCompatibility: 'Any slicer (print at 100% scale with shrinkage compensation OFF)',
    fileType: 'STL (purchased download)'
  },
  {
    test: 'Max flow (Bambu Studio fallback)',
    localFile: null,
    bundled: false,
    sourceUrl: 'https://www.printables.com/model/342075-extrusion-test-structure',
    license: 'See model page (CNC Kitchen extrusion test structure)',
    attribution: 'Stefan Hermann / CNC Kitchen — Extrusion Test Structure (also the inspiration for Orca\'s built-in test)',
    recommendedUse: 'Measuring max volumetric flow without Orca\'s generator.',
    slicerCompatibility: 'Any slicer',
    fileType: 'STL'
  }
];
