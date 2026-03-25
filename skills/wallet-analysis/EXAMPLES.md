# Wallet Analysis Examples

## Full wallet analysis

```bash
zerion-cli wallet analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

Returns portfolio total, top 10 positions, 5 recent transactions, and PnL -- all in one call.

## Full analysis with x402 (no API key)

```bash
zerion-cli wallet analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --x402
```

## DeFi positions only

```bash
zerion-cli wallet positions 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --positions defi
```

Returns only DeFi protocol positions (staking, lending, LP, borrowed).

## Positions on a specific chain

```bash
zerion-cli wallet positions 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --chain base
```

## Transaction history with custom limit

```bash
zerion-cli wallet transactions 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --limit 25
```

## Chain-specific transactions

```bash
zerion-cli wallet transactions 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --chain ethereum --limit 20
```

## Portfolio overview only

```bash
zerion-cli wallet portfolio 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

Returns total value, chain breakdown, and 1-day change.

## PnL only

```bash
zerion-cli wallet pnl 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

Returns realized/unrealized gains, total invested, fees.

## Example wallets

- `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` -- vitalik.eth
- `0xFe89Cc7Abb2C4183683Ab71653c4cCd1b9cC194e` -- ENS DAO treasury
- `0x25F2226B597E8F9514B3F68F00F494CF4F286491` -- Aave collector
