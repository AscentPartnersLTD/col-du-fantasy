/* Persona engine simulation. Run from the repo root: node tools-persona-sim.js
   It extracts the REAL PERSONA_BANK out of the built vuelta.html, then runs the
   shipped draw rules over it, so the bank cannot drift away from what is verified.
   The draw rules below are transcribed from vuelta.src.html; if that block changes,
   change this one in the same commit or the verification is measuring nothing. */
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/vuelta.html', 'utf8');
const BANK = (function(){
  const i = SRC.indexOf('const PERSONA_BANK = [');
  const j = SRC.indexOf('\nconst PERSONA_BY', i);
  if (i < 0 || j < 0) throw new Error('PERSONA_BANK not found in vuelta.html');
  return new Function(SRC.slice(i, j) + '; return PERSONA_BANK;')();
})();
/* The bank GROWS, so a hardcoded size is a test that breaks every time the thing it
   guards improves. This asserted 56 and had been throwing since the bank was filled to
   92, which means it verified nothing across that whole window. Assert the SHAPE. */
if (BANK.length < 56) throw new Error('persona bank looks truncated: ' + BANK.length);
const noSex = BANK.filter(c => c.sex !== 'm' && c.sex !== 'f').map(c => c.id);
if (noSex.length) throw new Error('rows with no sex field: ' + noSex.join(', '));
/* The race the bank is being drawn for. A persona whose sex does not match is
   unavailable, exactly like a worn one. Lifted from the built board, never retyped. */
const RACE_SEX = (function(){
  const m = SRC.match(/^\s*sex:'([mf])',\s*$/m);
  if (!m) throw new Error('RACE_PROFILE.sex not found in vuelta.html');
  return m[1];
})();
const sexOk = c => !RACE_SEX || !c || !c.sex || c.sex === RACE_SEX;
console.log('bank ' + BANK.length + ' rows, race sex ' + RACE_SEX +
  ', drawable ' + BANK.filter(sexOk).length +
  ' (winner ' + BANK.filter(c=>sexOk(c)&&c.tier==='winner').length +
  ', style ' + BANK.filter(c=>sexOk(c)&&c.tier==='style').length + ')');
const PL4 = ['AA','JP','JJ','JB'];
const byId = id => BANK.find(x => x.id === id) || null;

// Synthetic PSTATS. Only the fit ORDER matters for the no-repeat invariant, so each
// seat is given a different shape to exercise different fit rankings.
function stats(seed){
  const r = n => (((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1;
  return { fp:r(1)*200, rank:r(2)*36, place:r(3)*300, wins:Math.floor(r(4)*3),
           zeroDays:Math.floor(r(5)*4), best:r(6)*30, worst:r(7)*180, spread:r(8)*80,
           kassei:Math.floor(r(9)*4),
           typeMean:{flat:r(10)*90,hilly:r(11)*90,mountain:r(12)*90,tt:r(13)*90},
           teams:Math.floor(r(14)*10), days:7, missed:Math.floor(r(15)*2) };
}
const PSTATS = {}; PL4.forEach((p,i)=>PSTATS[p]=stats(i+1));

// ---- the shipped rules, transcribed line for line from vuelta.src.html ----
function computeBoard(L, fanOrder){
  const curPos={}; fanOrder.forEach((p,i)=>curPos[p]=i);
  const leader=fanOrder[0];
  const assigned={}, used={};
  const prevOrder=(L.order||[]).slice();
  const orderChanged = prevOrder.length!==fanOrder.length || fanOrder.some((p,i)=>prevOrder[i]!==p);
  const prevBoard=new Set(Object.values(L.by||{}));
  const everWorn=new Set(prevBoard);
  Object.keys(L.seen||{}).forEach(q=>((L.seen[q])||[]).forEach(id=>everWorn.add(id)));
  const byVals=Object.values(L.by||{});
  const heldTwice=id=>!!id && byVals.filter(x=>x===id).length>1;
  const wornElsewhere=(seat,id)=>!!id && Object.keys(L.seen||{}).some(q=>q!==seat && ((L.seen[q])||[]).indexOf(id)>=0);
  const usedByAnother=(seat,id)=>wornElsewhere(seat,id)||heldTwice(id);
  const retiring = !Object.keys(L.by||{}).length && Object.keys(L.seen||{}).length>0;
  const frozen={}, dupes=[], wrongSexed=[], movers=[];
  PL4.forEach(p=>{
    if(assigned[p]) return;
    const prevId=(L.by||{})[p]; const prev=prevId?byId(prevId):null;
    const wantTier=(p===leader)?'winner':'style';
    const dupe=usedByAnother(p,prevId); if(dupe) dupes.push(p);
    const wrongSex=!!prev && !sexOk(prev); if(wrongSex) wrongSexed.push(p);
    const mustMove = retiring || orderChanged || dupe || wrongSex || !prev || prev.tier!==wantTier;
    if(!mustMove){ assigned[p]=prev; used[prevId]=1; } else movers.push(p);
  });
  movers.sort((a,b)=>curPos[a]-curPos[b]);
  movers.forEach(p=>{
    const tier=(p===leader)?'winner':'style';
    const pool=BANK.filter(c=>c.tier===tier && sexOk(c) && !used[c.id] && !everWorn.has(c.id))
      .sort((a,b)=>b.fit(PSTATS[p])-a.fit(PSTATS[p]));
    const pick=pool[0];
    if(pick){ assigned[p]=pick; used[pick.id]=1; return; }
    const keepId=(L.by||{})[p], keep=keepId?byId(keepId):null;
    if(keep && sexOk(keep) && !used[keepId]){ assigned[p]=keep; used[keepId]=1; frozen[p]='exhausted'; }
    else { frozen[p]='none'; }
  });
  PL4.forEach(p=>{ if(assigned[p]) return; const tier=(p===leader)?'winner':'style';
    const pool=BANK.filter(c=>c.tier===tier && sexOk(c) && !used[c.id] && !everWorn.has(c.id))
      .sort((a,b)=>b.fit(PSTATS[p])-a.fit(PSTATS[p]));
    const pick=pool[0];
    if(pick){ assigned[p]=pick; used[pick.id]=1; } else { frozen[p]=frozen[p]||'none'; } });
  return {assigned, frozen, dupes, wrongSexed, movers, everWorn, retiring, orderChanged};
}

// the shipped persistence: order, by and seen advance together
function persist(L, board, fanOrder){
  const by={}; PL4.forEach(p=>{ if(board.assigned[p]) by[p]=board.assigned[p].id; });
  const seen=Object.assign({}, L.seen||{});
  PL4.forEach(p=>{ const id=by[p]; if(!id) return; const a=(seen[p]||[]).slice();
    if(a.indexOf(id)<0) a.push(id); seen[p]=a; });
  return {order:fanOrder.slice(), by, seen};
}

function idsOf(b){ const o={}; PL4.forEach(p=>o[p]=b.assigned[p]?b.assigned[p].id:null); return o; }
let fail=0;
function check(cond,msg){ if(!cond){ console.log('  FAIL: '+msg); fail=1; } }

// The live board as of 2026-08-28, reconstructed from CLAUDE.md boards 1 to 4 plus the
// roglic repair Allen reported. REPLACE with the real ledger when it is pasted.
let L = { order:['AA','JP','JJ','JB'],
  by:{AA:'badger', JP:'professor', JJ:'roglic', JB:'eternalsecond'},
  seen:{ AA:['contador','cannibal','lemond','badger'],
         JP:['pirate','tonymartin','purito','professor'],
         JJ:['cancellara','vanimpe','gilbert','tonymartin','roglic'],
         JB:['valverde','greipel','renshaw','eternalsecond'] } };

console.log('=== TEST 1: twelve rotations, no name ever repeats ===');
const everSeen=new Set(); Object.keys(L.seen).forEach(p=>L.seen[p].forEach(id=>everSeen.add(id)));
console.log('  starting used list: '+everSeen.size);
const orders=[['AA','JP','JJ','JB'],['AA','JJ','JP','JB'],['JP','AA','JJ','JB'],['JP','JJ','AA','JB'],
              ['JJ','JP','AA','JB'],['JJ','AA','JB','JP'],['JB','JJ','AA','JP'],['AA','JB','JJ','JP'],
              ['JP','JB','AA','JJ'],['JJ','AA','JP','JB'],['AA','JP','JB','JJ'],['JB','AA','JP','JJ']];
let rot=0;
for(const o of orders){
  const b=computeBoard(L,o); const ids=idsOf(b);
  const drawn=b.movers.filter(p=>ids[p] && b.frozen[p]!=='exhausted').map(p=>ids[p]);
  check(drawn.every(id=>!everSeen.has(id)),
        'rotation '+(rot+1)+' drew an already-worn name: '+JSON.stringify(drawn.filter(id=>everSeen.has(id))));
  const live=PL4.map(p=>ids[p]).filter(Boolean);
  check(new Set(live).size===live.length, 'rotation '+(rot+1)+' put one name on two seats');
  live.forEach(id=>everSeen.add(id));
  const frz=Object.keys(b.frozen).length;
  console.log('  rot '+String(++rot).padStart(2)+'  leader '+o[0]+'  movers '+b.movers.length+
    '  drew '+drawn.length+'  usedList '+String(everSeen.size).padStart(2)+
    (frz?('  FROZEN '+JSON.stringify(b.frozen)):''));
  L=persist(L,b,o);
}
const wSpent=Array.from(everSeen).filter(id=>byId(id)&&byId(id).tier==='winner').length;
const sSpent=Array.from(everSeen).filter(id=>byId(id)&&byId(id).tier==='style').length;
/* Capacities are COUNTED from the drawable bank, not typed. The old line said "of 12"
   and "of 44", the pre-fill sizes, so after the bank grew it reported spending more
   than existed. A hardcoded denominator is the same defect as the hardcoded row count
   above: it goes wrong exactly when the thing it describes improves. */
const wCap=BANK.filter(c=>sexOk(c)&&c.tier==='winner').length;
const sCap=BANK.filter(c=>sexOk(c)&&c.tier==='style').length;
console.log('  winners spent '+wSpent+' of '+wCap+', styles spent '+sSpent+' of '+sCap);
check(wSpent<=wCap, 'winner tier overspent: '+wSpent+' of '+wCap);
check(sSpent<=sCap, 'style tier overspent: '+sSpent+' of '+sCap);

console.log('');
console.log('=== TEST 2: winner tier exhausted, engine must KEEP not repeat ===');
const allW=BANK.filter(c=>c.tier==='winner').map(c=>c.id);
const L2={ order:['AA','JP','JJ','JB'],
  by:{AA:'badger', JP:'professor', JJ:'roglic', JB:'eternalsecond'},
  seen:{ AA:allW.slice(), JP:['professor'], JJ:['roglic'], JB:['eternalsecond'] } };
const b2=computeBoard(L2,['AA','JJ','JP','JB']);
const i2=idsOf(b2);
console.log('  assigned '+JSON.stringify(i2));
console.log('  frozen   '+JSON.stringify(b2.frozen));
check(i2.AA==='badger', 'leader must hold badger rather than repeat a worn champion');
check(b2.frozen.AA==='exhausted', 'the hold must be flagged so the card can say so');
const live2=Object.values(i2).filter(Boolean);
check(new Set(live2).size===live2.length, 'no duplicate on the board');

console.log('');
console.log('=== TEST 3: a stored hand-me-down is repaired with the order steady ===');
const L3={ order:['AA','JP','JJ','JB'],
  by:{AA:'badger', JP:'professor', JJ:'tonymartin', JB:'eternalsecond'},
  seen:{ AA:['badger'], JP:['tonymartin','professor'], JJ:['tonymartin'], JB:['eternalsecond'] } };
const b3=computeBoard(L3,['AA','JP','JJ','JB']);
const i3=idsOf(b3);
console.log('  orderChanged '+b3.orderChanged+'  dupes '+JSON.stringify(b3.dupes));
console.log('  assigned     '+JSON.stringify(i3));
check(b3.orderChanged===false, 'the order is deliberately steady in this test');
check(b3.dupes.indexOf('JJ')>=0, 'JJ holding a name JP wore must be detected with the order steady');
check(i3.JJ!=='tonymartin', 'JJ must be moved off the hand-me-down');
check(i3.AA==='badger' && i3.JP==='professor' && i3.JB==='eternalsecond', 'clean seats must hold');

console.log('');
console.log('=== TEST 4: retirement by clearing `by` moves all four, exactly once ===');
const L4={ order:['AA','JP','JJ','JB'], by:{},
  seen:{ AA:['contador','cannibal','lemond','badger'], JP:['pirate','tonymartin','purito','professor'],
         JJ:['cancellara','vanimpe','gilbert','tonymartin','roglic'], JB:['valverde','greipel','renshaw','eternalsecond'] } };
const b4=computeBoard(L4,['AA','JP','JJ','JB']);
const i4=idsOf(b4);
const worn4=new Set(); Object.keys(L4.seen).forEach(p=>L4.seen[p].forEach(id=>worn4.add(id)));
console.log('  retiring '+b4.retiring+'  movers '+b4.movers.length);
console.log('  assigned '+JSON.stringify(i4));
check(b4.retiring===true, 'a cleared `by` must trigger a retirement');
check(b4.movers.length===4, 'all four seats must move');
check(Object.values(i4).every(id=>id && !worn4.has(id)), 'every replacement must be a name nobody has worn');
check(byId(i4.AA).tier==='winner', 'the leader must draw from the champion tier');
check(['JP','JJ','JB'].every(p=>byId(i4[p]).tier==='style'), 'the other three must draw from the style tier');
const L4b=persist(L4,b4,['AA','JP','JJ','JB']);
const b4b=computeBoard(L4b,['AA','JP','JJ','JB']);
console.log('  second load: retiring '+b4b.retiring+'  movers '+b4b.movers.length+'  (must be false and 0)');
check(b4b.retiring===false, 'retirement must not fire twice once `by` is repopulated');
check(b4b.movers.length===0, 'the load after a retirement must be stable, or it writes forever');

console.log('');
console.log(fail ? '*** SOME CHECKS FAILED ***' : 'ALL CHECKS PASSED');
process.exit(fail);
