const fs = require('fs');
const dir = __dirname;

const runs = [1,2,3].map(i => JSON.parse(fs.readFileSync(dir + '/pr51-v3-run' + i + '.json')));

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

console.log('\n======= PER-RUN SUMMARY =======');
results.forEach(s => {
  console.log('\n' + s.label + ':');
  console.log('  count=' + s.count + '  prScore=' + s.prScore + '  avgConf=' + s.avgConf + '  verdict=' + s.verdict);
  console.log('  severity:', JSON.stringify(s.sev));
  console.log('  agents:  ', JSON.stringify(s.agents));
  console.log('  files:   ', s.files);
});

const counts  = results.map(r => r.count);
const scores  = results.map(r => r.prScore ?? 0);
const confs   = results.map(r => r.avgConf);
console.log('\n======= STABILITY METRICS =======');
console.log('comment counts:  ', counts, '  range:', Math.max(...counts) - Math.min(...counts));
console.log('prScore:         ', scores,  '  range:', Math.max(...scores)  - Math.min(...scores));
console.log('avgConfidence:   ', confs,   '  range:', +(Math.max(...confs)  - Math.min(...confs)).toFixed(3));

// File overlap
const fileSets = runs.map(r => new Set((r.comments||[]).map(c => c.path)));
const allFiles = [...new Set([...fileSets[0], ...fileSets[1], ...fileSets[2]])];
console.log('\n======= FILE OVERLAP =======');
console.log('In all 3:', allFiles.filter(f => fileSets.every(s => s.has(f))));
console.log('In 2/3:  ', allFiles.filter(f => fileSets.filter(s => s.has(f)).length === 2));
console.log('In 1/3:  ', allFiles.filter(f => fileSets.filter(s => s.has(f)).length === 1));

// Comments per run
runs.forEach((r,i) => {
  console.log('\n--- Run ' + (i+1) + ' comments ---');
  (r.comments||[]).forEach(c => {
    console.log('  [' + c.sourceAgent + '] ' + c.path + ':' + c.line + ' [' + c.severity + '] conf=' + c.confidence);
    console.log('    ' + c.body.split('\n')[0].slice(0, 100));
  });
});
