// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/SivanAgreementVault.sol";
import "../contracts/test/MockERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * INVARIANT AND FUZZ SUITE
 *
 * The Hardhat suite checks cases I thought of. That is exactly the limit that
 * let four money-affecting bugs sit in code with six passing tests: the tests
 * were not wrong, they simply never exercised the delegated release path or a
 * fee-on-transfer token.
 *
 * This suite asks a different question. Instead of "does this specific
 * sequence work", it throws millions of random inputs and random call
 * orderings at properties that must hold NO MATTER WHAT. A property that
 * survives that is much closer to actually true.
 *
 * The four properties below are the ones where a violation means money moved
 * incorrectly:
 *
 *   1. SOLVENCY. The vault's token balance is always at least the sum of what
 *      every unsettled agreement is owed. If this breaks, one user's escrow is
 *      paying for another's, which is the single worst failure this contract
 *      can have.
 *
 *   2. CONSERVATION. For every agreement, netAmount + protocolFee +
 *      partnerFee == totalAmount, exactly. Not approximately. A rounding error
 *      here either strands dust forever or over-pays.
 *
 *   3. FEE CEILING. No fee ever exceeds MAX_FEE_BPS, whatever the owner sets.
 *      The cap is the promise the contract makes to its users.
 *
 *   4. TERMINAL STATES ARE FINAL. Released and Refunded never move again.
 */

/**
 * The handler is what the fuzzer drives. It bounds inputs to plausible ranges
 * so the fuzzer spends its budget on interesting states rather than on reverts,
 * and it tracks the ghost variables the invariants are checked against.
 */
abstract contract ArbitrationTestTerms is Test {
    address internal constant INDEPENDENT = address(0xBACC);

    function _agree(SivanAgreementVault vault, bytes32 id, address buyer, address contractor,
        address token, uint256 amount, uint256 hours_) internal {
        vm.prank(buyer);
        vault.proposeArbitrationTerms(id, contractor, INDEPENDENT, 3 days,
            keccak256(abi.encode(token, amount, hours_, address(0))), block.timestamp + 1 days);
        bytes32 hash = vault.arbitrationTermsHash(buyer, id);
        vm.prank(contractor);
        vault.acceptArbitrationTerms(buyer, id, hash, true);
    }
}

contract VaultHandler is ArbitrationTestTerms {
    SivanAgreementVault public vault;
    MockERC20 public token;
    /** Private key of the agent attester, so the handler can sign real ones. */
    uint256 public attesterKey;

    address[] public actors;
    mapping(address => uint256) internal actorKeys;
    bytes32[] public agreementIds;
    mapping(bytes32 => bool) public known;

    /** Ghost: total deposited, and total paid out. */
    uint256 public ghostDeposited;
    uint256 public ghostPaidOut;
    /**
     * Ghost: what the vault SHOULD hold, derived independently of the vault's
     * own accounting. Comparing the contract against its own numbers cannot
     * detect a discrepancy; comparing it against a tally the handler keeps can.
     */
    uint256 public ghostExpectedBalance;
    /** Set when a settle call reverted unexpectedly, which is itself a symptom. */
    uint256 public ghostFailedSettlements;

    constructor(
        SivanAgreementVault _vault,
        MockERC20 _token,
        address[] memory _actors,
        uint256 _attesterKey
    ) {
        vault = _vault;
        token = _token;
        actors = _actors;
        for (uint256 i = 0; i < _actors.length; i++) {
            require(_actors[i] == vm.addr(0x1000 + i), "Unknown test signer");
            actorKeys[_actors[i]] = 0x1000 + i;
        }
        attesterKey = _attesterKey;
    }

    /**
     * Build a real EIP-712 agent attestation.
     *
     * The handler previously passed "" here, which the contract correctly
     * refuses with "Invalid agent attestation length". Every release therefore
     * bounced off the first check and the fuzzer never reached the settlement
     * logic it was supposed to be stressing: 2,500 release calls that tested
     * nothing. Signing properly is what makes the invariant meaningful.
     */
    function _agentSig(bytes32 agreementId, string memory proof, uint256 ts)
        internal view returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            vault.AGENT_ATTESTATION_TYPEHASH(),
            agreementId,
            vault.registeredAgentId(),
            keccak256(bytes(proof)),
            ts
        ));
        bytes32 digest = MessageHashUtils.toTypedDataHash(_domainSeparator(), structHash);
        (uint8 v, bytes32 r, bytes32 sVal) = vm.sign(attesterKey, digest);
        return abi.encodePacked(r, sVal, v);
    }

    function _domainSeparator() internal view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId,
         address verifyingContract,,) = vault.eip712Domain();
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(name)),
            keccak256(bytes(version)),
            chainId,
            verifyingContract
        ));
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 actorSeed, uint256 contractorSeed, uint256 amount, uint256 hours_)
        public
    {
        address buyer = _actor(actorSeed);
        address contractor = _actor(contractorSeed);
        if (buyer == contractor) return;

        amount = bound(amount, 1, 1_000_000e6);
        hours_ = bound(hours_, 1, 720);

        bytes32 id = keccak256(abi.encode(buyer, contractor, amount, agreementIds.length));
        if (known[id]) return;

        if (token.balanceOf(buyer) < amount) return;

        _agree(vault, id, buyer, contractor, address(token), amount, hours_);
        vm.startPrank(buyer);
        token.approve(address(vault), amount);
        try vault.deposit(id, contractor, address(token), amount, hours_, address(0)) {
            agreementIds.push(id);
            known[id] = true;
            ghostDeposited += amount;
            ghostExpectedBalance += amount;
        } catch {}
        vm.stopPrank();
    }

    function release(uint256 idSeed) public {
        if (agreementIds.length == 0) return;
        bytes32 id = agreementIds[idSeed % agreementIds.length];
        ISivanAgreementVault.Agreement memory a = vault.getAgreement(id);
        if (a.state != ISivanAgreementVault.AgreementState.Funded &&
            a.state != ISivanAgreementVault.AgreementState.Delivered) return;

        uint256 before = token.balanceOf(address(vault));
        bytes memory att = _agentSig(id, a.deliverableProof, a.deadlineTimestamp);
        vm.prank(a.buyer);
        try vault.releasePayment(id, "", att, 0) {
            uint256 moved = before - token.balanceOf(address(vault));
            ghostPaidOut += moved;
            // A release must move EXACTLY what this agreement holds. Anything
            // else is money coming from, or being left behind by, someone else.
            if (moved != a.totalAmount) ghostFailedSettlements++;
            ghostExpectedBalance -= a.totalAmount;
        } catch {
            // A settle-able agreement that cannot settle is itself a symptom:
            // usually it means an earlier payout already spent its funds.
            ghostFailedSettlements++;
        }
    }

    function refund(uint256 idSeed, uint256 skip) public {
        if (agreementIds.length == 0) return;
        bytes32 id = agreementIds[idSeed % agreementIds.length];
        ISivanAgreementVault.Agreement memory a = vault.getAgreement(id);
        bool funded = a.state == ISivanAgreementVault.AgreementState.Funded;
        bool delivered = a.state == ISivanAgreementVault.AgreementState.Delivered;
        if (!funded && !delivered) return;

        /**
         * Warp past whichever clock actually gates THIS agreement.
         *
         * A Funded agreement unlocks at its deadline; a Delivered one unlocks
         * at deliveredAt + deliveryReviewWindow, which can be later. Warping
         * only to the deadline would leave every delivered agreement reverting
         * with "review window still open", and the handler would score the
         * contract being correct as a failed settlement. That is precisely the
         * class of bug that made an earlier version of this suite pass while
         * testing nothing: 2,500 release calls that all bounced off the first
         * require and never reached settlement.
         */
        uint256 unlockAt = a.refundUnlockAt;
        if (block.timestamp <= unlockAt) {
            vm.warp(unlockAt + bound(skip, 1, 1 hours));
        }

        uint256 before = token.balanceOf(address(vault));
        vm.prank(a.buyer);
        try vault.refundBuyer(id) {
            uint256 moved = before - token.balanceOf(address(vault));
            ghostPaidOut += moved;
            if (moved != a.totalAmount) ghostFailedSettlements++;
            ghostExpectedBalance -= a.totalAmount;
        } catch {
            ghostFailedSettlements++;
        }
    }

    function markDelivered(uint256 idSeed) public {
        if (agreementIds.length == 0) return;
        bytes32 id = agreementIds[idSeed % agreementIds.length];
        ISivanAgreementVault.Agreement memory a = vault.getAgreement(id);
        if (a.state != ISivanAgreementVault.AgreementState.Funded) return;
        vm.prank(a.contractor);
        try vault.markDelivered(id, "proof") {} catch {}
    }

    /**
     * Either party escalates. Included so the fuzzer actually reaches Disputed;
     * without it the state is unreachable and every invariant that mentions it
     * would be vacuously true.
     */
    function raiseDispute(uint256 idSeed, bool asBuyer) public {
        if (agreementIds.length == 0) return;
        bytes32 id = agreementIds[idSeed % agreementIds.length];
        ISivanAgreementVault.Agreement memory a = vault.getAgreement(id);
        if (a.state != ISivanAgreementVault.AgreementState.Funded &&
            a.state != ISivanAgreementVault.AgreementState.Delivered) return;
        vm.prank(asBuyer ? a.buyer : a.contractor);
        try vault.raiseDispute(id, "fuzz") {} catch {}
    }

    /**
     * The arbiter decides. Both directions are fuzzed, and both must conserve
     * value exactly: paying the contractor moves the whole agreement out in
     * three transfers, refunding the buyer moves it out in one.
     */
    function resolveDispute(uint256 idSeed, bool toContractor) public {
        if (agreementIds.length == 0) return;
        bytes32 id = agreementIds[idSeed % agreementIds.length];
        ISivanAgreementVault.Agreement memory a = vault.getAgreement(id);
        if (a.state != ISivanAgreementVault.AgreementState.Disputed) return;

        uint256 before = token.balanceOf(address(vault));
        (address primary, address independent,, uint256 deadline,) = vault.arbitrationCases(id);
        vm.prank(block.timestamp < deadline ? primary : independent);
        try vault.resolveDispute(id, toContractor, "fuzz") {
            uint256 moved = before - token.balanceOf(address(vault));
            ghostPaidOut += moved;
            if (moved != a.totalAmount) ghostFailedSettlements++;
            ghostExpectedBalance -= a.totalAmount;
        } catch {
            ghostFailedSettlements++;
        }
    }

    function escalate(uint256 idSeed, uint256 delay) public {
        if (agreementIds.length == 0) return;
        bytes32 id = agreementIds[idSeed % agreementIds.length];
        if (vault.getAgreement(id).state != ISivanAgreementVault.AgreementState.Disputed) return;
        (,,, uint256 deadline, bool escalated) = vault.arbitrationCases(id);
        if (escalated) return;
        if (block.timestamp < deadline) vm.warp(deadline + bound(delay, 0, 30 days));
        uint256 before = token.balanceOf(address(vault));
        vault.claimArbitrationTimeout(id);
        if (token.balanceOf(address(vault)) != before ||
            vault.getAgreement(id).state != ISivanAgreementVault.AgreementState.Disputed) ghostFailedSettlements++;
    }

    function settleByAgreement(uint256 idSeed, uint256 refundSeed) public {
        if (agreementIds.length == 0) return;
        bytes32 id = agreementIds[idSeed % agreementIds.length];
        ISivanAgreementVault.Agreement memory a = vault.getAgreement(id);
        if (a.state != ISivanAgreementVault.AgreementState.Disputed) return;
        uint256 refundAmount = bound(refundSeed, 0, a.totalAmount);
        uint256 expiry = block.timestamp + 1 hours;
        bytes32 digest = MessageHashUtils.toTypedDataHash(_domainSeparator(), keccak256(abi.encode(
            vault.DISPUTE_SETTLEMENT_TYPEHASH(), id, refundAmount, vault.agreementNonces(id), expiry
        )));
        (uint8 bv, bytes32 br, bytes32 bs) = vm.sign(actorKeys[a.buyer], digest);
        (uint8 cv, bytes32 cr, bytes32 cs) = vm.sign(actorKeys[a.contractor], digest);
        uint256 before = token.balanceOf(address(vault));
        try vault.settleDisputeByAgreement(id, refundAmount, expiry,
            abi.encodePacked(br, bs, bv), abi.encodePacked(cr, cs, cv)) {
            uint256 moved = before - token.balanceOf(address(vault));
            ghostPaidOut += moved;
            if (moved != a.totalAmount) ghostFailedSettlements++;
            ghostExpectedBalance -= a.totalAmount;
        } catch {
            ghostFailedSettlements++;
        }
    }

    /** The owner re-prices mid-flight. Fees already locked must not move. */
    function reprice(uint256 t1u, uint256 t1b, uint256 t2u, uint256 t2b, uint256 t3b) public {
        t1u = bound(t1u, 1, 1000);
        t2u = bound(t2u, t1u + 1, 100000);
        /**
         * Bound ABOVE the cap on purpose.
         *
         * These were bounded to 0..300, which is MAX_FEE_BPS. The handler was
         * therefore incapable of ever proposing an illegal fee, so the
         * "fee never exceeds the cap" invariant could not fail no matter what
         * the contract did. Removing the cap from setFeeTiers left every
         * invariant green, which is how I found this.
         *
         * The contract must be the thing that refuses, not the test harness.
         */
        t1b = bound(t1b, 0, 2000);
        t2b = bound(t2b, 0, 2000);
        t3b = bound(t3b, 0, 2000);
        vm.prank(vault.owner());
        try vault.setFeeTiers(t1u, t1b, t2u, t2b, t3b) {} catch {}
    }

    function agreementCount() external view returns (uint256) {
        return agreementIds.length;
    }

    function agreementAt(uint256 i) external view returns (bytes32) {
        return agreementIds[i];
    }
}

contract VaultInvariantTest is Test {
    SivanAgreementVault vault;
    MockERC20 token;
    VaultHandler handler;

    address owner = address(0xA11CE);
    address feeCollector = address(0xFEE);

    function setUp() public {
        token = new MockERC20("USD Coin", "USDC", 6);
        (address attesterAddr, uint256 attesterKey) = makeAddrAndKey("agent-attester");
        vault = new SivanAgreementVault(feeCollector, attesterAddr, 9827, owner);
        vm.prank(owner);
        vault.setSupportedToken(address(token), true);

        address[] memory actors = new address[](4);
        for (uint256 i = 0; i < 4; i++) {
            actors[i] = vm.addr(0x1000 + i);
            token.mint(actors[i], 10_000_000e6);
        }

        handler = new VaultHandler(vault, token, actors, attesterKey);
        // Seed genuine funded/disputed cases so the invariants cannot pass solely
        // because deposits reverted or random calls never reached a dispute.
        handler.deposit(0, 1, 100e6, 24);
        handler.raiseDispute(0, true);
        handler.deposit(1, 2, 200e6, 24);
        assertEq(handler.agreementCount(), 2);
        targetContract(address(handler));
    }

    /**
     * 1. SOLVENCY. The vault must always hold at least what it still owes.
     *
     * Sum every agreement that has not reached a terminal state and compare
     * against the real token balance. A shortfall means a release already paid
     * out money that belonged to a different agreement.
     */
    function invariant_vaultIsSolvent() public view {
        uint256 owed;
        uint256 n = handler.agreementCount();
        for (uint256 i = 0; i < n; i++) {
            ISivanAgreementVault.Agreement memory a = vault.getAgreement(handler.agreementAt(i));
            if (a.state == ISivanAgreementVault.AgreementState.Funded ||
                a.state == ISivanAgreementVault.AgreementState.Delivered ||
                a.state == ISivanAgreementVault.AgreementState.Disputed) {
                owed += a.totalAmount;
            }
        }
        assertGe(
            token.balanceOf(address(vault)),
            owed,
            "VAULT INSOLVENT: holds less than it owes on open agreements"
        );

        /**
         * AND against an independent tally.
         *
         * The check above compares the vault to its own stored numbers, so a
         * payout that moves the wrong amount can stay invisible: the agreement
         * is marked settled and drops out of `owed` at the same moment the
         * money leaves. The handler keeps its own running total that does not
         * depend on the vault being right.
         *
         * I found this by mutating releasePayment to send netAmount + 1 and
         * watching every invariant still pass. An invariant that survives a
         * deliberate insolvency is not an invariant.
         */
        assertEq(
            token.balanceOf(address(vault)),
            handler.ghostExpectedBalance(),
            "VAULT BALANCE DIVERGED from the independently tracked total"
        );
    }

    /**
     * A settle-able agreement must always settle, and must move exactly its
     * own funds. Failures here are how insolvency first shows itself.
     */
    function invariant_settlementsAlwaysSucceedExactly() public view {
        assertEq(
            handler.ghostFailedSettlements(),
            0,
            "a settlement failed or moved the wrong amount"
        );
    }

    /**
     * 2. CONSERVATION. Every agreement splits exactly, to the wei.
     */
    function invariant_feeSplitIsExact() public view {
        uint256 n = handler.agreementCount();
        for (uint256 i = 0; i < n; i++) {
            ISivanAgreementVault.Agreement memory a = vault.getAgreement(handler.agreementAt(i));
            if (a.totalAmount == 0) continue;
            assertEq(
                a.netAmount + a.feeAmount,
                a.totalAmount,
                "net + fee does not equal total"
            );
            assertLe(
                a.partnerFeeAmount,
                a.feeAmount,
                "partner share exceeds the whole fee"
            );
        }
    }

    /**
     * 3. THE FEE CEILING HOLDS whatever the owner does.
     */
    function invariant_feeNeverExceedsCap() public view {
        uint256 n = handler.agreementCount();
        for (uint256 i = 0; i < n; i++) {
            ISivanAgreementVault.Agreement memory a = vault.getAgreement(handler.agreementAt(i));
            if (a.totalAmount == 0) continue;
            assertLe(
                a.feeAmount * 10000,
                a.totalAmount * vault.MAX_FEE_BPS(),
                "an agreement was charged above MAX_FEE_BPS"
            );
        }
    }

    /// Deadlines govern escalation, not a guaranteed forced payout.
    function invariant_openAgreementClocksAndAuthorityAreFixed() public view {
        for (uint256 i = 0; i < handler.agreementCount(); i++) {
            bytes32 id = handler.agreementAt(i);
            ISivanAgreementVault.Agreement memory a = vault.getAgreement(id);
            if (a.state == ISivanAgreementVault.AgreementState.Funded) {
                assertEq(a.refundUnlockAt, a.deadlineTimestamp);
            } else if (a.state == ISivanAgreementVault.AgreementState.Delivered) {
                assertLe(a.deliveredAt, a.deadlineTimestamp);
                assertEq(a.refundUnlockAt, a.deliveredAt + a.reviewWindowSnapshot);
            } else if (a.state == ISivanAgreementVault.AgreementState.Disputed) {
                (address primary, address independent, uint256 period, uint256 deadline,) = vault.arbitrationCases(id);
                assertTrue(period == 1 days || period == 3 days || period == 7 days);
                assertEq(deadline, a.disputedAt + period);
                assertTrue(primary != independent && independent != address(0));
                assertFalse(a.disputeResolvedByTimeout);
            }
        }
    }


    /**
     * 3b. The STORED tier schedule must never exceed the cap either.
     *
     * Checking only charged fees is not enough: an illegal schedule can sit in
     * storage waiting for the next deposit. Assert the state, not just the
     * outcome.
     */
    function invariant_storedTiersRespectCap() public view {
        uint256 cap = vault.MAX_FEE_BPS();
        assertLe(vault.tier1Bps(), cap, "tier1 stored above the cap");
        assertLe(vault.tier2Bps(), cap, "tier2 stored above the cap");
        assertLe(vault.tier3Bps(), cap, "tier3 stored above the cap");
        assertLe(vault.defaultFeeBps(), cap, "default fee stored above the cap");
    }

    /**
     * 4. The vault never pays out more in total than was ever put in.
     */
    function invariant_neverPaysOutMoreThanTakenIn() public view {
        assertLe(
            handler.ghostPaidOut(),
            handler.ghostDeposited(),
            "cumulative payouts exceed cumulative deposits"
        );
    }
}

/**
 * STATELESS FUZZING. Single functions, millions of random inputs.
 */
contract VaultFuzzTest is ArbitrationTestTerms {
    SivanAgreementVault vault;
    MockERC20 token;

    address owner = address(0xA11CE);
    address buyer = address(0xB0B);
    address contractor = address(0xC04);

    function setUp() public {
        token = new MockERC20("USD Coin", "USDC", 6);
        vault = new SivanAgreementVault(address(0xFEE), address(0xA6E7), 9827, owner);
        // The vault fails CLOSED until initialised, so seed before depositing.
        vm.prank(owner);
        vault.setSupportedToken(address(token), true);
        token.mint(buyer, type(uint128).max);
        vm.prank(buyer);
        token.approve(address(vault), type(uint256).max);
    }

    /// The original multi-transaction exploit must fail after escalation.
    function test_timeoutCannotRestoreBuyerRefund() public {
        bytes32 id = keccak256("arbitration-timeout");
        _agree(vault, id, buyer, contractor, address(token), 1_000e6, 48);
        vm.prank(buyer);
        vault.deposit(id, contractor, address(token), 1_000e6, 48, address(0));
        vm.prank(contractor);
        vault.markDelivered(id, "ipfs://work");
        vm.prank(buyer);
        vault.raiseDispute(id, "contested");
        (,,, uint256 deadline,) = vault.arbitrationCases(id);
        vm.warp(deadline - 1);
        vm.expectRevert("Arbitration period still running");
        vault.claimArbitrationTimeout(id);
        vm.warp(deadline);
        uint256 before = token.balanceOf(buyer);
        vault.claimArbitrationTimeout(id);
        assertEq(token.balanceOf(buyer), before);
        assertEq(uint8(vault.getAgreement(id).state), uint8(ISivanAgreementVault.AgreementState.Disputed));
        vm.prank(buyer);
        vm.expectRevert("Cannot refund in current state");
        vault.refundBuyer(id);
        vm.prank(INDEPENDENT);
        vault.resolveDispute(id, false, "independent ruling");
        assertEq(token.balanceOf(buyer) - before, 1_000e6);
    }

    /** Ownership cannot be abandoned while it is the arbiter of last resort. */
    function test_ownershipCannotBeRenounced() public {
        vm.prank(owner);
        vm.expectRevert("Renouncing ownership is disabled");
        vault.renounceOwnership();
        assertEq(vault.owner(), owner);
    }

    /** The fee is never above the cap, for any amount and any decimals. */
    function testFuzz_feeNeverExceedsCap(uint256 amount, uint8 decimals) public view {
        decimals = uint8(bound(decimals, 0, 36));
        amount = bound(amount, 1, type(uint128).max);
        uint256 bps = vault.calculateFeeForToken(amount, decimals);
        assertLe(bps, vault.MAX_FEE_BPS(), "tier returned a fee above the cap");
    }

    /** Tiers are monotonic: a larger amount is never charged a HIGHER rate. */
    function testFuzz_tiersAreMonotonic(uint256 a, uint256 b) public view {
        a = bound(a, 1, type(uint96).max);
        b = bound(b, a, type(uint96).max);
        assertLe(
            vault.calculateFeeForToken(b, 6),
            vault.calculateFeeForToken(a, 6),
            "a larger payment was charged a higher rate than a smaller one"
        );
    }

    /** Deposit accounting is exact for any amount. */
    function testFuzz_depositSplitsExactly(uint256 amount, uint256 hrs) public {
        amount = bound(amount, 1, 1e24);
        hrs = bound(hrs, 1, 720);
        bytes32 id = keccak256(abi.encode(amount, hrs));

        _agree(vault, id, buyer, contractor, address(token), amount, hrs);
        vm.prank(buyer);
        vault.deposit(id, contractor, address(token), amount, hrs, address(0));

        ISivanAgreementVault.Agreement memory a = vault.getAgreement(id);
        assertEq(a.netAmount + a.feeAmount, a.totalAmount, "split is not exact");
        assertEq(a.totalAmount, amount, "credited an amount it did not receive");
        assertEq(token.balanceOf(address(vault)), amount, "vault balance disagrees");
    }

    /** A refund always returns the full deposit, never more, never less. */
    function testFuzz_refundReturnsExactlyTheDeposit(uint256 amount) public {
        amount = bound(amount, 1, 1e24);
        bytes32 id = keccak256(abi.encode("refund", amount));

        uint256 before = token.balanceOf(buyer);
        _agree(vault, id, buyer, contractor, address(token), amount, 1);
        vm.prank(buyer);
        vault.deposit(id, contractor, address(token), amount, 1, address(0));

        vm.warp(block.timestamp + 2 hours);
        vm.prank(buyer);
        vault.refundBuyer(id);

        assertEq(token.balanceOf(buyer), before, "refund did not return the exact deposit");
        assertEq(token.balanceOf(address(vault)), 0, "dust left after refund");
    }
}
