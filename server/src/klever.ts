import { readFileSync } from "node:fs";

import { loadPrivateKeyFromPemFile } from "@klever/connect-crypto";
import {
  Contract,
  KleverProvider,
  NodeWallet,
  createCustomNetwork,
  type ContractABI,
  type Network,
} from "@klever/connect";

import { canSign, config } from "./config.js";
import { unavailable } from "./lib/errors.js";
import { fromPackageRoot } from "./lib/paths.js";

export interface KleverContext {
  provider: KleverProvider;
  network: Network;
  /** Ausente quando o servidor roda em modo somente-leitura. */
  wallet?: NodeWallet;
  abi: ContractABI;
  /**
   * Instância do TokenFactory (com signer quando há carteira, só provider caso
   * contrário). Ausente até o contrato ser configurado: via CONTRACT_ADDRESS no
   * .env ou pelo deploy feito na página (`POST /api/contract/deploy`).
   */
  contract?: Contract;
  contractAddress?: string;
}

let context: KleverContext | undefined;

/** Lê o ABI gerado pelo build do contrato (`output/token-factory.abi.json`). */
export function loadContractAbi(): ContractABI {
  const path = fromPackageRoot(config.ABI_PATH);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ContractABI;
  } catch (err) {
    throw new Error(
      `Não consegui ler o ABI em ${path}. Rode o build do contrato (\`~/klever-sdk/ksc all build\`) ou ajuste ABI_PATH. Causa: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** Monta a rede a partir do .env: nome conhecido ou URLs customizadas. */
export function resolveNetwork():
  Network | "mainnet" | "testnet" | "devnet" | "local" {
  if (config.KLEVER_NODE_URL) {
    if (!config.KLEVER_CHAIN_ID) {
      throw new Error(
        "KLEVER_CHAIN_ID é obrigatório quando KLEVER_NODE_URL é definido",
      );
    }
    return createCustomNetwork({
      chainId: config.KLEVER_CHAIN_ID,
      node: config.KLEVER_NODE_URL,
      api: config.KLEVER_API_URL ?? config.KLEVER_NODE_URL,
      isTestnet: config.KLEVER_CHAIN_ID !== "108",
    });
  }
  return config.KLEVER_NETWORK;
}

export function createProvider(): KleverProvider {
  return new KleverProvider({ network: resolveNetwork() });
}

/**
 * Cria e conecta a carteira que assina as transações a partir do PEM em WALLET_PEM_PATH.
 *
 * O loader do klever-connect confere que a chave privada deriva o endereço do
 * cabeçalho do PEM; `connect()` só deriva chave pública e endereço localmente —
 * nenhum dos dois faz chamada de rede.
 */
export async function createWallet(
  provider: KleverProvider,
): Promise<NodeWallet> {
  if (!config.WALLET_PEM_PATH) {
    throw new Error("WALLET_PEM_PATH não configurado");
  }
  const pemPath = fromPackageRoot(config.WALLET_PEM_PATH);
  let privateKey: Uint8Array;
  try {
    ({ privateKey } = await loadPrivateKeyFromPemFile(pemPath, {
      ...(config.WALLET_PEM_PASSWORD
        ? { password: config.WALLET_PEM_PASSWORD }
        : {}),
    }));
  } catch (err) {
    throw new Error(
      `Não consegui carregar a carteira em ${pemPath}. Gere uma com \`npm run wallet:new\` ou ajuste WALLET_PEM_PATH. Causa: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const wallet = new NodeWallet(
    provider,
    Buffer.from(privateKey).toString("hex"),
  );
  await wallet.connect();
  return wallet;
}

/**
 * Inicializa provider + carteira + instância do contrato uma única vez.
 *
 * O `Contract` do klever-connect recebe o signer; ele reaproveita o provider da
 * carteira, então queries (readonly) e invokes (transação) saem da mesma instância.
 *
 * Sem CONTRACT_ADDRESS o servidor sobe mesmo assim, em modo "não configurado":
 * só `/api/contract` e `/api/contract/deploy` respondem até o deploy acontecer.
 */
export async function initKlever(): Promise<KleverContext> {
  if (context) return context;

  const provider = createProvider();
  const abi = loadContractAbi();
  const wallet = canSign ? await createWallet(provider) : undefined;

  context = {
    provider,
    network: provider.network,
    ...(wallet ? { wallet } : {}),
    abi,
  };

  if (config.CONTRACT_ADDRESS) setContractAddress(config.CONTRACT_ADDRESS);

  return context;
}

/** Aponta o backend para um TokenFactory (no boot, via .env, ou logo após o deploy). */
export function setContractAddress(address: string): Contract {
  const ctx = getKlever();
  const contract = new Contract(address, ctx.abi, ctx.wallet ?? ctx.provider);
  ctx.contract = contract;
  ctx.contractAddress = address;
  return contract;
}

export function getKlever(): KleverContext {
  if (!context)
    throw new Error("Klever não inicializado — chame initKlever() antes");
  return context;
}

/** Contexto com o contrato garantido; 503 quando ainda não há TokenFactory configurado. */
export function requireContract(): KleverContext & {
  contract: Contract;
  contractAddress: string;
} {
  const ctx = getKlever();
  if (!ctx.contract || !ctx.contractAddress) {
    throw unavailable(
      "Contrato não configurado: faça o deploy pela página ou defina CONTRACT_ADDRESS no .env",
    );
  }
  return ctx as KleverContext & { contract: Contract; contractAddress: string };
}
