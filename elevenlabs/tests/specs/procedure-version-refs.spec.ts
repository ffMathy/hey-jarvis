import { describe, expect, it } from 'bun:test';
import { toProcedureVersionRefs } from '../../src/main.js';

describe('toProcedureVersionRefs', () => {
  it('should keep only the procedure id and version id', () => {
    const versionRefs = toProcedureVersionRefs({
      proc_1: {
        procedureId: 'proc_1',
        versionId: 'version_1',
        name: 'Order a taxi',
        trigger: 'when sir asks for a ride',
        referencedToolIds: ['tool_1'],
      },
    });

    expect(versionRefs).toEqual({
      proc_1: { procedureId: 'proc_1', versionId: 'version_1' },
    });
  });

  it('should preserve the key each procedure is filed under', () => {
    const versionRefs = toProcedureVersionRefs({
      proc_1: { procedureId: 'proc_1', versionId: 'version_1' },
      proc_2: { procedureId: 'proc_2', versionId: 'version_2' },
    });

    expect(Object.keys(versionRefs)).toEqual(['proc_1', 'proc_2']);
  });

  it('should map an empty record to an empty record', () => {
    expect(toProcedureVersionRefs({})).toEqual({});
  });

  it('should throw rather than silently detach a procedure that has no version', () => {
    expect(() =>
      toProcedureVersionRefs({
        proc_1: { procedureId: 'proc_1', name: 'Order a taxi' },
      }),
    ).toThrow('Order a taxi');
  });

  it('should name the procedure by id when it has no name', () => {
    expect(() =>
      toProcedureVersionRefs({
        proc_1: { procedureId: 'proc_1' },
      }),
    ).toThrow('proc_1');
  });
});
