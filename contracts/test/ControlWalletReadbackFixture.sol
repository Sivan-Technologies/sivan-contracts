// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// TEST-ONLY readback fixture. Not a Safe, not a deployable treasury implementation.
contract ControlWalletReadbackFixture {
    address[] private owners;
    uint256 private threshold = 2;
    bool private moduleEnabled;
    constructor(address[] memory owners_) { owners = owners_; }
    function getOwners() external view returns(address[] memory) { return owners; }
    function getThreshold() external view returns(uint256) { return threshold; }
    function masterCopy() external view returns(address) { return address(this); }
    function getModulesPaginated(address, uint256) external view returns(address[] memory modules, address next) {
        modules = new address[](moduleEnabled ? 1 : 0);
        if (moduleEnabled) modules[0] = address(2);
        next = address(1);
    }
    function changeThreshold(uint256 value) external { threshold = value; }
    function enableModule() external { moduleEnabled = true; }
}
