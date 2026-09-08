# TokenFactory

Fábrica de tokens KDA na Klever: um smart contract em Rust que emite, minta e queima tokens (fungível, NFT e SFT), e um servidor Node com uma página web para operar o contrato.

```
token-factory/   contrato (Rust → wasm)
server/          backend Express + frontend em server/public
```

## Pré-requisitos

- Node 20 ou mais novo
- Rust e o SDK da Klever em `~/klever-sdk` (só para buildar o contrato)
- Uma carteira com KLV na testnet para pagar as taxas

## Rodando em 4 passos

### 1. Build do contrato

```bash
cd token-factory
~/klever-sdk/ksc all build
```

Gera `output/token-factory.wasm` e `output/token-factory.abi.json`. O servidor lê os dois daí.

### 2. Configurar o servidor

```bash
cd server
npm install
cp .env.example .env
```

O `.env` já vem apontando para a testnet e para os artefatos do passo 1. Só falta a carteira:

```bash
npm run wallet:new      # cria walletKey.pem e imprime o endereço
```

Pegue KLV de teste para esse endereço no faucet: <https://testnet.kleverscan.org/faucet>

Já tem uma carteira em PEM no formato Klever? Aponte `WALLET_PEM_PATH` para ela.

### 3. Subir o servidor

```bash
npm run dev             # recarrega ao mudar o código
```

Abra <http://localhost:3000>.

### 4. Deploy do contrato

Na primeira vez a página mostra o card **Nenhum TokenFactory configurado**. Clique em **Fazer deploy do contrato**: o backend sobe o contrato com a sua carteira, passa a usá-lo na hora e grava o endereço em `CONTRACT_ADDRESS` no `.env`.

Prefere o terminal? `npm run deploy:contract` faz a mesma coisa.

Já tem um contrato no ar? Coloque o endereço em `CONTRACT_ADDRESS` antes de subir o servidor e pule este passo.

## Depois disso

Tudo acontece pela página: emitir tokens, mintar, queimar, transferir propriedade, pausar o contrato. A API REST por trás está documentada em `server/src/routes`.

Fluxos automatizados pelo terminal, úteis para conferir que está tudo funcionando:

```bash
npm run demo            # emite um token fungível, minta, lista e queima
npm run demo:sft        # emite um SFT, cria edições, minta por nonce e queima
```

## Problemas comuns

**Editei o `.env` e nada mudou.** O arquivo é lido só no boot. Pare o servidor e suba de novo, mesmo com `npm run dev`.

**Subi o servidor e a página continua mostrando o estado antigo.** Provavelmente outro processo ainda segura a porta 3000 e o novo não conseguiu abrir. Veja quem está na porta e encerre:

```bash
lsof -ti :3000 | xargs kill
```

**"Wasm não encontrado".** Falta o passo 1, ou `WASM_PATH` no `.env` aponta para outro lugar.

**Mint de NFT recusado com "invalid argument".** A rede limita a 50 NFTs por transação. Divida em lotes.

**Servidor em modo somente leitura.** Sem `WALLET_PEM_PATH` o servidor sobe, mas só responde consultas. Configure a carteira para emitir, mintar e queimar.
