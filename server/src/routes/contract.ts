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
 * Overall contract state — combines two views in a single call.
 *
 * With no contract configured it responds `configured: false` with what the page
 * needs to offer the deploy (network, signer, whether the wasm exists).
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
 * POST /api/contract/deploy — deploys a new TokenFactory with the backend wallet.
 *
 * Only when no contract is configured yet: with CONTRACT_ADDRESS set the
 * route responds 409, so nobody swaps the contract in use with one click.
 * The new address is written to .env to survive restarts.
 */
contractRouter.post(
  "/deploy",
  asyncRoute(async (_req, res) => {
    const { contractAddress } = getKlever();
    if (contractAddress) {
      throw new HttpError(
        409,
        `A contract is already configured (${contractAddress}). Remove CONTRACT_ADDRESS from .env to deploy another one`,
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

/** Backend wallet balance — useful to check there is KLV for fees. */
contractRouter.get(
  "/signer",
  asyncRoute(async (_req, res) => {
    const { wallet, provider } = getKlever();
    if (!wallet) {
      res.status(503).json({ error: "Server in read-only mode" });
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
