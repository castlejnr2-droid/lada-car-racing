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

export type Payout = {
    $$type: 'Payout';
    raceId: bigint;
    winner: Address;
    seed: bigint;
}

export function storePayout(src: Payout) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1819435780, 32);
        b_0.storeUint(src.raceId, 64);
        b_0.storeAddress(src.winner);
        b_0.storeUint(src.seed, 256);
    };
}

export function loadPayout(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1819435780) { throw Error('Invalid prefix'); }
    const _raceId = sc_0.loadUintBig(64);
    const _winner = sc_0.loadAddress();
    const _seed = sc_0.loadUintBig(256);
    return { $$type: 'Payout' as const, raceId: _raceId, winner: _winner, seed: _seed };
}

export function loadTuplePayout(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _winner = source.readAddress();
    const _seed = source.readBigNumber();
    return { $$type: 'Payout' as const, raceId: _raceId, winner: _winner, seed: _seed };
}

export function loadGetterTuplePayout(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _winner = source.readAddress();
    const _seed = source.readBigNumber();
    return { $$type: 'Payout' as const, raceId: _raceId, winner: _winner, seed: _seed };
}

export function storeTuplePayout(source: Payout) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.raceId);
    builder.writeAddress(source.winner);
    builder.writeNumber(source.seed);
    return builder.build();
}

export function dictValueParserPayout(): DictionaryValue<Payout> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storePayout(src)).endCell());
        },
        parse: (src) => {
            return loadPayout(src.loadRef().beginParse());
        }
    }
}

export type Refund = {
    $$type: 'Refund';
    raceId: bigint;
}

export function storeRefund(src: Refund) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1819435781, 32);
        b_0.storeUint(src.raceId, 64);
    };
}

export function loadRefund(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1819435781) { throw Error('Invalid prefix'); }
    const _raceId = sc_0.loadUintBig(64);
    return { $$type: 'Refund' as const, raceId: _raceId };
}

export function loadTupleRefund(source: TupleReader) {
    const _raceId = source.readBigNumber();
    return { $$type: 'Refund' as const, raceId: _raceId };
}

export function loadGetterTupleRefund(source: TupleReader) {
    const _raceId = source.readBigNumber();
    return { $$type: 'Refund' as const, raceId: _raceId };
}

export function storeTupleRefund(source: Refund) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.raceId);
    return builder.build();
}

export function dictValueParserRefund(): DictionaryValue<Refund> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRefund(src)).endCell());
        },
        parse: (src) => {
            return loadRefund(src.loadRef().beginParse());
        }
    }
}

export type WithdrawJettons = {
    $$type: 'WithdrawJettons';
    amount: bigint;
    to: Address;
}

export function storeWithdrawJettons(src: WithdrawJettons) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1819435782, 32);
        b_0.storeCoins(src.amount);
        b_0.storeAddress(src.to);
    };
}

export function loadWithdrawJettons(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1819435782) { throw Error('Invalid prefix'); }
    const _amount = sc_0.loadCoins();
    const _to = sc_0.loadAddress();
    return { $$type: 'WithdrawJettons' as const, amount: _amount, to: _to };
}

export function loadTupleWithdrawJettons(source: TupleReader) {
    const _amount = source.readBigNumber();
    const _to = source.readAddress();
    return { $$type: 'WithdrawJettons' as const, amount: _amount, to: _to };
}

export function loadGetterTupleWithdrawJettons(source: TupleReader) {
    const _amount = source.readBigNumber();
    const _to = source.readAddress();
    return { $$type: 'WithdrawJettons' as const, amount: _amount, to: _to };
}

export function storeTupleWithdrawJettons(source: WithdrawJettons) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.amount);
    builder.writeAddress(source.to);
    return builder.build();
}

export function dictValueParserWithdrawJettons(): DictionaryValue<WithdrawJettons> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeWithdrawJettons(src)).endCell());
        },
        parse: (src) => {
            return loadWithdrawJettons(src.loadRef().beginParse());
        }
    }
}

export type SetJettonWallet = {
    $$type: 'SetJettonWallet';
    wallet: Address;
}

export function storeSetJettonWallet(src: SetJettonWallet) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1819435783, 32);
        b_0.storeAddress(src.wallet);
    };
}

export function loadSetJettonWallet(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1819435783) { throw Error('Invalid prefix'); }
    const _wallet = sc_0.loadAddress();
    return { $$type: 'SetJettonWallet' as const, wallet: _wallet };
}

export function loadTupleSetJettonWallet(source: TupleReader) {
    const _wallet = source.readAddress();
    return { $$type: 'SetJettonWallet' as const, wallet: _wallet };
}

export function loadGetterTupleSetJettonWallet(source: TupleReader) {
    const _wallet = source.readAddress();
    return { $$type: 'SetJettonWallet' as const, wallet: _wallet };
}

export function storeTupleSetJettonWallet(source: SetJettonWallet) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.wallet);
    return builder.build();
}

export function dictValueParserSetJettonWallet(): DictionaryValue<SetJettonWallet> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetJettonWallet(src)).endCell());
        },
        parse: (src) => {
            return loadSetJettonWallet(src.loadRef().beginParse());
        }
    }
}

export type SetPlayer2 = {
    $$type: 'SetPlayer2';
    raceId: bigint;
    player2: Address;
}

export function storeSetPlayer2(src: SetPlayer2) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1819435784, 32);
        b_0.storeUint(src.raceId, 64);
        b_0.storeAddress(src.player2);
    };
}

export function loadSetPlayer2(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1819435784) { throw Error('Invalid prefix'); }
    const _raceId = sc_0.loadUintBig(64);
    const _player2 = sc_0.loadAddress();
    return { $$type: 'SetPlayer2' as const, raceId: _raceId, player2: _player2 };
}

export function loadTupleSetPlayer2(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _player2 = source.readAddress();
    return { $$type: 'SetPlayer2' as const, raceId: _raceId, player2: _player2 };
}

export function loadGetterTupleSetPlayer2(source: TupleReader) {
    const _raceId = source.readBigNumber();
    const _player2 = source.readAddress();
    return { $$type: 'SetPlayer2' as const, raceId: _raceId, player2: _player2 };
}

export function storeTupleSetPlayer2(source: SetPlayer2) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.raceId);
    builder.writeAddress(source.player2);
    return builder.build();
}

export function dictValueParserSetPlayer2(): DictionaryValue<SetPlayer2> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetPlayer2(src)).endCell());
        },
        parse: (src) => {
            return loadSetPlayer2(src.loadRef().beginParse());
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
        b_0.storeUint(src.state, 8);
    };
}

export function loadRace(slice: Slice) {
    const sc_0 = slice;
    const _stake = sc_0.loadCoins();
    const _player1 = sc_0.loadAddress();
    const _player2 = sc_0.loadAddress();
    const _deposited1 = sc_0.loadBit();
    const _deposited2 = sc_0.loadBit();
    const _state = sc_0.loadUintBig(8);
    return { $$type: 'Race' as const, stake: _stake, player1: _player1, player2: _player2, deposited1: _deposited1, deposited2: _deposited2, state: _state };
}

export function loadTupleRace(source: TupleReader) {
    const _stake = source.readBigNumber();
    const _player1 = source.readAddress();
    const _player2 = source.readAddress();
    const _deposited1 = source.readBoolean();
    const _deposited2 = source.readBoolean();
    const _state = source.readBigNumber();
    return { $$type: 'Race' as const, stake: _stake, player1: _player1, player2: _player2, deposited1: _deposited1, deposited2: _deposited2, state: _state };
}

export function loadGetterTupleRace(source: TupleReader) {
    const _stake = source.readBigNumber();
    const _player1 = source.readAddress();
    const _player2 = source.readAddress();
    const _deposited1 = source.readBoolean();
    const _deposited2 = source.readBoolean();
    const _state = source.readBigNumber();
    return { $$type: 'Race' as const, stake: _stake, player1: _player1, player2: _player2, deposited1: _deposited1, deposited2: _deposited2, state: _state };
}

export function storeTupleRace(source: Race) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.stake);
    builder.writeAddress(source.player1);
    builder.writeAddress(source.player2);
    builder.writeBoolean(source.deposited1);
    builder.writeBoolean(source.deposited2);
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
    const __code = Cell.fromHex('b5ee9c7241021f01000788000228ff008e88f4a413f4bcf2c80bed5320e303ed43d9010c02027102070201580305014fb4a3bda89a1a4000339f481f481f481e808aa60d82939f481f481f480aa4007a2b0dbc5b678d883004000223014fb6573da89a1a4000339f481f481f481e808aa60d82939f481f481f480aa4007a2b0dbc5b678d883006000222020120080a014fb8a09ed44d0d200019cfa40fa40fa40f40455306c149cfa40fa40fa40552003d1586de2db3c6c41809000221017fb9e56ed44d0d200019cfa40fa40fa40f40455306c149cfa40fa40fa40552003d1586de25503db3c6c41206e92306d99206ef2d0806f266f06e2206e92306dde80b00508040220259f40f6fa192306ddf206e92306d8e13d0fa00fa40fa40d200d200d30755506c166f06e202ec30eda2edfb01d072d721d200d200fa4021103450666f04f86102f862ed44d0d200019cfa40fa40fa40f40455306c149cfa40fa40fa40552003d1586de205925f05e023d749c21fe30003f90182f045fbdc04db11753bce1c6ba0df964b42095214d2014b759eaa0351645c26defbbae3025f04f2c0820d1d045203d31f2182106c726300bae3022182107362d09cbae3022182106c726304bae3022182106c726305ba0e0f141601e631d33ffa00fa40fa4030810e55f84227c705f2f48200e8552880402659f40f6fa192306ddf206e92306d8e13d0fa00fa40fa40d200d200d30755506c166f06e26ef2f48200cae95321c705b3f2f48200adb323c200f2f480405520707070c855505065fa0213cececa0012ca00cb07c91036121b04fa31d33f31fa00fa40816f5ff84227c705f2f420d749c1408e9d3010351024430070db3cc87f01ca0055305034cececef400c9ed54db31e0d33f302680402259f40f6fa192306ddf206e92306d8e13d0fa00fa40fa40d200d200d30755506c166f06e2206ee302206ef2d0806f2620c300917f935385bde2e3025374c70519101112013a5b10351024430070db3cc87f01ca0055305034cececef400c9ed54db3119013c5f0710351024430070db3cc87f01ca0055305034cececef400c9ed54db311902e29222b39170e2943236367f8eaf5373c7059201b3923170e28e9e5f0610351024430070db3cc87f01ca0055305034cececef400c9ed54db31e1377f36e22091259170e2927137de550380405067c855505065fa0213cececa0012ca00cb07c91036206e953059f45b30944133f417e2433019130026c87f01ca0055305034cececef400c9ed54db3101fe31d33ffa40d3ff30815088f84226c705f2f42680402459f40f6fa192306ddf206e92306d8e13d0fa00fa40fa40d200d200d30755506c166f06e2810b91216eb3f2f4206ef2d0806f2631815c4032c001f2f4813f9d5352c705917f945351c705e2f2f45340c70591309131e201aa00208101f4a8812710a9045ca11038479a1501c65475a6db3c2606051049481350bac8556082106c7263f15008cb1f16cb3f14ce12cecbff01fa02c858fa0258fa02cdc9c88258c000000000000000000000000101cb67ccc970fb0050048040f45b3013c87f01ca0055305034cececef400c9ed54db311904f6e3022182106c726306ba8eac31fa00fa4030813ca5f84225c705f2f410351024430070db3cc87f01ca0055305034cececef400c9ed54db31e02182106c726307ba8e25313302fa4030816802f84223c705f2f45003c87f01ca0055305034cececef400c9ed54db31e02182106c726308bae302018210946a98b6ba17191a1c03fe31d33f30820093e5f84224c705f2f42480402259f40f6fa192306ddf206e92306d8e13d0fa00fa40fa40d200d200d30755506c166f06e2810b91216eb3f2f4206ef2d0806f268200e0b921c00092317f9301c001e2f2f4018e8f10364578547564db3c507810361025de8e8f10354467547745db3c506710351024de2303c81919180092553082106c7263f25005cb1f13cb3fcece01fa02c9c88258c000000000000000000000000101cb67ccc970fb0050048040f45b304330c87f01ca0055305034cececef400c9ed54db3100da821005f5e100716d82089896808b0827105704085520c8556082100f8a7ea55008cb1f16cb3f5004fa0212cecef40001fa02cec92450335a6d6d40037fc8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0001fa31d33ffa40308200ca79f84225c705f2f42580402359f40f6fa192306ddf206e92306d8e13d0fa00fa40fa40d200d200d30755506c166f06e2810b91216eb3f2f4206ef2d0806f2633814f3123c000f2f48200a77021b3f2f48200cae95364c705b3f2f480400603c855505065fa0213cececa0012ca00cb07c91036121b0046206e953059f45b30944133f417e24330c87f01ca0055305034cececef400c9ed54db31009c8e4ad33f30c8018210aff90f5758cb1fcb3fc9443012f84270705003804201503304c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00c87f01ca0055305034cececef400c9ed54db31e00301b882008aabf84223c705f2f470810082882455205a6d6d40037fc8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb004003c87f01ca0055305034cececef400c9ed541e000099fb2204');
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
    2961: { message: "Unknown race" },
    3669: { message: "Only owner may create races" },
    15525: { message: "Only owner may withdraw" },
    16285: { message: "Winner must be a player" },
    20273: { message: "Race not awaiting deposits" },
    20616: { message: "Only owner may payout" },
    23616: { message: "Race not in funded state" },
    26626: { message: "Only owner may set jetton wallet" },
    28511: { message: "Only Lada jetton wallet may notify" },
    35499: { message: "Only owner" },
    37861: { message: "Only owner may refund" },
    42864: { message: "Player2 already deposited" },
    44467: { message: "Stake must be positive" },
    51833: { message: "Only owner may update player2" },
    51945: { message: "Players must differ" },
    57529: { message: "Race already finalized" },
    59477: { message: "Race already exists" },
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
    "Unknown race": 2961,
    "Only owner may create races": 3669,
    "Only owner may withdraw": 15525,
    "Winner must be a player": 16285,
    "Race not awaiting deposits": 20273,
    "Only owner may payout": 20616,
    "Race not in funded state": 23616,
    "Only owner may set jetton wallet": 26626,
    "Only Lada jetton wallet may notify": 28511,
    "Only owner": 35499,
    "Only owner may refund": 37861,
    "Player2 already deposited": 42864,
    "Stake must be positive": 44467,
    "Only owner may update player2": 51833,
    "Players must differ": 51945,
    "Race already finalized": 57529,
    "Race already exists": 59477,
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
    {"name":"Payout","header":1819435780,"fields":[{"name":"raceId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"winner","type":{"kind":"simple","type":"address","optional":false}},{"name":"seed","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"Refund","header":1819435781,"fields":[{"name":"raceId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"WithdrawJettons","header":1819435782,"fields":[{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"SetJettonWallet","header":1819435783,"fields":[{"name":"wallet","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"SetPlayer2","header":1819435784,"fields":[{"name":"raceId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"player2","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"WinnerDeclared","header":1819436017,"fields":[{"name":"raceId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"winner","type":{"kind":"simple","type":"address","optional":false}},{"name":"loser","type":{"kind":"simple","type":"address","optional":false}},{"name":"combinedSeed","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"pot","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"payout","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"houseFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"RaceRefunded","header":1819436018,"fields":[{"name":"raceId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"player1","type":{"kind":"simple","type":"address","optional":false}},{"name":"player2","type":{"kind":"simple","type":"address","optional":false}},{"name":"refundAmount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"TokenTransfer","header":260734629,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"destination","type":{"kind":"simple","type":"address","optional":false}},{"name":"responseDestination","type":{"kind":"simple","type":"address","optional":false}},{"name":"customPayload","type":{"kind":"simple","type":"cell","optional":true}},{"name":"forwardTonAmount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"forwardPayload","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"Race","header":null,"fields":[{"name":"stake","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"player1","type":{"kind":"simple","type":"address","optional":false}},{"name":"player2","type":{"kind":"simple","type":"address","optional":false}},{"name":"deposited1","type":{"kind":"simple","type":"bool","optional":false}},{"name":"deposited2","type":{"kind":"simple","type":"bool","optional":false}},{"name":"state","type":{"kind":"simple","type":"uint","optional":false,"format":8}}]},
    {"name":"LadaEscrow$Data","header":null,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"houseWallet","type":{"kind":"simple","type":"address","optional":false}},{"name":"ladaJettonWallet","type":{"kind":"simple","type":"address","optional":false}},{"name":"races","type":{"kind":"dict","key":"uint","keyFormat":64,"value":"Race","valueFormat":"ref"}}]},
]

const LadaEscrow_opcodes = {
    "Deploy": 2490013878,
    "DeployOk": 2952335191,
    "FactoryDeploy": 1829761339,
    "TokenNotification": 1935855772,
    "CreateRace": 1819435776,
    "Payout": 1819435780,
    "Refund": 1819435781,
    "WithdrawJettons": 1819435782,
    "SetJettonWallet": 1819435783,
    "SetPlayer2": 1819435784,
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
    {"receiver":"internal","message":{"kind":"typed","type":"Payout"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Refund"}},
    {"receiver":"internal","message":{"kind":"typed","type":"WithdrawJettons"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetJettonWallet"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetPlayer2"}},
    {"receiver":"internal","message":{"kind":"text","text":"withdrawTon"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Deploy"}},
]

export const HOUSE_FEE_BPS = 500n;
export const BPS_DENOMINATOR = 10000n;
export const JETTON_FORWARD_TON = 100000000n;
export const JETTON_NOTIFY_TON = 10000000n;
export const STATE_AWAITING_DEPOSITS = 0n;
export const STATE_FUNDED = 1n;

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
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: CreateRace | TokenNotification | Payout | Refund | WithdrawJettons | SetJettonWallet | SetPlayer2 | "withdrawTon" | Deploy) {
        
        let body: Cell | null = null;
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'CreateRace') {
            body = beginCell().store(storeCreateRace(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'TokenNotification') {
            body = beginCell().store(storeTokenNotification(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Payout') {
            body = beginCell().store(storePayout(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Refund') {
            body = beginCell().store(storeRefund(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'WithdrawJettons') {
            body = beginCell().store(storeWithdrawJettons(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SetJettonWallet') {
            body = beginCell().store(storeSetJettonWallet(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SetPlayer2') {
            body = beginCell().store(storeSetPlayer2(message)).endCell();
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