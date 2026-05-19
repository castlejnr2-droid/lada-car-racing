import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
  lang: 'tact',
  target: 'contracts/lada_escrow.tact',
  options: {
    debug: true,
  },
};
