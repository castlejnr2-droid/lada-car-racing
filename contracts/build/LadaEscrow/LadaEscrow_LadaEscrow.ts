import {
    Cell,
    Slice,
    Address,
    Builder,
    beginCell,
    ComputeError,
    TupleItem,
    TupleReader,
    Dictionary,
    contractAddress,
    address,
    ContractProvider,
    Sender,
    Contract,
    ContractABI,
    ABIType,
    ABIGetter,
    ABIReceiver,
    TupleBuilder,
    DictionaryValue
} from '@ton/core';

export type DataSize = {
    $$type: 'DataSize';
    cells: bigint;
    bits: bigint;
    refs: bigint;
}

export function storeDataSize(src: DataSize) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.cells, 257);
        b_0.storeInt(src.bits, 257);
        b_0.storeInt(src.refs, 257);
    };
}

export function loadDataSize(slice: Slice) {
    const sc_0 = slice;
    const _cells = sc_0.loadIntBig(257);
    const _bits = sc_0.loadIntBig(257);
    const _refs = sc_0.loadIntBig(257);
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadGetterTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function storeTupleDataSize(source: DataSize) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.cells);
    builder.writeNumber(source.bits);
    builder.writeNumber(source.refs);
    return builder.build();
}

export function dictValueParserDataSize(): DictionaryValue<DataSize> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDataSize(src)).endCell());
        },
        parse: (src) => {
            return loadDataSize(src.loadRef().beginParse());
        }
    }
}

export type SignedBundle = {
    $$type: 'SignedBundle';
    signature: Buffer;
    signedData: Slice;
}

export function storeSignedBundle(src: SignedBundle) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBuffer(src.signature);
        b_0.storeBuilder(src.signedData.asBuilder());
    };
}

export function loadSignedBundle(slice: Slice) {
    const sc_0 = slice;
    const _signature = sc_0.loadBuffer(64);
    const _signedData = sc_0;
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadGetterTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function storeTupleSignedBundle(source: SignedBundle) {
    const builder = new TupleBuilder();
    builder.writeBuffer(source.signature);
    builder.writeSlice(source.signedData.asCell());
    return builder.build();
}

export function dictValueParserSignedBundle(): DictionaryValue<SignedBundle> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSignedBundle(src)).endCell());
        },
        parse: (src) => {
            return loadSignedBundle(src.loadRef().beginParse());
        }
    }
}

export type StateInit = {
    $$type: 'StateInit';
    code: Cell;
    data: Cell;
}

export function storeStateInit(src: StateInit) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeRef(src.code);
        b_0.storeRef(src.data);
    };
}

export function loadStateInit(slice: Slice) {
    const sc_0 = slice;
    const _code = sc_0.loadRef();
    const _data = sc_0.loadRef();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadGetterTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function storeTupleStateInit(source: StateInit) {
    const builder = new TupleBuilder();
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    return builder.build();
}

export function dictValueParserStateInit(): DictionaryValue<StateInit> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStateInit(src)).endCell());
        },
        parse: (src) => {
            return loadStateInit(src.loadRef().beginParse());
        }
    }
}

export type Context = {
    $$type: 'Context';
    bounceable: boolean;
    sender: Address;
    value: bigint;
    raw: Slice;
}

export function storeContext(src: Context) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBit(src.bounceable);
        b_0.storeAddress(src.sender);
        b_0.storeInt(src.value, 257);
        b_0.storeRef(src.raw.asCell());
    };
}

export function loadContext(slice: Slice) {
    const sc_0 = slice;
    const _bounceable = sc_0.loadBit();
    const _sender = sc_0.loadAddress();
    const _value = sc_0.loadIntBig(257);
    const _raw = sc_0.loadRef().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadGetterTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function storeTupleContext(source: Context) {
    const builder = new TupleBuilder();
    builder.writeBoolean(source.bounceable);
    builder.writeAddress(source.sender);
    builder.writeNumber(source.value);
    builder.writeSlice(source.raw.asCell());
    return builder.build();
}

export function dictValueParserContext(): DictionaryValue<Context> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeContext(src)).endCell());
        },
        parse: (src) => {
            return loadContext(src.loadRef().beginParse());
        }
    }
}

export type SendParameters = {
    $$type: 'SendParameters';
    mode: bigint;
    body: Cell | null;
    code: Cell | null;
    data: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeSendParameters(src: SendParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        if (src.code !== null && src.code !== undefined) { b_0.storeBit(true).storeRef(src.code); } else { b_0.storeBit(false); }
        if (src.data !== null && src.data !== undefined) { b_0.storeBit(true).storeRef(src.data); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadSendParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _code = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _data = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleSendParameters(source: SendParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserSendParameters(): DictionaryValue<SendParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSendParameters(src)).endCell());
        },
        parse: (src) => {
            return loadSendParameters(src.loadRef().beginParse());
        }
    }
}

export type MessageParameters = {
    $$type: 'MessageParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeMessageParameters(src: MessageParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadMessageParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleMessageParameters(source: MessageParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserMessageParameters(): DictionaryValue<MessageParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMessageParameters(src)).endCell());
        },
        parse: (src) => {
            return loadMessageParameters(src.loadRef().beginParse());
        }
    }
}

export type DeployParameters = {
    $$type: 'DeployParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    bounce: boolean;
    init: StateInit;
}

export function storeDeployParameters(src: DeployParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeBit(src.bounce);
        b_0.store(storeStateInit(src.init));
    };
}

export function loadDeployParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _bounce = sc_0.loadBit();
    const _init = loadStateInit(sc_0);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadGetterTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadGetterTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function storeTupleDeployParameters(source: DeployParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeBoolean(source.bounce);
    builder.writeTuple(storeTupleStateInit(source.init));
    return builder.build();
}

export function dictValueParserDeployParameters(): DictionaryValue<DeployParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDeployParameters(src)).endCell());
        },
        parse: (src) => {
            return loadDeployParameters(src.loadRef().beginParse());
        }
    }
}

export type StdAddress = {
    $$type: 'StdAddress';
    workchain: bigint;
    address: bigint;
}

export function storeStdAddress(src: StdAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 8);
        b_0.storeUint(src.address, 256);
    };
}

export function loadStdAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(8);
    const _address = sc_0.loadUintBig(256);
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleStdAddress(source: StdAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeNumber(source.address);
    return builder.build();
}

export function dictValueParserStdAddress(): DictionaryValue<StdAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStdAddress(src)).endCell());
        },
        parse: (src) => {
            return loadStdAddress(src.loadRef().beginParse());
        }
    }
}

export type VarAddress = {
    $$type: 'VarAddress';
    workchain: bigint;
    address: Slice;
}

export function storeVarAddress(src: VarAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 32);
        b_0.storeRef(src.address.asCell());
    };
}

export function loadVarAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(32);
    const _address = sc_0.loadRef().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleVarAddress(source: VarAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeSlice(source.address.asCell());
    return builder.build();
}

export function dictValueParserVarAddress(): DictionaryValue<VarAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeVarAddress(src)).endCell());
        },
        parse: (src) => {
            return loadVarAddress(src.loadRef().beginParse());
        }
    }
}

export type BasechainAddress = {
    $$type: 'BasechainAddress';
    hash: bigint | null;
}

export function storeBasechainAddress(src: BasechainAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        if (src.hash !== null && src.hash !== undefined) { b_0.storeBit(true).storeInt(src.hash, 257); } else { b_0.storeBit(false); }
    };
}

export function loadBasechainAddress(slice: Slice) {
    const sc_0 = slice;
    const _hash = sc_0.loadBit() ? sc_0.loadIntBig(257) : null;
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadGetterTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function storeTupleBasechainAddress(source: BasechainAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.hash);
    return builder.build();
}

export function dictValueParserBasechainAddress(): DictionaryValue<BasechainAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBasechainAddress(src)).endCell());
        },
        parse: (src) => {
            return loadBasechainAddress(src.loadRef().beginParse());
        }
    }
}

export type Deploy = {
    $$type: 'Deploy';
    queryId: bigint;
}

export function storeDeploy(src: Deploy) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(2490013878, 32);
        b_0.storeUint(src.queryId, 64);
    };
}

export function loadDeploy(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 2490013878) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    return { $$type: 'Deploy' as const, queryId: _queryId };
}

export function loadTupleDeploy(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'Deploy' as const, queryId: _queryId };
}

export function loadGetterTupleDeploy(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'Deploy' as const, queryId: _queryId };
}

export function storeTupleDeploy(source: Deploy) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    return builder.build();
}

export function dictValueParserDeploy(): DictionaryValue<Deploy> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDeploy(src)).endCell());
        },
        parse: (src) => {
            return loadDeploy(src.loadRef().beginParse());
        }
    }
}

export type DeployOk = {
    $$type: 'DeployOk';
    queryId: bigint;
}

export function storeDeployOk(src: DeployOk) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(2952335191, 32);
        b_0.storeUint(src.queryId, 64);
    };
}

export function loadDeployOk(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 2952335191) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    return { $$type: 'DeployOk' as const, queryId: _queryId };
}

export function loadTupleDeployOk(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'DeployOk' as const, queryId: _queryId };
}

export function loadGetterTupleDeployOk(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'DeployOk' as const, queryId: _queryId };
}

export function storeTupleDeployOk(source: DeployOk) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    return builder.build();
}

export function dictValueParserDeployOk(): DictionaryValue<DeployOk> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDeployOk(src)).endCell());
        },
        parse: (src) => {
            return loadDeployOk(src.loadRef().beginParse());
        }
    }
}

export type FactoryDeploy = {
    $$type: 'FactoryDeploy';
    queryId: bigint;
    cashback: Address;
}

export function storeFactoryDeploy(src: FactoryDeploy) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1829761339, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.cashback);
    };
}

export function loadFactoryDeploy(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1829761339) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _cashback = sc_0.loadAddress();
    return { $$type: 'FactoryDeploy' as const, queryId: _queryId, cashback: _cashback };
}

export function loadTupleFactoryDeploy(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _cashback = source.readAddress();
    return { $$type: 'FactoryDeploy' as const, queryId: _queryId, cashback: _cashback };
}

export function loadGetterTupleFactoryDeploy(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _cashback = source.readAddress();
    return { $$type: 'FactoryDeploy' as const, queryId: _queryId, cashback: _cashback };
}

export function storeTupleFactoryDeploy(source: FactoryDeploy) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.cashback);
    return builder.build();
}

export function dictValueParserFactoryDeploy(): DictionaryValue<FactoryDeploy> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeFactoryDeploy(src)).endCell());
        },
        parse: (src) => {
            return loadFactoryDeploy(src.loadRef().beginParse());
        }
    }
}

export type TokenNotification = {
    $$type: 'TokenNotification';
    queryId: bigint;
    amount: bigint;
    from: Address;
    forwardPayload: Slice;
}

export function storeTokenNotification(src: TokenNotification) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1935855772, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeCoins(src.amount);
        b_0.storeAddress(src.from);
        b_0.storeBuilder(src.forwardPayload.asBuilder());
    };
}

export function loadTokenNotification(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1935855772) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _amount = sc_0.loadCoins();
    const _from = sc_0.loadAddress();
    const _forwardPayload = sc_0;
    return { $$type: 'TokenNotification' as const, queryId: _queryId, amount: _amount, from: _from, forwardPayload: _forwardPayload };
}

export function loadTupleTokenNotification(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _from = source.readAddress();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'TokenNotification' as const, queryId: _queryId, amount: _amount, from: _from, forwardPayload: _forwardPayload };
}

export function loadGetterTupleTokenNotification(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _from = source.readAddress();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'TokenNotification' as const, queryId: _queryId, amount: _amount, from: _from, forwardPayload: _forwardPayload };
}

export function storeTupleTokenNotification(source: TokenNotification) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.amount);
    builder.writeAddress(source.from);
    builder.writeSlice(source.forwardPayload.asCell());
    return builder.build();
}

export function dictValueParserTokenNotification(): DictionaryValue<TokenNotification> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTokenNotification(src)).endCell());
        },
        parse: (src) => {
            return loadTokenNotification(src.loadRef().beginParse());
        }
    }
}

export type CreateRace = {
    $$type: 'CreateRace';
    raceId: bigint;
    stake: bigint;
    player1: Address;
    player2: Address;
}

export function storeCreateRace(src: CreateRace) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1819435776, 32);
        b_0.storeUint(src.raceId, 64);
        b_0.storeCoins(src.stake);
        b_0.storeAddress(src.player1);
        b_0.storeAddress(src.player2);
    };
}

export function loadCreateRace(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1819435776) { throw Error('Invalid prefix'); }
    const _raceId = sc_0.loadUintBig(64);
    const _stake = sc_0.loadCoins();
    const _player1 = sc_0.loadAddress();
    const _player2 = sc_0.loadAddress();
    return { $$type: 'CreateRace' as const, raceId: _raceId, stake: _stake, player1: _player1, player2: _player2 };
}

export function loadTupleCreateRace(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _stake = source.readBigNumber();
    const _player1 = source.readAddress();
    const _player2 = source.readAddress();
    return { $$type: 'CreateRace' as const, raceId: _raceId, stake: _stake, player1: _player1, player2: _player2 };
}

export function loadGetterTupleCreateRace(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _stake = source.readBigNumber();
    const _player1 = source.readAddress();
    const _player2 = source.readAddress();
    return { $$type: 'CreateRace' as const, raceId: _raceId, stake: _stake, player1: _player1, player2: _player2 };
}

export function storeTupleCreateRace(source: CreateRace) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.raceId);
    builder.writeNumber(source.stake);
    builder.writeAddress(source.player1);
    builder.writeAddress(source.player2);
    return builder.build();
}

export function dictValueParserCreateRace(): DictionaryValue<CreateRace> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeCreateRace(src)).endCell());
        },
        parse: (src) => {
            return loadCreateRace(src.loadRef().beginParse());
        }
    }
}

export type CommitHash = {
    $$type: 'CommitHash';
    raceId: bigint;
    commit: bigint;
}

export function storeCommitHash(src: CommitHash) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1819435777, 32);
        b_0.storeUint(src.raceId, 64);
        b_0.storeUint(src.commit, 256);
    };
}

export function loadCommitHash(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1819435777) { throw Error('Invalid prefix'); }
    const _raceId = sc_0.loadUintBig(64);
    const _commit = sc_0.loadUintBig(256);
    return { $$type: 'CommitHash' as const, raceId: _raceId, commit: _commit };
}

export function loadTupleCommitHash(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _commit = source.readBigNumber();
    return { $$type: 'CommitHash' as const, raceId: _raceId, commit: _commit };
}

export function loadGetterTupleCommitHash(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _commit = source.readBigNumber();
    return { $$type: 'CommitHash' as const, raceId: _raceId, commit: _commit };
}

export function storeTupleCommitHash(source: CommitHash) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.raceId);
    builder.writeNumber(source.commit);
    return builder.build();
}

export function dictValueParserCommitHash(): DictionaryValue<CommitHash> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeCommitHash(src)).endCell());
        },
        parse: (src) => {
            return loadCommitHash(src.loadRef().beginParse());
        }
    }
}

export type RevealSecret = {
    $$type: 'RevealSecret';
    raceId: bigint;
    secret: bigint;
}

export function storeRevealSecret(src: RevealSecret) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1819435778, 32);
        b_0.storeUint(src.raceId, 64);
        b_0.storeUint(src.secret, 256);
    };
}

export function loadRevealSecret(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1819435778) { throw Error('Invalid prefix'); }
    const _raceId = sc_0.loadUintBig(64);
    const _secret = sc_0.loadUintBig(256);
    return { $$type: 'RevealSecret' as const, raceId: _raceId, secret: _secret };
}

export function loadTupleRevealSecret(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _secret = source.readBigNumber();
    return { $$type: 'RevealSecret' as const, raceId: _raceId, secret: _secret };
}

export function loadGetterTupleRevealSecret(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _secret = source.readBigNumber();
    return { $$type: 'RevealSecret' as const, raceId: _raceId, secret: _secret };
}

export function storeTupleRevealSecret(source: RevealSecret) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.raceId);
    builder.writeNumber(source.secret);
    return builder.build();
}

export function dictValueParserRevealSecret(): DictionaryValue<RevealSecret> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRevealSecret(src)).endCell());
        },
        parse: (src) => {
            return loadRevealSecret(src.loadRef().beginParse());
        }
    }
}

export type TimeoutRefund = {
    $$type: 'TimeoutRefund';
    raceId: bigint;
}

export function storeTimeoutRefund(src: TimeoutRefund) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1819435779, 32);
        b_0.storeUint(src.raceId, 64);
    };
}

export function loadTimeoutRefund(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1819435779) { throw Error('Invalid prefix'); }
    const _raceId = sc_0.loadUintBig(64);
    return { $$type: 'TimeoutRefund' as const, raceId: _raceId };
}

export function loadTupleTimeoutRefund(source: TupleReader) {
    const _raceId = source.readBigNumber();
    return { $$type: 'TimeoutRefund' as const, raceId: _raceId };
}

export function loadGetterTupleTimeoutRefund(source: TupleReader) {
    const _raceId = source.readBigNumber();
    return { $$type: 'TimeoutRefund' as const, raceId: _raceId };
}

export function storeTupleTimeoutRefund(source: TimeoutRefund) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.raceId);
    return builder.build();
}

export function dictValueParserTimeoutRefund(): DictionaryValue<TimeoutRefund> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTimeoutRefund(src)).endCell());
        },
        parse: (src) => {
            return loadTimeoutRefund(src.loadRef().beginParse());
        }
    }
}

export type WinnerDeclared = {
    $$type: 'WinnerDeclared';
    raceId: bigint;
    winner: Address;
    loser: Address;
    combinedSeed: bigint;
    pot: bigint;
    payout: bigint;
    houseFee: bigint;
}

export function storeWinnerDeclared(src: WinnerDeclared) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1819436017, 32);
        b_0.storeUint(src.raceId, 64);
        b_0.storeAddress(src.winner);
        b_0.storeAddress(src.loser);
        b_0.storeUint(src.combinedSeed, 256);
        b_0.storeCoins(src.pot);
        const b_1 = new Builder();
        b_1.storeCoins(src.payout);
        b_1.storeCoins(src.houseFee);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadWinnerDeclared(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1819436017) { throw Error('Invalid prefix'); }
    const _raceId = sc_0.loadUintBig(64);
    const _winner = sc_0.loadAddress();
    const _loser = sc_0.loadAddress();
    const _combinedSeed = sc_0.loadUintBig(256);
    const _pot = sc_0.loadCoins();
    const sc_1 = sc_0.loadRef().beginParse();
    const _payout = sc_1.loadCoins();
    const _houseFee = sc_1.loadCoins();
    return { $$type: 'WinnerDeclared' as const, raceId: _raceId, winner: _winner, loser: _loser, combinedSeed: _combinedSeed, pot: _pot, payout: _payout, houseFee: _houseFee };
}

export function loadTupleWinnerDeclared(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _winner = source.readAddress();
    const _loser = source.readAddress();
    const _combinedSeed = source.readBigNumber();
    const _pot = source.readBigNumber();
    const _payout = source.readBigNumber();
    const _houseFee = source.readBigNumber();
    return { $$type: 'WinnerDeclared' as const, raceId: _raceId, winner: _winner, loser: _loser, combinedSeed: _combinedSeed, pot: _pot, payout: _payout, houseFee: _houseFee };
}

export function loadGetterTupleWinnerDeclared(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _winner = source.readAddress();
    const _loser = source.readAddress();
    const _combinedSeed = source.readBigNumber();
    const _pot = source.readBigNumber();
    const _payout = source.readBigNumber();
    const _houseFee = source.readBigNumber();
    return { $$type: 'WinnerDeclared' as const, raceId: _raceId, winner: _winner, loser: _loser, combinedSeed: _combinedSeed, pot: _pot, payout: _payout, houseFee: _houseFee };
}

export function storeTupleWinnerDeclared(source: WinnerDeclared) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.raceId);
    builder.writeAddress(source.winner);
    builder.writeAddress(source.loser);
    builder.writeNumber(source.combinedSeed);
    builder.writeNumber(source.pot);
    builder.writeNumber(source.payout);
    builder.writeNumber(source.houseFee);
    return builder.build();
}

export function dictValueParserWinnerDeclared(): DictionaryValue<WinnerDeclared> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeWinnerDeclared(src)).endCell());
        },
        parse: (src) => {
            return loadWinnerDeclared(src.loadRef().beginParse());
        }
    }
}

export type RaceRefunded = {
    $$type: 'RaceRefunded';
    raceId: bigint;
    player1: Address;
    player2: Address;
    refundAmount: bigint;
}

export function storeRaceRefunded(src: RaceRefunded) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1819436018, 32);
        b_0.storeUint(src.raceId, 64);
        b_0.storeAddress(src.player1);
        b_0.storeAddress(src.player2);
        b_0.storeCoins(src.refundAmount);
    };
}

export function loadRaceRefunded(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1819436018) { throw Error('Invalid prefix'); }
    const _raceId = sc_0.loadUintBig(64);
    const _player1 = sc_0.loadAddress();
    const _player2 = sc_0.loadAddress();
    const _refundAmount = sc_0.loadCoins();
    return { $$type: 'RaceRefunded' as const, raceId: _raceId, player1: _player1, player2: _player2, refundAmount: _refundAmount };
}

export function loadTupleRaceRefunded(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _player1 = source.readAddress();
    const _player2 = source.readAddress();
    const _refundAmount = source.readBigNumber();
    return { $$type: 'RaceRefunded' as const, raceId: _raceId, player1: _player1, player2: _player2, refundAmount: _refundAmount };
}

export function loadGetterTupleRaceRefunded(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _player1 = source.readAddress();
    const _player2 = source.readAddress();
    const _refundAmount = source.readBigNumber();
    return { $$type: 'RaceRefunded' as const, raceId: _raceId, player1: _player1, player2: _player2, refundAmount: _refundAmount };
}

export function storeTupleRaceRefunded(source: RaceRefunded) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.raceId);
    builder.writeAddress(source.player1);
    builder.writeAddress(source.player2);
    builder.writeNumber(source.refundAmount);
    return builder.build();
}

export function dictValueParserRaceRefunded(): DictionaryValue<RaceRefunded> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRaceRefunded(src)).endCell());
        },
        parse: (src) => {
            return loadRaceRefunded(src.loadRef().beginParse());
        }
    }
}

export type TokenTransfer = {
    $$type: 'TokenTransfer';
    queryId: bigint;
    amount: bigint;
    destination: Address;
    responseDestination: Address;
    customPayload: Cell | null;
    forwardTonAmount: bigint;
    forwardPayload: Slice;
}

export function storeTokenTransfer(src: TokenTransfer) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(260734629, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeCoins(src.amount);
        b_0.storeAddress(src.destination);
        b_0.storeAddress(src.responseDestination);
        if (src.customPayload !== null && src.customPayload !== undefined) { b_0.storeBit(true).storeRef(src.customPayload); } else { b_0.storeBit(false); }
        b_0.storeCoins(src.forwardTonAmount);
        b_0.storeBuilder(src.forwardPayload.asBuilder());
    };
}

export function loadTokenTransfer(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 260734629) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _amount = sc_0.loadCoins();
    const _destination = sc_0.loadAddress();
    const _responseDestination = sc_0.loadAddress();
    const _customPayload = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _forwardTonAmount = sc_0.loadCoins();
    const _forwardPayload = sc_0;
    return { $$type: 'TokenTransfer' as const, queryId: _queryId, amount: _amount, destination: _destination, responseDestination: _responseDestination, customPayload: _customPayload, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function loadTupleTokenTransfer(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _destination = source.readAddress();
    const _responseDestination = source.readAddress();
    const _customPayload = source.readCellOpt();
    const _forwardTonAmount = source.readBigNumber();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'TokenTransfer' as const, queryId: _queryId, amount: _amount, destination: _destination, responseDestination: _responseDestination, customPayload: _customPayload, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function loadGetterTupleTokenTransfer(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _destination = source.readAddress();
    const _responseDestination = source.readAddress();
    const _customPayload = source.readCellOpt();
    const _forwardTonAmount = source.readBigNumber();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'TokenTransfer' as const, queryId: _queryId, amount: _amount, destination: _destination, responseDestination: _responseDestination, customPayload: _customPayload, forwardTonAmount: _forwardTonAmount, forwardPayload: _forwardPayload };
}

export function storeTupleTokenTransfer(source: TokenTransfer) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.amount);
    builder.writeAddress(source.destination);
    builder.writeAddress(source.responseDestination);
    builder.writeCell(source.customPayload);
    builder.writeNumber(source.forwardTonAmount);
    builder.writeSlice(source.forwardPayload.asCell());
    return builder.build();
}

export function dictValueParserTokenTransfer(): DictionaryValue<TokenTransfer> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTokenTransfer(src)).endCell());
        },
        parse: (src) => {
            return loadTokenTransfer(src.loadRef().beginParse());
        }
    }
}

export type Race = {
    $$type: 'Race';
    stake: bigint;
    player1: Address;
    player2: Address;
    deposited1: boolean;
    deposited2: boolean;
    commit1: bigint;
    commit2: bigint;
    hasCommit1: boolean;
    hasCommit2: boolean;
    secret1: bigint;
    secret2: bigint;
    hasReveal1: boolean;
    hasReveal2: boolean;
    commitDeadline: bigint;
    revealDeadline: bigint;
    state: bigint;
}

export function storeRace(src: Race) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeCoins(src.stake);
        b_0.storeAddress(src.player1);
        b_0.storeAddress(src.player2);
        b_0.storeBit(src.deposited1);
        b_0.storeBit(src.deposited2);
        b_0.storeUint(src.commit1, 256);
        const b_1 = new Builder();
        b_1.storeUint(src.commit2, 256);
        b_1.storeBit(src.hasCommit1);
        b_1.storeBit(src.hasCommit2);
        b_1.storeUint(src.secret1, 256);
        b_1.storeUint(src.secret2, 256);
        b_1.storeBit(src.hasReveal1);
        b_1.storeBit(src.hasReveal2);
        b_1.storeUint(src.commitDeadline, 32);
        b_1.storeUint(src.revealDeadline, 32);
        b_1.storeUint(src.state, 8);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadRace(slice: Slice) {
    const sc_0 = slice;
    const _stake = sc_0.loadCoins();
    const _player1 = sc_0.loadAddress();
    const _player2 = sc_0.loadAddress();
    const _deposited1 = sc_0.loadBit();
    const _deposited2 = sc_0.loadBit();
    const _commit1 = sc_0.loadUintBig(256);
    const sc_1 = sc_0.loadRef().beginParse();
    const _commit2 = sc_1.loadUintBig(256);
    const _hasCommit1 = sc_1.loadBit();
    const _hasCommit2 = sc_1.loadBit();
    const _secret1 = sc_1.loadUintBig(256);
    const _secret2 = sc_1.loadUintBig(256);
    const _hasReveal1 = sc_1.loadBit();
    const _hasReveal2 = sc_1.loadBit();
    const _commitDeadline = sc_1.loadUintBig(32);
    const _revealDeadline = sc_1.loadUintBig(32);
    const _state = sc_1.loadUintBig(8);
    return { $$type: 'Race' as const, stake: _stake, player1: _player1, player2: _player2, deposited1: _deposited1, deposited2: _deposited2, commit1: _commit1, commit2: _commit2, hasCommit1: _hasCommit1, hasCommit2: _hasCommit2, secret1: _secret1, secret2: _secret2, hasReveal1: _hasReveal1, hasReveal2: _hasReveal2, commitDeadline: _commitDeadline, revealDeadline: _revealDeadline, state: _state };
}

export function loadTupleRace(source: TupleReader) {
    const _stake = source.readBigNumber();
    const _player1 = source.readAddress();
    const _player2 = source.readAddress();
    const _deposited1 = source.readBoolean();
    const _deposited2 = source.readBoolean();
    const _commit1 = source.readBigNumber();
    const _commit2 = source.readBigNumber();
    const _hasCommit1 = source.readBoolean();
    const _hasCommit2 = source.readBoolean();
    const _secret1 = source.readBigNumber();
    const _secret2 = source.readBigNumber();
    const _hasReveal1 = source.readBoolean();
    const _hasReveal2 = source.readBoolean();
    const _commitDeadline = source.readBigNumber();
    source = source.readTuple();
    const _revealDeadline = source.readBigNumber();
    const _state = source.readBigNumber();
    return { $$type: 'Race' as const, stake: _stake, player1: _player1, player2: _player2, deposited1: _deposited1, deposited2: _deposited2, commit1: _commit1, commit2: _commit2, hasCommit1: _hasCommit1, hasCommit2: _hasCommit2, secret1: _secret1, secret2: _secret2, hasReveal1: _hasReveal1, hasReveal2: _hasReveal2, commitDeadline: _commitDeadline, revealDeadline: _revealDeadline, state: _state };
}

export function loadGetterTupleRace(source: TupleReader) {
    const _stake = source.readBigNumber();
    const _player1 = source.readAddress();
    const _player2 = source.readAddress();
    const _deposited1 = source.readBoolean();
    const _deposited2 = source.readBoolean();
    const _commit1 = source.readBigNumber();
    const _commit2 = source.readBigNumber();
    const _hasCommit1 = source.readBoolean();
    const _hasCommit2 = source.readBoolean();
    const _secret1 = source.readBigNumber();
    const _secret2 = source.readBigNumber();
    const _hasReveal1 = source.readBoolean();
    const _hasReveal2 = source.readBoolean();
    const _commitDeadline = source.readBigNumber();
    const _revealDeadline = source.readBigNumber();
    const _state = source.readBigNumber();
    return { $$type: 'Race' as const, stake: _stake, player1: _player1, player2: _player2, deposited1: _deposited1, deposited2: _deposited2, commit1: _commit1, commit2: _commit2, hasCommit1: _hasCommit1, hasCommit2: _hasCommit2, secret1: _secret1, secret2: _secret2, hasReveal1: _hasReveal1, hasReveal2: _hasReveal2, commitDeadline: _commitDeadline, revealDeadline: _revealDeadline, state: _state };
}

export function storeTupleRace(source: Race) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.stake);
    builder.writeAddress(source.player1);
    builder.writeAddress(source.player2);
    builder.writeBoolean(source.deposited1);
    builder.writeBoolean(source.deposited2);
    builder.writeNumber(source.commit1);
    builder.writeNumber(source.commit2);
    builder.writeBoolean(source.hasCommit1);
    builder.writeBoolean(source.hasCommit2);
    builder.writeNumber(source.secret1);
    builder.writeNumber(source.secret2);
    builder.writeBoolean(source.hasReveal1);
    builder.writeBoolean(source.hasReveal2);
    builder.writeNumber(source.commitDeadline);
    builder.writeNumber(source.revealDeadline);
    builder.writeNumber(source.state);
    return builder.build();
}

export function dictValueParserRace(): DictionaryValue<Race> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRace(src)).endCell());
        },
        parse: (src) => {
            return loadRace(src.loadRef().beginParse());
        }
    }
}

export type LadaEscrow$Data = {
    $$type: 'LadaEscrow$Data';
    owner: Address;
    houseWallet: Address;
    ladaJettonWallet: Address;
    races: Dictionary<bigint, Race>;
}

export function storeLadaEscrow$Data(src: LadaEscrow$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.owner);
        b_0.storeAddress(src.houseWallet);
        b_0.storeAddress(src.ladaJettonWallet);
        b_0.storeDict(src.races, Dictionary.Keys.BigUint(64), dictValueParserRace());
    };
}

export function loadLadaEscrow$Data(slice: Slice) {
    const sc_0 = slice;
    const _owner = sc_0.loadAddress();
    const _houseWallet = sc_0.loadAddress();
    const _ladaJettonWallet = sc_0.loadAddress();
    const _races = Dictionary.load(Dictionary.Keys.BigUint(64), dictValueParserRace(), sc_0);
    return { $$type: 'LadaEscrow$Data' as const, owner: _owner, houseWallet: _houseWallet, ladaJettonWallet: _ladaJettonWallet, races: _races };
}

export function loadTupleLadaEscrow$Data(source: TupleReader) {
    const _owner = source.readAddress();
    const _houseWallet = source.readAddress();
    const _ladaJettonWallet = source.readAddress();
    const _races = Dictionary.loadDirect(Dictionary.Keys.BigUint(64), dictValueParserRace(), source.readCellOpt());
    return { $$type: 'LadaEscrow$Data' as const, owner: _owner, houseWallet: _houseWallet, ladaJettonWallet: _ladaJettonWallet, races: _races };
}

export function loadGetterTupleLadaEscrow$Data(source: TupleReader) {
    const _owner = source.readAddress();
    const _houseWallet = source.readAddress();
    const _ladaJettonWallet = source.readAddress();
    const _races = Dictionary.loadDirect(Dictionary.Keys.BigUint(64), dictValueParserRace(), source.readCellOpt());
    return { $$type: 'LadaEscrow$Data' as const, owner: _owner, houseWallet: _houseWallet, ladaJettonWallet: _ladaJettonWallet, races: _races };
}

export function storeTupleLadaEscrow$Data(source: LadaEscrow$Data) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.owner);
    builder.writeAddress(source.houseWallet);
    builder.writeAddress(source.ladaJettonWallet);
    builder.writeCell(source.races.size > 0 ? beginCell().storeDictDirect(source.races, Dictionary.Keys.BigUint(64), dictValueParserRace()).endCell() : null);
    return builder.build();
}

export function dictValueParserLadaEscrow$Data(): DictionaryValue<LadaEscrow$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeLadaEscrow$Data(src)).endCell());
        },
        parse: (src) => {
            return loadLadaEscrow$Data(src.loadRef().beginParse());
        }
    }
}

 type LadaEscrow_init_args = {
    $$type: 'LadaEscrow_init_args';
    owner: Address;
    houseWallet: Address;
    ladaJettonWallet: Address;
}

function initLadaEscrow_init_args(src: LadaEscrow_init_args) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.owner);
        b_0.storeAddress(src.houseWallet);
        b_0.storeAddress(src.ladaJettonWallet);
    };
}

async function LadaEscrow_init(owner: Address, houseWallet: Address, ladaJettonWallet: Address) {
    const __code = Cell.fromHex('b5ee9c72410226010008f4000228ff008e88f4a413f4bcf2c80bed5320e303ed43d9010c02027102070201580305014fb4a3bda89a1a4000339f481f481f481e808aa60d82939f481f481f480aa4007a2b0dbc5b678d883004000223014fb6573da89a1a4000339f481f481f481e808aa60d82939f481f481f480aa4007a2b0dbc5b678d883006000222020120080a014fb8a09ed44d0d200019cfa40fa40fa40f40455306c149cfa40fa40fa40552003d1586de2db3c6c418090002210187b9e56ed44d0d200019cfa40fa40fa40f40455306c149cfa40fa40fa40552003d1586de25503db3c6c41206e92306d9d206ef2d0806f2f6f226f026f0fe2206e92306dde80b01408040220259f40f6fa192306ddf206e92306d8e8bd0db3c5710550e6f026f0fe22002ec30eda2edfb01d072d721d200d200fa4021103450666f04f86102f862ed44d0d200019cfa40fa40fa40f40455306c149cfa40fa40fa40552003d1586de205925f05e023d749c21fe30003f90182f045fbdc04db11753bce1c6ba0df964b42095214d2014b759eaa0351645c26defbbae3025f04f2c0820d24045203d31f2182106c726300bae3022182107362d09cbae3022182106c726301bae3022182106c726302ba0e10141803f431d33ffa00fa40fa4030810e55f84227c705f2f48200e8552880402659f40f6fa192306ddf206e92306d8e8bd0db3c5710550e6f026f0fe26ef2f48200cae95321c705b3f2f48200adb323c200f2f4804070707020707053227070f823810708a053330f11100f0e11100e0d11100dc8111055e0db3cc9103612201e0f0046206e953059f45b30944133f417e24330c87f01ca0055305034cececef400c9ed54db3104f831d33f31fa00fa40816f5ff84227c705f2f420d749c1408e9d3010351024430070db3cc87f01ca0055305034cececef400c9ed54db31e0d33f302680402259f40f6fa192306ddf206e92306d8e8bd0db3c5710550e6f026f0fe2206e8e9d5b10351024430070db3cc87f01ca0055305034cececef400c9ed54db31e02220221104fa206ef2d0806f2f6f2220c300917f9556125610bde28e9f5f0f5b10351024430070db3cc87f01ca0055305034cececef400c9ed54db31e056112fc705922cb39170e28eb656112ec705920bb3923b70e28e9f5f0f3010351024430070db3cc87f01ca0055305034cececef400c9ed54db31e15710571010897f09e30d2022221213000c3c571057107f01c091299170e29d3a3f71f823810708a01110500ade10de10cd0b0c109a1089107810671056104510344130011110010f80401111c8111055e0db3cc91036206e953059f45b30944133f417e24330c87f01ca0055305034cececef400c9ed54db311e04fe31d33fd3ff302580402359f40f6fa192306ddf206e92306d8e8bd0db3c5710550e6f026f0fe2810b91216eb3f2f4206ef2d0806f2f6f228200819e21c001f2f482009d69f82324b9f2f4f8422fc7058e22f8422ec7059a398161ac07b317f2f47f9a5710812418f2f0108f06e2109f10890607e30d2091269170e2e300109f2015161700163a8200e9b708b318f2f47f0016373872f823810258a0509701668040111018c8111055e0db3cc9103612206e953059f45b30944133f417e24330c87f01ca0055305034cececef400c9ed54db311e02c4e3022182106c726303bae302018210946a98b6ba8e4ad33f30c8018210aff90f5758cb1fcb3fc9443012f84270705003804201503304c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00c87f01ca0055305034cececef400c9ed54db31e003191f03fc31d33fd3ff302580402359f40f6fa192306ddf206e92306d8e8bd0db3c5710550e6f026f0fe2810b91216eb3f2f4206ef2d0806f2f6f228200b81321c002f2f48200be6ff82323b9f2f4c8561101cbffc9d09b9320d74a91d5e868f90400da11f8425610c7058e1337810b2705b315f2f4813712516aba16f2f47fe30e20201a1b005cf8422fc7058e1436820081ed04b314f2f48137125159ba15f2f47f9b305710812418f2f0044f1fe2105f1045401302f691229170e28ebd11121114111211111113111111111112111110ef10de10cd10bc10ab109a10891078106704415503db3cc87f01ca0055305034cececef400c9ed54db31e0105f038040111001c8111055e0db3cc9103612206e953059f45b30944133f417e24330c87f01ca0055305034cececef400c9ed54db311c1e03ee5f056c62c812cbffcbfff82301cb1fc9d09b9320d74a91d5e868f90400da1120a93800546240c001915b923333e203aa00208101f4a8812710a9045ca1103a4987547a76db3c547286db3c2606105b104b4a135089c8556082106c7263f15008cb1f16cb3f14ce12cecbff01fa02c858fa0258fa02cdc922221d003ec88258c000000000000000000000000101cb67ccc970fb00018040f45b30120064011110010ffa021dce1bce19ca0017ca0015cbff03c8cbff12ca00ca0012cbff12cbff12ca0012ca0012cb1f13cb1fcb07cd04f031d33f302480402259f40f6fa192306ddf206e92306d8e8bd0db3c5710550e6f026f0fe2810b91216eb3f2f4206ef2d0806f2f6f226c63333381531d22c000917f9322c001e2917f9322c002e2f2f401c00291309131e28139f6f82358bcf2f4018e8f10364578547564db3c507810361025dee3002303c8202221230064fa00fa40fa40d200d200d3ffd401d0d3ffd200d200d3ffd3ffd200d200d31fd31fd307300a11100a10af10ae10ad10ac10ab011e10354467547745db3c5067103510242200d8820afaf080716d82089896808b0827105704085520c8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec92450335a6d6d40037fc8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb000092553082106c7263f25005cb1f13cb3fcece01fa02c9c88258c000000000000000000000000101cb67ccc970fb0050048040f45b304330c87f01ca0055305034cececef400c9ed54db3101b882008aabf84223c705f2f470810082882455205a6d6d40037fc8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb004003c87f01ca0055305034cececef400c9ed5425000052458fef');
    const builder = beginCell();
    builder.storeUint(0, 1);
    initLadaEscrow_init_args({ $$type: 'LadaEscrow_init_args', owner, houseWallet, ladaJettonWallet })(builder);
    const __data = builder.endCell();
    return { code: __code, data: __data };
}

export const LadaEscrow_errors = {
    2: { message: "Stack underflow" },
    3: { message: "Stack overflow" },
    4: { message: "Integer overflow" },
    5: { message: "Integer out of expected range" },
    6: { message: "Invalid opcode" },
    7: { message: "Type check error" },
    8: { message: "Cell overflow" },
    9: { message: "Cell underflow" },
    10: { message: "Dictionary error" },
    11: { message: "'Unknown' error" },
    12: { message: "Fatal error" },
    13: { message: "Out of gas error" },
    14: { message: "Virtualization error" },
    32: { message: "Action list is invalid" },
    33: { message: "Action list is too long" },
    34: { message: "Action is invalid or not supported" },
    35: { message: "Invalid source address in outbound message" },
    36: { message: "Invalid destination address in outbound message" },
    37: { message: "Not enough Toncoin" },
    38: { message: "Not enough extra currencies" },
    39: { message: "Outbound message does not fit into a cell after rewriting" },
    40: { message: "Cannot process a message" },
    41: { message: "Library reference is null" },
    42: { message: "Library change action error" },
    43: { message: "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree" },
    50: { message: "Account state size exceeded limits" },
    128: { message: "Null reference exception" },
    129: { message: "Invalid serialization prefix" },
    130: { message: "Invalid incoming message" },
    131: { message: "Constraints error" },
    132: { message: "Access denied" },
    133: { message: "Contract stopped" },
    134: { message: "Invalid argument" },
    135: { message: "Code of a contract was not found" },
    136: { message: "Invalid standard address" },
    138: { message: "Not a basechain address" },
    2855: { message: "Player1 already revealed" },
    2961: { message: "Unknown race" },
    3669: { message: "Only owner may create races" },
    9240: { message: "Not a player in this race" },
    14098: { message: "Secret does not match commit" },
    14838: { message: "Not yet timed out" },
    21277: { message: "Already finalized" },
    25004: { message: "Player2 already committed" },
    28511: { message: "Only Lada jetton wallet may notify" },
    33182: { message: "Not in commit phase" },
    33261: { message: "Player2 already revealed" },
    35499: { message: "Only owner" },
    40297: { message: "Commit window closed" },
    44467: { message: "Stake must be positive" },
    47123: { message: "Not in reveal phase" },
    48751: { message: "Reveal window closed" },
    51945: { message: "Players must differ" },
    59477: { message: "Race already exists" },
    59831: { message: "Player1 already committed" },
} as const

export const LadaEscrow_errors_backward = {
    "Stack underflow": 2,
    "Stack overflow": 3,
    "Integer overflow": 4,
    "Integer out of expected range": 5,
    "Invalid opcode": 6,
    "Type check error": 7,
    "Cell overflow": 8,
    "Cell underflow": 9,
    "Dictionary error": 10,
    "'Unknown' error": 11,
    "Fatal error": 12,
    "Out of gas error": 13,
    "Virtualization error": 14,
    "Action list is invalid": 32,
    "Action list is too long": 33,
    "Action is invalid or not supported": 34,
    "Invalid source address in outbound message": 35,
    "Invalid destination address in outbound message": 36,
    "Not enough Toncoin": 37,
    "Not enough extra currencies": 38,
    "Outbound message does not fit into a cell after rewriting": 39,
    "Cannot process a message": 40,
    "Library reference is null": 41,
    "Library change action error": 42,
    "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree": 43,
    "Account state size exceeded limits": 50,
    "Null reference exception": 128,
    "Invalid serialization prefix": 129,
    "Invalid incoming message": 130,
    "Constraints error": 131,
    "Access denied": 132,
    "Contract stopped": 133,
    "Invalid argument": 134,
    "Code of a contract was not found": 135,
    "Invalid standard address": 136,
    "Not a basechain address": 138,
    "Player1 already revealed": 2855,
    "Unknown race": 2961,
    "Only owner may create races": 3669,
    "Not a player in this race": 9240,
    "Secret does not match commit": 14098,
    "Not yet timed out": 14838,
    "Already finalized": 21277,
    "Player2 already committed": 25004,
    "Only Lada jetton wallet may notify": 28511,
    "Not in commit phase": 33182,
    "Player2 already revealed": 33261,
    "Only owner": 35499,
    "Commit window closed": 40297,
    "Stake must be positive": 44467,
    "Not in reveal phase": 47123,
    "Reveal window closed": 48751,
    "Players must differ": 51945,
    "Race already exists": 59477,
    "Player1 already committed": 59831,
} as const

const LadaEscrow_types: ABIType[] = [
    {"name":"DataSize","header":null,"fields":[{"name":"cells","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bits","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"refs","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"SignedBundle","header":null,"fields":[{"name":"signature","type":{"kind":"simple","type":"fixed-bytes","optional":false,"format":64}},{"name":"signedData","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"StateInit","header":null,"fields":[{"name":"code","type":{"kind":"simple","type":"cell","optional":false}},{"name":"data","type":{"kind":"simple","type":"cell","optional":false}}]},
    {"name":"Context","header":null,"fields":[{"name":"bounceable","type":{"kind":"simple","type":"bool","optional":false}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"raw","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"SendParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"code","type":{"kind":"simple","type":"cell","optional":true}},{"name":"data","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"MessageParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"DeployParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}},{"name":"init","type":{"kind":"simple","type":"StateInit","optional":false}}]},
    {"name":"StdAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":8}},{"name":"address","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"VarAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":32}},{"name":"address","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"BasechainAddress","header":null,"fields":[{"name":"hash","type":{"kind":"simple","type":"int","optional":true,"format":257}}]},
    {"name":"Deploy","header":2490013878,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"DeployOk","header":2952335191,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"FactoryDeploy","header":1829761339,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"cashback","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"TokenNotification","header":1935855772,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"from","type":{"kind":"simple","type":"address","optional":false}},{"name":"forwardPayload","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"CreateRace","header":1819435776,"fields":[{"name":"raceId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"stake","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"player1","type":{"kind":"simple","type":"address","optional":false}},{"name":"player2","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"CommitHash","header":1819435777,"fields":[{"name":"raceId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"commit","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"RevealSecret","header":1819435778,"fields":[{"name":"raceId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"secret","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"TimeoutRefund","header":1819435779,"fields":[{"name":"raceId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"WinnerDeclared","header":1819436017,"fields":[{"name":"raceId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"winner","type":{"kind":"simple","type":"address","optional":false}},{"name":"loser","type":{"kind":"simple","type":"address","optional":false}},{"name":"combinedSeed","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"pot","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"payout","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"houseFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"RaceRefunded","header":1819436018,"fields":[{"name":"raceId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"player1","type":{"kind":"simple","type":"address","optional":false}},{"name":"player2","type":{"kind":"simple","type":"address","optional":false}},{"name":"refundAmount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"TokenTransfer","header":260734629,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"destination","type":{"kind":"simple","type":"address","optional":false}},{"name":"responseDestination","type":{"kind":"simple","type":"address","optional":false}},{"name":"customPayload","type":{"kind":"simple","type":"cell","optional":true}},{"name":"forwardTonAmount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"forwardPayload","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"Race","header":null,"fields":[{"name":"stake","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"player1","type":{"kind":"simple","type":"address","optional":false}},{"name":"player2","type":{"kind":"simple","type":"address","optional":false}},{"name":"deposited1","type":{"kind":"simple","type":"bool","optional":false}},{"name":"deposited2","type":{"kind":"simple","type":"bool","optional":false}},{"name":"commit1","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"commit2","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"hasCommit1","type":{"kind":"simple","type":"bool","optional":false}},{"name":"hasCommit2","type":{"kind":"simple","type":"bool","optional":false}},{"name":"secret1","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"secret2","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"hasReveal1","type":{"kind":"simple","type":"bool","optional":false}},{"name":"hasReveal2","type":{"kind":"simple","type":"bool","optional":false}},{"name":"commitDeadline","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"revealDeadline","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"state","type":{"kind":"simple","type":"uint","optional":false,"format":8}}]},
    {"name":"LadaEscrow$Data","header":null,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"houseWallet","type":{"kind":"simple","type":"address","optional":false}},{"name":"ladaJettonWallet","type":{"kind":"simple","type":"address","optional":false}},{"name":"races","type":{"kind":"dict","key":"uint","keyFormat":64,"value":"Race","valueFormat":"ref"}}]},
]

const LadaEscrow_opcodes = {
    "Deploy": 2490013878,
    "DeployOk": 2952335191,
    "FactoryDeploy": 1829761339,
    "TokenNotification": 1935855772,
    "CreateRace": 1819435776,
    "CommitHash": 1819435777,
    "RevealSecret": 1819435778,
    "TimeoutRefund": 1819435779,
    "WinnerDeclared": 1819436017,
    "RaceRefunded": 1819436018,
    "TokenTransfer": 260734629,
}

const LadaEscrow_getters: ABIGetter[] = [
    {"name":"raceOf","methodId":122454,"arguments":[{"name":"raceId","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"Race","optional":true}},
    {"name":"owner","methodId":83229,"arguments":[],"returnType":{"kind":"simple","type":"address","optional":false}},
    {"name":"houseWalletAddress","methodId":94905,"arguments":[],"returnType":{"kind":"simple","type":"address","optional":false}},
    {"name":"jettonWalletAddress","methodId":100873,"arguments":[],"returnType":{"kind":"simple","type":"address","optional":false}},
]

export const LadaEscrow_getterMapping: { [key: string]: string } = {
    'raceOf': 'getRaceOf',
    'owner': 'getOwner',
    'houseWalletAddress': 'getHouseWalletAddress',
    'jettonWalletAddress': 'getJettonWalletAddress',
}

const LadaEscrow_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"typed","type":"CreateRace"}},
    {"receiver":"internal","message":{"kind":"typed","type":"TokenNotification"}},
    {"receiver":"internal","message":{"kind":"typed","type":"CommitHash"}},
    {"receiver":"internal","message":{"kind":"typed","type":"RevealSecret"}},
    {"receiver":"internal","message":{"kind":"typed","type":"TimeoutRefund"}},
    {"receiver":"internal","message":{"kind":"text","text":"withdrawTon"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Deploy"}},
]

export const HOUSE_FEE_BPS = 500n;
export const BPS_DENOMINATOR = 10000n;
export const COMMIT_TIMEOUT_SECS = 1800n;
export const REVEAL_TIMEOUT_SECS = 600n;
export const JETTON_FORWARD_TON = 50000000n;
export const JETTON_NOTIFY_TON = 10000000n;
export const STATE_AWAITING_DEPOSITS = 0n;
export const STATE_AWAITING_COMMITS = 1n;
export const STATE_AWAITING_REVEALS = 2n;
export const STATE_SETTLED = 3n;
export const STATE_REFUNDED = 4n;

export class LadaEscrow implements Contract {
    
    public static readonly storageReserve = 0n;
    public static readonly errors = LadaEscrow_errors_backward;
    public static readonly opcodes = LadaEscrow_opcodes;
    
    static async init(owner: Address, houseWallet: Address, ladaJettonWallet: Address) {
        return await LadaEscrow_init(owner, houseWallet, ladaJettonWallet);
    }
    
    static async fromInit(owner: Address, houseWallet: Address, ladaJettonWallet: Address) {
        const __gen_init = await LadaEscrow_init(owner, houseWallet, ladaJettonWallet);
        const address = contractAddress(0, __gen_init);
        return new LadaEscrow(address, __gen_init);
    }
    
    static fromAddress(address: Address) {
        return new LadaEscrow(address);
    }
    
    readonly address: Address; 
    readonly init?: { code: Cell, data: Cell };
    readonly abi: ContractABI = {
        types:  LadaEscrow_types,
        getters: LadaEscrow_getters,
        receivers: LadaEscrow_receivers,
        errors: LadaEscrow_errors,
    };
    
    constructor(address: Address, init?: { code: Cell, data: Cell }) {
        this.address = address;
        this.init = init;
    }
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: CreateRace | TokenNotification | CommitHash | RevealSecret | TimeoutRefund | "withdrawTon" | Deploy) {
        
        let body: Cell | null = null;
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'CreateRace') {
            body = beginCell().store(storeCreateRace(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'TokenNotification') {
            body = beginCell().store(storeTokenNotification(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'CommitHash') {
            body = beginCell().store(storeCommitHash(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'RevealSecret') {
            body = beginCell().store(storeRevealSecret(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'TimeoutRefund') {
            body = beginCell().store(storeTimeoutRefund(message)).endCell();
        }
        if (message === "withdrawTon") {
            body = beginCell().storeUint(0, 32).storeStringTail(message).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Deploy') {
            body = beginCell().store(storeDeploy(message)).endCell();
        }
        if (body === null) { throw new Error('Invalid message type'); }
        
        await provider.internal(via, { ...args, body: body });
        
    }
    
    async getRaceOf(provider: ContractProvider, raceId: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(raceId);
        const source = (await provider.get('raceOf', builder.build())).stack;
        const result_p = source.readTupleOpt();
        const result = result_p ? loadTupleRace(result_p) : null;
        return result;
    }
    
    async getOwner(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('owner', builder.build())).stack;
        const result = source.readAddress();
        return result;
    }
    
    async getHouseWalletAddress(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('houseWalletAddress', builder.build())).stack;
        const result = source.readAddress();
        return result;
    }
    
    async getJettonWalletAddress(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('jettonWalletAddress', builder.build())).stack;
        const result = source.readAddress();
        return result;
    }
    
}