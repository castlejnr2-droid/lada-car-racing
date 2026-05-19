import { toNano, Address } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
// import { LadaEscrow } from '../build/LadaEscrow/tact_LadaEscrow';  // generated after build

export async function run(provider: NetworkProvider) {
  const owner = provider.sender().address!;
  const houseWallet = Address.parse(process.env.HOUSE_WALLET || owner.toString());
  // const ladaJettonWallet = Address.parse(process.env.LADA_JETTON_WALLET!);

  // const escrow = provider.open(await LadaEscrow.fromInit(owner, houseWallet, ladaJettonWallet));
  // await escrow.send(provider.sender(),
  //   { value: toNano('0.1') }, { $$type: 'Deploy', queryId: 0n });
  // await provider.waitForDeploy(escrow.address);
  // console.log('LadaEscrow deployed at', escrow.address.toString());

  console.log('Run `npm run build` first, then uncomment the deploy block above.');
  console.log('Owner:', owner.toString());
  console.log('House wallet:', houseWallet.toString());
}
