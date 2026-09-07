import { describe, expect, it } from 'vitest';
import { logWorkspaceEvent, type ClientWorkspaceLog } from './phase60-client-logger';

describe('client workspace logger', () => {
  it('captures success and failure with only safe operational fields', () => {
    const captured: ClientWorkspaceLog[] = [];
    logWorkspaceEvent((event) => captured.push(event), {
      service: 'web',
      event: 'workspace.completed',
      operation: 'save',
      correlationId: 'request-1',
    });
    logWorkspaceEvent((event) => captured.push(event), {
      service: 'web',
      event: 'workspace.failed',
      operation: 'approval',
      correlationId: 'request-2',
    });
    expect(captured).toHaveLength(2);
    expect(JSON.stringify(captured).toLowerCase()).not.toMatch(
      /prompt|answer|source text|token|secret|cookie|authorization|password/,
    );
  });
});
