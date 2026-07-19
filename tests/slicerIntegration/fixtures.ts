import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawProfileFile } from '../../src/slicerIntegration/bridge';

const FIXTURE_DIR = join(__dirname, 'fixtures');

export function fixtureJson(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

export function fixtureRaw(
  name: string,
  overrides: Partial<RawProfileFile> = {}
): RawProfileFile {
  return {
    file_name: name,
    path: `C:\\fake\\${name}`,
    dir_kind: 'user',
    account_id: 'default',
    vendor: null,
    json: fixtureJson(name),
    info: null,
    writable: true,
    ...overrides
  };
}

/** All sanitized real user-preset fixtures, one per slicer. */
export const USER_FIXTURES: { file: string; slicer: 'orca' | 'bambu' | 'snapmaker-orca' | 'elegoo' | 'flash-studio' }[] = [
  { file: 'orca-user-delta-pla.json', slicer: 'orca' },
  { file: 'bambu-user-full-pctg-dualnozzle.json', slicer: 'bambu' },
  { file: 'snapmaker-user-delta-pla.json', slicer: 'snapmaker-orca' },
  { file: 'elegoo-user-delta-petg.json', slicer: 'elegoo' },
  { file: 'flashforge-user-delta-pctg.json', slicer: 'flash-studio' },
  { file: 'flashforge-user-delta-tpu.json', slicer: 'flash-studio' }
];
