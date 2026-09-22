// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/SivanAgreementVault.sol";
import "../contracts/test/MockERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";

contract ReviewContractSigner is IERC1271 {
    address public immutable signer;
    constructor(address signer_) { signer = signer_; }
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        return ECDSA.recover(hash, signature) == signer ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

contract ReviewSettlementToken is MockERC20 {
    address public blockedRecipient;
    address public reentryTarget;
    bytes public reentryData;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    constructor() MockERC20("Review token", "USDC", 6) {}
    function setBlockedRecipient(address recipient) external { blockedRecipient = recipient; }
    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }
    function _update(address from, address to, uint256 amount) internal override {
        require(to != blockedRecipient || to == address(0), "Review: blocked recipient");
        if (from == reentryTarget && reentryTarget != address(0) && !reentryAttempted) {
            reentryAttempted = true;
            (reentrySucceeded,) = reentryTarget.call(reentryData);
        }
        super._update(from, to, amount);
    }
}

/// Additional review probes. `test_review_*` deliberately document unsafe
/// configurations accepted by the current contract; passing those reproductions
/// is evidence of a finding, NOT a safety assertion or a fixed vulnerability.
contract SettlementPathsReviewTest is Test {
    SivanAgreementVault vault;
    ReviewSettlementToken token;
    uint256 constant BUYER_KEY = 0xB001;
    uint256 constant CONTRACTOR_KEY = 0xC001;
    address buyer;
    address contractor;
    address constant FEE = address(0xFEE);
    address constant PARTNER = address(0xAFF);
    address constant INDEPENDENT = address(0xBACC);
    bytes32 constant ID = keccak256("settlement-review");

    function setUp() public {
        buyer = vm.addr(BUYER_KEY);
        contractor = vm.addr(CONTRACTOR_KEY);
        token = new ReviewSettlementToken();
        vault = new SivanAgreementVault(FEE, address(0xA6E7), 9827, address(this));
        vault.setSupportedToken(address(token), true);
    }

    function _fund(uint256 amount, address partner, uint256 period) internal {
        token.mint(buyer, amount);
        vm.prank(buyer);
        vault.proposeArbitrationTerms(ID, contractor, INDEPENDENT, period,
            keccak256(abi.encode(address(token), amount, uint256(24), partner)), block.timestamp + 1 days);
        bytes32 hash = vault.arbitrationTermsHash(buyer, ID);
        vm.prank(contractor);
        vault.acceptArbitrationTerms(buyer, ID, hash, true);
        vm.startPrank(buyer);
        token.approve(address(vault), amount);
        vault.deposit(ID, contractor, address(token), amount, 24, partner);
        vault.raiseDispute(ID, "Review case");
        vm.stopPrank();
    }

    function _signature(uint256 key, uint256 refund, uint256 expiry) internal view returns (bytes memory) {
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Sivan Celo Settlement Facility"), keccak256("1"), block.chainid, address(vault)
        ));
        bytes32 message = keccak256(abi.encode(vault.DISPUTE_SETTLEMENT_TYPEHASH(), ID, refund,
            vault.agreementNonces(ID), expiry));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, message)));
        return abi.encodePacked(r, s, v);
    }

    function _settle(uint256 refund) internal {
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory b = _signature(BUYER_KEY, refund, expiry);
        bytes memory c = _signature(CONTRACTOR_KEY, refund, expiry);
        vault.settleDisputeByAgreement(ID, refund, expiry, b, c);
    }

    function testFuzz_bilateralSplitConservesFunds(uint256 amount, uint256 refundSeed,
        uint256 feeBps, uint256 partnerBps, bool escalated) public {
        amount = bound(amount, 1, 1e24);
        uint256 refund = bound(refundSeed, 0, amount);
        feeBps = bound(feeBps, 0, 300);
        partnerBps = bound(partnerBps, 0, 5000);
        vault.setFeePolicy(feeBps, partnerBps, false);
        _fund(amount, PARTNER, 3 days);
        if (escalated) {
            vm.warp(block.timestamp + 3 days);
            vault.claimArbitrationTimeout(ID);
        }
        ISivanAgreementVault.Agreement memory a = vault.getAgreement(ID);
        // Bounded inputs make this independent reference calculation overflow-free.
        uint256 fee = a.feeAmount * (amount - refund) / amount;
        uint256 partner = a.partnerFeeAmount * (amount - refund) / amount;
        vault.pause();
        _settle(refund);
        assertEq(token.balanceOf(buyer), refund);
        assertEq(token.balanceOf(contractor), amount - refund - fee);
        assertEq(token.balanceOf(FEE), fee - partner);
        assertEq(token.balanceOf(PARTNER), partner);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.agreementNonces(ID), 1);
        assertEq(uint8(vault.getAgreement(ID).state), refund == amount ? 4 : 3);
    }

    function testFuzz_handoverCannotRestoreRefund(uint256 selection, uint256 delay) public {
        uint256[3] memory periods = [uint256(1 days), uint256(3 days), uint256(7 days)];
        uint256 period = periods[selection % 3];
        _fund(100e6, PARTNER, period);
        (,,, uint256 deadline,) = vault.arbitrationCases(ID);
        vm.warp(deadline - 1);
        vm.expectRevert("Arbitration period still running");
        vault.claimArbitrationTimeout(ID);
        vm.warp(deadline + bound(delay, 0, 365 days));
        vault.claimArbitrationTimeout(ID);
        vm.expectRevert("Only independent reviewer");
        vault.resolveDispute(ID, false, "Late primary");
        vm.prank(buyer);
        vm.expectRevert("Cannot refund in current state");
        vault.refundBuyer(ID);
        assertEq(token.balanceOf(address(vault)), 100e6);
        vm.prank(INDEPENDENT);
        vault.resolveDispute(ID, false, "Independent ruling");
        assertEq(token.balanceOf(buyer), 100e6);
    }

    function test_erc1271ParticipantsCanSettle() public {
        buyer = address(new ReviewContractSigner(buyer));
        contractor = address(new ReviewContractSigner(contractor));
        _fund(100e6, PARTNER, 1 days);
        _settle(40e6);
        assertEq(token.balanceOf(buyer), 40e6);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function test_failedTransferRollsBackAllBalancesStateAndNonce() public {
        _fund(100e6, PARTNER, 1 days);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory b = _signature(BUYER_KEY, 40e6, expiry);
        bytes memory c = _signature(CONTRACTOR_KEY, 40e6, expiry);
        token.setBlockedRecipient(contractor);
        vm.expectRevert("Review: blocked recipient");
        vault.settleDisputeByAgreement(ID, 40e6, expiry, b, c);
        assertEq(token.balanceOf(buyer), 0);
        assertEq(token.balanceOf(FEE), 0);
        assertEq(token.balanceOf(PARTNER), 0);
        assertEq(token.balanceOf(address(vault)), 100e6);
        assertEq(vault.agreementNonces(ID), 0);
        assertEq(uint8(vault.getAgreement(ID).state), 5);
        token.setBlockedRecipient(address(0));
        vault.settleDisputeByAgreement(ID, 40e6, expiry, b, c);
        vm.expectRevert("Agreement is not disputed");
        vault.settleDisputeByAgreement(ID, 40e6, expiry, b, c);
    }

    function test_review_partnerVaultLeavesFeeBehind() public {
        _fund(100e6, address(vault), 1 days);
        uint256 partnerFee = vault.getAgreement(ID).partnerFeeAmount;
        assertGt(partnerFee, 0);
        _settle(0);
        assertEq(uint8(vault.getAgreement(ID).state), 3);
        assertEq(token.balanceOf(address(vault)), partnerFee, "Accepted self-recipient strands the partner fee");
    }

    function test_reentrantSettlementCannotPayTwice() public {
        _fund(100e6, PARTNER, 1 days);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory b = _signature(BUYER_KEY, 40e6, expiry);
        bytes memory c = _signature(CONTRACTOR_KEY, 40e6, expiry);
        token.setReentry(address(vault), abi.encodeCall(vault.settleDisputeByAgreement, (ID, 40e6, expiry, b, c)));
        vault.settleDisputeByAgreement(ID, 40e6, expiry, b, c);
        assertTrue(token.reentryAttempted());
        assertFalse(token.reentrySucceeded());
        assertEq(token.balanceOf(buyer), 40e6);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.agreementNonces(ID), 1);
    }

    function test_review_feeCollectorCanBeChangedToVaultAfterFunding() public {
        _fund(100e6, PARTNER, 1 days);
        ISivanAgreementVault.Agreement memory a = vault.getAgreement(ID);
        vault.setFeeCollector(address(vault));
        _settle(0);
        assertEq(uint8(vault.getAgreement(ID).state), 3);
        assertEq(token.balanceOf(address(vault)), a.feeAmount - a.partnerFeeAmount);
    }

    function test_review_independentReviewerCanBePaidAsPartner() public {
        _fund(100e6, INDEPENDENT, 1 days);
        vm.warp(block.timestamp + 1 days);
        vm.prank(INDEPENDENT);
        vault.resolveDispute(ID, true, "Reviewer chooses paid outcome");
        assertGt(token.balanceOf(INDEPENDENT), 0, "Reviewer receives referral revenue from own ruling");
    }
}
