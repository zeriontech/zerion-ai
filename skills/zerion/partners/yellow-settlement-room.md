---
name: zerion-yellow-settlement-room
description: >
  Open a multiparty Yellow Network app session for agents that need to pool funds,
  reallocate them off-chain, and cooperatively settle a final split. Use Zerion CLI
  to select and inspect participant wallets before funding and to verify later
  on-chain activity.
license: MIT
---

# Yellow Multiparty Settlement Room

**Purpose:** Use Zerion CLI to inspect agent wallets and their on-chain funding readiness, then use the Yellow Network Protocol to run a shared, multiparty settlement room with fast off-chain reallocations and one cooperative final split.

Use this for three or more agents that share one budget or outcome. A Yellow app session tracks every participant in one object; it is not a collection of bilateral payment rails.

## Key Commands

- `zerion wallet list` — list Zerion wallets and their EVM addresses
- `zerion portfolio <address|name>` — inspect public on-chain holdings before funding Yellow
- `zerion history <address|name>` — inspect later on-chain channel funding or withdrawal activity
- `client.getBalances(wallet)` — read a participant's account balance at Yellow
- `client.createAppSession(...)` — create the multiparty session
- `client.submitAppSessionDeposit(...)` — commit a participant's Yellow balance to the session
- `client.submitAppState(...)` — operate, withdraw from, or close the session

## Requirements

- Node.js 20+ with an ESM project (`"type": "module"`)
- npm 11.10+ (older npm silently ignores the cooldown flag below)
- Yellow SDK: `npm install --min-release-age=15 @yellow-org/sdk decimal.js viem`
- Zerion CLI: `npm install -g --min-release-age=15 zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- One EVM key and one Yellow client per participant
- An RPC URL, chain ID, asset address, and Yellow node WebSocket URL
- A funded Yellow account balance for every participant that will deposit

The Yellow sandbox WebSocket is `wss://nitronode-sandbox.yellow.org/v1/ws`. Use sandbox assets and chain configuration together; do not mix sandbox and production addresses.

### Supply-chain cooldown on installs

Every dependency here runs in the same process as participant private keys, so a compromised release can sign or exfiltrate on its own. Compromised npm releases are usually detected and unpublished within days, so never install a freshly published version: require a rolling release age instead.

```bash
# Set the cooldown once for the agent project instead of per command.
npm config set min-release-age 15 --location=project   # writes ./.npmrc
npm --version                                          # must be >= 11.10
```

- `min-release-age` only affects version _resolution_. Commit `package-lock.json` and use `npm ci` for every later install so each agent process runs the same already-vetted tree.
- Only bypass it — `--min-release-age=0` — for a security patch you have deliberately reviewed, and commit the resulting lockfile change with a reason.
- Confirm what actually resolved before running any code that touches keys: `npm ls @yellow-org/sdk decimal.js viem`.

## Workflow

### 1. Select wallets and inspect on-chain funding readiness

```bash
# Find the EVM address controlled by each agent.
zerion wallet list

# Check that each intended depositor holds the settlement asset and native gas
# on the chain used to fund its Yellow account.
zerion portfolio <agent-a-address-or-wallet-name>
zerion portfolio <agent-b-address-or-wallet-name>
zerion portfolio <agent-c-address-or-wallet-name>
```

Zerion reports public on-chain holdings. It does not report balances already inside a Yellow account or allocations inside an app session.

Funding a Yellow account is a one-time on-chain prerequisite. Follow the current [Yellow quickstart](https://docs.yellow.org/nitrolite/build/getting-started/quickstart) for that transaction flow. Before opening or depositing into a session, verify the Yellow-side balance:

```ts
const balances = await client.getBalances(wallet);
// Stop if this participant's balance for `asset` is below its planned deposit.
```

Only participants that deposit need a funded Yellow account. Never treat `zerion portfolio` as proof that funds have already reached Yellow; `client.getBalances(wallet)` is authoritative for that.

### 2. Connect one Yellow client per agent

```ts
import { Client, createSigners, withBlockchainRPC } from '@yellow-org/sdk';

async function connect(
  privateKey: `0x${string}`,
  wsURL: string,
  chainId: bigint,
  rpcURL: string,
) {
  const signers = createSigners(privateKey);
  return Client.create(
    wsURL,
    signers.stateSigner,
    signers.txSigner,
    withBlockchainRPC(chainId, rpcURL),
  );
}
```

Keep each agent's key in its own process. The proposer sends a packed state hash to the required agents; each agent signs that same hash and returns only its signature. The submitter collects signatures whose weights meet quorum.

### 3. Open a unanimous multiparty session

```ts
import {
  AppSessionWalletSignerV1,
  EthereumMsgSigner,
  packCreateAppSessionRequestV1,
  type AppDefinitionV1,
} from '@yellow-org/sdk';

const definition: AppDefinitionV1 = {
  applicationId: `agent-room-${Date.now().toString(36)}`,
  participants: [
    { walletAddress: addrA, signatureWeight: 1 },
    { walletAddress: addrB, signatureWeight: 1 },
    { walletAddress: addrC, signatureWeight: 1 },
  ],
  quorum: 3,
  nonce:
    BigInt(Date.now()) * 1_000_000n +
    BigInt(Math.floor(Math.random() * 1_000_000)),
};

const sessionData = JSON.stringify({ intent: 'init' });
const createPayload = packCreateAppSessionRequestV1(definition, sessionData);

// Each signature is produced by the matching agent in its own process:
const signatureA = await new AppSessionWalletSignerV1(
  new EthereumMsgSigner(pkA),
).signMessage(createPayload);
const signatureB = await new AppSessionWalletSignerV1(
  new EthereumMsgSigner(pkB),
).signMessage(createPayload);
const signatureC = await new AppSessionWalletSignerV1(
  new EthereumMsgSigner(pkC),
).signMessage(createPayload);

const created = await clientA.createAppSession(definition, sessionData, [
  signatureA,
  signatureB,
  signatureC,
]);
const appSessionId = created.appSessionId;

// LOCAL SMOKE TEST ONLY. Production agents must sign in separate processes
// and return their signatures over an authenticated transport.
const localTestSigners = [
  new AppSessionWalletSignerV1(new EthereumMsgSigner(pkA)),
  new AppSessionWalletSignerV1(new EthereumMsgSigner(pkB)),
  new AppSessionWalletSignerV1(new EthereumMsgSigner(pkC)),
];
async function collectQuorumSignatures(payload: `0x${string}`) {
  return Promise.all(
    localTestSigners.map((signer) => signer.signMessage(payload)),
  );
}
```

The three private keys appear together only to make the local lifecycle copy-pasteable. In production, replace `collectQuorumSignatures` with authenticated message transport and do not colocate keys. The participant set is immutable after creation.

Equal weights with `quorum` equal to their sum is the safe default. Any subset whose weights reach quorum can settle without the others, so lower quorum only when that coalition is intentionally trusted.

### 4. Deposit a participant's Yellow balance

Read live state immediately before every update. The next version must be exactly the current version plus one.

```ts
import {
  AppStateUpdateIntent,
  packAppStateUpdateV1,
  type AppStateUpdateV1,
} from '@yellow-org/sdk';
import { Decimal } from 'decimal.js';

const { sessions } = await clientA.getAppSessions({ appSessionId });
const session = sessions[0];
if (!session) throw new Error('session not found');

const clientBudget = new Decimal('10');
const deposit: AppStateUpdateV1 = {
  appSessionId,
  intent: AppStateUpdateIntent.Deposit,
  version: session.version + 1n,
  allocations: [
    { participant: addrA, asset, amount: clientBudget },
  ],
  sessionData: JSON.stringify({ intent: 'fund' }),
};

const depositPayload = packAppStateUpdateV1(deposit);
const depositSignatures = await collectQuorumSignatures(depositPayload);

await clientA.submitAppSessionDeposit(
  deposit,
  depositSignatures,
  asset,
  clientBudget,
);
```

List only the depositing participant in a deposit allocation. The explicit amount must equal the deposit allocation total.

`collectQuorumSignatures` represents the integrator's transport: send the packed hash to each independent agent, collect their signatures, and return enough signatures to meet quorum. Yellow does not provide that transport.

### 5. Reallocate off-chain

An `Operate` update restates every non-zero allocation; it is not a delta. Per-asset totals must remain constant.

```ts
const { sessions: currentSessions } = await clientA.getAppSessions({
  appSessionId,
});
const current = currentSessions[0];
if (!current) throw new Error('session not found');

const payout: AppStateUpdateV1 = {
  appSessionId,
  intent: AppStateUpdateIntent.Operate,
  version: current.version + 1n,
  allocations: [
    { participant: addrA, asset, amount: new Decimal('4') },
    { participant: addrB, asset, amount: new Decimal('4') },
    { participant: addrC, asset, amount: new Decimal('2') },
  ],
  sessionData: JSON.stringify({ round: 'final-split' }),
};

const payoutPayload = packAppStateUpdateV1(payout);
await clientA.submitAppState(
  payout,
  await collectQuorumSignatures(payoutPayload),
);
```

Repeat `Operate` for additional milestones. These updates are off-chain and do not consume gas.

### 6. Close on the agreed final split

```ts
const { sessions: finalSessions } = await clientA.getAppSessions({
  appSessionId,
});
const finalSession = finalSessions[0];
if (!finalSession) throw new Error('session not found');

const close: AppStateUpdateV1 = {
  appSessionId,
  intent: AppStateUpdateIntent.Close,
  version: finalSession.version + 1n,
  allocations: finalSession.allocations,
  sessionData: JSON.stringify({ intent: 'close' }),
};

const closePayload = packAppStateUpdateV1(close);
await clientA.submitAppState(
  close,
  await collectQuorumSignatures(closePayload),
);
```

`Close` must restate the current allocation exactly and is terminal. It releases allocations back to the participants' Yellow channels, where they are available for the separate on-chain withdrawal flow.

After a participant completes an on-chain withdrawal from Yellow, use Zerion to confirm the public transaction and resulting wallet state:

```bash
zerion history <participant-address-or-wallet-name> --limit 20
zerion portfolio <participant-address-or-wallet-name>
```

Do not expect Zerion to show an off-chain app-session allocation or a channel balance.

## Trust Boundary

- No participant can change another participant's allocation without signatures whose weights meet quorum.
- Yellow is trusted for liveness and honest relay. A released state becomes on-chain enforceable only after the node co-signs it.
- App sessions have no independent dispute, challenge, or timeout mechanism. If quorum is never reached, the session can deadlock.
- A participant's deposit is its exposure ceiling.
- This is cooperative off-chain settlement, not trustless on-chain escrow. State that before moving value.

## Common Blockers

- **Yellow deposit fails with `no channel state to advance`** — the depositor's Yellow account is not funded; check `client.getBalances(wallet)`.
- **Wallet has assets but Yellow balance is zero** — Zerion shows on-chain holdings, not Yellow account balances; complete the Yellow funding flow first.
- **Version conflict** — re-read the live session, rebuild the update with `version + 1n`, and recollect every signature.
- **Quorum never arrives** — the session cannot progress or close; resolve cooperation off protocol.
- **Allocation total changes during `Operate`** — restate all non-zero allocations and preserve the total for each asset.
- **Expected settlement is missing from Zerion** — closing only returns funds to Yellow channels; complete an on-chain withdrawal before checking Zerion.
- **Node will not co-sign release** — surface the session as stuck; do not report settlement as complete.

## Related Skills

- **capabilities/analyze.md** — inspect participant holdings and on-chain history
- **capabilities/wallet.md** — list wallets and get deposit addresses
- **capabilities/trading.md** — swap or bridge assets before funding a Yellow account
