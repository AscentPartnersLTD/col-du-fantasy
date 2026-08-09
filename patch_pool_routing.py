#!/usr/bin/env python3
"""Col du Fantasy - pool switch routing fix.

Before: every pool switch went to /board.html?pool=<id>, so choosing the Vuelta
loaded Vuelta data inside the Tour's gold shell, and choosing the pool you were
already "on" did nothing at all. After: a pool that has its own skinned board
file opens that file, and a pool whose page differs from the current page still
navigates even when it is the checked entry.

Patches board.src.html and vuelta.src.html in place. Idempotent.
"""
import sys

ANCHOR = "const DEFAULT_POOL='{{DEFAULT_POOL}}';"

INSERT = """const DEFAULT_POOL='{{DEFAULT_POOL}}';
// Pool routing. A pool with its own skinned board file must open THAT file: the
// switcher used to send every pool to the generic /board.html, so the Vuelta
// loaded its data inside the Tour's gold shell. boardPath on the pool doc wins
// when set; POOL_PAGE is the fallback so routing is correct with no data edit.
const POOL_PAGE={'col-du-fantasy':'/tour.html','vuelta-2026':'/vuelta.html'};
function poolHref(pid,path){ var p=path||POOL_PAGE[pid]||'/board.html'; return location.origin+p+'?pool='+encodeURIComponent(pid); }
// True when this page is already the right board file for that pool. Lets the
// checked entry still navigate when the pool is right but the shell is wrong.
function onPoolPage(pid){ var w=POOL_PAGE[pid]; if(!w) return true; var h=location.pathname.toLowerCase(); if(h===w) return true; if(w==='/tour.html'&&(h==='/'||h==='/index.html')) return true; return false; }"""

REROUTE_OLD = ("location.replace(location.origin+'/board.html?pool='"
               "+encodeURIComponent(_mine[0])+'&rr=1');")
REROUTE_NEW = "location.replace(poolHref(_mine[0],null)+'&rr=1');"

OWNER_OLD = ("if(isOwner){ var all=await db.collection('pools').get(); "
             "all.forEach(function(d){ pools.push({id:d.id,name:(d.data().name||d.id)}); }); }")
OWNER_NEW = ("if(isOwner){ var all=await db.collection('pools').get(); "
             "all.forEach(function(d){ pools.push({id:d.id,name:(d.data().name||d.id),"
             "path:(d.data().boardPath||'')}); }); }")

MEMBER_OLD = ("if(s.exists) pools.push({id:list[i],name:(s.data().name||list[i])}); ")
MEMBER_NEW = ("if(s.exists) pools.push({id:list[i],name:(s.data().name||list[i]),"
              "path:(s.data().boardPath||'')}); ")

CUR_OLD = ("if(!pools.some(function(p){return p.id===poolId;})) "
           "pools.unshift({id:poolId,name:(pool&&pool.name)||poolId});")
CUR_NEW = ("if(!pools.some(function(p){return p.id===poolId;})) "
           "pools.unshift({id:poolId,name:(pool&&pool.name)||poolId,"
           "path:(pool&&pool.boardPath)||''});")

RENDER_OLD = ("return '<button class=\"acct-pool'+(p.id===poolId?' cur':'')+'\" type=\"button\" "
              "data-pool=\"'+esc(p.id)+'\">'+esc(p.name)+'</button>';")
RENDER_NEW = ("return '<button class=\"acct-pool'+(p.id===poolId?' cur':'')+'\" type=\"button\" "
              "data-pool=\"'+esc(p.id)+'\" data-href=\"'+esc(poolHref(p.id,p.path))+'\">'"
              "+esc(p.name)+'</button>';")

CLICK_OLD = ("if(pb){ var pid=pb.getAttribute('data-pool'); if(pid && pid!==poolId){ "
             "location.href=location.origin+'/board.html?pool='+encodeURIComponent(pid); } "
             "else { var pn=$('acctPanel'); if(pn) pn.classList.remove('show'); } return; }")
CLICK_NEW = ("if(pb){ var pid=pb.getAttribute('data-pool'); "
             "var href=pb.getAttribute('data-href')||poolHref(pid,null); "
             "if(pid && (pid!==poolId || !onPoolPage(pid))){ location.href=href; } "
             "else { var pn=$('acctPanel'); if(pn) pn.classList.remove('show'); } return; }")

EDITS = [
    ("route map", ANCHOR, INSERT),
    ("roster reroute", REROUTE_OLD, REROUTE_NEW),
    ("owner pool list", OWNER_OLD, OWNER_NEW),
    ("member pool list", MEMBER_OLD, MEMBER_NEW),
    ("current pool entry", CUR_OLD, CUR_NEW),
    ("menu render", RENDER_OLD, RENDER_NEW),
    ("switch click", CLICK_OLD, CLICK_NEW),
]


def patch(path):
    s = open(path, encoding='utf-8').read()
    if 'POOL_PAGE' in s:
        print(f"  {path}: already patched, skipping")
        return
    for label, old, new in EDITS:
        n = s.count(old)
        if n != 1:
            sys.exit(f"ABORT {path}: '{label}' matched {n} times, expected 1")
        s = s.replace(old, new)
        print(f"  {path}: {label} ok")
    open(path, 'w', encoding='utf-8').write(s)
    print(f"  {path}: written ({len(s)} bytes)")


if __name__ == '__main__':
    for p in ('board.src.html', 'vuelta.src.html'):
        patch(p)
