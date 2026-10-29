const fs=require('fs'),assert=require('assert/strict');
const solc=require('solc');
const ganache=require('ganache');
const {BrowserProvider,ContractFactory}=require('ethers');
(async()=>{
const input={language:'Solidity',sources:{'Counter.sol':{content:fs.readFileSync(__dirname+'/../resources/Counter.sol','utf8')}},settings:{outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const result=JSON.parse(solc.compile(JSON.stringify(input)));const errors=(result.errors||[]).filter(e=>e.severity==='error');assert.equal(errors.length,0,JSON.stringify(errors));const artifact=result.contracts['Counter.sol'].Counter;
const rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:2}}),provider=new BrowserProvider(rpc),owner=await provider.getSigner(0),student=await provider.getSigner(1);
const contract=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,owner).deploy();await contract.waitForDeployment();assert.equal(await contract.count(),0n);assert.equal(await contract.owner(),await owner.getAddress());
await(await contract.connect(student).increment()).wait();assert.equal(await contract.count(),1n);
await assert.rejects(contract.connect(student).reset(0));assert.equal(await contract.count(),1n);
await(await contract.reset(7)).wait();assert.equal(await contract.count(),7n);
await assert.rejects(contract.reset(1000001));assert.equal(await contract.count(),7n);
await(await contract.reset(1000000)).wait();assert.equal(await contract.count(),1000000n);
await rpc.disconnect();console.log('PASS: Solidity 0.8.24 compile; EVM deploy; public increment; rejected non-owner reset; owner reset; upper boundary and invalid reset. No external network or real assets used.');
})().catch(e=>{console.error(e);process.exit(1)});