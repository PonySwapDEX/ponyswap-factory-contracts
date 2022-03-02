pragma solidity =0.6.6;

import '@pantherswap-libs/pony-swap-core/contracts/interfaces/IPonyCallee.sol';

import '../libraries/PonyLibrary.sol';
import '../interfaces/V1/IUniswapV1Factory.sol';
import '../interfaces/V1/IUniswapV1Exchange.sol';
import '../interfaces/IPonyRouter01.sol';
import '../interfaces/IERC20.sol';
import '../interfaces/IWBNB.sol';

contract ExampleFlashSwap is IPonyCallee {
    IUniswapV1Factory immutable factoryV1;
    address immutable factory;
    IWBNB immutable WBNB;

    constructor(address _factory, address _factoryV1, address router) public {
        factoryV1 = IUniswapV1Factory(_factoryV1);
        factory = _factory;
        WBNB = IWBNB(IPonyRouter01(router).WBNB());
    }

    // needs to accept BNB from any V1 exchange and WBNB. ideally this could be enforced, as in the router,
    // but it's not possible because it requires a call to the v1 factory, which takes too much gas
    receive() external payable {}

    // gets tokens/WBNB via a V2 flash swap, swaps for the BNB/tokens on V1, repays V2, and keeps the rest!
    function ponyCall(address sender, uint amount0, uint amount1, bytes calldata data) external override {
        address[] memory path = new address[](2);
        uint amountToken;
        uint amountBNB;
        { // scope for token{0,1}, avoids stack too deep errors
        address token0 = IPonyPair(msg.sender).token0();
        address token1 = IPonyPair(msg.sender).token1();
        assert(msg.sender == PonyLibrary.pairFor(factory, token0, token1)); // ensure that msg.sender is actually a V2 pair
        assert(amount0 == 0 || amount1 == 0); // this strategy is unidirectional
        path[0] = amount0 == 0 ? token0 : token1;
        path[1] = amount0 == 0 ? token1 : token0;
        amountToken = token0 == address(WBNB) ? amount1 : amount0;
        amountBNB = token0 == address(WBNB) ? amount0 : amount1;
        }

        assert(path[0] == address(WBNB) || path[1] == address(WBNB)); // this strategy only works with a V2 WBNB pair
        IERC20 token = IERC20(path[0] == address(WBNB) ? path[1] : path[0]);
        IUniswapV1Exchange exchangeV1 = IUniswapV1Exchange(factoryV1.getExchange(address(token))); // get V1 exchange

        if (amountToken > 0) {
            (uint minBNB) = abi.decode(data, (uint)); // slippage parameter for V1, passed in by caller
            token.approve(address(exchangeV1), amountToken);
            uint amountReceived = exchangeV1.tokenToEthSwapInput(amountToken, minBNB, uint(-1));
            uint amountRequired = PonyLibrary.getAmountsIn(factory, amountToken, path)[0];
            assert(amountReceived > amountRequired); // fail if we didn't get enough BNB back to repay our flash loan
            WBNB.deposit{value: amountRequired}();
            assert(WBNB.transfer(msg.sender, amountRequired)); // return WBNB to V2 pair
            (bool success,) = sender.call{value: amountReceived - amountRequired}(new bytes(0)); // keep the rest! (BNB)
            assert(success);
        } else {
            (uint minTokens) = abi.decode(data, (uint)); // slippage parameter for V1, passed in by caller
            WBNB.withdraw(amountBNB);
            uint amountReceived = exchangeV1.ethToTokenSwapInput{value: amountBNB}(minTokens, uint(-1));
            uint amountRequired = PonyLibrary.getAmountsIn(factory, amountBNB, path)[0];
            assert(amountReceived > amountRequired); // fail if we didn't get enough tokens back to repay our flash loan
            assert(token.transfer(msg.sender, amountRequired)); // return tokens to V2 pair
            assert(token.transfer(sender, amountReceived - amountRequired)); // keep the rest! (tokens)
        }
    }
}
