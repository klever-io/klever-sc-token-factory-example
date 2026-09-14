import { Router } from "express";

import { createKleverAddress } from "@klever/connect";

import { config } from "../config.js";
import { getKlever } from "../klever.js";
import { HttpError } from "../lib/errors.js";
import { asyncRoute, jsonSafe } from "../lib/http.js";
import { deployContract, wasmAvailable } from "../services/deploy.js";
import * as factory from "../services/token-factory.js";

export const contractRouter: Router = Router();

/**
 * Estado geral do contrato — junta duas views numa chamada só.
 *
 * Sem contrato configurado responde `configured: false` com o que a página
 * precisa para oferecer o deploy (rede, signer, se o wasm existe).
 */
contractRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const { contractAddress, network, wallet } = getKlever();

    const base = {
      configured: Boolean(contractAddress),
      address: contractAddress ?? null,
      network: {
        name: network.name,
        chainId: network.chainId,
        api: network.config.api,
        node: network.config.node,
        explorer: network.config.explorer,
      },
      signer: wallet
        ? {
            address: wallet.address,
            explorerUrl: `${network.config.explorer}/account/${wallet.address}`,
          }
        : null,
      mode: wallet ? "read-write" : "read-only",
      waitForTxDefault: config.WAIT_FOR_TX,
    };

    if (!contractAddress) {
      res.json(
        jsonSafe({
          ...base,
          paused: null,
          totalIssued: null,
          canDeploy: Boolean(wallet) && wasmAvailable(),
          wasmAvailable: wasmAvailable(),
        }),
      );
      return;
    }

    const [paused, totalIssued] = await Promise.all([
      factory.isPaused(),
      factory.getTotalIssued(),
    ]);

    res.json(
      jsonSafe({
        ...base,
        paused,
        totalIssued,
        explorerUrl: `${network.config.explorer}/account/${contractAddress}`,
      }),
    );
  }),
);

/**
 * POST /api/contract/deploy — sobe um TokenFactory novo com a carteira do backend.
 *
 * Só quando ainda não há contrato configurado: com CONTRACT_ADDRESS definido a
 * rota responde 409, para ninguém trocar o contrato em uso por um clique.
 * O endereço novo é gravado no .env para sobreviver a restarts.
 */
contractRouter.post(
  "/deploy",
  asyncRoute(async (_req, res) => {
    const { contractAddress } = getKlever();
    if (contractAddress) {
      throw new HttpError(
        409,
        `Já existe um contrato configurado (${contractAddress}). Remova CONTRACT_ADDRESS do .env para fazer outro deploy`,
      );
    }
    res.json(jsonSafe(await deployContract()));
  }),
);

contractRouter.get(
  "/paused",
  asyncRoute(async (_req, res) => {
    res.json({ paused: await factory.isPaused() });
  }),
);

contractRouter.get(
  "/total-issued",
  asyncRoute(async (_req, res) => {
    res.json(jsonSafe({ totalIssued: await factory.getTotalIssued() }));
  }),
);

/** Saldo da carteira do backend — útil para conferir se há KLV para as taxas. */
contractRouter.get(
  "/signer",
  asyncRoute(async (_req, res) => {
    const { wallet, provider } = getKlever();
    if (!wallet) {
      res.status(503).json({ error: "Servidor em modo somente-leitura" });
      return;
    }
    const account = await provider.getAccount(
      createKleverAddress(wallet.address),
      {
        skipCache: true,
      },
    );
    res.json(
      jsonSafe({
        address: wallet.address,
        nonce: account.nonce,
        balanceKLV: account.balance,
        assets: account.assets ?? [],
      }),
    );
  }),
);
