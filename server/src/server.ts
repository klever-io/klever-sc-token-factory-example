import { config } from './config.js'
import { createApp } from './app.js'
import { initKlever } from './klever.js'

async function main(): Promise<void> {
  const { network, contractAddress, wallet } = await initKlever()

  const app = createApp()
  const server = app.listen(config.PORT, () => {
    console.log(`
  TokenFactory backend
  ────────────────────────────────────────────────
  rede       ${network.name} (chainId ${network.chainId})
  node       ${network.config.node}
  contrato   ${contractAddress ?? '— não configurado: faça o deploy pela página —'}
  signer     ${wallet?.address ?? '— modo somente-leitura —'}
  http       http://localhost:${config.PORT}
`)
  })

  const shutdown = (signal: string) => {
    console.log(`\n${signal} recebido, encerrando…`)
    server.close(() => process.exit(0))
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err: unknown) => {
  console.error('Falha ao iniciar o servidor:', err instanceof Error ? err.message : err)
  process.exit(1)
})
