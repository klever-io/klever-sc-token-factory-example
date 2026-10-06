import { config } from './config.js'
import { createApp } from './app.js'
import { initKlever } from './klever.js'

async function main(): Promise<void> {
  const { network, contractAddress, wallet } = await initKlever()

  const app = createApp()
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`
  TokenFactory backend
  ────────────────────────────────────────────────
  network    ${network.name} (chainId ${network.chainId})
  node       ${network.config.node}
  contract   ${contractAddress ?? '— not configured: deploy from the page —'}
  signer     ${wallet?.address ?? '— read-only mode —'}
  http       http://${config.HOST}:${config.PORT}
`)
  })

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down…`)
    server.close(() => process.exit(0))
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err: unknown) => {
  console.error('Failed to start the server:', err instanceof Error ? err.message : err)
  process.exit(1)
})
