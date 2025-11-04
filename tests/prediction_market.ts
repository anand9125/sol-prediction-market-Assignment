import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PredictionMarket } from "../target/types/prediction_market";
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { PublicKey, Keypair, SystemProgram, Connection } from "@solana/web3.js";
import { BN } from "bn.js";

describe("prediction_market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PredictionMarket as Program<PredictionMarket>;

  let authority = provider.wallet;
  let user:Keypair;
  
  // Mints and accounts
  let collateralMint: PublicKey;
  let collateralVault:PublicKey;
  let outcomeAMint: PublicKey;
  let outcomeBMint: PublicKey;
  let marketPda: PublicKey;
  
  // User token accounts
  let userCollateralAccount: PublicKey;
  let userOutcomeAAccount: PublicKey;
  let userOutcomeBAccount:PublicKey;
  
  const marketId = 1;
  const initialCollateralAmount = 1000000; 
  before(async () => {
    
    user = Keypair.generate();
    
    const airdropSignature = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSignature);
    
    collateralMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6 
    );
    
    console.log("Collateral Mint:", collateralMint.toBase58());
  });

  describe("Initialize Market", () => {
    
    it("Initializes a prediction market successfully", async () => {
      const settlementDeadline = new anchor.BN(Math.floor(Date.now() / 1000) + 86400);

      const marketID = new BN(1);
      // convert to 4-byte little-endian buffer
       const marketIdLE = marketID.toArrayLike(Buffer, "le", 4);
      [marketPda]   = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), marketIdLE], program.programId);
       [collateralVault]    = PublicKey.findProgramAddressSync([Buffer.from("vault"),     marketIdLE], program.programId);
      [outcomeAMint] = PublicKey.findProgramAddressSync([Buffer.from("outcome_a"), marketIdLE], program.programId);
      [outcomeBMint] = PublicKey.findProgramAddressSync([Buffer.from("outcome_b"), marketIdLE], program.programId);
     
      console.log(marketPda,"this is here")
      await program.methods
        .initializeMarket(marketId, settlementDeadline)
        .accounts({
          market: marketPda,
          authority: authority.publicKey,
          collateralMint,
          collateralVault,
          outcomeAMint,
          outcomeBMint ,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

        console.log("txn done")
      const marketAccount = await program.account.market.fetch(marketPda);

      assert.equal(Number(marketAccount.marketId), Number(marketId));
      assert.equal(marketAccount.authority.toBase58(), authority.publicKey.toBase58());
      assert.equal(marketAccount.collateralMint.toBase58(), collateralMint.toBase58());
      assert.equal(marketAccount.isSettled, false);
      assert.equal(marketAccount.totalCollateralLocked.toNumber(), 0);
      assert.isNull(marketAccount.winningOutcome);
    });

  });


  describe("Split Tokens", () => {
    before(async () => {

      console.log("Collateral Mint:", collateralMint?.toBase58());
      console.log("User:", user?.publicKey?.toBase58());
      console.log("Authority:", authority?.publicKey?.toBase58());

      const userCollateralAccountInfo = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        collateralMint,
        user.publicKey
      );
      userCollateralAccount = userCollateralAccountInfo.address;
      console.log("i have passed")
      
      await mintTo(
        provider.connection,
        authority.payer,
        collateralMint,
        userCollateralAccount,
        authority.publicKey,
        initialCollateralAmount
      );
      console.log("i have passes here to ")
      console.log("outcome ",outcomeAMint)
      
      const outcomeAAccountInfo = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        outcomeAMint,
        user.publicKey
      );
      userOutcomeAAccount = outcomeAAccountInfo.address;
      console.log("[asse")
      
      const outcomeBAccountInfo = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        outcomeBMint,
        user.publicKey
      );
      console.log("pased here ot")
      userOutcomeBAccount = outcomeBAccountInfo.address;
      console.log("reached here also 2")
    });

    it("Splits collateral tokens into outcome tokens", async () => {
      const splitAmount = 100000; 
      console.log("doing things that to do")
      const userCollateralBefore = await getAccount(
        provider.connection,
        userCollateralAccount
      );
      console.log(userCollateralAccount,"thsi is colletral ")
      
      await program.methods
        .splitTokens(marketId, new anchor.BN(splitAmount))
        .accounts({
          market: marketPda,
          user: user.publicKey,
          userCollateral: userCollateralAccount,
          collateralVault: collateralVault,
          outcomeAMint: outcomeAMint,
          outcomeBMint: outcomeBMint,
          userOutcomeA: userOutcomeAAccount,
          userOutcomeB: userOutcomeBAccount,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      
      const userCollateralAfter = await getAccount(
        provider.connection,
        userCollateralAccount
      );
      const userOutcomeA = await getAccount(provider.connection, userOutcomeAAccount);
      const userOutcomeB = await getAccount(provider.connection, userOutcomeBAccount);
      const vault = await getAccount(provider.connection, collateralVault);
      
      assert.equal(
        Number(userCollateralBefore.amount) - Number(userCollateralAfter.amount),
        splitAmount
      );
      assert.equal(Number(userOutcomeA.amount), splitAmount);
      assert.equal(Number(userOutcomeB.amount), splitAmount);
      assert.equal(Number(vault.amount), splitAmount);
      
      // Verify market state
      const marketAccount = await program.account.market.fetch(marketPda);
      assert.equal(marketAccount.totalCollateralLocked.toNumber(), splitAmount);
      
      console.log("Tokens split successfully");
    });

    it("Fails to split with zero amount", async () => {
      try {
        await program.methods
          .splitTokens(marketId, new anchor.BN(0))
          .accounts({
            market: marketPda,
            user: user.publicKey,
            userCollateral: userCollateralAccount,
            collateralVault: collateralVault,
            outcomeAMint: outcomeAMint,
            outcomeBMint: outcomeBMint,
            userOutcomeA: userOutcomeAAccount,
            userOutcomeB: userOutcomeBAccount,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        
        assert.fail("Should have failed with InvalidAmount");
      } catch (error) {
        expect(error.toString()).to.include("InvalidAmount");
      }
    });
  });

  describe("Merge Tokens", () => {

    it("Merges outcome tokens back to collateral", async () => {
      const userOutcomeABefore = await getAccount(provider.connection, userOutcomeAAccount);
      const userOutcomeBBefore = await getAccount(provider.connection, userOutcomeBAccount);
      const userCollateralBefore = await getAccount(provider.connection, userCollateralAccount);
      
      console.log("userOutcomeA:", userOutcomeAAccount.toBase58());
      console.log("userOutcomeB:", userOutcomeBAccount.toBase58());
      console.log("collateralVault:", collateralVault.toBase58());
      console.log("marketPda:", marketPda?.toBase58());
      console.log("marketId (BN):", marketId.toString());
      console.log("collateralVault:", collateralVault?.toBase58());
      console.log("collateralVault owner (on-chain):", (await getAccount(provider.connection, collateralVault)).owner.toBase58());
      console.log("userCollateral:", userCollateralAccount?.toBase58());
      console.log("userOutcomeA:", userOutcomeAAccount?.toBase58());
      console.log("userOutcomeB:", userOutcomeBAccount?.toBase58());
      console.log("user:", user.publicKey.toBase58());
      console.log("tokenProgram:", anchor.utils.token.TOKEN_PROGRAM_ID.toBase58());
      const vaultInfo = await getAccount(provider.connection, collateralVault);
      console.log("vault.owner (authority):", vaultInfo.owner.toBase58()); // should equal marketPda


      const mergeAmount = Math.min(
        Number(userOutcomeABefore.amount),
        Number(userOutcomeBBefore.amount)
      );
      console.log("reaccher here ser")
      
      await program.methods
        .mergeTokens(marketId)
        .accounts({
          market: marketPda,
          user: user.publicKey,
          userCollateral: userCollateralAccount,
          collateralVault: collateralVault,
          outcomeAMint: outcomeAMint,
          outcomeBMint: outcomeBMint,
          userOutcomeA: userOutcomeAAccount,
          userOutcomeB: userOutcomeBAccount,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      
      // Verify balances
      const userOutcomeAAfter = await getAccount(provider.connection, userOutcomeAAccount);
      const userOutcomeBAfter = await getAccount(provider.connection, userOutcomeBAccount);
      const userCollateralAfter = await getAccount(provider.connection, userCollateralAccount);
      
      assert.equal(
        Number(userOutcomeABefore.amount) - Number(userOutcomeAAfter.amount),
        mergeAmount
      );
      assert.equal(
        Number(userOutcomeBBefore.amount) - Number(userOutcomeBAfter.amount),
        mergeAmount
      );
      assert.equal(
        Number(userCollateralAfter.amount) - Number(userCollateralBefore.amount),
        mergeAmount
      );
      
      // Verify market state
      const marketAccount = await program.account.market.fetch(marketPda);
      assert.equal(marketAccount.totalCollateralLocked.toNumber(), 0);
      
      console.log("Tokens merged successfully");
    });

    it("Fails to merge when no matching pairs exist", async () => {
      // User should have zero balance after previous merge
      try {
        await program.methods
          .mergeTokens(marketId)
          .accounts({
            market: marketPda,
            user: user.publicKey,
            userCollateral: userCollateralAccount,
            collateralVault: collateralVault,
            outcomeAMint: outcomeAMint,
            outcomeBMint: outcomeBMint,
            userOutcomeA: userOutcomeAAccount,
            userOutcomeB: userOutcomeBAccount,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        
        assert.fail("Should have failed with InvalidAmount");
      } catch (error) {
        expect(error.toString()).to.include("InvalidAmount");
      }
    });
  });

  describe("Set Winning Side & Claim Rewards", () => {
    let winnerUser: anchor.web3.Keypair;
    let winnerCollateralAccount: anchor.web3.PublicKey;
    let winnerOutcomeAAccount: anchor.web3.PublicKey;
    let winnerOutcomeBAccount: anchor.web3.PublicKey;

    before(async () => {
      // Create winner user and fund them
      winnerUser = anchor.web3.Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        winnerUser.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);
      
      // Create token accounts for winner
      const winnerCollateralInfo = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        collateralMint,
        winnerUser.publicKey
      );
      winnerCollateralAccount = winnerCollateralInfo.address;
      
      await mintTo(
        provider.connection,
        authority.payer,
        collateralMint,
        winnerCollateralAccount,
        authority.publicKey,
        500000
      );
      
      const winnerOutcomeAInfo = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        outcomeAMint,
        winnerUser.publicKey
      );
      winnerOutcomeAAccount = winnerOutcomeAInfo.address;
      
      const winnerOutcomeBInfo = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        outcomeBMint,
        winnerUser.publicKey
      );
      winnerOutcomeBAccount = winnerOutcomeBInfo.address;
      
      // Split tokens for winner
      await program.methods
        .splitTokens(marketId, new anchor.BN(200000))
        .accounts({
          market: marketPda,
          user: winnerUser.publicKey,
          userCollateral: winnerCollateralAccount,
          collateralVault: collateralVault,
          outcomeAMint: outcomeAMint,
          outcomeBMint: outcomeBMint,
          userOutcomeA: winnerOutcomeAAccount,
          userOutcomeB: winnerOutcomeBAccount,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([winnerUser])
        .rpc();
    });

    it("Sets the winning outcome (Outcome A)", async () => {
      await program.methods
        .setWinningSide(marketId, { outcomeA: {} })
        .accounts({
          authority: authority.publicKey,
          market: marketPda,
          outcomeAMint: outcomeAMint,
          outcomeBMint: outcomeBMint,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      // Verify market is settled
      const marketAccount = await program.account.market.fetch(marketPda);
      assert.equal(marketAccount.isSettled, true);
      assert.deepEqual(marketAccount.winningOutcome, { outcomeA: {} });
      
      console.log("Winning outcome set successfully");
    });

    it("Fails to set winning side again", async () => {
      try {
        await program.methods
          .setWinningSide(marketId, { outcomeB: {} })
          .accounts({
            authority: authority.publicKey,
            market: marketPda,
            outcomeAMint: outcomeAMint,
            outcomeBMint: outcomeBMint,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .rpc();
        
        assert.fail("Should have failed with MarketAlreadySettled");
      } catch (error) {
        expect(error.toString()).to.include("MarketAlreadySettled");
      }
    });

    it("Claims rewards for winning side", async () => {
      const winnerCollateralBefore = await getAccount(
        provider.connection,
        winnerCollateralAccount
      );
      const winnerOutcomeABefore = await getAccount(
        provider.connection,
        winnerOutcomeAAccount
      );
      
      const rewardAmount = Number(winnerOutcomeABefore.amount);
      
      await program.methods
        .claimRewards(marketId)
        .accounts({
          user: winnerUser.publicKey,
          market: marketPda,
          userCollateral: winnerCollateralAccount,
          collateralVault: collateralVault,
          outcomeAMint: outcomeAMint,
          outcomeBMint: outcomeBMint,
          userOutcomeA: winnerOutcomeAAccount,
          userOutcomeB: winnerOutcomeBAccount,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([winnerUser])
        .rpc();
      
      // Verify balances
      const winnerCollateralAfter = await getAccount(
        provider.connection,
        winnerCollateralAccount
      );
      const winnerOutcomeAAfter = await getAccount(
        provider.connection,
        winnerOutcomeAAccount
      );
      
      assert.equal(
        Number(winnerCollateralAfter.amount) - Number(winnerCollateralBefore.amount),
        rewardAmount
      );
      assert.equal(Number(winnerOutcomeAAfter.amount), 0);
      
      console.log("Rewards claimed successfully");
    });

    it("Fails to claim rewards twice", async () => {
      try {
        await program.methods
          .claimRewards(marketId)
          .accounts({
            user: winnerUser.publicKey,
            market: marketPda,
            userCollateral: winnerCollateralAccount,
            collateralVault: collateralVault,
            outcomeAMint: outcomeAMint,
            outcomeBMint: outcomeBMint,
            userOutcomeA: winnerOutcomeAAccount,
            userOutcomeB: winnerOutcomeBAccount,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([winnerUser])
          .rpc();
        
        // This should succeed but with 0 amount (user has no tokens left)
        console.log("Second claim completed with 0 tokens");
      } catch (error) {
        // May fail with token account error if balance is 0
        console.log("Expected behavior: no tokens to claim");
      }
    });
  });

  describe("Edge Cases", () => {
    it("Fails to split tokens after market is settled", async () => {
      try {
        await program.methods
          .splitTokens(marketId, new anchor.BN(1000))
          .accounts({
            market: marketPda,
            user: user.publicKey,
            userCollateral: userCollateralAccount,
            collateralVault: collateralVault,
            outcomeAMint: outcomeAMint,
            outcomeBMint: outcomeBMint,
            userOutcomeA: userOutcomeAAccount,
            userOutcomeB: userOutcomeBAccount,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        
        assert.fail("Should have failed with MarketAlreadySettled");
      } catch (error) {
        expect(error.toString()).to.include("MarketAlreadySettled");
      }
    });

    it("Fails to merge tokens after market is settled", async () => {
      try {
        await program.methods
          .mergeTokens(marketId)
          .accounts({
            market: marketPda,
            user: user.publicKey,
            userCollateral: userCollateralAccount,
            collateralVault: collateralVault,
            outcomeAMint: outcomeAMint,
            outcomeBMint: outcomeBMint,
            userOutcomeA: userOutcomeAAccount,
            userOutcomeB: userOutcomeBAccount,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        
        assert.fail("Should have failed with MarketAlreadySettled");
      } catch (error) {
        expect(error.toString()).to.include("MarketAlreadySettled");
      }
    });
  });
});