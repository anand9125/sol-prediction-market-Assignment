# 🔮 Prediction Market — Solana Smart Contract

A decentralized binary prediction market built on Solana using the Anchor framework. Users can take positions on binary outcomes by splitting collateral into outcome tokens, trading them freely, and claiming rewards when the market settles.

---

## 📖 How It Works

The protocol is built around a simple mechanic: **1 unit of collateral = 1 Outcome A token + 1 Outcome B token**.

1. **Deposit collateral** → receive equal amounts of `Outcome A` and `Outcome B` tokens
2. **Sell the side you don't believe in** → hold only the side you believe in
3. **Wait for settlement** → authority declares a winner
4. **Burn winning tokens** → redeem 1:1 for collateral

> Losing tokens become worthless. Winning tokens redeem at full collateral value.

---

## ✅ Instructions

### 1. `initialize_market`
Creates a new prediction market.

**Accounts required:**
- `authority` — Market creator (signer)
- `market` — PDA storing market state `[b"market", market_id]`
- `outcome_a_mint` — SPL Mint for Outcome A tokens
- `outcome_b_mint` — SPL Mint for Outcome B tokens
- `collateral_mint` — SPL Mint of the accepted collateral (e.g. USDC)
- `collateral_vault` — Token account that holds locked collateral

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `market_id` | `u32` | Unique identifier for the market |
| `settlement_deadline` | `i64` | Unix timestamp — market expires after this |

**Validations:**
- `settlement_deadline` must be in the future

---

### 2. `split_tokens`
Deposit collateral and receive equal Outcome A + Outcome B tokens.

**Accounts required:**
- `user` — Signer
- `market` — Market PDA
- `user_collateral` — User's collateral token account (source)
- `collateral_vault` — Vault token account (destination)
- `outcome_a_mint` — Outcome A mint (minted by market PDA)
- `outcome_b_mint` — Outcome B mint (minted by market PDA)
- `user_outcome_a` — User's Outcome A token account
- `user_outcome_b` — User's Outcome B token account

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `market_id` | `u32` | Target market |
| `amount` | `u64` | Amount of collateral to deposit |

**What happens:**
```
User deposits 100 USDC
→ Vault receives 100 USDC
→ User receives 100 Outcome A tokens
→ User receives 100 Outcome B tokens
→ market.total_collateral_locked += 100
```

**Validations:**
- Market must not be settled
- Must be before `settlement_deadline`
- `amount > 0`

---

### 3. `merge_tokens`
Burn equal amounts of Outcome A + Outcome B tokens to reclaim collateral.

**Accounts required:**
- `user` — Signer
- `market` — Market PDA
- `user_outcome_a` — User's Outcome A token account
- `user_outcome_b` — User's Outcome B token account
- `outcome_a_mint` — Outcome A mint (burned)
- `outcome_b_mint` — Outcome B mint (burned)
- `collateral_vault` — Vault token account (source)
- `user_collateral` — User's collateral account (destination)

**What happens:**
```
User has 100 Outcome A + 60 Outcome B
→ merge amount = min(100, 60) = 60
→ Burns 60 Outcome A + 60 Outcome B
→ User receives 60 USDC back
→ market.total_collateral_locked -= 60
```

**Validations:**
- Market must not be settled
- Must be before `settlement_deadline`
- Merged amount must be > 0

---

### 4. `set_winning_side`
Authority declares which outcome won and permanently closes minting.

**Accounts required:**
- `authority` — Market authority (signer, must match `market.authority`)
- `market` — Market PDA
- `outcome_a_mint` — Outcome A mint
- `outcome_b_mint` — Outcome B mint

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `market_id` | `u32` | Target market |
| `winner` | `WinningOutcome` | `OutcomeA` or `OutcomeB` |

**What happens:**
```
Authority calls set_winning_side(OutcomeA)
→ market.is_settled = true
→ market.winning_outcome = Some(OutcomeA)
→ Outcome A mint authority → None (frozen, no more minting)
→ Outcome B mint authority → None (frozen, no more minting)
```

**Validations:**
- Market must not already be settled
- Must be before `settlement_deadline`
- `winner` must be `OutcomeA` or `OutcomeB`

> ⚠️ Once called, minting is **permanently disabled** for both outcome mints. This is irreversible.

---

### 5. `claim_rewards`
Burn winning outcome tokens and redeem collateral 1:1.

**Accounts required:**
- `user` — Signer
- `market` — Market PDA
- `outcome_a_mint` — Outcome A mint
- `outcome_b_mint` — Outcome B mint
- `user_outcome_a` — User's Outcome A token account
- `user_outcome_b` — User's Outcome B token account
- `collateral_vault` — Vault token account (source)
- `user_collateral` — User's collateral account (destination)

**What happens:**
```
Market settled: OutcomeA wins
User holds: 150 Outcome A tokens

→ Burns 150 Outcome A tokens
→ User receives 150 USDC from vault
→ market.total_collateral_locked -= 150
```

**Validations:**
- Market must be settled (`is_settled = true`)
- Winning outcome must be set

---

## 🔄 Full User Flow

```
                        BEFORE SETTLEMENT
                        ─────────────────

  User
   │
   ├─ split_tokens(100 USDC)
   │   ├─ Vault  ← 100 USDC
   │   ├─ User   ← 100 Outcome A
   │   └─ User   ← 100 Outcome B
   │
   ├─ [User trades Outcome B on open market, keeps Outcome A]
   │
   └─ merge_tokens() [optional, before deadline]
       ├─ Burns min(A_bal, B_bal) of each
       └─ User ← collateral back


                        AFTER SETTLEMENT
                        ────────────────

  Authority
   └─ set_winning_side(OutcomeA)
       ├─ market.is_settled = true
       └─ Both mints → frozen

  User (holds 150 Outcome A)
   └─ claim_rewards()
       ├─ Burns 150 Outcome A
       └─ User ← 150 USDC
```

---

## 🏗️ State

### `Market` Account (PDA: `[b"market", market_id]`)

| Field | Type | Description |
|-------|------|-------------|
| `authority` | `Pubkey` | Who can settle the market |
| `market_id` | `u32` | Unique market identifier |
| `settlement_deadline` | `i64` | Unix timestamp expiry |
| `outcome_a_mint` | `Pubkey` | Mint address for Outcome A |
| `outcome_b_mint` | `Pubkey` | Mint address for Outcome B |
| `collateral_mint` | `Pubkey` | Accepted collateral token |
| `collateral_vault` | `Pubkey` | Vault holding locked collateral |
| `is_settled` | `bool` | Whether market is closed |
| `winning_outcome` | `Option<WinningOutcome>` | `None` until settled |
| `total_collateral_locked` | `u64` | Total USDC locked in vault |
| `bump` | `u8` | PDA bump seed |

### `WinningOutcome` Enum

```rust
pub enum WinningOutcome {
    OutcomeA,
    OutcomeB,
}
```

---

## 🔐 Security Model

| Concern | How It's Handled |
|---------|-----------------|
| Only authority can settle | `has_one = authority` constraint on `SetWinner` |
| No minting after settlement | Mint authority set to `None` on settlement |
| No double settlement | `require!(!market.is_settled)` check |
| Vault signed by PDA | `CpiContext::new_with_signer` with market PDA seeds |
| No negative math | `checked_add` / `checked_sub` on all collateral accounting |
| Expired market protection | `settlement_deadline` checked on split/merge/settle |

---

## 🚀 Getting Started

### Prerequisites

- Rust (stable)
- Solana CLI
- Anchor CLI (`cargo install --git https://github.com/coral-xyz/anchor anchor-cli`)
- Node.js (for tests)

### Build

```bash
anchor build
```

### Test

```bash
anchor test
```

### Deploy (Devnet)

```bash
anchor deploy --provider.cluster devnet
```

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|------------|
| Blockchain | Solana |
| Framework | Anchor |
| Token Standard | SPL Token |
| Language | Rust |
| Tests | TypeScript + Anchor Mocha |

---

## 📄 License

MIT
