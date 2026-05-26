// =====================================================================
//  Lada Car Racing — simple owner-payout escrow (v2)
// =====================================================================
//
//  Lifecycle:
//
//    AWAITING_DEPOSITS ──► FUNDED ──► (settled or refunded by owner)
//
//   1. CreateRace       (owner) registers a new race with two players + stake
//   2. TokenNotification each player sends Lada jettons; contract's jetton
//                        wallet forwards a TEP-74 notification with the
//                        race ID in forwardPayload
//   3. Payout           (owner) sends 95% to winner; 5% stays in contract
//                        as house fee; emits WinnerDeclared
//   4. Refund           (owner) returns each player's stake if race is
//                        cancelled; emits RaceRefunded
//   5. WithdrawJettons  (owner) sweeps accumulated house fees out of the
//                        contract to any address
//   6. SetJettonWallet  (owner) updates the Lada jetton wallet address
//                        (needed once after deployment — the address can
//                        only be computed after the contract is deployed)
//
//  This design removes the three-transaction commit-reveal flow.
//  Players sign ONE transaction: their jetton deposit.
//  The backend (house wallet) determines the winner server-side and
//  triggers the payout.
// =====================================================================

import "@stdlib/deploy";

// ───── Economic constants ───────────────────────────────────────────
const HOUSE_FEE_BPS: Int = 500;            // 5%  stays in contract
const BPS_DENOMINATOR: Int = 10000;

// ───── TON gas budget for outbound jetton transfers ─────────────────
const JETTON_FORWARD_TON: Int = ton("0.05");
const JETTON_NOTIFY_TON: Int = ton("0.01");

// ───── Race states ──────────────────────────────────────────────────
const STATE_AWAITING_DEPOSITS: Int = 0;    // waiting for both deposits
const STATE_FUNDED: Int = 1;               // both deposits received — owner can payout/refund

// =====================================================================
//  Messages — incoming
// =====================================================================

// TEP-74: fired by our jetton wallet when it receives Lada
message(0x7362d09c) TokenNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    from: Address;
    forwardPayload: Slice as remaining;
}

// Owner creates a race (must happen before deposits)
message(0x6c726300) CreateRace {
    raceId: Int as uint64;
    stake: Int as coins;
    player1: Address;
    player2: Address;
}

// Owner triggers payout once race result is known server-side
message(0x6c726304) Payout {
    raceId: Int as uint64;
    winner: Address;
    seed: Int as uint256;       // server-generated random seed, echoed in WinnerDeclared
}

// Owner refunds both players (e.g. race cancelled)
message(0x6c726305) Refund {
    raceId: Int as uint64;
}

// Owner sweeps accumulated house fees to any address
message(0x6c726306) WithdrawJettons {
    amount: Int as coins;
    to: Address;
}

// Owner sets/updates the Lada jetton wallet after deployment
message(0x6c726307) SetJettonWallet {
    wallet: Address;
}

// =====================================================================
//  Messages — outgoing events (indexed by the backend)
// =====================================================================

// Emitted when the owner calls Payout successfully
message(0x6c7263f1) WinnerDeclared {
    raceId: Int as uint64;
    winner: Address;
    loser: Address;
    combinedSeed: Int as uint256;
    pot: Int as coins;
    payout: Int as coins;
    houseFee: Int as coins;
}

// Emitted when the owner calls Refund
message(0x6c7263f2) RaceRefunded {
    raceId: Int as uint64;
    player1: Address;
    player2: Address;
    refundAmount: Int as coins;
}

// =====================================================================
//  Messages — outgoing jetton transfer (TEP-74)
// =====================================================================

message(0xf8a7ea5) TokenTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

// =====================================================================
//  Race struct
// =====================================================================

struct Race {
    stake: Int as coins;
    player1: Address;
    player2: Address;
    deposited1: Bool;
    deposited2: Bool;
    state: Int as uint8;
}

// =====================================================================
//  Contract
// =====================================================================

contract LadaEscrow with Deployable {
    owner: Address;
    houseWallet: Address;
    ladaJettonWallet: Address;          // this contract's Lada jetton wallet
    races: map<Int as uint64, Race>;

    init(owner: Address, houseWallet: Address, ladaJettonWallet: Address) {
        self.owner = owner;
        self.houseWallet = houseWallet;
        self.ladaJettonWallet = ladaJettonWallet;
    }

    // ───── 1. Race creation ────────────────────────────────────────
    receive(msg: CreateRace) {
        require(sender() == self.owner, "Only owner may create races");
        require(self.races.get(msg.raceId) == null, "Race already exists");
        require(msg.player1 != msg.player2, "Players must differ");
        require(msg.stake > 0, "Stake must be positive");

        self.races.set(msg.raceId, Race{
            stake: msg.stake,
            player1: msg.player1,
            player2: msg.player2,
            deposited1: false,
            deposited2: false,
            state: STATE_AWAITING_DEPOSITS
        });
    }

    // ───── 2. Jetton deposit ───────────────────────────────────────
    //
    // The player's jetton wallet sends tokens to our jetton wallet, which
    // forwards a TokenNotification. The forwardPayload must contain the
    // uint64 raceId as the first 64 bits (no Either prefix).
    //
    // Any deposit we can't credit is immediately refunded.
    receive(msg: TokenNotification) {
        require(sender() == self.ladaJettonWallet, "Only Lada jetton wallet may notify");

        let payload: Slice = msg.forwardPayload;
        if (payload.bits() < 64) {
            self.sendJetton(msg.from, msg.amount, 0);
            return;
        }
        let raceId: Int = payload.loadUint(64);

        let maybeRace: Race? = self.races.get(raceId);
        if (maybeRace == null) {
            self.sendJetton(msg.from, msg.amount, 0);
            return;
        }
        let r: Race = maybeRace!!;

        // Only accept deposits in the right phase and for the exact stake
        if (r.state != STATE_AWAITING_DEPOSITS || msg.amount != r.stake) {
            self.sendJetton(msg.from, msg.amount, 0);
            return;
        }

        if (msg.from == r.player1 && !r.deposited1) {
            r.deposited1 = true;
        } else if (msg.from == r.player2 && !r.deposited2) {
            r.deposited2 = true;
        } else {
            // Unknown depositor or duplicate — refund
            self.sendJetton(msg.from, msg.amount, 0);
            return;
        }

        // Both deposits received → advance to funded state
        if (r.deposited1 && r.deposited2) {
            r.state = STATE_FUNDED;
        }
        self.races.set(raceId, r);
    }

    // ───── 3. Payout (owner only) ──────────────────────────────────
    //
    // Sends 95% to the winner. The 5% house fee stays in this contract
    // and is swept later via WithdrawJettons.
    receive(msg: Payout) {
        require(sender() == self.owner, "Only owner may payout");

        let maybeRace: Race? = self.races.get(msg.raceId);
        require(maybeRace != null, "Unknown race");
        let r: Race = maybeRace!!;

        require(r.state == STATE_FUNDED, "Race not in funded state");
        require(msg.winner == r.player1 || msg.winner == r.player2, "Winner must be a player");

        let loser: Address = r.player2;
        if (msg.winner == r.player2) { loser = r.player1; }

        let pot: Int = r.stake * 2;
        let houseFee: Int = (pot * HOUSE_FEE_BPS) / BPS_DENOMINATOR;
        let payout: Int = pot - houseFee;

        // 95% → winner; 5% stays in contract
        self.sendJetton(msg.winner, payout, msg.raceId);

        emit(WinnerDeclared{
            raceId: msg.raceId,
            winner: msg.winner,
            loser: loser,
            combinedSeed: msg.seed,
            pot: pot,
            payout: payout,
            houseFee: houseFee
        }.toCell());

        self.races.del(msg.raceId);
    }

    // ───── 4. Refund (owner only) ──────────────────────────────────
    //
    // Returns each player's stake. Works from either phase
    // (AWAITING_DEPOSITS or FUNDED) so the owner can cancel at any time.
    receive(msg: Refund) {
        require(sender() == self.owner, "Only owner may refund");

        let maybeRace: Race? = self.races.get(msg.raceId);
        require(maybeRace != null, "Unknown race");
        let r: Race = maybeRace!!;

        require(
            r.state == STATE_AWAITING_DEPOSITS || r.state == STATE_FUNDED,
            "Race already finalized"
        );

        if (r.deposited1) { self.sendJetton(r.player1, r.stake, msg.raceId); }
        if (r.deposited2) { self.sendJetton(r.player2, r.stake, msg.raceId); }

        emit(RaceRefunded{
            raceId: msg.raceId,
            player1: r.player1,
            player2: r.player2,
            refundAmount: r.stake
        }.toCell());

        self.races.del(msg.raceId);
    }

    // ───── 5. WithdrawJettons (owner only) ─────────────────────────
    //
    // Sweeps accumulated house fees (5% of each settled race) to `to`.
    receive(msg: WithdrawJettons) {
        require(sender() == self.owner, "Only owner may withdraw");
        self.sendJetton(msg.to, msg.amount, 0);
    }

    // ───── 6. SetJettonWallet (owner only) ─────────────────────────
    //
    // The contract's own jetton wallet address can only be determined
    // after the contract is deployed (it depends on the contract address).
    // This one-time setter lets the owner wire it up post-deployment.
    receive(msg: SetJettonWallet) {
        require(sender() == self.owner, "Only owner may set jetton wallet");
        self.ladaJettonWallet = msg.wallet;
    }

    // ───── 7. Sweep stuck TON ─────────────────────────────────────
    receive("withdrawTon") {
        require(sender() == self.owner, "Only owner");
        send(SendParameters{
            to: self.owner,
            value: 0,
            mode: SendRemainingBalance + SendIgnoreErrors,
            body: emptyCell()
        });
    }

    // ───── Jetton transfer helper ──────────────────────────────────
    fun sendJetton(to: Address, amount: Int, queryId: Int) {
        send(SendParameters{
            to: self.ladaJettonWallet,
            value: JETTON_FORWARD_TON,
            mode: SendPayGasSeparately,
            body: TokenTransfer{
                queryId: queryId,
                amount: amount,
                destination: to,
                responseDestination: to,
                customPayload: null,
                forwardTonAmount: JETTON_NOTIFY_TON,
                forwardPayload: emptySlice()
            }.toCell()
        });
    }

    // ───── Get methods ─────────────────────────────────────────────
    get fun raceOf(raceId: Int): Race? {
        return self.races.get(raceId);
    }

    get fun owner(): Address {
        return self.owner;
    }

    get fun houseWalletAddress(): Address {
        return self.houseWallet;
    }

    get fun jettonWalletAddress(): Address {
        return self.ladaJettonWallet;
    }
}
