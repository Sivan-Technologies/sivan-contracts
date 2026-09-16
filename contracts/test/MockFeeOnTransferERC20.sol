// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockFeeOnTransferERC20
 * @notice An ERC-20 that skims a fee on every transfer, for testing only.
 * @dev Plenty of real tokens behave this way. The vault must never assume the
 *      amount it asked for is the amount it received, so this mock exists to
 *      make that assumption fail loudly in tests instead of quietly on chain.
 */
contract MockFeeOnTransferERC20 is ERC20 {
    uint8 private _decimals;
    uint256 public immutable feeBps;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        uint256 feeBps_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
        feeBps = feeBps_;
        _mint(msg.sender, 1000000 * (10 ** decimals_));
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @dev Burns `feeBps` of every transfer. The recipient receives less than
     *      the sender sent, which is precisely the case that breaks naive
     *      escrow accounting.
     */
    function _update(address from, address to, uint256 value) internal virtual override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10000;
        super._update(from, to, value - fee);
        super._update(from, address(0xdead), fee);
    }
}
