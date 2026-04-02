---
name: wallet-setup
description: Set up a new Zerion wallet with agent tokens and security policies
---

Guide the user through the complete wallet + agent setup flow.

## Steps

1. **Check prerequisites**:
   ```bash
   which zerion || echo "Install: npm install -g zerion"
   ```

2. **Check API key**:
   ```bash
   zerion config list
   ```
   If no API key, instruct: `export ZERION_API_KEY="zk_dev_..."` (get from dashboard.zerion.io)

3. **Create wallet + agent token**:

   **Option A — Fully automated** (no prompts, best for agents):
   ```bash
   zerion wallet create --name <name> --agent
   ```
   Creates wallet, generates passphrase internally, creates agent token, saves token to config.

   **Option B — Interactive** (prompts for passphrase, then offers agent token):
   ```bash
   zerion wallet create --name <name>
   ```
   After creation, the CLI asks "Create an agent token?" — saying yes saves it to config.

4. **Show funding addresses**:
   ```bash
   zerion wallet fund --wallet <name>
   ```

5. **Optional — Create security policy**:
   ```bash
   zerion agent create-policy --name <policy-name> --chains base,arbitrum --deny-transfers
   ```

6. **Trade** — agent token is read from config automatically:
   ```bash
   zerion swap ETH USDC 0.01 --chain base --yes
   zerion send ETH 0.01 --to 0x... --chain base --yes
   ```

The agent token is required for all trading commands and is saved to `~/.zerion/config.json` automatically.
