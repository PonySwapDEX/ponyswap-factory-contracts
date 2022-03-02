import { Wallet, Contract } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import PancakeFactory from '@uniswap/v2-core/build/PancakeFactory.json'
import IPancakePair from '@uniswap/v2-core/build/IPancakePair.json'

import ERC20 from '../../build/ERC20.json'
import WBNB9 from '../../build/WBNB9.json'
import UniswapV1Exchange from '../../build/UniswapV1Exchange.json'
import UniswapV1Factory from '../../build/UniswapV1Factory.json'
import PancakeRouter01 from '../../build/PancakeRouter01.json'
import PancakeMigrator from '../../build/PancakeMigrator.json'
import PancakeRouter02 from '../../build/PancakeRouter02.json'
import RouterEventEmitter from '../../build/RouterEventEmitter.json'

const overrides = {
  gasLimit: 9999999
}

interface V2Fixture {
  token0: Contract
  token1: Contract
  WBNB: Contract
  WBNBPartner: Contract
  factoryV1: Contract
  factoryV2: Contract
  router01: Contract
  router02: Contract
  routerEventEmitter: Contract
  router: Contract
  migrator: Contract
  WBNBExchangeV1: Contract
  pair: Contract
  WBNBPair: Contract
}

export async function v2Fixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<V2Fixture> {
  // deploy tokens
  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const WBNB = await deployContract(wallet, WBNB9)
  const WBNBPartner = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])

  // deploy V1
  const factoryV1 = await deployContract(wallet, UniswapV1Factory, [])
  await factoryV1.initializeFactory((await deployContract(wallet, UniswapV1Exchange, [])).address)

  // deploy V2
  const factoryV2 = await deployContract(wallet, PancakeFactory, [wallet.address])

  // deploy routers
  const router01 = await deployContract(wallet, PancakeRouter01, [factoryV2.address, WBNB.address], overrides)
  const router02 = await deployContract(wallet, PancakeRouter02, [factoryV2.address, WBNB.address], overrides)

  // event emitter for testing
  const routerEventEmitter = await deployContract(wallet, RouterEventEmitter, [])

  // deploy migrator
  const migrator = await deployContract(wallet, PancakeMigrator, [factoryV1.address, router01.address], overrides)

  // initialize V1
  await factoryV1.createExchange(WBNBPartner.address, overrides)
  const WBNBExchangeV1Address = await factoryV1.getExchange(WBNBPartner.address)
  const WBNBExchangeV1 = new Contract(WBNBExchangeV1Address, JSON.stringify(UniswapV1Exchange.abi), provider).connect(
    wallet
  )

  // initialize V2
  await factoryV2.createPair(tokenA.address, tokenB.address)
  const pairAddress = await factoryV2.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(IPancakePair.abi), provider).connect(wallet)

  const token0Address = await pair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  await factoryV2.createPair(WBNB.address, WBNBPartner.address)
  const WBNBPairAddress = await factoryV2.getPair(WBNB.address, WBNBPartner.address)
  const WBNBPair = new Contract(WBNBPairAddress, JSON.stringify(IPancakePair.abi), provider).connect(wallet)

  return {
    token0,
    token1,
    WBNB,
    WBNBPartner,
    factoryV1,
    factoryV2,
    router01,
    router02,
    router: router02, // the default router, 01 had a minor bug
    routerEventEmitter,
    migrator,
    WBNBExchangeV1,
    pair,
    WBNBPair
  }
}
