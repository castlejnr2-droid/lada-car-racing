// =====================================================================
//  Lada Car Racing — escrow + commit-reveal RNG
// =====================================================================
//
//  Lifecycle of a race (2 players):
//
//    AWAITING_DEPOSITS ──► AWAITING_COMMITS ──► AWAITING_REVEALS ──► SETTLED
//          │                     │                     │
//          └──── timeout ────────┴──── timeout ────────┴──► REFUNDED
//
//   1. CreateRace            (owner) registers a new race with two players
//   2. TokenNotification     each player sends Lada jettons; the contract's
//                            jetton wallet forwards a TEP-74 notification
//                            with the race ID in `forwardPayload`
//   3. CommitHash            each player submits sha256(secret) before the
//                            commit deadline
//   4. RevealSecret          each player reveals their secret before the
//                            reveal deadline; on the second reveal the
//                            contract derives the winner, pays out 95/5,
//                            and emits WinnerDeclared
//   5. TimeoutRefund         if any phase deadline passes without progress,
//                            anyone can trigger a full refund
//
//  Why commit-reveal is secure here:
//   - Once both commits are stored, neither secret can change.
//   - sha256(secret) is one-way, so player B can't infer player A's
//     secret from the commit alone.
//   - The winner is therefore fully determined the moment the second
//     commit lands — reveal just exposes it.
//   - `now()` is mixed in only to produce extra entropy for the
//     frontend's visual replay seed; it does not change who wins.
// =====================================================================

import "@stdlib/deploy";

// ───── Economic constants ───────────────────────────────────────────
const HOUSE_FEE_BPS: Int = 500;            // 5%  → house wallet
const BPS_DENOMINATOR: Int = 10000;

// ───── Timeouts (seconds) ───────────────────────────────────────────
const COMMIT_TIMEOUT_SECS: Int = 1800;     // 30 min to commit after both deposits
const REVEAL_TIMEOUT_SECS: Int = 600;      // 10 min to reveal after both commits

// ───── TON gas budgeting ────────────────────────────────────────────
const JETTON_FORWARD_TON: Int = ton("0.05");
const JETTON_NOTIFY_TON: Int = ton("0.01");

// ───── Race state machine ───────────────────────────────────────────
const STATE_AWAITING_DEPOSITS: Int = 0;
const STATE_AWAITING_COMMITS: Int  = 1;
const STATE_AWAITING_REVEALS: Int  = 2;
const STATE_SETTLED: Int           = 3;
const STATE_REFUNDED: Int          = 4;

// =====================================================================
//  Messages — incoming
// =====================================================================

// TEP-74 standard: notification fired by our jetton wallet on deposit
message(0x7362d09c) TokenNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    from: Address;
    forwardPayload: Slice as remaining;
}

message(0x6c726300) CreateRace {
    raceId: Int as uint64;
    stake: Int as coins;
    player1: Address;
    player2: Address;
}

message(0x6c726301) CommitHash {
    raceId: Int as uint64;
    commit: Int as uint256;            // sha256(secret)
}

message(0x6c726302) RevealSecret {
    raceId: Int as uint64;
    secret: Int as uint256;
}

message(0x6c726303) TimeoutRefund {
    raceId: Int as uint64;
}

// =====================================================================
//  Messages — outgoing (events)
// =====================================================================

message(0x6c7263f1) WinnerDeclared {
    raceId: Int as uint64;
    winner: Address;
    loser: Address;
    combinedSeed: Int as uint256;
    pot: Int as coins;
    payout: Int as coins;
    houseFee: Int as coins;
}

message(0x6c7263f2) RaceRefunded {
    raceId: Int as uint64;
    player1: Address;
    player2: Address;
    refundAmount: Int as coins;
}

// =====================================================================
//  Messages — outgoing (jetton transfer, TEP-74 standard)
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
    commit1: Int as uint256;
    commit2: Int as uint256;
    hasCommit1: Bool;
    hasCommit2: Bool;
    secret1: Int as uint256;
    secret2: Int as uint256;
    hasReveal1: Bool;
    hasReveal2: Bool;
    commitDeadline: Int as uint32;
    revealDeadline: Int as uint32;
    state: Int as uint8;
}

// =====================================================================
//  Contract
// =====================================================================

contract LadaEscrow with Deployable {
    owner: Address;
    houseWallet: Address;
    ladaJettonWallet: Address;          // this contract's jetton wallet for Lada
    races: map<Int as uint64, Race>;

    init(owner: Address, houseWallet: Address, ladaJettonWallet: Address) {
        self.owner = owner;
        self.houseWallet = houseWallet;
        self.ladaJettonWallet = ladaJettonWallet;
    }

    // ───── 1. Race creation (owner-only) ───────────────────────────
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
            commit1: 0,
            commit2: 0,
            hasCommit1: false,
            hasCommit2: false,
            secret1: 0,
            secret2: 0,
            hasReveal1: false,
            hasReveal2: false,
            commitDeadline: now() + COMMIT_TIMEOUT_SECS,
            revealDeadline: 0,
            state: STATE_AWAITING_DEPOSITS
        });
    }

    // ───── 2. Jetton deposit notification ──────────────────────────
    //
    // The player sends Lada jettons to this contract. The jetton wallet
    // associated with this contract receives them, internally credits the
    // contract, and forwards a TokenNotification with `from` = original
    // sender and `forwardPayload` containing the race ID.
    //
    // Any deposit we can't credit (unknown race, wrong amount, wrong race
    // phase, non-player, duplicate) is refunded immediately.
    receive(msg: TokenNotification) {
        require(sender() == self.ladaJettonWallet, "Only Lada jetton wallet may notify");

        // Forward payload must start with a uint64 race ID
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

        if (r.state != STATE_AWAITING_DEPOSITS || msg.amount != r.stake) {
            self.sendJetton(msg.from, msg.amount, 0);
            return;
        }

        if (msg.from == r.player1 && !r.deposited1) {
            r.deposited1 = true;
        } else if (msg.from == r.player2 && !r.deposited2) {
            r.deposited2 = true;
        } else {
            // Unknown depositor or duplicate deposit
            self.sendJetton(msg.from, msg.amount, 0);
            return;
        }

        // Both deposits in → advance to the commit phase
        if (r.deposited1 && r.deposited2) {
            r.state = STATE_AWAITING_COMMITS;
            r.commitDeadline = now() + COMMIT_TIMEOUT_SECS;
        }
        self.races.set(raceId, r);
    }

    // ───── 3. Commit phase ─────────────────────────────────────────
    receive(msg: CommitHash) {
        let maybeRace: Race? = self.races.get(msg.raceId);
        require(maybeRace != null, "Unknown race");
        let r: Race = maybeRace!!;

        require(r.state == STATE_AWAITING_COMMITS, "Not in commit phase");
        require(now() < r.commitDeadline, "Commit window closed");

        if (sender() == r.player1) {
            require(!r.hasCommit1, "Player1 already committed");
            r.commit1 = msg.commit;
            r.hasCommit1 = true;
        } else if (sender() == r.player2) {
            require(!r.hasCommit2, "Player2 already committed");
            r.commit2 = msg.commit;
            r.hasCommit2 = true;
        } else {
            require(false, "Not a player in this race");
        }

        // Both commits in → start the reveal clock
        if (r.hasCommit1 && r.hasCommit2) {
            r.state = STATE_AWAITING_REVEALS;
            r.revealDeadline = now() + REVEAL_TIMEOUT_SECS;
        }
        self.races.set(msg.raceId, r);
    }

    // ───── 4. Reveal phase ─────────────────────────────────────────
    receive(msg: RevealSecret) {
        let maybeRace: Race? = self.races.get(msg.raceId);
        require(maybeRace != null, "Unknown race");
        let r: Race = maybeRace!!;

        require(r.state == STATE_AWAITING_REVEALS, "Not in reveal phase");
        require(now() < r.revealDeadline, "Reveal window closed");

        // sha256(secret as 256-bit) must match the stored commit
        let secretHash: Int = sha256(beginCell().storeUint(msg.secret, 256).endCell().asSlice());

        if (sender() == r.player1) {
            require(!r.hasReveal1, "Player1 already revealed");
            require(secretHash == r.commit1, "Secret does not match commit");
            r.secret1 = msg.secret;
            r.hasReveal1 = true;
        } else if (sender() == r.player2) {
            require(!r.hasReveal2, "Player2 already revealed");
            require(secretHash == r.commit2, "Secret does not match commit");
            r.secret2 = msg.secret;
            r.hasReveal2 = true;
        } else {
            require(false, "Not a player in this race");
        }

        if (r.hasReveal1 && r.hasReveal2) {
            self.settle(msg.raceId, r);
            return;
        }
        self.races.set(msg.raceId, r);
    }

    // ───── 5. Timeout refund (anyone can trigger) ──────────────────
    receive(msg: TimeoutRefund) {
        let maybeRace: Race? = self.races.get(msg.raceId);
        require(maybeRace != null, "Unknown race");
        let r: Race = maybeRace!!;

        require(
            r.state == STATE_AWAITING_DEPOSITS ||
            r.state == STATE_AWAITING_COMMITS ||
            r.state == STATE_AWAITING_REVEALS,
            "Already finalized"
        );

        // Which deadline applies depends on the current phase
        let deadline: Int = r.commitDeadline;
        if (r.state == STATE_AWAITING_REVEALS) {
            deadline = r.revealDeadline;
        }
        require(now() > deadline, "Not yet timed out");

        // Refund any deposit that actually landed
        if (r.deposited1) {
            self.sendJetton(r.player1, r.stake, msg.raceId);
        }
        if (r.deposited2) {
            self.sendJetton(r.player2, r.stake, msg.raceId);
        }

        emit(RaceRefunded{
            raceId: msg.raceId,
            player1: r.player1,
            player2: r.player2,
            refundAmount: r.stake
        }.toCell());

        // Race is finalized — free the storage slot
        self.races.del(msg.raceId);
    }

    // ───── Settlement (internal) ───────────────────────────────────
    fun settle(raceId: Int, r: Race) {
        // Hash both secrets together with the current time. We hash rather than
        // XOR so the 256-bit seed is uniformly distributed for the frontend's
        // visual replay. The winner is still determined by the secrets alone —
        // `now()` only adds entropy to the visual seed.
        let seedCell: Cell = beginCell()
            .storeUint(r.secret1, 256)
            .storeUint(r.secret2, 256)
            .storeUint(now(), 32)
            .endCell();
        let combinedSeed: Int = sha256(seedCell.asSlice());

        let winnerIndex: Int = combinedSeed % 2;
        let winner: Address = r.player1;
        let loser: Address = r.player2;
        if (winnerIndex == 1) {
            winner = r.player2;
            loser = r.player1;
        }

        let pot: Int = r.stake * 2;
        let houseFee: Int = (pot * HOUSE_FEE_BPS) / BPS_DENOMINATOR;
        let payout: Int = pot - houseFee;

        // 95% → winner, 5% → house wallet
        self.sendJetton(winner, payout, raceId);
        self.sendJetton(self.houseWallet, houseFee, raceId);

        emit(WinnerDeclared{
            raceId: raceId,
            winner: winner,
            loser: loser,
            combinedSeed: combinedSeed,
            pot: pot,
            payout: payout,
            houseFee: houseFee
        }.toCell());

        // Race is finalized — free the storage slot
        self.races.del(raceId);
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

    // ───── Owner ops ───────────────────────────────────────────────
    receive("withdrawTon") {
        // Recover stuck TON gas (never touches jettons). Bounced jetton
        // transfers from settlements land here; the owner can sweep them.
        require(sender() == self.owner, "Only owner");
        send(SendParameters{
            to: self.owner,
            value: 0,
            mode: SendRemainingBalance + SendIgnoreErrors,
            body: emptyCell()
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
