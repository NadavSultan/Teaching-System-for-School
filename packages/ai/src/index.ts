export type ModelRequest = { operationId: string; input: Readonly<Record<string, unknown>> };
export type ModelResponse = {
  provider: 'fake';
  requestId: string;
  output: Readonly<Record<string, unknown>>;
};
export interface ModelGateway {
  execute(request: ModelRequest): Promise<ModelResponse>;
}

export class DeterministicFakeModelGateway implements ModelGateway {
  async execute(request: ModelRequest): Promise<ModelResponse> {
    return {
      provider: 'fake',
      requestId: `fake:${request.operationId}`,
      output: { accepted: true, operationId: request.operationId },
    };
  }
}
