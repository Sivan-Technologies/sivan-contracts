// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../contracts/SivanClaimVault.sol";
import "../contracts/test/MockERC20.sol";

contract ClaimSequenceHandler is Test {
    SivanClaimVault public vault;
    MockERC20 public token;
    bytes32[] public ids;
    uint256 public totalGross;
    uint256 public totalFees;
    uint256 public totalPaid;
    uint256 public totalRefunded;
    uint256 constant KEY = 89123;
    address public constant SENDER = address(0xB001);
    address public constant RECIPIENT = address(0xC001);

    constructor() {
        token = new MockERC20("Local", "LOCAL", 6);
        address[] memory tokens = new address[](1); tokens[0] = address(token);
        vault = new SivanClaimVault(address(this), address(0xFEE), tokens);
        vm.prank(SENDER); token.approve(address(vault), type(uint256).max);
    }
    function fund(uint96 amount) external {
        if (vault.fundingPaused() || !vault.allowedTokens(address(token))) return;
        uint256 gross = bound(amount, 1, 1e24);
        token.mint(SENDER, gross);
        vm.prank(SENDER);
        ids.push(vault.deposit(address(token), gross, vm.addr(KEY)));
        totalGross += gross; totalFees += gross / 200;
    }
    function advance(uint32 delta) external { vm.warp(block.timestamp + bound(delta, 1, 10 days)); }
    function pause(bool paused) external { vault.setFundingPaused(paused); }
    function admit(bool allowed) external { vault.setTokenAllowed(address(token), allowed); }
    function claim(uint256 seed) external {
        if (ids.length == 0) return;
        bytes32 id = ids[seed % ids.length];
        (,,, uint256 net, uint256 expiry, SivanClaimVault.Status status) = vault.deposits(id);
        if (status != SivanClaimVault.Status.Active || block.timestamp >= expiry) return;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, vault.claimDigest(id, RECIPIENT, expiry));
        vault.claim(id, RECIPIENT, expiry, abi.encodePacked(r, s, v));
        totalPaid += net;
    }
    function refund(uint256 seed) external {
        if (ids.length == 0) return;
        bytes32 id = ids[seed % ids.length];
        (,,, uint256 net, uint256 expiry, SivanClaimVault.Status status) = vault.deposits(id);
        if (status != SivanClaimVault.Status.Active || block.timestamp < expiry) return;
        vm.prank(SENDER); vault.refund(id);
        totalRefunded += net;
    }
    function activeSum() external view returns (uint256 sum) {
        for (uint256 i; i < ids.length; ++i) {
            (,,, uint256 net,, SivanClaimVault.Status status) = vault.deposits(ids[i]);
            if (status == SivanClaimVault.Status.Active) sum += net;
        }
    }
}

contract ClaimVaultInvariantTest is StdInvariant, Test {
    ClaimSequenceHandler handler;
    function setUp() public {
        handler = new ClaimSequenceHandler();
        // Seed real active liabilities so all runs begin with something to service.
        handler.fund(20e6);
        handler.fund(30e6);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.fund.selector; selectors[1] = handler.advance.selector;
        selectors[2] = handler.pause.selector; selectors[3] = handler.admit.selector;
        selectors[4] = handler.claim.selector; selectors[5] = handler.refund.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }
    function invariant_escrowAndAllDisbursementsConserveEveryUnit() public view {
        SivanClaimVault vault = handler.vault();
        MockERC20 token = handler.token();
        uint256 active = handler.activeSum();
        assertEq(vault.locked(address(token)), active);
        assertEq(token.balanceOf(address(vault)), active);
        assertEq(token.balanceOf(address(0xFEE)), handler.totalFees());
        assertEq(token.balanceOf(handler.RECIPIENT()), handler.totalPaid());
        assertEq(token.balanceOf(handler.SENDER()), handler.totalRefunded());
        assertEq(handler.totalGross(), active + handler.totalFees() + handler.totalPaid() + handler.totalRefunded());
    }
}
