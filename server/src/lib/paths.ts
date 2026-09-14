import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Raiz do pacote backend (…/backend).
 *
 * Sobe a árvore procurando o package.json em vez de contar níveis: assim o
 * caminho é o mesmo rodando via tsx (src/) ou compilado (dist/src/).
 */
function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir
    dir = dirname(dir)
  }
  throw new Error('package.json não encontrado a partir de ' + import.meta.url)
}

export const packageRoot = findPackageRoot()

/** Resolve um caminho do .env relativo à raiz do pacote. */
export function fromPackageRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(packageRoot, path)
}
