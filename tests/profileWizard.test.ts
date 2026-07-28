import { describe, it, expect } from 'vitest';
import { hasProgressToLose, type WizState } from '../src/ui/profileWizard';

function state(overrides: Partial<WizState> = {}): WizState {
  return {
    stage: 'slicer', installations: null, installation: null, location: null,
    scan: null, advanced: false, filterText: '', filterSource: 'all',
    filterCompatibleOnly: true, selectedBase: null, manualSlicerId: 'orca',
    newName: '', targetExtruder: 0, applyAll: false, bakePaGcode: false, enabledPatchKeys: null,
    generated: null, validation: null, acknowledged: new Set(),
    installResult: null, exportedTo: null, completed: false,
    ...overrides
  };
}

describe('hasProgressToLose', () => {
  it('has nothing to lose on a fresh slicer stage', () => {
    expect(hasProgressToLose(state())).toBe(false);
  });

  it('has nothing to lose once completed, regardless of stage', () => {
    expect(hasProgressToLose(state({ stage: 'result', completed: true, generated: {} as never }))).toBe(false);
  });

  it('warns once past the slicer stage', () => {
    for (const stage of ['profiles', 'configure', 'preview', 'result'] as const) {
      expect(hasProgressToLose(state({ stage }))).toBe(true);
    }
  });

  it('does not warn for a bare installation pick on the slicer stage', () => {
    expect(hasProgressToLose(state({ stage: 'slicer', installation: {} as never, location: {} as never }))).toBe(false);
  });

  it('warns on the slicer stage once a scan has run', () => {
    expect(hasProgressToLose(state({ stage: 'slicer', scan: { profiles: [], parsed: new Map(), parseFailures: [] } }))).toBe(true);
  });

  it('warns on the slicer stage once a base profile is selected', () => {
    expect(hasProgressToLose(state({ stage: 'slicer', selectedBase: {} as never }))).toBe(true);
  });

  it('warns on the slicer stage once a profile has been generated', () => {
    expect(hasProgressToLose(state({ stage: 'slicer', generated: {} as never }))).toBe(true);
  });
});
