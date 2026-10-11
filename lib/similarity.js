// Task signatures: a handful of keywords from the prompt plus the set of tools used.
const STOP = new Set(`
a al algo alguna alguno ante antes aqui asi aunque bien cada como con contra cual cuando de del desde donde dos el ella ellas ellos en entre era eres es esa ese eso esta estas este esto estos fue ha hace hacer hacerlo hay haz la las le les lo los mas me mejor mi mis mucho muy nada ni no nos o otra otro para pero poco por porque pues que quiero quien se ser si sin sobre solo son su sus tambien te tengo ti todo todos tu tus un una unas uno unos usa usar va vamos ver y ya yo puedes puede dame pon algo esto favor ahora cosa cosas quiero necesito gracias vale luego literalmente haciendo hecho haga hagas cree crees sigue dale venga mira oye bueno igual tipo rollo
about after again all also and any are because been before but can could did does doing done each for from get got had has have here how into its just let like make more most need not now off once only other our out over please same should some such than that the their them then there these they this those through too under until use very want was way were what when where which while who why will with would you your
`.split(/\s+/).filter(Boolean));

function normalize(text) {
  return String(text || '')
    .slice(0, 2000)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[A-Za-z]:\\\S+|\/\S+\/\S+/g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function keywords(text, max = 8) {
  const freq = new Map();
  for (const w of normalize(text).split(/[^a-z0-9]+/)) {
    if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w)
    .sort();
}

function jaccard(a, b) {
  const A = new Set(a || []), B = new Set(b || []);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Keywords carry the meaning; tools only nudge (Read/Edit/Bash show up everywhere).
const similarity = (a, b) => 0.75 * jaccard(a.kw, b.kw) + 0.25 * jaccard(a.tools, b.tools);

module.exports = { keywords, jaccard, similarity, normalize };
