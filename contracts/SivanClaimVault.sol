// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Immutable, seven-day bearer-link escrow. Independent of agreement vaults.
/// @dev Only reviewed exact-transfer, non-rebasing ERC20s are supported. A per-link
/// EOA key authorizes the recipient; never submit that private key in calldata.
contract SivanClaimVault is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant CLAIM_WINDOW = 7 days;
    uint256 public constant FEE_BPS = 50;
    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(bytes32 depositId,address recipient,uint256 deadline)"
    );
    enum Status { None, Active, Claimed, Refunded }
    struct Deposit {
        address sender;
        address token;
        address claimSigner;
        uint256 netAmount;
        uint256 expiresAt;
        Status status;
    }

    address public immutable treasury;
    bool public fundingPaused;
    mapping(address => bool) public allowedTokens;
    mapping(address => uint256) public nonces;
    mapping(address => uint256) public locked;
    mapping(bytes32 => Deposit) public deposits;

    error InvalidAddress();
    error InvalidAmount();
    error FundingPaused();
    error UnsupportedToken();
    error InexactTransfer();
    error NotActive();
    error ClaimExpired();
    error InvalidAuthorization();
    error RefundNotAvailable();
    error NotSender();

    event FundingPauseChanged(bool paused);
    event TokenAdmissionChanged(address indexed token, bool allowed);
    event ClaimVaultDeposited(bytes32 indexed depositId, address indexed sender,
        address indexed token, address claimSigner, uint256 grossAmount,
        uint256 feeAmount, uint256 netAmount, uint256 expiresAt);
    event ClaimVaultClaimed(bytes32 indexed depositId, address indexed recipient, uint256 amount);
    event ClaimVaultRefunded(bytes32 indexed depositId, address indexed sender, uint256 amount);

    constructor(address admin, address treasury_, address[] memory tokens)
        Ownable(admin) EIP712("SivanClaimVault", "1")
    {
        if (treasury_ == address(0) || treasury_ == address(this)) revert InvalidAddress();
        treasury = treasury_;
        for (uint256 i; i < tokens.length; ++i) _setToken(tokens[i], true);
    }

    /// @notice Admission changes affect new deposits only, never existing exits.
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        _setToken(token, allowed);
    }

    function _setToken(address token, bool allowed) private {
        if (token == address(this) || token == address(0) || (allowed && token.code.length == 0)) {
            revert InvalidAddress();
        }
        allowedTokens[token] = allowed;
        emit TokenAdmissionChanged(token, allowed);
    }

    function setFundingPaused(bool paused) external onlyOwner {
        fundingPaused = paused;
        emit FundingPauseChanged(paused);
    }

    function deriveDepositId(address sender, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), sender, nonce));
    }

    /// @notice Gross amount includes the non-refundable 0.5% fee, rounded down.
    function deposit(address token, uint256 grossAmount, address claimSigner)
        external nonReentrant returns (bytes32 depositId)
    {
        if (fundingPaused) revert FundingPaused();
        if (!allowedTokens[token]) revert UnsupportedToken();
        if (grossAmount == 0) revert InvalidAmount();
        if (claimSigner == address(0) || claimSigner == address(this) || claimSigner.code.length != 0) {
            revert InvalidAddress();
        }
        // Treasury-funded deposits are disallowed so fee balance checks remain exact.
        if (msg.sender == treasury) revert InvalidAddress();
        uint256 fee = Math.mulDiv(grossAmount, FEE_BPS, 10_000);
        uint256 net = grossAmount - fee;
        IERC20 asset = IERC20(token);
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), grossAmount);
        if (asset.balanceOf(address(this)) != beforeBalance + grossAmount) revert InexactTransfer();
        if (fee != 0) _pay(asset, treasury, fee);

        depositId = deriveDepositId(msg.sender, nonces[msg.sender]++);
        deposits[depositId] = Deposit(msg.sender, token, claimSigner, net,
            block.timestamp + CLAIM_WINDOW, Status.Active);
        locked[token] += net;
        emit ClaimVaultDeposited(depositId, msg.sender, token, claimSigner,
            grossAmount, fee, net, block.timestamp + CLAIM_WINDOW);
    }

    function claimDigest(bytes32 depositId, address recipient, uint256 deadline)
        public view returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, depositId, recipient, deadline)));
    }

    /// @notice Anyone may relay the signature, but cannot change its destination.
    function claim(bytes32 depositId, address recipient, uint256 deadline, bytes calldata signature)
        external nonReentrant
    {
        Deposit storage item = deposits[depositId];
        if (item.status != Status.Active) revert NotActive();
        if (block.timestamp >= item.expiresAt) revert ClaimExpired();
        if (recipient == address(0) || recipient == address(this)) revert InvalidAddress();
        if (deadline < block.timestamp || deadline > item.expiresAt) revert InvalidAuthorization();
        if (ECDSA.recover(claimDigest(depositId, recipient, deadline), signature) != item.claimSigner) {
            revert InvalidAuthorization();
        }
        item.status = Status.Claimed;
        locked[item.token] -= item.netAmount;
        _pay(IERC20(item.token), recipient, item.netAmount);
        emit ClaimVaultClaimed(depositId, recipient, item.netAmount);
    }

    /// @notice Sender-controlled refund; no backend, reviewer or owner approval.
    function refund(bytes32 depositId) external nonReentrant {
        Deposit storage item = deposits[depositId];
        if (item.status != Status.Active) revert NotActive();
        if (msg.sender != item.sender) revert NotSender();
        if (block.timestamp < item.expiresAt) revert RefundNotAvailable();
        item.status = Status.Refunded;
        locked[item.token] -= item.netAmount;
        _pay(IERC20(item.token), item.sender, item.netAmount);
        emit ClaimVaultRefunded(depositId, item.sender, item.netAmount);
    }

    function _pay(IERC20 token, address recipient, uint256 amount) private {
        uint256 vaultBefore = token.balanceOf(address(this));
        uint256 recipientBefore = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        if (token.balanceOf(address(this)) != vaultBefore - amount ||
            token.balanceOf(recipient) != recipientBefore + amount) revert InexactTransfer();
    }
}
