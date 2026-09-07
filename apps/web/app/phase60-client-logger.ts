export type ClientWorkspaceLog = Readonly<{
  service: 'web';
  event: 'workspace.completed' | 'workspace.failed';
  operation: 'save' | 'regenerate' | 'validation' | 'approval';
  correlationId: string;
}>;

export function logWorkspaceEvent(
  logger: (event: ClientWorkspaceLog) => void,
  event: ClientWorkspaceLog,
): void {
  logger(event);
}
