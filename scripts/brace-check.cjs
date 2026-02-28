const fs = require('fs');
const content = fs.readFileSync('scripts/ingest.ts', 'utf8');
const lines = content.split('\n');
console.log('Total lines:', lines.length);

let opens = 0, closes = 0;
for (let i = 496; i < 1230; i++) {
  const line = lines[i] || '';
  opens += (line.match(/\{/g) || []).length;
  closes += (line.match(/\}/g) || []).length;
}
console.log('Try block brace balance (497-1230): +' + opens + ' -' + closes + ' = ' + (opens - closes));

const stages = [
  [497, 617, 'Stage1-extraction'],
  [617, 680, 'Stage2-relations'],
  [680, 727, 'Stage3-grouping'],
  [727, 806, 'Stage4-embedding'],
  [806, 917, 'Stage5-validation'],
  [917, 1230, 'Stage6-storage']
];

stages.forEach(function(s) {
  let o = 0, c = 0;
  for (let i = s[0]-1; i < s[1]; i++) {
    const l = lines[i] || '';
    o += (l.match(/\{/g) || []).length;
    c += (l.match(/\}/g) || []).length;
  }
  console.log(s[2] + ' (' + s[0] + '-' + s[1] + '): +' + o + ' -' + c + ' = ' + (o - c));
});

// Find where cumulative balance goes wrong
console.log('\nCumulative brace tracking (inside try block, starting line 498):');
let balance = 0;
for (let i = 497; i < 1230; i++) {
  const line = lines[i] || '';
  const o = (line.match(/\{/g) || []).length;
  const c = (line.match(/\}/g) || []).length;
  balance += o - c;
  if (balance < 0) {
    console.log('  NEGATIVE at line ' + (i+1) + ': balance=' + balance + ' | ' + line.trim().substring(0, 80));
  }
}
console.log('Final balance at line 1230: ' + balance + ' (should be 0)');
