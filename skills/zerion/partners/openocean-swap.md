# Zerion + OpenOcean Swap

**Purpose:** Find the best swap quotes and build swap transactions across 40+ chains (EVM, Solana, Sui) using OpenOcean, then execute the swap and verify the updated portfolio and DeFi positions using Zerion CLI.

## Setup

### Helper Functions

运行交易前，请在终端定义以下辅助函数，以便后续步骤调用：

```bash
# derive the RPC URL from the chain name
get_rpc() {
  case $1 in
    base)              echo "https://mainnet.base.org" ;;
    ethereum|eth|mainnet) echo "https://eth.llamarpc.com" ;;
    arbitrum|arb)      echo "https://arb1.arbitrum.io/rpc" ;;
    optimism|op)       echo "https://mainnet.optimism.io" ;;
    polygon|matic|poly) echo "https://polygon-rpc.com" ;;
    avalanche|avax)    echo "https://api.avax.network/ext/bc/C/rpc" ;;
    bsc|binance-smart-chain) echo "https://bsc-dataseed.binance.org" ;;
    gnosis|xdai)       echo "https://rpc.gnosischain.com" ;;
    scroll)            echo "https://rpc.scroll.io" ;;
    linea)             echo "https://rpc.linea.build" ;;
    zksync-era|zksync) echo "https://mainnet.era.zksync.io" ;;
    zora)              echo "https://rpc.zora.energy" ;;
    blast)             echo "https://rpc.blast.io" ;;
    monad)             echo "https://monad-testnet.blockpi.network/v1/rpc/public" ;;
    *)                 echo "https://mainnet.base.org" ;;
  esac
}

# Auto-approve helper (safely handles USDT-like zero-reset requirements)
auto_approve() {
  local token=$1 router=$2 amount_wei=$3
  echo "checking allowance..."
  local allowance=$(cast call --rpc-url $ETH_RPC_URL $token \
    "allowance(address,address)(uint256)" $WALLET $router)
  if [ "$allowance" -lt "$amount_wei" ]; then
    if [ "$allowance" -gt 0 ]; then
      echo "allowance non-zero but insufficient, resetting to 0 first (USDT protection)..."
      cast send --rpc-url $ETH_RPC_URL \
        --account "$CAST_ACCOUNT" --password "$CAST_PASSWORD" \
        $token "approve(address,uint256)" $router 0
    fi
    echo "approving..."
    cast send --rpc-url $ETH_RPC_URL \
      --account "$CAST_ACCOUNT" --password "$CAST_PASSWORD" \
      $token "approve(address,uint256)" $router $amount_wei
  else
    echo "allowance sufficient"
  fi
}
```

## When to use

- "Swap [amount] [token] to [token] on [chain]" (e.g., "swap 0.1 ETH to USDC on Base")
- "Swap X for Y" / "Convert X to Y" / "Trade X for Y"
- "Find the best swap route for 0.1 ETH to USDC on Base"
- "Swap native tokens using OpenOcean"
- "Get quote and execute ERC20 swap on Arbitrum"
- "Compare routes and execute a transaction using Foundry cast"

## Key Commands

**OpenOcean Skills (invoke in agent context):**
- `/quote` — Get the best swap quote and route from OpenOcean Aggregator
- `/swap-build` — Build the swap transaction calldata with slippage protection
- `/swap-execute` — Broadcast the built transaction using Foundry `cast`

**OpenOcean API (direct REST calls):**
- `GET https://open-api.openocean.finance/v4/:chain/quote` — Discover best quote
- `GET https://open-api.openocean.finance/v4/:chain/swap` — Get quote + calldata

**Zerion CLI (shell):**
- `zerion wallet list` — Find the agent's wallet address and details
- `zerion positions <address>` — Pre-swap token balance checks and post-swap verification
- `zerion portfolio <address>` — Verify overall portfolio changes after the swap

## Requirements

- OpenOcean AI skills: `npx skills add openocean-finance/OpenOcean-skills`
- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- For execution: [Foundry](https://getfoundry.sh/) (`cast`) installed and configured with your wallet credentials/RPC URL.
- `jq`: `brew install jq` / `apt install jq` (used for parsing JSON outputs)

## Wallet Setup

> **Critical:** OpenOcean `/swap-execute` and Foundry `cast` require access to the transaction signer key, which is managed separately from Zerion CLI's local OWS keystore. For the flow to work end-to-end, both tools must reference the same wallet address and key.

**Import your EVM key into Zerion CLI:**
```bash
zerion wallet import --name agent-bot --evm-key
```

**Import the same private key into Foundry `cast` (encrypted keystore — required by security hooks):**
```bash
cast wallet import agent-bot --interactive
```
Using the cast keystore keeps both layers encrypted. **Note: Direct use of `--private-key` is blocked by pre-tool security hooks. You must use Keystores.**

**Agent Interactive Password Retrieval:**
When running scripts, if the Keystore is password-protected, the Agent must:
1. Call `AskUserQuestion("请输入 Keystore 'agent-bot' 的密码：")` to securely retrieve the password.
2. Store the password in a temporary variable: `export CAST_PASSWORD="user_input"`
3. Define the account name: `export CAST_ACCOUNT="agent-bot"`

Set your signing wallet address variable:
```bash
export WALLET=<your-evm-address>
```

## Workflow

### 1. Pre-flight Balance and Wallet Check
Before performing a swap, use Zerion CLI to retrieve the default wallet address and confirm that the wallet has sufficient funds for both the swap amount and gas.

```bash
# 1. Get and export wallet address
export WALLET=$(zerion wallet list --json | jq -r '.wallets[0].evmAddress')

# 2. Set chain and derive RPC
CHAIN="base"
export ETH_RPC_URL=$(get_rpc $CHAIN)

# 3. Check token balances and positions
zerion positions $WALLET --chain $CHAIN
```

### 2. Discover the Best Quote (OpenOcean)
Use either the OpenOcean `/quote` skill or the REST API to find the optimal execution route and expected output amount.

> **⚠️ Pitfall:** The `gasPrice` parameter is **required** by the API — fetch it dynamically with `cast gas-price`. The `amount` parameter must be a **decimal string** (e.g. `"0.0001"`), NOT raw wei — passing wei units makes the API return garbled amounts.

**Option A: Using OpenOcean Quote Skill**
```
/quote 1 ETH to USDC on base
```

**Option B: Using OpenOcean REST API**
```bash
CHAIN="base"                                         # chain name
IN="0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"     # native ETH
OUT="0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913"    # USDC on Base
AMOUNT="0.0001"                                      # decimal, NOT wei

ETH_RPC_URL=$(get_rpc $CHAIN)
GAS_PRICE=$(cast gas-price --rpc-url $ETH_RPC_URL)

curl -s "https://open-api.openocean.finance/v4/${CHAIN}/quote?inTokenAddress=${IN}&outTokenAddress=${OUT}&amount=${AMOUNT}&gasPrice=${GAS_PRICE}" | jq '.data | {inToken, outToken, outAmount, dexes}'
```

### 3. Build the Swap Transaction
Use `/swap-build` or the REST API `/swap` endpoint to build the transaction payload. Note that the sender's wallet address must be specified in the `account` parameter to generate valid calldata.

> **⚠️ Pitfall:** The `account` parameter is required. The response fields live under `data.to`, `data.data`, `data.value`, `data.estimatedGas`, `data.chainId` — always use the `.data` prefix.

**Option A: Using OpenOcean Swap Build Skill**
```
/swap-build 1 ETH to USDC on base from <your-wallet-address> slippage 100
```

**Option B: Using OpenOcean REST API**
```bash
SWAP=$(curl -s "https://open-api.openocean.finance/v4/${CHAIN}/swap?inTokenAddress=${IN}&outTokenAddress=${OUT}&amount=${AMOUNT}&gasPrice=${GAS_PRICE}&slippage=1&account=${WALLET}")

TO=$(echo "$SWAP" | jq -r '.data.to')
VALUE=$(echo "$SWAP" | jq -r '.data.value')
DATA=$(echo "$SWAP" | jq -r '.data.data')
GAS=$(echo "$SWAP" | jq -r '.data.estimatedGas | tonumber | . * 1.5 | floor')
CHAIN_ID=$(echo "$SWAP" | jq -r '.data.chainId')
```

### 4. Execute the Swap

> **Native ETH swaps skip approval** — only ERC-20 inputs trigger the approve step.
>
> **MANDATORY CONFIRMATION GATE:** Before broadcasting any transaction (approval or swap), the Agent MUST present a summary of the action (tokens, amounts, chain, estimated gas, recipient) and call `AskUserQuestion` to get explicit user approval.

For ERC-20 token inputs, the OpenOcean Router must be approved to spend your tokens before the swap can succeed. The `auto_approve` helper (defined in the Setup section) checks allowance and sends an approve transaction if needed before broadcasting the swap.

To get `$AMOUNT_WEI` from a decimal amount:
```bash
DECIMALS=$(cast call --rpc-url $ETH_RPC_URL $TOKEN "decimals()(uint8)")
AMOUNT_WEI=$(echo "scale=0; $AMOUNT * 10^$DECIMALS / 1" | bc)
```

> **⚠️ Pitfall:** `cast send` uses `--gas-limit` (NOT `--gas`) to set the gas limit. Using `--gas` causes `unexpected argument '--gas' found`.

**Option A: Using OpenOcean Swap Execute Skill**
```
/swap-execute
```

**Option B: Using Foundry `cast` directly (Keystore Account)**

**Prerequisites Check**: Confirm `CAST_ACCOUNT` and `CAST_PASSWORD` are loaded. If not, ask the user.

```bash
# Auto-approve if input is ERC-20 (not native ETH)
IN_TOKEN_ADDR="0x..."  # the input token address
if [ "$IN_TOKEN_ADDR" != "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ]; then
  auto_approve $IN_TOKEN_ADDR $TO $AMOUNT_WEI
fi

# Convert hex value to decimal (cast --value requires decimal wei)
VALUE_DEC=$(python3 -c "print(int('$VALUE', 16))" 2>/dev/null || echo "$VALUE")

# Execute the swap
cast send --rpc-url $ETH_RPC_URL \
  --account "$CAST_ACCOUNT" \
  --password "$CAST_PASSWORD" \
  --value "$VALUE_DEC" \
  --gas-limit $GAS \
  --chain $CHAIN_ID \
  $TO $DATA
```

> **⚠️ Plaintext Private Keys (Blocked)**: Direct use of `--private-key` is blocked by pre-tool security hooks (`.claude/hooks/validate-forge-cast.sh`) to prevent accidental private key leaks in command logs. You must use `--account` and `--password` instead.

### 5. Post-Swap Verification (Zerion CLI)
Once the transaction is broadcast, monitor the transaction status. After confirmation, verify the updated balances and positions using the Zerion CLI.

```bash
# Verify new positions and token balances
zerion positions $WALLET --chain $CHAIN

# Verify total portfolio value and PnL changes
zerion portfolio $WALLET
zerion pnl $WALLET
```

# === 6. End-to-End Example (Base, 0.0001 ETH → USDC)

```bash
# === 1. Setup ===
CHAIN="base"
export ETH_RPC_URL=$(get_rpc $CHAIN)
export CAST_ACCOUNT="agent-bot"
# Retrieve password interactively via AskUserQuestion and export:
# export CAST_PASSWORD="user_password"

# === 2. Get wallet address ===
WALLET=$(zerion wallet list --json | jq -r '.wallets[0].evmAddress')
zerion positions $WALLET --chain $CHAIN

# === 3. Get quote (gasPrice fetched from RPC) ===
IN="0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
OUT="0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913"
AMOUNT="0.0001"
GAS_PRICE=$(cast gas-price --rpc-url $ETH_RPC_URL)

curl -s "https://open-api.openocean.finance/v4/${CHAIN}/quote?inTokenAddress=${IN}&outTokenAddress=${OUT}&amount=${AMOUNT}&gasPrice=${GAS_PRICE}" | jq '.data | {outAmount, dexes: [.dexes[].dexCode]}'

# === 4. Build swap tx ===
SWAP=$(curl -s "https://open-api.openocean.finance/v4/${CHAIN}/swap?inTokenAddress=${IN}&outTokenAddress=${OUT}&amount=${AMOUNT}&gasPrice=${GAS_PRICE}&slippage=1&account=${WALLET}")

TO=$(echo "$SWAP" | jq -r '.data.to')
VALUE=$(echo "$SWAP" | jq -r '.data.value')
DATA=$(echo "$SWAP" | jq -r '.data.data')
GAS=$(echo "$SWAP" | jq -r '.data.estimatedGas | tonumber | . * 1.5 | floor')
CHAIN_ID=$(echo "$SWAP" | jq -r '.data.chainId')

# === 5. Auto-approve + execute ===
if [ "$IN" != "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ]; then
  DECIMALS=$(cast call --rpc-url $ETH_RPC_URL $IN "decimals()(uint8)")
  AMOUNT_WEI=$(echo "scale=0; $AMOUNT * 10^$DECIMALS / 1" | bc)
  auto_approve $IN $TO $AMOUNT_WEI
fi

# Convert hex value to decimal
VALUE_DEC=$(python3 -c "print(int('$VALUE', 16))" 2>/dev/null || echo "$VALUE")

# Execute swap (Confirmation gate required before executing)
cast send --rpc-url $ETH_RPC_URL \
  --account "$CAST_ACCOUNT" \
  --password "$CAST_PASSWORD" \
  --value "$VALUE_DEC" \
  --gas-limit $GAS \
  --chain $CHAIN_ID \
  $TO $DATA

# === 6. Verify ===
zerion positions $WALLET --chain $CHAIN
```

## Common Blockers

| Issue | Cause | Fix |
|---|---|---|
| Keystore or Key Mismatch | The address used to build OpenOcean swap does not match cast signer key | Ensure the EVM address in `zerion wallet list` and your cast account point to the exact same private key. |
| ERC-20 Swap Reverts | Insufficient spending allowance for OpenOcean Router | The auto-approve helper checks and approves the Router before execution. If it still reverts, the allowance may have been set too low — increase the approved amount. |
| Approve tx fails | Token has special approve behavior (USDT requires reset to 0 first) | The optimized `auto_approve` helper resets to 0 automatically. If using other tools, manually approve 0 first: `cast send $TOKEN "approve(address,uint256)" $ROUTER 0`, then retry with the desired amount. |
| Price Slippage Revert | Market price moved faster than the slippage limit (default 1%) | Increase the slippage percentage in the `/swap-build` request (e.g. `slippage 200` for 2%). |
| Token Decimals Mismatch | Amount passed in raw units was computed with wrong decimals | Double check the decimals of the input token using the OpenOcean token list or the `/references/token-registry.md` before converting. |
| API 400: `gasPrice` required | Missing `gasPrice` query parameter | Fetch gas price from RPC: `GAS_PRICE=$(cast gas-price --rpc-url $ETH_RPC_URL)`. |
| Unknown chain RPC | Chain not in `get_rpc` mapping, or public RPC rate-limited | Set `ETH_RPC_URL` explicitly before running, or add the chain to the `get_rpc` function. |
| Garbled amounts from API | `amount` passed in wei instead of decimal string | Pass amount as a human-readable decimal string (e.g. `"0.0001"`), NOT raw wei. |
| `cast send` error: `unexpected argument '--gas' found` | `cast` uses `--gas-limit`, not `--gas` | Replace `--gas` with `--gas-limit`. |
| `ETH_RPC_URL` not set | `get_rpc` not called before `cast` | Run `export ETH_RPC_URL=$(get_rpc $CHAIN)` first, or set it manually. |
| Non-EVM Swap Execution | Trying to execute Solana/Sui swaps using EVM execution tools | Use chain-specific wallet clients (e.g., Solana web3.js/Sui SDK) instead of `cast` for non-EVM transaction signing and broadcasting. |

## Related Skills

- **capabilities/analyze.md** — Portfolio and positions tracking to check balances pre- and post-swap.
- **capabilities/wallet.md** — Wallet management to retrieve default keys and addresses.
