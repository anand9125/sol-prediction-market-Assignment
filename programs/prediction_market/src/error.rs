use anchor_lang::prelude::*;

#[error_code]
pub enum PredictionMarketError {
    #[msg("Invalid settlement deadline")]
    InvalidSettlementDeadline,
    #[msg("Market already settled")]
    MarketAlreadySettled,
    #[msg("Market has expired")]
    MarketExpired,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid wining out come")]
    InvalidWinningOutcome,
    #[msg("Market is not setteld yet")]
    MarketNotSettled,
     #[msg("Winning outcome is not set yet")]
    WinningOutcomeNotSet,
   
}


   
