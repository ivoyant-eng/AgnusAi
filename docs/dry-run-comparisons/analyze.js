const fs = require('fs');
const runs = [1,2,3].map(i => JSON.parse(fs.readFileSync(__dirname + '/pr51-run' + i + '.json')));

const stats = (r, label) => {
  const cs = r.comments || [];
  const sev = { error:0, warning:0, info:0 };
  const agents = {};
  const files = new Set();
  let confSum = 0;
  for (const c of cs) {
    sev[c.severity] = (sev[c.severity]||0)+1;
    agents[c.sourceAgent] = (agents[c.sourceAgent]||0)+1;
    files.add(c.path);
    confSum += c.confidence ?? 0;
  }
  return { label, count: cs.length, verdict: r.verdict, prScore: r.prScore, avgConf: cs.length ? +(confSum/cs.length).toFixed(3) : 0, sev, agents, files: files.size };
};

const results = runs.map((r,i) => stats(r, 'Run ' + (i+1)));
results.forEach(s => console.log(JSON.stringify(s, null, 2)));

// File overlap
const fileSets = runs.map(r => new Set((r.comments||[]).map(c => c.path)));
const allFiles = [...new Set([...fileSets[0], ...fileSets[1], ...fileSets[2]])];
const inAll3  = allFiles.filter(f => fileSets.every(s => s.has(f)));
const in2of3  = allFiles.filter(f => fileSets.filter(s => s.has(f)).length === 2);
const in1of3  = allFiles.filter(f => fileSets.filter(s => s.has(f)).length === 1);
console.log('\n=== FILE OVERLAP ===');
console.log('In all 3 runs:', inAll3);
console.log('In 2/3 runs:  ', in2of3);
console.log('In 1/3 runs:  ', in1of3);

// Comment topics
const topics = runs.map(r => (r.comments||[]).map(c => c.path + ':' + c.line + ' ' + c.body.split('\n')[0].slice(0,80)));
const exactAll = topics[0].filter(t => topics[1].some(u => u===t) && topics[2].some(u => u===t));
console.log('\n=== FINDING CONSISTENCY ===');
console.log('Exact match in all 3:', exactAll.length);
console.log('Run1 unique:', topics[0].filter(t => !topics[1].some(u=>u===t) && !topics[2].some(u=>u===t)).length);
console.log('Run2 unique:', topics[1].filter(t => !topics[0].some(u=>u===t) && !topics[2].some(u=>u===t)).length);
console.log('Run3 unique:', topics[2].filter(t => !topics[0].some(u=>u===t) && !topics[1].some(u=>u===t)).length);

// Print all comments per run
runs.forEach((r, i) => {
  console.log('\n--- Run ' + (i+1) + ' comments ---');
  (r.comments||[]).forEach(c => {
    console.log('[' + c.sourceAgent + '] ' + c.path + ':' + c.line + ' [' + c.severity + '] conf=' + c.confidence);
    console.log('  ' + c.body.split('\n')[0].slice(0,100));
  });
});
