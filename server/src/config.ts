import 'dotenv/config'
import { z } from 'zod'

/**
 * Configuração do backend.
 *
 * O arquivo PEM da carteira é opcional: sem ele o servidor sobe em modo
 * somente-leitura (todas as views do contrato funcionam, os endpoints de
 * escrita respondem 503).
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),

  /** Rede Klever: mainnet | testnet | devnet | local */
  KLEVER_NETWORK: z.enum(['mainnet', 'testnet', 'devnet', 'local']).default('testnet'),
  /** URL de node customizada (sobrepõe KLEVER_NETWORK quando definida) */
  KLEVER_NODE_URL: z.string().url().optional(),
  /** URL de API customizada (usada junto com KLEVER_NODE_URL) */
  KLEVER_API_URL: z.string().url().optional(),
  /** Chain ID obrigatório quando se usa URLs customizadas */
  KLEVER_CHAIN_ID: z.string().optional(),

  /** Endereço bech32 do TokenFactory já deployado */
  CONTRACT_ADDRESS: z
    .string()
    .regex(/^klv1[0-9a-z]{38,}$/, 'CONTRACT_ADDRESS deve ser um endereço klv1 válido')
    .optional(),

  /** Caminho do arquivo PEM (formato Klever) da conta que assina as transações */
  WALLET_PEM_PATH: z.string().optional(),
  /** Senha do PEM, apenas quando o arquivo foi gerado criptografado */
  WALLET_PEM_PASSWORD: z.string().optional(),

  /** Caminho do ABI gerado pelo build do contrato */
  ABI_PATH: z.string().default('../token-factory/output/token-factory.abi.json'),
  /** Caminho do wasm, usado apenas pelo script de deploy */
  WASM_PATH: z.string().default('../token-factory/output/token-factory.wasm'),

  /** Espera a confirmação on-chain por padrão nos endpoints de escrita */
  WAIT_FOR_TX: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
})

/** Variáveis vazias no .env (`FOO=`) valem como não definidas. */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ''),
)

const parsed = schema.safeParse(env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(`Configuração inválida (.env):\n${issues}`)
}

export const config = parsed.data

/** Modo somente-leitura: sem o PEM da carteira não há como assinar transações. */
export const canSign = Boolean(config.WALLET_PEM_PATH)
