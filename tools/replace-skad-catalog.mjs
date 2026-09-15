import fs from 'node:fs';

const source = process.argv[2];
const catalogPath = process.argv[3] || 'data/oblivion-v16-catalog.json';
if (!source) throw new Error('Usage: node tools/replace-skad-catalog.mjs <message.txt> [catalog.json]');

const headings = new Set();
const items = [];
let category = null;
for (const raw of fs.readFileSync(source, 'utf8').split(/\r?\n/)) {
  const heading = raw.match(/^\*\*(.+?)\*\*\s*$/);
  if (heading) { category = heading[1].trim(); headings.add(category); continue; }
  const classname = raw.trim();
  if (classname && category) items.push({ classname, category });
}
if (items.length !== 345 || new Set(items.map((item) => item.classname)).size !== items.length) throw new Error(`Expected 345 unique classnames, got ${items.length}`);

const document = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const replacement = items.map(({ classname, category: itemCategory }) => ({
  traderId: 'skad', itemName: classname, classname, category: itemCategory,
  enabled: false, buyEnabled: false, sellEnabled: false,
  buyPrice: 0, sellPrice: 0, stockMode: 'infinite', stock: -1,
  reputationRequired: 0, maxQuantity: 1, sourceOfTruth: 'OWNER_CATALOG_IMPORT',
  notes: 'Catálogo Skad importado pelo owner; preços e direções permanecem desativados até configuração no painel.'
}));
const otherOffers = document.offers.filter((offer) => offer.traderId !== 'skad');
document.offers = [...replacement, ...otherOffers];
document.offerCount = document.offers.length;
fs.writeFileSync(catalogPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ traderId: 'skad', replaced: true, count: replacement.length, categories: [...headings], pricesConfigured: false }, null, 2));
