import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => !['node_modules', '.next', 'dist', '.git'].includes(name))
    .flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory()
        ? sourceFiles(path)
        : /\.(ts|tsx)$/.test(name)
          ? [path]
          : [];
    });
}
function assertNoImports(directory: string, forbidden: RegExp) {
  for (const file of sourceFiles(resolve(directory)))
    expect(readFileSync(file, 'utf8'), file).not.toMatch(forbidden);
}

describe('dependency boundaries', () => {
  it('keeps web away from database, domain implementation, API, worker, and AI', () =>
    assertNoImports('apps/web', /from ['"](?:@teach\/(?:db|domain|ai)|\.\.\/api|\.\.\/worker)/));
  it('keeps worker away from web and provider SDKs', () =>
    assertNoImports(
      'apps/worker',
      /from ['"](?:@teach\/web|openai|anthropic|@google\/generative)/,
    ));
  it('keeps contracts framework and database neutral', () =>
    assertNoImports('packages/contracts', /from ['"](?:@prisma|@nestjs|next|react)/));
  it('centralizes future model access and has no provider SDK imports', () =>
    assertNoImports('.', /from ['"](?:openai|anthropic|@google\/generative)/));
});
