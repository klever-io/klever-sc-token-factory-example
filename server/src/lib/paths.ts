import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Backend package root (…/backend).
 *
 * Walks up the tree looking for package.json instead of counting levels: that way the
 * path is the same whether running via tsx (src/) or compiled (dist/src/).
 */
function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir
    dir = dirname(dir)
  }
  throw new Error('package.json not found from ' + import.meta.url)
}

export const packageRoot = findPackageRoot()

/** Resolves a path from .env relative to the package root. */
export function fromPackageRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(packageRoot, path)
}
