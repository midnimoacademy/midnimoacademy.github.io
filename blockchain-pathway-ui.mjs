export const $ = id => document.getElementById(id);

export function node(tag, value, attrs = {}) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  for (const [key, val] of Object.entries(attrs)) element.setAttribute(key, val);
  return element;
}

export function list(items, tag = 'ul') {
  const element = node(tag);
  element.append(...items.map(item => node('li', item)));
  return element;
}

export function client() {
  return window.supabase.createClient('https://uecogftwdvpfhxkdgjel.supabase.co',
    'sb_publishable_zFAX-W1T8Hj5HMKwkA5Tcw_yaIjr-Ff');
}

export async function rpc(db, method, args) {
  const { data, error } = await db.rpc('blockchain_pathway_' + method, args);
  if (error) throw error;
  return data;
}

export const formatDate = time => new Intl.DateTimeFormat('en-GB', {dateStyle: 'medium', timeZone: 'Europe/London'}).format(new Date(time));

export const rubric = id => id === 10 ? [
  'Contract functionality iyo access control', 'Tests iyo dib-u-soo-saarid',
  'dApp interface iyo xaaladaha transaction-ka', 'README, amni iyo caddayn',
] : [
  'Architecture iyo threat model', 'Contract tests, fuzz iyo invariants',
  'dApp iyo deployment-ka testnet', 'Verification, monitoring iyo runbook',
];

export const labels = {pending:'Sugaya dib-u-eegis', passed:'La ansixiyey', needs_revision:'Dib u sax'};
