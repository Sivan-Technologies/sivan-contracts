// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/SivanAgreementVault.sol";
import "../contracts/test/MockERC20.sol";

/// TEST ONLY: inject unreachable bad storage to exercise payout-time defenses.
/// These mutators are not part of the production vault or deployment scripts.
contract FeeRecipientGuardHarness is SivanAgreementVault {
    constructor(address collector, address initialOwner)
        SivanAgreementVault(collector, address(0xA6E7), 9827, initialOwner) {}
    function forceFeeCollector(bytes32 id, address recipient) external { agreementFeeCollectors[id] = recipient; }
    function forcePartner(bytes32 id, address recipient) external { agreements[id].partnerAddress = recipient; }
}

contract FeeRecipientGuardsTest is Test {
    FeeRecipientGuardHarness vault;
    MockERC20 token;
    uint256 constant BUYER_KEY = 0xB001;
    uint256 constant CONTRACTOR_KEY = 0xC001;
    uint256 constant AMOUNT = 100e6;
    address buyer;
    address contractor;
    address constant FEE = address(0xFEE);
    address constant PARTNER = address(0xAFF);
    address constant INDEPENDENT = address(0xBACC);
    bytes32 constant ID = keccak256("fee-guards");

    function setUp() public {
        buyer = vm.addr(BUYER_KEY);
        contractor = vm.addr(CONTRACTOR_KEY);
        token = new MockERC20("USDC", "USDC", 6);
        vault = new FeeRecipientGuardHarness(FEE, address(this));
        vault.setSupportedToken(address(token), true);
        token.mint(buyer, AMOUNT);
        vm.prank(buyer);
        vault.proposeArbitrationTerms(ID, contractor, INDEPENDENT, 1 days,
            keccak256(abi.encode(address(token), AMOUNT, uint256(24), PARTNER)), block.timestamp + 1 days);
        bytes32 hash = vault.arbitrationTermsHash(buyer, ID);
        vm.prank(contractor);
        vault.acceptArbitrationTerms(buyer, ID, hash, true);
        vm.startPrank(buyer);
        token.approve(address(vault), AMOUNT);
        vault.deposit(ID, contractor, address(token), AMOUNT, 24, PARTNER);
        vm.stopPrank();
    }

    function _prepareRoute(uint8 route) internal {
        if (route == 0) return;
        vm.prank(buyer);
        vault.raiseDispute(ID, "Guard test");
        if (route == 2) {
            vm.warp(block.timestamp + 1 days);
            vault.claimArbitrationTimeout(ID);
        }
    }

    function _signatures(uint256 refund, uint256 expiry) internal view returns (bytes memory b, bytes memory c) {
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Sivan Celo Settlement Facility"), keccak256("1"), block.chainid, address(vault)
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(
            vault.DISPUTE_SETTLEMENT_TYPEHASH(), ID, refund, vault.agreementNonces(ID), expiry
        ))));
        (uint8 bv, bytes32 br, bytes32 bs) = vm.sign(BUYER_KEY, digest);
        (uint8 cv, bytes32 cr, bytes32 cs) = vm.sign(CONTRACTOR_KEY, digest);
        return (abi.encodePacked(br, bs, bv), abi.encodePacked(cr, cs, cv));
    }

    // External test helper makes expectRevert cover the entire settlement call,
    // not the view calls used to prepare signatures.
    function execute(uint8 route, uint256 refund, uint256 expiry, bytes memory b, bytes memory c) external {
        if (route == 0) {
            vm.prank(buyer);
            vault.releasePayment(ID, "", "", 0);
        } else if (route == 1) {
            vault.resolveDispute(ID, true, "Primary ruling");
        } else if (route == 2) {
            vm.prank(INDEPENDENT);
            vault.resolveDispute(ID, true, "Independent ruling");
        } else {
            vault.settleDisputeByAgreement(ID, refund, expiry, b, c);
        }
    }

    function testFuzz_allPaidRoutesRejectConflictingRecipientsAtomically(uint8 routeSeed, bool badPartner, bool reviewerConflict, uint256 refundSeed) public {
        uint8 route = routeSeed % 4;
        _prepareRoute(route);
        uint256 refund = route == 3 ? bound(refundSeed, 0, AMOUNT - 1e6) : 0;
        ISivanAgreementVault.Agreement memory a = vault.getAgreement(ID);
        uint256 expiry = block.timestamp + 1 hours;
        (bytes memory b, bytes memory c) = _signatures(refund, expiry);
        address invalidRecipient = reviewerConflict ? INDEPENDENT : address(vault);
        if (badPartner) vault.forcePartner(ID, invalidRecipient);
        else vault.forceFeeCollector(ID, invalidRecipient);

        vm.expectRevert(bytes(reviewerConflict ? "Independent reviewer fee conflict" : "Vault cannot receive fees"));
        this.execute(route, refund, expiry, b, c);
        assertEq(token.balanceOf(address(vault)), AMOUNT);
        assertEq(token.balanceOf(buyer), 0);
        assertEq(token.balanceOf(contractor), 0);
        assertEq(token.balanceOf(FEE), 0);
        assertEq(token.balanceOf(PARTNER), 0);
        assertEq(token.balanceOf(INDEPENDENT), 0);
        assertEq(uint8(vault.getAgreement(ID).state), uint8(a.state));
        assertEq(vault.agreementNonces(ID), 0);

        // Restore only in the harness; normal production cannot create this state.
        vault.forceFeeCollector(ID, FEE);
        vault.forcePartner(ID, PARTNER);
        this.execute(route, refund, expiry, b, c);
        uint256 fee = a.feeAmount * (AMOUNT - refund) / AMOUNT;
        uint256 partnerFee = a.partnerFeeAmount * (AMOUNT - refund) / AMOUNT;
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(token.balanceOf(buyer), refund);
        assertEq(token.balanceOf(contractor), AMOUNT - refund - fee);
        assertEq(token.balanceOf(FEE), fee - partnerFee);
        assertEq(token.balanceOf(PARTNER), partnerFee);
    }

    function testFuzz_laterCollectorChangeCannotPayReviewer(uint8 routeSeed, uint256 refundSeed) public {
        uint8 route = routeSeed % 4;
        _prepareRoute(route);
        uint256 refund = route == 3 ? bound(refundSeed, 0, AMOUNT) : 0;
        uint256 expiry = block.timestamp + 1 hours;
        (bytes memory b, bytes memory c) = _signatures(refund, expiry);
        vault.setFeeCollector(INDEPENDENT);
        assertEq(vault.agreementFeeCollectors(ID), FEE);
        ISivanAgreementVault.Agreement memory a = vault.getAgreement(ID);
        this.execute(route, refund, expiry, b, c);
        uint256 fee = a.feeAmount * (AMOUNT - refund) / AMOUNT;
        uint256 partnerFee = a.partnerFeeAmount * (AMOUNT - refund) / AMOUNT;
        assertEq(token.balanceOf(INDEPENDENT), 0);
        assertEq(token.balanceOf(FEE), fee - partnerFee);
        assertEq(token.balanceOf(PARTNER), partnerFee);
        assertEq(token.balanceOf(buyer), refund);
        assertEq(token.balanceOf(contractor), AMOUNT - refund - fee);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function test_fullBilateralRefundStillWorksWithBadFeeDestinations() public {
        _prepareRoute(3);
        vault.forceFeeCollector(ID, address(vault));
        vault.forcePartner(ID, address(vault));
        uint256 expiry = block.timestamp + 1 hours;
        (bytes memory b, bytes memory c) = _signatures(AMOUNT, expiry);
        vault.settleDisputeByAgreement(ID, AMOUNT, expiry, b, c);
        assertEq(token.balanceOf(buyer), AMOUNT);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function test_arbitratedRefundDoesNotDependOnFeeDestinations() public {
        _prepareRoute(1);
        vault.forceFeeCollector(ID, address(vault));
        vault.forcePartner(ID, address(vault));
        vault.resolveDispute(ID, false, "Refund in full");
        assertEq(token.balanceOf(buyer), AMOUNT);
        assertEq(token.balanceOf(address(vault)), 0);
    }
}
