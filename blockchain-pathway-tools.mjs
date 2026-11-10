import {node} from './blockchain-pathway-ui.mjs';

const tools = {
  gas: {
    title:'Gas fee calculator',
    fields:[['Gas used',21000],['Base fee (gwei)',20],['Max priority fee (gwei)',2],['Max fee (gwei)',35]],
    calculate(gas, base, tip, cap) {
      if (cap < base) return 'Max fee wuxuu ka hooseeyaa base fee. Transaction-ku hadda ma geli karo block.';
      const rate = base + (tip < cap-base ? tip : cap-base);
      return `${gas*rate} gwei · ${formatUnits(gas*rate, 9)} ETH · ${rate} gwei halkii gas.`;
    },
  },
  token: {
    title:'Token creation simulator',
    fields:[['Whole tokens',125],['Decimals',6]],
    calculate(tokens, decimals) {
      if (decimals > 18n) return 'Isticmaal decimals u dhexeeya 0 iyo 18.';
      return `${tokens * 10n ** decimals} base units. Tani waa tusaale xisaabeed.`;
    },
  },
  amm: {
    title:'Liquidity pool simulator',
    fields:[['Reserve X',1000],['Reserve Y',2000],['Amount in X',100],['Fee (basis points)',30]],
    calculate(x,y,input,bps) {
      if (!x || !y || !input || bps>=10000n) return 'Reserves iyo input ha ka weyn yihiin 0. Fee ha ka yaraato 10,000 bps.';
      const adjusted = input * (10000n-bps);
      const output = y*adjusted/(x*10000n+adjusted);
      return `Waxaad helaysaa ${output} Y. Reserves cusub waa ${x+input} X iyo ${y-output} Y.`;
    },
  },
  health: {
    title:'DeFi health factor',
    fields:[['Collateral value',200],['Debt value',100],['Liquidation threshold (%)',75]],
    calculate(collateral, debt, threshold) {
      if (threshold>100n) return 'Threshold-ku waa boqolkiiba 0 ilaa 100.';
      if (!debt) return 'Debt waa eber. Health factor-kan xad go’an ma laha.';
      const basis = collateral*threshold*100n/debt;
      return `Health factor ${formatUnits(basis,4)}. ${collateral*threshold<debt*100n?'Ka hooseeya 1, liquidation waa suuragal.':'Xadka liquidation-ka kama hooseeyo.'}`;
    },
  },
  oracle: {
    title:'Oracle freshness check',
    fields:[['Waqtiga hadda (seconds)',1200],['Updated at (seconds)',1000],['Max age (seconds)',120]],
    calculate(now, updated, age) {
      return updated>0n && updated<=now && now-updated<=age
        ? 'Timestamp-ku wuxuu ku jiraa waqtiga la aqbalay.' : 'Diid feed-kan. Timestamp-ku waa duugoobay ama khaldan yahay.';
    },
  },
};

function formatUnits(value, decimals) {
  const digits = value.toString().padStart(decimals+1,'0');
  return digits.slice(0,-decimals) + '.' + digits.slice(-decimals);
}

const demos = {
  contract: {
    title:'Smart contract execution model',
    states:[
      ['Owner reset', 'State hore 4 → checks → reset → state cusub 0.'],
      ['Visitor reset', 'State hore 4 → access check → revert → state weli 4.'],
      ['Increment', 'State hore 4 → add 1 → event → state cusub 5.'],
    ],
  },
  transaction: {
    title:'Transaction lifecycle',
    states:[
      ['Wallet signature', 'Waxa la saxiixay chain ID, nonce, target, calldata iyo fee limits.'],
      ['Pending', 'RPC wuxuu soo celiyey hash. Sug receipt.'],
      ['Included', 'Receipt wuxuu sheegayaa success ama revert iyo gasUsed.'],
      ['Finalized', 'Network-ku wuxuu gaadhay finality-ga u gaarka ah.'],
    ],
  },
  wallet: {
    title:'Wallet connection demo',
    states:[
      ['Account access', 'Wallet-ku wuxuu soo bandhigayaa codsi oggolaansho. Isticmaaluhu wuu diidi karaa.'],
      ['Wrong network', 'Chain ID kama mid aha testnets-ka la oggol yahay. Jooji saxiixa.'],
      ['Disconnected', 'Nadiifi account-ka iyo contract-ka ku tiirsan session-ka.'],
    ],
  },
  security: {
    title:'Reentrancy call trace',
    states:[
      ['External call ka hor update', 'Balance 5 → call → callback wuxuu akhriyaa 5 → laba withdrawal ayaa suuragal ah.'],
      ['Update ka hor external call', 'Balance 5 → balance 0 → call → callback wuxuu akhriyaa 0 → withdrawal labaad waa la diiday.'],
    ],
  },
};

export function simulator(kind) {
  const tool = tools[kind];
  if (tool) {
    const form = node('form',undefined,{class:'lab'});
    const output = node('output',undefined,{class:'result','aria-live':'polite'});
    const inputs = tool.fields.map(([label,value]) => {
      const field = node('label',label);
      const input = node('input',undefined,{value,type:'text',inputmode:'numeric',required:'',maxlength:'15',pattern:'[0-9]+'});
      field.append(input); form.append(field);
      return input;
    });
    form.prepend(node('h4',tool.title));
    form.append(node('button','Xisaabi',{type:'submit'}),output);
    form.addEventListener('submit',event => {
      event.preventDefault();
      output.textContent = tool.calculate(...inputs.map(input => BigInt(input.value)));
    });
    return form;
  }
  const demo = demos[kind];
  if (!demo) return null;
  const box = node('div',undefined,{class:'lab'});
  const output = node('p','Dooro xaalad aad rabto inaad tijaabiso.',{'aria-live':'polite'});
  box.append(node('h4',demo.title));
  for (const [label,detail] of demo.states) {
    const button = node('button',label,{type:'button'});
    button.onclick = () => { output.textContent=detail; };
    box.append(button,' ');
  }
  box.append(output,node('small','Tani waa simulation. Ma jirto wallet connection ama network transaction.'));
  return box;
}
