// Category rules (first match wins) plus merchant normalisation.
export const CATEGORIES = {
  Income: '#3fb68b', Groceries: '#7bc96f', Dining: '#f2a65a', Transport: '#5b8def', Shopping: '#c678dd',
  Housing: '#e06c75', Utilities: '#56b6c2', Subscriptions: '#9b8cf0', Health: '#f06fa0', Entertainment: '#e5c07b',
  Travel: '#4fc3f7', Insurance: '#a0a8b8', Education: '#8bd5a8', Cash: '#d19a66', Transfers: '#6b7685',
  'Fees & Interest': '#ff8a65', Other: '#8892a0',
};

const RULES = [
  ['Transfers', /\b(umbuchung|own account|eigenes konto|sparkonto|savings account|internal transfer|zwischen eigenen)\b/i],
  ['Cash', /\b(atm|geldautomat|bargeld|cash withdrawal|auszahlung|abhebung|cash advance)\b/i],
  ['Housing', /\b(miete|rent|mortgage|hypothek|hausverwaltung|landlord|nebenkosten|wohnung)\b/i],
  ['Insurance', /(versicherung|insurance|allianz|\baxa\b|\bhuk\b|generali|krankenkasse|\baok\b|techniker|\bdkv\b|\bergo\b)/i],
  ['Utilities', /\b(strom|energie|stadtwerke|electric|wasser|water|internet|telekom|vodafone|o2|telefonica|mobilfunk|comcast|verizon|at&t|rundfunk|gez|beitragsservice|e\.on|vattenfall|gas bill)\b/i],
  ['Subscriptions', /(netflix|spotify|disney|youtube|prime video|hbo|icloud|google one|google storage|dropbox|adobe|microsoft|openai|chatgpt|patreon|audible|apple\.com\/bill|subscription|\babo\b|github|notion|dazn|paramount|deezer|anthropic|1password)/i],
  ['Groceries', /(rewe|edeka|aldi|lidl|kaufland|penny|netto|\bspar\b|migros|\bcoop\b|tesco|sainsbury|carrefour|whole foods|trader joe|walmart|supermarkt|grocery|billa|hofer|albert heijn|denn's|marktkauf|asda|morrisons|kroger|safeway|costco)/i],
  ['Dining', /(restaurant|cafe|café|starbucks|mcdonald|burger|pizza|kebab|\bbar\b|lieferando|uber ?eats|doordash|deliveroo|wolt|subway|b[aä]ckerei|bakery|coffee|sushi|bistro|imbiss|\bpub\b|grill|foodora|just ?eat|chipotle|kfc|domino)/i],
  ['Transport', /(\buber\b|\bbolt\b|lyft|taxi|deutsche bahn|\bdb\b|bahn|\bsbb\b|bvg|mvv|hvv|\bshell\b|aral|\bbp\b|esso|tankstelle|fuel|petrol|parking|parken|flixbus|train|metro|transit|tfl|ticket|sixt|europcar|car2go|share now|\blime\b)/i],
  ['Health', /(apotheke|pharmacy|\barzt\b|doctor|dentist|zahnarzt|clinic|klinik|hospital|fitness|\bgym\b|mcfit|urban sports|\bdm\b|rossmann|\bcvs\b|walgreens|optiker|physio)/i],
  ['Entertainment', /(cinema|kino|steam|playstation|xbox|nintendo|ticketmaster|concert|theater|theatre|museum|eventim|twitch)/i],
  ['Travel', /(hotel|airbnb|booking\.com|ryanair|lufthansa|easyjet|airline|flight|expedia|hostel|airways|trivago|eurowings|swiss air|\bklm\b)/i],
  ['Education', /(universit|tuition|udemy|coursera|school|schule|\bkurs\b|studien|semester|college)/i],
  ['Shopping', /(amazon|zalando|ikea|ebay|h&m|zara|apple store|mediamarkt|saturn|decathlon|aliexpress|temu|shein|\botto\b|primark|paypal|etsy|best buy|target|uniqlo|douglas)/i],
  ['Fees & Interest', /(geb[uü]hr|\bfee\b|fees|zinsen|interest|entgelt|kontof[uü]hrung|overdraft|charge|dispo|provision)/i],
];

const STRIP = /\b(kartenzahlung|lastschrift|girocard|debit ?card|card payment|sepa|basislastschrift|dauerauftrag|standing order|direct debit|purchase|pos|visa|mastercard|maestro|ec|online|payment|zahlung|überweisung|ueberweisung|gutschrift|eref|mref|cred|iban|bic|ref|mandat|mandate|vorgang|buchung|transaction|apple pay|google pay)\b[:.]?/gi;

export function merchantOf(raw) {
  const s = raw.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, ' ') // IBAN
    .replace(STRIP, ' ')
    .replace(/\d{1,2}[./]\d{1,2}[./]?\d{0,4}/g, ' ')
    .replace(/[\d*#/\\_:;,|]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const words = s.split(' ').filter(w => w.length > 1).slice(0, 3);
  return (words.join(' ') || raw.slice(0, 24)).toUpperCase();
}

export function categorize(raw, amount, merchant, overrides) {
  if (overrides[merchant]) return overrides[merchant];
  for (const [cat, re] of RULES) {
    if (!re.test(raw)) continue;
    // positive amounts are refunds/income unless clearly an internal transfer or fee reversal
    if (amount > 0 && cat !== 'Transfers' && cat !== 'Fees & Interest') continue;
    return cat;
  }
  if (amount > 0) return /\b(transfer|überweisung)\b/i.test(raw) ? 'Transfers' : 'Income';
  return 'Other';
}
