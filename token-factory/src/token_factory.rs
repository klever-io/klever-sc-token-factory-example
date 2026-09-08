#![no_std]

use klever_sc::api::AssetType;
use klever_sc::imports::*;

/// TokenFactory — Token issuance contract for Klever.
///
/// Allows anyone to issue new KDA tokens (Fungible, NFT, SemiFungible) on Klever.
/// The contract stays the on-chain owner of the created asset, so the original
/// creator can keep minting/burning through it — or take the ownership over.
#[klever_sc::contract]
pub trait TokenFactory {
    #[init]
    fn init(&self) {}

    #[upgrade]
    fn upgrade(&self) {}

    // =========================================================================
    // Core Endpoint
    // =========================================================================

    /// Issue a new KDA token on Klever.
    ///
    /// * `asset_type` — 0=Fungible, 1=NFT, 2=SemiFungible
    /// * `name` — token display name
    /// * `ticker` — token ticker symbol
    /// * `precision` — decimal places (ignored for NFT, forced to 0)
    /// * `initial_supply` — initial mint (ignored for NFT/SFT, forced to 0)
    /// * `max_supply` — maximum supply (ignored for NFT/SFT, forced to 0)
    #[endpoint]
    fn issue(
        &self,
        asset_type: u8,
        name: ManagedBuffer,
        ticker: ManagedBuffer,
        precision: u32,
        initial_supply: BigUint,
        max_supply: BigUint,
    ) -> TokenIdentifier {
        require!(!self.paused().get(), "Contract is paused");
        require!(!name.is_empty(), "Name cannot be empty");
        require!(name.len() <= 32, "Name too long");
        require!(!ticker.is_empty(), "Ticker cannot be empty");
        require!(ticker.len() <= 10, "Ticker too long");

        let caller = self.blockchain().get_caller();

        let asset = match asset_type {
            0u8 => AssetType::Fungible,
            1u8 => AssetType::NFT,
            2u8 => AssetType::SemiFungible,
            _ => sc_panic!("Invalid asset type"),
        };

        let (precision, initial_supply, max_supply) = match asset {
            AssetType::Fungible => {
                require!(precision <= 18, "Precision exceeds maximum");
                require!(
                    max_supply == 0u64 || max_supply >= initial_supply,
                    "Max supply must be >= initial supply or zero for unlimited"
                );
                (precision, initial_supply, max_supply)
            }
            AssetType::NFT => (0u32, BigUint::zero(), BigUint::zero()),
            AssetType::SemiFungible => {
                require!(precision <= 18, "Precision exceeds maximum");
                (precision, BigUint::zero(), BigUint::zero())
            }
        };

        self.total_issued().update(|counter| *counter += 1u64);

        let sc_address = self.blockchain().get_sc_address();
        let empty_logo = ManagedBuffer::new();
        let empty_uris: ManagedVec<URI<Self::Api>> = ManagedVec::new();
        // Default properties, minus `can_wipe`: nobody should be able to wipe
        // balances out of an account for a token minted here.
        let properties = PropertiesInfo {
            can_wipe: false,
            ..Default::default()
        };
        let attributes = AttributesInfo::default();
        let royalties = RoyaltiesData::default();

        let token_id = self.send().kda_create(
            asset,
            &name,
            &ticker,
            precision,
            &sc_address,
            &empty_logo,
            &initial_supply,
            &max_supply,
            &properties,
            &attributes,
            &empty_uris,
            &royalties,
        );

        // Transfer initial supply to caller for fungible tokens
        if asset_type == 0u8 && initial_supply > 0u64 {
            self.send()
                .direct_kda(&caller, &token_id, 0, &initial_supply);
        }

        // Track token per creator
        self.creator_tokens(&caller).push(&token_id);
        self.token_creator(&token_id).set(&caller);

        self.token_issued_event(
            &caller,
            &token_id,
            asset_type,
            &name,
            &ticker,
            &initial_supply,
            precision,
        );

        token_id
    }

    // =========================================================================
    // Token Management (Creator Only)
    // =========================================================================

    fn require_token_creator(&self, token_id: &TokenIdentifier) -> ManagedAddress {
        let mapper = self.token_creator(token_id);
        require!(!mapper.is_empty(), "Token not issued by this contract");
        let creator = mapper.get();
        let caller = self.blockchain().get_caller();
        require!(caller == creator, "Caller is not the token creator");
        creator
    }

    /// Mint additional tokens (creator only).
    ///
    /// * `token_id` — token to mint
    /// * `nonce` — 0 for fungible, specific nonce for SFT
    /// * `amount` — amount to mint
    #[endpoint(mintToken)]
    fn mint_token(&self, token_id: TokenIdentifier, nonce: u64, amount: BigUint) {
        require!(!self.paused().get(), "Contract is paused");
        require!(amount > 0u64, "Amount must be greater than zero");
        let creator = self.require_token_creator(&token_id);

        self.send()
            .kda_mint_with_address(&token_id, nonce, &amount, &creator, 0);

        self.token_mint_event(&creator, &token_id, nonce, &amount);
    }

    /// Burn tokens sent by the creator.
    #[payable("*")]
    #[endpoint(burnToken)]
    fn burn_token(&self) {
        require!(!self.paused().get(), "Contract is paused");

        let klv_amount = self.call_value().klv_value().clone_value();
        require!(klv_amount == 0u64, "KLV payment not accepted");

        let payments = self.call_value().all_kda_transfers().clone_value();
        require!(!payments.is_empty(), "No payment received");
        require!(payments.len() == 1, "Single token payment expected");

        let payment = payments.get(0);
        require!(payment.amount > 0u64, "Amount must be greater than zero");

        let creator = self.require_token_creator(&payment.token_identifier);

        self.send().kda_burn(
            &payment.token_identifier,
            payment.token_nonce,
            &payment.amount,
        );

        self.token_burn_event(
            &creator,
            &payment.token_identifier,
            payment.token_nonce,
            &payment.amount,
        );
    }

    /// Transfer on-chain asset ownership to a new address (creator only).
    /// This is irreversible — the contract loses control of the token.
    #[endpoint(transferTokenOwnership)]
    fn transfer_token_ownership(&self, token_id: TokenIdentifier, new_owner: ManagedAddress) {
        require!(!self.paused().get(), "Contract is paused");
        require!(new_owner != ManagedAddress::zero(), "Invalid new owner");
        let creator = self.require_token_creator(&token_id);

        self.send().kda_change_owner(&token_id, &new_owner);
        self.token_creator(&token_id).clear();

        self.token_ownership_transferred_event(&creator, &token_id, &new_owner);
    }

    // =========================================================================
    // Admin Endpoints (Owner Only)
    // =========================================================================

    #[only_owner]
    #[endpoint(changeContractName)]
    fn change_contract_name(&self, new_name: ManagedBuffer) {
        self.send().set_account_name(new_name);
    }

    #[only_owner]
    #[endpoint]
    fn pause(&self) {
        self.paused().set(true);
        self.pause_event(true);
    }

    #[only_owner]
    #[endpoint]
    fn unpause(&self) {
        self.paused().set(false);
        self.pause_event(false);
    }

    // =========================================================================
    // View Endpoints
    // =========================================================================

    #[view(isPaused)]
    fn is_paused(&self) -> bool {
        self.paused().get()
    }

    #[view(getTotalIssued)]
    fn get_total_issued(&self) -> u64 {
        self.total_issued().get()
    }

    #[view(getTokensByCreator)]
    fn get_tokens_by_creator(
        &self,
        creator: ManagedAddress,
        offset: usize,
        limit: usize,
    ) -> MultiValueEncoded<TokenIdentifier> {
        let mapper = self.creator_tokens(&creator);
        let total = mapper.len();
        let mut result = MultiValueEncoded::new();

        if offset >= total {
            return result;
        }

        let end = core::cmp::min(offset.saturating_add(limit), total);
        // VecMapper is 1-indexed
        for i in (offset + 1)..=end {
            result.push(mapper.get(i));
        }
        result
    }

    #[view(getCreatorTokenCount)]
    fn get_creator_token_count(&self, creator: ManagedAddress) -> usize {
        self.creator_tokens(&creator).len()
    }

    #[view(getTokenCreator)]
    fn get_token_creator(&self, token_id: TokenIdentifier) -> ManagedAddress {
        self.token_creator(&token_id).get()
    }

    // =========================================================================
    // Storage
    // =========================================================================

    #[storage_mapper("paused")]
    fn paused(&self) -> SingleValueMapper<bool>;

    #[storage_mapper("total_issued")]
    fn total_issued(&self) -> SingleValueMapper<u64>;

    #[storage_mapper("creator_tokens")]
    fn creator_tokens(&self, creator: &ManagedAddress) -> VecMapper<TokenIdentifier>;

    #[storage_mapper("token_creator")]
    fn token_creator(&self, token_id: &TokenIdentifier) -> SingleValueMapper<ManagedAddress>;

    // =========================================================================
    // Events
    // =========================================================================

    #[event("tokenIssued")]
    fn token_issued_event(
        &self,
        #[indexed] caller: &ManagedAddress,
        #[indexed] token_id: &TokenIdentifier,
        #[indexed] asset_type: u8,
        #[indexed] name: &ManagedBuffer,
        #[indexed] ticker: &ManagedBuffer,
        #[indexed] initial_supply: &BigUint,
        precision: u32,
    );

    #[event("pauseChanged")]
    fn pause_event(&self, #[indexed] paused: bool);

    #[event("tokenMint")]
    fn token_mint_event(
        &self,
        #[indexed] creator: &ManagedAddress,
        #[indexed] token_id: &TokenIdentifier,
        #[indexed] nonce: u64,
        amount: &BigUint,
    );

    #[event("tokenBurn")]
    fn token_burn_event(
        &self,
        #[indexed] creator: &ManagedAddress,
        #[indexed] token_id: &TokenIdentifier,
        #[indexed] nonce: u64,
        amount: &BigUint,
    );

    #[event("tokenOwnershipTransferred")]
    fn token_ownership_transferred_event(
        &self,
        #[indexed] creator: &ManagedAddress,
        #[indexed] token_id: &TokenIdentifier,
        #[indexed] new_owner: &ManagedAddress,
    );
}
