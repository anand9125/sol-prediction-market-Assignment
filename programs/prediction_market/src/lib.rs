use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, Burn, Transfer};
pub mod state;
pub mod instructions;
pub mod error;
use instructions::*;
use error::PredictionMarketError;
use state::WinningOutcome;

declare_id!("By5KbxUEFGs7NrQYLXcjmptft6yX2saVWvoA8sx7HzqT");

#[program]
pub mod prediction_market {
    use anchor_spl::token::{SetAuthority, spl_token::instruction::AuthorityType};

    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_id: u32,
        settlement_deadline: i64,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        
        require!(
            settlement_deadline > Clock::get()?.unix_timestamp,
            PredictionMarketError::InvalidSettlementDeadline
        );
        
        market.authority = ctx.accounts.authority.key();
        market.market_id = market_id;
        market.settlement_deadline = settlement_deadline;
        market.outcome_a_mint = ctx.accounts.outcome_a_mint.key();
        market.outcome_b_mint = ctx.accounts.outcome_b_mint.key();
        market.collateral_mint = ctx.accounts.collateral_mint.key();
        market.collateral_vault = ctx.accounts.collateral_vault.key();
        market.is_settled = false;
        market.winning_outcome = None;
        market.total_collateral_locked = 0;
        market.bump = ctx.bumps.market;
        
        msg!("Market initialized: {}", market.market_id);
        Ok(())
    }

    pub fn split_tokens(
        ctx: Context<SplitToken>,
        market_id: u32,
        amount: u64,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        
        require!(!market.is_settled, PredictionMarketError::MarketAlreadySettled);
        require!(
            Clock::get()?.unix_timestamp < market.settlement_deadline,
            PredictionMarketError::MarketExpired
        );
        require! (amount > 0, PredictionMarketError::InvalidAmount);
        
        // Transfer collateral from user to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_collateral.to_account_info(),
                    to: ctx.accounts.collateral_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;
        
        let market_id_bytes = market.market_id.to_le_bytes();
        let seeds = &[
            b"market",
            market_id_bytes.as_ref(),
            &[market.bump],
        ];
        let signer = &[&seeds[..]];
        
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.outcome_a_mint.to_account_info(),
                    to: ctx.accounts.user_outcome_a.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
        
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.outcome_b_mint.to_account_info(),
                    to: ctx.accounts.user_outcome_b.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
        
        market.total_collateral_locked = market.total_collateral_locked
            .checked_add(amount)
            .ok_or(PredictionMarketError::MathOverflow)?;
        
        msg!("Minted {} outcome tokens for user", amount);
        Ok(())
    }


    pub fn merge_tokens(ctx: Context<MergeToken>, market_id: u32,) -> Result<()> {
        
        let market = &mut ctx.accounts.market;

        require!(!market.is_settled, PredictionMarketError::MarketAlreadySettled);
        require!(
            Clock::get()?.unix_timestamp < market.settlement_deadline,
            PredictionMarketError::MarketExpired
        );

        let a_bal = ctx.accounts.user_outcome_a.amount;
        let b_bal = ctx.accounts.user_outcome_b.amount;

        let amount = a_bal.min(b_bal);

        require!(amount > 0, PredictionMarketError::InvalidAmount);

        token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.outcome_a_mint.to_account_info(),
                from: ctx.accounts.user_outcome_a.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
        )?;
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.outcome_b_mint.to_account_info(),
                    from: ctx.accounts.user_outcome_b.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;
        let market_id_bytes = market.market_id.to_le_bytes();
        let seeds: &[&[u8]] = &[
            b"market",
            market_id_bytes.as_ref(),
            &[market.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.collateral_vault.to_account_info(),
                    to: ctx.accounts.user_collateral.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        market.total_collateral_locked = market
                .total_collateral_locked
                .checked_sub(amount)
                .ok_or(PredictionMarketError::MathOverflow)?;

        msg!("Merged {} pairs of outcome tokens back to collateral", amount);
        Ok(())        
    }

    pub fn set_winning_side(
        ctx: Context<SetWinner>,
        market_id: u32,
        winner:WinningOutcome,) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(!market.is_settled, PredictionMarketError::MarketAlreadySettled);
         
        require!(
            Clock::get()?.unix_timestamp < market.settlement_deadline,
            PredictionMarketError::MarketExpired
        );

        require!(
            matches!(winner, WinningOutcome::OutcomeA | WinningOutcome::OutcomeB),
            PredictionMarketError::InvalidWinningOutcome
        );
        
       market.is_settled=true;
       
        market.winning_outcome = Some(winner);

   
        let market_id_bytes = market.market_id.to_le_bytes();
        let seeds = &[
            b"market",
            market_id_bytes.as_ref(),
            &[market.bump],
        ];
        let signer = &[&seeds[..]];

        token::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                account_or_mint: ctx.accounts.outcome_a_mint.to_account_info(),
                current_authority: market.to_account_info(),
            },
            signer,
        ),
            AuthorityType::MintTokens,
            None, 
        )?;

        token::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                account_or_mint: ctx.accounts.outcome_b_mint.to_account_info(),
                current_authority: market.to_account_info(),
            },
            signer,
        ),
            AuthorityType::MintTokens,
            None,
        )?;
       
        msg!("settled. Winner: {:?}", winner);
        Ok(())

    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>,market_id: u32) -> Result<()> {
       
    let market = &mut ctx.accounts.market;

    require!(market.is_settled, PredictionMarketError::MarketNotSettled);

   let winner = market
    .winning_outcome
    .ok_or_else(|| error!(PredictionMarketError::WinningOutcomeNotSet))?; 

    let (winner_mint_info, user_winner_ata) = match winner {
        WinningOutcome::OutcomeA => (
            ctx.accounts.outcome_a_mint.to_account_info(),
            &ctx.accounts.user_outcome_a,
        ),
        _ => (
            ctx.accounts.outcome_b_mint.to_account_info(),
            &ctx.accounts.user_outcome_b,
        ),
    };


    let amount = user_winner_ata.amount;

     token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: winner_mint_info,
                from: user_winner_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;
    
    let market_id_bytes = market.market_id.to_le_bytes();

    let seeds = &[
        b"market",
        market_id_bytes.as_ref(),
        &[market.bump],
    ];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.collateral_vault.to_account_info(),
                to: ctx.accounts.user_collateral.to_account_info(),
                authority: market.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    market.total_collateral_locked = market
        .total_collateral_locked
        .checked_sub(amount)
        .ok_or(PredictionMarketError::MathOverflow)?;
      

    msg!("Claimed {} collateral for winning side", amount);


        
        
        Ok(())

    }
}
