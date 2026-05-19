// Lada Car Racing — escrow + commit-reveal RNG
//
// Lifecycle of a race:
//   1. createRace        -> race opens in `Opening` state
//   2. depositLada       -> each player sends Lada jettons (counted via notification)
//   3. commitHash        -> each player submits sha256(secret); state moves to `Committed`
//   4. revealSecret      -> each player reveals; on the last reveal the winner is derived
//   5. settle            -> contract sends 95% to winner, 5% to houseWallet, emits event
//   6. timeoutRefund     -> if reveal deadline passes, anyone can call to refund both players

import "@stdlib/deploy";

const HOUSE_FEE_BPS: Int = 500;            // 5%
const PAYOUT_BPS: Int = 9500;              // 95%
const REVEAL_TIMEOUT_SECS: Int = 600;      // 10 minutes

message CreateRace {
    raceId: Int as uint64;
    stake: Int as coins;
    maxPlayers: Int as uint8;
}

message CommitHash {
    raceId: Int as uint64;
    commit: Int as uint256;                // sha256(secret)
}

message RevealSecret {
    raceId: Int as uint64;
    secret: Int as uint256;
}

message TimeoutRefund {
    raceId: Int as uint64;
}

message WinnerDeclared {
    raceId: Int as uint64;
    winner: Address;
    combinedSeed: Int as uint256;
    payout: Int as coins;
    houseFee: Int as coins;
}

struct Race {
    stake: Int as coins;
    maxPlayers: Int as uint8;
    players: map<Int as uint8, Address>;   // index -> address
    commits: map<Address, Int as uint256>;
    reveals: map<Address, Int as uint256>;
    revealDeadline: Int as uint32;
    settled: Bool;
}

contract LadaEscrow with Deployable {
    owner: Address;
    houseWallet: Address;
    ladaJettonWallet: Address;             // the contract's jetton wallet for Lada
    races: map<Int as uint64, Race>;

    init(owner: Address, houseWallet: Address, ladaJettonWallet: Address) {
        self.owner = owner;
        self.houseWallet = houseWallet;
        self.ladaJettonWallet = ladaJettonWallet;
    }

    receive(msg: CreateRace) {
        require(self.races.get(msg.raceId) == null, "race exists");
        let race: Race = Race{
            stake: msg.stake,
            maxPlayers: msg.maxPlayers,
            players: emptyMap(),
            commits: emptyMap(),
            reveals: emptyMap(),
            revealDeadline: 0,
            settled: false
        };
        self.races.set(msg.raceId, race);
    }

    receive(msg: CommitHash) {
        // TODO: enforce that sender has deposited the stake (via jetton wallet notification)
        let race: Race = self.races.get(msg.raceId)!!;
        require(!race.settled, "race already settled");
        race.commits.set(sender(), msg.commit);
        // once all commits are in, start the reveal clock
        // (player count tracking elided for brevity in this stub)
        self.races.set(msg.raceId, race);
    }

    receive(msg: RevealSecret) {
        let race: Race = self.races.get(msg.raceId)!!;
        require(!race.settled, "race already settled");
        let expected: Int = race.commits.get(sender())!!;
        require(sha256(beginCells().storeUint(msg.secret, 256).endCell()) == expected, "bad reveal");
        race.reveals.set(sender(), msg.secret);
        self.races.set(msg.raceId, race);
        // TODO: when all reveals are in, derive winner via:
        //   combined = secretA xor secretB xor block_lt() xor now()
        //   winner   = players[combined % maxPlayers]
        // then send payout + house fee and emit WinnerDeclared
    }

    receive(msg: TimeoutRefund) {
        let race: Race = self.races.get(msg.raceId)!!;
        require(!race.settled, "race already settled");
        require(now() > race.revealDeadline, "deadline not reached");
        // TODO: refund each player their stake via jetton transfer
        race.settled = true;
        self.races.set(msg.raceId, race);
    }

    get fun raceOf(raceId: Int): Race? {
        return self.races.get(raceId);
    }
}
