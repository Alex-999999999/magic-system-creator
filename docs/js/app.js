(()=>{
const $=id=>document.getElementById(id),E=window.MagicEditors;
let nodes=[],edges=[],selected=null,activeSpellClass='All',activeSystemTab='rules',editingId=null,editingType=null,creatingHub=false,pendingConnectionPlan=null;
let physicsSettings={pullStrength:1,largeGraphScale:1,collisionStrength:1,globalRulePull:.375};
let autoConnections={enabled:true,restoreMode:'all'};
let technologySettings={enabled:false};
const graph=new window.MagicGraph($('graph'));

const HISTORY_LIMIT=100;
let undoStack=[],redoStack=[],historyRestoring=false,dragHistoryArmed=false;

function historyState(){
  return {
    nodes:JSON.parse(JSON.stringify(nodes)),
    edges:JSON.parse(JSON.stringify(edges)),
    physicsSettings:JSON.parse(JSON.stringify(physicsSettings)),
    autoConnections:JSON.parse(JSON.stringify(autoConnections)),
    selectedId:selected?.id||null
  };
}
function historySignature(state){
  // Ignore transient velocities; they should not make two otherwise-identical
  // editor states appear different.
  const copy=JSON.parse(JSON.stringify(state));
  for(const n of copy.nodes||[]){n.vx=0;n.vy=0}
  return JSON.stringify(copy);
}
function updateHistoryButtons(){
  const u=$('undoBtn'),r=$('redoBtn');
  if(u)u.disabled=!undoStack.length;
  if(r)r.disabled=!redoStack.length;
}
function checkpointHistory(){
  if(historyRestoring)return;
  const state=historyState();
  const sig=historySignature(state);
  const last=undoStack[undoStack.length-1];
  if(!last||historySignature(last)!==sig){
    undoStack.push(state);
    if(undoStack.length>HISTORY_LIMIT)undoStack.shift();
  }
  redoStack=[];
  updateHistoryButtons();
}
function restoreHistoryState(state){
  if(!state)return;
  historyRestoring=true;
  nodes=JSON.parse(JSON.stringify(state.nodes||[]));
  edges=JSON.parse(JSON.stringify(state.edges||[]));
  physicsSettings={...physicsSettings,...(state.physicsSettings||{})};
  autoConnections={...autoConnections,...(state.autoConnections||{})};
  selected=state.selectedId?nodes.find(n=>n.id===state.selectedId)||null:null;
  graph.selected=selected;
  graph.setPhysicsSettings(physicsSettings);
  graph.setData(nodes,edges.filter(e=>!e.blocked));
  renderLibraries();
  showSelection();
  updateStats();
  save();
  historyRestoring=false;
  updateHistoryButtons();
}
function undoHistory(){
  if(!undoStack.length)return;
  redoStack.push(historyState());
  restoreHistoryState(undoStack.pop());
}
function redoHistory(){
  if(!redoStack.length)return;
  undoStack.push(historyState());
  if(undoStack.length>HISTORY_LIMIT)undoStack.shift();
  restoreHistoryState(redoStack.pop());
}

const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const byId=id=>nodes.find(n=>n.id===id),ofType=t=>nodes.filter(n=>n.type===t),spells=()=>ofType('spell'),rules=()=>ofType('rule');
const tokenize=v=>String(v||'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
let worldStateCache={maps:{},planets:{}};
function save(){
  const safeScaleNav=typeof scaleNav==='undefined'?null:{
    level:scaleNav.level,
    path:scaleNav.path,
    camera:scaleNav.camera,
    selected:scaleNav.selected,
    lastTransitionAt:scaleNav.lastTransitionAt
  };
  const safeSim=typeof simState==='undefined'?null:simState;
  const payload=JSON.stringify({
    nodes,edges,physicsSettings,autoConnections,technologySettings,
    simState:safeSim,worldStateCache,scaleNav:safeScaleNav
  });
  try{
    localStorage.setItem('magicSandboxV8',payload)
  }catch(err){
    console.warn('Save storage limit reached. Large imported megastructure images may need to be reduced.',err)
  }
}
let restoredWorldState=null;
function load(){
  try{
    const d=JSON.parse(localStorage.getItem('magicSandboxV8')||'null');
    if(d&&Array.isArray(d.nodes)){
      nodes=d.nodes;edges=d.edges||[];
      if(d.physicsSettings)physicsSettings={...physicsSettings,...d.physicsSettings};
      if(d.autoConnections)autoConnections={...autoConnections,...d.autoConnections};
      if(d.technologySettings)technologySettings={...technologySettings,...d.technologySettings};
      if(d.worldStateCache)worldStateCache=d.worldStateCache;
      restoredWorldState={simState:d.simState||null,scaleNav:d.scaleNav||null};
    }
  }catch(_){}
  nodes.forEach(n=>{if(n.type==='tool')n.type='magicalObject'});
  if(!nodes.length)nodes=[{id:'mana',type:'mana',name:'MANA',x:0,y:0,vx:0,vy:0,r:45,fixed:true,description:'The magical source from which this system grows.'}];
}
function spellFeatures(s){return [s.spellClass,s.intent,s.structure,s.target,s.output,s.duration,s.range,s.source,s.extra].flatMap(tokenize)}
function similarity(a,b){
  const ac=String(a.spellClass||'Unclassified').trim().toLowerCase();
  const bc=String(b.spellClass||'Unclassified').trim().toLowerCase();
  return ac&&bc&&ac===bc?1:0;
}
function ruleApplies(rule,spell){
  const explicit=Array.isArray(rule.spellIds)?rule.spellIds:[];
  if(explicit.length)return explicit.includes(spell.id);
  const classTarget=String(rule.spellClass||'').trim().toLowerCase();
  if(classTarget)return String(spell.spellClass||'').trim().toLowerCase()===classTarget;
  const scope=String(rule.scope||'').toLowerCase().trim();if(!scope||scope==='all'||scope.includes('all magic'))return true;
  const cls=String(spell.spellClass||'').toLowerCase(),intent=String(spell.intent||'').toLowerCase(),structure=String(spell.structure||'').toLowerCase(),output=String(spell.output||'').toLowerCase(),target=String(spell.target||'').toLowerCase(),source=String(spell.source||'').toLowerCase();
  const patterns=[
    [/^(?:all\s+)?(.+?)\s+spells?$/,v=>cls===v||cls.includes(v)],
    [/^(?:spell\s+)?class\s*:\s*(.+)$/,v=>cls===v||cls.includes(v)],
    [/^intent\s*:\s*(.+)$/,v=>intent.includes(v)],[/^structure\s*:\s*(.+)$/,v=>structure.includes(v)],
    [/^output\s*:\s*(.+)$/,v=>output.includes(v)],[/^target\s*:\s*(.+)$/,v=>target.includes(v)],[/^source\s*:\s*(.+)$/,v=>source.includes(v)]
  ];
  for(const [rx,test] of patterns){const m=scope.match(rx);if(m&&test(m[1].trim().replace(/s$/,'')))return true}
  const normalized=scope.replace(/^all\s+/,'').replace(/\s+spells?$/,'').trim();if(normalized&&(cls===normalized||cls===normalized.replace(/s$/,'')))return true;
  const hay=[spell.name,cls,intent,structure,output,target,source,spell.extra].join(' ').toLowerCase();
  const toks=tokenize(scope).filter(t=>!['all','magic','spell','spells','type','class','category'].includes(t));return toks.length?toks.every(t=>hay.includes(t)):false
}
function mentions(a,b){const hay=[a.name,a.description,a.property,a.category,a.interaction,a.composition,a.requirements,a.method,a.theory,a.extra,a.source,a.output,a.structure,a.uses,a.sourceDetail].join(' ').toLowerCase();return tokenize(b.name).some(t=>hay.includes(t))}
function placeRank(n){
  return PLACE_LEVELS.findIndex(([v])=>v===String(n?.placeScale||inferPlaceScale(n?.placeType||n?.category||'')).toLowerCase())
}
function placeMentionsPlace(parent,child){
  if(parent?.type!=='place'||child?.type!=='place'||parent.id===child.id)return false;
  const childName=String(child.name||'').trim().toLowerCase();if(!childName)return false;
  const fields=[parent.associations,parent.uses,parent.compatibility,parent.description,parent.interaction,parent.composition];
  return fields.some(v=>fieldParts(v).includes(childName)||String(v||'').toLowerCase().includes(childName));
}
function placeContains(parent,child){
  // Moon nodes never participate in graph-defined physical containment.
  if(isMoonPlace(parent)||isMoonPlace(child))return false;
  if(parent?.type!=='place'||child?.type!=='place'||parent.id===child.id)return false;
  if(isStarSystemPlace(parent)&&isMoonPlace(child))return false;
  if(placeRank(parent)<=placeRank(child))return false;
  if(placeMentionsPlace(parent,child))return true;
  return edges.some(e=>{
    if(e.blocked||isVisualOnlyEdge(e))return false;
    const same=(e.a===parent.id&&e.b===child.id)||(e.b===parent.id&&e.a===child.id);
    if(!same)return false;
    const label=String(e.label||'').toLowerCase();
    return e.placeContainment||label.includes('contains')||label.includes('located')||label.includes('inside')||label.includes('part of');
  });
}
function directContainedPlaces(parent){return parent?ofType('place').filter(child=>placeContains(parent,child)):[]}
function inferredSystemsForGalaxy(galaxy){
  if(!galaxy||String(galaxy.placeScale||inferPlaceScale(galaxy.placeType))!=='galaxy')return [];

  const galaxyChildren=directContainedPlaces(galaxy);
  const childIds=new Set(galaxyChildren.map(p=>p.id));

  return ofType('place').filter(system=>{
    if(String(system.placeScale||inferPlaceScale(system.placeType))!=='solar-system')return false;

    // Direct containment still wins.
    if(placeContains(galaxy,system))return true;

    // Bridge inference:
    // Galaxy contains Planet/Star X AND System contains Planet/Star X
    // => that System belongs to this Galaxy.
    return directContainedPlaces(system).some(member=>childIds.has(member.id));
  })
}

function effectiveContainedPlaces(parent){
  if(!parent)return [];
  const direct=directContainedPlaces(parent);
  const scale=String(parent.placeScale||inferPlaceScale(parent.placeType));

  if(scale==='galaxy'){
    const systems=inferredSystemsForGalaxy(parent);
    const merged=new Map([...direct,...systems].map(p=>[p.id,p]));
    return [...merged.values()]
  }

  return direct
}

function effectiveGalaxyParents(system){
  if(!system||String(system.placeScale||inferPlaceScale(system.placeType))!=='solar-system')return [];
  return ofType('place').filter(g=>{
    const gs=String(g.placeScale||inferPlaceScale(g.placeType));
    return gs==='galaxy'&&inferredSystemsForGalaxy(g).some(s=>s.id===system.id)
  })
}


function resourceRelation(a,b){return mentions(a,b)||mentions(b,a)}
function semanticScore(a,b){
  if(!a||!b||a===b)return 0;
  let score=0;
  const an=String(a.name||'').toLowerCase(),bn=String(b.name||'').toLowerCase();
  const aText=[a.description,a.property,a.category,a.interaction,a.composition,a.requirements,a.method,a.theory,a.extra,a.source,a.output,a.structure,a.uses,a.sourceDetail].join(' ').toLowerCase();
  const bText=[b.description,b.property,b.category,b.interaction,b.composition,b.requirements,b.method,b.theory,b.extra,b.source,b.output,b.structure,b.uses,b.sourceDetail].join(' ').toLowerCase();
  if(an&&bText.includes(an))score+=5;
  if(bn&&aText.includes(bn))score+=5;
  if(a.category&&b.category&&String(a.category).toLowerCase()===String(b.category).toLowerCase())score+=1.5;
  const shared=[...new Set(tokenize(aText))].filter(t=>t.length>4&&tokenize(bText).includes(t));
  score+=Math.min(3,shared.length*.5);
  if((a.type==='magicalObject'&&b.type==='material')||(b.type==='magicalObject'&&a.type==='material'))score+=1;
  if((a.type==='technique'&&b.type==='principle')||(b.type==='technique'&&a.type==='principle'))score+=1;
  return score;
}

function relationLabel(a,b){
  if(a.type==='place'&&b.type==='place'){
    if(placeRank(a)>placeRank(b)&&placeMentionsPlace(a,b))return 'contains';
    if(placeRank(b)>placeRank(a)&&placeMentionsPlace(b,a))return 'located in';
  }
  if(a.type==='magicalObject'&&b.type==='material'&&String(a.composition||'').toLowerCase().includes(String(b.name||'').toLowerCase()))return 'made of';
  if(b.type==='magicalObject'&&a.type==='material'&&String(b.composition||'').toLowerCase().includes(String(a.name||'').toLowerCase()))return 'made of';
  if((a.type==='technique'&&b.type==='principle')||(b.type==='technique'&&a.type==='principle'))return 'based on';
  if((a.type==='principle'&&b.type==='magicalObject')||(b.type==='principle'&&a.type==='magicalObject'))return 'governs';
  if((a.type==='magicalObject'&&b.type==='technique')||(b.type==='magicalObject'&&a.type==='technique'))return 'used by';
  return 'related to';
}
function isBlockedAutomatic(a,b,type){
  return edges.some(e=>{
    if(!e.manual||!e.blocked)return false;

    const samePair=
      (e.a===a&&e.b===b) ||
      (e.a===b&&e.b===a);

    if(!samePair)return false;

    // A generic blocker suppresses the pair completely.
    // Otherwise suppress the exact automatic relationship type.
    return !e.originalType ||
      e.originalType===type ||
      e.originalType==='*';
  });
}

function classPointId(className){return 'classpoint:'+String(className||'Unclassified')}
function classMembers(className){
  return spells().filter(s=>(s.spellClass||'Unclassified')===className)
}
function rebuildClassPoints(){
  const valid=new Set(
    classNames()
      .filter(c=>classMembers(c).length>1)
      .map(classPointId)
  );

  // Remove obsolete points.
  nodes=nodes.filter(n=>n.type!=='classPoint'||valid.has(n.id));

  // Add/update one small point per multi-spell class.
  for(const cls of classNames()){
    const members=classMembers(cls);
    if(members.length<=1)continue;

    const id=classPointId(cls);
    let p=nodes.find(n=>n.id===id);
    const avgX=members.reduce((a,s)=>a+(s.x||0),0)/members.length;
    const avgY=members.reduce((a,s)=>a+(s.y||0),0)/members.length;

    if(!p){
      p={
        id,type:'classPoint',name:cls,spellClass:cls,
        x:avgX,y:avgY,vx:0,vy:0,r:1.5,fixed:false,virtual:true
      };
      nodes.push(p);
    }else{
      p.name=cls;
      p.spellClass=cls;
      p.r=1.5;
      p.virtual=true;
    }
  }
}
function classPointFor(className){
  return nodes.find(n=>n.id===classPointId(className));
}
function explicitTargetsWholeClass(rule, className){
  const members=classMembers(className);
  const ids=Array.isArray(rule.spellIds)?rule.spellIds:[];
  return members.length>1 && ids.length===members.length && members.every(s=>ids.includes(s.id));
}


function nodeHubRole(node){
  if(node?.isHub)return'hub';
  if(node?.isSemiHub)return'semi';
  return'normal'
}
function setNodeHubRole(node,role){
  if(!node||node.type==='mana'||node.virtual)return;

  const next=['normal','semi','hub'].includes(role)?role:'normal';

  node.isHub=next==='hub';
  node.isSemiHub=next==='semi';

  if(node.isHub){
    node.hubType=node.type;
    node.r=30
  }else if(node.isSemiHub){
    delete node.hubType;
    node.r=23
  }else{
    delete node.hubType;
    node.r=node.type==='spell'?17:16
  }
}

function userHubs(){
  // Semi-Hubs deliberately do NOT participate in full Hub auto-membership.
  return nodes.filter(n=>n.isHub&&!n.virtual)
}
function hubForName(name){
  const q=String(name||'').trim().toLowerCase();
  return q?userHubs().find(h=>String(h.name||'').trim().toLowerCase()===q):null;
}
function fieldParts(v){return String(v||'').toLowerCase().split(/[;,|]/).map(x=>x.trim()).filter(Boolean)}
function nodeMentionsHub(n,hub){
  if(!n||!hub||n.id===hub.id)return false;
  const h=String(hub.name||'').trim().toLowerCase();
  if(!h)return false;

  // Category is the primary automatic Hub membership field.
  // Example: Category = "Potion" + a Hub named "Potion" => automatic membership.
  if(fieldParts(n.category).includes(h)||String(n.category||'').trim().toLowerCase()===h)return true;

  // Other relationship fields can still reference a Hub explicitly.
  const fields=[n.uses,n.compatibility,n.requirements,n.composition,n.interaction,n.description,n.property,n.extra,n.scope,n.spellClass,n.text];
  return fields.some(v=>fieldParts(v).includes(h)||String(v||'').trim().toLowerCase()===h);
}
function hubMembers(hub){
  return nodes.filter(n=>!n.virtual&&!n.isHub&&n.type!=='mana'&&nodeMentionsHub(n,hub));
}

let lastPlaceHierarchySignature='';
function placeHierarchySignature(){
  return edges
    .filter(e=>!e.blocked&&(e.placeContainment||String(e.label||'').toLowerCase().includes('contains')))
    .map(e=>[e.a,e.b,e.placeContainment?1:0,String(e.label||'')].join(':'))
    .sort()
    .join('|')
}
function rebuildEdges(){
  const hierarchySignature=placeHierarchySignature();
  if(lastPlaceHierarchySignature&&hierarchySignature!==lastPlaceHierarchySignature){
    worldStateCache={maps:{},planets:{}};
    if(typeof simState!=='undefined')simState.spaceMap=null;
  }
  lastPlaceHierarchySignature=hierarchySignature;
  rebuildClassPoints();

  const blockers=edges.filter(e=>e.manual&&e.blocked);
  const manual=edges.filter(e=>e.manual&&!e.blocked);
  const retainedAuto=edges.filter(e=>!e.manual&&!e.blocked);

  // Blockers are persistent graph state. Never discard them during a rebuild:
  // every automatic generator below checks them before recreating a link.
  edges=[...manual,...blockers];

  if(!autoConnections.enabled){
    if(autoConnections.restoreMode==='keep') edges.push(...retainedAuto);
    graph.setData(nodes,edges.filter(e=>!e.blocked));save();updateStats();return;
  }

  const ss=spells();

  for(const hub of userHubs()){
    if(!isBlockedAutomatic('mana',hub.id,'hubroot'))
      edges.push({id:uid(),a:'mana',b:hub.id,type:'hubroot',label:'derived from Mana',direction:'forward'});
    for(const member of hubMembers(hub)){
      if(!isBlockedAutomatic(hub.id,member.id,'hubmember'))
        edges.push({
          id:uid(),a:hub.id,b:member.id,type:'hubmember',
          label:(fieldParts(member.category).includes(String(hub.name||'').trim().toLowerCase())?'category: ':'member of ')+hub.name,
          direction:'forward'
        });
    }
  }


  // MANA still connects to every real spell directly.
  for(const s of ss){
    if(!isBlockedAutomatic('mana',s.id,'mana'))
      edges.push({id:uid(),a:'mana',b:s.id,type:'mana',label:'derived from Mana',direction:'forward'});
  }

  // Keep original V15 same-class spell connections.
  for(let i=0;i<ss.length;i++)for(let j=i+1;j<ss.length;j++){
    if(similarity(ss[i],ss[j])===1&&!isBlockedAutomatic(ss[i].id,ss[j].id,'similar')){
      edges.push({
        id:uid(),a:ss[i].id,b:ss[j].id,type:'similar',
        label:'same Spell Class: '+(ss[i].spellClass||'Unclassified'),
        direction:'both'
      });
    }
  }

  // RULES:
  // 1) Explicitly selected subset -> direct lines to selected spells.
  // 2) Explicitly selected ALL spells of a class -> one line to class point.
  // 3) Dedicated Spell Class field / class-wide scope -> class point.
  // 4) Lone-spell class -> direct to the lone spell.
  for(const r of rules()){
    const exactHub=hubForName(r.spellClass)||hubForName(r.scope);
    if(exactHub){
      if(!isBlockedAutomatic(r.id,exactHub.id,'applies'))
        edges.push({id:uid(),a:r.id,b:exactHub.id,type:'applies',label:'governs '+exactHub.name,direction:'forward'});
      continue;
    }

    const explicit=Array.isArray(r.spellIds)?r.spellIds:[];
    const targetClass=String(r.spellClass||'').trim();

    if(explicit.length){
      // Check whether the explicit selection exactly equals any whole class.
      const wholeClass=classNames().find(cls=>explicitTargetsWholeClass(r,cls));
      if(wholeClass){
        const point=classPointFor(wholeClass);
        if(point&&!isBlockedAutomatic(r.id,point.id,'applies')){
          edges.push({
            id:uid(),a:r.id,b:point.id,type:'applies',
            label:'governs entire Spell Class',direction:'forward'
          });
        }else{
          const lone=classMembers(wholeClass)[0];
          if(lone&&!isBlockedAutomatic(r.id,lone.id,'applies'))
            edges.push({id:uid(),a:r.id,b:lone.id,type:'applies',label:'governs Spell Class',direction:'forward'});
        }
      }else{
        // Partial selection like 3/4 stays as 3 direct connections.
        for(const sid of explicit){
          if(byId(sid)&&!isBlockedAutomatic(r.id,sid,'applies')){
            edges.push({
              id:uid(),a:r.id,b:sid,type:'applies',
              label:'governs selected spell',direction:'forward'
            });
          }
        }
      }
      continue;
    }

    if(targetClass){
      const members=classMembers(targetClass);
      const point=classPointFor(targetClass);
      if(point&&!isBlockedAutomatic(r.id,point.id,'applies')){
        edges.push({
          id:uid(),a:r.id,b:point.id,type:'applies',
          label:'governs entire Spell Class',direction:'forward'
        });
      }else if(members.length===1&&!isBlockedAutomatic(r.id,members[0].id,'applies')){
        edges.push({
          id:uid(),a:r.id,b:members[0].id,type:'applies',
          label:'governs Spell Class',direction:'forward'
        });
      }
      continue;
    }

    const scope=String(r.scope||'').toLowerCase().trim();
    const scopeClass=classNames().find(cls=>{
      const c=String(cls).toLowerCase();
      return scope===c || scope===c+' spells' || scope==='all '+c || scope==='all '+c+' spells';
    });

    if(scopeClass){
      const members=classMembers(scopeClass);
      const point=classPointFor(scopeClass);
      if(point&&!isBlockedAutomatic(r.id,point.id,'applies')){
        edges.push({
          id:uid(),a:r.id,b:point.id,type:'applies',
          label:'governs entire Spell Class',direction:'forward'
        });
      }else if(members.length===1&&!isBlockedAutomatic(r.id,members[0].id,'applies')){
        edges.push({
          id:uid(),a:r.id,b:members[0].id,type:'applies',
          label:'governs Spell Class',direction:'forward'
        });
      }
      continue;
    }

    // Ordinary broad/semantic rule behavior from V15.
    for(const s of ss){
      if(ruleApplies(r,s)&&!isBlockedAutomatic(r.id,s.id,'applies')){
        let label='governs';
        if(scope.startsWith('intent:'))label='governs intent';
        else if(scope.startsWith('structure:'))label='governs structure';
        else if(scope.startsWith('output:'))label='governs output';
        edges.push({id:uid(),a:r.id,b:s.id,type:'applies',label,direction:'forward'});
      }
    }
  }

  const extras=nodes.filter(n=>['material','magicalObject','technique','principle','structure','life','place'].includes(n.type));

  // Other concept types:
  // if exact compatibility field targets a WHOLE class, route to point.
  // otherwise preserve V15 direct smart relationships.
  for(const n of extras){
    const manaCompatible=[n.uses,n.compatibility,n.requirements,n.composition].some(v=>fieldParts(v).includes('mana')||String(v||'').trim().toLowerCase()==='mana');
    if(manaCompatible&&!isBlockedAutomatic(n.id,'mana','uses'))
      edges.push({id:uid(),a:n.id,b:'mana',type:'uses',label:'compatible with Mana',direction:'forward'});
    const exactHub=hubForName(n.uses)||hubForName(n.compatibility)||hubForName(n.category);
    if(exactHub&&exactHub.id!==n.id){
      if(!isBlockedAutomatic(n.id,exactHub.id,'uses'))
        edges.push({id:uid(),a:n.id,b:exactHub.id,type:'uses',label:'compatible with '+exactHub.name,direction:'forward'});
      continue;
    }

    const comp=String(n.uses||n.compatibility||'').trim();
    const exactClass=classNames().find(c=>String(c).toLowerCase()===comp.toLowerCase());

    if(exactClass){
      const members=classMembers(exactClass);
      const point=classPointFor(exactClass);
      if(point&&!isBlockedAutomatic(n.id,point.id,'uses')){
        edges.push({
          id:uid(),a:n.id,b:point.id,type:'uses',
          label:'compatible with entire Spell Class',direction:'forward'
        });
      }else if(members.length===1&&!isBlockedAutomatic(n.id,members[0].id,'uses')){
        edges.push({
          id:uid(),a:n.id,b:members[0].id,type:'uses',
          label:'compatible with Spell Class',direction:'forward'
        });
      }
      continue;
    }

    for(const s of ss){
      const classHit=String(n.uses||'').toLowerCase().includes(String(s.spellClass||'').toLowerCase())&&String(s.spellClass||'').trim();
      const smartHit=semanticScore(n,s)>=4;
      if(resourceRelation(n,s)||classHit||smartHit){
        const label=n.type==='material'?'used by spell':
          n.type==='magicalObject'?'used to cast':
          n.type==='technique'?'performed through':
          n.type==='structure'?'institutionalized by':
          n.type==='life'?'interacts with living magic':
          'guided by principle';

        if(!isBlockedAutomatic(n.id,s.id,'uses'))
          edges.push({id:uid(),a:n.id,b:s.id,type:'uses',label,direction:'forward'});
      }
    }
  }

  // Non-spell system relationships stay V15-like.
  for(let i=0;i<extras.length;i++)for(let j=i+1;j<extras.length;j++){
    const a=extras[i],b=extras[j];

    const aIsHub=!!a.isHub,bIsHub=!!b.isHub;
    const hubMembership=
      (aIsHub&&hubMembers(a).some(n=>n.id===b.id)) ||
      (bIsHub&&hubMembers(b).some(n=>n.id===a.id));

    const alreadyHasMembershipEdge=edges.some(e=>
      e.type==='hubmember' &&
      ((e.a===a.id&&e.b===b.id)||(e.a===b.id&&e.b===a.id))
    );

    if(!hubMembership&&!alreadyHasMembershipEdge&&(resourceRelation(a,b)||semanticScore(a,b)>=3.5)&&!isBlockedAutomatic(a.id,b.id,'related')){
      edges.push({
        id:uid(),a:a.id,b:b.id,type:'related',
        label:relationLabel(a,b),direction:'none'
      });
    }
  }

  // A connection plan chosen in the Create editor overrides automatic
  // connections touching that node, so the preview matches what gets placed.
  for(const n of nodes.filter(n=>Array.isArray(n.connectionPlan))){
    edges=edges.filter(e=>
      (e.manual&&e.blocked) ||
      e.manual ||
      !(e.a===n.id||e.b===n.id)
    );
    for(const p of n.connectionPlan){
      if(!byId(p.targetId)||p.targetId===n.id)continue;
      const plannedType=p.type||'uses';
      if(isBlockedAutomatic(n.id,p.targetId,plannedType))continue;
      edges.push({
        id:uid(),a:n.id,b:p.targetId,type:plannedType,
        label:p.label||'related to',direction:p.direction||'forward',planned:true,
        customized:!!p.customized,linkType:p.linkType||'direct',
        strength:p.strength||'solid',thickness:p.thickness||1.6,relationship:Number.isFinite(p.relationship)?p.relationship:undefined,relationshipKind:p.relationshipKind||undefined
      });
    }
  }
  // V17: Sentient non-Main life has an explicit green relationship edge to Main life.
  // Manual links still replace automatic ones through the existing blocker/replacement system.
  const mains=nodes.filter(n=>n.type==='life'&&n.main);
  const secondary=nodes.filter(n=>n.type==='life'&&n.sentient&&!n.main);
  for(const creature of secondary){
    const rv=Number.isFinite(creature.relationshipWithMain)?creature.relationshipWithMain:0;
    for(const main of mains){
      const existing=edges.some(e=>!e.blocked&&!isVisualOnlyEdge(e)&&((e.a===creature.id&&e.b===main.id)||(e.a===main.id&&e.b===creature.id)));
      if(!existing&&!isBlockedAutomatic(creature.id,main.id,'relationship')){
        edges.push({id:uid(),a:creature.id,b:main.id,type:'relationship',linkType:'relationship',label:`Separate · relationship ${rv>0?'+':''}${rv}`,relationship:rv,relationshipKind:'separate',direction:'both'});
      }
    }
  }

  // V19.4: Place-to-Place links can carry spatial hierarchy meaning.
  for(const e of edges){
    const a=byId(e.a),b=byId(e.b);
    if(a?.type==='place'&&b?.type==='place'){
      const label=String(e.label||'').toLowerCase();
      if(label==='contains'||label==='located in')e.placeContainment=true;
    }
  }

  // V18.3: technological Magical Objects do not participate in ordinary
  // automatic graph connections. Their spine attachment is handled separately.
  // Manual links are always retained.
  const technologicalIds=new Set(nodes.filter(n=>n.type==='magicalObject'&&n.technological).map(n=>n.id));
  edges=edges.filter(e=>{
    if(e.manual||e.blocked||e.techEdge)return true;
    return !technologicalIds.has(e.a)&&!technologicalIds.has(e.b);
  });

  graph.setData(nodes,edges.filter(e=>!e.blocked));save();updateStats();
}
function classNames(){return [...new Set(spells().map(s=>s.spellClass||'Unclassified'))].sort()}
function renderLibraries(){
  $('spellCount').textContent=spells().length;$('systemCount').textContent=nodes.filter(n=>!['mana','spell','classPoint'].includes(n.type)).length;
  const filters=$('classFilters');filters.innerHTML='';['All',...classNames()].forEach(c=>{const b=document.createElement('button');b.className='class-chip'+(activeSpellClass===c?' active':'');b.textContent=c;b.onclick=()=>{activeSpellClass=c;renderLibraries()};filters.appendChild(b)});
  const list=$('spellList');list.innerHTML='';spells().filter(s=>activeSpellClass==='All'||(s.spellClass||'Unclassified')===activeSpellClass).forEach(s=>{const el=document.createElement('div');el.className='library-item'+(selected===s?' selected':'');el.innerHTML=`<strong>${E.esc(s.name)}</strong><small>${E.esc(s.spellClass||'Unclassified')} · ${E.esc(s.intent||'No intent')}</small>`;el.onclick=()=>selectNode(s);el.ondblclick=()=>openEditor('spell',s);list.appendChild(el)});
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===activeSystemTab));
  const sys=$('systemList');sys.innerHTML='';let shown=activeSystemTab==='rules'?rules():activeSystemTab==='materials'?ofType('material'):nodes.filter(n=>['magicalObject','technique','principle','structure','organization','civilizationUtil','life','place'].includes(n.type));
  shown.forEach(n=>{const el=document.createElement('div');el.className='library-item'+(selected===n?' selected':'');el.innerHTML=`<strong>${E.esc(n.name)}</strong><small>${E.esc(n.type)}${n.strength?' · '+E.esc(n.strength):''}</small>`;el.onclick=()=>selectNode(n);el.ondblclick=()=>openEditor(n.type,n);sys.appendChild(el)})
}
function updateStats(){$('systemStats').textContent=`${nodes.filter(n=>n.type!=='classPoint').length} concepts · ${edges.length} links · ${classNames().length} spell classes`}
function selectNode(n){selected=n;graph.selected=n;showSelection();renderLibraries()}
function showSelection(){
  const box=$('selectionCard');if(!selected){box.classList.add('hidden');return}box.classList.remove('hidden');
  if(selected.isHub){
    const members=hubMembers(selected);
    box.innerHTML=`<h3>${E.esc(selected.name)} HUB</h3><p><b>Hub type:</b> ${E.esc(selected.hubType==='magicalObject'?'Magical Object':selected.hubType||selected.type)}</p><p><b>${members.length}</b> member node(s).</p><p>This hub is editable and movable. Nodes join it when they reference <b>${E.esc(selected.name)}</b> in category, compatibility, requirements, composition, or related fields.</p>`;
    return
  }
  if(selected.type==='classPoint'){
    const members=classMembers(selected.spellClass);
    box.innerHTML=`<h3>${E.esc(selected.spellClass)} HUB</h3>
      <p>This small point represents the entire <b>${E.esc(selected.spellClass)}</b> Spell Class.</p>
      <p>${members.length} spells belong to this class.</p>
      <p>Whole-class Rules and compatibility connect here. Partial targets still connect directly to the affected spells.</p>`;
    return
  }
  if(selected.type==='mana'){box.innerHTML=`<h3>${E.esc(selected.name||'MANA')}</h3>${selected.nature?`<p><b>Nature:</b> ${E.esc(selected.nature)}</p>`:''}<p>${E.esc(selected.description)}</p><p>${spells().length} spells · ${rules().length} rules</p>`;return}
  if(selected.type==='spell'){box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Class:</b> ${E.esc(selected.spellClass||'Unclassified')}</p><p><b>Intent:</b> ${E.esc(selected.intent)}</p><p><b>Structure:</b> ${E.esc(selected.structure)}</p><p><b>Output:</b> ${E.esc(selected.output)}</p><p><b>Target:</b> ${E.esc(selected.target)}</p><p><b>Good / Bad:</b> ${(selected.morality??0)>0?'+':''}${selected.morality??0}</p>`;return}
  if(selected.type==='rule'){const names=(selected.spellIds||[]).map(id=>byId(id)?.name).filter(Boolean);box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p>${E.esc(selected.text)}</p><p><b>Applies:</b> ${names.length?E.esc(names.join(', ')):E.esc(selected.scope||'All magic')}</p><p><b>Exceptions:</b> ${E.esc(selected.exceptions||'None')}</p>`;return}
  if(selected.type==='technologyRoot'){
    const techs=technologyNodes();
    box.innerHTML=`<h3>TECHNOLOGY</h3><p><b>Technology Root</b></p><p>${E.esc(selected.description||'Civilization technology branches upward from Mana.')}</p><p><b>Technologies:</b> ${techs.length}</p><p><b>Drop:</b> Drag Magical Objects or Magical Object category hubs onto this Hub.</p><p><b>Advancement:</b> Click a cyan object-to-spine line to enter any non-negative Advancement value. There is no upper limit.</p><p><b>Detach:</b> Drag technology back down toward MANA to return it to the ordinary graph.</p><p><b>Delete:</b> resets technology only; the Hub is restored.</p>`;
    return
  }
  if(selected.type==='life'){
    const role=selected.individual
      ? (selected.main?'Individual · Main':selected.sentient?'Individual · Sentient':'Individual')
      : (selected.main?'Main civilization species':selected.sentient?'Sentient species':'Non-sentient life');
    const morality=selected.individual?`<p><b>Morality:</b> ${(selected.individualMorality??0)>0?'+':''}${selected.individualMorality??0}</p>`:'';
    box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Life role:</b> ${E.esc(role)}</p>${morality}<p><b>Category:</b> ${E.esc(selected.category||'Life')}</p><p>${E.esc(selected.description||selected.property||'')}</p><button class="selection-inspect-btn" data-sim-inspect="${selected.id}">Simulation Inspector</button>`;
    box.querySelector('[data-sim-inspect]')?.addEventListener('click',()=>openSimulationInspector(selected));
    return
  }
  if(selected.type==='organization'){
    const st=organizationStatusFor(selected);
    box.innerHTML=`<h3>${E.esc(selected.name)}</h3>
      <p><b>Organization:</b> ${E.esc(selected.organizationType||'Organization')}</p>
      <p><b>Members:</b> ${(selected.organizationMembers||0).toLocaleString()}</p>
      <p><b>Relationships:</b> ${st.relationships.length} · <b>Controlled/linked Places:</b> ${st.places.length}</p>
      <button class="selection-inspect-btn" data-sim-inspect="${selected.id}">Simulation Inspector</button>`;
    box.querySelector('[data-sim-inspect]')?.addEventListener('click',()=>openSimulationInspector(selected));
    return
  }
  if(selected.type==='place'){
    box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Place type:</b> ${E.esc(selected.placeType||selected.category||'Place')}</p><p><b>Inhabitants:</b> ${E.esc(selected.inhabitants||'Unspecified')}</p><p><b>Authority:</b> ${E.esc(selected.government||'Unspecified')}</p><p>${E.esc(selected.description||'')}</p><button class="selection-inspect-btn" data-sim-inspect="${selected.id}">Simulation Inspector</button>`;
    box.querySelector('[data-sim-inspect]')?.addEventListener('click',()=>openSimulationInspector(selected));
    return
  }
  box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Type:</b> ${E.esc(selected.type)}</p><p>${E.esc(selected.description||selected.property||'')}</p>`
}
function moralityVisuals(slider){
  if(!slider)return;
  const n=Number(slider.value);
  const pct=((n+100)/200)*100;
  const value=$('moralityValue'),label=$('moralityLabel');

  const text=n<=-75?'Severely dangerous':
    n<-50?'Dangerous':
    n<-15?'Harmful':
    n<15?'Neutral':
    n<=50?'Beneficial':
    n<=75?'Highly beneficial':'Exceptional good';

  if(value)value.textContent=(n>0?'+':'')+n;
  if(label)label.textContent=text;

  let color='#8c98aa', glow='rgba(150,165,190,.18)';
  if(n<-15){
    const s=Math.min(1,Math.abs(n)/100);
    color=`rgb(${Math.round(150+55*s)},${Math.round(72-20*s)},${Math.round(86-15*s)})`;
    glow=`rgba(210,75,92,${.14+.22*s})`;
  }else if(n>15){
    const s=Math.min(1,n/100);
    color=`rgb(${Math.round(70-15*s)},${Math.round(145+45*s)},${Math.round(120+20*s)})`;
    glow=`rgba(70,195,145,${.14+.22*s})`;
  }

  // IMPORTANT: paint the progress directly onto the element.
  // This avoids relying on pseudo-element CSS variables refreshing.
  slider.style.background=
    `linear-gradient(90deg, ${color} 0%, ${color} ${pct}%, #2d3542 ${pct}%, #2d3542 100%)`;
  slider.style.setProperty('--morality-color',color);
  slider.style.setProperty('--morality-glow',glow);
  slider.setAttribute('aria-valuetext',`${text} ${n}`);

  const readout=document.querySelector('.morality-readout');
  if(readout){
    readout.style.setProperty('--morality-color',color);
    readout.style.setProperty('--morality-glow',glow);
  }
}
function bindMoralitySlider(){
  const slider=$('eMorality');
  if(!slider)return;
  // Explicit JS listeners rather than an inline oninput attribute.
  const repaint=()=>moralityVisuals(slider);
  slider.addEventListener('input',repaint);
  slider.addEventListener('change',repaint);
  slider.addEventListener('pointermove',e=>{if(e.buttons)repaint()});
  slider.addEventListener('keydown',()=>requestAnimationFrame(repaint));
  repaint();
}
function updateMoralityDisplay(v){
  const slider=$('eMorality');
  if(slider&&v!==undefined)slider.value=v;
  moralityVisuals(slider);
}


// ======================= V22 CIVILIZATION UTILS =======================
let civilizationSymbols=[];
try{civilizationSymbols=JSON.parse(localStorage.getItem('magicCivilizationSymbols')||'[]')}catch{}

function civilizationUtils(subtype=null){
  return ofType('civilizationUtil').filter(n=>!subtype||n.utilityType===subtype)
}
function civilizationUtilityLinkLabel(util){
  return util?.utilityType==='language'?'Speaks':
         util?.utilityType==='currency'?'Uses':
         util?.utilityType==='disease'?'Susceptible To':
         util?.utilityType==='legalCode'?'Subject To':
         util?.utilityType==='rankSystem'?'Uses Ranks':
         util?.utilityType==='communication'?'Communicates Via':
         util?.utilityType==='calendar'?'Uses Calendar':
         util?.utilityType==='measurement'?'Uses Units':
         util?.utilityType==='naming'?'Uses Naming System':'Uses'
}
function linkedLifeForUtility(util){
  return ofType('life').filter(l=>graphNodesLinked(l.id,util.id))
}
function lifeCanUseUtility(life,util){
  if(!life||!util)return false;
  const linked=linkedLifeForUtility(util);
  return linked.length===0?true:linked.some(l=>l.id===life.id)
}
function linkedCurrenciesForMaterial(mat){
  return civilizationUtils('currency').filter(c=>graphNodesLinked(mat.id,c.id))
}
function materialPriceRows(mat){
  return (mat?.currencyPrices||[]).map(p=>{
    const c=byId(p.currencyId);
    return c?{currency:c,amount:+p.amount||0}:null
  }).filter(Boolean)
}
function symbolById(id){return civilizationSymbols.find(s=>s.id===id)||null}
function civilizationSymbolToken(id){
  return id?`[[sym:${id}]]`:''
}
function parseCivilizationSymbolTokens(text){
  return String(text||'').split(/(\[\[sym:[^\]]+\]\])/g).filter(Boolean)
}
function renderCivilizationSymbolRichText(text){
  return parseCivilizationSymbolTokens(text).map(part=>{
    const m=part.match(/^\[\[sym:([^\]]+)\]\]$/);
    if(!m)return E.esc(part);
    const sym=symbolById(m[1]);
    if(!sym)return`<span class="missing-language-symbol">${E.esc(part)}</span>`;
    return`<span class="language-inline-symbol" title="${E.esc(sym.name)}"><img src="${sym.data}" alt="${E.esc(sym.name)}"></span>`
  }).join('')
}

function civilizationSymbolPlainText(text){
  return parseCivilizationSymbolTokens(text).map(part=>{
    const m=part.match(/^\[\[sym:([^\]]+)\]\]$/);
    if(!m)return part;
    return symbolById(m[1])?.name?`⟦${symbolById(m[1]).name}⟧`:'⟦symbol⟧'
  }).join('')
}
function languageSymbolPalette(){
  if(!civilizationSymbols.length){
    return`<div class="language-symbol-empty">No custom symbols yet. Create some in Civilization Utils → Symbol Library.</div>`
  }
  return civilizationSymbols.map(s=>`
    <button type="button" class="language-symbol-pick" draggable="true" data-language-symbol="${s.id}" title="${E.esc(s.name)}">
      <img src="${s.data}" alt="${E.esc(s.name)}">
      <span>${E.esc(s.name)}</span>
    </button>`).join('')
}

function civilizationUtilSymbolPalette(title='Custom Symbol Palette',help='Click a symbol to insert it into the focused field.'){
  return`<div class="full language-symbol-palette-card civilization-util-symbol-card">
    <div class="language-symbol-palette-head">
      <div><b>${E.esc(title)}</b><small>${E.esc(help)}</small></div>
      <button type="button" class="open-civ-symbol-library">✎ Symbol Library</button>
    </div>
    <div class="language-symbol-palette">${languageSymbolPalette()}</div>
  </div>`
}
let activeCivilizationUtilSymbolInput=null;
function insertCivilizationSymbolIntoInput(input,symbolId){
  if(!input||!symbolId)return;
  const token=civilizationSymbolToken(symbolId);
  const start=input.selectionStart??input.value.length;
  const end=input.selectionEnd??start;
  input.value=input.value.slice(0,start)+token+input.value.slice(end);
  const caret=start+token.length;
  input.focus();
  try{input.setSelectionRange(caret,caret)}catch{}
  input.dispatchEvent(new Event('input',{bubbles:true}))
}
function insertLanguageSymbolIntoInput(input,symbolId){
  insertCivilizationSymbolIntoInput(input,symbolId)
}

function symbolOptions(selected=''){
  return `<option value="">None / text symbol</option>`+civilizationSymbols.map(s=>
    `<option value="${s.id}" ${s.id===selected?'selected':''}>${E.esc(s.name)}</option>`
  ).join('')
}
function saveCivilizationSymbols(){
  localStorage.setItem('magicCivilizationSymbols',JSON.stringify(civilizationSymbols))
}
function utilitySubtypeLabel(t){
  return({
    language:'Language',currency:'Currency',disease:'Disease',calendar:'Calendar',
    measurement:'Measurement System',legalCode:'Legal Code',rankSystem:'Rank System',
    communication:'Communication System',naming:'Naming System'
  })[t]||'Civilization Utility'
}
function ensureExclusiveUtilityEdge(life,util){
  if(!life||!util)return;
  if(graphNodesLinked(life.id,util.id))return;
  edges.push({id:uid(),a:life.id,b:util.id,type:'civilizationUtility',linkType:'relationship',
    label:civilizationUtilityLinkLabel(util),direction:'forward',manual:true,strength:'solid',thickness:1.7})
}
// =====================================================================
function languagePreviewPhrase(nodeOrGroups){
  const groups=nodeOrGroups?.languageMappingGroups
    ?normalizeLanguageMappings(nodeOrGroups)
    :nodeOrGroups;
  if(!groups)return'No mappings yet';

  const wordPairs=groups.wordWord||[];
  const phrasePairs=groups.phrasePhrase||[];
  const symbolPairs=groups.symbolSymbol||[];
  const soundPairs=groups.symbolSound||[];

  const applySymbols=phrase=>{
    if(!symbolPairs.length)return phrase;
    const map=new Map(symbolPairs.map(p=>[String(p.from||''),String(p.to||'')]));
    return[...String(phrase||'')].map(ch=>map.get(ch)||map.get(ch.toUpperCase())||ch).join('')
  };

  if(wordPairs.length){
    const count=Math.min(6,Math.max(3,wordPairs.length));
    const words=[];
    for(let i=0;i<count;i++){
      const p=pick(wordPairs);
      words.push(p?.to||p?.from||'')
    }
    return applySymbols(words.join(' '))||'No mappings yet'
  }

  if(phrasePairs.length){
    const p=pick(phrasePairs);
    return applySymbols(p?.to||p?.from||'')||'No mappings yet'
  }

  if(symbolPairs.length){
    const pool=symbolPairs.map(p=>p.to||p.from).filter(Boolean);
    const chunks=[];
    const words=3+Math.floor(Math.random()*4);
    for(let w=0;w<words;w++){
      const len=2+Math.floor(Math.random()*5);
      let chunk='';
      for(let i=0;i<len;i++)chunk+=pick(pool);
      chunks.push(chunk)
    }
    return chunks.join(' ')
  }

  if(soundPairs.length){
    const pool=soundPairs.map(p=>p.to||p.from).filter(Boolean);
    const chunks=[];
    const words=3+Math.floor(Math.random()*4);
    for(let w=0;w<words;w++){
      const len=2+Math.floor(Math.random()*3);
      let chunk='';
      for(let i=0;i<len;i++)chunk+=pick(pool);
      chunks.push(chunk)
    }
    return chunks.join(' ')
  }

  return'No mappings yet'
}

function updateLanguagePreview(){
  const out=$('languagePreviewText');
  if(!out)return;
  out.innerHTML=renderCivilizationSymbolRichText(languagePreviewPhrase(collectLanguageMappingGroups()))
}

function normalizeLanguageMappings(node){
  const groups={
    symbolSymbol:[],
    symbolSound:[],
    wordWord:[],
    phrasePhrase:[]
  };

  if(node?.languageMappingGroups){
    for(const key of Object.keys(groups)){
      groups[key]=Array.isArray(node.languageMappingGroups[key])
        ?node.languageMappingGroups[key].map(x=>({...x}))
        :[]
    }
    return groups
  }

  // Backward compatibility with V22.0/V22.1 single mapping array.
  const mode=String(node?.languageMode||'Symbol → Symbol');
  const key=
    mode==='Symbol → Sound'?'symbolSound':
    mode==='Word → Word'?'wordWord':
    mode==='Phrase → Phrase'?'phrasePhrase':
    'symbolSymbol';

  groups[key]=(node?.languageMappings||[]).map(x=>({...x}));
  return groups
}

function languageMappingSection(key,title,subtitle,rows=[]){
  return `
    <div class="language-map-section" data-language-section="${key}">
      <div class="language-map-section-head">
        <div>
          <b>${E.esc(title)}</b>
          <small>${E.esc(subtitle)}</small>
        </div>
        <button type="button" class="language-add-row" data-language-add="${key}">＋</button>
      </div>
      <div class="language-map-rows">
        ${rows.map((r,i)=>languageMappingRow(key,r.from||'',r.to||'',i)).join('')}
      </div>
    </div>`
}

function languageMappingRow(key,from='',to='',index=0){
  return `
    <div class="language-map-row" data-language-row="${key}">
      <input class="language-map-from" value="${E.esc(from)}" placeholder="${
        key==='symbolSymbol'?'A':
        key==='symbolSound'?'Ж':
        key==='wordWord'?'Hello':'Long live the empire'
      }">
      <span>→</span>
      <input class="language-map-to" value="${E.esc(to)}" placeholder="${
        key==='symbolSymbol'?'⟁':
        key==='symbolSound'?'zh':
        key==='wordWord'?'Varakai':'Var an sol'
      }">
      <button type="button" class="language-remove-row" title="Remove">×</button>
    </div>`
}

function collectLanguageMappingGroups(){
  const groups={symbolSymbol:[],symbolSound:[],wordWord:[],phrasePhrase:[]};

  document.querySelectorAll('[data-language-section]').forEach(section=>{
    const key=section.dataset.languageSection;
    if(!groups[key])return;

    section.querySelectorAll('[data-language-row]').forEach(row=>{
      const from=row.querySelector('.language-map-from')?.value.trim()||'';
      const to=row.querySelector('.language-map-to')?.value.trim()||'';
      if(from||to)groups[key].push({from,to})
    })
  });

  return groups
}

function civilizationUtilDropTargets(editor){
  return [...editor.querySelectorAll(
    '.editor-grid input[type="text"],.editor-grid input:not([type]),.editor-grid textarea,.language-map-from,.language-map-to'
  )].filter(el=>el.id!=='eName')
}

function bindCivilizationSymbolDragDrop(editor){
  if(!editor)return;

  editor.querySelectorAll('[data-language-symbol]').forEach(btn=>{
    btn.draggable=true;

    btn.ondragstart=ev=>{
      const id=btn.dataset.languageSymbol;
      if(!id)return;
      ev.dataTransfer.effectAllowed='copy';
      ev.dataTransfer.setData('text/x-civ-symbol',id);
      ev.dataTransfer.setData('text/plain',civilizationSymbolToken(id));
      btn.classList.add('dragging-symbol')
    };

    btn.ondragend=()=>{
      btn.classList.remove('dragging-symbol');
      civilizationUtilDropTargets(editor).forEach(el=>el.classList.remove('symbol-drop-target'))
    }
  });

  civilizationUtilDropTargets(editor).forEach(input=>{
    input.ondragenter=ev=>{
      if(!ev.dataTransfer)return;
      ev.preventDefault();
      input.classList.add('symbol-drop-target')
    };

    input.ondragover=ev=>{
      ev.preventDefault();
      if(ev.dataTransfer)ev.dataTransfer.dropEffect='copy';
      input.classList.add('symbol-drop-target')
    };

    input.ondragleave=()=>{
      input.classList.remove('symbol-drop-target')
    };

    input.ondrop=ev=>{
      ev.preventDefault();
      input.classList.remove('symbol-drop-target');

      const id=
        ev.dataTransfer?.getData('text/x-civ-symbol')||
        '';

      if(id){
        activeCivilizationUtilSymbolInput=input;

        // Approximate the caret from current selection if browser doesn't
        // provide a text caret for input drops.
        input.focus();
        insertCivilizationSymbolIntoInput(input,id)
      }
    }
  })
}

function bindCivilizationUtilSymbolPalette(){
  const editor=$('editorModal');
  if(!editor)return;

  bindCivilizationSymbolDragDrop(editor);

  editor.querySelectorAll(
    '.editor-grid input[type="text"],.editor-grid input:not([type]),.editor-grid textarea'
  ).forEach(input=>{
    if(input.id==='eName')return;
    input.addEventListener('focus',()=>{activeCivilizationUtilSymbolInput=input});
    input.addEventListener('click',()=>{activeCivilizationUtilSymbolInput=input})
  });

  editor.querySelectorAll('[data-language-symbol]').forEach(btn=>{
    btn.onclick=()=>{
      let input=activeCivilizationUtilSymbolInput;

      // For Language default to mapping fields; for other utils use first
      // available text-capable utility field.
      if(!input){
        input=editor.querySelector(
          '.language-map-to,.language-map-from,#eCurrencySymbol,#eCurrencySubdivision,#eCurrencyBacking,#eDiseaseCure,#eDiseaseOrigin,#eUtilA,#eUtilB,#eUtilC,#eUtilD,#eDescription'
        )
      }
      insertCivilizationSymbolIntoInput(input,btn.dataset.languageSymbol)
    }
  });

  editor.querySelectorAll('.open-civ-symbol-library,#openLanguageSymbolLibrary').forEach(btn=>{
    btn.onclick=()=>{
      $('editorModal')?.classList.add('hidden');
      $('symbolLibraryModal')?.classList.remove('hidden');
      renderSymbolLibrary()
    }
  })
}

function bindLanguageMappingEditor(){
  $('regenerateLanguagePreview')?.addEventListener('click',updateLanguagePreview);

  document.querySelectorAll('.language-map-from,.language-map-to').forEach(input=>{
    input.onfocus=()=>{activeCivilizationUtilSymbolInput=input};
    input.onclick=()=>{activeCivilizationUtilSymbolInput=input};
    input.oninput=updateLanguagePreview
  });

  document.querySelectorAll('[data-language-symbol]').forEach(btn=>{
    btn.onclick=()=>{
      const input=activeCivilizationUtilSymbolInput
        ||document.querySelector('.language-map-to')
        ||document.querySelector('.language-map-from');
      insertCivilizationSymbolIntoInput(input,btn.dataset.languageSymbol)
    }
  });

  $('openLanguageSymbolLibrary')?.addEventListener('click',()=>{
    $('editorModal')?.classList.add('hidden');
    $('symbolLibraryModal')?.classList.remove('hidden');
    renderSymbolLibrary()
  });
  document.querySelectorAll('[data-language-add]').forEach(btn=>{
    btn.onclick=()=>{
      const key=btn.dataset.languageAdd;
      const section=document.querySelector(`[data-language-section="${key}"] .language-map-rows`);
      if(!section)return;
      section.insertAdjacentHTML('beforeend',languageMappingRow(key,'','',section.children.length));
      bindLanguageMappingEditor();
      bindCivilizationSymbolDragDrop($('editorModal'));
      updateLanguagePreview()
    }
  });

  document.querySelectorAll('.language-remove-row').forEach(btn=>{
    btn.onclick=()=>{
      btn.closest('.language-map-row')?.remove();
      updateLanguagePreview()
    }
  })
}

function editorDraft(){
  const type=editingType;
  if(!type)return null;
  const d={id:editingId||'__draft__',type,name:value('eName')||'New '+type};
  if(type==='spell')Object.assign(d,{spellClass:value('eClass')||'Unclassified',intent:value('eIntent'),structure:value('eStructure'),target:value('eTarget'),output:value('eOutput'),duration:value('eDuration'),range:value('eRange'),source:value('eSource')||'Mana',extra:value('eExtra')});
  else if(type==='rule')Object.assign(d,{spellClass:value('eRuleClass'),scope:value('eScope')||'All magic',spellIds:[...document.querySelectorAll('.rule-spell-check:checked')].map(x=>x.value)});
  else if(type==='civilizationUtil')Object.assign(d,{
    utilityType:value('eUtilityType')||'language',
    category:utilitySubtypeLabel(value('eUtilityType')||'language'),
    property:value('eDescription'),
    description:value('eDescription')
  });
  else if(type==='organization')Object.assign(d,{
    category:value('eOrganizationType'),
    organizationType:value('eOrganizationType'),
    organizationCustomType:value('eOrganizationCustomType'),
    property:value('eOrganizationPurpose'),
    organizationPurpose:value('eOrganizationPurpose'),
    organizationMembers:+value('eOrganizationMembers')||0,
    organizationCapital:value('eOrganizationCapital'),
    organizationResources:value('eOrganizationResources'),
    uses:value('eOrganizationResources'),
    description:value('eDescription')
  });
  else if(type==='place')Object.assign(d,{
    category:value('ePlaceType'),
    placeType:value('ePlaceType'),placeScale:value('ePlaceScale')||inferPlaceScale(value('ePlaceType')),
    composition:value('eInhabitants'),
    inhabitants:value('eInhabitants'),
    property:value('eGovernment'),
    government:value('eGovernment'),
    requirements:value('eAccess'),
    access:value('eAccess'),
    uses:value('eAssociations'),
    associations:value('eAssociations'),
    interaction:value('ePlaceInteraction'),
    description:value('eDescription')
  });
  else if(type!=='mana')Object.assign(d,{
    category:value('eCategory'),composition:value('eComposition'),property:value('eProperty'),
    requirements:value('eRequirements'),uses:value('eUses'),interaction:value('eInteraction'),
    description:value('eDescription'),
    sentient:type==='life'?!!$('eSentient')?.checked:undefined,
    main:type==='life'?!!$('eMainLife')?.checked:undefined,
    relationshipWithMain:type==='life'?+(value('eRelationshipMain')||0):undefined,
    individual:type==='life'?!!$('eIndividual')?.checked:undefined,
    individualMorality:type==='life'&&$('eIndividual')?.checked?+(value('eIndividualMorality')||0):undefined
  });
  return d;
}
function plannedTarget(id){return id==='mana'?byId('mana'):byId(id)}
function inferDraftConnections(){
  const d=editorDraft();if(!d||d.type==='mana')return [];
  const plan=[],add=(target,label,type='uses')=>{
    if(!target||target.id===editingId||plan.some(p=>p.targetId===target.id&&p.label===label))return;
    plan.push({targetId:target.id,label,type,direction:'forward'});
  };
  const mana=byId('mana');
  const mentionsMana=[d.uses,d.compatibility,d.requirements,d.composition,d.source].some(v=>fieldParts(v).includes('mana')||String(v||'').trim().toLowerCase()==='mana');
  if(d.type==='spell'||mentionsMana)add(mana,d.type==='spell'?'derived from Mana':'compatible with Mana',d.type==='spell'?'mana':'uses');

  if(d.type==='spell'){
    const cls=String(d.spellClass||'Unclassified').toLowerCase();
    for(const s of spells())if(s.id!==editingId&&String(s.spellClass||'Unclassified').toLowerCase()===cls)add(s,'same Spell Class: '+d.spellClass,'similar');
  }else if(d.type==='rule'){
    const hub=hubForName(d.spellClass)||hubForName(d.scope);
    if(hub)add(hub,'governs '+hub.name,'applies');
    else{
      const cp=classPointFor(d.spellClass);
      if(cp)add(cp,'governs entire Spell Class','applies');
      else for(const id of d.spellIds||[])add(byId(id),'governs selected spell','applies');
    }
  }else{
    const hub=hubForName(d.category)||hubForName(d.uses)||hubForName(d.compatibility);
    if(hub)add(hub,fieldParts(d.category).includes(String(hub.name).toLowerCase())?'category: '+hub.name:'compatible with '+hub.name,'hubmember');

    if(d.type==='place'){
      for(const p of ofType('place')){
        if(p.id===editingId)continue;
        const pname=String(p.name||'').trim().toLowerCase();
        const mentioned=[d.uses,d.associations,d.compatibility,d.description,d.interaction].some(v=>fieldParts(v).includes(pname)||String(v||'').toLowerCase().includes(pname));
        if(!mentioned)continue;
        const draftRank=PLACE_LEVELS.findIndex(([v])=>v===String(d.placeScale||inferPlaceScale(d.placeType)).toLowerCase());
        const targetRank=placeRank(p);
        if(draftRank>targetRank)add(p,'contains','contains');
        else if(targetRank>draftRank)add(p,'located in','contains');
      }
    }

    for(const n of nodes){
      if(n.id===editingId||n.type==='classPoint'||n.type==='mana'||n.isHub)continue;
      if(resourceRelation(d,n)||semanticScore(d,n)>=4)add(n,relationLabel(d,n),'related');
    }
  }
  return plan;
}
function connectionPlanSourceName(){
  return value('eName') || (editingId?byId(editingId)?.name:'New node') || 'New node';
}
function renderConnectionPlan(){
  const list=$('autoConnectionsList');if(!list)return;
  if(!pendingConnectionPlan)pendingConnectionPlan=inferDraftConnections();

  if(!pendingConnectionPlan.length){
    list.innerHTML='<div class="auto-empty">No automatic connections predicted from the current fields.</div>';
    return
  }

  const sourceName=connectionPlanSourceName();
  list.innerHTML=pendingConnectionPlan.map((p,i)=>{
    const target=plannedTarget(p.targetId);
    const targetName=target?.type==='classPoint'?(target.spellClass+' class'):(target?.name||'Missing target');
    return `<div class="auto-connection-card">
      <div class="auto-connection-sentence">
        <strong>${E.esc(sourceName)}</strong>
        <span>${E.esc(p.label||'related to')}</span>
        <strong>${E.esc(targetName)}</strong>
      </div>
      <div class="auto-connection-actions">
        <button class="danger auto-plan-delete" data-plan-delete="${i}">Delete</button>
        <button class="ghost auto-plan-edit" data-plan-edit="${i}">Edit</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-plan-delete]').forEach(el=>el.onclick=()=>{
    pendingConnectionPlan.splice(+el.dataset.planDelete,1);
    renderConnectionPlan();
  });
  list.querySelectorAll('[data-plan-edit]').forEach(el=>el.onclick=()=>openPlannedLinkEditor(+el.dataset.planEdit));
}
function openAutoConnections(){
  if(editingType==='mana')return;
  if(!pendingConnectionPlan)pendingConnectionPlan=inferDraftConnections();
  $('autoConnectionsPanel').classList.remove('hidden');
  renderConnectionPlan();
}

const PLACE_LEVELS=[['house','House'],['building','Building / Facility'],['settlement','Settlement'],['city','City'],['region','Region'],['country','Country'],['planet','Planet'],['star','Star'],['solar-system','Solar System'],['galaxy','Galaxy']];
function systemScale(){return byId('mana')?.systemScale||'planet'}
function systemScaleLabel(){return({planet:'Planet',solar:'Solar System',galaxy:'Galaxy',universe:'Universe'})[systemScale()]||'Planet'}
function maxPlaceLevel(){return({planet:'country',solar:'planet',galaxy:'solar-system',universe:'galaxy'})[systemScale()]||'country'}
const STAR_PRESETS={
  M:{core:'#ff8b68',outer:'#d94b37',glow:'#ff5a45',size:.65},
  K:{core:'#ffc078',outer:'#ee8b45',glow:'#ff9c52',size:.82},
  G:{core:'#fff0a0',outer:'#ffd36a',glow:'#ffb84d',size:1},
  F:{core:'#fff7d6',outer:'#f5e7b0',glow:'#e8e2bb',size:1.15},
  A:{core:'#f5f8ff',outer:'#d9e4ff',glow:'#cbdcff',size:1.35},
  B:{core:'#dbeaff',outer:'#a9c9ff',glow:'#8fb7ff',size:1.65},
  O:{core:'#cce2ff',outer:'#80afff',glow:'#6a9cff',size:2.15}
};
function applyStarPreset(prefix,preset){
  const p=STAR_PRESETS[preset];if(!p)return;
  const ids=prefix==='system'
    ?['eSystemStarColor','eSystemStarGlow']
    :['eStarColor','eStarColor2','eStarGlow'];
  if(prefix==='system'){
    $(ids[0]).value=p.core;$(ids[1]).value=p.glow;
  }else{
    $(ids[0]).value=p.core;$(ids[1]).value=p.outer;$(ids[2]).value=p.glow;
    if($('eStarSize'))$('eStarSize').value=String(p.size);
    if($('eStarSizeOut'))$('eStarSizeOut').textContent=p.size.toFixed(2)+'×';
  }
}
function isMoonPlace(place){
  return !!(place&&String(place.placeScale||inferPlaceScale(place.placeType))==='planet'&&place.isMoon)
}
function isGasGiantPlace(place){
  return !!(place&&String(place.placeScale||inferPlaceScale(place.placeType))==='planet'&&place.gasGiant)
}
function edgeTouchesMoonPlace(edge){
  if(!edge)return false;
  const a=byId(edge.a),b=byId(edge.b);

  return !!(
    (isMoonPlace(a)&&b?.type==='place') ||
    (isMoonPlace(b)&&a?.type==='place')
  )
}

function isLogicalEdge(edge){
  // ABSOLUTE RULE:
  // ANY edge touching a Moon is visual-only and contributes zero logic.
  return !!(
    edge &&
    !edge.blocked &&
    !isVisualOnlyEdge(edge) &&
    !edgeTouchesMoonPlace(edge)
  )
}

function isVisualOnlyEdge(edge){
  if(!edge)return false;

  // Only Place relationships touching a Moon are visual-only.
  // Moon -> Material/Life/Structure/Object/etc. remain real relationships.
  if(edgeTouchesMoonPlace(edge))return true;

  return !!(
    edge.visualOnly===true ||
    edge.rendererIgnore===true ||
    edge.simulationIgnore===true ||
    edge.autoConnectionIgnore===true ||
    edge.hierarchyIgnore===true
  )
}

function relationshipEdges(){
  return edges.filter(isLogicalEdge)
}

function isAutomaticOrbitEdge(edge,moonId=null){
  if(!edge||edge.blocked)return false;

  const isOrbit=
    edge.autoMoonOrbit===true ||
    String(edge.type||'').toLowerCase()==='orbiting' ||
    String(edge.label||'').trim().toLowerCase()==='orbiting';

  if(!isOrbit)return false;
  if(moonId==null)return true;

  return edge.a===moonId||edge.b===moonId
}

function moonOrbitEdge(moon){
  if(!moon)return null;

  return edges.find(e=>
    isAutomaticOrbitEdge(e,moon.id) &&
    (
      (e.a===moon.id&&byId(e.b)?.type==='place') ||
      (e.b===moon.id&&byId(e.a)?.type==='place')
    )
  )||null
}

function moonOrbitParentFromEdge(moon){
  const e=moonOrbitEdge(moon);
  if(!e)return null;

  const parentId=e.a===moon.id?e.b:e.a;
  return byId(parentId)||null
}

function syncMoonOrbitConnection(moon){
  if(!moon)return;

  edges=edges.filter(e=>!(
    e.autoMoonOrbit===true &&
    (e.a===moon.id||e.b===moon.id)
  ));

  if(!isMoonPlace(moon)||!moon.orbitingId)return;

  const parent=byId(moon.orbitingId);
  if(!parent||parent.type!=='place'||isStarSystemPlace(parent))return;

  edges.push({
    id:uid(),
    a:moon.id,
    b:parent.id,
    type:'visual-orbit',
    label:'Orbiting',
    direction:'forward',
    linkType:'visual',
    strength:'solid',
    thickness:1.8,
    manual:true,
    automatic:true,
    autoMoonOrbit:true,

    visualOnly:true,
    rendererIgnore:true,
    simulationIgnore:true,
    autoConnectionIgnore:true,
    hierarchyIgnore:true,
    placeContainment:false
  });

  normalizeMoonEdgesVisualOnly();

  if(typeof graph!=='undefined'){
    graph.setData(nodes,edges.filter(e=>!e.blocked))
  }
}

function moonOrbitParent(moon){
  if(!isMoonPlace(moon)||!moon.orbitingId)return null;

  const parent=byId(moon.orbitingId);
  if(
    !parent ||
    parent.type!=='place' ||
    isStarSystemPlace(parent)
  )return null;

  return parent
}
function moonsOrbiting(parent){
  if(!parent)return[];
  return ofType('place').filter(p=>isMoonPlace(p)&&p.orbitingId===parent.id)
}
function logicalEdgesForNode(node){
  if(!node)return[];
  return edges.filter(e=>
    isLogicalEdge(e) &&
    (e.a===node.id||e.b===node.id)
  )
}

function normalizeMoonEdgesVisualOnly(){
  for(const edge of edges){
    if(!edgeTouchesMoonPlace(edge))continue;

    edge.visualOnly=true;
    edge.rendererIgnore=true;
    edge.simulationIgnore=true;
    edge.autoConnectionIgnore=true;
    edge.hierarchyIgnore=true;
    edge.placeContainment=false;
  }
}

function ensureMoonOrbitConnections(){
  normalizeMoonEdgesVisualOnly();
  // This function only ensures the optional graph decoration exists.
  // It never determines Moon hierarchy.
  for(const moon of ofType('place').filter(isMoonPlace)){
    if(!moon.orbitingId)continue;

    const hasVisual=edges.some(e=>
      e.autoMoonOrbit===true &&
      e.visualOnly===true &&
      (
        (e.a===moon.id&&e.b===moon.orbitingId) ||
        (e.b===moon.id&&e.a===moon.orbitingId)
      )
    );

    if(!hasVisual)syncMoonOrbitConnection(moon)
  }
}

function isStarSystemPlace(node){
  return !!(
    node?.type==='place' &&
    String(node.placeScale||inferPlaceScale(node.placeType))==='solar-system'
  )
}

function moonHasIgnoredSystemLink(moon){
  if(!isMoonPlace(moon))return false;
  return edges.some(e=>
    !e.blocked &&
    isIgnoredMoonSystemLink(e) &&
    (e.a===moon.id||e.b===moon.id)
  )
}

function isIgnoredMoonSystemLink(edge){
  if(!edge||edge.blocked)return false;

  const a=byId(edge.a),b=byId(edge.b);
  if(!a||!b)return false;

  return(
    (isMoonPlace(a)&&isStarSystemPlace(b)) ||
    (isMoonPlace(b)&&isStarSystemPlace(a))
  )
}

function graphNodesLinkedForPhysicalHierarchy(aId,bId){
  return edges.some(e=>
    isLogicalEdge(e) &&
    ((e.a===aId&&e.b===bId)||(e.a===bId&&e.b===aId))
  )
}

function primaryPlanetsInSystem(system){
  if(!system)return[];

  return ofType('place').filter(p=>{
    if(isMoonPlace(p))return false;
    if(String(p.placeScale||inferPlaceScale(p.placeType))!=='planet')return false;

    // Physical primary membership only. A random semantic relationship does
    // not put a Planet into a Star System.
    return placeContains(system,p)
  })
}

function moonOrbitChainToSystem(moon,system){
  if(!isMoonPlace(moon)||!system)return false;

  const visited=new Set([moon.id]);
  let cur=moon,guard=0;

  while(cur&&guard++<24){
    const parent=moonOrbitParent(cur);
    if(!parent||visited.has(parent.id))return false;
    visited.add(parent.id);

    if(!isMoonPlace(parent)){
      return(
        String(parent.placeScale||inferPlaceScale(parent.placeType))==='planet' &&
        !isMoonPlace(parent) &&
        placeContains(system,parent)
      )
    }

    cur=parent
  }

  return false
}

function rendererMoonsForSystem(system){
  if(!system)return[];

  // This function never reads Moon <-> System links.
  // Only Orbiting -> Parent -> System is accepted.
  return ofType('place')
    .filter(isMoonPlace)
    .filter(moon=>moonOrbitChainToSystem(moon,system))
}

function safeSolarSystemBodies(system){
  return[
    ...primaryPlanetsInSystem(system),
    ...rendererMoonsForSystem(system)
  ]
}

function systemPlanetaryBodies(system){
  return safeSolarSystemBodies(system)
}
function moonSystem(moon){
  if(!isMoonPlace(moon))return null;

  const visited=new Set([moon.id]);
  let cur=moon,guard=0;

  while(cur&&guard++<24){
    const parent=moonOrbitParent(cur);
    if(!parent||visited.has(parent.id))return null;
    visited.add(parent.id);

    if(!isMoonPlace(parent)){
      if(String(parent.placeScale||inferPlaceScale(parent.placeType))!=='planet'){
        return null
      }

      return ofType('place').find(system=>
        isStarSystemPlace(system) &&
        placeContains(system,parent)
      )||null
    }

    cur=parent
  }

  return null
}

function containedStars(system){return system?directContainedPlaces(system).filter(p=>String(p.placeScale)==='star'):[]}
function containedPlanets(system){return systemPlanetaryBodies(system)}
function systemStars(system){
  if(!system)return [];
  const stars=containedStars(system);

  if(system.systemStarId){
    stars.sort((a,b)=>
      a.id===system.systemStarId?-1:
      b.id===system.systemStarId?1:0
    )
  }

  return stars
}

function systemStarRenderData(system){
  const stars=systemStars(system);

  if(!stars.length){
    return [{
      name:'Procedural Star',
      sourceId:null,
      preset:'G',
      color:STAR_PRESETS.G.core,
      color2:STAR_PRESETS.G.outer,
      glow:STAR_PRESETS.G.glow,
      size:1,
      authored:false,
      worldX:.5,
      worldY:.5,
      multiStarScale:1
    }]
  }

  const n=stars.length;

  // Visual scale is independent of the authored star's intrinsic size.
  // Multiple stars shrink enough to remain individually readable.
  const multiStarScale=
    n<=1?1:
    n===2?.62:
    n===3?.52:
    n===4?.46:
    Math.max(.32,.46-(n-4)*.025);

  return stars.map((star,i)=>{
    let dx=0,dy=0;

    if(n===2){
      // Wide binary pair. Their glow can overlap slightly, bodies cannot.
      const sign=i===0?-1:1;
      dx=.047*sign;
      dy=.010*sign
    }else if(n>2){
      // Larger ring than before, with radius growing gently by star count.
      const ring=.050+Math.min(.055,(n-3)*.009);
      const a=-Math.PI/2+i/n*Math.PI*2;
      dx=Math.cos(a)*ring;
      dy=Math.sin(a)*ring*.82
    }

    const p=STAR_PRESETS[star.starPreset||'G']||STAR_PRESETS.G;

    return{
      name:star.name,
      sourceId:star.id,
      preset:star.starPreset||'G',
      color:star.starColor||p.core,
      color2:star.starColor2||p.outer,
      glow:star.starGlow||p.glow,
      size:star.starSize||p.size,
      authored:true,
      worldX:.5+dx,
      worldY:.5+dy,
      multiStarScale
    }
  })
}

function createSystemAdditionalStar(system,index,data={}){
  if(!system)return null;

  const preset=data.preset||'G';
  const p=STAR_PRESETS[preset]||STAR_PRESETS.G;
  const a=Math.random()*Math.PI*2,d=220+Math.random()*180;

  const star={
    id:uid(),
    type:'place',
    name:data.name||`${system.name} ${String.fromCharCode(66+index)}`,
    placeType:'Star',
    placeScale:'star',
    x:Math.cos(a)*d,
    y:Math.sin(a)*d,
    vx:0,vy:0,r:16,
    starPreset:preset,
    starColor:data.color||p.core,
    starColor2:data.color2||p.outer,
    starGlow:data.glow||p.glow,
    starSize:Number(data.size)||p.size,
    category:'Star'
  };

  nodes.push(star);

  edges.push({
    id:uid(),
    a:system.id,
    b:star.id,
    type:'contains',
    linkType:'dependency',
    label:'contains',
    direction:'forward',
    manual:true,
    placeContainment:true
  });

  return star
}

function systemMainStar(system){
  if(!system)return null;
  const stars=containedStars(system);
  return byId(system.systemStarId)||stars[0]||null
}
function proceduralPlanetName(systemName,index){
  const base=String(systemName||'System').replace(/\s+(System|Star System)$/i,'').trim()||'System';
  return `${base} ${['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][index]||index+1}`;
}

function ensureSystemStar(system,starName,preset,core,glow){
  if(!system||!starName)return null;
  let star=systemMainStar(system);
  if(!star){
    const a=Math.random()*Math.PI*2,d=220+Math.random()*180;
    star={id:uid(),type:'place',name:starName,placeType:'Star',placeScale:'star',x:Math.cos(a)*d,y:Math.sin(a)*d,vx:0,vy:0,r:16};
    nodes.push(star);
  }
  const p=STAR_PRESETS[preset]||STAR_PRESETS.G;
  Object.assign(star,{
    name:starName,placeType:'Star',placeScale:'star',
    starPreset:preset||'G',
    starColor:core||p.core,
    starColor2:p.outer,
    starGlow:glow||p.glow,
    starSize:p.size,
    category:'Star'
  });
  system.systemStarId=star.id;
  if(!edges.some(e=>!e.blocked&&!isVisualOnlyEdge(e)&&((e.a===system.id&&e.b===star.id)||(e.a===star.id&&e.b===system.id))&&e.placeContainment)){
    edges.push({id:uid(),a:system.id,b:star.id,type:'contains',linkType:'dependency',label:'contains',direction:'forward',manual:true,placeContainment:true});
  }
  return star
}

function allowedPlaceLevels(){
  const max=maxPlaceLevel(),mi=PLACE_LEVELS.findIndex(x=>x[0]===max);
  return PLACE_LEVELS.slice(0,mi+1)
}
function placeScaleOptions(current=''){
  return allowedPlaceLevels().map(([v,l])=>`<option value="${v}" ${String(current).toLowerCase()===v?'selected':''}>${l}</option>`).join('');
}
function inferPlaceScale(text=''){
  const t=String(text).toLowerCase();
  if(/galaxy/.test(t))return 'galaxy';
  if(/solar|star system|system/.test(t))return 'solar-system';
  if(/star|sun|stellar/.test(t))return 'star';
  if(/moon|satellite/.test(t))return 'planet';
  if(/planet|world|gas giant/.test(t))return 'planet';
  if(/country|nation/.test(t))return 'country';
  if(/region|province|sector/.test(t))return 'region';
  if(/city|capital|metropolis/.test(t))return 'city';
  if(/settlement|village|town|colony|outpost/.test(t))return 'settlement';
  if(/house|home|residence/.test(t))return 'house';
  return 'building';
}

function placeLevelRank(p){const t=String(p?.placeScale||inferPlaceScale(p?.placeType||'')).toLowerCase(),i=PLACE_LEVELS.findIndex(x=>x[0]===t);return i<0?1:i}
function topLevelPlaces(){const rank=PLACE_LEVELS.findIndex(x=>x[0]===maxPlaceLevel());return ofType('place').filter(p=>placeLevelRank(p)>=Math.max(0,rank-1))}
function placesForMapScale(scale){
  const wanted=scale==='universe'?'galaxy':scale==='galaxy'?'solar-system':scale==='solar'?'planet':null;
  if(!wanted)return [];
  const contextItem=scaleNav.path.at(-1)?.item||null;
  const contextPlace=contextItem?.sourceId?byId(contextItem.sourceId):null;

  if(contextPlace){
    if(scale==='solar'&&isStarSystemPlace(contextPlace)){
      // Solar primary-body list is built explicitly and never sees Moons.
      return primaryPlanetsInSystem(contextPlace)
    }

    return effectiveContainedPlaces(contextPlace)
      .filter(p=>String(p.placeScale||inferPlaceScale(p.placeType||p.category||'')).toLowerCase()===wanted)
      .filter(p=>!(scale==='solar'&&isMoonPlace(p)));
  }

  if(contextItem?.softLocations?.length){
    return contextItem.softLocations.map(s=>byId(s.id)).filter(Boolean)
      .filter(p=>String(p.placeScale||inferPlaceScale(p.placeType||p.category||'')).toLowerCase()===wanted);
  }

  // If we're INSIDE a procedural map object, do not fall back to every
  // globally-unparented authored Place. That was causing one authored
  // Star System to appear inside every procedural Galaxy.
  if(contextItem)return [];

  // Root view only: show genuinely top-level authored Places.
  return ofType('place').filter(p=>{
    const ps=String(p.placeScale||inferPlaceScale(p.placeType||p.category||'')).toLowerCase();
    if(ps!==wanted)return false;

    if(ps==='solar-system'&&effectiveGalaxyParents(p).length)return false;

    return !ofType('place').some(parent=>placeContains(parent,p));
  });
}
function authoredPlaceParents(child){
  if(!child)return[];

  // Moon graph edges are always visual-only.
  if(isMoonPlace(child)){
    const parent=moonOrbitParent(child);
    return parent?[parent]:[]
  }

  const direct=ofType('place').filter(parent=>placeContains(parent,child));
  const scale=String(child.placeScale||inferPlaceScale(child.placeType));

  if(scale==='solar-system'){
    const inferred=effectiveGalaxyParents(child);
    return [...new Map([...direct,...inferred].map(p=>[p.id,p])).values()]
  }

  return direct
}
function hasAuthoredParentAtOrAbove(child,minRank){
  return authoredPlaceParents(child).some(parent=>placeRank(parent)>=minRank)
}
function unresolvedDescendantsForScale(scale){
  const contextItem=scaleNav.path.at(-1)?.item||null;
  const contextPlace=contextItem?.sourceId?byId(contextItem.sourceId):null;
  const expected=scale==='universe'?'galaxy':scale==='galaxy'?'solar-system':scale==='solar'?'planet':null;
  if(!expected)return [];
  const expectedRank=PLACE_LEVELS.findIndex(([v])=>v===expected);

  if(contextPlace){
    return effectiveContainedPlaces(contextPlace)
      .filter(child=>placeRank(child)>=0&&placeRank(child)<expectedRank)
      .filter(child=>!hasAuthoredParentAtOrAbove(child,expectedRank));
  }

  return (contextItem?.softLocations||[]).map(s=>byId(s.id)).filter(Boolean)
    .filter(child=>placeRank(child)>=0&&placeRank(child)<expectedRank)
    .filter(child=>!hasAuthoredParentAtOrAbove(child,expectedRank));
}


function openEditor(type,node=null){
  pendingConnectionPlan=null;editingId=node?.id||null;editingType=type;$('editorModal').classList.remove('hidden');$('createMenu').classList.add('hidden');$('editorKindLabel').textContent=node?'Edit':'Create';$('editorTitle').textContent=(node?'Edit ':creatingHub?'New Hub: ':'New ')+(type==='magicalObject'?'Magical Object':type[0].toUpperCase()+type.slice(1));
  const f=E.field.bind(E);let html='<div class="editor-grid">';
  if(type==='mana')html+=`<div class="editor-hint">Mana is the root source of this magical system. You can rename it and define what kind of magical energy it represents without removing its role as the central source.</div>`
    +f('Mana name','eName',node?.name||'MANA',false,'input','placeholder="e.g. Mana, Aggressive Mana, Aether, Arcane Current"')
    +f('Nature / behavior','eManaNature',node?.nature||'',true,'textarea','placeholder="e.g. Aggressive, volatile energy that amplifies forceful intent."')
    +f('Magical system scale','eSystemScale',['planet','solar','galaxy','universe'].map(v=>`<option value="${v}" ${(node?.systemScale||'planet')===v?'selected':''}>${({planet:'Planet',solar:'Solar System',galaxy:'Galaxy',universe:'Universe'})[v]}</option>`).join(''),false,'select')+f('Description','eDescription',node?.description||'',true,'textarea','placeholder="e.g. The fundamental magical energy permeating living things and enchanted matter."');
  else if(type==='spell')html+=`<div class="editor-hint">Spell Class is completely open-ended. Every field now has an example; they are suggestions, not restrictions. Spells with the exact same class automatically connect.</div>`
    +f('Name','eName',node?.name||'',false,'input','placeholder="e.g. Lumos, Ember Lance, Veilstep"')
    +f('Spell class','eClass',node?.spellClass||'',false,'input','placeholder="e.g. Charm, Ward, Transfiguration, Detection"')
    +f('Intent','eIntent',node?.intent||'',false,'input','placeholder="e.g. Illuminate, Reveal, Protect, Transform"')
    +f('Structure','eStructure',node?.structure||'',false,'input','placeholder="e.g. Beam, Radial, Touch, Field, Chain"')
    +f('Target','eTarget',node?.target||'',false,'input','placeholder="e.g. Self, Object, Creature, Area"')
    +f('Output','eOutput',node?.output||'',false,'input','placeholder="e.g. Light, Force, Heat, Information, Barrier"')
    +f('Duration','eDuration',node?.duration||'',false,'input','placeholder="e.g. Instant, 0.5 s, 1 minute, Sustained"')
    +f('Range','eRange',node?.range||'',false,'input','placeholder="e.g. Touch, 10 m, Line of sight, Room-wide"')
    +f('Source','eSource',node?.source||'Mana',false,'input','placeholder="e.g. Mana, Ambient magic, Stored crystal"')
    +`<label class="full morality-field">Good ↔ Bad
      <div class="morality-slider-shell">
        <input id="eMorality" class="morality-slider" type="range" min="-100" max="100" step="1" value="${node?.morality??0}">
      </div>
    </label>
    <div class="full morality-readout">
      <span>−100 BAD</span>
      <div class="morality-center">
        <b id="moralityValue">${(node?.morality??0)>0?'+':''}${node?.morality??0}</b>
        <small id="moralityLabel">${(node?.morality??0)<-50?'Dangerous':(node?.morality??0)<-15?'Harmful':(node?.morality??0)>50?'Highly beneficial':(node?.morality??0)>15?'Beneficial':'Neutral'}</small>
      </div>
      <span>+100 GOOD</span>
    </div>`
    +f('Extra attributes','eExtra',node?.extra||'',true,'textarea','placeholder="e.g. Silent; brighter near moonlight; cannot pass through silver"');
  else if(type==='rule')html+=`<div class="editor-hint">Rules can target specific spells, an exact Spell Class, or a broader scope. The examples show syntax understood by automatic connections.</div>`
    +f('Rule name','eName',node?.name||'',false,'input','placeholder="e.g. Law of Equivalent Change"')
    +f('Strength','eStrength',['Absolute','Strong','Flexible'].map(v=>`<option ${node?.strength===v?'selected':''}>${v}</option>`).join(''),false,'select','title="Example: Absolute = nearly unbreakable; Flexible = exceptions are common"')
    +f('Spell class','eRuleClass',node?.spellClass||'',false,'input','placeholder="e.g. Transfiguration (blank = broader rule)"')
    +f('Rule statement','eText',node?.text||'',true,'textarea','placeholder="e.g. Transfiguration cannot create living matter from nothing."')
    +f('Broad scope','eScope',node?.scope||'All magic',true,'input','placeholder="e.g. all magic, intent: Reveal, output: Fire, structure: Radial"')
    +E.spellChecks(spells(),node?.spellIds||[])
    +f('Exceptions','eExceptions',node?.exceptions||'',true,'textarea','placeholder="e.g. May be bypassed during an eclipse using Moonstone."');
  else if(type==='material'){
    html+=f('Name','eName',node?.name||'',false,'input')
      +f('Category','eCategory',node?.category||'',false,'input')
      +f('Composition','eComposition',node?.composition||'',true,'textarea')
      +f('Properties','eProperty',node?.property||'',true,'textarea')
      +f('Requirements','eRequirements',node?.requirements||'',true,'textarea')
      +f('Uses','eUses',node?.uses||'',true,'textarea')
      +f('Interaction','eInteraction',node?.interaction||'',true,'textarea')
      +f('Description','eDescription',node?.description||'',true,'textarea');
    const prices=new Map((node?.currencyPrices||[]).map(p=>[p.currencyId,p.amount]));
    html+=`<div class="full organization-rel-editor"><div class="organization-rel-head"><b>Currency Pricing</b><small>Assign this Material a price in any authored Currency.</small></div>
      ${civilizationUtils('currency').map(c=>`<div class="material-price-row"><label>${E.esc(c.name)}</label><input data-material-currency="${c.id}" type="number" min="0" step="0.01" value="${prices.get(c.id)??''}" placeholder="No price"><span>${E.esc(c.currencySymbol||'¤')}</span></div>`).join('')||'<div class="auto-empty">Create a Currency utility to price this material.</div>'}
    </div>`
  }
  else if(type==='civilizationUtil'){
    const subtype=node?.utilityType||window.__pendingCivilizationUtilType||'language';
    html+=f('Name','eName',node?.name||'',false,'input','placeholder="e.g. Vorian, Cuples, Frostlung"')
      +`<input id="eUtilityType" type="hidden" value="${E.esc(subtype)}">`
      +civilizationUtilSymbolPalette(
        subtype==='language'?'Custom Symbol Palette':'Civilization Symbol Palette',
        subtype==='language'
          ?'Click a symbol to insert it into the focused mapping field.'
          :'Focus any text field below, then click a saved symbol to insert it.'
      );

    if(subtype==='language'){
      const groups=normalizeLanguageMappings(node);
      html+=`<div class="editor-hint"><b>Language.</b> Link Life nodes to make them the exclusive natural speakers. Each translation type now has its own editor.</div>`
        +f('Writing direction','eLanguageDirection',
          ['Left → Right','Right → Left','Top → Bottom','Custom'].map(v=>`<option ${node?.languageDirection===v?'selected':''}>${v}</option>`).join(''),false,'select')
        +f('Primary reusable symbol','eUtilitySymbol',symbolOptions(node?.symbolId||''),false,'select')
        +`<div class="full language-map-editor">
          ${languageMappingSection('symbolSymbol','Symbol → Symbol','Map one written symbol to another.',groups.symbolSymbol)}
          ${languageMappingSection('symbolSound','Symbol → Sound','Define how written symbols are pronounced.',groups.symbolSound)}
          ${languageMappingSection('wordWord','Word → Word','Create vocabulary translations.',groups.wordWord)}
          ${languageMappingSection('phrasePhrase','Phrase → Phrase','Store idioms, fixed phrases, titles, and larger translations.',groups.phrasePhrase)}
        </div>`
        +`<div class="full language-preview-card">
          <div class="language-preview-head">
            <div>
              <b>Language Preview</b>
              <small>Random sample using your authored vocabulary and symbols.</small>
            </div>
            <button type="button" id="regenerateLanguagePreview">↻ New Phrase</button>
          </div>
          <div id="languagePreviewText" class="language-preview-text">${renderCivilizationSymbolRichText(languagePreviewPhrase(groups))}</div>
        </div>`
        +f('Description','eDescription',node?.description||'',true,'textarea');
    }else if(subtype==='currency'){
      html+=`<div class="editor-hint"><b>Currency.</b> Link Life/Organizations to restrict normal users. Materials can be priced in currencies.</div>`
        +f('Text symbol','eCurrencySymbol',node?.currencySymbol||'',false,'input','placeholder="e.g. C, ₡, IC"')
        +f('Reusable symbol','eUtilitySymbol',symbolOptions(node?.symbolId||''),false,'select')
        +f('USD equivalent','eCurrencyUsd',node?.usdEquivalent??1,false,'input','type="number" min="0" step="0.0001"')
        +f('Subdivision','eCurrencySubdivision',node?.currencySubdivision||'',false,'input','placeholder="e.g. 100 Chips = 1 Cuple"')
        +f('Form','eCurrencyForm',
          ['Physical','Digital','Magical','Mixed'].map(v=>`<option ${node?.currencyForm===v?'selected':''}>${v}</option>`).join(''),false,'select')
        +f('Stability','eCurrencyStability',
          ['Stable','Floating','Volatile','Fixed'].map(v=>`<option ${node?.currencyStability===v?'selected':''}>${v}</option>`).join(''),false,'select')
        +f('Backing','eCurrencyBacking',node?.currencyBacking||'',false,'input','placeholder="None, government, Moonstone, magic..."')
        +f('Description','eDescription',node?.description||'',true,'textarea');
    }else if(subtype==='disease'){
      html+=`<div class="editor-hint"><b>Disease.</b> Linked Life nodes become the explicitly susceptible species.</div>`
        +f('Spread','eDiseaseSpread',['Low','Moderate','High','Extreme'].map(v=>`<option ${node?.diseaseSpread===v?'selected':''}>${v}</option>`).join(''),false,'select')
        +f('Severity','eDiseaseSeverity',['Mild','Moderate','Serious','Severe'].map(v=>`<option ${node?.diseaseSeverity===v?'selected':''}>${v}</option>`).join(''),false,'select')
        +f('Duration','eDiseaseDuration',['Short','Medium','Long','Chronic'].map(v=>`<option ${node?.diseaseDuration===v?'selected':''}>${v}</option>`).join(''),false,'select')
        +f('Mortality %','eDiseaseMortality',node?.diseaseMortality??10,false,'input','type="number" min="0" max="100" step="1"')
        +f('Known cure / treatment','eDiseaseCure',node?.diseaseCure||'',false,'input','placeholder="Object, Material, Technique..."')
        +f('Origin','eDiseaseOrigin',node?.diseaseOrigin||'',false,'input','placeholder="Place or region"')
        +f('Description','eDescription',node?.description||'',true,'textarea');
    }else if(subtype==='calendar'){
      html+=`<div class="editor-hint"><b>Calendar.</b> Define how a civilization names and divides time.</div>`
        +f('Days per year','eUtilA',node?.calendarDays??365,false,'input','type="number" min="1"')
        +f('Months / divisions','eUtilB',node?.calendarMonths||'',true,'textarea','placeholder="Dawnmonth, Embermonth, Frostmonth..."')
        +f('Era name','eUtilC',node?.calendarEra||'',false,'input','placeholder="e.g. After Founding"')
        +f('Holidays','eUtilD',node?.calendarHolidays||'',true,'textarea','placeholder="Festival of Stars; Founding Day..."')
        +f('Description','eDescription',node?.description||'',true,'textarea');
    }else if(subtype==='measurement'){
      html+=`<div class="editor-hint"><b>Measurement System.</b> Define reusable civilization units.</div>`
        +f('Distance units','eUtilA',node?.measurementDistance||'',true,'textarea','placeholder="1 span = 0.8 m"')
        +f('Mass units','eUtilB',node?.measurementMass||'',true,'textarea','placeholder="1 stone = 2.4 kg"')
        +f('Temperature units','eUtilC',node?.measurementTemperature||'',true,'textarea')
        +f('Description','eDescription',node?.description||'',true,'textarea');
    }else if(subtype==='legalCode'){
      html+=`<div class="editor-hint"><b>Legal Code.</b> Laws can later create arrests, reforms, disputes, and political events.</div>`
        +f('Core laws','eUtilA',node?.legalLaws||'',true,'textarea','placeholder="Unauthorized magic is prohibited..."')
        +f('Rights / protections','eUtilB',node?.legalRights||'',true,'textarea')
        +f('Enforcement','eUtilC',node?.legalEnforcement||'',true,'textarea')
        +f('Description','eDescription',node?.description||'',true,'textarea');
    }else if(subtype==='rankSystem'){
      html+=`<div class="editor-hint"><b>Rank System.</b> Define ordered ranks used by linked Life or Organizations.</div>`
        +f('Ranks low → high','eUtilA',node?.rankEntries||'',true,'textarea','placeholder="Initiate\nAdept\nMaster\nGrandmaster"')
        +f('Promotion rule','eUtilB',node?.rankPromotion||'',true,'textarea')
        +f('Description','eDescription',node?.description||'',true,'textarea');
    }else if(subtype==='communication'){
      html+=`<div class="editor-hint"><b>Communication System.</b> Postal, magical, electronic, or interstellar communication.</div>`
        +f('Medium','eUtilA',node?.communicationMedium||'',false,'input','placeholder="Radio, enchanted mirrors, hyperspace relay..."')
        +f('Range','eUtilB',node?.communicationRange||'',false,'input')
        +f('Latency','eUtilC',node?.communicationLatency||'',false,'input','placeholder="Instant, 3 hours/system..."')
        +f('Description','eDescription',node?.description||'',true,'textarea');
    }else{
      html+=`<div class="editor-hint"><b>Naming System.</b> Define naming conventions used by linked Life and cultures.</div>`
        +f('Given-name patterns','eUtilA',node?.namingGiven||'',true,'textarea')
        +f('Family/title patterns','eUtilB',node?.namingFamily||'',true,'textarea')
        +f('Examples','eUtilC',node?.namingExamples||'',true,'textarea')
        +f('Description','eDescription',node?.description||'',true,'textarea');
    }

    const linked=node?linkedLifeForUtility(node):[];
    html+=`<div class="full organization-rel-editor"><div class="organization-rel-head"><b>Exclusive Life Access</b><small>If at least one Life node is linked, only linked Life naturally ${subtype==='language'?'speaks this language':subtype==='currency'?'uses this currency':subtype==='disease'?'is susceptible to this disease':'uses this civilization utility'}.</small></div>
      ${ofType('life').map(l=>`<label class="life-check"><input class="utility-life-check" value="${l.id}" type="checkbox" ${linked.some(x=>x.id===l.id)?'checked':''}><span><b>${E.esc(l.name)}</b><small>${civilizationUtilityLinkLabel({utilityType:subtype})}</small></span></label>`).join('')||'<div class="auto-empty">No Life nodes yet.</div>'}
    </div>`
  }
  else if(type==='organization'){
    const orgTypes=[
      'Empire','Kingdom','Republic','Government','Guild','Company',
      'Order','Alliance','Federation','Tribe','Rebel Group',
      'Research Organization','Religious Organization','Custom'
    ];
    html+=`<div class="editor-hint">Organizations are simulated political/social entities. They can control Places and develop relationships with other Organizations.</div>`
      +f('Organization name','eName',node?.name||'',false,'input','placeholder="e.g. Galactic Empire, Auror Office, Moonstone Guild"')
      +f('Organization type','eOrganizationType',
        orgTypes.map(v=>`<option ${node?.organizationType===v?'selected':''}>${v}</option>`).join(''),
        false,'select')
      +f('Custom type','eOrganizationCustomType',node?.organizationCustomType||'',false,'input','placeholder="e.g. Mage Banking Syndicate"')
      +f('Ideology / purpose','eOrganizationPurpose',node?.organizationPurpose||node?.property||'',true,'textarea','placeholder="e.g. Centralize galactic authority; regulate magic; control trade"')
      +f('Members / population','eOrganizationMembers',node?.organizationMembers??1000,false,'input','type="number" min="0" step="1"')
      +f('Capital / headquarters','eOrganizationCapital',node?.organizationCapital||'',false,'input','placeholder="e.g. Coruscant, Ministry Tower"')
      +f('Resources / exports','eOrganizationResources',node?.organizationResources||'',true,'textarea','placeholder="e.g. Kyber crystals; enchanted machinery; food"')
      +f('Description','eDescription',node?.description||'',true,'textarea','placeholder="e.g. A centralized interstellar government controlling hundreds of systems."');

    const others=organizations().filter(o=>o.id!==node?.id);
    html+=`<div class="full organization-rel-editor">
      <div class="organization-rel-head"><b>Organization Relationships</b><small>Negative relationships trend toward conflict; positive relationships create trade and gifts.</small></div>
      ${others.length?others.map(other=>{
        const existing=node?organizationRelationshipsFor(node).find(r=>r.other.id===other.id):null;
        const v=existing?.value??0;
        return`<div class="organization-rel-row" data-org-rel="${other.id}">
          <div><strong>${E.esc(other.name)}</strong><small class="org-rel-word">${organizationRelationshipLabel(v)}</small></div>
          <input class="org-rel-slider" type="range" min="-100" max="100" step="1" value="${v}">
          <output>${v>0?'+':''}${v}</output>
        </div>`
      }).join(''):'<div class="auto-empty">Create another Organization to define diplomatic relationships.</div>'}
    </div>`
  }
  else if(type==='place')html+=`<div class="editor-hint">Places are physical or magical locations in the setting. Referencing existing Life, Structures, Materials, spells, or other nodes by name helps automatic connections understand what belongs here.</div>`
    +f('Place name','eName',node?.name||'',false,'input','placeholder="e.g. Hogwarts, Diagon Alley, Goblin Settlement, Forbidden Forest"')
    +f('Place type','ePlaceType',node?.placeType||node?.category||'',false,'input','placeholder="e.g. Jedi Temple, City, Mine, Fortress, School, Trade Port"')
    +f('Place scale','ePlaceScale',placeScaleOptions(node?.placeScale||inferPlaceScale(node?.placeType||node?.category||'')),false,'select')

    +f('Owner / faction','eOwnerFaction',
      '<option value="">Unclaimed / none</option>'+
      politicalFactions().map(f=>`<option value="${f.id}" ${node?.ownerFactionId===f.id?'selected':''}>${E.esc(f.name)}</option>`).join(''),
      false,'select')
    +f('Inhabitants','eInhabitants',node?.inhabitants||node?.composition||'',true,'textarea','placeholder="e.g. Wizards; Goblins; Students; Moonharts"')
    +f('Government / owner / authority','eGovernment',node?.government||node?.property||'',true,'textarea','placeholder="e.g. Ministry of Magic; Headmaster; Goblin Council"')
    +f('Access / requirements','eAccess',node?.access||node?.requirements||'',true,'textarea','placeholder="e.g. Hidden from non-magical people; requires a Portkey; open to citizens"')
    +f('Associated nodes, spells, classes, materials, or others','eAssociations',node?.associations||node?.uses||'',true,'textarea','placeholder="e.g. Transfiguration; Moonstone; Wizard; Ministry of Magic"')
    +f('Local rules / interactions','ePlaceInteraction',node?.interaction||'',true,'textarea','placeholder="e.g. Apparition is blocked inside the grounds; magic is unstable near the ruins"')
    +f('Description','eDescription',node?.description||'',true,'textarea','placeholder="e.g. A large magical school built around an ancient castle."');
  else {
    const ex={
      material:['e.g. Moonstone','e.g. Crystal, Metal, Organic, Alchemical','e.g. Crystallized mana + lunar dust','e.g. Stores light magic and resists heat','e.g. Must be refined under moonlight','e.g. Wands; Detection spells; Moonlight Charm','e.g. Becomes brittle near null-magic fields','e.g. A pale crystal used in precision magical instruments.'],
      magicalObject:['e.g. Ashwood Wand','e.g. Wand, Focus, Artifact, Device','e.g. Ashwood + Moonstone core','e.g. Focuses directional charms','e.g. Requires a bonded caster','e.g. Charm; Detection; Lumos','e.g. Loses accuracy when cracked','e.g. A lightweight focus designed for precise spell shaping.'],
      technique:['e.g. Silent Casting','e.g. Casting Method, Movement, Meditation','e.g. Breath control + wand tracing','e.g. Casts without an incantation','e.g. Principle of Intent; advanced concentration','e.g. Charm; Ward; Detection','e.g. Harder with complex radial spells','e.g. A discipline that substitutes focused intent for spoken words.'],
            structure:['e.g. Ministry of Arcane Affairs','e.g. Government, Academy, Guild, Order','e.g. Departments + licensed magical staff','e.g. Regulates magical practice and investigates misuse','e.g. Requires legal authority and trained practitioners','e.g. Law; Detection; Magical Objects','e.g. Political pressure can limit its authority','e.g. A public institution formed to manage magic in society.'],
      life:['e.g. Emberwing','e.g. Magical Creature, Plant, Spirit, Humanoid','e.g. Living tissue + innate fire mana','e.g. Naturally produces controlled magical heat','e.g. Requires warm mana-rich habitats','e.g. Fire magic; Healing; Creature Care','e.g. Sensitive to null-magic environments','e.g. A magical species whose biology directly channels mana.'],
      principle:['e.g. Principle of Resonance','e.g. Fundamental Law, Theory, Metaphysics','e.g. Mana frequency + sympathetic links','e.g. Similar magical patterns reinforce one another','e.g. Requires stable mana flow','e.g. Resonance Technique; Crystal tools; Charm','e.g. Opposing frequencies can cancel the effect','e.g. A theory explaining how magical patterns interact.']
    }[type]||['e.g. Arcane Construct','e.g. Arcane','e.g. Mana + crystal','e.g. Channels magic','e.g. Requires Mana','e.g. Charm','e.g. Weakened by anti-magic','e.g. Describe its role.'];
    html+=`<div class="editor-hint">These fields can reference other nodes by name. Example: a Tool whose composition says <b>Moonstone</b> can automatically connect to a Material named Moonstone.</div>`
      +f(type[0].toUpperCase()+type.slice(1)+' name','eName',node?.name||'',false,'input',`placeholder="${ex[0]}"`)
      +f('Category','eCategory',node?.category||'',false,'input',`placeholder="${ex[1]}"`)
      +f('Composition / components','eComposition',node?.composition||'',true,'textarea',`placeholder="${ex[2]}"`)
      +f('Function / property','eProperty',node?.property||'',true,'textarea',`placeholder="${ex[3]}"`)
      +f('Requirements','eRequirements',node?.requirements||'',true,'textarea',`placeholder="${ex[4]}"`)
      +f('Compatible nodes, spells, classes, or others on this graph','eUses',node?.uses||'',true,'textarea',`placeholder="${ex[5]}"`)
      +f('Limitations / interactions','eInteraction',node?.interaction||'',true,'textarea',`placeholder="${ex[6]}"`)
      +f('Description','eDescription',node?.description||'',true,'textarea',`placeholder="${ex[7]}"`);
    if(type==='structure')html+=`
      <label class="full life-check mega-structure-check">
        <input id="eIsMegastructure" type="checkbox" ${node?.isMegastructure?'checked':''}>
        <span><b>Megastructure</b><small>Give this Structure a physical civilization-scale appearance, from planetary construction up to galactic engineering.</small></span>
      </label>`;
    if(type==='magicalObject')html+=`
      <label class="full life-check tech-object-check"><input id="eTechnological" type="checkbox" ${node?.technological?'checked':''}>
        <span><b>Technological</b><small>Add this Magical Object to the Technology Tree and technological history. It can become part of civilization research and advancement.</small></span>
      </label>`;
    if(type==='life')html+=`
      <div class="full life-role-editor">
        <div class="life-role-title">Civilization role</div>
        <label class="life-check"><input id="eSentient" type="checkbox" ${node?.sentient?'checked':''}><span><b>Sentient</b><small>Can reason, organize, communicate, form settlements, alliances, governments, raids, or wars.</small></span></label>
        <label class="life-check"><input id="eMainLife" type="checkbox" ${node?.main?'checked':''}><span><b>Main</b><small>A dominant / controlling civilization-building creature in this world. Main automatically means Sentient. Multiple Main species are allowed.</small></span></label>
        <label class="life-check"><input id="eIndividual" type="checkbox" ${node?.individual?'checked':''}><span><b>Individual</b><small>This node represents one specific person or unique creature rather than a whole species. Useful for famous people, rulers, inventors, heroes, historical figures, or singular beings.</small></span></label>
        <div id="individualMoralityWrap" class="life-relationship-wrap ${node?.individual?'':'hidden'}">
          <div class="relationship-slider-head"><b>Individual Morality</b><output id="eIndividualMoralityOut">${Number.isFinite(node?.individualMorality)?(node.individualMorality>0?'+':'')+node.individualMorality:'0'}</output></div>
          <input id="eIndividualMorality" class="relationship-slider" type="range" min="-100" max="100" step="1" value="${Number.isFinite(node?.individualMorality)?node.individualMorality:0}">
          <small>-100 = extremely evil · 0 = morally mixed · +100 = extremely good. This biases behavior rather than absolutely controlling it.</small>
        </div>
        <div id="lifeRelationshipWrap" class="life-relationship-wrap">
          <div class="relationship-slider-head"><b>Relationship with Main</b><output id="eRelationshipMainOut">${Number.isFinite(node?.relationshipWithMain)?node.relationshipWithMain:0}</output></div>
          <input id="eRelationshipMain" class="relationship-slider" type="range" min="-100" max="100" step="1" value="${Number.isFinite(node?.relationshipWithMain)?node.relationshipWithMain:0}">
          <small id="eRelationshipMainText">Neutral / mixed relations with the Main civilization.</small>
        </div>
      </div>`;
  }
  // Existing nodes can be promoted/demoted without recreating them.
  // V20.6c uses a compact vertical snap slider on the LEFT of the editor.
  if(node&&type!=='mana'&&!node.virtual){
    const role=nodeHubRole(node);
    html+=`
      <div id="hubRoleRail" class="hub-role-rail" data-role="${role}">
        <div class="hub-role-rail-label hub-label">Hub</div>
        <div class="hub-role-track">
          <button type="button" class="hub-role-stop stop-hub" data-hub-role="hub" aria-label="Hub"></button>
          <button type="button" class="hub-role-stop stop-semi" data-hub-role="semi" aria-label="Semi-Hub"></button>
          <button type="button" class="hub-role-stop stop-normal" data-hub-role="normal" aria-label="Node"></button>
          <div id="hubRoleThumb" class="hub-role-thumb" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${role==='hub'?2:role==='semi'?1:0}" aria-label="Node role"></div>
        </div>
        <div class="hub-role-rail-label semi-label">Semi-Hub</div>
        <div class="hub-role-rail-label node-label">Node</div>
        <input id="eHubRole" type="hidden" value="${role}">
      </div>`;
  }

  $('editorBody').innerHTML=html+'</div>' 
  $('autoConnectionsPanel').classList.add('hidden');
  if(type==='civilizationUtil'){
    bindCivilizationUtilSymbolPalette();
    if((node?.utilityType||window.__pendingCivilizationUtilType)==='language'){
      bindLanguageMappingEditor()
    }
  }
  $('previewAutoConnections').classList.toggle('hidden',type==='mana');

  if($('eHubRole')&&$('hubRoleRail')){
    const rail=$('hubRoleRail');
    const thumb=$('hubRoleThumb');
    const hidden=$('eHubRole');

    const roleOrder=['normal','semi','hub'];
    const roleIndex=role=>Math.max(0,roleOrder.indexOf(role));

    let currentRole=hidden.value||'normal';
    let dragging=false;
    let dragPointerId=null;

    const clickAudio=new Audio('assets/sounds/hub-role-click.mp3');
    clickAudio.preload='auto';
    clickAudio.volume=.38;

    const playHubRoleClick=()=>{
      try{
        clickAudio.currentTime=0;
        clickAudio.play().catch(()=>{})
      }catch(_){}
    };

    const applyHubRoleVisual=(role,playSound=false)=>{
      if(!roleOrder.includes(role))role='normal';
      const changed=role!==currentRole;

      currentRole=role;
      hidden.value=role;

      // The role attribute is the authoritative resting position.
      // Set it before removing the temporary drag coordinate.
      rail.dataset.role=role;

      const idx=roleIndex(role);
      thumb.setAttribute('aria-valuenow',String(idx));
      thumb.setAttribute('aria-valuetext',role==='hub'?'Hub':role==='semi'?'Semi-Hub':'Node');

      rail.querySelectorAll('[data-hub-role]').forEach(stop=>{
        stop.classList.toggle('active',stop.dataset.hubRole===role)
      });

      // Only now return control of the thumb position to CSS.
      rail.style.removeProperty('--hub-role-drag-y');

      if(changed&&playSound)playHubRoleClick()
    };

    const pointerTrackInfo=clientY=>{
      const track=rail.querySelector('.hub-role-track');
      const r=track.getBoundingClientRect();
      const y=Math.max(7,Math.min(r.height-7,clientY-r.top));
      const t=(y-7)/Math.max(1,r.height-14);
      return{track,r,y,t}
    };

    const roleFromT=t=>{
      // top = Hub, middle = Semi-Hub, bottom = Node
      if(t<.25)return'hub';
      if(t<.75)return'semi';
      return'normal'
    };

    const updateDragThumb=clientY=>{
      const {y,t}=pointerTrackInfo(clientY);

      // Follow the pointer continuously while dragging.
      rail.style.setProperty('--hub-role-drag-y',`${y}px`);
      const role=roleFromT(t);

      // Update active tier while crossing thresholds.
      if(role!==currentRole){
        currentRole=role;
        hidden.value=role;
        const idx=roleIndex(role);
        thumb.setAttribute('aria-valuenow',String(idx));
        thumb.setAttribute('aria-valuetext',role==='hub'?'Hub':role==='semi'?'Semi-Hub':'Node');
        rail.querySelectorAll('[data-hub-role]').forEach(stop=>{
          stop.classList.toggle('active',stop.dataset.hubRole===role)
        });
        playHubRoleClick()
      }
    };

    const snapFromClientY=clientY=>{
      const {t}=pointerTrackInfo(clientY);
      applyHubRoleVisual(roleFromT(t),false)
    };

    rail.querySelectorAll('[data-hub-role]').forEach(stop=>{
      stop.addEventListener('click',e=>{
        e.preventDefault();
        applyHubRoleVisual(stop.dataset.hubRole,true)
      })
    });

    thumb.addEventListener('pointerdown',e=>{
      e.preventDefault();
      dragging=true;
      dragPointerId=e.pointerId;
      thumb.setPointerCapture?.(e.pointerId);
      rail.classList.add('dragging');
      updateDragThumb(e.clientY)
    });

    thumb.addEventListener('pointermove',e=>{
      if(!dragging||e.pointerId!==dragPointerId)return;
      updateDragThumb(e.clientY)
    });

    const finishHubDrag=e=>{
      if(!dragging)return;
      if(e?.pointerId!=null&&dragPointerId!=null&&e.pointerId!==dragPointerId)return;

      // Resolve the final tier while the pointer coordinate is still valid.
      const {t}=pointerTrackInfo(e.clientY);
      const finalRole=roleFromT(t);

      dragging=false;
      rail.classList.remove('dragging');

      // This sets data-role, which becomes the permanent resting position.
      applyHubRoleVisual(finalRole,false);

      thumb.releasePointerCapture?.(dragPointerId);
      dragPointerId=null
    };

    thumb.addEventListener('pointerup',finishHubDrag);
    thumb.addEventListener('pointercancel',e=>{
      if(!dragging)return;

      dragging=false;
      rail.classList.remove('dragging');

      // Return to whatever tier was active when cancellation occurred.
      applyHubRoleVisual(currentRole,false);

      thumb.releasePointerCapture?.(dragPointerId);
      dragPointerId=null
    });

    // Clicking anywhere on the track snaps directly to the nearest tier.
    rail.querySelector('.hub-role-track').addEventListener('pointerdown',e=>{
      if(e.target===thumb)return;
      const {t}=pointerTrackInfo(e.clientY);
      applyHubRoleVisual(roleFromT(t),true)
    });

    // Keyboard accessibility: Up = promote, Down = demote.
    thumb.addEventListener('keydown',e=>{
      if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
      e.preventDefault();
      let idx=roleIndex(currentRole);
      if(e.key==='ArrowUp')idx=Math.min(2,idx+1);
      if(e.key==='ArrowDown')idx=Math.max(0,idx-1);
      if(e.key==='Home')idx=0;
      if(e.key==='End')idx=2;
      applyHubRoleVisual(roleOrder[idx],true)
    });

    applyHubRoleVisual(currentRole,false)
  }

  if(type==='organization'){
    document.querySelectorAll('.organization-rel-row').forEach(row=>{
      const slider=row.querySelector('.org-rel-slider');
      const out=row.querySelector('output');
      const word=row.querySelector('.org-rel-word');
      const refresh=()=>{
        const v=+slider.value||0;
        out.textContent=(v>0?'+':'')+v;
        word.textContent=organizationRelationshipLabel(v);
        row.style.setProperty('--rel-color',organizationRelationColor(v))
      };
      slider.addEventListener('input',refresh);
      refresh()
    })
  }

  if(type==='place'){
    const sel=$('ePlaceScale'),planetPanel=$('planetPalettePanel'),systemPanel=$('solarSystemEditorPanel'),starPanel=$('starEditorPanel');
    const land=$('ePlanetLandCoverage'),ocean=$('ePlanetOceanCoverage');
    const landOut=$('ePlanetLandCoverageOut'),oceanOut=$('ePlanetOceanCoverageOut');

    const setPalette=(n)=>{
      $('ePlanetLandColor').value=n?.planetLandColor||'#5d8f5a';
      $('ePlanetLandColor2').value=n?.planetLandColor2||'#78915b';
      $('ePlanetLandColor3').value=n?.planetLandColor3||'#8d8655';
      $('ePlanetOceanColor').value=n?.planetOceanColor||'#315f9f';
      $('ePlanetOceanColor2').value=n?.planetOceanColor2||'#102f58';
      $('ePlanetIsMoon').checked=!!n?.isMoon;
      $('ePlanetGasGiant').checked=!!n?.gasGiant;
      $('ePlanetGasColor').value=n?.planetGasColor||'#d6b783';
      $('ePlanetGasColor2').value=n?.planetGasColor2||'#a87a58';
      $('ePlanetGasColor3').value=n?.planetGasColor3||'#eee0b5';
      $('ePlanetGasContrast').value=String(n?.planetGasContrast??55);
      $('ePlanetGasContrastOut').textContent=$('ePlanetGasContrast').value+'%';
      const coverage=Number.isFinite(+n?.planetLandCoverage)?+n.planetLandCoverage:45;
      land.value=String(coverage);ocean.value=String(100-coverage);
      $('ePlanetLandEnabled').checked=n?.planetLandEnabled!==false;
      $('ePlanetOceanEnabled').checked=n?.planetOceanEnabled!==false;
      $('ePlanetCloudsEnabled').checked=n?.planetCloudsEnabled!==false;
      $('ePlanetCloudColor').value=n?.planetCloudColor||'#eef8ff';
      $('ePlanetCloudCoverage').value=String(n?.planetCloudCoverage??45);
      $('ePlanetCloudOpacity').value=String(n?.planetCloudOpacity??38);
      $('ePlanetCloudCoverageOut').textContent=$('ePlanetCloudCoverage').value+'%';
      $('ePlanetCloudOpacityOut').textContent=$('ePlanetCloudOpacity').value+'%';
    };
    const syncCoverage=(source)=>{
      if(source==='land')ocean.value=String(100-(+land.value||0));
      else land.value=String(100-(+ocean.value||0));
      landOut.textContent=land.value+'%';oceanOut.textContent=ocean.value+'%';
    };
    const renderSystemMembers=(n)=>{
      const candidates=ofType('place').filter(p=>
        p.id!==n?.id &&
        ['planet','star'].includes(String(p.placeScale)) &&
        !isMoonPlace(p)
      );
      const contained=new Set(n?directContainedPlaces(n).map(p=>p.id):[]);
      $('systemMemberList').innerHTML=candidates.length?candidates.map(p=>`
        <label class="system-member-row">
          <input class="system-member-check" type="checkbox" value="${p.id}" ${contained.has(p.id)?'checked':''}>
          <span><b>${E.esc(p.name)}</b><small>${p.isMoon?'Moon':E.esc(systemScaleLabel(p.placeScale==='star'?'solar':p.placeScale))} · ${p.gasGiant?'Gas Giant':E.esc(p.placeScale)}</small></span>
        </label>`).join(''):'<div class="auto-empty">No Planet or Star Place nodes exist yet.</div>';
    };
    const renderAdditionalStars=(n)=>{
      const stars=systemStars(n).slice(1);

      $('systemAdditionalStars').innerHTML=stars.length
        ?stars.map((s,i)=>`
          <div class="system-star-row" data-star-id="${s.id}">
            <input class="system-star-name" value="${E.esc(s.name)}" placeholder="Star name">
            <select class="system-star-preset">
              ${Object.keys(STAR_PRESETS).map(k=>`<option value="${k}" ${s.starPreset===k?'selected':''}>${k}</option>`).join('')}
            </select>
            <input class="system-star-color" type="color" value="${s.starColor||STAR_PRESETS.G.core}">
            <button type="button" class="remove-system-star">×</button>
          </div>`).join('')
        :'<div class="auto-empty">Single-star system.</div>';

      $('systemAdditionalStars').querySelectorAll('.remove-system-star').forEach(btn=>{
        btn.onclick=()=>{
          const row=btn.closest('[data-star-id]');
          const id=row?.dataset.starId;
          if(!id)return;
          nodes=nodes.filter(x=>x.id!==id);
          edges=edges.filter(e=>e.a!==id&&e.b!==id);
          renderAdditionalStars(n)
        }
      })
    };

    const setSystem=(n)=>{
      const star=systemMainStar(n);
      $('eSystemStarName').value=star?.name||'';
      $('eSystemStarPreset').value=star?.starPreset||'G';
      $('eSystemStarColor').value=star?.starColor||STAR_PRESETS.G.core;
      $('eSystemStarGlow').value=star?.starGlow||STAR_PRESETS.G.glow;
      $('eSystemGeneratePlanets').value=String(n?.systemProceduralPlanetCount??0);
      renderSystemMembers(n);
      renderAdditionalStars(n)
    };
    const setStar=(n)=>{
      const preset=n?.starPreset||'G',p=STAR_PRESETS[preset]||STAR_PRESETS.G;
      $('eStarPreset').value=preset;
      $('eStarColor').value=n?.starColor||p.core;
      $('eStarColor2').value=n?.starColor2||p.outer;
      $('eStarGlow').value=n?.starGlow||p.glow;
      $('eStarSize').value=String(n?.starSize||p.size);
      $('eStarSizeOut').textContent=(+(n?.starSize||p.size)).toFixed(2)+'×';
    };
    const renderMoonTargets=(n)=>{
      const targets=ofType('place').filter(p=>
        p.id!==n?.id &&
        String(p.placeScale||inferPlaceScale(p.placeType))==='planet'
      );
      $('eMoonOrbiting').innerHTML=
        '<option value="">Choose parent body…</option>'+
        targets.map(p=>`<option value="${p.id}" ${n?.orbitingId===p.id?'selected':''}>${E.esc(p.name)}${p.isMoon?' · Moon':' · Planet'}</option>`).join('')
    };
    const syncPlanetBodyType=()=>{
      const isPlanet=value('ePlaceScale')==='planet';
      const moon=!!$('ePlanetIsMoon')?.checked;
      const gas=!!$('ePlanetGasGiant')?.checked;
      $('moonOrbitingWrap')?.classList.toggle('hidden',!isPlanet||!moon);
      $('terrestrialPaletteControls')?.classList.toggle('hidden',!isPlanet||gas);
      $('gasGiantPaletteControls')?.classList.toggle('hidden',!isPlanet||!gas)
    };
    const syncPanels=()=>{
      const scale=value('ePlaceScale');
      planetPanel?.classList.toggle('hidden',scale!=='planet');
      systemPanel?.classList.toggle('hidden',scale!=='solar-system');
      starPanel?.classList.toggle('hidden',scale!=='star');
      syncPlanetBodyType()
    };

    setPalette(node);setSystem(node);setStar(node);renderMoonTargets(node);
    land.addEventListener('input',()=>syncCoverage('land'));
    ocean.addEventListener('input',()=>syncCoverage('ocean'));
    $('ePlanetCloudCoverage').addEventListener('input',()=>{$('ePlanetCloudCoverageOut').textContent=$('ePlanetCloudCoverage').value+'%'});
    $('ePlanetCloudOpacity').addEventListener('input',()=>{$('ePlanetCloudOpacityOut').textContent=$('ePlanetCloudOpacity').value+'%'});
    $('ePlanetGasContrast').addEventListener('input',()=>{$('ePlanetGasContrastOut').textContent=$('ePlanetGasContrast').value+'%'});
    $('ePlanetIsMoon').addEventListener('change',()=>{
      syncPlanetBodyType();

      // Existing Moon: synchronize graph connection immediately.
      if(node){
        node.isMoon=$('ePlanetIsMoon').checked;
        node.orbitingId=node.isMoon?value('eMoonOrbiting'):null;
        syncMoonOrbitConnection(node);
        renderLibraries()
      }
    });

    $('eMoonOrbiting').addEventListener('change',()=>{
      // Existing Moon: changing Orbiting creates the edge instantly.
      if(node){
        node.isMoon=$('ePlanetIsMoon').checked;
        node.orbitingId=node.isMoon?value('eMoonOrbiting'):null;
        syncMoonOrbitConnection(node);
        invalidateWorldStateForNode(node);
        renderLibraries()
      }
    });

    $('ePlanetGasGiant').addEventListener('change',syncPlanetBodyType);
    $('addSystemStar')?.addEventListener('click',()=>{
      if(!node)return;
      createSystemAdditionalStar(node,systemStars(node).length,{});
      renderAdditionalStars(node)
    });
    $('eSystemStarPreset').addEventListener('change',e=>{if(e.target.value!=='custom')applyStarPreset('system',e.target.value)});
    $('eStarPreset').addEventListener('change',e=>{if(e.target.value!=='custom')applyStarPreset('star',e.target.value)});
    $('eStarSize').addEventListener('input',()=>{$('eStarSizeOut').textContent=(+$('eStarSize').value).toFixed(2)+'×'});
    sel?.addEventListener('change',syncPanels);
    syncCoverage('land');syncPanels();
  }else{
    $('planetPalettePanel')?.classList.add('hidden');
    $('solarSystemEditorPanel')?.classList.add('hidden');
    $('starEditorPanel')?.classList.add('hidden');
  }

  if(type==='structure'){
    const toggle=$('eIsMegastructure'),panel=$('megastructureEditorPanel');
    const syncMegaPanel=()=>{panel?.classList.toggle('hidden',!toggle?.checked);if(toggle?.checked)setTimeout(()=>{bindMegaPainter();renderMegaPainter()},0)};
    const setMega=(n)=>{
      $('eMegastructureScale').value=n?.megastructureScale||'planetary';
      $('eMegaVisualStyle').value=n?.megaVisualStyle||'surface-paint';
      $('eMegaColor').value=n?.megaColor||'#6fdcff';
      $('eMegaColor2').value=n?.megaColor2||'#b8f2ff';
      $('eMegaGlow').value=n?.megaGlow||'#73e8ff';
      $('eMegaPattern').value=n?.megaPattern||'solid';
      $('eMegaCoverage').value=String(n?.megaCoverage??25);
      $('eMegaOpacity').value=String(n?.megaOpacity??80);
      $('eMegaLat').value=String(n?.megaLat??0);
      $('eMegaLon').value=String(n?.megaLon??0);
      $('eMegaDetailLevel').value=String(n?.megaDetailLevel??3);
      $('eMegaCloudLayer').value=n?.megaCloudLayer||'above';
      $('eCreatedMegaShape').value=n?.createdMegaShape||'sphere';
      $('eCreatedMegaSize').value=String(n?.createdMegaSize??1);
      $('eCreatedMegaSizeOut').textContent=(+(n?.createdMegaSize??1)).toFixed(2)+'×';
      createdMegaEditorState.faces=deepCloneState(n?.createdMegaFaces||{});
      createdMegaEditorState.activeFace=createdMegaFaces(n?.createdMegaShape||'sphere')[0];
      createdMegaEditorState.standalone=false;
      megaEditorMode=n?.megaEditorMode||null;
      setMegaPainterData(n?.megaPaintData||createdMegaEditorState.faces[createdMegaEditorState.activeFace]||{commands:[],imports:[]});
    };
    const syncMegaOutputs=()=>{
      $('eMegaCoverageOut').textContent=$('eMegaCoverage').value+'%';
      $('eMegaOpacityOut').textContent=$('eMegaOpacity').value+'%';
      $('eMegaLatOut').textContent=$('eMegaLat').value+'°';
      $('eMegaLonOut').textContent=$('eMegaLon').value+'°';
    };
    setMega(node);syncMegaOutputs();syncMegaPanel();
    if(node?.megaEditorMode)setMegaEditorMode(node.megaEditorMode,node);
    else resetMegaEditorChooser();
    toggle?.addEventListener('change',syncMegaPanel);
    $('eMegastructureScale')?.addEventListener('change',()=>updateCreatedMegaMode(node));
    $('eCreatedMegaShape')?.addEventListener('change',()=>{
      saveActiveCreatedMegaFace();
      const faces=createdMegaFaces(value('eCreatedMegaShape'));
      createdMegaEditorState.activeFace=faces[0];renderCreatedMegaFaceTabs();renderCreatedMega3D();
      setMegaPainterData(createdMegaEditorState.faces[faces[0]]||{commands:[],heightCommands:[],imports:[]});
      syncMegaPainterPresentation()
    });
    $('eCreatedMegaSize')?.addEventListener('input',()=>{$('eCreatedMegaSizeOut').textContent=(+$('eCreatedMegaSize').value).toFixed(2)+'×'});
$('eCreatedMegaSize')?.addEventListener('input',()=>{renderMegaPlanetGuide();renderMegaIconPreview()});
    ['eMegaCoverage','eMegaOpacity','eMegaLat','eMegaLon'].forEach(id=>$(id)?.addEventListener('input',syncMegaOutputs));
  }else{
    $('megastructureEditorPanel')?.classList.add('hidden');
  }

  if(type==='life'){
    const sentient=$('eSentient'),main=$('eMainLife');
    const individual=$('eIndividual'),individualMorality=$('eIndividualMorality');
    const syncIndividualMorality=()=>{
      $('individualMoralityWrap')?.classList.toggle('hidden',!individual?.checked);
      if(individualMorality&&$('eIndividualMoralityOut')){
        const v=+individualMorality.value||0;
        $('eIndividualMoralityOut').textContent=(v>0?'+':'')+v;
      }
    };
    individual?.addEventListener('change',syncIndividualMorality);
    individualMorality?.addEventListener('input',syncIndividualMorality);
    syncIndividualMorality();
    if(main?.checked&&sentient)sentient.checked=true;
    if(main)main.addEventListener('change',()=>{
      if(main.checked&&sentient)sentient.checked=true;
    });
    const relWrap=$('lifeRelationshipWrap'),rel=$('eRelationshipMain'),relOut=$('eRelationshipMainOut'),relText=$('eRelationshipMainText');
    const relWords=v=>v>=75?'Strong ally of Main':v>=30?'Friendly / cooperative with Main':v>10?'Generally positive toward Main':v>=-10?'Neutral / mixed relations with Main':v>-30?'Generally tense toward Main':v>-75?'Hostile / frequent conflict with Main':'Extreme enemy of Main';
    const refreshLifeRole=()=>{
      if(main?.checked&&sentient)sentient.checked=true;
      if(!sentient?.checked&&main)main.checked=false;
      const show=!!sentient?.checked&&!main?.checked;
      if(relWrap)relWrap.classList.toggle('hidden',!show);
      if(rel){const v=+rel.value||0;if(relOut)relOut.textContent=(v>0?'+':'')+v;if(relText)relText.textContent=relWords(v)+'.';}
    };
    main?.addEventListener('change',refreshLifeRole);
    sentient?.addEventListener('change',refreshLifeRole);
    rel?.addEventListener('input',refreshLifeRole);
    refreshLifeRole();
  }

  if(type==='spell')requestAnimationFrame(bindMoralitySlider);
}
function closeEditor(){if(megaPainterState?.expanded)toggleMegaPainterExpanded(false);$('autoConnectionsPanel').classList.add('hidden');$('planetPalettePanel')?.classList.add('hidden');$('solarSystemEditorPanel')?.classList.add('hidden');$('starEditorPanel')?.classList.add('hidden');$('megastructureEditorPanel')?.classList.add('hidden');$('editorModal').classList.add('hidden');editingId=null;editingType=null;creatingHub=false;pendingConnectionPlan=null}
const value=id=>$(id)?.value?.trim()||'';
function saveCivilizationUtilEditor(){
  if(editingType!=='civilizationUtil')return false;

  const name=value('eName');
  if(!name)return false;

  checkpointHistory();

  let n=editingId?byId(editingId):null;

  if(!n){
    const a=Math.random()*Math.PI*2;
    const d=220+Math.random()*180;
    n={
      id:uid(),
      type:'civilizationUtil',
      name,
      x:Math.cos(a)*d,
      y:Math.sin(a)*d,
      vx:0,
      vy:0,
      r:16
    };
    nodes.push(n)
  }

  n.name=name;

  const subtype=value('eUtilityType')||window.__pendingCivilizationUtilType||n.utilityType||'language';

  Object.assign(n,{
    utilityType:subtype,
    category:utilitySubtypeLabel(subtype),
    symbolId:$('eUtilitySymbol')?value('eUtilitySymbol')||null:(n.symbolId||null),
    description:value('eDescription')
  });

  if(subtype==='language'){
    const languageGroups=collectLanguageMappingGroups();
    Object.assign(n,{
      languageDirection:value('eLanguageDirection')||'Left → Right',
      languageMappingGroups:languageGroups,
      languageMode:'Multiple',
      languageMappings:Object.values(languageGroups).flat()
    })
  }

  if(subtype==='currency'){
    Object.assign(n,{
      currencySymbol:value('eCurrencySymbol'),
      usdEquivalent:Math.max(0,+value('eCurrencyUsd')||0),
      currencySubdivision:value('eCurrencySubdivision'),
      currencyForm:value('eCurrencyForm'),
      currencyStability:value('eCurrencyStability'),
      currencyBacking:value('eCurrencyBacking')
    })
  }

  if(subtype==='disease'){
    Object.assign(n,{
      diseaseSpread:value('eDiseaseSpread'),
      diseaseSeverity:value('eDiseaseSeverity'),
      diseaseDuration:value('eDiseaseDuration'),
      diseaseMortality:Math.max(0,Math.min(100,+value('eDiseaseMortality')||0)),
      diseaseCure:value('eDiseaseCure'),
      diseaseOrigin:value('eDiseaseOrigin')
    })
  }

  if(subtype==='calendar'){
    Object.assign(n,{
      calendarDays:+value('eUtilA')||365,
      calendarMonths:value('eUtilB'),
      calendarEra:value('eUtilC'),
      calendarHolidays:value('eUtilD')
    })
  }

  if(subtype==='measurement'){
    Object.assign(n,{
      measurementDistance:value('eUtilA'),
      measurementMass:value('eUtilB'),
      measurementTemperature:value('eUtilC')
    })
  }

  if(subtype==='legalCode'){
    Object.assign(n,{
      legalLaws:value('eUtilA'),
      legalRights:value('eUtilB'),
      legalEnforcement:value('eUtilC')
    })
  }

  if(subtype==='rankSystem'){
    Object.assign(n,{
      rankEntries:value('eUtilA'),
      rankPromotion:value('eUtilB')
    })
  }

  if(subtype==='communication'){
    Object.assign(n,{
      communicationMedium:value('eUtilA'),
      communicationRange:value('eUtilB'),
      communicationLatency:value('eUtilC')
    })
  }

  if(subtype==='naming'){
    Object.assign(n,{
      namingGiven:value('eUtilA'),
      namingFamily:value('eUtilB'),
      namingExamples:value('eUtilC')
    })
  }

  // Replace ONLY Life-access links belonging to this utility.
  // Organization, pricing and other semantic links remain untouched.
  edges=edges.filter(e=>{
    if(e.type!=='civilizationUtility'||(e.a!==n.id&&e.b!==n.id))return true;
    const other=byId(e.a===n.id?e.b:e.a);
    return other?.type!=='life'
  });

  document.querySelectorAll('.utility-life-check:checked').forEach(ch=>{
    const life=byId(ch.value);
    if(life)ensureExclusiveUtilityEdge(life,n)
  });

  // Make sure any planned auto-connections survive creation.
  if(!editingId&&pendingConnectionPlan){
    n.connectionPlan=pendingConnectionPlan.map(p=>({...p}))
  }

  // Persist FIRST, then close. This avoids editor cleanup clearing state
  // before the Civilization Utility has been written.
  rebuildEdges();
  ensureTechnologyConnections();
  renderLibraries();
  renderTechnologyTree();
  selectNode(n);
  graph.fit();
  save();

  editingId=n.id;

  closeEditor();
  return true
}

function saveEditor(){
  if(editingType==='civilizationUtil'){
    saveCivilizationUtilEditor();
    return
  }

  const type=editingType,name=value('eName');if(!type||!name)return;
  checkpointHistory();
  let n=editingId?byId(editingId):null;
  if(!n&&type==='mana')n=byId('mana');
  if(!n){const a=Math.random()*Math.PI*2,d=220+Math.random()*180;n={id:uid(),type,name,x:Math.cos(a)*d,y:Math.sin(a)*d,vx:0,vy:0,r:type==='spell'?17:16};nodes.push(n)}n.name=name;
  if(type==='mana')Object.assign(n,{name,nature:value('eManaNature'),systemScale:value('eSystemScale')||'planet',description:value('eDescription')});
  else if(type==='spell')Object.assign(n,{spellClass:value('eClass')||'Unclassified',intent:value('eIntent'),structure:value('eStructure'),target:value('eTarget'),output:value('eOutput'),duration:value('eDuration'),range:value('eRange'),source:value('eSource')||'Mana',morality:+($('eMorality')?.value||0),extra:value('eExtra')});
  else if(type==='rule')Object.assign(n,{strength:value('eStrength'),spellClass:value('eRuleClass'),text:value('eText'),scope:value('eScope')||'All magic',exceptions:value('eExceptions'),spellIds:[...document.querySelectorAll('.rule-spell-check:checked')].map(x=>x.value)});
  else if(type==='place')Object.assign(n,{
    placeType:value('ePlaceType'),
    placeScale:value('ePlaceScale')||inferPlaceScale(value('ePlaceType')),
    planetLandColor:value('ePlanetLandColor')||'#5d8f5a',
    planetLandColor2:value('ePlanetLandColor2')||'#78915b',
    planetLandColor3:value('ePlanetLandColor3')||'#8d8655',
    planetOceanColor:value('ePlanetOceanColor')||'#315f9f',
    planetOceanColor2:value('ePlanetOceanColor2')||'#102f58',
    isMoon:!!$('ePlanetIsMoon')?.checked&&value('ePlaceScale')==='planet',
    orbitingId:(!!$('ePlanetIsMoon')?.checked&&value('ePlaceScale')==='planet')?value('eMoonOrbiting'):null,
    gasGiant:!!$('ePlanetGasGiant')?.checked&&value('ePlaceScale')==='planet',
    planetGasColor:value('ePlanetGasColor')||'#d6b783',
    planetGasColor2:value('ePlanetGasColor2')||'#a87a58',
    planetGasColor3:value('ePlanetGasColor3')||'#eee0b5',
    planetGasContrast:Math.max(0,Math.min(100,+value('ePlanetGasContrast')||55)),
    planetLandCoverage:Math.max(0,Math.min(100,+value('ePlanetLandCoverage')||0)),
    planetLandEnabled:$('ePlanetLandEnabled')?.checked!==false,
    planetOceanEnabled:$('ePlanetOceanEnabled')?.checked!==false,
    planetCloudsEnabled:$('ePlanetCloudsEnabled')?.checked!==false,
    planetCloudColor:value('ePlanetCloudColor')||'#eef8ff',
    planetCloudCoverage:Math.max(0,Math.min(100,+value('ePlanetCloudCoverage')||45)),
    planetCloudOpacity:Math.max(0,Math.min(100,+value('ePlanetCloudOpacity')||38)),
    starPreset:value('eStarPreset')||n.starPreset||'G',
    starColor:value('eStarColor')||n.starColor||STAR_PRESETS.G.core,
    starColor2:value('eStarColor2')||n.starColor2||STAR_PRESETS.G.outer,
    starGlow:value('eStarGlow')||n.starGlow||STAR_PRESETS.G.glow,
    starSize:Math.max(.4,Math.min(3,+value('eStarSize')||n.starSize||1)),
    ownerFactionId:value('eOwnerFaction')||null,
    inhabitants:value('eInhabitants'),
    government:value('eGovernment'),
    access:value('eAccess'),
    associations:value('eAssociations'),
    interaction:value('ePlaceInteraction'),
    description:value('eDescription'),
    // Mirror into the generic relationship fields so the existing V15
    // automatic-connection engine understands Places without a rewrite.
    category:value('ePlaceType'),
    composition:value('eInhabitants'),
    property:value('eGovernment'),
    requirements:value('eAccess'),
    uses:value('eAssociations')
  });
  else if(type==='civilizationUtil'){
    const subtype=value('eUtilityType')||'language';
    Object.assign(n,{
      utilityType:subtype,
      category:utilitySubtypeLabel(subtype),
      symbolId:$('eUtilitySymbol')?value('eUtilitySymbol')||null:(n.symbolId||null),
      description:value('eDescription')
    });
    if(subtype==='language'){
      const languageGroups=collectLanguageMappingGroups();
      Object.assign(n,{
        languageDirection:value('eLanguageDirection'),
        languageMappingGroups:languageGroups,
        // Keep legacy flattened fields for compatibility with older systems.
        languageMode:'Multiple',
        languageMappings:Object.values(languageGroups).flat()
      })
    }
    if(subtype==='currency')Object.assign(n,{
      currencySymbol:value('eCurrencySymbol'),
      usdEquivalent:Math.max(0,+value('eCurrencyUsd')||0),
      currencySubdivision:value('eCurrencySubdivision'),
      currencyForm:value('eCurrencyForm'),
      currencyStability:value('eCurrencyStability'),
      currencyBacking:value('eCurrencyBacking')
    });
    if(subtype==='disease')Object.assign(n,{
      diseaseSpread:value('eDiseaseSpread'),
      diseaseSeverity:value('eDiseaseSeverity'),
      diseaseDuration:value('eDiseaseDuration'),
      diseaseMortality:Math.max(0,Math.min(100,+value('eDiseaseMortality')||0)),
      diseaseCure:value('eDiseaseCure'),
      diseaseOrigin:value('eDiseaseOrigin')
    });
    if(subtype==='calendar')Object.assign(n,{calendarDays:+value('eUtilA')||365,calendarMonths:value('eUtilB'),calendarEra:value('eUtilC'),calendarHolidays:value('eUtilD')});
    if(subtype==='measurement')Object.assign(n,{measurementDistance:value('eUtilA'),measurementMass:value('eUtilB'),measurementTemperature:value('eUtilC')});
    if(subtype==='legalCode')Object.assign(n,{legalLaws:value('eUtilA'),legalRights:value('eUtilB'),legalEnforcement:value('eUtilC')});
    if(subtype==='rankSystem')Object.assign(n,{rankEntries:value('eUtilA'),rankPromotion:value('eUtilB')});
    if(subtype==='communication')Object.assign(n,{communicationMedium:value('eUtilA'),communicationRange:value('eUtilB'),communicationLatency:value('eUtilC')});
    if(subtype==='naming')Object.assign(n,{namingGiven:value('eUtilA'),namingFamily:value('eUtilB'),namingExamples:value('eUtilC')});


    // Utility-Life links are authoritative, but unrelated Civilization Utility
    // links (Organization use, Material pricing, etc.) must survive an edit.
    edges=edges.filter(e=>{
      if(e.type!=='civilizationUtility'||(e.a!==n.id&&e.b!==n.id))return true;
      const other=byId(e.a===n.id?e.b:e.a);
      return other?.type!=='life'
    });
    document.querySelectorAll('.utility-life-check:checked').forEach(ch=>{
      const life=byId(ch.value);
      if(life)ensureExclusiveUtilityEdge(life,n)
    })
  }
  else if(type==='organization'){
    Object.assign(n,{
      organizationType:value('eOrganizationType')||'Organization',
      organizationCustomType:value('eOrganizationCustomType'),
      organizationPurpose:value('eOrganizationPurpose'),
      organizationMembers:Math.max(0,+value('eOrganizationMembers')||0),
      organizationCapital:value('eOrganizationCapital'),
      organizationResources:value('eOrganizationResources'),
      category:value('eOrganizationType')||'Organization',
      property:value('eOrganizationPurpose'),
      uses:value('eOrganizationResources'),
      description:value('eDescription')
    });

    document.querySelectorAll('[data-org-rel]').forEach(row=>{
      const other=byId(row.dataset.orgRel);
      const slider=row.querySelector('.org-rel-slider');
      if(other&&slider)setOrganizationRelationship(n,other,+slider.value)
    })
  }
  else {
    Object.assign(n,{category:value('eCategory'),composition:value('eComposition'),property:value('eProperty'),requirements:value('eRequirements'),uses:value('eUses'),interaction:value('eInteraction'),description:value('eDescription')});
    if(type==='material'){
      n.currencyPrices=[...document.querySelectorAll('[data-material-currency]')].map(el=>({
        currencyId:el.dataset.materialCurrency,amount:+el.value
      })).filter(p=>Number.isFinite(p.amount)&&p.amount>=0&&String(document.querySelector(`[data-material-currency="${p.currencyId}"]`)?.value||'')!=='');
      // Pricing also creates a semantic graph connection to the currency.
      for(const p of n.currencyPrices){
        if(!graphNodesLinked(n.id,p.currencyId))edges.push({id:uid(),a:n.id,b:p.currencyId,type:'civilizationUtility',linkType:'relationship',label:'Priced In',direction:'forward',manual:true,strength:'solid',thickness:1.5})
      }
    }
    if(type==='structure'){
      n.isMegastructure=!!$('eIsMegastructure')?.checked;
      if(n.isMegastructure){
        n.megaEditorMode=megaEditorMode||n.megaEditorMode||'attached';
        n.megastructureScale=value('eMegastructureScale')||'planetary';
        n.megaVisualStyle=value('eMegaVisualStyle')||'surface-paint';
        n.megaColor=value('eMegaColor')||'#6fdcff';
        n.megaColor2=value('eMegaColor2')||'#b8f2ff';
        n.megaGlow=value('eMegaGlow')||'#73e8ff';
        n.megaPattern=value('eMegaPattern')||'solid';
        n.megaCoverage=Math.max(1,Math.min(100,+value('eMegaCoverage')||25));
        n.megaOpacity=Math.max(10,Math.min(100,+value('eMegaOpacity')||80));
        n.megaLat=Math.max(-90,Math.min(90,+value('eMegaLat')||0));
        n.megaLon=Math.max(-180,Math.min(180,+value('eMegaLon')||0));
        n.megaDetailLevel=Math.max(1,Math.min(5,+value('eMegaDetailLevel')||3));
        n.megaCloudLayer=value('eMegaCloudLayer')||'above';

        const hostScale=megastructureHostScale(n.megastructureScale);
        const hosts=ofType('place').filter(p=>String(p.placeScale||inferPlaceScale(p.placeType))===hostScale&&graphNodesLinked(n.id,p.id));
        n.createdMegastructure=n.megaEditorMode==='separate';

        // megaEditorMode is authoritative. createdMegastructure remains as a
        // backwards-compatible saved flag only.
        if(isSeparateMegastructure(n)){
          saveActiveCreatedMegaFace();
          n.createdMegaShape=value('eCreatedMegaShape')||'sphere';
          n.createdMegaSize=Math.max(.25,Math.min(4,+value('eCreatedMegaSize')||1));
          n.createdMegaFaces=deepCloneState(createdMegaEditorState.faces);
          n.megaPaintData=deepCloneState(n.createdMegaFaces[createdMegaFaces(n.createdMegaShape)[0]]||megaPainterData());
        }else{
          n.createdMegastructure=false;
          n.megaPaintData=megaPainterData();
        }
      }
    }
    if(type==='magicalObject')n.technological=!!$('eTechnological')?.checked;
    if(type==='life'){
      n.sentient=!!$('eSentient')?.checked;
      n.main=!!$('eMainLife')?.checked;
      if(n.main)n.sentient=true;
      if(!n.sentient)n.main=false;
      n.relationshipWithMain=(n.sentient&&!n.main)?+(value('eRelationshipMain')||0):0;
      n.individual=!!$('eIndividual')?.checked;
      n.individualMorality=n.individual?Math.max(-100,Math.min(100,+value('eIndividualMorality')||0)):0;
    }
  }
  if(editingId&&$('eHubRole')&&type!=='mana'){
    setNodeHubRole(n,value('eHubRole'))
  }

  if(!editingId&&creatingHub&&type!=='spell'){
    setNodeHubRole(n,'hub')
  }
  if(type!=='mana'&&pendingConnectionPlan){
    n.connectionPlan=pendingConnectionPlan.map(p=>({...p}));
  }

  if(type==='place'){
    // Keep the graph's visible Orbiting relationship synchronized with
    // the Moon editor's authoritative Orbiting selector.
    syncMoonOrbitConnection(n)
  }

  if(type==='place'&&n.placeScale==='solar-system'){
    // Remove redundant direct System ↔ Moon containment links.
    edges=edges.filter(e=>{
      if(!e.placeContainment)return true;
      const other=e.a===n.id?byId(e.b):e.b===n.id?byId(e.a):null;
      return !(other&&isMoonPlace(other))
    });

    const starName=value('eSystemStarName');
    if(starName){
      ensureSystemStar(n,starName,value('eSystemStarPreset')||'G',value('eSystemStarColor'),value('eSystemStarGlow'));
    }

    // Persist any edited secondary-star properties.
    document.querySelectorAll('#systemAdditionalStars [data-star-id]').forEach(row=>{
      const s=byId(row.dataset.starId);
      if(!s)return;
      const preset=row.querySelector('.system-star-preset')?.value||'G';
      const p=STAR_PRESETS[preset]||STAR_PRESETS.G;
      s.name=row.querySelector('.system-star-name')?.value?.trim()||s.name;
      s.starPreset=preset;
      s.starColor=row.querySelector('.system-star-color')?.value||p.core;
      s.starColor2=s.starColor2||p.outer;
      s.starGlow=s.starGlow||p.glow;
      s.starSize=s.starSize||p.size
    });

    const selectedMembers=new Set([...document.querySelectorAll('.system-member-check:checked')].map(x=>x.value));
    // Remove old containment edges to Planet/Star members not selected anymore,
    // except the designated main star.
    edges=edges.filter(e=>{
      const other=e.a===n.id?byId(e.b):e.b===n.id?byId(e.a):null;
      if(!other||!e.placeContainment||!['planet','star'].includes(String(other.placeScale)))return true;
      // Stars managed by the Primary / Additional Star editor are always
      // retained even if not manually checked in Existing Members.
      if(String(other.placeScale)==='star')return true;
      return selectedMembers.has(other.id);
    });
    for(const id of selectedMembers){
      const member=byId(id);if(!member)continue;
      if(!edges.some(e=>!e.blocked&&!isVisualOnlyEdge(e)&&e.placeContainment&&((e.a===n.id&&e.b===id)||(e.b===n.id&&e.a===id)))){
        edges.push({id:uid(),a:n.id,b:id,type:'contains',linkType:'dependency',label:'contains',direction:'forward',manual:true,placeContainment:true});
      }
    }

    n.systemProceduralPlanetCount=Math.max(0,Math.min(24,+value('eSystemGeneratePlanets')||0));
  }

  if(type==='place')invalidateWorldStateForNode(n);
  closeEditor();rebuildEdges();ensureTechnologyConnections();renderLibraries();renderTechnologyTree();organize();selectNode(n);graph.fit();save()
}
function deleteSelected(){if(!selected||selected.type==='mana'||selected.type==='classPoint')return;checkpointHistory();const id=selected.id;nodes=nodes.filter(n=>n.id!==id);edges=edges.filter(e=>e.a!==id&&e.b!==id);for(const r of rules())if(r.spellIds)r.spellIds=r.spellIds.filter(x=>x!==id);selected=null;graph.selected=null;rebuildEdges();renderLibraries();showSelection()}
function organize(){
  if(!historyRestoring)checkpointHistory();
  const mana=byId('mana');mana.x=0;mana.y=0;const classes=classNames(),ss=spells();
  classes.forEach((cls,ci)=>{const group=ss.filter(s=>(s.spellClass||'Unclassified')===cls),angle=(ci/Math.max(1,classes.length))*Math.PI*2-Math.PI/2,cx=Math.cos(angle)*(260+classes.length*18),cy=Math.sin(angle)*(200+classes.length*14);group.forEach((s,i)=>{const a=(i/Math.max(1,group.length))*Math.PI*2,rad=70+Math.min(80,group.length*7);s.x=cx+Math.cos(a)*rad;s.y=cy+Math.sin(a)*rad;s.vx=s.vy=0})});
  rebuildClassPoints();
  for(const cls of classes){
    const point=classPointFor(cls);
    const members=classMembers(cls);
    if(point&&members.length){
      point.x=members.reduce((a,s)=>a+s.x,0)/members.length;
      point.y=members.reduce((a,s)=>a+s.y,0)/members.length;
      point.vx=point.vy=0;
    }
  }
  const regions={rule:[-420,-250],material:[420,-250],magicalObject:[430,240],technique:[0,400],principle:[-430,240],structure:[-520,40],life:[520,40],place:[0,-430]};Object.entries(regions).forEach(([type,[cx,cy]])=>{ofType(type).forEach((n,i)=>{const a=i*2.399;n.x=cx+Math.cos(a)*(45+22*Math.sqrt(i));n.y=cy+Math.sin(a)*(45+22*Math.sqrt(i));n.vx=n.vy=0})})
}

function openPlannedLinkEditor(index){
  const p=pendingConnectionPlan?.[index];
  if(!p)return;
  const target=plannedTarget(p.targetId);if(!target)return;

  const modal=$('linkModal');
  modal.dataset.mode='plan';
  modal.dataset.planIndex=String(index);
  modal.dataset.editEdgeId='';
  modal.dataset.a='__draft__';
  modal.dataset.b=p.targetId;

  $('linkLabel').value=p.label||'';
  $('linkType').value=p.linkType||'direct';
  $('linkStrength').value=p.strength||(
    p.type==='applies'?'dashed':p.type==='uses'?'dotted':'solid'
  );
  $('linkThickness').value=String(p.thickness||1.6);
  $('linkDirection').value=p.direction||'forward';
  $('linkPreview').innerHTML=`<b>${E.esc(connectionPlanSourceName())}</b>&nbsp; → &nbsp;<b>${E.esc(target.type==='classPoint'?(target.spellClass+' class'):target.name)}</b>`;
  modal.querySelector('.eyebrow').textContent='Planned relationship';
  modal.querySelector('h2').textContent='Edit Auto-Connection';
  $('saveLink').textContent='Save changes';
  modal.classList.remove('hidden');
}
function resetLinkModalMode(){
  const modal=$('linkModal');
  modal.dataset.mode='';
  modal.dataset.planIndex='';
  modal.querySelector('.eyebrow').textContent='Manual relationship';
  modal.querySelector('h2').textContent='Create Link';
  $('saveLink').textContent='Create link';
}

function relationshipWords(v){
  return v>=75?'Strongly allied':v>=30?'Friendly / cooperative':v>10?'Generally positive':v>=-10?'Neutral / mixed':v>-30?'Generally tense':v>-75?'Hostile':'Extreme hostility';
}
function relationshipKindLabel(k){
  return k==='worksFor'?'Works for':k==='createdBy'?'Created by':'Separate';
}
function relationshipKindHelp(k){
  if(k==='worksFor')return 'One side serves or works for the other. Positive relations improve labor, services and production; negative relations can cause strikes, sabotage or rebellion.';
  if(k==='createdBy')return 'One side was created by the other. Positive relations encourage loyalty and cooperation; negative relations can create creator–creation disputes, rejection or rebellion.';
  return 'Independent groups. Positive relations create cooperation; negative relations create disputes, raids, or war.';
}
function refreshRelationshipLinkUI(){
  const isRel=value('linkType')==='relationship';
  $('linkRelationshipFields')?.classList.toggle('hidden',!isRel);
  if(!isRel)return;
  const v=+value('linkRelationship')||0;
  const kind=value('linkRelationshipKind')||'separate';
  if($('linkRelationshipOut'))$('linkRelationshipOut').textContent=(v>0?'+':'')+v;
  if($('linkRelationshipText'))$('linkRelationshipText').textContent=relationshipWords(v)+' relationship.';
  if($('linkRelationshipKindHelp'))$('linkRelationshipKindHelp').textContent=relationshipKindHelp(kind);
  // Relationship labels now expose both structure and attitude.
  $('linkLabel').value=`${relationshipKindLabel(kind)} · relationship ${v>0?'+':''}${v}`;
}
function openAdvancementEditor(edge){
  if(!edge?.techAdvancement)return;
  const n=byId(edge.b);if(!n)return;
  $('advancementModal').dataset.edgeId=edge.id;
  $('advancementPreview').innerHTML=`<b>TECHNOLOGY</b>&nbsp; → &nbsp;<b>${E.esc(n.name)}</b>`;
  const v=Number.isFinite(edge.advancement)?edge.advancement:(n.advancement??25);
  $('advancementValue').value=String(v);
  $('advancementModal').classList.remove('hidden');
}
function saveAdvancement(){
  const edge=edges.find(e=>e.id===$('advancementModal').dataset.edgeId);
  if(!edge?.techAdvancement)return;
  checkpointHistory();
  const v=Math.max(0,+value('advancementValue')||0);
  const n=byId(edge.b);if(n)n.advancement=v;
  edge.advancement=v;edge.label=`Advancement ${v}`;
  $('advancementModal').classList.add('hidden');
  renderTechnologyTree();
  graph.setData(nodes.filter(n=>!n.hiddenTechnology),edges.filter(e=>!e.blocked&&byId(e.a)&&byId(e.b)&&!byId(e.a)?.hiddenTechnology&&!byId(e.b)?.hiddenTechnology));
  save();
}

function openLinkModal(a,b,edge=null){
  resetLinkModalMode();
  $('linkModal').dataset.editEdgeId=edge?.id||'';
  $('linkLabel').value=edge?.label||'';
  $('linkType').value=edge?.linkType||'direct';
  $('linkStrength').value=edge?.strength||'solid';
  $('linkThickness').value=String(edge?.thickness||1.6);
  $('linkDirection').value=edge?.direction||'forward';
  if($('linkRelationship'))$('linkRelationship').value=String(Number.isFinite(edge?.relationship)?edge.relationship:0);
  if($('linkRelationshipKind'))$('linkRelationshipKind').value=edge?.relationshipKind||'separate';
  $('linkPreview').innerHTML=`<b>${E.esc(a.name)}</b>&nbsp; → &nbsp;<b>${E.esc(b.name)}</b>`;
  $('linkModal').dataset.a=a.id;$('linkModal').dataset.b=b.id;
  $('linkModal').classList.remove('hidden');
  refreshRelationshipLinkUI();
}
function saveLink(){
  if($('linkModal').dataset.mode==='plan'){
    const i=+$('linkModal').dataset.planIndex;
    const p=pendingConnectionPlan?.[i];
    if(!p)return;
    p.label=value('linkLabel')||value('linkType');
    p.linkType=value('linkType');
    p.strength=value('linkStrength');
    p.thickness=+value('linkThickness')||1.6;
    p.direction=value('linkDirection')||'forward';
    p.relationship=p.linkType==='relationship'?+(value('linkRelationship')||0):undefined;
    p.relationshipKind=p.linkType==='relationship'?(value('linkRelationshipKind')||'separate'):undefined;
    if(p.linkType==='relationship')p.label=`${relationshipKindLabel(p.relationshipKind)} · relationship ${p.relationship>0?'+':''}${p.relationship}`;
    p.customized=true;
    $('linkModal').classList.add('hidden');
    resetLinkModalMode();
    renderConnectionPlan();
    return;
  }
  const a=$('linkModal').dataset.a,b=$('linkModal').dataset.b;if(!a||!b)return;
  checkpointHistory();
  const editId=$('linkModal').dataset.editEdgeId;
  let e=editId?edges.find(x=>x.id===editId):null;
  if(!e){
    // New manual link replaces any existing visible connection between the pair.
    const existing=edges.filter(x=>!x.blocked&&((x.a===a&&x.b===b)||(x.a===b&&x.b===a)));
    for(const old of existing){
      if(old.manual)edges=edges.filter(x=>x!==old);
      else addAutomaticBlocker(old);
    }
    e={id:uid(),a,b,type:'manual',manual:true};edges.push(e)
  }
  e.label=value('linkLabel')||value('linkType');e.linkType=value('linkType');e.strength=value('linkStrength');e.thickness=+value('linkThickness')||1.6;e.direction=value('linkDirection')||'forward';e.relationship=e.linkType==='relationship'?+(value('linkRelationship')||0):undefined;e.relationshipKind=e.linkType==='relationship'?(value('linkRelationshipKind')||'separate'):undefined;if(e.linkType==='relationship')e.label=`${relationshipKindLabel(e.relationshipKind)} · relationship ${e.relationship>0?'+':''}${e.relationship}`;
  $('linkModal').classList.add('hidden');graph.setLinkMode(false);$('linkBtn').classList.remove('active');
  rebuildEdges();graph.setData(nodes,edges.filter(x=>!x.blocked));updateStats()
}


function addAutomaticBlocker(edge){
  if(!edge||edge.manual||edge.blocked)return;
  const exists=edges.some(e=>
    e.manual&&e.blocked&&
    ((e.a===edge.a&&e.b===edge.b)||(e.a===edge.b&&e.b===edge.a))&&
    (e.originalType===edge.type||e.originalType==='*')
  );
  if(exists)return;

  edges.push({
    id:uid(),
    a:edge.a,
    b:edge.b,
    type:'blocked',
    manual:true,
    blocked:true,
    originalType:edge.type||'*',
    label:'blocked automatic connection'
  });
}

function snipEdgesBatch(batch){
  const unique=[...new Map((batch||[]).filter(Boolean).map(e=>[e.id,e])).values()];
  if(!unique.length)return;
  checkpointHistory();

  const ids=new Set(unique.map(e=>e.id));

  // Remove manual edges directly.
  edges=edges.filter(e=>!(ids.has(e.id)&&e.manual&&!e.blocked));

  // Suppress automatic edges with blockers.
  for(const edge of unique){
    if(edge.manual||edge.blocked)continue;
    addAutomaticBlocker(edge);
  }

  rebuildEdges();
  graph.setData(nodes,edges.filter(e=>!e.blocked));
  updateStats();
}

function snipEdge(edge){
  if(!edge)return;
  checkpointHistory();
  if(edge.manual){
    edges=edges.filter(e=>e!==edge);
  }else{
    addAutomaticBlocker(edge);
  }
  rebuildEdges();
  graph.setData(nodes,edges.filter(e=>!e.blocked));
  updateStats();
}

function openConnections(){
  if(!selected)return;
  const list=$('connectionsList');
  const related=edges.filter(e=>!e.blocked&&(e.a===selected.id||e.b===selected.id));
  list.innerHTML='';
  if(!related.length)list.innerHTML='<div style="color:#8995aa;padding:12px">No connections yet.</div>';
  related.forEach(e=>{
    const other=byId(e.a===selected.id?e.b:e.a);if(!other)return;
    const row=document.createElement('div');row.className='connection-row';
    row.innerHTML=`<div><strong>${E.esc(other.name)}</strong><small>${E.esc(e.label||e.type)} · ${e.manual?'manual':'automatic'}</small></div><div class="connection-actions"><button class="edit-link">Edit</button><button class="danger delete-link">${e.manual?'Delete':'Snip'}</button></div>`;
    row.querySelector('.edit-link').onclick=()=>{
      $('connectionsModal').classList.add('hidden');
      if(e.manual){
        openLinkModal(byId(e.a),byId(e.b),e);
      }else{
        edges=edges.filter(x=>!(x.manual&&!x.blocked&&((x.a===e.a&&x.b===e.b)||(x.a===e.b&&x.b===e.a))));
        addAutomaticBlocker(e);
        const copy={id:uid(),a:e.a,b:e.b,type:'manual',manual:true,label:e.label||e.type,linkType:'direct',strength:e.type==='applies'?'dashed':e.type==='uses'?'dotted':'solid',thickness:1.6,direction:e.direction||'forward'};
        edges.push(copy);
        rebuildEdges();
        openLinkModal(byId(copy.a),byId(copy.b),copy);
      }
    };
    row.querySelector('.delete-link').onclick=()=>{snipEdge(e);openConnections()};
    list.appendChild(row);
  });
  $('connectionsModal').classList.remove('hidden')
}

function cloneSelected(){
  if(!selected||selected.type==='mana')return;
  checkpointHistory();
  const copy=JSON.parse(JSON.stringify(selected));
  copy.id=uid();
  copy.name=(selected.name||selected.type)+' Copy';
  copy.x=(selected.x||0)+55;copy.y=(selected.y||0)+45;copy.vx=0;copy.vy=0;copy.fixed=false;
  if(copy.type==='rule'&&Array.isArray(copy.spellIds))copy.spellIds=[...copy.spellIds];
  nodes.push(copy);
  rebuildEdges();renderLibraries();selectNode(copy);save()
}
function systemAudit(){
  const ss=spells(),rr=rules(),classes=classNames();
  const orphanExtras=nodes.filter(n=>!['mana','spell'].includes(n.type)&&!edges.some(e=>!e.blocked&&!isVisualOnlyEdge(e)&&(e.a===n.id||e.b===n.id)));
  const unclassified=ss.filter(s=>(s.spellClass||'Unclassified')==='Unclassified');
  const globalRules=rr.filter(r=>{
    const scope=String(r.scope||'').toLowerCase().trim();
    return !(r.spellIds||[]).length&&!String(r.spellClass||'').trim()&&(!scope||scope==='all'||scope.includes('all magic'));
  });
  const classStats=classes.map(c=>{
    const members=ss.filter(s=>(s.spellClass||'Unclassified')===c);
    const affected=rr.filter(r=>members.some(s=>ruleApplies(r,s))).length;
    return {name:c,count:members.length,rules:affected};
  }).sort((a,b)=>b.count-a.count);
  const topSpell=ss.map(s=>({s,count:edges.filter(e=>!e.blocked&&(e.a===s.id||e.b===s.id)).length})).sort((a,b)=>b.count-a.count)[0];
  const manualCount=edges.filter(e=>e.manual&&!e.blocked).length;
  const autoCount=edges.filter(e=>!e.manual&&!e.blocked).length;
  const body=$('auditBody');
  body.innerHTML=`
    <div class="audit-card"><strong>${ss.length}</strong><span>Spells</span></div>
    <div class="audit-card"><strong>${classes.length}</strong><span>Spell classes</span></div>
    <div class="audit-card"><strong>${rr.length}</strong><span>Rules</span></div>
    <div class="audit-card"><strong>${manualCount} / ${autoCount}</strong><span>Manual / automatic links</span></div>
    <div class="audit-section"><h3>Spell classes</h3>${classStats.length?classStats.map(c=>`<span class="audit-pill">${E.esc(c.name)} · ${c.count} spell${c.count===1?'':'s'} · ${c.rules} rule${c.rules===1?'':'s'}</span>`).join(''):'<span class="audit-pill">No classes yet</span>'}</div>
    <div class="audit-section"><h3>System signals</h3>
      <span class="audit-pill">${globalRules.length} global rule${globalRules.length===1?'':'s'}</span>
      <span class="audit-pill">${unclassified.length} unclassified spell${unclassified.length===1?'':'s'}</span>
      <span class="audit-pill">${orphanExtras.length} disconnected system node${orphanExtras.length===1?'':'s'}</span>
      ${topSpell?`<span class="audit-pill">Most connected: ${E.esc(topSpell.s.name)} (${topSpell.count})</span>`:''}
    </div>`;
  $('auditModal').classList.remove('hidden')
}



const WORLD_RENDER_SCHEMA=22708;
try{
  const oldSchema=Number(localStorage.getItem('magicWorldRenderSchema')||0);
  if(oldSchema!==WORLD_RENDER_SCHEMA){
    worldStateCache={maps:{},planets:{}};
    localStorage.setItem('magicWorldRenderSchema',String(WORLD_RENDER_SCHEMA));
  }
}catch(_){}

let simAutoTimer=null;
let simState={
  year:0,events:[],civ:'',era:'Founding',population:100000,stability:70,knowledge:5,economy:15,danger:5,technology:4,
  institutions:[],discoveries:[],industries:[],crises:[],laws:[],factions:[],regions:[],research:[],professions:[],
  civNodes:[],civEdges:[],chainState:{},organizationState:{},rapidEvents:[]
,planet:null,locations:[],spaceMap:null,worldEffects:{},resourceStates:{},placeStates:{},activeEffects:[],territoryHistory:[]};
function pick(arr){return arr.length?arr[Math.floor(Math.random()*arr.length)]:null}
function chance(p){return Math.random()<p}
function clamp(v,a=0,b=100){return Math.max(a,Math.min(b,v))}

/* V16 stable extensions */
const V16_PROC={
  spellClasses:['Charm','Ward','Transfiguration','Divination','Binding','Elemental','Illusion','Restoration','Motion','Conjuration','Detection','Mindcraft'],
  intents:['Reveal','Protect','Transform','Move','Illuminate','Bind','Repair','Conceal','Calm','Amplify','Dispel','Summon'],
  structures:['Beam','Radial','Touch','Field','Pulse','Chain','Cone','Sigil','Wave','Orbit'],
  outputs:['Light','Force','Heat','Cold','Information','Barrier','Matter','Motion','Sound','Memory','Growth','Mist'],
  spellA:['Astra','Vera','Luma','Mora','Cindra','Vel','Aero','Noxa','Sera','Tera','Elda','Iris','Vita','Umbra'],
  spellB:['lux','veil','mora','aris','bind','sight','ward','flare','shift','pulse','mend','step','ora','ium'],
  materials:['Moonstone','Sunsteel','Whisperglass','Aether Quartz','Gravemoss','Starwood','Ember Salt','Veil Crystal','Silverroot','Dream Amber'],
  techniques:['Silent Casting','Resonant Casting','Twin-Focus Method','Intent Compression','Wandless Shaping','Memory Anchoring','Pulse Casting'],
  principles:['Principle of Resonance','Law of Arcane Conservation','Principle of Sympathy','Law of Intent','Principle of Living Mana','Boundary of Identity'],
  institutions:['Arcane Ministry','College of Applied Magic','Guild of Enchanters','Council of Magical Safety','Royal Academy','Department of Magical Ecology'],
  life:['Glowmoss','Ashwing','Moonhart','Glassfin','Aethervine','Whisper Owl','Ember Moth','Mist Stag']
};
const v16Pick=a=>a[Math.floor(Math.random()*a.length)];
function v16WorldName(){return v16Pick(['Aether','Eldra','Veyra','Solune','Meridia','Cael','Nemor','Orinth','Valora','Thalen'])+v16Pick(['ia','on','is','ara','eth','or','um','ea'])}
function v16Unique(base){let n=base,i=2;while(nodes.some(x=>String(x.name).toLowerCase()===String(n).toLowerCase()))n=base+' '+i++;return n}

function generateProceduralMagicSystem(){
  const ok=nodes.length<=1||confirm('Generate a new procedural magic system? This replaces the current graph except for Mana.');
  if(!ok)return;
  checkpointHistory();

  const mana=byId('mana')||{id:'mana',type:'mana',name:'MANA',x:0,y:0,vx:0,vy:0,r:45,fixed:true,description:'The magical source from which this system grows.'};
  nodes=[mana];edges=[];selected=null;graph.selected=null;

  const classes=[];
  while(classes.length<5){
    const c=v16Pick(V16_PROC.spellClasses);
    if(!classes.includes(c))classes.push(c);
  }

  for(const cls of classes){
    const count=2+Math.floor(Math.random()*4);
    for(let i=0;i<count;i++)nodes.push({
      id:uid(),type:'spell',name:v16Unique(v16Pick(V16_PROC.spellA)+v16Pick(V16_PROC.spellB)),
      spellClass:cls,intent:v16Pick(V16_PROC.intents),structure:v16Pick(V16_PROC.structures),
      target:v16Pick(['Self','Creature','Object','Area','Visible target']),output:v16Pick(V16_PROC.outputs),
      duration:v16Pick(['Instant','3 s','20 s','Sustained','1 minute']),range:v16Pick(['Touch','5 m','15 m','Line of sight','Room-wide']),
      source:mana.name||'Mana',morality:Math.round(Math.random()*200-100),extra:'Procedurally generated magical practice.',
      x:(Math.random()-.5)*600,y:(Math.random()-.5)*450,vx:0,vy:0,r:17
    });

    nodes.push({
      id:uid(),type:'rule',name:v16Unique('Rule of '+cls),strength:v16Pick(['Absolute','Strong','Flexible']),
      spellClass:cls,text:`${cls} magic is constrained by ${v16Pick(['conservation','intent stability','target identity','resonance','material compatibility'])}.`,
      scope:cls+' spells',exceptions:Math.random()<.5?'Rare exceptions exist under extreme magical conditions.':'',spellIds:[],
      x:(Math.random()-.5)*700,y:(Math.random()-.5)*500,vx:0,vy:0,r:16
    });
  }

  for(let i=0;i<4;i++)nodes.push({
    id:uid(),type:'material',name:v16Unique(v16Pick(V16_PROC.materials)),category:v16Pick(['Crystal','Metal','Organic','Alchemical']),
    composition:'Mana-rich natural substance',property:v16Pick(['Stores magical energy','Amplifies precise casting','Suppresses unstable magic','Resonates with living mana']),
    requirements:'Requires harvesting and refinement',uses:v16Pick(classes),interaction:'Behavior changes under magical stress.',
    description:'Procedurally generated magical material.',x:(Math.random()-.5)*700,y:(Math.random()-.5)*500,vx:0,vy:0,r:16
  });

  const hubName=v16Pick(['Potions','Wands','Artifacts','Enchanted Devices']);
  nodes.push({
    id:uid(),type:'magicalObject',name:hubName,isHub:true,hubType:'magicalObject',category:'Magical Object',
    composition:'Varies by member',property:'Major family of magical objects',requirements:'Mana',uses:'All Classes',
    interaction:'Varies',description:'Procedurally generated object family.',x:260,y:220,vx:0,vy:0,r:30
  });
  for(let i=0;i<4;i++)nodes.push({
    id:uid(),type:'magicalObject',name:v16Unique(hubName==='Potions'?v16Pick(['Verity Draught','Wolfsbane Tonic','Dreamwater','Ember Elixir']):v16Pick(V16_PROC.materials)+' Focus'),
    category:hubName,composition:v16Pick(V16_PROC.materials)+' + '+v16Pick(V16_PROC.materials),
    property:v16Pick(['Reveals hidden information','Stabilizes transformations','Stores a spell','Amplifies magical output','Protects the user']),
    requirements:'Mana and trained preparation',uses:v16Pick(classes),interaction:'Regulated in some societies.',
    description:'Procedurally generated magical object.',x:260+(Math.random()-.5)*180,y:220+(Math.random()-.5)*160,vx:0,vy:0,r:16
  });

  for(let i=0;i<3;i++)nodes.push({id:uid(),type:'technique',name:v16Unique(v16Pick(V16_PROC.techniques)),category:'Casting Method',composition:'Training + controlled mana flow',property:'Improves magical execution',requirements:'Practice and concentration',uses:v16Pick(classes),interaction:'Difficulty rises with complex spells.',description:'Procedurally generated technique.',x:(Math.random()-.5)*700,y:(Math.random()-.5)*500,vx:0,vy:0,r:16});
  for(let i=0;i<3;i++)nodes.push({id:uid(),type:'principle',name:v16Unique(v16Pick(V16_PROC.principles)),category:'Fundamental Theory',composition:'Observed magical behavior',property:'Explains a fundamental interaction',requirements:'Stable magical observation',uses:'All Classes',interaction:'Can create exceptions and edge cases.',description:'Procedurally generated magical principle.',x:(Math.random()-.5)*700,y:(Math.random()-.5)*500,vx:0,vy:0,r:16});
  for(let i=0;i<2;i++)nodes.push({id:uid(),type:'structure',name:v16Unique(v16Pick(V16_PROC.institutions)),category:v16Pick(['Government','Academy','Guild','Research Organization']),composition:'Magical staff + administration',property:'Organizes magical society',requirements:'Population and legal authority',uses:'All Classes',interaction:'Shapes education and magical law.',description:'Procedurally generated magical institution.',x:(Math.random()-.5)*700,y:(Math.random()-.5)*500,vx:0,vy:0,r:16});
  for(let i=0;i<3;i++)nodes.push({
    id:uid(),type:'life',name:v16Unique(v16Pick(V16_PROC.life)),
    category:v16Pick(['Magical Creature','Magical Plant','Spirit']),
    composition:'Living tissue + innate mana',
    property:v16Pick(['Stores ambient mana','Produces magical heat','Detects enchantments','Distorts nearby spells']),
    requirements:'Mana-rich habitat',uses:v16Pick(classes),
    interaction:'Part of the magical ecosystem.',description:'Procedurally generated magical life.',
    sentient:i<2,main:i===0,relationshipWithMain:i===1?Math.floor(Math.random()*161)-80:0,
    x:(Math.random()-.5)*700,y:(Math.random()-.5)*500,vx:0,vy:0,r:16
  });

  for(let i=0;i<3;i++)nodes.push({
    id:uid(),type:'place',name:v16Unique(v16Pick(['Arcane Capital','Moonvale Academy','Whisperwood','Aether Crossing','Old Mana Ruins'])),
    placeType:v16Pick(['City','School','Wilderness','Settlement','Ruins']),
    inhabitants:i===0?(ofType('life').find(x=>x.main)?.name||'Magical people'):'',
    government:i===0?'Arcane Council':'',
    access:'Varies by location',
    associations:v16Pick(classes),
    interaction:'Local magical conditions influence society.',
    description:'Procedurally generated place.',
    category:'Place',composition:'',property:'',requirements:'',uses:v16Pick(classes),
    x:(Math.random()-.5)*700,y:(Math.random()-.5)*500,vx:0,vy:0,r:16
  });

  // ---------------- V22.6b MODERN WORLD LAYER ----------------
  // Give the generated magic system enough civilization/world structure for
  // the modern Simulation, Organization, Place and Civilization Utility tools.

  const procLife=ofType('life');
  const mainLife=procLife.find(l=>l.main)||procLife.find(l=>l.sentient)||procLife[0];

  const galaxy={
    id:uid(),type:'place',name:v16Unique(v16Pick(['Aetheria Galaxy','Luminous Reach','Veyran Expanse'])),
    placeType:'Galaxy',placeScale:'galaxy',category:'Place',
    inhabitants:'',government:'',access:'Interstellar travel',associations:'Magic; Civilization',
    interaction:'Contains many magical systems and civilizations.',
    description:'A procedurally generated galaxy containing the primary civilization.',
    x:-420,y:300,vx:0,vy:0,r:24
  };
  const system={
    id:uid(),type:'place',name:v16Unique(v16Pick(['Solune System','Aether System','Meridia System'])),
    placeType:'Solar System',placeScale:'solar-system',category:'Place',
    inhabitants:'',government:'',access:'Spaceflight or magical transit',associations:'Civilization',
    interaction:'Primary inhabited star system.',
    description:'A procedurally generated star system.',
    x:-330,y:300,vx:0,vy:0,r:22
  };
  const star={
    id:uid(),type:'place',name:v16Unique(v16Pick(['Cael','Aster','Orinth'])+' Star'),
    placeType:'Star',placeScale:'star',category:'Place',
    inhabitants:'',government:'',access:'Orbital space',associations:'Solar System',
    interaction:'Provides light and energy.',
    description:'The primary star of the generated system.',
    starColor:v16Pick(['#ffe5aa','#fff2d4','#d6e8ff','#ffd2a1']),
    starSize:.8+Math.random()*.45,
    x:-230,y:300,vx:0,vy:0,r:20
  };
  const planet={
    id:uid(),type:'place',name:v16Unique(v16WorldName()),
    placeType:'Planet',placeScale:'planet',category:'Place',
    inhabitants:mainLife?.name||'Magical life',
    government:'',access:'Interplanetary travel',
    associations:`${mainLife?.name||''}; Magic; Civilization`,
    interaction:'The principal inhabited world of this generated setting.',
    description:'A procedurally generated inhabited magical world.',
    terrainSeed:Math.floor(Math.random()*1e9),
    x:-120,y:300,vx:0,vy:0,r:21
  };
  nodes.push(galaxy,system,star,planet);

  const contain=(parent,child)=>edges.push({
    id:uid(),a:parent.id,b:child.id,type:'placeContainment',linkType:'relationship',
    label:'Contains',direction:'forward',manual:true,placeContainment:true,
    strength:'solid',thickness:1.7
  });
  contain(galaxy,system);contain(system,star);contain(system,planet);

  // Attach the pre-existing procedural surface Places to the generated Planet.
  for(const p of ofType('place')){
    if([galaxy.id,system.id,star.id,planet.id].includes(p.id))continue;
    if(placeRank(p)>=placeRank(planet))continue;
    contain(planet,p)
  }

  const orgNames=[
    ['Aetherian Crown','Kingdom','Maintain magical stability and protect inhabited territories.'],
    ['Moonstone Guild','Guild','Mine, refine and trade magical materials.'],
    ['Arcane Concord','Research Organization','Study magical principles and coordinate safe research.']
  ];
  const procOrgs=orgNames.map(([name,type,purpose],i)=>{
    const n={
      id:uid(),type:'organization',name:v16Unique(name),
      organizationType:type,category:type,
      organizationPurpose:purpose,property:purpose,
      organizationMembers:[850000,42000,9800][i],
      organizationCapital:i===0?planet.name:v16Pick(ofType('place').filter(p=>placeRank(p)<placeRank(planet)))?.name||planet.name,
      organizationResources:i===1?`${ofType('material')[0]?.name||'Magical materials'}; enchanted tools`:'Knowledge; magical services',
      description:`Procedurally generated ${type.toLowerCase()} participating in civilization simulation.`,
      x:80+i*100,y:330+i*38,vx:0,vy:0,r:18
    };
    nodes.push(n);return n
  });

  // First organization governs the home world; others receive local footholds.
  planet.ownerFactionId=procOrgs[0].id;
  planet.government=procOrgs[0].name;
  for(const [i,org] of procOrgs.entries()){
    edges.push({
      id:uid(),a:org.id,b:(i===0?planet:ofType('place').filter(p=>placeRank(p)<placeRank(planet))[i%Math.max(1,ofType('place').filter(p=>placeRank(p)<placeRank(planet)).length)]||planet).id,
      type:'organizationPlace',linkType:'relationship',label:i===0?'Governs':'Operates In',
      direction:'forward',manual:true,strength:'solid',thickness:1.6
    })
  }
  setOrganizationRelationship(procOrgs[0],procOrgs[1],35+Math.floor(Math.random()*31));
  setOrganizationRelationship(procOrgs[0],procOrgs[2],55+Math.floor(Math.random()*31));
  setOrganizationRelationship(procOrgs[1],procOrgs[2],10+Math.floor(Math.random()*41));

  const language={
    id:uid(),type:'civilizationUtil',utilityType:'language',category:'Language',
    name:v16Unique(v16Pick(['Aetheric','Lumen Speech','Veyran'])),
    languageDirection:'Left → Right',
    languageMappingGroups:{
      symbolSymbol:[{from:'A',to:'△'},{from:'S',to:'ϟ'}],
      symbolSound:[{from:'△',to:'ah'},{from:'ϟ',to:'sh'}],
      wordWord:[{from:'light',to:'luma'},{from:'magic',to:'aeth'}],
      phrasePhrase:[{from:'safe travels',to:'luma vael'}]
    },
    description:'The primary procedurally generated language of the civilization.',
    x:300,y:260,vx:0,vy:0,r:16
  };
  const currency={
    id:uid(),type:'civilizationUtil',utilityType:'currency',category:'Currency',
    name:v16Unique(v16Pick(['Aether Crowns','Lumen Marks','Arcane Credits'])),
    currencySymbol:v16Pick(['AC','LM','¤']),
    usdEquivalent:+(.3+Math.random()*4.7).toFixed(2),
    currencySubdivision:'100 minor units = 1 primary unit',
    currencyForm:v16Pick(['Physical','Digital','Magical','Mixed']),
    currencyStability:v16Pick(['Stable','Floating','Volatile']),
    currencyBacking:Math.random()<.5?(ofType('material')[0]?.name||'Magical reserves'):procOrgs[0].name,
    description:'Primary exchange currency of the generated civilization.',
    x:340,y:300,vx:0,vy:0,r:16
  };
  const disease={
    id:uid(),type:'civilizationUtil',utilityType:'disease',category:'Disease',
    name:v16Unique(v16Pick(['Frostlung','Mana Fever','Glassblight'])),
    diseaseSpread:v16Pick(['Low','Moderate','High']),
    diseaseSeverity:v16Pick(['Mild','Moderate','Serious']),
    diseaseDuration:v16Pick(['Short','Medium','Long']),
    diseaseMortality:Math.floor(Math.random()*24),
    diseaseCure:ofType('material')[1]?.name||'Magical treatment',
    diseaseOrigin:planet.name,
    description:'A procedurally generated disease used by ecology and history simulation.',
    x:380,y:340,vx:0,vy:0,r:16
  };
  const calendar={
    id:uid(),type:'civilizationUtil',utilityType:'calendar',category:'Calendar',
    name:v16Unique('Aetherian Calendar'),calendarDays:360+Math.floor(Math.random()*21),
    calendarMonths:'Dawnrise; Highsun; Emberfall; Frostwane',
    calendarEra:'After Founding',calendarHolidays:'Founding Day; Festival of Light',
    description:'The primary civil calendar.',x:420,y:380,vx:0,vy:0,r:16
  };
  const legal={
    id:uid(),type:'civilizationUtil',utilityType:'legalCode',category:'Legal Code',
    name:v16Unique('Arcane Civic Code'),
    legalLaws:'Dangerous public casting requires authorization; magical fraud is prohibited.',
    legalRights:'Right to magical education; protection from coercive enchantment.',
    legalEnforcement:procOrgs[0].name,
    description:'A generated legal framework for magical society.',
    x:460,y:420,vx:0,vy:0,r:16
  };
  const ranks={
    id:uid(),type:'civilizationUtil',utilityType:'rankSystem',category:'Rank System',
    name:v16Unique('Arcane Service Ranks'),
    rankEntries:'Initiate\nAdept\nSenior Adept\nMaster\nHigh Master',
    rankPromotion:'Training, demonstrated ability and public service.',
    description:'A generated civilization rank hierarchy.',
    x:500,y:460,vx:0,vy:0,r:16
  };
  const communication={
    id:uid(),type:'civilizationUtil',utilityType:'communication',category:'Communication System',
    name:v16Unique('Aether Relay'),
    communicationMedium:v16Pick(['Enchanted mirrors','Mana radio','Resonance crystals']),
    communicationRange:'Planetary with interstellar relay stations',
    communicationLatency:'Near-instant locally; delayed between systems',
    description:'A generated communication network.',
    x:540,y:500,vx:0,vy:0,r:16
  };
  nodes.push(language,currency,disease,calendar,legal,ranks,communication);

  const utilityEdge=(a,b,label)=>edges.push({
    id:uid(),a:a.id,b:b.id,type:'civilizationUtility',linkType:'relationship',
    label,direction:'forward',manual:true,strength:'solid',thickness:1.5
  });

  // Exclusive utility access: linked Life is the authorized/natural population.
  if(mainLife){
    utilityEdge(mainLife,language,'Speaks');
    utilityEdge(mainLife,currency,'Uses');
    utilityEdge(mainLife,calendar,'Uses Calendar');
    utilityEdge(mainLife,legal,'Subject To');
    utilityEdge(mainLife,ranks,'Uses Ranks');
    utilityEdge(mainLife,communication,'Communicates Via')
  }
  const creatureTarget=procLife.find(l=>!l.main&&!l.individual&&/creature|spirit|animal|beast/i.test(l.category||''))||procLife.at(-1);
  if(creatureTarget)utilityEdge(creatureTarget,disease,'Susceptible To');

  for(const org of procOrgs){
    utilityEdge(org,currency,'Uses');
    utilityEdge(org,language,'Official Language');
    utilityEdge(org,calendar,'Uses Calendar')
  }

  // Prices connect Materials to the generated currency.
  for(const [i,mat] of ofType('material').entries()){
    const amount=Math.round((25+Math.random()*1800)*(i+1));
    mat.currencyPrices=[...(mat.currencyPrices||[]),{currencyId:currency.id,amount}];
    utilityEdge(mat,currency,'Priced In')
  }

  // Give generated magical objects explicit wielders when suitable.
  const wielders=procLife.filter(l=>l.sentient||l.main);
  if(wielders.length){
    for(const obj of ofType('magicalObject').filter(o=>!o.isHub)){
      const wielder=v16Pick(wielders);
      edges.push({
        id:uid(),a:wielder.id,b:obj.id,type:'exclusiveAccess',linkType:'relationship',
        label:'Wields',direction:'forward',manual:true,strength:'solid',thickness:1.45
      })
    }
  }

  // Link creatures to a physical world so ecology restrictions can operate.
  for(const life of procLife.filter(l=>!l.individual)){
    edges.push({
      id:uid(),a:life.id,b:planet.id,type:'lifeHabitat',linkType:'relationship',
      label:'Native To',direction:'forward',manual:true,strength:'solid',thickness:1.4
    })
  }
  // ---------------- END V22.6b MODERN WORLD LAYER ----------------

  rebuildEdges();renderLibraries();organize();graph.setData(nodes,edges.filter(e=>!e.blocked));graph.fit();showSelection();save();
}

let planetView={yaw:0,pitch:-.12,zoom:1,panX:0,panY:0,drag:false,dragMode:'rotate',lastX:0,lastY:0};
let planetSpacePan=false;
let planetTerrainCache=[];
let planetDrawQueued=false;
let planetLastFrame=0;

function planetNoise(x,y,seed){const s=Math.sin(x*12.9898+y*78.233+seed*37.719)*43758.5453;return s-Math.floor(s)}
function planetSmooth(lat,lon,seed){let v=0,w=0;for(let o=1;o<=4;o++){const f=2**(o-1),a=1/f;v+=planetNoise(Math.sin(lon*f)*2.3+lat*f,Math.cos(lat*f)*2.1+lon*f,seed+o)*a;w+=a}return v/w}
function angularDistance(lat1,lon1,lat2,lon2){
  const s1=Math.sin(lat1),s2=Math.sin(lat2),c1=Math.cos(lat1),c2=Math.cos(lat2);
  const dlon=lon1-lon2;
  return Math.acos(Math.max(-1,Math.min(1,s1*s2+c1*c2*Math.cos(dlon))));
}
function buildContinents(seed,count){
  const continents=[];
  let attempts=0;

  while(continents.length<count&&attempts<500){
    attempts++;
    const lat=(Math.random()-.5)*Math.PI*1.25;
    const lon=(Math.random()*2-1)*Math.PI;
    const radius=.42+Math.random()*.34;

    // Keep major continent seeds fairly separated so they form distinct,
    // readable landmasses instead of one noisy global blob.
    const tooClose=continents.some(c=>angularDistance(lat,lon,c.lat,c.lon)<(radius+c.radius)*.72);
    if(tooClose)continue;

    const lobes=[];
    const lobeCount=3+Math.floor(Math.random()*4);
    for(let i=0;i<lobeCount;i++){
      const a=Math.random()*Math.PI*2;
      const d=radius*(.15+Math.random()*.42);
      lobes.push({
        lat:Math.max(-1.42,Math.min(1.42,lat+Math.sin(a)*d*.72)),
        lon:lon+Math.cos(a)*d,
        radius:radius*(.28+Math.random()*.34)
      });
    }

    continents.push({
      lat,lon,radius,
      warpA:Math.random()*Math.PI*2,
      warpB:Math.random()*Math.PI*2,
      lobes
    });
  }

  // Sparse islands: enough for visual variety, but not enough to create
  // disconnected-rectangle confetti.
  const islands=[];
  const islandCount=Math.max(3,Math.floor(count*1.6));
  for(let i=0;i<islandCount;i++){
    const parent=continents[Math.floor(Math.random()*continents.length)];
    const a=Math.random()*Math.PI*2;
    const d=parent.radius*(1.05+Math.random()*.95);
    islands.push({
      lat:Math.max(-1.48,Math.min(1.48,parent.lat+Math.sin(a)*d*.7)),
      lon:parent.lon+Math.cos(a)*d,
      radius:.07+Math.random()*.12
    });
  }

  return {continents,islands};
}

function buildPlanetTerrainCache(){
  planetTerrainCache=[];
  if(!simState.planet)return;

  const latSteps=32,lonSteps=64;

  // Gas giants have no land/ocean surface. The same spherical mesh becomes
  // continuous atmospheric bands, so megastructures and events still use the
  // ordinary Planet renderer/navigation.
  if(simState.planet.gasGiant){
    const colors=[
      simState.planet.gasColor||'#d6b783',
      simState.planet.gasColor2||'#a87a58',
      simState.planet.gasColor3||'#eee0b5'
    ];
    const contrast=Math.max(0,Math.min(100,simState.planet.gasContrast??55))/100;
    for(let yi=0;yi<latSteps;yi++){
      const lat0=-Math.PI/2+yi/latSteps*Math.PI;
      const lat1=-Math.PI/2+(yi+1)/latSteps*Math.PI;
      const midLat=(lat0+lat1)/2;
      for(let xi=0;xi<lonSteps;xi++){
        const lon0=-Math.PI+xi/lonSteps*Math.PI*2;
        const lon1=-Math.PI+(xi+1)/lonSteps*Math.PI*2;
        const midLon=(lon0+lon1)/2;
        const wave=Math.sin(midLat*18+planetSmooth(midLat*2,midLon*1.2,simState.planet.seed+455)*5);
        const fine=Math.sin(midLat*41+midLon*.65)*contrast;
        const idx=wave+fine>.55?2:wave<-.28?1:0;
        planetTerrainCache.push({lat0,lat1,lon0,lon1,midLat,midLon,color:colors[idx],gasBand:true})
      }
    }
    return
  }

  for(let yi=0;yi<latSteps;yi++){
    const lat0=-Math.PI/2+yi/latSteps*Math.PI;
    const lat1=-Math.PI/2+(yi+1)/latSteps*Math.PI;
    const midLat=(lat0+lat1)/2;

    for(let xi=0;xi<lonSteps;xi++){
      const lon0=-Math.PI+xi/lonSteps*Math.PI*2;
      const lon1=-Math.PI+(xi+1)/lonSteps*Math.PI*2;
      const midLon=(lon0+lon1)/2;

      const threshold=planetLandThreshold();
      const centerField=planetLandValue(midLat,midLon);
      const cornerHits=[
        planetLandValue(lat0,lon0),
        planetLandValue(lat0,lon1),
        planetLandValue(lat1,lon1),
        planetLandValue(lat1,lon0)
      ].filter(v=>v>threshold).length;

      if(simState.planet?.landEnabled===false)continue;
      if(!(simState.planet?.oceanEnabled===false||centerField>threshold+.012||cornerHits>=2))continue;

      const n=planetSmooth(midLat*2.25,midLon*2.25,simState.planet.seed+99);
      const moist=planetSmooth(midLat*3.1,midLon*3.1,simState.planet.seed+301);
      const polar=Math.abs(midLat)>1.22;

      let color;
      if(polar)color='#cad9df';
      else if(n>.76)color='#7b7468';
      else if(moist>.66)color='#4f7248';
      else if(moist<.34)color='#8d8655';
      else color=n>.58?'#78915b':'#58744d';

      if(simState.planet?.landColor&&planetIsLand(midLat,midLon)){
        const palette=[
          simState.planet.landColor||'#5d8f5a',
          simState.planet.landColor2||'#78915b',
          simState.planet.landColor3||'#8d8655'
        ];
        color=palette[n>.68?2:moist>.54?1:0];
      }
      if(simState.planet?.oceanEnabled===false)color=simState.planet?.landColor||'#8a7654';
      planetTerrainCache.push({lat0,lat1,lon0,lon1,midLat,midLon,color});
    }
  }
}
function requestPlanetDraw(){
  if(planetDrawQueued)return;
  planetDrawQueued=true;
  requestAnimationFrame(t=>{
    planetDrawQueued=false;
    planetLastFrame=t;
    drawPlanet();
  });
}

function generatePlanet(forcePlanet=false,forceRegenerate=false){
  if(!forcePlanet&&mapDisplayLevel()!=='planet'){generateScaleMap('',forceRegenerate);refreshWorldMapMode();requestPlanetDraw();return}

  const key=planetWorldKey();
  if(!forceRegenerate&&worldStateCache.planets[key]){
    const cached=worldStateCache.planets[key];
    simState.planet=deepCloneState(cached.planet);
    simState.locations=deepCloneState(cached.locations||[]);
    if(simState.planetOverride){
      simState.planet.name=simState.planetOverride.name||simState.planet.name;
      simState.planet.landColor=simState.planetOverride.landColor;
      simState.planet.landColor2=simState.planetOverride.landColor2;
      simState.planet.landColor3=simState.planetOverride.landColor3;
      simState.planet.oceanColor=simState.planetOverride.oceanColor;
      simState.planet.oceanColor2=simState.planetOverride.oceanColor2;
    simState.planet.isMoon=!!simState.planetOverride.isMoon;
    simState.planet.orbitingId=simState.planetOverride.orbitingId||null;
    simState.planet.gasGiant=!!simState.planetOverride.gasGiant;
    simState.planet.gasColor=simState.planetOverride.gasColor;
    simState.planet.gasColor2=simState.planetOverride.gasColor2;
    simState.planet.gasColor3=simState.planetOverride.gasColor3;
    simState.planet.gasContrast=simState.planetOverride.gasContrast;
      simState.planet.isMoon=!!simState.planetOverride.isMoon;
      simState.planet.orbitingId=simState.planetOverride.orbitingId||null;
      simState.planet.gasGiant=!!simState.planetOverride.gasGiant;
      simState.planet.gasColor=simState.planetOverride.gasColor;
      simState.planet.gasColor2=simState.planetOverride.gasColor2;
      simState.planet.gasColor3=simState.planetOverride.gasColor3;
      simState.planet.gasContrast=simState.planetOverride.gasContrast;
      simState.planet.landCoverage=simState.planetOverride.landCoverage;
      simState.planet.landEnabled=simState.planetOverride.landEnabled;
      simState.planet.oceanEnabled=simState.planetOverride.oceanEnabled;
      simState.planet.cloudsEnabled=simState.planetOverride.cloudsEnabled;
      simState.planet.cloudColor=simState.planetOverride.cloudColor;
      simState.planet.cloudCoverage=simState.planetOverride.cloudCoverage;
      simState.planet.cloudOpacity=simState.planetOverride.cloudOpacity;
    }
    buildPlanetTerrainCache();
    sanitizePlanetLocations();
    planetView={yaw:0,pitch:-.12,zoom:1,panX:0,panY:0,drag:false,dragMode:'rotate',lastX:0,lastY:0};
    $('planetName').textContent=simState.planet.name;
    $('planetMeta').textContent=`${simState.planet.gasGiant?'Gas Giant':simState.planet.isMoon?'Moon':`${simState.planet.continents||0} major continents · ${(simState.planet.islandData||[]).length} island groups`} · ${simState.planetOverride?.inhabitants||'Inhabited'} · seed ${simState.planet.seed}`;
    return;
  }

  const seed=Math.floor(Math.random()*1e9);
  const name=v16WorldName();
  const continentCount=3+Math.floor(Math.random()*4);
  const structure=buildContinents(seed,continentCount);

  simState.planet={
    seed,name,
    continents:continentCount,
    continentData:structure.continents,
    islandData:structure.islands
  };
  if(simState.planetOverride){
    simState.planet.name=simState.planetOverride.name||simState.planet.name;
    simState.planet.landColor=simState.planetOverride.landColor;
    simState.planet.landColor2=simState.planetOverride.landColor2;
    simState.planet.landColor3=simState.planetOverride.landColor3;
    simState.planet.oceanColor=simState.planetOverride.oceanColor;
    simState.planet.oceanColor2=simState.planetOverride.oceanColor2;
    simState.planet.isMoon=!!simState.planetOverride.isMoon;
    simState.planet.orbitingId=simState.planetOverride.orbitingId||null;
    simState.planet.gasGiant=!!simState.planetOverride.gasGiant;
    simState.planet.gasColor=simState.planetOverride.gasColor;
    simState.planet.gasColor2=simState.planetOverride.gasColor2;
    simState.planet.gasColor3=simState.planetOverride.gasColor3;
    simState.planet.gasContrast=simState.planetOverride.gasContrast;
    simState.planet.landCoverage=simState.planetOverride.landCoverage;
    simState.planet.landEnabled=simState.planetOverride.landEnabled;
    simState.planet.oceanEnabled=simState.planetOverride.oceanEnabled;
      simState.planet.cloudsEnabled=simState.planetOverride.cloudsEnabled;
      simState.planet.cloudColor=simState.planetOverride.cloudColor;
      simState.planet.cloudCoverage=simState.planetOverride.cloudCoverage;
      simState.planet.cloudOpacity=simState.planetOverride.cloudOpacity;
  }
  simState.locations=[];
  buildPlanetTerrainCache();

  planetView={
    yaw:0,pitch:-.12,zoom:1,
    panX:0,panY:0,
    drag:false,dragMode:'rotate',
    lastX:0,lastY:0
  };

  $('planetName').textContent=name;
  $('planetMeta').textContent=`${simState.planet.gasGiant?'Gas Giant':simState.planet.isMoon?'Moon':`${continentCount} major continents · ${structure.islands.length} island groups`} · ${simState.planetOverride?.inhabitants||'Inhabited'} · seed ${seed}`;
  generateWorldLocations();
  cacheCurrentPlanet();
  save();
}
function continentField(lat,lon,c,seed,index){
  const d=angularDistance(lat,lon,c.lat,c.lon);

  // Organic coastline deformation at continent scale.
  const wave=
    Math.sin((lon-c.lon)*5.2+c.warpA)*.055+
    Math.cos((lat-c.lat)*6.4+c.warpB)*.045+
    (planetSmooth(lat*1.45,lon*1.45,seed+index*71)-.5)*.16;

  let field=c.radius+wave-d;

  // Secondary lobes create peninsulas / subcontinents while remaining attached.
  for(const l of c.lobes){
    const ld=angularDistance(lat,lon,l.lat,l.lon);
    field=Math.max(field,l.radius-ld);
  }

  return field;
}
function planetLandValue(lat,lon){
  const p=simState.planet;
  if(!p)return -1;

  let field=-99;
  for(let i=0;i<(p.continentData||[]).length;i++){
    field=Math.max(field,continentField(lat,lon,p.continentData[i],p.seed,i));
  }

  for(const island of p.islandData||[]){
    const d=angularDistance(lat,lon,island.lat,island.lon);
    const wobble=(planetSmooth(lat*4.8,lon*4.8,p.seed+900)-.5)*.035;
    field=Math.max(field,island.radius+wobble-d);
  }

  // Reduce giant polar continents.
  field-=Math.max(0,Math.abs(lat)-1.28)*.45;

  return field;
}
function planetLandThreshold(){
  const coverage=Math.max(0,Math.min(100,Number(simState.planet?.landCoverage??45)));
  // Higher requested land coverage lowers the field threshold.
  return (45-coverage)*.006;
}
function planetIsLand(lat,lon){
  if(simState.planet?.gasGiant)return false;
  if(simState.planet?.landEnabled===false)return false;
  if(simState.planet?.oceanEnabled===false)return true;
  return planetLandValue(lat,lon)>planetLandThreshold();
}
function randomLandPoint(){
  for(let i=0;i<1200;i++){
    const lat=(Math.random()-.5)*Math.PI;
    const lon=(Math.random()*2-1)*Math.PI;
    if(planetIsLand(lat,lon))return{lat,lon};
  }

  const c=simState.planet?.continentData?.[0];
  return c?{lat:c.lat,lon:c.lon}:{lat:0,lon:0};
}
const planetIcon=t=>({academy:'🎓',ministry:'🏛',industry:'◆',city:'⌂',settlement:'⌂',life:'♧',research:'⚗',danger:'⚠',ruin:'◈'}[t]||'•');
let megaPainterState={
  tool:'brush',mode:'paint',drawing:false,start:null,current:null,
  commands:[],heightCommands:[],imports:[],activeImport:null,
  paintFill:null,heightFill:0,
  eraserMode:'object',
  undoStack:[],redoStack:[],
  importImageCache:new Map(),expanded:false
};
function megaPainterSnapshot(){
  return {
    commands:deepCloneState(megaPainterState.commands),
    heightCommands:deepCloneState(megaPainterState.heightCommands),
    imports:deepCloneState(megaPainterState.imports),
    paintFill:megaPainterState.paintFill,
    heightFill:megaPainterState.heightFill
  }
}
function restoreMegaPainterSnapshot(s){
  if(!s)return;
  megaPainterState.commands=deepCloneState(s.commands||[]);
  megaPainterState.heightCommands=deepCloneState(s.heightCommands||[]);
  megaPainterState.imports=deepCloneState(s.imports||[]);
  megaPainterState.paintFill=s.paintFill??null;
  megaPainterState.heightFill=Number.isFinite(+s.heightFill)?+s.heightFill:0;
  megaPainterState.activeImport=null;
  renderMegaPainter()
}
function pushMegaPainterHistory(){
  megaPainterState.undoStack.push(megaPainterSnapshot());
  if(megaPainterState.undoStack.length>80)megaPainterState.undoStack.shift();
  megaPainterState.redoStack=[]
}
function megaPainterUndo(){
  if(!megaPainterState.undoStack.length)return;
  megaPainterState.redoStack.push(megaPainterSnapshot());
  restoreMegaPainterSnapshot(megaPainterState.undoStack.pop())
}
function megaPainterRedo(){
  if(!megaPainterState.redoStack.length)return;
  megaPainterState.undoStack.push(megaPainterSnapshot());
  restoreMegaPainterSnapshot(megaPainterState.redoStack.pop())
}

function megaPaintCanvas(){return $('megaPaintCanvas')}
function megaPaintPoint(e){
  const c=megaPaintCanvas(),r=c.getBoundingClientRect();
  return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height}
}
function loadMegaImportImage(src){
  if(!src)return null;
  if(megaPainterState.importImageCache.has(src))return megaPainterState.importImageCache.get(src);
  const img=new Image();img.onload=()=>{renderMegaPainter();renderMegaIconPreview()};
  img.src=src;megaPainterState.importImageCache.set(src,img);return img
}
function drawMegaVectorCommand(ctx,cmd,w,h,heightMode=false){
  if(!cmd)return;
  const P=v=>({x:v.x*w,y:v.y*h});
  ctx.save();
  const tone=heightMode
    ?(()=>{const v=Math.max(-100,Math.min(100,cmd.height||0)),g=Math.round(128+v*1.27);return `rgb(${g},${g},${g})`})()
    :(cmd.color||'#6fdcff');
  ctx.strokeStyle=tone;ctx.fillStyle=tone;ctx.lineWidth=Math.max(1,cmd.width||4);
  ctx.lineCap='round';ctx.lineJoin='round';
  if(cmd.type==='brush'){
    const pts=cmd.points||[];if(pts.length){ctx.beginPath();let a=P(pts[0]);ctx.moveTo(a.x,a.y);for(const q of pts.slice(1)){a=P(q);ctx.lineTo(a.x,a.y)}ctx.stroke()}
  }else if(cmd.type==='line'){
    const a=P(cmd.a),b=P(cmd.b);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()
  }else if(cmd.type==='circle'){
    const a=P(cmd.a),b=P(cmd.b);ctx.beginPath();ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.max(1,Math.abs(b.x-a.x)/2),Math.max(1,Math.abs(b.y-a.y)/2),0,0,Math.PI*2);ctx.stroke()
  }else if(cmd.type==='rect'){
    const a=P(cmd.a),b=P(cmd.b);ctx.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y))
  }else if(cmd.type==='pixelErase'){
    const pts=cmd.points||[];
    if(pts.length){
      ctx.globalCompositeOperation='destination-out';
      ctx.strokeStyle='rgba(0,0,0,1)';ctx.fillStyle='rgba(0,0,0,1)';
      ctx.lineWidth=Math.max(1,cmd.width||8);ctx.lineCap='round';ctx.lineJoin='round';
      if(pts.length===1){
        const a=P(pts[0]);ctx.beginPath();ctx.arc(a.x,a.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill()
      }else{
        ctx.beginPath();let a=P(pts[0]);ctx.moveTo(a.x,a.y);
        for(const q of pts.slice(1)){a=P(q);ctx.lineTo(a.x,a.y)}
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}
function drawMegaImports(ctx,w,h){
  for(const imp of megaPainterState.imports){
    const img=loadMegaImportImage(imp.src);if(!img||!img.complete)continue;
    const iw=w*(imp.scale||.45),ih=iw*(img.naturalHeight/Math.max(1,img.naturalWidth));
    const x=imp.x*w-iw/2,y=imp.y*h-ih/2;
    ctx.save();ctx.globalAlpha=imp.opacity??1;ctx.drawImage(img,x,y,iw,ih);ctx.restore()
  }
}
function flattenMegaPaintLayerForEditing(){
  if(megaPainterState.mode!=='paint'||!megaPainterState.imports.length)return true;

  // All imported images must be loaded before flattening, otherwise wait for their
  // existing onload redraw and let the next click perform the edit.
  for(const imp of megaPainterState.imports){
    const img=loadMegaImportImage(imp.src);
    if(!img||!img.complete||!img.naturalWidth)return false
  }

  const W=768,H=384;
  const c=document.createElement('canvas');c.width=W;c.height=H;
  const ctx=c.getContext('2d');

  if(megaPainterState.paintFill){
    ctx.fillStyle=megaPainterState.paintFill;ctx.fillRect(0,0,W,H)
  }

  // Replay existing paint synchronously.
  for(const cmd of megaPainterState.commands){
    if(cmd.type==='floodFill')applyMegaFloodFillCommands(c,[cmd],false);
    else if(cmd.type==='rasterLayer')drawMegaRasterCommand(ctx,cmd,W,H);
    else drawMegaVectorCommand(ctx,cmd,W,H,false)
  }

  // Bake imports into those pixels.
  drawMegaImports(ctx,W,H);

  megaPainterState.commands=[megaCanvasToRasterCommand(c)];
  megaPainterState.imports=[];
  megaPainterState.activeImport=null;
  megaPainterState.paintFill=null;
  return true
}
function megaCanvasToRasterCommand(canvas){
  const src=canvas.toDataURL('image/png');
  const img=new Image();
  img.src=src;
  megaPainterState.importImageCache.set(src,img);
  return {type:'rasterLayer',src}
}
function drawMegaRasterCommand(ctx,cmd,w,h){
  if(!cmd?.src)return;
  let img=megaPainterState.importImageCache.get(cmd.src);
  if(!img){
    img=new Image();
    img.onload=()=>renderMegaPainter();
    img.src=cmd.src;
    megaPainterState.importImageCache.set(cmd.src,img)
  }
  if(img.complete&&img.naturalWidth)ctx.drawImage(img,0,0,w,h)
}
function megaFloodFillCurrentLayer(at,heightMode=false){
  const width=768,height=384;
  const c=heightMode?renderMegaHeightTexture(width,height):renderMegaSolidTexture(width,height);
  let fill=$('eMegaPaintColor').value;
  if(heightMode){
    const v=Math.max(-100,Math.min(100,+$('eMegaHeight').value||0));
    const g=Math.round(128+(v/100)*127);fill=`rgb(${g},${g},${g})`
  }
  megaFloodFillCanvas(c,at.x*width,at.y*height,fill,heightMode?8:14);
  return megaCanvasToRasterCommand(c)
}
function drawMegaBoundaryCommand(ctx,cmd,w,h){
  if(!cmd)return;
  const P=v=>({x:v.x*w,y:v.y*h});

  ctx.save();
  ctx.strokeStyle='#fff';
  ctx.fillStyle='#fff';
  ctx.lineWidth=1;
  ctx.lineCap='round';
  ctx.lineJoin='round';

  if(cmd.type==='brush'){
    const pts=cmd.points||[];
    if(pts.length===1){
      const a=P(pts[0]);
      ctx.beginPath();ctx.arc(a.x,a.y,.5,0,Math.PI*2);ctx.fill()
    }else if(pts.length>1){
      ctx.beginPath();
      let a=P(pts[0]);ctx.moveTo(a.x,a.y);
      for(const q of pts.slice(1)){a=P(q);ctx.lineTo(a.x,a.y)}
      ctx.stroke()
    }
  }else if(cmd.type==='line'){
    const a=P(cmd.a),b=P(cmd.b);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()
  }else if(cmd.type==='circle'){
    const a=P(cmd.a),b=P(cmd.b);
    ctx.beginPath();
    ctx.ellipse(
      (a.x+b.x)/2,(a.y+b.y)/2,
      Math.max(.5,Math.abs(b.x-a.x)/2),
      Math.max(.5,Math.abs(b.y-a.y)/2),
      0,0,Math.PI*2
    );
    ctx.stroke()
  }else if(cmd.type==='rect'){
    const a=P(cmd.a),b=P(cmd.b);
    ctx.strokeRect(
      Math.min(a.x,b.x),Math.min(a.y,b.y),
      Math.abs(b.x-a.x),Math.abs(b.y-a.y)
    )
  }else if(cmd.type==='rasterLayer'){
    // Raster layers do not have reliable authored centerline geometry.
    // They remain visible paint but do not invent a false hidden boundary.
  }

  ctx.restore()
}

function renderMegaBoundaryMask(width=768,height=384,heightMode=false){
  const c=document.createElement('canvas');
  c.width=width;c.height=height;
  const ctx=c.getContext('2d');

  // Black = fillable background. White = invisible 1px barrier.
  ctx.fillStyle='#000';
  ctx.fillRect(0,0,width,height);

  // V20.0b:
  // Paint Fill uses paint geometry.
  // Depth/Height Fill uses BOTH the visible paint geometry and any explicit
  // height-layer geometry. This means a region outlined in the normal painter
  // remains the same enclosed region when switching to Depth Map mode.
  const commands=heightMode
    ?[...megaPainterState.commands,...megaPainterState.heightCommands]
    :megaPainterState.commands;

  for(const cmd of commands){
    if(cmd.type==='floodFill'||cmd.type==='depthRegion'||cmd.type==='pixelErase'||cmd.type==='rasterLayer')continue;
    drawMegaBoundaryCommand(ctx,cmd,width,height)
  }

  // Imported images remain editable paint, but we do not treat their visible
  // colour changes as bucket boundaries. This keeps Fill geometry deterministic.
  return c
}

function hiddenMaskRegion(mask,startX,startY){
  const ctx=mask.getContext('2d',{willReadFrequently:true});
  const w=mask.width,h=mask.height;
  startX=Math.max(0,Math.min(w-1,Math.floor(startX)));
  startY=Math.max(0,Math.min(h-1,Math.floor(startY)));

  const img=ctx.getImageData(0,0,w,h),d=img.data;
  const barrier=p=>d[p*4]>127;

  const start=startY*w+startX;
  if(barrier(start))return new Uint8Array(w*h);

  const region=new Uint8Array(w*h);
  const seen=new Uint8Array(w*h);
  const stack=[start];

  // Scanline region fill using ONLY the hidden 1px barrier geometry.
  while(stack.length){
    const seed=stack.pop();
    if(seen[seed])continue;

    const sy=(seed/w)|0;
    const sx=seed-sy*w;
    if(barrier(seed)){seen[seed]=1;continue}

    let left=sx;
    while(left>0){
      const p=sy*w+(left-1);
      if(seen[p]||barrier(p))break;
      left--
    }

    let right=sx;
    while(right<w-1){
      const p=sy*w+(right+1);
      if(seen[p]||barrier(p))break;
      right++
    }

    for(let x=left;x<=right;x++){
      const p=sy*w+x;
      seen[p]=1;
      region[p]=1
    }

    for(const ny of [sy-1,sy+1]){
      if(ny<0||ny>=h)continue;
      let inRun=false;
      for(let x=left;x<=right;x++){
        const p=ny*w+x;
        const ok=!seen[p]&&!barrier(p);
        if(ok&&!inRun){stack.push(p);inRun=true}
        else if(!ok)inRun=false
      }
    }
  }

  return region
}

function paintHiddenRegion(canvas,region,fillColor){
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const w=canvas.width,h=canvas.height;
  const img=ctx.getImageData(0,0,w,h),d=img.data;

  const probe=document.createElement('canvas');probe.width=probe.height=1;
  const pc=probe.getContext('2d');
  pc.fillStyle=fillColor;pc.fillRect(0,0,1,1);
  const q=pc.getImageData(0,0,1,1).data;

  for(let p=0;p<region.length;p++){
    if(!region[p])continue;
    const i=p*4;
    d[i]=q[0];d[i+1]=q[1];d[i+2]=q[2];d[i+3]=q[3]
  }
  ctx.putImageData(img,0,0)
}

function applyGeometryFloodFillCommands(canvas,commands,heightMode=false){
  const mask=renderMegaBoundaryMask(canvas.width,canvas.height,heightMode);

  for(const cmd of commands||[]){
    if(cmd.type!=='floodFill')continue;

    let color=cmd.color||'#fff';
    if(heightMode){
      const v=Math.max(-100,Math.min(100,Number(cmd.height)||0));
      const g=Math.max(1,Math.min(255,Math.round(128+(v/100)*127)));
      color=`rgba(${g},${g},${g},1)`
    }

    const region=hiddenMaskRegion(
      mask,
      cmd.at.x*canvas.width,
      cmd.at.y*canvas.height
    );
    paintHiddenRegion(canvas,region,color)
  }
}

function megaFloodFillCanvas(canvas,startX,startY,fillColor,tolerance=14){
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),w=canvas.width,h=canvas.height;
  startX=Math.max(0,Math.min(w-1,Math.floor(startX)));
  startY=Math.max(0,Math.min(h-1,Math.floor(startY)));

  const img=ctx.getImageData(0,0,w,h),d=img.data;
  const original=new Uint8ClampedArray(d);
  const si=(startY*w+startX)*4;
  const background=[original[si],original[si+1],original[si+2],original[si+3]];

  const probe=document.createElement('canvas');probe.width=probe.height=1;
  const pc=probe.getContext('2d');pc.fillStyle=fillColor;pc.fillRect(0,0,1,1);
  const q=pc.getImageData(0,0,1,1).data,fill=[q[0],q[1],q[2],q[3]];

  if(background.every((v,i)=>Math.abs(v-fill[i])<2))return;

  const baseTol=Math.max(8,+tolerance||14);
  const rgbDistSq=(arr,i,c)=>{
    const dr=arr[i]-c[0],dg=arr[i+1]-c[1],db=arr[i+2]-c[2];
    return dr*dr+dg*dg+db*db
  };
  const rgbDist=(arr,i,c)=>Math.sqrt(rgbDistSq(arr,i,c));

  // ----------------------------------------------------------------
  // V19.9X: border-aware filling.
  //
  // The requested fill colour is NEVER used to decide whether a pixel
  // is traversable. We classify the ORIGINAL image only.
  //
  // A pixel stops the fill only when it behaves like a genuine boundary:
  //   - it contrasts strongly with the clicked background colour, AND
  //   - its local neighborhood shows a strong background<->border transition.
  //
  // Slightly different colours, shading, anti-aliasing, texture noise and
  // isolated details inside the region therefore do not automatically stop Fill.
  // ----------------------------------------------------------------

  const backgroundTol=Math.max(42,baseTol*4.2);
  const hardContrast=Math.max(72,baseTol*6.0);
  const backgroundAlpha=background[3];
  const bgLike=p=>{
    const i=p*4;
    const rgb=rgbDist(original,i,background);
    const ad=Math.abs(original[i+3]-backgroundAlpha);
    return rgb<=backgroundTol && ad<=105
  };

  const localBorderScore=p=>{
    const x=p%w,y=(p/w)|0,i=p*4;
    const selfContrast=rgbDist(original,i,background);
    const selfAlpha=Math.abs(original[i+3]-backgroundAlpha);

    // Background-ish pixels are never borders.
    if(selfContrast<=backgroundTol && selfAlpha<=105)return 0;

    let bgNeighbours=0;
    let unlikeNeighbours=0;
    let maxNeighbourContrast=0;
    let total=0;

    for(let oy=-1;oy<=1;oy++){
      for(let ox=-1;ox<=1;ox++){
        if(!ox&&!oy)continue;
        const xx=x+ox,yy=y+oy;
        if(xx<0||xx>=w||yy<0||yy>=h)continue;
        total++;
        const np=yy*w+xx,ni=np*4;
        if(bgLike(np))bgNeighbours++;
        const localDr=original[i]-original[ni];
        const localDg=original[i+1]-original[ni+1];
        const localDb=original[i+2]-original[ni+2];
        const local=Math.sqrt(localDr*localDr+localDg*localDg+localDb*localDb);
        if(local>hardContrast*.55)unlikeNeighbours++;
        if(local>maxNeighbourContrast)maxNeighbourContrast=local
      }
    }

    // A true drawn border normally has background on one side and a strong
    // local colour discontinuity. A differently-coloured interior patch tends
    // to have similar-coloured neighbours around itself instead.
    const touchesBackground=bgNeighbours>=1;
    const strongSelf=selfContrast>=hardContrast || selfAlpha>145;
    const strongLocal=maxNeighbourContrast>=hardContrast*.72;
    const edgeShape=unlikeNeighbours>=2;

    if(touchesBackground && strongSelf && strongLocal && edgeShape)return 1;

    // Very dark/bright hard strokes can have antialiasing that leaves only one
    // immediate background neighbour. Treat them as borders if contrast is huge.
    if(touchesBackground && selfContrast>=hardContrast*1.55 && strongLocal)return .9;

    return 0
  };

  const isBorder=p=>localBorderScore(p)>=.85;

  // Main scanline traversal. Any pixel that is NOT an actual border is part
  // of the connected fillable region, regardless of its own colour.
  const filled=new Uint8Array(w*h);
  const seen=new Uint8Array(w*h);
  const stack=[startY*w+startX];

  const traversable=p=>!isBorder(p);

  while(stack.length){
    const seed=stack.pop();
    if(seen[seed])continue;

    const sy=(seed/w)|0;
    const sx=seed-sy*w;

    if(!traversable(seed)){
      seen[seed]=1;
      continue
    }

    let left=sx;
    while(left>0){
      const p=sy*w+(left-1);
      if(seen[p]||!traversable(p))break;
      left--
    }

    let right=sx;
    while(right<w-1){
      const p=sy*w+(right+1);
      if(seen[p]||!traversable(p))break;
      right++
    }

    for(let x=left;x<=right;x++){
      const p=sy*w+x,i=p*4;
      seen[p]=1;
      filled[p]=1;
      d[i]=fill[0];d[i+1]=fill[1];d[i+2]=fill[2];d[i+3]=fill[3]
    }

    for(const ny of [sy-1,sy+1]){
      if(ny<0||ny>=h)continue;
      let inRun=false;
      for(let x=left;x<=right;x++){
        const p=ny*w+x;
        const ok=!seen[p]&&traversable(p);
        if(ok&&!inRun){
          stack.push(p);
          inRun=true
        }else if(!ok){
          inRun=false
        }
      }
    }
  }

  // ----------------------------------------------------------------
  // Preserve V19.9W's successful complete soft-edge cleanup.
  // Crucial difference: edge classification compares ORIGINAL background
  // against ORIGINAL border/outside colours. The chosen Fill colour is not
  // involved in deciding what constitutes an edge.
  // ----------------------------------------------------------------
  const EDGE_RADIUS=5;
  const dist=new Int16Array(w*h);
  dist.fill(-1);
  const queue=new Int32Array(w*h);
  let qh=0,qt=0;

  for(let p=0;p<filled.length;p++){
    if(filled[p]){
      dist[p]=0;
      queue[qt++]=p
    }
  }

  while(qh<qt){
    const p=queue[qh++],dd=dist[p];
    if(dd>=EDGE_RADIUS)continue;
    const x=p%w,y=(p/w)|0;
    const push=np=>{
      if(dist[np]!==-1)return;
      dist[np]=dd+1;
      queue[qt++]=np
    };
    if(x>0)push(p-1);
    if(x<w-1)push(p+1);
    if(y>0)push(p-w);
    if(y<h-1)push(p+w)
  }

  const edgeCandidates=[];

  const isSoftBackgroundBorderBlend=p=>{
    const i=p*4,dd=dist[p];
    if(dd<=0||dd>EDGE_RADIUS)return false;

    // Hard border pixels remain untouched.
    if(isBorder(p))return false;

    const x=p%w,y=(p/w)|0;
    let borderSample=null;
    let borderStrength=0;

    // Find the strongest nearby genuine border sample.
    for(let oy=-3;oy<=3;oy++){
      for(let ox=-3;ox<=3;ox++){
        const xx=x+ox,yy=y+oy;
        if(xx<0||xx>=w||yy<0||yy>=h)continue;
        const np=yy*w+xx;
        const strength=localBorderScore(np);
        if(strength>borderStrength){
          const ni=np*4;
          borderStrength=strength;
          borderSample=[original[ni],original[ni+1],original[ni+2],original[ni+3]]
        }
      }
    }

    if(!borderSample)return false;

    // Is this pixel a blend between the clicked BACKGROUND and the detected
    // BORDER colour? This is exactly the anti-alias/shadow fringe we want.
    const px=[original[i],original[i+1],original[i+2],original[i+3]];
    const vx=borderSample[0]-background[0];
    const vy=borderSample[1]-background[1];
    const vz=borderSample[2]-background[2];
    const wx=px[0]-background[0];
    const wy=px[1]-background[1];
    const wz=px[2]-background[2];
    const vv=vx*vx+vy*vy+vz*vz;
    if(vv<1)return false;

    const t=Math.max(-.12,Math.min(1.12,(wx*vx+wy*vy+wz*vz)/vv));
    const proj=[
      background[0]+vx*t,
      background[1]+vy*t,
      background[2]+vz*t
    ];
    const dr=px[0]-proj[0],dg=px[1]-proj[1],db=px[2]-proj[2];
    const blendError=Math.sqrt(dr*dr+dg*dg+db*db);

    return blendError<Math.max(36,baseTol*3.3)
  };

  for(let p=0;p<w*h;p++){
    if(dist[p]<=0||dist[p]>EDGE_RADIUS)continue;
    if(isSoftBackgroundBorderBlend(p))edgeCandidates.push(p)
  }

  // Replace the full soft fringe simultaneously.
  for(const p of edgeCandidates){
    const i=p*4;
    d[i]=fill[0];d[i+1]=fill[1];d[i+2]=fill[2];d[i+3]=fill[3]
  }

  ctx.putImageData(img,0,0)
}
function applyMegaFloodFillCommands(canvas,commands,heightMode=false){
  // V19.9Y: Fill boundaries come from hidden authored geometry, not colours.
  applyGeometryFloodFillCommands(canvas,commands,heightMode)
}
function renderMegaSolidTexture(width=768,height=384){
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const ctx=c.getContext('2d');
  ctx.clearRect(0,0,width,height);

  if(megaPainterState.paintFill){
    ctx.fillStyle=megaPainterState.paintFill;
    ctx.fillRect(0,0,width,height)
  }

  // Fills live on the LOWER layer.
  const fills=megaPainterState.commands.filter(cmd=>cmd.type==='floodFill');
  applyGeometryFloodFillCommands(c,fills,false);

  // All visible paint is drawn over the filled background.
  for(const cmd of megaPainterState.commands){
    if(cmd.type==='floodFill')continue;
    if(cmd.type==='rasterLayer')drawMegaRasterCommand(ctx,cmd,width,height);
    else drawMegaVectorCommand(ctx,cmd,width,height,false)
  }

  drawMegaImports(ctx,width,height);
  return c
}
function createDepthFillRegionCommand(at,heightValue){
  // Capture the enclosed hidden-geometry region NOW and store it as normalized
  // scanline runs. This makes Depth Fill a real persistent object instead of a
  // fill instruction that has to be recomputed later.
  const W=384,H=192;
  const mask=renderMegaBoundaryMask(W,H,true);
  const region=hiddenMaskRegion(mask,at.x*W,at.y*H);
  const runs=[];

  for(let y=0;y<H;y++){
    let x=0;
    while(x<W){
      while(x<W&&!region[y*W+x])x++;
      if(x>=W)break;
      const start=x;
      while(x<W&&region[y*W+x])x++;
      const end=x;
      runs.push([y/H,start/W,end/W])
    }
  }

  return {
    type:'depthRegion',
    at:{x:at.x,y:at.y},
    height:Math.max(-100,Math.min(100,Number(heightValue)||0)),
    runs
  }
}

function drawDepthRegionCommand(ctx,cmd,width,height){
  const v=Math.max(-100,Math.min(100,Number(cmd.height)||0));
  const g=Math.max(1,Math.min(255,Math.round(128+(v/100)*127)));
  ctx.fillStyle=`rgb(${g},${g},${g})`;

  // Each saved run is normalized, so the object scales cleanly at every
  // preview/save resolution. No border/centerline is drawn.
  for(const run of cmd.runs||[]){
    const y=Math.max(0,Math.min(height-1,Math.floor(run[0]*height)));
    const x0=Math.max(0,Math.min(width,Math.floor(run[1]*width)));
    const x1=Math.max(x0+1,Math.min(width,Math.ceil(run[2]*width)));
    ctx.fillRect(x0,y,Math.max(1,x1-x0),1)
  }
}

function depthRegionContains(cmd,p){
  if(cmd?.type!=='depthRegion')return false;
  const yy=p.y;
  const eps=1/180;
  for(const [y,x0,x1] of cmd.runs||[]){
    if(Math.abs(y-yy)<=eps&&p.x>=x0&&p.x<=x1)return true
  }
  return false
}

function renderMegaHeightTexture(width=384,height=192){
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const ctx=c.getContext('2d');

  const baseG=Math.round(128+Math.max(-100,Math.min(100,megaPainterState.heightFill||0))*1.27);
  ctx.fillStyle=`rgb(${baseG},${baseG},${baseG})`;
  ctx.fillRect(0,0,width,height);

  // Legacy Height fills remain readable.
  const fills=megaPainterState.heightCommands.filter(cmd=>cmd.type==='floodFill');
  applyGeometryFloodFillCommands(c,fills,true);

  // V20.0c Depth Fill objects are persistent filled height regions.
  // They carry height but deliberately have NO line/skeleton.
  for(const cmd of megaPainterState.heightCommands){
    if(cmd.type==='depthRegion')drawDepthRegionCommand(ctx,cmd,width,height)
  }

  for(const cmd of megaPainterState.heightCommands){
    if(cmd.type==='floodFill'||cmd.type==='depthRegion')continue;

    if(cmd.type==='rasterLayer'){
      drawMegaRasterCommand(ctx,cmd,width,height)
    }else if(cmd.type==='pixelErase'){
      const pts=cmd.points||[];
      ctx.save();
      ctx.strokeStyle='#808080';ctx.fillStyle='#808080';
      ctx.lineWidth=Math.max(1,cmd.width||8);
      ctx.lineCap='round';ctx.lineJoin='round';

      if(pts.length===1){
        const p={x:pts[0].x*width,y:pts[0].y*height};
        ctx.beginPath();ctx.arc(p.x,p.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill()
      }else if(pts.length>1){
        ctx.beginPath();
        let p={x:pts[0].x*width,y:pts[0].y*height};
        ctx.moveTo(p.x,p.y);
        for(const q of pts.slice(1)){
          p={x:q.x*width,y:q.y*height};
          ctx.lineTo(p.x,p.y)
        }
        ctx.stroke()
      }
      ctx.restore()
    }else{
      drawMegaVectorCommand(ctx,cmd,width,height,true)
    }
  }

  return c
}
function renderMegaPlanetGuide(){
  const c=$('megaPlanetGuide');if(!c)return;
  const ctx=c.getContext('2d'),w=c.width,h=c.height;
  ctx.clearRect(0,0,w,h);

  // New, unsaved megastructures have no editingId yet.
  // The selected editor mode is authoritative for showing the guide.
  const n=editingId?byId(editingId):null;
  const mode=megaEditorMode || n?.megaEditorMode || (n?.createdMegastructure?'separate':null);
  if(!mode)return;

  // ATTACHED — exact old V19.7 Planet Surface Guide.
  if(mode==='attached'){
    const cx=w/2,cy=h/2,R=Math.min(h*.43,w*.23);

    const g=ctx.createRadialGradient(cx-R*.35,cy-R*.38,R*.08,cx,cy,R);
    g.addColorStop(0,'rgba(150,205,235,.34)');
    g.addColorStop(.55,'rgba(62,112,150,.22)');
    g.addColorStop(1,'rgba(8,18,30,.12)');
    ctx.fillStyle=g;
    ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.fill();

    ctx.save();
    ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.clip();
    ctx.strokeStyle='rgba(180,225,245,.16)';
    ctx.lineWidth=1;

    for(let i=-3;i<=3;i++){
      const yy=cy+i*R/4;
      const rx=Math.sqrt(Math.max(0,R*R-(yy-cy)*(yy-cy)));
      ctx.beginPath();
      ctx.ellipse(cx,yy,rx,R*.055,0,0,Math.PI*2);
      ctx.stroke()
    }

    for(let i=-3;i<=3;i++){
      ctx.beginPath();
      ctx.ellipse(cx,cy,R*Math.cos(i*.18),R,0,0,Math.PI*2);
      ctx.stroke()
    }
    ctx.restore();

    ctx.strokeStyle='rgba(195,235,250,.55)';
    ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.stroke();

    // If editing an existing mega, show linked planet name when available.
    const hostPlanet=n?ofType('place').find(p=>
      String(p.placeScale||inferPlaceScale(p.placeType))==='planet' &&
      graphNodesLinked(n.id,p.id)
    ):null;

    ctx.fillStyle='rgba(205,238,250,.8)';
    ctx.font='11px sans-serif';
    ctx.textAlign='center';
    ctx.fillText(hostPlanet?`PLANET SURFACE GUIDE · ${hostPlanet.name}`:'PLANET SURFACE GUIDE',cx,cy+R+20);
    return
  }

  // SEPARATE — relative-size guide must also work before the node is saved.
  if(mode==='separate'){
    const megaDiam=Math.max(.05,+value('eCreatedMegaSize')||1);
    const usable=Math.min(w*.82,h*.78);
    const planetD=Math.max(18,Math.min(usable,usable/megaDiam));
    const megaD=Math.max(18,Math.min(usable,planetD*megaDiam));

    ctx.save();
    ctx.setLineDash([7,5]);
    ctx.lineWidth=1.5;
    ctx.strokeStyle='rgba(120,190,235,.82)';
    ctx.fillStyle='rgba(70,135,180,.10)';
    ctx.beginPath();ctx.arc(w/2,h/2,planetD/2,0,Math.PI*2);ctx.fill();ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle='rgba(180,220,245,.92)';
    ctx.font='12px system-ui';
    ctx.textAlign='center';
    ctx.fillText('Planet · 1× diameter',w/2,Math.max(16,h/2-planetD/2-9));

    ctx.strokeStyle='rgba(245,220,145,.82)';
    ctx.setLineDash([3,4]);
    ctx.beginPath();ctx.arc(w/2,h/2,megaD/2,0,Math.PI*2);ctx.stroke();

    ctx.fillStyle='rgba(245,220,145,.92)';
    ctx.fillText(`Megastructure · ${megaDiam.toFixed(2)}× planet diameter`,w/2,Math.min(h-8,h/2+megaD/2+18));
    ctx.restore()
  }
}
function renderMegaIconPreview(){
  const c=$('megaIconPreview');if(!c)return;
  const ctx=c.getContext('2d'),w=c.width,h=c.height,r=14,cx=w/2,cy=h/2;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#07101a';ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#315f9f';ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();ctx.globalAlpha=.35;ctx.fillStyle='rgba(240,248,255,.7)';
  ctx.beginPath();ctx.ellipse(cx-4,cy-3,7,3,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(cx+5,cy+5,6,2.5,.2,0,Math.PI*2);ctx.fill();ctx.restore();
  const tex=renderMegaSolidTexture(256,128);
  ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();ctx.drawImage(tex,cx-r,cy-r,r*2,r*2);ctx.restore();
  ctx.strokeStyle='rgba(190,235,255,.55)';ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke()
}
function renderMegaPainter(preview=null){
  const c=megaPaintCanvas();if(!c)return;
  const ctx=c.getContext('2d'),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#07101a';ctx.fillRect(0,0,w,h);

  if(megaPainterState.mode==='height'){
    // V20.0b: render the SAME authoritative depth texture that is saved into
    // heightDataUrl. Fill therefore cannot exist in data but disappear from
    // the editor preview.
    const solid=renderMegaSolidTexture(w,h);
    ctx.save();ctx.globalAlpha=.24;ctx.drawImage(solid,0,0,w,h);ctx.restore();

    const heightTexture=renderMegaHeightTexture(w,h);
    ctx.save();ctx.globalAlpha=.82;ctx.drawImage(heightTexture,0,0,w,h);ctx.restore();

    if(preview)drawMegaVectorCommand(ctx,preview,w,h,true)
  }else{
    if(megaPainterState.paintFill){
      ctx.fillStyle=megaPainterState.paintFill;
      ctx.fillRect(0,0,w,h)
    }

    // Fill is a true lower layer based on invisible object skeletons.
    const fills=megaPainterState.commands.filter(cmd=>cmd.type==='floodFill');
    applyGeometryFloodFillCommands(c,fills,false);

    // Visible objects are always rendered above Fill.
    for(const cmd of megaPainterState.commands){
      if(cmd.type==='floodFill')continue;
      if(cmd.type==='rasterLayer')drawMegaRasterCommand(ctx,cmd,w,h);
      else drawMegaVectorCommand(ctx,cmd,w,h,false)
    }

    if(preview)drawMegaVectorCommand(ctx,preview,w,h,false);
    drawMegaImports(ctx,w,h)
  }

  ctx.save();ctx.strokeStyle='rgba(130,190,220,.12)';ctx.lineWidth=1;
  for(let i=1;i<6;i++){ctx.beginPath();ctx.moveTo(w*i/6,0);ctx.lineTo(w*i/6,h);ctx.stroke()}
  for(let i=1;i<3;i++){ctx.beginPath();ctx.moveTo(0,h*i/3);ctx.lineTo(w,h*i/3);ctx.stroke()}
  ctx.strokeStyle='rgba(145,225,245,.28)';ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();ctx.restore();

  if(megaPainterState.mode==='paint'&&megaPainterState.activeImport){
    const imp=megaPainterState.activeImport,img=loadMegaImportImage(imp.src);
    if(img?.complete){
      const iw=w*(imp.scale||.45),ih=iw*(img.naturalHeight/Math.max(1,img.naturalWidth));
      const x=imp.x*w-iw/2,y=imp.y*h-ih/2;
      ctx.save();ctx.strokeStyle='#9eeaff';ctx.setLineDash([6,4]);ctx.strokeRect(x,y,iw,ih);ctx.restore()
    }
  }
  renderMegaIconPreview();
  renderMegaPlanetGuide();
  updateMegaDominantDebugPanel();

  // Draw the guide directly over the visible paint canvas as a second safety path.
  // Draft mode is enough; a saved node is NOT required.
  if(megaEditorMode==='attached'){
    const cx=w/2,cy=h/2,R=Math.min(h*.43,w*.23);

    ctx.save();
    ctx.fillStyle='rgba(70,140,185,.10)';
    ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.fill();

    ctx.strokeStyle='rgba(195,235,250,.72)';
    ctx.lineWidth=1.7;
    ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.stroke();

    ctx.strokeStyle='rgba(180,225,245,.20)';
    ctx.lineWidth=1;
    for(let i=-3;i<=3;i++){
      const yy=cy+i*R/4;
      const rx=Math.sqrt(Math.max(0,R*R-(yy-cy)*(yy-cy)));
      ctx.beginPath();ctx.ellipse(cx,yy,rx,R*.055,0,0,Math.PI*2);ctx.stroke()
    }
    ctx.fillStyle='rgba(205,238,250,.88)';
    ctx.font='11px sans-serif';
    ctx.textAlign='center';
    ctx.fillText('PLANET SURFACE GUIDE',cx,cy+R+20);
    ctx.restore()
  }else if(megaEditorMode==='separate'){
    // New Separate megastructures have no editingId yet; draw from draft mode.
    const megaDiam=Math.max(.05,+value('eCreatedMegaSize')||1);
    const usable=Math.min(w*.82,h*.78);
    const planetD=Math.max(18,Math.min(usable,usable/megaDiam));
    const megaD=Math.max(18,Math.min(usable,planetD*megaDiam));

    ctx.save();
    ctx.lineWidth=2;
    ctx.setLineDash([9,7]);
    ctx.strokeStyle='rgba(112,200,255,.92)';
    ctx.beginPath();ctx.arc(w/2,h/2,planetD/2,0,Math.PI*2);ctx.stroke();

    ctx.setLineDash([4,5]);
    ctx.strokeStyle='rgba(255,224,140,.92)';
    ctx.beginPath();ctx.arc(w/2,h/2,megaD/2,0,Math.PI*2);ctx.stroke();

    ctx.setLineDash([]);
    ctx.textAlign='center';
    ctx.font='12px system-ui';
    ctx.fillStyle='rgba(190,230,255,.95)';
    ctx.fillText('Planet · 1×',w/2,Math.max(15,h/2-planetD/2-10));
    ctx.restore()
  }
}
function setMegaPaintTool(tool){
  megaPainterState.tool=tool;
  document.querySelectorAll('.mega-paint-tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool))
}
function setMegaPaintMode(mode){
  megaPainterState.mode=mode;
  const height=mode==='height';
  $('eMegaHeightMode').classList.toggle('active',height);
  $('megaHeightSettings').classList.toggle('hidden',!height);
  renderMegaPainter()
}
function megaPainterData(){
  const solid=renderMegaSolidTexture(),height=renderMegaHeightTexture();
  return {
    commands:deepCloneState(megaPainterState.commands),
    heightCommands:deepCloneState(megaPainterState.heightCommands),
    imports:deepCloneState(megaPainterState.imports),
    paintFill:megaPainterState.paintFill,
    heightFill:megaPainterState.heightFill,
    textureDataUrl:solid.toDataURL('image/png'),
    heightDataUrl:height.toDataURL('image/png')
  }
}
function setMegaPainterData(data){
  megaPainterState.commands=deepCloneState(data?.commands||[]);
  megaPainterState.heightCommands=deepCloneState(data?.heightCommands||[]);
  megaPainterState.imports=deepCloneState(data?.imports||[]);
  megaPainterState.paintFill=data?.paintFill??null;
  megaPainterState.heightFill=Number.isFinite(+data?.heightFill)?+data.heightFill:0;
  megaPainterState.undoStack=[];megaPainterState.redoStack=[];
  megaPainterState.activeImport=null;setMegaPaintMode('paint')
}
let megaPainterBackdropBound=false;
function bindMegaPainterBackdrop(){
  const backdrop=$('megaPainterBackdrop');
  if(!backdrop||megaPainterBackdropBound)return;
  megaPainterBackdropBound=true;

  // Backdrop should only close the expanded painter when the backdrop itself
  // is clicked. It must never intercept events intended for the painter.
  backdrop.addEventListener('click',e=>{
    if(e.target!==backdrop)return;
    toggleMegaPainterExpanded(false)
  })
}

let megaPainterHome=null;
function toggleMegaPainterExpanded(force=null){
  const painter=document.querySelector('.mega-painter'),backdrop=$('megaPainterBackdrop');
  if(!painter)return;
  bindMegaPainterBackdrop();
  megaPainterState.expanded=force===null?!megaPainterState.expanded:!!force;

  if(megaPainterState.expanded){
    if(!megaPainterHome)megaPainterHome={parent:painter.parentNode,next:painter.nextSibling};
    document.body.appendChild(backdrop);
    document.body.appendChild(painter);
    backdrop.classList.remove('hidden');painter.classList.add('expanded');
    document.body.classList.add('mega-painter-open')
  }else{
    backdrop.classList.add('hidden');painter.classList.remove('expanded');
    document.body.classList.remove('mega-painter-open');
    if(megaPainterHome?.parent){
      if(megaPainterHome.next&&megaPainterHome.next.parentNode===megaPainterHome.parent)megaPainterHome.parent.insertBefore(painter,megaPainterHome.next);
      else megaPainterHome.parent.appendChild(painter)
    }
  }
  setTimeout(()=>{renderMegaPainter();renderMegaPlanetGuide()},30)
}
function megaCommandDistance(cmd,p){
  const seg=(p,a,b)=>{if(!a||!b)return Infinity;const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y,l2=vx*vx+vy*vy||1,t=Math.max(0,Math.min(1,(wx*vx+wy*vy)/l2));return Math.hypot(p.x-(a.x+t*vx),p.y-(a.y+t*vy))};
  if(cmd.type==='brush'||cmd.type==='pixelErase'){const pts=cmd.points||[];let best=Infinity;for(let i=1;i<pts.length;i++)best=Math.min(best,seg(p,pts[i-1],pts[i]));if(pts.length===1)best=Math.hypot(p.x-pts[0].x,p.y-pts[0].y);return best}
  if(cmd.type==='line')return seg(p,cmd.a,cmd.b);
  if(cmd.type==='rect'){const a=cmd.a,b=cmd.b;return Math.min(seg(p,{x:a.x,y:a.y},{x:b.x,y:a.y}),seg(p,{x:b.x,y:a.y},{x:b.x,y:b.y}),seg(p,{x:b.x,y:b.y},{x:a.x,y:b.y}),seg(p,{x:a.x,y:b.y},{x:a.x,y:a.y}))}
  if(cmd.type==='circle'){const cx=(cmd.a.x+cmd.b.x)/2,cy=(cmd.a.y+cmd.b.y)/2,rx=Math.abs(cmd.b.x-cmd.a.x)/2||.001,ry=Math.abs(cmd.b.y-cmd.a.y)/2||.001;return Math.abs(Math.sqrt(((p.x-cx)/rx)**2+((p.y-cy)/ry)**2)-1)*Math.min(rx,ry)}
  if(cmd.type==='depthRegion')return depthRegionContains(cmd,p)?0:Infinity;
  return Infinity
}
function eraseMegaObjectAt(p){
  const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
  for(let i=collection.length-1;i>=0;i--){if(megaCommandDistance(collection[i],p)<.055){collection.splice(i,1);return true}}
  if(megaPainterState.mode==='paint')for(let i=megaPainterState.imports.length-1;i>=0;i--){const imp=megaPainterState.imports[i],sw=imp.scale||.45;if(Math.abs(p.x-imp.x)<sw/2&&Math.abs(p.y-imp.y)<sw/2){megaPainterState.imports.splice(i,1);return true}}
  return false
}
function syncMegaEraserModeButton(){const b=$('eMegaEraserMode');if(!b)return;b.textContent=megaPainterState.eraserMode==='object'?'Object':'Pixel';b.title='Eraser mode: '+b.textContent}
function bindMegaPainter(){
  const c=megaPaintCanvas();if(!c||c.dataset.bound)return;c.dataset.bound='1';
  document.querySelectorAll('.mega-paint-tool').forEach(b=>b.addEventListener('click',()=>setMegaPaintTool(b.dataset.tool)));
  syncMegaEraserModeButton();
  $('eMegaEraserMode').addEventListener('click',()=>{megaPainterState.eraserMode=megaPainterState.eraserMode==='object'?'pixel':'object';syncMegaEraserModeButton()});
  $('eMegaPaintUndo').addEventListener('click',megaPainterUndo);
  $('eMegaPaintRedo').addEventListener('click',megaPainterRedo);
  $('eMegaImportButton').addEventListener('click',()=>$('eMegaImport').click());
  $('eMegaHeightMode').addEventListener('click',()=>setMegaPaintMode(megaPainterState.mode==='height'?'paint':'height'));
  $('eMegaExpandPaint').addEventListener('click',()=>toggleMegaPainterExpanded());
  $('megaPainterBackdrop').addEventListener('click',e=>{if(e.target===$('megaPainterBackdrop'))toggleMegaPainterExpanded(false)});
  document.querySelector('.mega-painter')?.addEventListener('pointerdown',e=>e.stopPropagation());
  document.querySelector('.mega-painter')?.addEventListener('click',e=>e.stopPropagation());
  $('eMegaClearPaint').addEventListener('click',()=>{
    pushMegaPainterHistory();
    if(megaPainterState.mode==='height'){megaPainterState.heightCommands=[];megaPainterState.heightFill=0}
    else{megaPainterState.commands=[];megaPainterState.imports=[];megaPainterState.activeImport=null;megaPainterState.paintFill=null}
    renderMegaPainter()
  });
  $('eMegaHeight').addEventListener('input',()=>{
    const v=+$('eMegaHeight').value||0;$('eMegaHeightOut').textContent=(v>0?'+':'')+v
  });
  $('eMegaImport').addEventListener('change',e=>{
    const f=e.target.files?.[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=()=>{
      pushMegaPainterHistory();
      const imp={id:uid(),src:String(reader.result),x:.5,y:.5,scale:(+$('eMegaImportScale').value||45)/100,opacity:1};
      megaPainterState.imports.push(imp);megaPainterState.activeImport=imp;setMegaPaintMode('paint');renderMegaPainter()
    };
    reader.readAsDataURL(f);e.target.value=''
  });
  $('eMegaImportScale').addEventListener('input',()=>{
    if(megaPainterState.activeImport){megaPainterState.activeImport.scale=(+$('eMegaImportScale').value||45)/100;renderMegaPainter()}
  });

  c.addEventListener('pointerdown',e=>{
    const pt=megaPaintPoint(e);
    // Imported images behave as editable paint for Fill and Pixel Eraser.
    // For other tools they can still be clicked and repositioned normally.
    if(megaPainterState.mode==='paint'&&!['fill','eraser'].includes(megaPainterState.tool)){
      for(const imp of [...megaPainterState.imports].reverse()){
        const img=loadMegaImportImage(imp.src);if(!img?.complete)continue;
        const aspect=img.naturalHeight/Math.max(1,img.naturalWidth),sw=imp.scale||.45,sh=sw*aspect;
        if(Math.abs(pt.x-imp.x)<=sw/2&&Math.abs(pt.y-imp.y)<=sh/2){
          pushMegaPainterHistory();
          megaPainterState.activeImport=imp;megaPainterState.drawing=true;megaPainterState.start=pt;c.setPointerCapture(e.pointerId);renderMegaPainter();return
        }
      }
    }
    megaPainterState.activeImport=null;
    pushMegaPainterHistory();

    if(megaPainterState.tool==='fill'){
      const p=megaPaintPoint(e);if(!p)return;

      // Imported images become part of the pixel surface before bucket fill,
      // so their opaque/transparent pixels can form regions and boundaries.
      if(megaPainterState.mode==='paint'&&!flattenMegaPaintLayerForEditing()){
        megaPainterState.undoStack.pop();
        megaPainterState.drawing=false;
        return
      }

      const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
      const isDepthFill=megaPainterState.mode==='height';

      if(isDepthFill){
        // A Depth Fill is now a real height-bearing region object.
        // It does NOT create a line/skeleton.
        collection.push(createDepthFillRegionCommand(
          {x:p.x,y:p.y},
          +$('eMegaHeight').value||0
        ))
      }else{
        collection.push({
          type:'floodFill',
          at:{x:p.x,y:p.y},
          color:$('eMegaPaintColor').value,
          height:0
        })
      }
      megaPainterState.drawing=false;
      renderMegaPainter();
      return
    }

    megaPainterState.drawing=true;megaPainterState.start=pt;megaPainterState.current=pt;
    const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
    const base={color:$('eMegaPaintColor').value,width:+$('eMegaPaintWidth').value||8,height:+$('eMegaHeight').value||0};
    if(megaPainterState.tool==='brush')collection.push({type:'brush',points:[pt],...base});
    else if(megaPainterState.tool==='eraser'){
      if(megaPainterState.eraserMode==='object'){
        eraseMegaObjectAt(pt);renderMegaPainter();megaPainterState.drawing=false
      }else{
        if(megaPainterState.mode==='paint'&&!flattenMegaPaintLayerForEditing()){
          megaPainterState.undoStack.pop();
          megaPainterState.drawing=false;
          return
        }
        const activeCollection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
        activeCollection.push({type:'pixelErase',points:[pt],width:+$('eMegaPaintWidth').value||8})
      }
    }
    c.setPointerCapture(e.pointerId)
  });
  c.addEventListener('pointermove',e=>{
    if(!megaPainterState.drawing)return;
    const pt=megaPaintPoint(e);megaPainterState.current=pt;
    if(megaPainterState.activeImport){
      megaPainterState.activeImport.x=Math.max(0,Math.min(1,pt.x));megaPainterState.activeImport.y=Math.max(0,Math.min(1,pt.y));renderMegaPainter();return
    }
    const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
    if(megaPainterState.tool==='brush'||(megaPainterState.tool==='eraser'&&megaPainterState.eraserMode==='pixel')){collection.at(-1)?.points?.push(pt);renderMegaPainter()}
    else if(['line','circle','rect'].includes(megaPainterState.tool)){
      renderMegaPainter({type:megaPainterState.tool,a:megaPainterState.start,b:pt,color:$('eMegaPaintColor').value,width:+$('eMegaPaintWidth').value||8,height:+$('eMegaHeight').value||0})
    }
  });
  const finish=e=>{
    if(!megaPainterState.drawing)return;
    const pt=megaPaintPoint(e),collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
    if(!megaPainterState.activeImport&&['line','circle','rect'].includes(megaPainterState.tool)){
      collection.push({type:megaPainterState.tool,a:megaPainterState.start,b:pt,color:$('eMegaPaintColor').value,width:+$('eMegaPaintWidth').value||8,height:+$('eMegaHeight').value||0})
    }
    megaPainterState.drawing=false;megaPainterState.start=null;megaPainterState.current=null;renderMegaPainter()
  };
  c.addEventListener('pointerup',finish);c.addEventListener('pointercancel',finish)
}

const megaTextureCache=new Map();
function cachedMegaTexture(dataUrl){
  if(!dataUrl)return null;
  if(megaTextureCache.has(dataUrl))return megaTextureCache.get(dataUrl);
  const entry={img:new Image(),pixels:null};
  entry.img.onload=()=>{
    const c=document.createElement('canvas');c.width=entry.img.naturalWidth||768;c.height=entry.img.naturalHeight||384;
    const ctx=c.getContext('2d');ctx.drawImage(entry.img,0,0,c.width,c.height);
    try{
      entry.pixels=ctx.getImageData(0,0,c.width,c.height);
      const d=entry.pixels.data,W=entry.pixels.width,H=entry.pixels.height;
      let minX=W,minY=H,maxX=-1,maxY=-1;
      for(let y=0;y<H;y+=2)for(let x=0;x<W;x+=2){
        if(d[(y*W+x)*4+3]>10){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}
      }
      entry.bounds=maxX>=0?{u0:minX/W,u1:(maxX+2)/W,v0:minY/H,v1:(maxY+2)/H}:null;

      // V19.9Z: dominant opaque colour for render-seam undercoat.
      // Quantize RGB to 16-value buckets so tiny shading/noise does not split
      // what is visually one dominant structural colour into thousands of bins.
      const bins=new Map();
      let bestKey=null,bestCount=0;
      for(let y=0;y<H;y+=2){
        for(let x=0;x<W;x+=2){
          const i=(y*W+x)*4,a=d[i+3];
          if(a<80)continue;

          const r=d[i],g=d[i+1],b=d[i+2];
          const qr=Math.round(r/16)*16;
          const qg=Math.round(g/16)*16;
          const qb=Math.round(b/16)*16;
          const key=`${qr},${qg},${qb}`;
          const count=(bins.get(key)||0)+1;
          bins.set(key,count);

          if(count>bestCount){
            bestCount=count;
            bestKey=key
          }
        }
      }

      const opaqueSampleCount=[...bins.values()].reduce((sum,n)=>sum+n,0);

      if(bestKey){
        const [r,g,b]=bestKey.split(',').map(Number);
        entry.dominantColor={r:Math.min(255,r),g:Math.min(255,g),b:Math.min(255,b),a:1};
        entry.dominantColorCount=bestCount;
        entry.dominantColorPercent=opaqueSampleCount?(bestCount/opaqueSampleCount)*100:0;
        entry.opaqueSampleCount=opaqueSampleCount
      }else{
        entry.dominantColor={r:90,g:100,b:110,a:1};
        entry.dominantColorCount=0;
        entry.dominantColorPercent=0;
        entry.opaqueSampleCount=0
      }
    }catch(_){}
    updateMegaDominantDebugPanel();
    requestPlanetDraw()
  };
  entry.img.src=dataUrl;megaTextureCache.set(dataUrl,entry);return entry
}
function megaTexturePixel(dataUrl,u,v){
  const entry=cachedMegaTexture(dataUrl);if(!entry?.pixels)return null;
  const d=entry.pixels,w=d.width,h=d.height;
  const x=Math.max(0,Math.min(w-1,Math.floor((((u%1)+1)%1)*w))),y=Math.max(0,Math.min(h-1,Math.floor(v*h)));
  const i=(y*w+x)*4,a=d.data[i+3];if(a<10)return null;
  return {r:d.data[i],g:d.data[i+1],b:d.data[i+2],a:a/255}
}
function megaHeightAtUV(mega,u,v){
  const p=megaTexturePixel(mega?.megaPaintData?.heightDataUrl,u,v);if(!p)return 0;
  return Math.max(-1,Math.min(1,((p.r+p.g+p.b)/3-128)/127))
}

function megastructureHostScale(megaScale){
  return megaScale==='planetary'?'planet':megaScale==='stellar'?'star':megaScale==='solar-system'?'solar-system':megaScale==='galaxy'?'galaxy':null
}
function sameScaleMegaHosts(mega){
  if(!mega)return [];
  const wanted=megastructureHostScale(mega.megastructureScale||value('eMegastructureScale')||'planetary');
  if(!wanted)return [];
  return ofType('place').filter(p=>String(p.placeScale||inferPlaceScale(p.placeType))===wanted&&graphNodesLinked(mega.id,p.id))
}
function createdMegaFaces(shape='sphere'){
  return ({
    sphere:['Surface'],
    ring:['Outer','Inner','Top','Bottom'],
    disc:['Front','Back','Edge'],
    cube:['Front','Back','Left','Right','Top','Bottom'],
    cylinder:['Side','Top','Bottom'],
    torus:['Outer','Inner']
  })[shape]||['Surface']
}
let createdMegaEditorState={faces:{},activeFace:'Surface',standalone:false};
let megaEditorMode=null;
let createdMega3D={yaw:.55,pitch:-.25,zoom:1,drag:false,draw:false,lastX:0,lastY:0,drawStart:null,lastUV:null,preview:null};

function syncMegaPainterPresentation(){
  $('megaPaintCanvas')?.classList.remove('hidden');
  $('megaPlanetGuide')?.classList.remove('hidden');
  const painter=document.querySelector('.mega-painter');
  painter?.classList.remove('three-d-mode');
  const guide=$('megaPlanetGuide');
  if(guide){
    guide.style.display='block';
    guide.style.visibility='visible';
  }
  renderMegaPainter();
  renderMegaPlanetGuide()
}
function setMegaEditorMode(mode,node=null){
  megaEditorMode=mode;
  const chooser=$('megaTypeChooser'),body=$('megaEditorBody'),created=$('createdMegastructureControls');
  chooser?.classList.add('hidden');body?.classList.remove('hidden');

  if(mode==='separate'){
    createdMegaEditorState.standalone=true;
    created?.classList.remove('hidden');
    $('megaAttachmentStatus').innerHTML='<b>Separate Megastructure</b><small>Draw a flat blueprint. The planet outline is shown at the megastructure\'s real relative scale.</small>'
  }else{
    createdMegaEditorState.standalone=false;
    created?.classList.add('hidden');
    $('megaAttachmentStatus').innerHTML='<b>Attached Megastructure</b><small>Painter modifies the linked same-scale host.</small>'
  }
  syncMegaPainterPresentation();
  updateMegaDominantDebugPanel(node);
  requestAnimationFrame(()=>{
    renderMegaPainter();
    renderMegaPlanetGuide()
  })
}
function resetMegaEditorChooser(){
  megaEditorMode=null;
  $('megaTypeChooser')?.classList.remove('hidden');
  $('megaEditorBody')?.classList.add('hidden');
  $('createdMegastructureControls')?.classList.add('hidden');
  $('megaPaintCanvas')?.classList.remove('hidden');
  $('megaPlanetGuide')?.classList.remove('hidden');
  document.querySelector('.mega-painter')?.classList.remove('three-d-mode')
}
function saveActiveCreatedMegaFace(){
  if(!createdMegaEditorState.standalone)return;
  createdMegaEditorState.faces[createdMegaEditorState.activeFace]=megaPainterData()
}
function loadCreatedMegaFace(face){
  if(createdMegaEditorState.standalone)saveActiveCreatedMegaFace();
  createdMegaEditorState.activeFace=face;
  setMegaPainterData(createdMegaEditorState.faces[face]||{commands:[],heightCommands:[],imports:[],paintFill:null,heightFill:0});
  renderCreatedMegaFaceTabs();syncMegaPainterPresentation()
}
function renderCreatedMegaFaceTabs(){
  const wrap=$('createdMegaFaceTabs');if(!wrap)return;
  const shape=value('eCreatedMegaShape')||'sphere';
  const faces=createdMegaFaces(shape);
  if(!faces.includes(createdMegaEditorState.activeFace))createdMegaEditorState.activeFace=faces[0];
  wrap.innerHTML=faces.map(face=>`<button type="button" class="${face===createdMegaEditorState.activeFace?'active':''}" data-face="${E.esc(face)}">${E.esc(face)}</button>`).join('');
  wrap.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>loadCreatedMegaFace(b.dataset.face)))
}
function updateCreatedMegaMode(node){
  if(!node?.megaEditorMode){
    resetMegaEditorChooser();
    return;
  }
  setMegaEditorMode(node.megaEditorMode,node);
}
function megastructures(){return ofType('structure').filter(s=>s.isMegastructure)}
function normalizeMegastructureMode(mega){
  if(!mega?.isMegastructure)return mega;

  // Legacy standalone flag always means Separate.
  if(mega.createdMegastructure===true)mega.megaEditorMode='separate';

  // If mode is known, synchronize the legacy flag.
  if(mega.megaEditorMode==='separate')mega.createdMegastructure=true;
  else if(mega.megaEditorMode==='attached')mega.createdMegastructure=false;

  return mega
}
function isSeparateMegastructure(mega){
  mega=normalizeMegastructureMode(mega);
  return !!mega?.isMegastructure&&(mega.megaEditorMode==='separate'||mega.createdMegastructure===true)
}
function isAttachedMegastructure(mega){
  mega=normalizeMegastructureMode(mega);
  return !!mega?.isMegastructure&&!isSeparateMegastructure(mega)&&mega.megaEditorMode==='attached'
}

function megastructuresLinkedToNode(node){
  if(!node)return [];
  return megastructures().filter(s=>graphNodesLinked(node.id,s.id)||String(s.uses||'').toLowerCase().includes(String(node.name||'').toLowerCase()));
}
function colorWithAlpha(hex,alpha=1){
  const h=String(hex||'#6fdcff').replace('#','');
  const v=parseInt(h.length===3?h.split('').map(c=>c+c).join(''):h,16);
  return `rgba(${(v>>16)&255},${(v>>8)&255},${v&255},${alpha})`;
}
function planetAttachedMegas(){
  const planet=activePlanetPlace();
  if(!planet)return [];

  // Normal megastructure discovery, followed by one explicit physical-mode test.
  return megastructures().filter(mega=>canMegastructureRenderOnPlanetSurface(mega,planet))
}
function planetDeformationAtUV(u,v){
  let relief=0,source=null;
  for(const mega of planetAttachedMegas()){
    if(!canMegastructureRenderOnPlanetSurface(mega))continue;
    const h=megaHeightAtUV(mega,u,v);
    if(Math.abs(h)>Math.abs(relief)){relief=h;source=mega}
  }
  return {height:relief,mega:source}
}
function projectPlanetDeformed(lat,lon,w,h,height=0){
  const p=planetProject(lat,lon,w,h);
  if(!height)return p;
  const cx=w/2+planetView.panX,cy=h/2+planetView.panY;
  // Real planet geometry deformation, not paint-only offset.
  const scale=1+height*.13;
  return {...p,x:cx+(p.x-cx)*scale,y:cy+(p.y-cy)*scale,deformation:height}
}
function megaDominantWallColor(mega,alpha=1){
  const info=megaDominantDebugInfo(mega);
  const c=info?.color || cachedMegaTexture(mega?.megaPaintData?.textureDataUrl)?.dominantColor;
  if(!c)return `rgba(78,88,96,${alpha})`;
  return `rgba(${c.r},${c.g},${c.b},${alpha})`
}

function expandScreenPolygon(points,amount=1.15){
  const cx=points.reduce((s,p)=>s+p.x,0)/points.length;
  const cy=points.reduce((s,p)=>s+p.y,0)/points.length;
  return points.map(p=>{
    const dx=p.x-cx,dy=p.y-cy;
    const len=Math.hypot(dx,dy)||1;
    return {...p,x:p.x+(dx/len)*amount,y:p.y+(dy/len)*amount}
  })
}

function fillScreenPolygon(ctx,points,fillStyle){
  if(!points?.length)return;
  ctx.fillStyle=fillStyle;
  ctx.beginPath();
  ctx.moveTo(points[0].x,points[0].y);
  for(const p of points.slice(1))ctx.lineTo(p.x,p.y);
  ctx.closePath();
  ctx.fill()
}

function heightCommandSkeletonSegments(cmd){
  if(!cmd)return [];
  const out=[];

  const add=(a,b)=>{
    if(!a||!b)return;
    out.push({a:{x:a.x,y:a.y},b:{x:b.x,y:b.y}})
  };

  if(cmd.type==='brush'){
    const pts=cmd.points||[];
    for(let i=1;i<pts.length;i++)add(pts[i-1],pts[i])
  }else if(cmd.type==='line'){
    add(cmd.a,cmd.b)
  }else if(cmd.type==='rect'){
    const a=cmd.a,b=cmd.b;
    if(a&&b){
      const p1={x:a.x,y:a.y},p2={x:b.x,y:a.y};
      const p3={x:b.x,y:b.y},p4={x:a.x,y:b.y};
      add(p1,p2);add(p2,p3);add(p3,p4);add(p4,p1)
    }
  }else if(cmd.type==='circle'){
    const a=cmd.a,b=cmd.b;
    if(a&&b){
      const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
      const rx=Math.abs(b.x-a.x)/2,ry=Math.abs(b.y-a.y)/2;
      const steps=64;
      let prev=null;
      for(let i=0;i<=steps;i++){
        const t=i/steps*Math.PI*2;
        const p={x:cx+Math.cos(t)*rx,y:cy+Math.sin(t)*ry};
        if(prev)add(prev,p);
        prev=p
      }
    }
  }

  return out
}

function heightMapWallSkeleton(mega){
  const data=mega?.megaPaintData;
  const commands=data?.heightCommands||[];
  const segments=[];

  for(const cmd of commands){
    // Filled Depth objects have height, but intentionally no 1px structural
    // centerline. Only strokes/shapes create skeleton walls.
    if(cmd.type==='floodFill'||cmd.type==='depthRegion'||cmd.type==='pixelErase'||cmd.type==='rasterLayer')continue;

    // Every authored Height Map vector object contributes geometry.
    // Whether it becomes a wall is decided later by sampling the ACTUAL
    // rendered Height Map beneath the skeleton.
    const base=heightCommandSkeletonSegments(cmd);

    for(const seg of base){
      segments.push({
        ...seg,
        sourceType:cmd.type
      })
    }
  }

  return segments
}

function megaActualHeightAtUV(mega,u,v){
  // Use the same sampled Height Map that planet deformation uses.
  // This is authoritative even if individual command metadata is absent.
  const h=megaHeightAtUV(mega,u,v);
  return Number.isFinite(h)?h:0
}

function projectHeightWallPoint(u,v,w,h,height){
  const lat=(.5-v)*Math.PI;
  const lon=(u-.5)*Math.PI*2;
  return projectPlanetDeformed(lat,lon,w,h,height)
}

function drawHeightSkeletonWalls(ctx,mega,w,h){
  const segments=heightMapWallSkeleton(mega);
  if(!segments.length)return;

  const dominant=megaDominantWallColor(mega,.98);

  ctx.save();
  ctx.lineCap='round';
  ctx.lineJoin='round';

  for(const seg of segments){
    const steps=Math.max(
      2,
      Math.ceil(
        Math.max(
          Math.abs(seg.b.x-seg.a.x)*420,
          Math.abs(seg.b.y-seg.a.y)*210
        )
      )
    );

    for(let i=0;i<steps;i++){
      const t0=i/steps,t1=(i+1)/steps;
      const tm=(t0+t1)/2;

      const u0=seg.a.x+(seg.b.x-seg.a.x)*t0;
      const v0=seg.a.y+(seg.b.y-seg.a.y)*t0;
      const u1=seg.a.x+(seg.b.x-seg.a.x)*t1;
      const v1=seg.a.y+(seg.b.y-seg.a.y)*t1;
      const um=seg.a.x+(seg.b.x-seg.a.x)*tm;
      const vm=seg.a.y+(seg.b.y-seg.a.y)*tm;

      // Authoritative source: actual rendered Height Map under the 1px skeleton.
      const sampledHeight=megaActualHeightAtUV(mega,um,vm);

      // Near-zero height has no structural wall.
      if(Math.abs(sampledHeight)<.015)continue;

      let topH,bottomH;

      if(sampledHeight<0){
        // INDENT:
        // top follows the authored recessed height.
        // wall extends deeper to structural -101.
        topH=Math.max(-1,Math.min(0,sampledHeight));
        bottomH=-1.01
      }else{
        // RAISED STRUCTURE:
        // base sits on normal planet radius (0).
        // outer edge follows the authored positive height.
        topH=Math.max(0,Math.min(1,sampledHeight));
        bottomH=0
      }

      const aTop=projectHeightWallPoint(u0,v0,w,h,topH);
      const bTop=projectHeightWallPoint(u1,v1,w,h,topH);
      const aBottom=projectHeightWallPoint(u0,v0,w,h,bottomH);
      const bBottom=projectHeightWallPoint(u1,v1,w,h,bottomH);

      if(!(aTop.front||bTop.front||aBottom.front||bBottom.front))continue;

      // Wall ribbon follows the exact authored 1px skeleton.
      const wall=[aTop,bTop,bBottom,aBottom];
      const expanded=expandScreenPolygon(wall,.55);

      ctx.fillStyle=dominant;
      ctx.beginPath();
      ctx.moveTo(expanded[0].x,expanded[0].y);
      for(const p of expanded.slice(1))ctx.lineTo(p.x,p.y);
      ctx.closePath();
      ctx.fill();

      // Different seam emphasis for indents vs raised geometry.
      ctx.strokeStyle=sampledHeight<0
        ?'rgba(0,0,0,.40)'
        :'rgba(255,255,255,.16)';
      ctx.lineWidth=1.0;
      ctx.beginPath();
      ctx.moveTo(aTop.x,aTop.y);
      ctx.lineTo(bTop.x,bTop.y);
      ctx.stroke()
    }
  }

  ctx.restore()
}

function drawPlanetCavities(ctx,w,h){
  const megas=planetAttachedMegas();
  if(!megas.length)return;

  ctx.save();
  for(const mega of megas)drawAttachedMegaDisplacedMesh(ctx,mega,w,h);
  ctx.restore()
}

function megaMeshSurfaceColor(mega,u,v){
  const tex=mega?.megaPaintData?.textureDataUrl;
  const p=tex?megaTexturePixel(tex,u,v):null;

  if(p&&p.a>.02)return `rgba(${p.r},${p.g},${p.b},${p.a})`;

  // If Height Map geometry exists outside visible paint, keep it structural
  // instead of letting the planet show through as a rendering hole.
  const c=megaDominantDebugInfo(mega)?.color;
  return c
    ?`rgba(${Math.round(c.r*.55)},${Math.round(c.g*.55)},${Math.round(c.b*.55)},.98)`
    :'rgba(27,34,42,.98)'
}

function megaMeshWallColor(mega,delta){
  const c=megaDominantDebugInfo(mega)?.color;
  if(!c)return'rgba(25,31,38,.99)';
  const shade=Math.max(.36,.68-Math.min(1,Math.abs(delta))*.18);
  return `rgba(${Math.round(c.r*shade)},${Math.round(c.g*shade)},${Math.round(c.b*shade)},.99)`
}

function megaMeshPoint(u,v,w,h,height){
  const lat=(.5-v)*Math.PI;
  const lon=(u-.5)*Math.PI*2;
  return projectPlanetDeformed(lat,lon,w,h,height)
}

function megaMeshQuad(ctx,points,fill,stroke='rgba(0,0,0,.08)'){
  if(!points.some(p=>p.front))return;

  // Small overlap prevents raster cracks, but every face is still based on
  // shared mesh vertices rather than independently invented wall geometry.
  const q=expandScreenPolygon(points,.16);

  ctx.fillStyle=fill;
  ctx.beginPath();
  ctx.moveTo(q[0].x,q[0].y);
  for(const p of q.slice(1))ctx.lineTo(p.x,p.y);
  ctx.closePath();
  ctx.fill();

  if(stroke){
    ctx.strokeStyle=stroke;
    ctx.lineWidth=.35;
    ctx.stroke()
  }
}

function drawAttachedMegaDisplacedMesh(ctx,mega,w,h){
  const detail=Math.max(1,Math.min(5,mega.megaDetailLevel??3));

  // Connected UV mesh. All adjacent cells reuse exact vertex samples.
  const rows=70+detail*16;
  const cols=140+detail*32;
  const stride=cols+1;

  const verts=new Array((rows+1)*(cols+1));

  for(let iy=0;iy<=rows;iy++){
    const v=iy/rows;

    for(let ix=0;ix<=cols;ix++){
      const u=ix/cols;
      const height=Math.max(-1,Math.min(1,megaHeightAtUV(mega,u,v)));

      verts[iy*stride+ix]={
        u,v,height,
        p:megaMeshPoint(u,v,w,h,height)
      }
    }
  }

  const cellAverageHeight=(ix,iy)=>{
    const A=verts[iy*stride+ix];
    const B=verts[iy*stride+ix+1];
    const C=verts[(iy+1)*stride+ix+1];
    const D=verts[(iy+1)*stride+ix];
    return (A.height+B.height+C.height+D.height)/4
  };

  const tex=mega?.megaPaintData?.textureDataUrl;

  // PASS 1 — connected displaced surface.
  for(let iy=0;iy<rows;iy++){
    for(let ix=0;ix<cols;ix++){
      const A=verts[iy*stride+ix];
      const B=verts[iy*stride+ix+1];
      const C=verts[(iy+1)*stride+ix+1];
      const D=verts[(iy+1)*stride+ix];

      const u=(A.u+C.u)/2;
      const v=(A.v+C.v)/2;

      const paint=tex?megaTexturePixel(tex,u,v):null;
      const displaced=Math.max(
        Math.abs(A.height),Math.abs(B.height),
        Math.abs(C.height),Math.abs(D.height)
      )>.012;

      if((!paint||paint.a<=.01)&&!displaced)continue;

      megaMeshQuad(
        ctx,
        [A.p,B.p,C.p,D.p],
        megaMeshSurfaceColor(mega,u,v)
      )
    }
  }

  // PASS 2 — continuous transition faces at real height discontinuities.
  //
  // These are not old "wall ribbons". They are shared-edge faces generated
  // from neighboring mesh cells. Therefore both sides agree on the same UV
  // boundary and steep camera angles cannot rotate them independently.
  const threshold=.04;

  for(let iy=0;iy<rows;iy++){
    for(let ix=0;ix<cols;ix++){
      const here=cellAverageHeight(ix,iy);

      // Vertical UV boundary (right neighbor).
      if(ix<cols-1){
        const there=cellAverageHeight(ix+1,iy);

        if(Math.abs(here-there)>threshold){
          const low=Math.min(here,there);
          const high=Math.max(here,there);

          const E0=verts[iy*stride+ix+1];
          const E1=verts[(iy+1)*stride+ix+1];

          const L0=megaMeshPoint(E0.u,E0.v,w,h,low);
          const L1=megaMeshPoint(E1.u,E1.v,w,h,low);
          const H1=megaMeshPoint(E1.u,E1.v,w,h,high);
          const H0=megaMeshPoint(E0.u,E0.v,w,h,high);

          megaMeshQuad(
            ctx,
            [L0,L1,H1,H0],
            megaMeshWallColor(mega,there-here),
            'rgba(0,0,0,.12)'
          )
        }
      }

      // Horizontal UV boundary (bottom neighbor).
      if(iy<rows-1){
        const there=cellAverageHeight(ix,iy+1);

        if(Math.abs(here-there)>threshold){
          const low=Math.min(here,there);
          const high=Math.max(here,there);

          const E0=verts[(iy+1)*stride+ix];
          const E1=verts[(iy+1)*stride+ix+1];

          const L0=megaMeshPoint(E0.u,E0.v,w,h,low);
          const L1=megaMeshPoint(E1.u,E1.v,w,h,low);
          const H1=megaMeshPoint(E1.u,E1.v,w,h,high);
          const H0=megaMeshPoint(E0.u,E0.v,w,h,high);

          megaMeshQuad(
            ctx,
            [L0,L1,H1,H0],
            megaMeshWallColor(mega,there-here),
            'rgba(0,0,0,.12)'
          )
        }
      }
    }
  }
}

function canMegastructureRenderOnPlanetSurface(mega,planet=activePlanetPlace()){
  if(!mega||!planet||!mega.isMegastructure)return false;

  // Exact rendering logic:
  // 1. Separate Megastructures NEVER enter planet-surface rendering.
  if(isSeparateMegastructure(mega))return false;

  // 2. Only Attached Megastructures can continue.
  if(!isAttachedMegastructure(mega))return false;

  // 3. Attached Megastructures must be planetary-scale for planet rendering.
  if(mega.megastructureScale!=='planetary')return false;

  // 4. Attached Megastructure must actually be connected to this Planet.
  if(!graphNodesLinked(planet.id,mega.id))return false;

  // 5. Connected + Attached => normal planet rendering is allowed.
  return true
}
function updateMegaDominantDebugPanel(node=null){
  const panel=$('megaDominantDebugPanel');
  if(!panel)return;

  const swatch=$('megaDominantDebugSwatch');
  const hexEl=$('megaDominantDebugHex');
  const pctEl=$('megaDominantDebugPercent');
  const samplesEl=$('megaDominantDebugSamples');
  const mega=node || (editingId?byId(editingId):null);

  if(!mega?.isMegastructure){
    if(swatch)swatch.style.background='transparent';
    if(hexEl)hexEl.textContent='Not calculated yet';
    if(pctEl)pctEl.textContent='—%';
    if(samplesEl)samplesEl.textContent='Waiting for a megastructure texture';
    return
  }

  let info=megaDominantDebugInfo(mega);

  // While editing, analyze the live painter texture if the saved texture has
  // not loaded yet or the painting has changed.
  try{
    const live=megaPainterData();
    if(live?.textureDataUrl){
      const liveMega={...mega,megaPaintData:live};
      const liveEntry=cachedMegaTexture(live.textureDataUrl);
      if(liveEntry?.dominantColor){
        info=megaDominantDebugInfo(liveMega)
      }
    }
  }catch(_){}

  if(!info){
    if(swatch)swatch.style.background='transparent';
    if(hexEl)hexEl.textContent='Calculating…';
    if(pctEl)pctEl.textContent='—%';
    if(samplesEl)samplesEl.textContent='Waiting for texture analysis';
    return
  }

  if(swatch)swatch.style.background=info.hex;
  if(hexEl)hexEl.textContent=info.hex;
  if(pctEl)pctEl.textContent=`${info.percent.toFixed(2)}%`;
  if(samplesEl)samplesEl.textContent=`${info.samples.toLocaleString()} opaque samples`;
}

function megaDominantDebugInfo(mega){
  const tex=mega?.megaPaintData?.textureDataUrl;
  if(!tex)return null;
  const entry=cachedMegaTexture(tex);
  if(!entry?.dominantColor)return null;

  const c=entry.dominantColor;
  const hex='#'+[c.r,c.g,c.b]
    .map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0'))
    .join('')
    .toUpperCase();

  return {
    hex,
    percent:Number(entry.dominantColorPercent||0),
    samples:Number(entry.opaqueSampleCount||0),
    color:c
  }
}

function drawMegaDominantColorDebug(ctx,w,h){
  const list=planetAttachedMegas();
  if(!list.length)return;

  const rows=list.map(mega=>({mega,info:megaDominantDebugInfo(mega)})).filter(x=>x.info);
  if(!rows.length)return;

  const x=12,y=12,pad=9,rowH=21,boxW=330,boxH=30+rows.length*rowH;

  ctx.save();
  ctx.fillStyle='rgba(3,10,17,.90)';
  ctx.strokeStyle='rgba(135,210,240,.42)';
  ctx.lineWidth=1;
  ctx.beginPath();
  if(ctx.roundRect)ctx.roundRect(x,y,boxW,boxH,8);
  else ctx.rect(x,y,boxW,boxH);
  ctx.fill();ctx.stroke();

  ctx.font='11px system-ui';
  ctx.textBaseline='middle';
  ctx.fillStyle='rgba(215,240,250,.92)';
  ctx.fillText('DOMINANT COLOR DEBUG',x+pad,y+15);

  rows.forEach(({mega,info},index)=>{
    const yy=y+34+index*rowH;
    ctx.fillStyle=info.hex;
    ctx.fillRect(x+pad,yy-7,14,14);
    ctx.strokeStyle='rgba(255,255,255,.45)';
    ctx.strokeRect(x+pad+.5,yy-6.5,13,13);

    ctx.fillStyle='rgba(225,242,250,.96)';
    ctx.fillText(
      `${String(mega.name||'Megastructure')} · ${info.hex} · ${info.percent.toFixed(2)}%`,
      x+pad+22,
      yy
    );
  });

  ctx.restore()
}

function expandProjectedQuad(points,amount=.85){
  const cx=points.reduce((s,p)=>s+p.x,0)/points.length;
  const cy=points.reduce((s,p)=>s+p.y,0)/points.length;

  return points.map(p=>{
    const dx=p.x-cx,dy=p.y-cy;
    const len=Math.hypot(dx,dy)||1;
    return {
      ...p,
      x:p.x+(dx/len)*amount,
      y:p.y+(dy/len)*amount
    }
  })
}

function fillProjectedQuad(ctx,points,color){
  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.moveTo(points[0].x,points[0].y);
  for(const p of points.slice(1))ctx.lineTo(p.x,p.y);
  ctx.closePath();
  ctx.fill()
}

function drawMegaPaintOnGlobe(ctx,mega,w,h){
  if(isSeparateMegastructure(mega))return;

  const tex=mega?.megaPaintData?.textureDataUrl;
  if(!tex)return;

  const entry=cachedMegaTexture(tex);
  if(!entry?.img?.complete||!entry?.pixels)return;

  const detail=Math.max(1,Math.min(5,mega.megaDetailLevel??3));
  const B=entry.bounds||{u0:0,u1:1,v0:0,v1:1};

  // Moderate sampling resolution. Runs, rather than thousands of independent
  // cells, provide continuity and keep this fast.
  const rows=72+detail*14;
  const cols=216+detail*42;

  const row0=Math.max(0,Math.floor(B.v0*rows)-1);
  const row1=Math.min(rows,Math.ceil(B.v1*rows)+1);
  const col0=Math.max(0,Math.floor(B.u0*cols)-1);
  const col1=Math.min(cols,Math.ceil(B.u1*cols)+1);

  const projectUV=(u,v,height)=>{
    const lat=(.5-v)*Math.PI;
    const lon=(u-.5)*Math.PI*2;
    return projectPlanetDeformed(lat,lon,w,h,height)
  };

  const rgba=c=>`rgba(${c.r},${c.g},${c.b},${c.a})`;

  ctx.save();

  for(let iy=row0;iy<row1;iy++){
    // Deliberate V overlap. This closes the thin planet-colored cracks between
    // adjacent projected rows without drawing visible horizontal strokes.
    const padV=.32/rows;
    const v0=Math.max(0,iy/rows-padV);
    const v1=Math.min(1,(iy+1)/rows+padV);
    const vm=(iy+.5)/rows;

    let ix=col0;

    while(ix<col1){
      const c0=megaTexturePixel(tex,(ix+.5)/cols,vm);

      if(!c0 || c0.a<=.01){
        ix++;
        continue
      }

      // Build a run while pixels remain painted and reasonably similar.
      // We intentionally do NOT merge across transparent authored holes.
      const start=ix;
      let end=ix+1;
      let sr=c0.r,sg=c0.g,sb=c0.b,sa=c0.a,count=1;

      while(end<col1){
        const c=megaTexturePixel(tex,(end+.5)/cols,vm);
        if(!c || c.a<=.01)break;

        const ar=sr/count,ag=sg/count,ab=sb/count;
        const delta=Math.abs(c.r-ar)+Math.abs(c.g-ag)+Math.abs(c.b-ab);

        // Preserve actual painted detail; only coalesce near-identical colors.
        if(delta>30)break;

        sr+=c.r; sg+=c.g; sb+=c.b; sa+=c.a; count++;
        end++
      }

      const avg={
        r:Math.round(sr/count),
        g:Math.round(sg/count),
        b:Math.round(sb/count),
        a:Math.min(1,sa/count)
      };

      // Deliberate U overlap closes vertical cracks between neighboring runs.
      const padU=.38/cols;
      const u0=Math.max(0,start/cols-padU);
      const u1=Math.min(1,end/cols+padU);

      // Split a run into curved ribbon sections. This follows the globe instead
      // of drawing one straight screen-space quad across a long run.
      const span=end-start;
      const pieces=Math.max(1,Math.ceil(span/5));

      for(let k=0;k<pieces;k++){
        const ta=k/pieces,tb=(k+1)/pieces;
        const ua=u0+(u1-u0)*ta;
        const ub=u0+(u1-u0)*tb;
        const um=(ua+ub)/2;

        const hgt=megaHeightAtUV(mega,um,vm);
        const surfaceH=Math.min(0,hgt)+Math.max(0,hgt)*.13;

        const p00=projectUV(ua,v0,surfaceH);
        const p10=projectUV(ub,v0,surfaceH);
        const p11=projectUV(ub,v1,surfaceH);
        const p01=projectUV(ua,v1,surfaceH);

        if(!(p00.front||p10.front||p11.front||p01.front))continue;

        // Tiny screen-space expansion is the final anti-crack safety net.
        // It affects filled polygons only; no grid/stripe stroke is produced.
        const q=expandScreenPolygon([p00,p10,p11,p01],.42);

        ctx.fillStyle=rgba(avg);
        ctx.beginPath();
        ctx.moveTo(q[0].x,q[0].y);
        ctx.lineTo(q[1].x,q[1].y);
        ctx.lineTo(q[2].x,q[2].y);
        ctx.lineTo(q[3].x,q[3].y);
        ctx.closePath();
        ctx.fill()
      }

      ix=end
    }
  }

  ctx.restore()
}
function drawPlanetClouds(ctx,w,h,phase='above'){
  const planet=simState.planet;if(!planet||planet.cloudsEnabled===false)return;
  const coverage=Math.max(0,Math.min(100,planet.cloudCoverage??45))/100;
  const opacity=Math.max(0,Math.min(100,planet.cloudOpacity??38))/100;
  if(coverage<=0||opacity<=0)return;

  const cx=w/2+planetView.panX,cy=h/2+planetView.panY,R=Math.min(w,h)*.34*planetView.zoom;
  const seed=Number(planet.seed)||1;
  ctx.save();ctx.beginPath();ctx.arc(cx,cy,R*1.01,0,Math.PI*2);ctx.clip();
  ctx.globalAlpha=opacity*(phase==='below'?.72:1);

  const count=Math.round(24+coverage*100);
  for(let i=0;i<count;i++){
    if(seededUnit(seed,i,201.7)>coverage)continue;
    const a=seededUnit(seed,i,213.9)*Math.PI*2;
    const rr=Math.sqrt(seededUnit(seed,i,226.1))*R*.92;
    const x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr*.78;
    const size=R*(.035+.09*seededUnit(seed,i,239.3));
    const g=ctx.createRadialGradient(x,y,0,x,y,size);
    g.addColorStop(0,colorWithAlpha(planet.cloudColor||'#eef8ff',.72));
    g.addColorStop(.55,colorWithAlpha(planet.cloudColor||'#eef8ff',.32));
    g.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=g;
    ctx.beginPath();ctx.ellipse(x,y,size,size*.52,seededUnit(seed,i,244.4)*Math.PI,0,Math.PI*2);ctx.fill()
  }
  ctx.restore()
}

function attachedMegaSurfaceHeightAtUV(u,v){
  let height=null;

  for(const mega of planetAttachedMegas()){
    const tex=mega?.megaPaintData?.textureDataUrl;
    if(!tex)continue;

    // Only consider an attached mega where authored paint actually exists.
    const color=megaTexturePixel(tex,u,v);
    if(!color||color.a<=.01)continue;

    const h=megaHeightAtUV(mega,u,v);
    if(height===null||h>height)height=h
  }

  return height
}

function drawPlanetSurfaceOcclusion(ctx,w,h){
  // Gas Giants have atmosphere rather than a solid ocean plane. Attached
  // geometry remains visible through the atmospheric surface renderer.
  if(simState.planet?.gasGiant)return;
  const megas=planetAttachedMegas();
  if(!megas.length)return;

  // This pass makes the procedural terrain/water behave like a physical
  // surface in front of megastructure geometry that lies below it.
  //
  // Ocean surface = planet radius 0.
  // Land surface  = planet radius 0 too for now, but land is only restored
  // when no physical cavity exists. Ocean is allowed to cover negative-height
  // geometry, which makes water behave as an actual surface rather than an
  // early background color.
  ctx.save();

  for(const cell of planetTerrainCache){
    const mid=planetProject(cell.midLat,cell.midLon,w,h);
    if(!mid.front)continue;

    const u=((cell.midLon/(Math.PI*2))+.5+1)%1;
    const v=.5-cell.midLat/Math.PI;
    const megaH=attachedMegaSurfaceHeightAtUV(u,v);

    if(megaH===null)continue;

    const isLand=planetIsLand(cell.midLat,cell.midLon);

    // WATER:
    // If the megastructure surface is below the normal planet radius,
    // redraw the water surface over it. This is the actual occlusion rule.
    if(!isLand){
      if(megaH>=0)continue;
    }else{
      // LAND:
      // Negative Height Map means an intentional physical cavity, so do not
      // magically put solid land back across the opening.
      if(megaH<0)continue;

      // Flat/raised megastructure is allowed to sit on/above the ground.
      continue
    }

    const p00=planetProject(cell.lat0,cell.lon0,w,h);
    const p10=planetProject(cell.lat0,cell.lon1,w,h);
    const p11=planetProject(cell.lat1,cell.lon1,w,h);
    const p01=planetProject(cell.lat1,cell.lon0,w,h);

    if(!p00.front&&!p10.front&&!p11.front&&!p01.front)continue;

    // Slight overlap makes the water surface continuous, just like the cached
    // terrain mesh, without exposing sub-pixel cracks.
    const q=expandScreenPolygon([p00,p10,p11,p01],.35);

    ctx.fillStyle=cell.color;
    ctx.globalAlpha=1;
    ctx.beginPath();
    ctx.moveTo(q[0].x,q[0].y);
    ctx.lineTo(q[1].x,q[1].y);
    ctx.lineTo(q[2].x,q[2].y);
    ctx.lineTo(q[3].x,q[3].y);
    ctx.closePath();
    ctx.fill()
  }

  ctx.restore()
}

function drawAttachedMegaPaintDetail(ctx,w,h){
  // V20.0d compatibility hook.
  // Attached paint is rendered directly on drawAttachedMegaDisplacedMesh().
}

function drawPlanetaryMegastructures(ctx,w,h){
  // Normal planetary megastructure rendering.
  // The list already contains only Attached + connected megastructures.
  const list=planetAttachedMegas();
  if(!list.length)return;

  for(const s of list){
    const opacity=Math.max(.1,Math.min(1,(s.megaOpacity??80)/100));
    const coverage=Math.max(1,Math.min(100,s.megaCoverage??25));
    const style=s.megaVisualStyle||'surface-paint';
    const lat=(s.megaLat??0)*Math.PI/180,lon=(s.megaLon??0)*Math.PI/180;
    const p=planetProject(lat,lon,w,h);
    if(!p.front&&style!=='ring'&&style!=='shell')continue;

    ctx.save();
    ctx.globalAlpha=opacity;
    ctx.strokeStyle=colorWithAlpha(s.megaGlow||s.megaColor,opacity);
    ctx.fillStyle=colorWithAlpha(s.megaColor||'#6fdcff',opacity);
    ctx.lineWidth=Math.max(1,p.R*.006);

    if(style==='ring'){
      ctx.translate(w/2+planetView.panX,h/2+planetView.panY);
      ctx.rotate(.28);
      ctx.beginPath();ctx.ellipse(0,0,p.R*1.18,p.R*.32,0,0,Math.PI*2);
      ctx.stroke();
      ctx.strokeStyle=colorWithAlpha(s.megaColor2||'#b8f2ff',opacity*.7);
      ctx.beginPath();ctx.ellipse(0,0,p.R*1.22,p.R*.35,0,0,Math.PI*2);ctx.stroke();
    }else if(style==='shell'){
      ctx.beginPath();ctx.arc(w/2+planetView.panX,h/2+planetView.panY,p.R*1.03,0,Math.PI*2);
      ctx.strokeStyle=colorWithAlpha(s.megaColor||'#6fdcff',opacity*.8);ctx.lineWidth=Math.max(2,p.R*.02);ctx.stroke();
    }else if(style==='spire'){
      const len=p.R*(.18+.45*coverage/100);
      ctx.beginPath();ctx.arc(p.x,p.y,Math.max(3,p.R*.018),0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x,p.y-len);ctx.stroke();
      ctx.shadowColor=s.megaGlow||'#73e8ff';ctx.shadowBlur=14;ctx.stroke();
    }else{
      const radius=p.R*(.05+.34*coverage/100);
      const count=Math.round(25+coverage*1.8);
      const seed=[...String(s.id)].reduce((a,c)=>a+c.charCodeAt(0),0);
      for(let i=0;i<count;i++){
        const a=seededUnit(seed,i,44.7)*Math.PI*2;
        const rr=Math.sqrt(seededUnit(seed,i,62.1))*radius;
        const x=p.x+Math.cos(a)*rr,y=p.y+Math.sin(a)*rr*.62;
        const sz=style==='lattice'?2.2:Math.max(1.5,p.R*.006);
        ctx.fillStyle=i%3===0?colorWithAlpha(s.megaColor2||'#b8f2ff',opacity):colorWithAlpha(s.megaColor||'#6fdcff',opacity);
        if(s.megaPattern==='grid'){
          ctx.fillRect(x-sz,y-sz,sz*2,sz*2);
        }else{
          ctx.beginPath();ctx.arc(x,y,sz,0,Math.PI*2);ctx.fill();
        }
      }
      ctx.strokeStyle=colorWithAlpha(s.megaGlow||'#73e8ff',opacity*.7);
      ctx.beginPath();ctx.ellipse(p.x,p.y,radius,radius*.62,0,0,Math.PI*2);ctx.stroke();
    }

    ctx.restore();
  }
}
function graphNodesLinked(aId,bId){
  return edges.some(e=>!e.blocked&&!isVisualOnlyEdge(e)&&((e.a===aId&&e.b===bId)||(e.a===bId&&e.b===aId)));
}
function nearbyPlanetPoint(base,index,total){
  const angle=(index/Math.max(1,total))*Math.PI*2;
  const d=.055+.018*(index%3);
  return{
    lat:Math.max(-1.5,Math.min(1.5,base.lat+Math.sin(angle)*d)),
    lon:base.lon+Math.cos(angle)*d/Math.max(.35,Math.cos(base.lat))
  };
}
function planetHasPermanentInhabitants(place){
  if(!place)return true;
  const raw=String(place.inhabitants||place.composition||'').trim().toLowerCase();
  return !(raw==='none'||raw==='temporary'||raw==='temporary inhabitants'||raw==='no inhabitants');
}
function isPlanetSurfacePlace(place){
  if(!place||place.type!=='place')return false;
  const scale=String(place.placeScale||inferPlaceScale(place.placeType||place.category||'')).toLowerCase();
  const rank=PLACE_LEVELS.findIndex(([v])=>v===scale);
  const countryRank=PLACE_LEVELS.findIndex(([v])=>v==='country');
  // Planet surfaces only contain House -> Country.
  // Planet, Star, Solar System and Galaxy are strategic objects, never cities.
  return rank>=0&&rank<=countryRank
}
function placeHasPlanetParent(place){
  if(!place)return false;
  return ofType('place').some(parent=>{
    const ps=String(parent.placeScale||inferPlaceScale(parent.placeType));
    return ps==='planet'&&placeContains(parent,place)
  })
}
function surfacePlacesForPlanet(planet){
  const all=ofType('place').filter(isPlanetSurfacePlace);
  if(!planet)return [];

  // Authored surface Places must belong to THIS planet.
  // If a surface Place is explicitly assigned to another planet, never leak it here.
  return all.filter(place=>placeContains(planet,place))
}
function structurePlaceLinks(structure){
  if(!structure)return [];
  return ofType('place').filter(p=>graphNodesLinked(structure.id,p.id))
}
function isPlanetSurfaceStructure(structure,planet,surfacePlaces){
  if(!structure||structure.type!=='structure')return false;

  // HARD RULE: Megastructures never become city/ministry/academy icons.
  if(structure.isMegastructure||isSeparateMegastructure(structure)||isAttachedMegastructure(structure))return false;

  if(!planet)return false;
  const allowedIds=new Set([planet.id,...surfacePlaces.map(p=>p.id)]);
  const links=structurePlaceLinks(structure);

  // A structure appears on this authored planet only if it is explicitly
  // linked to the planet itself or one of its valid surface Places.
  return links.some(p=>allowedIds.has(p.id))
}
function activePlanetPlace(){
  const name=simState.planetOverride?.name||simState.planet?.name;
  if(!name)return null;
  return ofType('place').find(p=>p.name===name&&String(p.placeScale||inferPlaceScale(p.placeType))==='planet')||null;
}

function generateWorldLocations(){
  if(!simState.planet)return;

  const ctx=simContext(),locs=[];
  const activePlanet=activePlanetPlace();
  const exclusiveCreature=currentExclusivePlanetCreature();

  const overrideInhabitants=String(simState.planetOverride?.inhabitants||'').trim().toLowerCase();
  const overrideUninhabited=
    overrideInhabitants==='none' ||
    overrideInhabitants==='temporary' ||
    overrideInhabitants==='temporary inhabitants';

  if(
    (activePlanet&&!planetHasPermanentInhabitants(activePlanet)) ||
    (!activePlanet&&overrideUninhabited)
  ){
    simState.locations=[];
    return
  }

  const sourceToLocation=new Map();

  const add=(type,name,detail,source=null,point=null,extra={})=>{
    const p=point||randomLandPoint();
    const loc={
      id:uid(),type,name,detail,source,
      lat:p.lat,lon:p.lon,
      founded:simState.year||0,
      ...extra
    };
    locs.push(loc);
    if(source)sourceToLocation.set(source,loc);
    return loc
  };

  // --------------------------------------------------------
  // GENERATED SETTLEMENTS
  // --------------------------------------------------------
  if(exclusiveCreature){
    // An exclusive creature world does not receive normal towns/cities.
    // At most one small native settlement is generated.
    if(Math.random()<.72){
      add(
        'settlement',
        `${exclusiveCreature.name} Settlement`,
        `A small native settlement inhabited by ${exclusiveCreature.name}.`,
        exclusiveCreature.id,
        null,
        {
          nodeType:'life',
          graphName:exclusiveCreature.name,
          exclusiveNativeSettlement:true,
          generatedSettlement:true
        }
      )
    }
  }else{
    for(let i=0;i<5;i++){
      add(
        'city',
        v16WorldName(),
        v16Pick([
          'Regional capital',
          'Trade city',
          'Frontier settlement',
          'Old magical city'
        ]),
        null,
        null,
        {kind:'generatedCity'}
      )
    }
  }

  // HARD SURFACE FILTER:
  // only House -> Country Places contained by the active Planet may become
  // geographic icons. Planet/Star/System/Galaxy nodes are strategic only.
  const surfacePlaces=surfacePlacesForPlanet(activePlanet);

  // Explicitly authored Places are preserved even on an exclusive creature
  // world. The rule suppresses PROCEDURAL towns, not user-authored geography.
  for(const place of surfacePlaces){
    const t=String(place.placeType||place.category||'').toLowerCase();
    const marker=
      t.includes('school')||t.includes('academy')?'academy':
      t.includes('ruin')?'ruin':
      t.includes('forest')||t.includes('reserve')||t.includes('wilderness')?'life':
      t.includes('mine')||t.includes('factory')||t.includes('works')?'industry':
      t.includes('settlement')?'settlement':'city';

    add(
      marker,
      place.name,
      place.description||`A ${place.placeType||'place'} on ${activePlanet?.name||'this world'}.`,
      place.id,
      null,
      {
        nodeType:'place',
        graphName:place.name,
        placeType:place.placeType||place.category||'Place',
        inhabitants:place.inhabitants||'',
        authority:place.government||''
      }
    )
  }

  // Structures remain only when explicitly anchored to this Planet/surface
  // Place. We do not procedurally invent institutions on exclusive worlds.
  const structures=(ctx.structures||[])
    .filter(s=>isPlanetSurfaceStructure(s,activePlanet,surfacePlaces));
  const anchoredStructures=new Set();

  for(const place of surfacePlaces){
    const anchor=sourceToLocation.get(place.id);
    if(!anchor)continue;

    const linked=structures.filter(s=>graphNodesLinked(place.id,s.id));

    linked.forEach((s,i)=>{
      const c=String(s.category||'').toLowerCase();
      const type=c.includes('academy')||c.includes('college')?'academy':'ministry';
      const p=nearbyPlanetPoint(anchor,i,linked.length);

      add(
        type,
        s.name,
        s.description||s.property||`A structure linked to ${place.name}.`,
        s.id,
        p,
        {
          nodeType:'structure',
          graphName:s.name,
          linkedPlaceId:place.id,
          linkedPlaceName:place.name,
          structureCategory:s.category||'Structure'
        }
      );
      anchoredStructures.add(s.id)
    })
  }

  for(const s of structures){
    if(anchoredStructures.has(s.id))continue;

    const links=structurePlaceLinks(s);
    if(!activePlanet||!links.some(p=>p.id===activePlanet.id))continue;

    const c=String(s.category||'').toLowerCase();
    add(
      c.includes('academy')||c.includes('college')?'academy':'ministry',
      s.name,
      s.description||s.property||'Magical institution',
      s.id,
      null,
      {
        nodeType:'structure',
        graphName:s.name,
        structureCategory:s.category||'Structure',
        linkedPlaceId:activePlanet.id,
        linkedPlaceName:activePlanet.name
      }
    )
  }

  if(!exclusiveCreature){
    // Ordinary inhabited worlds keep their generated industry/research layer.
    for(const m of (ctx.materials||[]).slice(0,4)){
      add(
        'industry',
        m.name+' Works',
        `Industry based on ${m.name}`,
        m.id,
        null,
        {nodeType:'material',graphName:m.name}
      )
    }
  }

  // --------------------------------------------------------
  // CREATURE HABITATS
  // --------------------------------------------------------
  if(exclusiveCreature){
    // Exactly ONE creature may receive a habitat here.
    add(
      'life',
      exclusiveCreature.name+' Habitat',
      `Native habitat of ${exclusiveCreature.name}.`,
      exclusiveCreature.id,
      null,
      {
        nodeType:'life',
        graphName:exclusiveCreature.name,
        exclusiveNative:true
      }
    )
  }else{
    const allowedLife=(ctx.life||[])
      .filter(l=>!l.main&&!l.individual)
      .filter(l=>!activePlanet||creatureAllowedAtPlace(l,activePlanet))
      .slice(0,4);

    for(const l of allowedLife){
      add(
        'life',
        l.name+' Habitat',
        `Important habitat for ${l.name}`,
        l.id,
        null,
        {nodeType:'life',graphName:l.name}
      )
    }
  }

  if(!exclusiveCreature){
    for(const t of (ctx.techniques||[]).slice(0,3)){
      add(
        'research',
        t.name+' Institute',
        `Research center studying ${t.name}`,
        t.id,
        null,
        {nodeType:'technique',graphName:t.name}
      )
    }
  }

  simState.locations=locs
}

function isValidPlanetSurfaceLocation(loc){
  if(!loc)return false;
  const node=loc.source?byId(loc.source):null;
  if(!node)return true; // generated city / procedural feature

  if(node.type==='place')return isPlanetSurfacePlace(node);

  if(node.type==='structure'){
    // Absolute exclusion: no megastructure can survive as a planet icon.
    if(node.isMegastructure||isSeparateMegastructure(node)||isAttachedMegastructure(node))return false;
    return true
  }

  // Materials/Life/Techniques use generated habitat/industry/research markers.
  return ['material','life','technique'].includes(node.type)
}
function sanitizePlanetLocations(){
  if(!Array.isArray(simState.locations))simState.locations=[];

  const activePlanet=activePlanetPlace();
  const exclusiveCreature=currentExclusivePlanetCreature();

  simState.locations=simState.locations.filter(loc=>{
    if(!isValidPlanetSurfaceLocation(loc))return false;

    // Existing cached procedural civilization is removed from a world that has
    // since become an exclusive single-creature Planet.
    if(exclusiveCreature){
      if(loc.kind==='generatedCity')return false;
      if(loc.type==='research'&&loc.nodeType==='technique')return false;
      if(loc.type==='industry'&&loc.nodeType==='material')return false;

      if(loc.nodeType==='life'){
        const life=loc.source?byId(loc.source):null;
        if(life?.id!==exclusiveCreature.id)return false
      }
    }

    // Even on ordinary planets, an exclusive-home creature may not leak onto
    // another planet through an old cached habitat.
    if(loc.nodeType==='life'&&activePlanet){
      const life=loc.source?byId(loc.source):null;
      if(life&&!creatureAllowedAtPlace(life,activePlanet))return false
    }

    return true
  });

  if(exclusiveCreature){
    // At most one generated native settlement.
    let settlementSeen=false;

    simState.locations=simState.locations.filter(loc=>{
      if(!loc.generatedSettlement&&!loc.exclusiveNativeSettlement)return true;
      if(settlementSeen)return false;
      settlementSeen=true;
      return true
    })
  }
}
function ensurePlanet(){
  if(!simState.planet)generatePlanet();
  if(!planetTerrainCache.length)buildPlanetTerrainCache();
  sanitizePlanetLocations();
  if(!Array.isArray(simState.locations)||!simState.locations.length)generateWorldLocations();
  sanitizePlanetLocations();
}
function planetProject(lat,lon,w,h){
  const yaw=planetView.yaw,pitch=planetView.pitch;
  const cl=Math.cos(lat);
  let x=cl*Math.cos(lon),y=Math.sin(lat),z=cl*Math.sin(lon);

  const cy=Math.cos(yaw),sy=Math.sin(yaw);
  [x,z]=[x*cy-z*sy,x*sy+z*cy];

  // Pitch rotates depth X against vertical Y: true north/south globe rotation.
  const cp=Math.cos(pitch),sp=Math.sin(pitch);
  [x,y]=[x*cp-y*sp,x*sp+y*cp];

  const R=Math.min(w,h)*.39*planetView.zoom;
  return {x:w/2+planetView.panX+z*R,y:h/2+planetView.panY-y*R,front:x>0,depth:x,R};
}
function seededUnit(seed,i,a=12.9898){const x=Math.sin(seed*37.71+i*a)*43758.5453;return x-Math.floor(x)}
let scaleNav={level:null,path:[],camera:{x:.5,y:.5,zoom:1},tween:null,selected:null,transitioning:false,lastTransitionAt:0};
if(restoredWorldState?.simState){
  simState={...simState,...restoredWorldState.simState};
}
if(restoredWorldState?.scaleNav){
  scaleNav={...scaleNav,...restoredWorldState.scaleNav,transitioning:false,tween:null};
}

function hierarchyChildLevel(level){return level==='universe'?'galaxy':level==='galaxy'?'solar':level==='solar'?'planet':null}
function mapDisplayLevel(){return scaleNav.level||systemScale()}
function tweenScaleCamera(target,duration=600,onDone=null){
  if(scaleNav.transitioning)return;
  scaleNav.transitioning=true;
  const start={...scaleNav.camera},t0=performance.now();

  const tick=now=>{
    const u=Math.min(1,(now-t0)/duration);
    const ease=u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2;
    scaleNav.camera={
      x:start.x+(target.x-start.x)*ease,
      y:start.y+(target.y-start.y)*ease,
      zoom:start.zoom+(target.zoom-start.zoom)*ease
    };
    requestPlanetDraw();

    if(u<1)requestAnimationFrame(tick);
    else{
      scaleNav.lastTransitionAt=performance.now();
      onDone?.();
      setTimeout(()=>{scaleNav.transitioning=false},240);
    }
  };

  requestAnimationFrame(tick)
}

function childMapFor(item){
  if(mapDisplayLevel()==='planet')cacheCurrentPlanet();else cacheCurrentScaleMap();
  const current=mapDisplayLevel(),next=hierarchyChildLevel(current);if(!next)return;
  scaleNav.path.push({level:current,item});
  scaleNav.level=next;
  scaleNav.camera={x:.5,y:.5,zoom:1};
  scaleNav.selected=null;
  scaleNav.lastTransitionAt=performance.now();
  generateScaleMap(item?.name||'');
  refreshWorldMapMode();
  requestPlanetDraw()
}
function enterPlanetFromMap(item){
  cacheCurrentScaleMap();
  scaleNav.path.push({level:mapDisplayLevel(),item});scaleNav.level='planet';scaleNav.selected=item;scaleNav.lastTransitionAt=performance.now();
  const p=(item.sourceId?byId(item.sourceId):null)||
    ofType('place').find(x=>
      x.name===item.name &&
      String(x.placeScale||inferPlaceScale(x.placeType))==='planet'
    );
  const planetNode=p&&String(p.placeScale||inferPlaceScale(p.placeType))==='planet'?p:null;
  simState.planetOverride={
    name:item.name,
    landColor:planetNode?.planetLandColor||'#5d8f5a',
    landColor2:planetNode?.planetLandColor2||'#78915b',
    landColor3:planetNode?.planetLandColor3||'#8d8655',
    oceanColor:planetNode?.planetOceanColor||'#315f9f',
    oceanColor2:planetNode?.planetOceanColor2||'#102f58',
    isMoon:!!planetNode?.isMoon,
    orbitingId:planetNode?.orbitingId||null,
    gasGiant:!!planetNode?.gasGiant,
    gasColor:planetNode?.planetGasColor||'#d6b783',
    gasColor2:planetNode?.planetGasColor2||'#a87a58',
    gasColor3:planetNode?.planetGasColor3||'#eee0b5',
    gasContrast:Number.isFinite(+planetNode?.planetGasContrast)?+p.planetGasContrast:55,
    landCoverage:Number.isFinite(+planetNode?.planetLandCoverage)?+p.planetLandCoverage:45,
    landEnabled:planetNode?.planetLandEnabled!==false,
    oceanEnabled:planetNode?.planetOceanEnabled!==false,
    cloudsEnabled:planetNode?.planetCloudsEnabled!==false,
    cloudColor:planetNode?.planetCloudColor||'#eef8ff',
    cloudCoverage:Number.isFinite(+planetNode?.planetCloudCoverage)?+p.planetCloudCoverage:45,
    cloudOpacity:Number.isFinite(+planetNode?.planetCloudOpacity)?+p.planetCloudOpacity:38,
    inhabitants:planetNode?.inhabitants||item.inhabitants||'None'
  };
  generatePlanet(true);refreshWorldMapMode();requestPlanetDraw()
}
function backScaleLevel(){
  if(mapDisplayLevel()==='planet')cacheCurrentPlanet();else cacheCurrentScaleMap();
  const prev=scaleNav.path.pop();if(!prev)return;
  scaleNav.level=prev.level;scaleNav.camera={x:.5,y:.5,zoom:1};scaleNav.selected=null;scaleNav.transitioning=false;scaleNav.lastTransitionAt=performance.now();simState.planetOverride=null;
  generateScaleMap();refreshWorldMapMode();requestPlanetDraw()
}
function deepCloneState(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function worldPathKey(level=mapDisplayLevel()){
  const path=(scaleNav.path||[]).map(p=>p.item?.sourceId||p.item?.name||p.level).join('>');
  return `${systemScale()}|${path}|${level}`;
}
function planetWorldKey(){
  const name=simState.planetOverride?.name||simState.planet?.name||'root';
  return `${worldPathKey('planet')}|${name}`;
}
function cacheCurrentScaleMap(){
  if(simState.spaceMap)worldStateCache.maps[worldPathKey(simState.spaceMap.scale)]=deepCloneState(simState.spaceMap);
}
function cacheCurrentPlanet(){
  if(simState.planet){
    worldStateCache.planets[planetWorldKey()]={
      planet:deepCloneState(simState.planet),
      locations:deepCloneState(simState.locations||[])
    };
  }
}
function invalidateWorldStateForNode(node){
  if(!node)return;
  // User edits that change system composition should rebuild generated context,
  // while ordinary navigation remains stable.
  if(node.type==='place'&&['planet','solar-system','galaxy'].includes(String(node.placeScale))){
    worldStateCache={maps:{},planets:{}};
  }
}
function graphRouteBetween(a,b){
  if(!a?.sourceId||!b?.sourceId)return null;
  const edge=edges.find(e=>!e.blocked&&((e.a===a.sourceId&&e.b===b.sourceId)||(e.a===b.sourceId&&e.b===a.sourceId)));
  if(!edge)return null;
  if(edge.linkType==='relationship'||e?.type==='relationship'){
    const v=Number.isFinite(edge.relationship)?edge.relationship:0;
    if(v>=20)return 'trade';
    if(v<=-20)return 'war';
  }
  return null;
}
function drawMegaPaintOnIcon(ctx,mega,x,y,radius){
  const tex=mega?.megaPaintData?.textureDataUrl;if(!tex)return;
  const entry=cachedMegaTexture(tex);if(!entry?.img?.complete)return;
  ctx.save();ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.clip();
  ctx.globalAlpha=1;
  ctx.drawImage(entry.img,x-radius,y-radius,radius*2,radius*2);
  ctx.restore()
}
function createdMegaFacePaint(node,face){
  const data=(node?.createdMegaFaces||createdMegaEditorState.faces||{})[face];
  return data||null
}
function createdMegaTextureEntry(face){
  const data=createdMegaEditorState.faces?.[face];
  return data?.textureDataUrl?cachedMegaTexture(data.textureDataUrl):null
}
function createdMega3DProject(x,y,z,w,h){
  const cy=Math.cos(createdMega3D.yaw),sy=Math.sin(createdMega3D.yaw);
  [x,z]=[x*cy-z*sy,x*sy+z*cy];
  const cp=Math.cos(createdMega3D.pitch),sp=Math.sin(createdMega3D.pitch);
  [y,z]=[y*cp-z*sp,y*sp+z*cp];
  const S=Math.min(w,h)*.32*createdMega3D.zoom;
  const perspective=1/(1.7-z*.35);
  return {x:w/2+x*S*perspective,y:h/2-y*S*perspective,z,front:z<1.4}
}
function createdMegaPaintColorAt(face,u,v){
  const data=createdMegaEditorState.faces?.[face];
  const p=megaTexturePixel(data?.textureDataUrl,u,v);
  return p?`rgba(${p.r},${p.g},${p.b},${p.a})`:null
}
function renderCreatedMegaLiveTextureWithPreview(width=512,height=256){
  const c=renderMegaSolidTexture(width,height);
  if(createdMega3D.preview){
    const ctx=c.getContext('2d');
    const p=createdMega3D.preview;
    drawMegaVectorCommand(ctx,{
      type:p.type,
      a:p.a,b:p.b,
      color:$('eMegaPaintColor').value,
      width:+$('eMegaPaintWidth').value||8,
      height:+$('eMegaHeight').value||0
    },width,height,false)
  }
  return c
}
function renderCreatedMegaLiveHeightWithPreview(width=256,height=128){
  const c=renderMegaHeightTexture(width,height);
  if(createdMega3D.preview&&megaPainterState.mode==='height'){
    const ctx=c.getContext('2d');
    const p=createdMega3D.preview;
    drawMegaVectorCommand(ctx,{
      type:p.type,
      a:p.a,b:p.b,
      color:'#ffffff',
      width:+$('eMegaPaintWidth').value||8,
      height:+$('eMegaHeight').value||0
    },width,height,true)
  }
  return c
}
function syncCreatedMega3DResolution(){
  const c=$('createdMega3DCanvas');if(!c)return false;
  const r=c.getBoundingClientRect();
  if(r.width<2||r.height<2)return false;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const W=Math.max(2,Math.round(r.width*dpr));
  const H=Math.max(2,Math.round(r.height*dpr));
  if(c.width!==W||c.height!==H){c.width=W;c.height=H}
  return true
}
function renderCreatedMega3D(){
  const c=$('createdMega3DCanvas');if(!c||!createdMegaEditorState.standalone)return;
  if(!syncCreatedMega3DResolution())return;
  const ctx=c.getContext('2d'),w=c.width,h=c.height;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#050a10';ctx.fillRect(0,0,w,h);

  const shape=value('eCreatedMegaShape')||'sphere';
  const size=Math.max(.25,Math.min(4,+value('eCreatedMegaSize')||1));

  // The active face is always rendered from the CURRENT painter state, so
  // strokes/fill/height changes update immediately rather than only after Save.
  const liveTex=renderCreatedMegaLiveTextureWithPreview(640,320),liveCtx=liveTex.getContext('2d');
  const liveImg=liveCtx.getImageData(0,0,liveTex.width,liveTex.height);
  const liveHeight=renderCreatedMegaLiveHeightWithPreview(320,160),heightCtx=liveHeight.getContext('2d');
  const heightImg=heightCtx.getImageData(0,0,liveHeight.width,liveHeight.height);

  const sampleLive=(u,v)=>{
    const x=Math.max(0,Math.min(liveImg.width-1,Math.floor(u*liveImg.width)));
    const y=Math.max(0,Math.min(liveImg.height-1,Math.floor(v*liveImg.height)));
    const i=(y*liveImg.width+x)*4;
    return {r:liveImg.data[i],g:liveImg.data[i+1],b:liveImg.data[i+2],a:liveImg.data[i+3]/255}
  };
  const sampleHeight=(u,v)=>{
    const x=Math.max(0,Math.min(heightImg.width-1,Math.floor(u*heightImg.width)));
    const y=Math.max(0,Math.min(heightImg.height-1,Math.floor(v*heightImg.height)));
    return (heightImg.data[(y*heightImg.width+x)*4]-128)/127
  };

  if(shape==='sphere'){
    const N=52,quads=[];
    for(let iy=0;iy<N;iy++){
      const v0=iy/N,v1=(iy+1)/N,lat0=(.5-v0)*Math.PI,lat1=(.5-v1)*Math.PI;
      for(let ix=0;ix<N*2;ix++){
        const u0=ix/(N*2),u1=(ix+1)/(N*2),um=(u0+u1)/2,vm=(v0+v1)/2;
        const hgt=sampleHeight(um,vm)*.1;
        const lon0=(u0-.5)*Math.PI*2,lon1=(u1-.5)*Math.PI*2;
        const xyz=(lat,lon)=>{
          const rr=size*(1+hgt);
          return {x:Math.cos(lat)*Math.cos(lon)*rr,y:Math.sin(lat)*rr,z:Math.cos(lat)*Math.sin(lon)*rr}
        };
        const A=xyz(lat0,lon0),B=xyz(lat0,lon1),C=xyz(lat1,lon1),D=xyz(lat1,lon0);
        const pa=createdMega3DProject(A.x,A.y,A.z,w,h),pb=createdMega3DProject(B.x,B.y,B.z,w,h),pc=createdMega3DProject(C.x,C.y,C.z,w,h),pd=createdMega3DProject(D.x,D.y,D.z,w,h);
        quads.push({pa,pb,pc,pd,z:(pa.z+pb.z+pc.z+pd.z)/4,u:um,v:vm})
      }
    }
    quads.sort((a,b)=>b.z-a.z);
    for(const q of quads){
      const p=sampleLive(q.u,q.v);
      // Sphere body is always opaque; transparent/unpainted texture reveals the solid base material.
      const base=p.a>.02?`rgb(${p.r},${p.g},${p.b})`:'#243847';
      ctx.fillStyle=base;
      ctx.globalAlpha=1;
      ctx.beginPath();ctx.moveTo(q.pa.x,q.pa.y);ctx.lineTo(q.pb.x,q.pb.y);ctx.lineTo(q.pc.x,q.pc.y);ctx.lineTo(q.pd.x,q.pd.y);ctx.closePath();ctx.fill();

      // Opaque lighting pass.
      const shade=Math.max(0,Math.min(.26,.12+q.z*.05));
      if(shade>0){
        ctx.fillStyle=`rgba(0,0,0,${shade})`;
        ctx.beginPath();ctx.moveTo(q.pa.x,q.pa.y);ctx.lineTo(q.pb.x,q.pb.y);ctx.lineTo(q.pc.x,q.pc.y);ctx.lineTo(q.pd.x,q.pd.y);ctx.closePath();ctx.fill()
      }
    }
    ctx.globalAlpha=1
  }else if(shape==='cube'){
    const faces=[
      ['Front',[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],
      ['Back',[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]],
      ['Left',[[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]],
      ['Right',[[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]]],
      ['Top',[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]],
      ['Bottom',[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]]
    ];
    const polys=faces.map(([name,pts])=>{
      const p=pts.map(([x,y,z])=>createdMega3DProject(x*size,y*size,z*size,w,h));
      return {name,p,z:p.reduce((s,q)=>s+q.z,0)/4}
    }).sort((a,b)=>b.z-a.z);
    for(const f of polys){
      ctx.fillStyle='#243847';
      ctx.beginPath();ctx.moveTo(f.p[0].x,f.p[0].y);for(const q of f.p.slice(1))ctx.lineTo(q.x,q.y);ctx.closePath();ctx.fill();

      let tex=null;
      if(f.name===createdMegaEditorState.activeFace)tex=liveTex;
      else{
        const data=createdMegaEditorState.faces?.[f.name];
        const ent=data?.textureDataUrl?cachedMegaTexture(data.textureDataUrl):null;
        tex=ent?.img?.complete?ent.img:null
      }
      if(tex){
        ctx.save();ctx.beginPath();ctx.moveTo(f.p[0].x,f.p[0].y);for(const q of f.p.slice(1))ctx.lineTo(q.x,q.y);ctx.closePath();ctx.clip();
        const minX=Math.min(...f.p.map(q=>q.x)),maxX=Math.max(...f.p.map(q=>q.x)),minY=Math.min(...f.p.map(q=>q.y)),maxY=Math.max(...f.p.map(q=>q.y));
        ctx.globalAlpha=.96;ctx.drawImage(tex,minX,minY,maxX-minX,maxY-minY);ctx.restore()
      }
      ctx.strokeStyle='rgba(150,220,245,.35)';ctx.stroke()
    }
  }else{
    ctx.save();ctx.translate(w/2,h/2);ctx.rotate(createdMega3D.yaw*.35);
    ctx.strokeStyle='#79dff5';ctx.fillStyle='#243847';ctx.lineWidth=3;
    const r=Math.min(w,h)*.22*size*createdMega3D.zoom;
    if(shape==='ring'||shape==='torus'){
      ctx.lineWidth=Math.max(8,r*.2);ctx.beginPath();ctx.ellipse(0,0,r,r*.42,createdMega3D.pitch*.3,0,Math.PI*2);ctx.stroke()
    }else if(shape==='disc'){
      ctx.beginPath();ctx.ellipse(0,0,r,r*.28,createdMega3D.pitch*.25,0,Math.PI*2);ctx.fill();ctx.stroke()
    }else if(shape==='cylinder'){
      ctx.fillRect(-r*.65,-r*.5,r*1.3,r);ctx.strokeRect(-r*.65,-r*.5,r*1.3,r);
      ctx.beginPath();ctx.ellipse(0,-r*.5,r*.65,r*.2,0,0,Math.PI*2);ctx.stroke()
    }
    ctx.restore()
  }

  ctx.fillStyle='rgba(220,240,250,.72)';ctx.font='12px system-ui';
  ctx.fillText('Left draw · Right rotate · Wheel zoom',12,h-14)
}
function createdMega3DUVFromPointer(e){
  const c=$('createdMega3DCanvas'),r=c.getBoundingClientRect();
  // Projection is based on min(width,height), so hit-testing must be too.
  const side=Math.min(r.width,r.height);
  const nx=(e.clientX-(r.left+r.width/2))/(side/2);
  const ny=((r.top+r.height/2)-e.clientY)/(side/2);
  const R=.68;
  if(nx*nx+ny*ny>R*R)return null;
  const z=Math.sqrt(Math.max(0,R*R-nx*nx-ny*ny));
  let X=nx/R,Y=ny/R,Z=z/R;
  const cp=Math.cos(-createdMega3D.pitch),sp=Math.sin(-createdMega3D.pitch);
  [Y,Z]=[Y*cp-Z*sp,Y*sp+Z*cp];
  const cy=Math.cos(-createdMega3D.yaw),sy=Math.sin(-createdMega3D.yaw);
  [X,Z]=[X*cy-Z*sy,X*sy+Z*cy];
  const lat=Math.asin(Math.max(-1,Math.min(1,Y)));
  const lon=Math.atan2(Z,X);
  return {x:(lon/(Math.PI*2)+.5+1)%1,y:.5-lat/Math.PI}
}
function createdMega3DToolUV(e){
  const shape=value('eCreatedMegaShape')||'sphere';
  if(shape==='sphere')return createdMega3DUVFromPointer(e);
  const c=$('createdMega3DCanvas'),r=c.getBoundingClientRect();
  return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}
}
let createdMegaResizeObserver=null;
function ensureCreatedMegaResizeObserver(){
  const c=$('createdMega3DCanvas');if(!c||createdMegaResizeObserver)return;
  createdMegaResizeObserver=new ResizeObserver(()=>{
    if(megaEditorMode==='separate'&&createdMegaEditorState.standalone){
      requestAnimationFrame(renderCreatedMega3D)
    }
  });
  createdMegaResizeObserver.observe(c)
}
function bindCreatedMega3D(){
  const c=$('createdMega3DCanvas');if(!c)return;
  ensureCreatedMegaResizeObserver();
  if(c.dataset.bound)return;c.dataset.bound='1';
  c.addEventListener('contextmenu',e=>e.preventDefault());

  c.addEventListener('pointerdown',e=>{
    if(!createdMegaEditorState.standalone)return;
    if(e.button===2){
      createdMega3D.drag=true;createdMega3D.lastX=e.clientX;createdMega3D.lastY=e.clientY;c.setPointerCapture(e.pointerId);return
    }
    if(e.button!==0)return;
    const uv=createdMega3DToolUV(e);if(!uv)return;
    pushMegaPainterHistory();

    if(megaPainterState.tool==='fill'){
      if(megaPainterState.mode==='height'){
        // Local Depth Fill — do NOT replace the whole face and do NOT delete
        // existing height work.
        megaPainterState.heightCommands.push(
          createDepthFillRegionCommand(
            {x:uv.x,y:uv.y},
            +$('eMegaHeight').value||0
          )
        )
      }else{
        // Keep existing standalone paint behavior for now.
        megaPainterState.paintFill=$('eMegaPaintColor').value
      }
      saveActiveCreatedMegaFace();renderMegaPainter();renderCreatedMega3D();return
    }

    if(megaPainterState.tool==='eraser'){
      const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
      const near=cmd=>(cmd.points||[cmd.a,cmd.b].filter(Boolean)).some(p=>Math.hypot(p.x-uv.x,p.y-uv.y)<.05);
      for(let i=collection.length-1;i>=0;i--)if(near(collection[i])){collection.splice(i,1);break}
      saveActiveCreatedMegaFace();renderMegaPainter();renderCreatedMega3D();return
    }

    createdMega3D.draw=true;createdMega3D.drawStart=uv;createdMega3D.lastUV=uv;
    const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
    const base={color:$('eMegaPaintColor').value,width:+$('eMegaPaintWidth').value||8,height:+$('eMegaHeight').value||0};
    if(megaPainterState.tool==='brush')collection.push({type:'brush',points:[uv],...base});
    c.setPointerCapture(e.pointerId)
  });

  c.addEventListener('pointermove',e=>{
    if(createdMega3D.drag){
      const dx=e.clientX-createdMega3D.lastX,dy=e.clientY-createdMega3D.lastY;
      // Drag the object with the cursor rather than making the camera feel inverted.
      createdMega3D.yaw-=dx*.008;
      createdMega3D.pitch=Math.max(-1.4,Math.min(1.4,createdMega3D.pitch-dy*.008));
      createdMega3D.lastX=e.clientX;createdMega3D.lastY=e.clientY;renderCreatedMega3D();return
    }
    if(!createdMega3D.draw)return;
    const uv=createdMega3DToolUV(e);if(!uv)return;
    createdMega3D.lastUV=uv;
    const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
    if(megaPainterState.tool==='brush'){
      collection.at(-1)?.points?.push(uv);
      saveActiveCreatedMegaFace();renderMegaPainter();renderCreatedMega3D()
    }else if(['line','circle','rect'].includes(megaPainterState.tool)){
      createdMega3D.preview={type:megaPainterState.tool,a:createdMega3D.drawStart,b:uv}
      renderCreatedMega3D()
    }
  });

  const finish=e=>{
    if(createdMega3D.drag){createdMega3D.drag=false;c.releasePointerCapture?.(e.pointerId);return}
    if(!createdMega3D.draw)return;
    const uv=createdMega3DToolUV(e)||createdMega3D.lastUV;
    const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
    if(uv&&['line','circle','rect'].includes(megaPainterState.tool)){
      const committed=createdMega3D.preview||{type:megaPainterState.tool,a:createdMega3D.drawStart,b:uv};
      collection.push({
        type:committed.type,
        a:deepCloneState(committed.a),
        b:deepCloneState(committed.b),
        color:$('eMegaPaintColor').value,
        width:+$('eMegaPaintWidth').value||8,
        height:+$('eMegaHeight').value||0
      })
    }
    createdMega3D.draw=false;createdMega3D.drawStart=null;createdMega3D.lastUV=null;createdMega3D.preview=null;
    c.releasePointerCapture?.(e.pointerId);saveActiveCreatedMegaFace();renderMegaPainter();renderCreatedMega3D()
  };
  c.addEventListener('pointerup',finish);c.addEventListener('pointercancel',finish);
  c.addEventListener('wheel',e=>{e.preventDefault();createdMega3D.zoom=Math.max(.45,Math.min(2.5,createdMega3D.zoom*Math.exp(-e.deltaY*.001)));renderCreatedMega3D()},{passive:false})
}
function createdMegaViewerScale(mega){
  return mega.megastructureScale==='planetary'||mega.megastructureScale==='stellar'?'solar':
         mega.megastructureScale==='solar-system'?'galaxy':
         mega.megastructureScale==='galaxy'?'universe':null
}
function megastructuresForPlaceNode(place){
  if(!place)return [];

  const scale=String(place.placeScale||inferPlaceScale(place.placeType));

  if(scale==='planet'){
    // A Planet's megastructure count means structures physically mounted on it.
    // Separate Megastructures linked for placement/relationships do not count.
    return megastructures().filter(mega=>
      isAttachedMegastructure(mega) &&
      mega.megastructureScale==='planetary' &&
      graphNodesLinked(mega.id,place.id)
    )
  }

  // Higher-level counts can include independent megastructures associated with
  // that System/Galaxy because they genuinely exist within that hierarchy.
  return megastructures().filter(m=>graphNodesLinked(m.id,place.id))
}
function megastructureCountForPlace(place){
  if(!place)return 0;
  const ps=String(place.placeScale||inferPlaceScale(place.placeType));
  if(ps==='solar-system')return systemMegastructureCount(place);
  return megastructuresForPlaceNode(place).length
}
function megastructureCountForMapItem(item,scale,mapItems=[]){
  const place=item?.sourceId?byId(item.sourceId):null;
  let count=place?megastructureCountForPlace(place):0;

  // Procedurally positioned Separate Megastructures count toward their
  // generated host location as well.
  const groups=proceduralSeparateMegaHosts(scale,mapItems);
  const procedural=groups.get(item?.name)||[];
  const ids=new Set(place?megastructuresForPlaceNode(place).map(m=>m.id):[]);
  for(const mega of procedural)ids.add(mega.id);
  return ids.size||count
}
function systemPlanets(systemPlace){
  return systemPlanetaryBodies(systemPlace)
}
function systemMegastructures(systemPlace){
  if(!systemPlace)return [];
  const ids=new Map();

  // Megastructures directly associated with the system may be Attached or Separate.
  for(const m of megastructures().filter(m=>graphNodesLinked(m.id,systemPlace.id)))ids.set(m.id,m);

  // Planet children contribute only megastructures physically attached to them.
  for(const p of systemPlanets(systemPlace)){
    for(const m of megastructuresForPlaceNode(p))ids.set(m.id,m)
  }

  return [...ids.values()]
}
function systemMegastructureCount(systemPlace){return systemMegastructures(systemPlace).length}
function systemStarNode(systemPlace){
  if(!systemPlace)return null;
  return ofType('place').find(p=>{
    const ps=String(p.placeScale||inferPlaceScale(p.placeType));
    return ps==='star'&&graphNodesLinked(p.id,systemPlace.id)
  })||systemMainStar(systemPlace)||null
}
function authoredMapItemName(item){
  const source=item?.sourceId?byId(item.sourceId):null;
  return source?.name||item?.name||'Unnamed'
}
function starSystemObjectInfo(item){
  const system=item?.sourceId?byId(item.sourceId):null;
  if(!system)return null;

  const planets=systemPlanets(system);
  const stars=systemStars(system);
  const star=stars[0]||null;
  const megas=systemMegastructures(system);

  return{system,planets,stars,star,megas,megaCount:megas.length}
}

function placeHierarchyLabel(place){
  if(isMoonPlace(place))return 'Moon';
  if(isGasGiantPlace(place))return 'Gas Giant';
  const s=String(place?.placeScale||inferPlaceScale(place?.placeType)||'place');
  return s==='solar-system'?'Solar System':s==='galaxy'?'Galaxy':s==='planet'?'Planet':s==='star'?'Star':systemScaleLabel(s)
}
function immediatePhysicalParent(place){
  if(!place)return null;
  const rank=placeRank(place);
  return authoredPlaceParents(place)
    .filter(p=>placeRank(p)>rank)
    .sort((a,b)=>placeRank(a)-placeRank(b))[0]||null
}
function physicalPlacePath(place){
  if(!place)return [];
  const path=[place],seen=new Set([place.id]);
  let cur=place;
  for(let guard=0;guard<16;guard++){
    const parent=immediatePhysicalParent(cur);
    if(!parent||seen.has(parent.id))break;
    path.push(parent);seen.add(parent.id);cur=parent
  }
  return path.reverse()
}
function resolveSeparateMegaPhysicalPlacement(mega){
  if(!isSeparateMegastructure(mega))return null;
  const anchors=ofType('place').filter(p=>graphNodesLinked(mega.id,p.id));
  if(!anchors.length)return null;
  const anchor=[...anchors].sort((a,b)=>placeRank(a)-placeRank(b))[0];
  const path=physicalPlacePath(anchor);
  const system=[...path].reverse().find(p=>String(p.placeScale||inferPlaceScale(p.placeType))==='solar-system')||null;
  const galaxy=[...path].reverse().find(p=>String(p.placeScale||inferPlaceScale(p.placeType))==='galaxy')||null;
  return{anchor,path,pathIds:path.map(p=>p.id),pathNames:path.map(p=>p.name),systemId:system?.id||null,galaxyId:galaxy?.id||null}
}
function separateMegaVisibleInCurrentContext(mega,scale,mapItems=[]){
  const placement=resolveSeparateMegaPhysicalPlacement(mega);
  if(!placement)return true;
  const anchor=placement.anchor;
  const as=String(anchor.placeScale||inferPlaceScale(anchor.placeType));
  if(mapItems.some(q=>q.sourceId===anchor.id))return true;
  if(scale==='solar'&&placement.systemId){
    return scaleNav.path.at(-1)?.item?.sourceId===placement.systemId
  }
  if(scale==='galaxy'&&as==='solar-system'){
    if(placement.galaxyId)return scaleNav.path.at(-1)?.item?.sourceId===placement.galaxyId;
    return mapItems.some(q=>q.sourceId===anchor.id)
  }
  if(scale==='universe'&&as==='galaxy')return mapItems.some(q=>q.sourceId===anchor.id);
  return false
}

function separateMegaAnchors(mega){
  if(!isSeparateMegastructure(mega))return [];
  return ofType('place').filter(p=>graphNodesLinked(mega.id,p.id))
}
function separateMegaPlacementScale(mega){
  const anchors=separateMegaAnchors(mega);
  if(anchors.length){
    const p=anchors[0],ps=String(p.placeScale||inferPlaceScale(p.placeType));
    if(ps==='planet'||ps==='star')return 'solar';
    if(ps==='solar-system')return 'galaxy';
    if(ps==='galaxy')return 'universe';
  }
  return createdMegaViewerScale(mega)
}
function proceduralSeparateMegaHosts(scale,items){
  const unattached=megastructures().filter(m=>isSeparateMegastructure(m)&&separateMegaAnchors(m).length===0&&createdMegaViewerScale(m)===scale);
  const groups=new Map();
  unattached.forEach((mega,i)=>{
    if(!items.length)return;
    const seed=[...String(mega.id)].reduce((a,c)=>a+c.charCodeAt(0),0);
    const slot=Math.floor(seededUnit(seed,i,991.7)*items.length)%items.length;
    const host=items[slot];
    if(!groups.has(host.name))groups.set(host.name,[]);
    groups.get(host.name).push(mega)
  });
  return groups
}

function createdMegasForScale(scale){
  return megastructures().filter(mega=>{
    if(!isSeparateMegastructure(mega))return false;
    return separateMegaPlacementScale(mega)===scale
  })
}
function createdMegaPositionKey(scale){
  return `${worldPathKey(scale)}|${scale}`
}
function storedCreatedMegaPosition(mega,scale){
  const p=mega?.strategicPositions?.[createdMegaPositionKey(scale)];
  return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null
}
function setStoredCreatedMegaPosition(mega,scale,x,y){
  mega.strategicPositions??={};
  mega.strategicPositions[createdMegaPositionKey(scale)]={
    x:Math.max(-1.5,Math.min(2.5,x)),
    y:Math.max(-1.5,Math.min(2.5,y))
  };
  save()
}
function worldPointFromScaleScreen(canvas,sx,sy){
  const r=canvas.getBoundingClientRect(),cam=scaleNav.camera;
  return{
    x:(sx-r.width/2)/(r.width*cam.zoom)+cam.x,
    y:(sy-r.height/2)/(r.height*cam.zoom)+cam.y
  }
}
let strategicMegaDrag=null;

function createdMegaPosition(mega,index,total){
  const seed=[...String(mega.id)].reduce((a,c)=>a+c.charCodeAt(0),0);
  const a=seededUnit(seed,index,707.3)*Math.PI*2;
  const rr=.22+.25*seededUnit(seed,index,711.1);
  return {x:.5+Math.cos(a)*rr,y:.5+Math.sin(a)*rr*.82}
}
function createdMegaPrimaryPaint(mega){
  const faces=mega.createdMegaFaces||{};
  const face=createdMegaFaces(mega.createdMegaShape||'sphere')[0];
  return faces[face]||mega.megaPaintData||null
}
function drawCreatedMegaShape(ctx,mega,x,y,r){
  // Separate megastructures are 2D authored objects in strategic views.
  // Do NOT place their artwork over a generated sphere/planet/shape.
  const paint=createdMegaPrimaryPaint(mega);
  const tex=paint?.textureDataUrl?cachedMegaTexture(paint.textureDataUrl):null;

  // V20.0c absolute strategic size:
  // r is already world-space radius projected through camera zoom.
  // No camera-fixed minimum is allowed, so zooming out makes the object smaller
  // and zooming in makes it larger like every other world object.
  const scale=Math.max(.05,Math.min(8,+mega.createdMegaSize||1));
  const targetW=Math.max(2,r*3.2*scale);
  const targetH=Math.max(1,targetW*.5);

  ctx.save();

  if(tex?.img?.complete&&tex.img.naturalWidth){
    // Draw ONLY the painted texture. Transparent/erased pixels stay transparent,
    // so there is no blue planet baked underneath it.
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(tex.img,x-targetW/2,y-targetH/2,targetW,targetH);
  }else{
    // Texture may still be loading on the first frame. Show a tiny neutral
    // placeholder instead of inventing a planet behind it.
    ctx.strokeStyle='rgba(170,220,240,.45)';
    ctx.lineWidth=1;
    ctx.setLineDash([3,3]);
    ctx.strokeRect(x-targetW/2,y-targetH/2,targetW,targetH);
  }

  ctx.restore();

  // Return bounds so the caller can put the name beside the actual artwork.
  return {w:targetW,h:targetH};
}

function strategicMegastructuresForItem(item,scale){
  const node=item?.sourceId?byId(item.sourceId):null;
  if(!node)return [];

  const expected=scale==='solar'?'planetary':scale==='galaxy'?'solar-system':scale==='universe'?'galaxy':null;

  return megastructures().filter(mega=>{
    if(isSeparateMegastructure(mega))return false;
    if(!isAttachedMegastructure(mega))return false;
    if(!graphNodesLinked(node.id,mega.id))return false;
    if(expected&&mega.megastructureScale!==expected)return false;
    return true
  })
}
function strategicMegastructuresForContext(scale){
  const item=scaleNav.path.at(-1)?.item||null;
  const node=item?.sourceId?byId(item.sourceId):null;
  if(!node)return [];

  const expected=scale==='solar'?'stellar':scale==='galaxy'?'solar-system':scale==='universe'?'galaxy':null;

  return megastructures().filter(mega=>{
    if(isSeparateMegastructure(mega))return false;
    if(!isAttachedMegastructure(mega))return false;
    if(!graphNodesLinked(node.id,mega.id))return false;
    return mega.megastructureScale===expected
  })
}
function generateMapRoutes(items,seed){
  const routes=[],seen=new Set();
  const add=(a,b,type)=>{
    if(!a||!b||a===b)return;
    const key=[a.name,b.name].sort().join('|')+'|'+type;
    if(seen.has(key))return;seen.add(key);
    routes.push({a:a.name,b:b.name,type});
  };

  // Explicit Place relationships win.
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
    const t=graphRouteBetween(items[i],items[j]);
    if(t)add(items[i],items[j],t);
  }

  // Procedural context routes.
  for(let i=0;i<items.length;i++){
    const j=(i+1+Math.floor(seededUnit(seed,i,83.17)*Math.max(1,items.length-1)))%items.length;
    const roll=seededUnit(seed,i,97.31);
    if(roll<.16)add(items[i],items[j],'trade');
    else if(roll<.23)add(items[i],items[j],'war');
  }
  return routes;
}
function stableStringSeed(text){
  let h=2166136261>>>0;
  for(const ch of String(text||'')){
    h^=ch.charCodeAt(0);
    h=Math.imul(h,16777619)>>>0
  }
  return h>>>0
}

function directOrbitParentId(moon){
  if(!isMoonPlace(moon)||!moon.orbitingId)return null;
  const parent=byId(moon.orbitingId);
  return parent?.type==='place'&&!isStarSystemPlace(parent)
    ?parent.id
    :null
}

function dedicatedPrimaryPlanets(system){
  if(!system)return[];

  return ofType('place').filter(p=>{
    if(isMoonPlace(p))return false;
    const ps=String(p.placeScale||inferPlaceScale(p.placeType));
    if(ps!=='planet')return false;

    return edges.some(e=>{
      if(e.blocked||isVisualOnlyEdge(e))return false;
      const same=
        (e.a===system.id&&e.b===p.id) ||
        (e.b===system.id&&e.a===p.id);
      if(!same)return false;

      const label=String(e.label||'').toLowerCase();
      return(
        e.placeContainment===true ||
        label.includes('contains') ||
        label.includes('located in') ||
        label.includes('inside') ||
        label.includes('part of')
      )
    })
  })
}

function dedicatedMoonsForSystem(system,primaryIds){
  if(!system)return[];

  const accepted=new Set(primaryIds);
  const result=[];
  const seen=new Set();

  for(let pass=0;pass<24;pass++){
    let changed=false;

    for(const moon of ofType('place').filter(isMoonPlace)){
      if(seen.has(moon.id))continue;
      const parentId=directOrbitParentId(moon);
      if(!parentId||!accepted.has(parentId))continue;

      result.push(moon);
      seen.add(moon.id);
      accepted.add(moon.id);
      changed=true
    }

    if(!changed)break
  }

  return result
}

function stabilizedSolarSystemMap(system){
  // Deliberately tiny, side-effect-free Star System builder used if the
  // authored generator fails for any reason.
  const stars=systemStarRenderData(system);
  const primaries=ofType('place').filter(p=>
    p.type==='place' &&
    !isMoonPlace(p) &&
    String(p.placeScale||inferPlaceScale(p.placeType))==='planet' &&
    edges.some(e=>
      !e.blocked &&
      e.placeContainment===true &&
      ((e.a===system.id&&e.b===p.id)||(e.b===system.id&&e.a===p.id))
    )
  );

  const items=[];
  const bodyById=new Map();

  primaries.forEach((p,i)=>{
    const a=(i+1)*2.399963229728653;
    const r=.15+.055*i;
    const q={
      name:p.name,
      x:.5+Math.cos(a)*r,
      y:.5+Math.sin(a)*r*.86,
      authored:true,
      sourceId:p.id,
      isMoon:false,
      gasGiant:!!p.gasGiant,
      inhabitants:p.inhabitants||'None',
      softLocations:[]
    };
    items.push(q);
    bodyById.set(p.id,q)
  });

  // Preserve configured procedural planets in the stabilized renderer.
  const proceduralCount=Math.max(
    0,
    Math.min(24,+system.systemProceduralPlanetCount||0)
  );
  const generic=['Aurelia','Vesper','Cinder','Neris','Caelum','Oris','Thalos','Ilyra'];

  for(let j=0;j<proceduralCount;j++){
    const slot=primaries.length+j;
    const a=(slot+1)*2.399963229728653;
    const r=.15+.055*slot;

    items.push({
      name:generic[j%generic.length]+' '+(1+Math.floor(j/generic.length)),
      x:.5+Math.cos(a)*r,
      y:.5+Math.sin(a)*r*.86,
      authored:false,
      sourceId:null,
      isMoon:false,
      gasGiant:false,
      proceduralViewerOnly:true,
      inhabitants:'None',
      softLocations:[]
    })
  }

  // Moon membership comes ONLY from moon.orbitingId.
  const moons=ofType('place').filter(isMoonPlace);
  const placed=new Set(bodyById.keys());

  for(let pass=0;pass<16;pass++){
    let changed=false;

    for(const moon of moons){
      if(placed.has(moon.id))continue;

      const parent=moon.orbitingId?byId(moon.orbitingId):null;
      if(!parent||parent.type!=='place')continue;

      const host=bodyById.get(parent.id);
      if(!host)continue;

      const siblings=items.filter(q=>q.isMoon&&q.moonParentId===parent.id).length;
      const orbit=.022+.011*siblings;
      const seed=stableStringSeed(moon.id);
      const a=seededUnit(seed,siblings,881.17)*Math.PI*2;

      const q={
        name:moon.name,
        x:host.x+Math.cos(a)*orbit,
        y:host.y+Math.sin(a)*orbit,
        authored:true,
        sourceId:moon.id,
        isMoon:true,
        orbitingId:parent.id,
        gasGiant:!!moon.gasGiant,
        inhabitants:moon.inhabitants||'None',
        softLocations:[],
        moonOrbitRadius:orbit,
        moonParentId:parent.id,
        moonParentX:host.x,
        moonParentY:host.y,
        moonParentName:host.name
      };

      items.push(q);
      bodyById.set(moon.id,q);
      placed.add(moon.id);
      changed=true
    }

    if(!changed)break
  }

  return{
    scale:'solar',
    seed:stableStringSeed(system.id),
    items,
    routes:[],
    contextName:system.name,
    stars,
    star:stars[0]||null,
    dedicatedSolarRenderer:true,
    emergencySolarRenderer:false,
    stabilizedSolarRenderer:true,
    debugBodies:{
      stars:stars.length,
      primaryPlanets:primaries.length,
      proceduralPlanets:proceduralCount,
      moons:items.filter(q=>q.isMoon).length
    }
  }
}

function generateAuthoredSolarSystemMap(system,seedSalt=''){
  if(!isStarSystemPlace(system))return null;

  const baseSeed=stableStringSeed(
    `${system.id}|${system.name}|${seedSalt}|solar-v204e`
  );

  const stars=systemStarRenderData(system);
  const primaries=dedicatedPrimaryPlanets(system);
  const primaryIds=primaries.map(p=>p.id);
  const moons=dedicatedMoonsForSystem(system,primaryIds);

  const items=[];
  const bodyById=new Map();

  const proceduralCount=Math.max(
    0,
    Math.min(24,+system.systemProceduralPlanetCount||0)
  );

  const totalPrimary=Math.max(1,primaries.length+proceduralCount);

  primaries.forEach((planet,i)=>{
    const t=(i+1)/(totalPrimary+1);
    const radius=.12+t*.30;
    const angle=seededUnit(baseSeed,i,17.91)*Math.PI*2;

    const item={
      name:planet.name,
      x:.5+Math.cos(angle)*radius,
      y:.5+Math.sin(angle)*radius*.88,
      authored:true,
      sourceId:planet.id,
      isMoon:false,
      gasGiant:!!planet.gasGiant,
      inhabitants:planet.inhabitants||'None',
      softLocations:[]
    };

    items.push(item);
    bodyById.set(planet.id,item)
  });

  const generic=[
    'Aurelia','Vesper','Cinder','Neris',
    'Caelum','Oris','Thalos','Ilyra'
  ];

  for(let j=0;j<proceduralCount;j++){
    const slot=primaries.length+j;
    const t=(slot+1)/(totalPrimary+1);
    const radius=.12+t*.30;
    const angle=seededUnit(baseSeed,slot,17.91)*Math.PI*2;
    const inhabitedRoll=seededUnit(baseSeed,slot,73.91);

    items.push({
      name:generic[j%generic.length]+' '+(1+Math.floor(j/generic.length)),
      x:.5+Math.cos(angle)*radius,
      y:.5+Math.sin(angle)*radius*.88,
      authored:false,
      sourceId:null,
      isMoon:false,
      gasGiant:false,
      proceduralViewerOnly:true,
      inhabitants:
        inhabitedRoll<.25?'Inhabited':
        inhabitedRoll<.625?'None':'Temporary',
      softLocations:[]
    })
  }

  const shellCounts=new Map();
  const positioned=new Set(primaryIds);

  for(let pass=0;pass<24;pass++){
    let changed=false;

    for(const moon of moons){
      if(positioned.has(moon.id))continue;

      const parentId=directOrbitParentId(moon);
      if(!parentId)continue;

      const host=bodyById.get(parentId);
      if(!host)continue;

      const shell=shellCounts.get(parentId)||0;
      shellCounts.set(parentId,shell+1);

      const moonSeed=stableStringSeed(`${moon.id}|${parentId}`);
      const angle=seededUnit(moonSeed,shell,311.73)*Math.PI*2;
      const orbit=.020+.010*shell;

      const item={
        name:moon.name,
        x:host.x+Math.cos(angle)*orbit,
        y:host.y+Math.sin(angle)*orbit,
        authored:true,
        sourceId:moon.id,
        isMoon:true,
        orbitingId:parentId,
        gasGiant:!!moon.gasGiant,
        inhabitants:moon.inhabitants||'None',
        softLocations:[],
        moonOrbitRadius:orbit,
        moonParentId:parentId,
        moonParentX:host.x,
        moonParentY:host.y,
        moonParentName:host.name
      };

      items.push(item);
      bodyById.set(moon.id,item);
      positioned.add(moon.id);
      changed=true
    }

    if(!changed)break
  }

  return{
    scale:'solar',
    seed:baseSeed,
    items,
    routes:generateMapRoutes(items,baseSeed),
    contextName:system.name,
    stars,
    star:stars[0]||null,
    dedicatedSolarRenderer:true,
    debugBodies:{
      stars:stars.length,
      primaryPlanets:primaries.length,
      proceduralPlanets:proceduralCount,
      moons:items.filter(q=>q.isMoon).length
    }
  }
}

function generateScaleMap(seedSalt='',forceRegenerate=false){
  // IMPORTANT: map generation is READ-ONLY.
  const scale=mapDisplayLevel();
  if(scale==='planet'){simState.spaceMap=null;return}

  // V20.4e: authored Solar Systems bypass the generic hierarchy/cache path.
  if(scale==='solar'){
    const contextItem=scaleNav.path.at(-1)?.item||null;
    const contextPlace=contextItem?.sourceId?byId(contextItem.sourceId):null;

    if(isStarSystemPlace(contextPlace)){
      // V20.6: the proven safe Solar renderer IS now the primary renderer.
      // We no longer attempt the legacy authored generator first.
      simState.spaceMap=stabilizedSolarSystemMap(contextPlace);
      simState.spaceMap.emergencySolarRenderer=false;
      simState.spaceMap.stabilizedSolarRenderer=true;
      return
    }
  }

  const cacheKey=worldPathKey(scale);
  if(!forceRegenerate&&worldStateCache.maps[cacheKey]){
    const cached=deepCloneState(worldStateCache.maps[cacheKey]);

    // Reject cached maps whose authored references no longer match the current graph.
    // This is especially important after importing an older/newer .magicgraph.
    let stale=(cached.items||[]).some(item=>{
      if(item.sourceId&&!byId(item.sourceId))return true;
      return (item.softLocations||[]).some(s=>!byId(s.id));
    });

    // Hierarchy-aware cache validation.
    if(!stale&&scale==='galaxy'){
      const contextItem=scaleNav.path.at(-1)?.item||null;
      const contextPlace=contextItem?.sourceId?byId(contextItem.sourceId):null;

      for(const item of cached.items||[]){
        const node=item.sourceId?byId(item.sourceId):null;
        if(!node||String(node.placeScale||inferPlaceScale(node.placeType))!=='solar-system')continue;

        const parents=effectiveGalaxyParents(node);

        // Procedural galaxy: it must not contain authored systems unless they
        // were explicitly soft-located into THIS exact map object.
        if(!contextPlace&&contextItem){
          stale=true;
          break
        }

        // Authored galaxy: system must actually belong to this galaxy.
        if(contextPlace&&parents.length&&!parents.some(g=>g.id===contextPlace.id)){
          stale=true;
          break
        }
      }

      // V19.9k: validate the OTHER direction too.
      // If the graph now says this authored Galaxy contains a Star System,
      // but the cached map was generated before that link existed, rebuild it.
      if(!stale&&contextPlace){
        const expectedSystemIds=new Set(
          effectiveContainedPlaces(contextPlace)
            .filter(p=>String(p.placeScale||inferPlaceScale(p.placeType))==='solar-system')
            .map(p=>p.id)
        );
        const cachedSystemIds=new Set(
          (cached.items||[])
            .map(item=>item.sourceId?byId(item.sourceId):null)
            .filter(node=>node&&String(node.placeScale||inferPlaceScale(node.placeType))==='solar-system')
            .map(node=>node.id)
        );

        if(expectedSystemIds.size!==cachedSystemIds.size ||
           [...expectedSystemIds].some(id=>!cachedSystemIds.has(id))){
          stale=true;
        }
      }
    }

    if(!stale){
      const wantedScale=scale==='universe'?'galaxy':scale==='galaxy'?'solar-system':scale==='solar'?'planet':null;
      const contextItem=scaleNav.path.at(-1)?.item||null;
      const contextPlace=contextItem?.sourceId?byId(contextItem.sourceId):null;

      if(wantedScale&&contextPlace){
        const expectedPlaces=(scale==='solar'&&isStarSystemPlace(contextPlace))
          ?safeSolarSystemBodies(contextPlace)
          :effectiveContainedPlaces(contextPlace);
        const expectedIds=new Set(
          expectedPlaces
            .filter(p=>String(p.placeScale||inferPlaceScale(p.placeType))===wantedScale)
            .map(p=>p.id)
        );
        const cachedIds=new Set(
          (cached.items||[])
            .map(item=>item.sourceId?byId(item.sourceId):null)
            .filter(node=>node&&String(node.placeScale||inferPlaceScale(node.placeType))===wantedScale)
            .map(node=>node.id)
        );

        if(expectedIds.size!==cachedIds.size ||
           [...expectedIds].some(id=>!cachedIds.has(id))){
          stale=true;
        }
      }
    }

    if(!stale){
      if(cached.scale==='solar'){
        const contextItem=scaleNav.path.at(-1)?.item||null;
        const contextPlace=contextItem?.sourceId?byId(contextItem.sourceId):null;

        // Old caches may contain Moons as primary Planet entries. Rebuild them
        // so the dedicated Moon pass owns all Moon rendering.
        const cachedMoonIds=new Set(
          (cached.items||[])
            .filter(q=>q.sourceId&&isMoonPlace(byId(q.sourceId)))
            .map(q=>q.sourceId)
        );
        const expectedMoonIds=new Set(
          isStarSystemPlace(contextPlace)
            ?rendererMoonsForSystem(contextPlace).map(m=>m.id)
            :[]
        );

        if(
          cachedMoonIds.size!==expectedMoonIds.size ||
          [...cachedMoonIds].some(id=>!expectedMoonIds.has(id))
        ){
          stale=true
        }
      }

      if(!stale&&cached.scale==='solar'&&!Array.isArray(cached.stars)){
        const contextItem=scaleNav.path.at(-1)?.item||null;
        const contextPlace=contextItem?.sourceId?byId(contextItem.sourceId):null;
        cached.stars=systemStarRenderData(contextPlace);
        cached.star=cached.stars[0]||null
      }

      if(!stale){
        simState.spaceMap=cached;
        return;
      }
    }

    delete worldStateCache.maps[cacheKey];
  }

  const seed=Math.floor(Math.random()*1e9)+(seedSalt?[...seedSalt].reduce((a,c)=>a+c.charCodeAt(0),0)*7919:0);
  const places=placesForMapScale(scale),unresolved=unresolvedDescendantsForScale(scale);
  const currentContextItem=scaleNav.path.at(-1)?.item||null;
  const currentContextPlace=currentContextItem?.sourceId?byId(currentContextItem.sourceId):null;
  const proceduralPlanetCount=(scale==='solar'&&currentContextPlace?.placeScale==='solar-system')
    ?Math.max(0,Math.min(24,+currentContextPlace.systemProceduralPlanetCount||0))
    :null;

  const baseCount=scale==='solar'
    ?(proceduralPlanetCount===null?8:places.filter(p=>!isMoonPlace(p)).length+proceduralPlanetCount)
    :scale==='galaxy'?28:20;

  const count=Math.max(baseCount,places.length,unresolved.length?8:0);
  const generic=scale==='solar'
    ?['Aurelia','Vesper','Cinder','Neris','Caelum','Oris','Thalos','Ilyra']
    :scale==='galaxy'
      ?['Solara System','Veyr System','Nemor System','Aster System','Cael System','Orinth System']
      :['Aster Galaxy','Velorian Galaxy','Caelum Galaxy','Nemor Galaxy'];

  const items=[];
  for(let i=0;i<count;i++){
    const ang=seededUnit(seed,i)*Math.PI*2,dist=.12+.78*Math.sqrt(seededUnit(seed,i,31.17));
    const authored=places[i];
    const inhabitedRoll=seededUnit(seed,i,73.91);
    const proceduralInhabitants=inhabitedRoll<.25?'Inhabited':(inhabitedRoll<.625?'None':'Temporary');
    items.push({
      name:authored?.name||generic[i%generic.length]+' '+(1+Math.floor(i/generic.length)),
      x:.5+Math.cos(ang)*dist*.46,y:.5+Math.sin(ang)*dist*.43,
      authored:!!authored,sourceId:authored?.id||null,
      isMoon:!!authored?.isMoon,
      orbitingId:authored?.orbitingId||null,
      gasGiant:!!authored?.gasGiant,
      proceduralViewerOnly:scale==='solar'&&!authored&&proceduralPlanetCount!==null,
      inhabitants:authored?.inhabitants||proceduralInhabitants,
      softLocations:[]
    });
  }

  // Moons are appended AFTER primary planets. They do not need a System link.
  if(scale==='solar'&&currentContextPlace?.placeScale==='solar-system'){
    const already=new Set(items.map(q=>q.sourceId).filter(Boolean));
    // Renderer Moon membership is derived ONLY from Orbiting chains.
    const inferredMoons=rendererMoonsForSystem(currentContextPlace);

    for(const moon of inferredMoons){
      if(already.has(moon.id))continue;
      items.push({
        name:moon.name,x:.5,y:.5,authored:true,sourceId:moon.id,
        isMoon:true,orbitingId:moon.orbitingId||null,
        gasGiant:!!moon.gasGiant,
        inhabitants:moon.inhabitants||'None',
        softLocations:[]
      });
      already.add(moon.id)
    }
  }

  // MOON RENDERER PASS.
  // Moons are secondary bodies and are positioned only after every primary
  // Planet has a stable star-orbit position.
  if(scale==='solar'){
    const bodyById=new Map(items.filter(q=>q.sourceId).map(q=>[q.sourceId,q]));
    const positioned=new Set(
      items.filter(q=>!q.isMoon&&q.sourceId).map(q=>q.sourceId)
    );
    const shellIndex=new Map();
    const pending=items.filter(q=>q.isMoon&&q.sourceId);

    for(let pass=0;pass<24&&pending.length;pass++){
      let changed=false;

      for(const q of pending){
        if(positioned.has(q.sourceId))continue;

        const moon=byId(q.sourceId);
        if(!moon||!isMoonPlace(moon))continue;

        // Only Orbiting is allowed to define the parent.
        const parent=moonOrbitParentFromEdge(moon)||moonOrbitParent(moon);
        if(!parent)continue;

        // Never treat a Star System itself as a valid orbit parent.
        if(isStarSystemPlace(parent))continue;

        const host=bodyById.get(parent.id);
        if(!host)continue;

        // Nested Moon waits for its parent Moon to be positioned.
        if(host.isMoon&&!positioned.has(host.sourceId))continue;

        const slot=shellIndex.get(parent.id)||0;
        shellIndex.set(parent.id,slot+1);

        const seed2=[...String(moon.id)].reduce(
          (sum,ch)=>sum+ch.charCodeAt(0),0
        );

        const ang=seededUnit(seed2,slot,312.7)*Math.PI*2;

        // Keep Moon orbit much smaller than parent orbit around the star.
        const orbit=.022+.0105*slot;

        q.isMoon=true;
        q.orbitingId=parent.id;
        q.x=host.x+Math.cos(ang)*orbit;
        q.y=host.y+Math.sin(ang)*orbit;
        q.moonOrbitRadius=orbit;
        q.moonParentId=parent.id;
        q.moonParentX=host.x;
        q.moonParentY=host.y;
        q.moonParentName=host.name;

        positioned.add(q.sourceId);
        changed=true
      }

      if(!changed)break
    }

    // If a malformed Moon graph cannot resolve an Orbiting parent, remove that
    // Moon from THIS render only rather than letting bad coordinates crash the
    // whole system viewer.
    for(let i=items.length-1;i>=0;i--){
      const q=items[i];
      if(q.isMoon&&q.sourceId&&!positioned.has(q.sourceId)){
        items.splice(i,1)
      }
    }
  }

  unresolved.forEach((place,i)=>{
    const slot=Math.floor(seededUnit(seed,i,149.73)*items.length)%Math.max(1,items.length);
    const host=items[slot];if(!host)return;
    host.softLocated=true;
    host.softLocations.push({id:place.id,name:place.name,placeScale:place.placeScale||inferPlaceScale(place.placeType)});
  });

  const contextItem=currentContextItem;
  const contextPlace=currentContextPlace;
  const authoredStars=scale==='solar'?systemStarRenderData(contextPlace):[];
  simState.spaceMap={
    scale,seed,items,
    routes:generateMapRoutes(items,seed),
    contextName:contextItem?.name||null,
    stars:authoredStars,
    // Backwards compatibility for helpers expecting m.star.
    star:authoredStars[0]||null
  };
  worldStateCache.maps[cacheKey]=deepCloneState(simState.spaceMap);
  save();
}
function ensureScaleMap(){if(mapDisplayLevel()!=='planet'&&(!simState.spaceMap||simState.spaceMap.scale!==mapDisplayLevel()))generateScaleMap()}
function drawScaleMap(){
  const c=$('planetCanvas'),r=c.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);
  c.width=r.width*d;c.height=r.height*d;
  const x=c.getContext('2d');x.setTransform(d,0,0,d,0,0);
  x.fillStyle='#050912';x.fillRect(0,0,r.width,r.height);
  ensureScaleMap();const m=simState.spaceMap;if(!m)return;

  const cam=scaleNav.camera;
  const screen=(wx,wy)=>({
    x:(wx-cam.x)*r.width*cam.zoom+r.width/2,
    y:(wy-cam.y)*r.height*cam.zoom+r.height/2
  });

  // Background stars remain distant while strategic objects move with camera.
  for(let i=0;i<180;i++){
    x.fillStyle='rgba(220,235,255,.3)';
    x.fillRect(seededUnit(m.seed,i,17)*r.width,seededUnit(m.seed,i,29)*r.height,1,1)
  }

  // Current galaxy is the map itself: it fills the view at normal zoom,
  // scales/pans with the camera, and fades as we zoom toward a star system.
  if(m.scale==='galaxy'){
    const C=screen(.5,.5);
    const S=Math.min(r.width,r.height)*.48*cam.zoom;
    const fade=Math.max(0,Math.min(1,1-(cam.zoom-1)/5));

    x.save();x.translate(C.x,C.y);x.globalAlpha=fade;

    const coreGlow=x.createRadialGradient(0,0,0,0,0,S*.32);
    coreGlow.addColorStop(0,'rgba(245,248,255,.38)');
    coreGlow.addColorStop(.28,'rgba(155,195,245,.20)');
    coreGlow.addColorStop(1,'rgba(65,110,185,0)');
    x.fillStyle=coreGlow;x.beginPath();x.arc(0,0,S*.32,0,Math.PI*2);x.fill();

    for(let arm=0;arm<4;arm++){
      for(let i=0;i<180;i++){
        const u=i/180,t=u*8.6+arm*Math.PI/2;
        const rr=S*(.035+u*.93);
        const wobble=Math.sin(i*.61+arm*1.7)*S*.018;
        const px=Math.cos(t)*(rr+wobble);
        const py=Math.sin(t)*(rr+wobble)*.54;
        const alpha=.025+.11*(1-u);
        x.fillStyle=`rgba(125,180,245,${alpha})`;
        x.beginPath();x.arc(px,py,Math.max(.7,S*.004*(1-u*.55)),0,Math.PI*2);x.fill();
      }
    }

    x.fillStyle='rgba(242,246,255,.82)';
    x.beginPath();x.ellipse(0,0,S*.075,S*.034,0,0,Math.PI*2);x.fill();
    x.restore();x.globalAlpha=1;
  }

  // Solar System renderer — stable for zero, one, or many stars.
  if(m.scale==='solar'){
    const stars=Array.isArray(m.stars)&&m.stars.length
      ?m.stars
      :(m.star?[{...m.star,worldX:.5,worldY:.5}]:systemStarRenderData(null));

    const barycenter=screen(.5,.5);
    const renderedStars=[];

    for(const starInfo of stars){
      if(!starInfo)continue;
      const S=screen(
        Number.isFinite(starInfo.worldX)?starInfo.worldX:.5,
        Number.isFinite(starInfo.worldY)?starInfo.worldY:.5
      );

      const visualStarScale=Number.isFinite(starInfo.multiStarScale)
        ?starInfo.multiStarScale
        :1;
      const starRadius=Math.max(
        3.2,
        15*cam.zoom*(starInfo.size||1)*visualStarScale
      );

      const glowExtent=starInfo.multiStarScale<1?2.25:2.8;
      const glow=x.createRadialGradient(S.x,S.y,0,S.x,S.y,starRadius*glowExtent);
      glow.addColorStop(0,starInfo.color||'#fff0a0');
      glow.addColorStop(.35,starInfo.glow||'#ffb84d');
      glow.addColorStop(1,'rgba(255,190,60,0)');
      x.fillStyle=glow;
      x.beginPath();
      x.arc(S.x,S.y,starRadius*glowExtent,0,Math.PI*2);
      x.fill();

      const body=x.createRadialGradient(
        S.x-starRadius*.25,S.y-starRadius*.25,starRadius*.08,
        S.x,S.y,starRadius
      );
      body.addColorStop(0,'#ffffff');
      body.addColorStop(.35,starInfo.color||'#fff0a0');
      body.addColorStop(1,starInfo.color2||'#ffd36a');
      x.fillStyle=body;
      x.beginPath();
      x.arc(S.x,S.y,starRadius,0,Math.PI*2);
      x.fill();

      if(starInfo.authored&&starInfo.name&&cam.zoom<4){
        x.fillStyle='#fff2c5';
        x.font='10px system-ui';
        x.fillText(starInfo.name,S.x+starRadius+5,S.y-4)
      }

      renderedStars.push({info:starInfo,x:S.x,y:S.y,r:starRadius})
    }

    // Star-attached megastructures render around their actual star.
    const contextMegas=strategicMegastructuresForContext('solar');

    contextMegas.forEach((mega,mi)=>{
      const anchors=separateMegaAnchors(mega);
      const starAnchor=anchors.find(p=>
        String(p.placeScale||inferPlaceScale(p.placeType))==='star'
      );
      const host=
        renderedStars.find(s=>s.info.sourceId===starAnchor?.id)||
        renderedStars[0];

      if(!host)return;

      drawMegaPaintOnIcon(x,mega,host.x,host.y,host.r*1.45);

      x.save();
      x.strokeStyle=colorWithAlpha(
        mega.megaColor||'#6fdcff',
        (mega.megaOpacity??80)/100
      );
      x.lineWidth=1.5;
      x.beginPath();
      x.arc(host.x,host.y,host.r*(1.6+mi*.3),0,Math.PI*2);
      x.stroke();
      x.restore()
    });

    // Planet orbits are circumbarycentric.
    x.strokeStyle='rgba(150,180,220,.13)';
    for(const q of m.items){
      if(q.isMoon)continue;

      const worldDist=Math.hypot(q.x-.5,q.y-.5);
      const rr=worldDist*r.width*cam.zoom;

      if(!Number.isFinite(rr)||rr<=0)continue;

      x.beginPath();
      x.arc(barycenter.x,barycenter.y,rr,0,Math.PI*2);
      x.stroke()
    }

    // Moons orbit their selected parent Planet/Moon, not the system barycenter.
    for(const q of m.items.filter(q=>
      q.isMoon &&
      q.moonParentId &&
      Number.isFinite(q.x) &&
      Number.isFinite(q.y) &&
      Number.isFinite(q.moonParentX) &&
      Number.isFinite(q.moonParentY) &&
      Number.isFinite(q.moonOrbitRadius)
    )){
      const H=screen(q.moonParentX,q.moonParentY);
      const rr=(q.moonOrbitRadius||.025)*r.width*cam.zoom;

      x.save();
      x.strokeStyle='rgba(190,215,245,.34)';
      x.lineWidth=.9;
      x.beginPath();
      x.arc(H.x,H.y,rr,0,Math.PI*2);
      x.stroke();

      // Small parent-centered cue makes it obvious this is a moon orbit.
      x.fillStyle='rgba(210,230,250,.55)';
      x.beginPath();
      x.arc(H.x,H.y,1.2,0,Math.PI*2);
      x.fill();

      // Faint radial guide to the Moon's current orbital position.
      const M=screen(q.x,q.y);
      x.save();
      x.strokeStyle='rgba(180,210,240,.08)';
      x.lineWidth=.5;
      x.beginPath();
      x.moveTo(H.x,H.y);
      x.lineTo(M.x,M.y);
      x.stroke();
      x.restore();

      x.restore()
    }
  }

  drawTerritoryMapOverlay(x,screen,m);

  const visible=[];
  for(const q of (m.items||[])){
    try{
      if(!q||!Number.isFinite(q.x)||!Number.isFinite(q.y))continue;
      const P=screen(q.x,q.y);
    const itemPlace=q.sourceId?byId(q.sourceId):null;
    const itemPlaceScale=String(itemPlace?.placeScale||inferPlaceScale(itemPlace?.placeType)||'');
    const isStarSystemObject=itemPlaceScale==='solar-system';
    if(P.x<-50||P.y<-50||P.x>r.width+50||P.y>r.height+50)continue;

    let rad=(q.authored?6:3)*Math.min(2.2,Math.max(.8,Math.sqrt(cam.zoom)));
    if(q.isMoon)rad*=.48;
    if(q.gasGiant)rad*=1.42;
    if(m.scale==='universe'){
      rad*=1.4;
      const g=x.createRadialGradient(P.x,P.y,0,P.x,P.y,rad*2.8);
      g.addColorStop(0,q.authored?'rgba(150,230,255,.96)':'rgba(225,232,255,.92)');
      g.addColorStop(.35,q.authored?'rgba(105,175,255,.40)':'rgba(145,165,230,.30)');
      g.addColorStop(1,'rgba(80,100,180,0)');
      x.fillStyle=g;x.beginPath();x.arc(P.x,P.y,rad*2.8,0,Math.PI*2);x.fill();

      x.save();x.translate(P.x,P.y);x.rotate(.42);
      x.strokeStyle=q.authored?'rgba(165,235,255,.86)':'rgba(195,208,245,.72)';
      x.lineWidth=1.2;x.beginPath();x.ellipse(0,0,rad*1.9,rad*.72,0,0,Math.PI*2);x.stroke();x.restore();
    }

    const bodyNode=q.sourceId?byId(q.sourceId):null;
    x.fillStyle=q.gasGiant
      ?(bodyNode?.planetGasColor||'#d6b783')
      :q.isMoon
        ?(bodyNode?.planetLandColor||'#aeb8be')
        :q.softLocated?'#a9dcf4':(q.authored?'#8eeaff':'#d8e2f5');
    x.beginPath();x.arc(P.x,P.y,rad,0,Math.PI*2);x.fill();

    const itemMegas=strategicMegastructuresForItem(q,m.scale);
    itemMegas.forEach((mega,mi)=>{
      drawMegaPaintOnIcon(x,mega,P.x,P.y,Math.max(rad*2.4,12));
      const mr=rad+6+mi*4+(mega.megaCoverage||25)*.05;
      x.save();
      x.strokeStyle=colorWithAlpha(mega.megaColor||'#6fdcff',(mega.megaOpacity??80)/100);
      x.lineWidth=1.4;
      if(mega.megaPattern==='bands')x.setLineDash([6,3]);
      else if(mega.megaPattern==='grid')x.setLineDash([2,2]);
      x.beginPath();x.arc(P.x,P.y,mr,0,Math.PI*2);x.stroke();
      x.restore();
    });
    if(q.softLocated){
      x.save();x.strokeStyle='rgba(170,220,245,.55)';x.setLineDash([3,4]);x.lineWidth=1;
      x.beginPath();x.arc(P.x,P.y,rad+5,0,Math.PI*2);x.stroke();x.restore();
    }
    // Galaxy view: a Solar System is a real object, not merely a dot.
    // Show its star, graph-authored planets, and system-wide megastructure count.
    let starSystemBounds=null;
    {
      const qPlace=q.sourceId?byId(q.sourceId):null;
      const qScale=String(qPlace?.placeScale||inferPlaceScale(qPlace?.placeType)||'');
      // A Star System must always look like a Star System, even if it appears
      // directly in Universe view because it has no Galaxy parent / soft location.
      if(qScale==='solar-system'){
        const info=starSystemObjectInfo(q);
        const hierarchyBoost=m.scale==='universe'?1.22:1;
        const sysR=Math.max(13,Math.min(m.scale==='universe'?34:28,15*Math.sqrt(cam.zoom)*hierarchyBoost));
        const miniStars=info?.stars?.length?info.stars:[info?.star].filter(Boolean);

        x.save();

        // system boundary
        x.strokeStyle='rgba(150,190,235,.22)';
        x.lineWidth=1;
        x.beginPath();x.arc(P.x,P.y,sysR,0,Math.PI*2);x.stroke();

        // One or many compact stars.
        const starList=miniStars.length
          ?miniStars
          :[{starColor:'#fff0a0',starSize:1}];

        starList.slice(0,5).forEach((s,si)=>{
          const count=starList.length;
          const off=count===1
            ?{x:0,y:0}
            :{
              x:Math.cos(si/count*Math.PI*2)*sysR*.11,
              y:Math.sin(si/count*Math.PI*2)*sysR*.07
            };

          const sx=P.x+off.x,sy=P.y+off.y;
          const p=STAR_PRESETS[s.starPreset||'G']||STAR_PRESETS.G;
          const starColor=s.starColor||p.core;

          const sg=x.createRadialGradient(sx,sy,0,sx,sy,sysR*.26);
          sg.addColorStop(0,'#ffffff');
          sg.addColorStop(.35,starColor);
          sg.addColorStop(1,'rgba(255,195,90,0)');

          x.fillStyle=sg;
          x.beginPath();
          x.arc(sx,sy,sysR*.26,0,Math.PI*2);
          x.fill();

          x.fillStyle=starColor;
          x.beginPath();
          x.arc(
            sx,sy,
            Math.max(1.7,sysR*.09*(s.starSize||1)),
            0,Math.PI*2
          );
          x.fill()
        });

        // authored graph planets
        const planets=info?.planets||[];
        const primary=planets.filter(p=>!p.isMoon);
        const shown=primary.slice(0,8);
        const miniPositions=new Map();
        shown.forEach((p,pi)=>{
          const orbitR=sysR*(.42+.48*((pi+1)/Math.max(1,shown.length)));
          const ang=(pi*2.399)+(q.x||0)*8;
          x.strokeStyle='rgba(145,178,215,.12)';
          x.beginPath();x.arc(P.x,P.y,orbitR,0,Math.PI*2);x.stroke();

          const px=P.x+Math.cos(ang)*orbitR;
          const py=P.y+Math.sin(ang)*orbitR;
          const pr=Math.max(1.6,sysR*.07);
          x.fillStyle=p.planetLandColor||p.planetOceanColor||'#68b6da';
          x.beginPath();x.arc(px,py,pr,0,Math.PI*2);x.fill();
          x.strokeStyle='rgba(225,242,255,.55)';
          x.lineWidth=.5;x.stroke();
          miniPositions.set(p.id,{x:px,y:py,r:pr})
        });

        // Authored Moons visibly orbit their selected parent in the miniature.
        planets.filter(p=>p.isMoon&&p.orbitingId).slice(0,12).forEach((moon,mi)=>{
          const host=miniPositions.get(moon.orbitingId);if(!host)return;
          const orbitR=Math.max(3.5,sysR*(.08+.018*(mi%3)));
          const ang=mi*2.17+1.1;
          x.strokeStyle='rgba(190,210,230,.13)';
          x.beginPath();x.arc(host.x,host.y,orbitR,0,Math.PI*2);x.stroke();
          const mx=host.x+Math.cos(ang)*orbitR,my=host.y+Math.sin(ang)*orbitR;
          x.fillStyle=moon.planetLandColor||'#aab5bc';
          x.beginPath();x.arc(mx,my,Math.max(1,host.r*.48),0,Math.PI*2);x.fill()
        });

        // tiny mega tally badge
        const mc=info?.megaCount||0;
        if(mc>0){
          const bx=P.x+sysR*.72,by=P.y-sysR*.72;
          x.fillStyle='rgba(35,12,18,.92)';
          x.beginPath();x.arc(bx,by,7,0,Math.PI*2);x.fill();
          x.strokeStyle='rgba(255,190,200,.7)';x.stroke();
          x.fillStyle='#ffd7dc';x.font='7px system-ui';x.textAlign='center';x.textBaseline='middle';
          x.fillText(String(mc),bx,by+.2)
        }

        x.restore();
        // Always render the Star System's own name here rather than relying on
        // the generic map-label pass. This prevents Universe view from dropping
        // or replacing the system name because of soft-location logic.
        const starSystemDisplayName=authoredMapItemName(q);
        x.fillStyle='#dff5ff';
        x.font='10px system-ui';
        x.textAlign='left';
        x.textBaseline='middle';
        x.fillText(starSystemDisplayName,P.x+sysR+7,P.y);

        starSystemBounds={w:sysR*2,h:sysR*2,r:sysR};
      }
    }

    const megaCount=megastructureCountForMapItem(q,m.scale,m.items);
    if(q.authored||q.softLocated||cam.zoom>2){
      const softName=q.softLocations?.map(s=>s.name).join(', ');

      // Star Systems draw their own label in the miniature-system renderer.
      // Other objects continue through the generic label path.
      if(!starSystemBounds){
        x.fillStyle=q.softLocated?'#bfe8fb':'#dfeaff';
        x.font='10px system-ui';
        const baseName=authoredMapItemName(q);
        const bodyPrefix=q.isMoon?'☾ ':q.gasGiant?'◉ ':'';
        const objectLabel=bodyPrefix+(q.softLocated&&softName?`${baseName} · ${softName}`:baseName);
        x.textAlign='left';
        x.textBaseline='alphabetic';
        x.fillText(objectLabel,P.x+8,P.y-5);
      }

      if(megaCount>0){
        x.fillStyle='rgba(255,218,218,.78)';
        x.font='8px system-ui';
        x.textAlign='left';
        x.textBaseline='alphabetic';
        const countX=starSystemBounds?P.x+starSystemBounds.r+7:P.x+8;
        const countY=starSystemBounds?P.y+12:P.y+7;
        x.fillText(`${megaCount} megastructure${megaCount===1?'':'s'}`,countX,countY)
      }
    }
    visible.push({
      ...q,
      name:starSystemBounds?authoredMapItemName(q):q.name,
      sx:P.x,sy:P.y,
      sr:starSystemBounds?.r||Math.max(10,rad+6),
      sw:starSystemBounds?.w,sh:starSystemBounds?.h,
      infoKind:starSystemBounds?'star-system':'place',
      megaCount
    });
    }catch(err){
      console.error('Skipping bad Solar/System map object',q,err)
    }
  }

  drawScaleEventMarkers(x,screen,m,visible);

  // Separate Megastructures: linked Places act as anchors.
  const created=createdMegasForScale(m.scale);
  const proceduralHosts=proceduralSeparateMegaHosts(m.scale,m.items);

  // Unanchored separate megastructures still receive a deterministic procedural
  // position, but no host planet/system tint is drawn around them.

  created.forEach((mega,i)=>{
    if(!separateMegaVisibleInCurrentContext(mega,m.scale,m.items))return;
    const placement=resolveSeparateMegaPhysicalPlacement(mega);
    let wp;
    if(placement){
      const candidateIds=[
        placement.anchor?.id,
        m.scale==='solar'?placement.systemId:null,
        m.scale==='galaxy'?placement.galaxyId:null
      ].filter(Boolean);
      const hostItem=m.items.find(q=>candidateIds.includes(q.sourceId));
      if(!hostItem)return; // anchored Separate megas never fall back to random placement.
      const ang=(i+1)*1.91,offset=.035+.012*(i%3);
      wp={x:hostItem.x+Math.cos(ang)*offset,y:hostItem.y+Math.sin(ang)*offset}
    }else{
      const groups=proceduralHosts;
      let hostItem=null;
      for(const [hostName,megas] of groups)if(megas.includes(mega)){hostItem=m.items.find(q=>q.name===hostName);break}
      wp=hostItem?{x:hostItem.x+.028,y:hostItem.y-.022}:createdMegaPosition(mega,i,created.length)
    }

    // User-dragged position overrides the automatic anchor offset, but only
    // inside this exact map context.
    const manualPos=storedCreatedMegaPosition(mega,m.scale);
    if(manualPos)wp={x:manualPos.x,y:manualPos.y};

    const P=screen(wp.x,wp.y);

    // V20.0c: absolute WORLD size. Screen size changes linearly with camera
    // zoom rather than staying roughly fixed to the camera.
    const baseR=10*cam.zoom;
    const megaBounds=drawCreatedMegaShape(x,mega,P.x,P.y,baseR);
    if(cam.zoom>.8){
      x.fillStyle='#ffdede';
      x.font='10px system-ui';
      x.textBaseline='middle';
      x.fillText(mega.name,P.x+(megaBounds?.w||baseR*2)/2+7,P.y);
    }

    visible.push({
      name:mega.name,
      x:wp.x,y:wp.y,
      sx:P.x,sy:P.y,
      sr:Math.max(12,(megaBounds?.w||baseR*2)/2),
      sw:megaBounds?.w||baseR*2,
      sh:megaBounds?.h||baseR,
      infoKind:'megastructure',
      sourceId:mega.id,
      mega,
      draggableMega:true,
      scale:m.scale
    });
  });
  // Strategic trade / war routes render in camera-space between their objects.
  const byName=new Map(m.items.map(q=>[q.name,q]));
  for(const route of m.routes||[]){
    const A=byName.get(route.a),B=byName.get(route.b);if(!A||!B)continue;
    const P=screen(A.x,A.y),Q=screen(B.x,B.y);
    x.save();
    x.strokeStyle=route.type==='war'?'rgba(235,105,105,.72)':'rgba(115,220,178,.58)';
    x.lineWidth=route.type==='war'?1.8:1.35;
    if(route.type==='war')x.setLineDash([6,5]); else x.setLineDash([2,4]);
    x.beginPath();x.moveTo(P.x,P.y);
    const mx=(P.x+Q.x)/2,my=(P.y+Q.y)/2-18*Math.min(2,cam.zoom);
    x.quadraticCurveTo(mx,my,Q.x,Q.y);x.stroke();
    x.restore();
  }

  c._scaleVisibleItems=visible;
}
function syncSimulationMapDockLabel(){
  const level=mapDisplayLevel?.()||'planet';
  const label=
    level==='universe'?'Universe':
    level==='galaxy'?'Galaxy':
    level==='solar'?'Solar System':'Planet';
  if($('planetScaleEyebrow'))$('planetScaleEyebrow').textContent=label
}

function refreshWorldMapMode(){
  syncSimulationMapDockLabel();
  const sc=mapDisplayLevel(),planet=sc==='planet',e=document.querySelector('#planetViewPanel .planet-panel-head .eyebrow');
  if(e)e.textContent=systemScaleLabel(sc);
  $('planetName').textContent=planet?(simState.planet?.name||'Procedural World'):systemScaleLabel(sc)+' Map';

  const contextItem=scaleNav.path.at(-1)?.item||null;
  const contextPlace=contextItem?.sourceId?byId(contextItem.sourceId):activePlanetPlace();
  const contextMegaCount=contextPlace?megastructureCountForPlace(contextPlace):0;

  if(!planet){
    $('planetMeta').textContent=`${placesForMapScale(sc).length} authored child places · ${contextMegaCount} megastructure${contextMegaCount===1?'':'s'} · ${(simState.spaceMap?.routes||[]).filter(r=>r.type==='trade').length} trade routes · ${(simState.spaceMap?.routes||[]).filter(r=>r.type==='war').length} war routes`
  }else if(contextPlace){
    $('planetMeta').textContent=`${contextMegaCount} megastructure${contextMegaCount===1?'':'s'} · ${$('planetMeta').textContent||''}`.replace(/ · 0 megastructures · /,' · ')
  }

  $('regenPlanet').textContent=planet?'↻ Regenerate':'↻ Regenerate Map';

  if(!planet&&simState.spaceMap?.dedicatedSolarRenderer){
    const d=simState.spaceMap.debugBodies||{};
    $('planetMeta').textContent=
      `${d.stars||0} star${d.stars===1?'':'s'} · `+
      `${d.primaryPlanets||0} planet${d.primaryPlanets===1?'':'s'} · `+
      `${d.moons||0} moon${d.moons===1?'':'s'}`+
      `${simState.spaceMap.stabilizedSolarRenderer?' · STABLE':''}`
  }
  renderGalacticCoordinates();
  syncHistoryMapUI();
  const h=document.querySelector('.planet-hint');
  if(h)h.textContent=planet?'Drag in any direction to rotate · Scroll to zoom · Click icons for info':'Scroll to zoom · Click objects for info · Double-click to enter · Right-click to go back'
}

function drawPlanet(){
  if(mapDisplayLevel()!=='planet'){drawScaleMap();return}
  const canvas=$('planetCanvas'),modal=$('simulationModal');
  if(!canvas||!modal||modal.classList.contains('hidden'))return;
  ensurePlanet();
  const ctx=canvas.getContext('2d',{alpha:false}),r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,1.5);
  if(r.width<20||r.height<20)return;
  if(canvas.width!==Math.round(r.width*d)||canvas.height!==Math.round(r.height*d)){canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d)}
  ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,r.width,r.height);
  const R=Math.min(r.width,r.height)*.39*planetView.zoom,cx=r.width/2+planetView.panX,cy=r.height/2+planetView.panY;
  const ocean=ctx.createRadialGradient(cx-R*.3,cy-R*.35,R*.1,cx,cy,R*1.1);
  const gas=!!simState.planet?.gasGiant;
  const oceanBase=gas
    ?(simState.planet?.gasColor||'#d6b783')
    :(simState.planet?.oceanEnabled===false?(simState.planet?.landColor||'#8a7654'):(simState.planet?.oceanColor||'#315f9f'));
  const oceanDeep=gas
    ?(simState.planet?.gasColor2||'#a87a58')
    :(simState.planet?.oceanEnabled===false?(simState.planet?.landColor2||oceanBase):(simState.planet?.oceanColor2||'#102f58'));
  ocean.addColorStop(0,oceanBase);ocean.addColorStop(.62,oceanBase);ocean.addColorStop(1,oceanDeep);
  ctx.fillStyle=ocean;ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.fill();
  // Cached spherical surface mesh.
  // All procedural continent / biome calculations happened once when the
  // planet was generated. A redraw only projects cached polygons.
  ctx.save();
  ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.clip();

  for(const cell of planetTerrainCache){
    const mid=planetProject(cell.midLat,cell.midLon,r.width,r.height);
    if(!mid.front)continue;

    const p00=planetProject(cell.lat0,cell.lon0,r.width,r.height);
    const p10=planetProject(cell.lat0,cell.lon1,r.width,r.height);
    const p11=planetProject(cell.lat1,cell.lon1,r.width,r.height);
    const p01=planetProject(cell.lat1,cell.lon0,r.width,r.height);

    if(!p00.front&&!p10.front&&!p11.front&&!p01.front)continue;

    ctx.fillStyle=cell.color;
    ctx.globalAlpha=1;

    ctx.beginPath();
    ctx.moveTo(p00.x,p00.y);
    ctx.lineTo(p10.x,p10.y);
    ctx.lineTo(p11.x,p11.y);
    ctx.lineTo(p01.x,p01.y);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
  ctx.globalAlpha=1;ctx.strokeStyle='rgba(135,202,235,.38)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.stroke();

  const cloudPlanet=activePlanetPlace();
  const cloudMegas=megastructuresLinkedToNode(cloudPlanet).filter(s=>s.megastructureScale==='planetary');
  const cloudsBelow=cloudMegas.length>0&&cloudMegas.every(s=>s.megaCloudLayer==='below');

  if(cloudsBelow)drawPlanetClouds(ctx,r.width,r.height,'below');
  // Connected displaced mesh contains the Attached paint AND Height Map geometry.
  drawPlanetCavities(ctx,r.width,r.height);

  // Compatibility hook; the mesh already rendered the paint.
  drawAttachedMegaPaintDetail(ctx,r.width,r.height);

  // REAL SURFACE OCCLUSION:
  // water now exists as a projected planet surface after megastructure paint,
  // so submerged/recessed paint cannot phase through it.
  drawPlanetSurfaceOcclusion(ctx,r.width,r.height);

  // Non-paint megastructure visual extras (rings/lattice/spires/etc.).
  drawPlanetaryMegastructures(ctx,r.width,r.height);

  if(!cloudsBelow)drawPlanetClouds(ctx,r.width,r.height,'above');

  // V19.9AA temporary diagnostic overlay.
  drawMegaDominantColorDebug(ctx,r.width,r.height);

  const planetStage=civilizationStage(simState.population||0);
  if(['mega','stellar','ringworld','decillion','hyper'].includes(planetStage.id)){
    ctx.save();ctx.translate(cx,cy);
    if(['ringworld','decillion','hyper'].includes(planetStage.id)){
      ctx.strokeStyle=planetStage.id==='hyper'?'rgba(220,235,255,.75)':'rgba(130,190,235,.55)';
      ctx.lineWidth=planetStage.id==='hyper'?4:2.4;
      ctx.beginPath();ctx.ellipse(0,0,R*1.28,R*.28,planetView.pitch*.35,0,Math.PI*2);ctx.stroke();
    }
    if(['stellar','ringworld','decillion','hyper'].includes(planetStage.id)){
      ctx.strokeStyle='rgba(150,210,255,.28)';ctx.lineWidth=1;
      for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(0,0,R*(1.08+i*.09),R*(.10+i*.045),planetView.pitch*.22+i*.4,0,Math.PI*2);ctx.stroke();}
    }
    if(planetStage.id==='hyper'){ctx.fillStyle='rgba(190,225,255,.06)';ctx.beginPath();ctx.arc(0,0,R*1.06,0,Math.PI*2);ctx.fill();}
    ctx.restore();
  }

  const visible=[];
  for(const loc of simState.locations||[]){const P=planetProject(loc.lat,loc.lon,r.width,r.height);if(!P.front)continue;visible.push({...loc,sx:P.x,sy:P.y});ctx.save();ctx.translate(P.x,P.y);ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fillStyle='rgba(7,12,19,.88)';ctx.fill();ctx.strokeStyle='rgba(224,236,255,.35)';ctx.stroke();ctx.font='12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';ctx.fillText(planetIcon(loc.type),0,0);ctx.restore()}
  drawPlanetEventMarkers(ctx,r.width,r.height,visible);
  canvas._visibleLocations=visible;
}

function showScaleObjectTooltip(hit,x,y,r){
  const tip=$('planetTooltip');if(!tip)return;
  tip.classList.remove('hidden');

  if(hit.infoKind==='event'){
    const ev=simState.events.find(e=>e.id===hit.eventId);if(!ev)return;
    tip.innerHTML=`<b>◆ ${E.esc(ev.title)}</b><span>Year ${ev.year} · ${E.esc(ev.kind)}</span><p>${E.esc(ev.text)}</p><div class="planet-link-ref">Location: <b>${E.esc(eventLocationLabel(ev))}</b></div><small>Double-click to travel</small>`;
    tip.style.left=Math.min(r.width-250,x+14)+'px';tip.style.top=Math.min(r.height-190,y+14)+'px';return
  }

  if(hit.infoKind==='megastructure'){
    const mega=hit.mega||byId(hit.sourceId);
    if(!mega)return;
    const anchors=separateMegaAnchors(mega);
    const anchorText=anchors.length
      ?anchors.map(p=>E.esc(p.name)).join(', ')
      :'Procedural / unanchored placement';
    const scaleLabel=String(mega.megastructureScale||'planetary').replaceAll('-',' ');
    const mode=mega.megaEditorMode==='attached'?'Attached':'Separate';

    tip.innerHTML=`
      <b>◈ ${E.esc(mega.name)}</b>
      <span>${mode} Megastructure</span>
      <p>${E.esc(mega.description||mega.property||'A constructed megastructure in this magical system.')}</p>
      <div class="planet-link-ref">Scale: <b>${E.esc(scaleLabel)}</b></div>
      <div class="planet-link-ref">Placement: <b>${anchorText}</b></div>
      ${mega.createdMegaSize?`<div class="planet-link-ref">Relative size: ${Number(mega.createdMegaSize).toFixed(2)}× planet diameter</div>`:''}
    `;

    selected=mega;graph.selected=mega;showSelection();renderLibraries()
  }else{
    const source=hit.sourceId?byId(hit.sourceId):null;
    const megaCount=Number.isFinite(hit.megaCount)?hit.megaCount:(source?megastructureCountForPlace(source):0);
    const type=source
      ?placeHierarchyLabel(source)
      :(mapDisplayLevel()==='solar'?'Planet':mapDisplayLevel()==='galaxy'?'Solar System':'Galaxy');
    const inhabitants=source?.inhabitants||hit.inhabitants||'Unknown';

    if(hit.infoKind==='star-system'&&source){
      const info=starSystemObjectInfo(hit);
      const planetNames=(info?.planets||[]).map(p=>E.esc(p.name));
      const starNames=(info?.stars||[]).map(s=>E.esc(s.name));
      const starName=starNames.length?starNames.join(', '):'Procedural star';
      tip.innerHTML=`
        <b>☀ ${E.esc(authoredMapItemName(hit))}</b>
        <span>Star System</span>
        <p>${E.esc(source.description||'A star system containing its linked graph-authored worlds and megastructures.')}</p>
        <div class="planet-link-ref">Stars: <b>${starName}</b></div>
        <div class="planet-link-ref">Planets: <b>${planetNames.length}</b>${planetNames.length?` · ${planetNames.join(', ')}`:''}</div>
        <div class="planet-link-ref">Megastructures: <b>${info?.megaCount||0}</b></div>
        <div class="planet-link-ref">Graph node: <b>${E.esc(source.name)}</b></div>
        ${mapDisplayLevel()==='universe'
          ?'<div class="planet-link-ref">Shown directly in Universe view because this system is currently located at that hierarchy level.</div>'
          :''}
        <small>Double-click to enter system</small>
      `;
      selected=source;graph.selected=source;showSelection();renderLibraries();
      tip.style.left=Math.min(r.width-250,x+14)+'px';
      tip.style.top=Math.min(r.height-190,y+14)+'px';
      return
    }

    tip.innerHTML=`
      <b>${E.esc(hit.name)}</b>
      <span>${E.esc(type)}</span>
      <p>${E.esc(source?.description||source?.property||'A location in the simulated magical world.')}</p>
      <div class="planet-link-ref">Megastructures: <b>${megaCount}</b></div>
      ${source&&isMoonPlace(source)&&moonOrbitParent(source)?`<div class="planet-link-ref">Orbiting: <b>${E.esc(moonOrbitParent(source).name)}</b></div>`:''}
      ${(type==='Planet'||type==='Moon')?`<div class="planet-link-ref">Inhabitants: ${E.esc(inhabitants)}</div>`:''}
      ${source?`<div class="planet-link-ref">Graph node: <b>${E.esc(source.name)}</b></div>`:''}
    `;

    if(source){selected=source;graph.selected=source;showSelection();renderLibraries()}
  }

  tip.style.left=Math.min(r.width-250,x+14)+'px';
  tip.style.top=Math.min(r.height-190,y+14)+'px'
}
function hitScalePhysicalObject(c,mx,my){
  // V20.0a: event markers are overlays, not hierarchy-navigation objects.
  // Prefer actual Place / Star System objects underneath them.
  const items=[...(c._scaleVisibleItems||[])].reverse();

  return items.find(q=>{
    if(q.infoKind==='event'||q.infoKind==='megastructure')return false;

    if(q.infoKind==='star-system'&&q.sw&&q.sh){
      return Math.abs(mx-q.sx)<=q.sw/2+5&&Math.abs(my-q.sy)<=q.sh/2+5
    }

    return Math.hypot(q.sx-mx,q.sy-my)<=q.sr
  })
}

function hitScaleObject(c,mx,my){
  const items=[...(c._scaleVisibleItems||[])].reverse();

  // Events get a deliberately small exact-hit radius.
  // They are overlays and should not mask the physical object beneath them.
  const eventHit=items.find(q=>
    q.infoKind==='event' &&
    Math.hypot(q.sx-mx,q.sy-my)<=5.5
  );
  if(eventHit)return eventHit;

  // Normal physical/info objects.
  return items.find(q=>{
    if(q.infoKind==='event')return false;

    if((q.infoKind==='megastructure'||q.infoKind==='star-system')&&q.sw&&q.sh){
      return Math.abs(mx-q.sx)<=q.sw/2+5&&Math.abs(my-q.sy)<=q.sh/2+5
    }

    return Math.hypot(q.sx-mx,q.sy-my)<=q.sr
  })
}
function strategicMinZoomForLevel(level=mapDisplayLevel()){
  // Current strategic stages all share the same camera floor, but this helper
  // keeps the exit rule stage-aware if individual floors are changed later.
  if(level==='universe')return .45;
  if(level==='galaxy')return .45;
  if(level==='solar')return .45;
  return .45
}
function planetMinZoom(){
  return .55
}

function bindPlanetControls(){
  bindHistoryMapControls();
  const c=$('planetCanvas');if(!c||c._v16Bound)return;c._v16Bound=true;

  c.addEventListener('contextmenu',e=>e.preventDefault());

  c.addEventListener('pointerdown',e=>{
    const r=c.getBoundingClientRect();
    const mx=e.clientX-r.left,my=e.clientY-r.top;

    // Strategic-map Separate Megastructures are draggable world objects.
    if(mapDisplayLevel()!=='planet'&&e.button===0){
      const hit=hitScaleObject(c,mx,my);
      if(hit?.infoKind==='megastructure'&&hit.draggableMega&&hit.mega){
        strategicMegaDrag={
          mega:hit.mega,
          scale:mapDisplayLevel(),
          pointerId:e.pointerId,
          moved:false,
          startX:e.clientX,
          startY:e.clientY
        };
        c.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        return
      }
    }

    planetView.drag=true;
    planetView.lastX=e.clientX;
    planetView.lastY=e.clientY;

    // One simple gesture: dragging the globe rotates it freely in both axes.
    planetView.dragMode='rotate';
    c.setPointerCapture?.(e.pointerId);
  });

  c.addEventListener('pointermove',e=>{
    if(strategicMegaDrag&&strategicMegaDrag.pointerId===e.pointerId){
      const r=c.getBoundingClientRect();
      const p=worldPointFromScaleScreen(c,e.clientX-r.left,e.clientY-r.top);
      strategicMegaDrag.moved ||= Math.hypot(
        e.clientX-strategicMegaDrag.startX,
        e.clientY-strategicMegaDrag.startY
      )>3;
      setStoredCreatedMegaPosition(
        strategicMegaDrag.mega,
        strategicMegaDrag.scale,
        p.x,p.y
      );
      requestPlanetDraw();
      return
    }

    if(!planetView.drag)return;
    const dx=e.clientX-planetView.lastX;
    const dy=e.clientY-planetView.lastY;

    // One gesture, two axes: every drag rotates the globe.
    const sensitivity=.008/Math.max(.8,planetView.zoom);
    planetView.yaw+=dx*sensitivity;
    planetView.pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,planetView.pitch-dy*sensitivity));

    planetView.lastX=e.clientX;
    planetView.lastY=e.clientY;
    requestPlanetDraw();
  });

  c.addEventListener('pointerup',e=>{
    if(strategicMegaDrag&&strategicMegaDrag.pointerId===e.pointerId){
      strategicMegaDrag=null;
      c.releasePointerCapture?.(e.pointerId);
      save();
      return
    }
    planetView.drag=false;
    c.releasePointerCapture?.(e.pointerId);
  });
  c.addEventListener('pointercancel',e=>{
    if(strategicMegaDrag&&strategicMegaDrag.pointerId===e.pointerId)strategicMegaDrag=null;
    planetView.drag=false
  });

  c.addEventListener('dblclick',e=>{
    if(mapDisplayLevel()==='planet')return;
    const r=c.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
    // Double-click is reserved for physical hierarchy navigation.
    // Event markers can overlap planets, but they must never hijack zoom.
    const hit=hitScalePhysicalObject(c,mx,my);
    if(!hit||scaleNav.transitioning)return;

    tweenScaleCamera(
      {x:hit.x,y:hit.y,zoom:8},
      520,
      ()=>{
        const next=hierarchyChildLevel(mapDisplayLevel());
        if(next==='planet')enterPlanetFromMap(hit);
        else childMapFor(hit)
      }
    )
  });
  c.addEventListener('contextmenu',e=>{if(mapDisplayLevel()!=='planet'&&scaleNav.path.length){e.preventDefault();backScaleLevel()}});
  c.addEventListener('wheel',e=>{
    e.preventDefault();
    if(mapDisplayLevel()!=='planet'){
      const r=c.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
      const level=mapDisplayLevel();
      const minZoom=strategicMinZoomForLevel(level);
      const oldZoom=scaleNav.camera.zoom;
      const before={
        x:(mx-r.width/2)/(r.width*oldZoom)+scaleNav.camera.x,
        y:(my-r.height/2)/(r.height*oldZoom)+scaleNav.camera.y
      };

      const requested=oldZoom*Math.exp(-e.deltaY*.0012);
      const z=Math.max(minZoom,Math.min(12,requested));

      scaleNav.camera.zoom=z;
      scaleNav.camera.x=before.x-(mx-r.width/2)/(r.width*z);
      scaleNav.camera.y=before.y-(my-r.height/2)/(r.height*z);

      // V20.6a:
      // Reaching the real minimum zoom does NOT exit the stage.
      // The user gets to see the fully zoomed-out view first.
      // Only a FURTHER outward scroll while already at the minimum exits.
      const alreadyAtMin=oldZoom<=minZoom+.0005;
      if(
        e.deltaY>0 &&
        alreadyAtMin &&
        requested<minZoom &&
        scaleNav.path.length &&
        !scaleNav.transitioning
      ){
        backScaleLevel();
        return
      }

      const hit=hitScalePhysicalObject(c,mx,my);
      const transitionReady=
        !scaleNav.transitioning &&
        (performance.now()-scaleNav.lastTransitionAt)>500;

      if(hit&&z>8&&transitionReady){
        tweenScaleCamera(
          {x:hit.x,y:hit.y,zoom:10},
          420,
          ()=>{
            const next=hierarchyChildLevel(mapDisplayLevel());
            if(next==='planet')enterPlanetFromMap(hit);
            else childMapFor(hit)
          }
        )
      }

      requestPlanetDraw();
      return
    }

    const minZoom=planetMinZoom();
    const oldZoom=planetView.zoom;
    const requested=oldZoom*Math.exp(-e.deltaY*.001);
    planetView.zoom=Math.max(minZoom,Math.min(3.8,requested));

    // Same rule for Planet -> Solar System:
    // first hit the real 0.55 minimum; another outward scroll exits.
    const alreadyAtMin=oldZoom<=minZoom+.0005;
    if(
      e.deltaY>0 &&
      alreadyAtMin &&
      requested<minZoom &&
      scaleNav.path.length
    ){
      backScaleLevel();
      return
    }

    requestPlanetDraw();
  },{passive:false});

  c.addEventListener('click',e=>{
    const r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,tip=$('planetTooltip');

    if(mapDisplayLevel()!=='planet'){
      const scaleHit=hitScaleObject(c,x,y);
      if(!scaleHit){tip.classList.add('hidden');return}
      showScaleObjectTooltip(scaleHit,x,y,r);
      if((scaleHit.infoKind==='place'||scaleHit.infoKind==='star-system')&&scaleHit.sourceId){
        const p=byId(scaleHit.sourceId);if(p?.type==='place')inspectPlace(p)
      }
      return
    }

    const visible=(c._visibleLocations||[]);
    // Physical planet locations win over event overlays.
    const physicalHit=visible.find(l=>l.infoKind!=='event'&&Math.hypot(l.sx-x,l.sy-y)<14);
    const eventHit=visible.find(l=>l.infoKind==='event'&&Math.hypot(l.sx-x,l.sy-y)<6);
    const hit=eventHit||physicalHit;

    if(!hit){tip.classList.add('hidden');return}
    if(hit.infoKind==='event'){
      inspectEvent(hit.eventId);
      tip.classList.add('hidden');
      return
    }
    if(hit.source){
      const sourceNode=byId(hit.source);
      if(sourceNode){
        selected=sourceNode;
        graph.selected=sourceNode;
        showSelection();
        renderLibraries();
        if(sourceNode.type==='place')inspectPlace(sourceNode);
      }
    }
    tip.classList.remove('hidden');
    const sourceNode=hit.source?byId(hit.source):null;
    const linkedText=hit.linkedPlaceName?`<div class="planet-link-ref">Linked to place: <b>${E.esc(hit.linkedPlaceName)}</b></div>`:'';
    const graphText=sourceNode?`<div class="planet-link-ref">Graph node: <b>${E.esc(sourceNode.name)}</b> · ${E.esc(sourceNode.type)}</div>`:'';
    const extra=hit.inhabitants?`<div class="planet-link-ref">Inhabitants: ${E.esc(hit.inhabitants)}</div>`:'';
    tip.innerHTML=`<b>${planetIcon(hit.type)} ${E.esc(hit.name)}</b><span>${E.esc(hit.type)}</span><p>${E.esc(hit.detail||'')}</p>${linkedText}${graphText}${extra}<small>Year ${hit.founded??0}</small>`;
    tip.style.left=Math.min(r.width-250,x+14)+'px';
    tip.style.top=Math.min(r.height-170,y+14)+'px';
  });
}


const TECH_DISCOVERY_NAMES=[
  ['Mana Conduit','Channels stable Mana through built infrastructure.'],
  ['Arcane Relay','Transfers magical signals and controlled effects across long distances.'],
  ['Enchanted Production Line','Uses repeatable enchantment to increase manufacturing output.'],
  ['Spell Storage Matrix','Stores prepared magical effects for later activation.'],
  ['Mana Turbine','Converts controlled magical flow into usable mechanical energy.'],
  ['Runic Automation','Automates repetitive magical operations through structured runes.'],
  ['Long-Range Portal Network','Links distant settlements through regulated transport gates.'],
  ['Arcane Computation Engine','Uses magical states to perform complex calculation and prediction.'],
  ['Self-Mending Infrastructure','Allows roads, structures, and machinery to repair routine damage.'],
  ['Planetary Mana Grid','Distributes magical energy across civilization-scale infrastructure.']
];
const TECHNOLOGY_NODE_ID='technology-root';
function technologyRoot(){
  return byId(TECHNOLOGY_NODE_ID);
}
function ensureTechnologyRoot(){
  let t=technologyRoot();

  if(!technologySettings.enabled){
    nodes=nodes.filter(n=>n.id!==TECHNOLOGY_NODE_ID&&n.type!=='technologySpinePoint');
    edges=edges.filter(e=>!e.techEdge&&e.a!==TECHNOLOGY_NODE_ID&&e.b!==TECHNOLOGY_NODE_ID);
    return null;
  }

  const roots=nodes.filter(n=>n.id===TECHNOLOGY_NODE_ID||n.type==='technologyRoot');
  if(roots.length>1){
    const keep=roots[0];
    nodes=nodes.filter(n=>n===keep||(n.id!==TECHNOLOGY_NODE_ID&&n.type!=='technologyRoot'));
    t=keep;
  }

  if(!t){
    const mana=byId('mana');
    t={
      id:TECHNOLOGY_NODE_ID,type:'technologyRoot',name:'TECHNOLOGY',
      description:'Civilization technology branches from Mana and magical knowledge.',
      x:mana?.x||0,y:(mana?.y||0)-620,vx:0,vy:0,r:30,
      fixed:true,hubVisual:true,hubType:'technology',
      technological:true,hiddenTechnology:false
    };
    nodes.push(t);
  }

  t.fixed=true;t.isHub=false;t.hubVisual=true;t.hubType='technology';t.r=30;t.hiddenTechnology=false;
  return t;
}
function technologyNodes(){return nodes.filter(n=>n.technological&&n.type==='magicalObject')}
function techTreeRootEdgeExists(id){
  return edges.some(e=>!e.blocked&&!isVisualOnlyEdge(e)&&e.techEdge&&((e.a===TECHNOLOGY_NODE_ID&&e.b===id)||(e.b===TECHNOLOGY_NODE_ID&&e.a===id)));
}
function techCategoryHubFor(n){
  if(!n?.category)return null;
  return nodes.find(x=>x.isHub&&x.type==='magicalObject'&&String(x.name).toLowerCase()===String(n.category).toLowerCase())||null;
}
function defaultTechnologyAdvancement(n){
  if(Number.isFinite(n?.advancement))return Math.max(0,n.advancement);
  if(n?.technologyGenerated){
    const generated=technologyNodes().filter(x=>x.technologyGenerated);
    const idx=Math.max(0,generated.findIndex(x=>x.id===n.id));
    return 20+idx*20;
  }
  return 25;
}
function advancementScaledDistance(v){
  v=Math.max(0,Number(v)||0);
  return 125+Math.log10(v+1)*235;
}
function technologySpinePointId(n){return 'techspine:'+n.id}
function technologySpinePoint(n){return byId(technologySpinePointId(n))}
function rebuildTechnologySpinePoints(){
  const root=ensureTechnologyRoot();if(!root)return;
  const valid=new Set();
  for(const n of technologyNodes()){
    n.advancement=defaultTechnologyAdvancement(n);
    const id=technologySpinePointId(n);valid.add(id);
    let p=byId(id);
    if(!p){
      p={id,type:'technologySpinePoint',name:'',x:root.x,y:root.y-advancementScaledDistance(n.advancement),vx:0,vy:0,r:1.5,fixed:true,virtual:true,techSpine:true,ownerTechnologyId:n.id};
      nodes.push(p);
    }
    p.x=root.x;
    p.y=root.y-advancementScaledDistance(n.advancement);
    p.fixed=true;p.virtual=true;p.techSpine=true;p.ownerTechnologyId=n.id;
  }
  nodes=nodes.filter(n=>n.type!=='technologySpinePoint'||valid.has(n.id));
}
function technologyAdvancementEdge(n){
  const p=technologySpinePoint(n);
  return p?edges.find(e=>!e.blocked&&e.techAdvancement&&e.a===p.id&&e.b===n.id):null;
}
function ensureTechnologyConnections(){
  if(!technologySettings.enabled)return;
  for(const n of technologyNodes())n.hiddenTechnology=false;
  const root=ensureTechnologyRoot();if(!root)return;

  edges=edges.filter(e=>!e.techEdge||e.techRootEdge);
  if(!edges.some(e=>!e.blocked&&!isVisualOnlyEdge(e)&&e.techRootEdge&&e.a==='mana'&&e.b===root.id)){
    edges.push({id:uid(),a:'mana',b:root.id,type:'technology',linkType:'dependency',label:'technology',direction:'forward',techEdge:true,techRootEdge:true,strength:'solid',thickness:2});
  }

  rebuildTechnologySpinePoints();

  for(const n of technologyNodes()){
    const p=technologySpinePoint(n);if(!p)continue;
    edges.push({
      id:uid(),a:p.id,b:n.id,type:'technology',linkType:'dependency',
      label:`Advancement ${n.advancement}`,direction:'forward',
      techEdge:true,techAdvancement:true,advancement:n.advancement,
      strength:'solid',thickness:1.6
    });
  }
}

function organizeTechnologyTree(){
  const root=technologyRoot();
  if(!technologySettings.enabled||!root)return;
  const mana=byId('mana');
  root.x=mana?.x||0;root.y=(mana?.y||0)-620;root.vx=0;root.vy=0;root.fixed=true;

  rebuildTechnologySpinePoints();
  const techs=[...technologyNodes()].sort((x,y)=>(x.advancement||0)-(y.advancement||0)||x.name.localeCompare(y.name));
  techs.forEach((n,i)=>{
    if(graph.drag?.node===n)return;
    const p=technologySpinePoint(n);if(!p)return;
    const side=i%2===0?-1:1;
    const lane=1+Math.floor((i%6)/2);
    n.x=root.x+side*(120+lane*32);
    n.y=p.y;
    n.vx=n.vy=0;
  });
}

function renderTechnologyTree(){
  if(!technologySettings.enabled){
    nodes=nodes.filter(n=>n.id!==TECHNOLOGY_NODE_ID&&n.type!=='technologySpinePoint');
    edges=edges.filter(e=>!e.techEdge&&e.a!==TECHNOLOGY_NODE_ID&&e.b!==TECHNOLOGY_NODE_ID);
    graph.setData(
      nodes.filter(n=>!n.hiddenTechnology),
      edges.filter(e=>!e.blocked&&byId(e.a)&&byId(e.b)&&!byId(e.a)?.hiddenTechnology&&!byId(e.b)?.hiddenTechnology)
    );
    return;
  }
  ensureTechnologyRoot();
  ensureTechnologyConnections();
  organizeTechnologyTree();
  graph.setData(nodes.filter(n=>!n.hiddenTechnology),edges.filter(e=>!e.blocked&&byId(e.a)&&byId(e.b)&&!byId(e.a)?.hiddenTechnology&&!byId(e.b)?.hiddenTechnology));
}
function classifyTechnologyNode(n){
  if(!n||n.type!=='magicalObject')return false;
  n.technological=true;n.techDiscoveredYear=n.techDiscoveredYear??simState.year??0;
  ensureTechnologyRoot();ensureTechnologyConnections();rebuildEdges();renderLibraries();renderTechnologyTree();return true
}
function resetTechnology(){
  if(!confirm('Reset technology only? Technological discoveries will be removed, while the rest of your magical system stays intact.'))return;
  checkpointHistory();
  const discovered=new Set(nodes.filter(n=>n.technologyGenerated).map(n=>n.id));
  nodes=nodes.filter(n=>!n.technologyGenerated);
  for(const n of nodes)if(n.type==='magicalObject'){n.technological=false;delete n.advancement}
  edges=edges.filter(e=>!e.techEdge&&!discovered.has(e.a)&&!discovered.has(e.b));
  ensureTechnologyRoot();
  if(simState){simState.technology=4;simState.technologyTimeline=[];simState.techDiscoveries=[]}
  selected=null;graph.selected=null;rebuildEdges();renderLibraries();renderTechnologyTree();showSelection();save();
}
function discoverCivilizationTechnology(){
  if(!technologySettings.enabled)return null;
  const existing=new Set(technologyNodes().map(n=>n.name));
  const candidate=TECH_DISCOVERY_NAMES.find(([name])=>!existing.has(name));
  if(!candidate)return null;
  const [name,description]=candidate;
  const prev=technologyNodes().filter(n=>n.technologyGenerated).at(-1);
  ensureTechnologyRoot();
  const n={id:uid(),type:'magicalObject',name,category:'Civilization Technology',composition:'Mana + engineered magical components',property:description,requirements:prev?prev.name:'Mana',uses:'Civilization infrastructure',interaction:'Discovered through civilization research.',description,technological:true,technologyGenerated:true,techDiscoveredYear:simState.year,advancement:(prev?.advancement??15)+20,x:520,y:-260+(technologyNodes().length%7)*75,vx:0,vy:0,r:16};
  nodes.push(n);
  ensureTechnologyConnections();
  simState.technologyTimeline??=[];
  simState.techDiscoveries??=[];
  simState.technologyTimeline.push({year:simState.year,name,source:'Civilization discovery'});
  simState.techDiscoveries.push(name);
  rebuildEdges();renderLibraries();renderTechnologyTree();
  return n
}

// ============================== V21 ORGANIZATIONS ==============================
function organizations(){return ofType('organization')}

function organizationRelationshipsFor(org){
  if(!org)return[];
  return edges
    .filter(e=>
      !e.blocked &&
      e.type==='organizationRelationship' &&
      (e.a===org.id||e.b===org.id)
    )
    .map(e=>{
      const other=byId(e.a===org.id?e.b:e.a);
      return{
        edge:e,
        other,
        value:Number.isFinite(e.relationship)?e.relationship:0
      }
    })
    .filter(x=>x.other?.type==='organization')
}

function organizationRelationshipLabel(v){
  return v<=-75?'Mortal enemies':
         v<=-40?'Hostile':
         v<=-15?'Tense':
         v<15?'Neutral':
         v<40?'Cordial':
         v<75?'Friendly':
         'Allied'
}

function organizationStatusFor(org){
  const rels=organizationRelationshipsFor(org);
  const places=ofType('place').filter(p=>
    p.ownerFactionId===org.id ||
    graphNodesLinked(org.id,p.id)
  );
  const avg=rels.length
    ?Math.round(rels.reduce((s,r)=>s+r.value,0)/rels.length)
    :0;

  return{
    places,
    relationships:rels,
    averageRelationship:avg,
    wars:rels.filter(r=>r.value<=-60),
    tradePartners:rels.filter(r=>r.value>=40)
  }
}

function setOrganizationRelationship(a,b,value){
  if(!a||!b||a.id===b.id)return;
  const v=Math.max(-100,Math.min(100,Number(value)||0));

  edges=edges.filter(e=>!(
    e.type==='organizationRelationship' &&
    ((e.a===a.id&&e.b===b.id)||(e.a===b.id&&e.b===a.id))
  ));

  edges.push({
    id:uid(),
    a:a.id,b:b.id,
    type:'organizationRelationship',
    linkType:'relationship',
    label:`Organization · ${v>0?'+':''}${v}`,
    direction:'both',
    relationship:v,
    relationshipKind:'organization',
    strength:'solid',
    thickness:1.8,
    manual:true
  })
}

function organizationRelationColor(v){
  if(v<=-75)return'#ff334f';
  if(v<=-40)return'#f05252';
  if(v<0)return'#d8785f';
  if(v>=75)return'#26e86f';
  if(v>=40)return'#42d77c';
  if(v>0)return'#72c98f';
  return'#8792a3'
}

function simContext(){
  const life=ofType('life');
  return{
    spells:spells(),rules:rules(),materials:ofType('material'),tools:ofType('magicalObject'),
    structures:ofType('structure'),organizations:organizations(),civilizationUtils:civilizationUtils(),places:ofType('place'),life,
    mainLife:life.filter(x=>x.main&&!x.individual),
    sentientLife:life.filter(x=>x.sentient&&!x.individual),
    secondarySentients:life.filter(x=>x.sentient&&!x.main&&!x.individual),
    individuals:life.filter(x=>x.individual),
    techniques:ofType('technique'),principles:ofType('principle'),classes:classNames()
  }
}
// ============================== V20 LIVING HISTORY ==============================
function placeScaleToMapLevel(place){
  const ps=String(place?.placeScale||inferPlaceScale(place?.placeType));
  return ps==='galaxy'?'universe':ps==='solar-system'?'galaxy':(ps==='planet'||ps==='star')?'solar':'planet'
}
function mapLevelChildPlaceScale(level){
  return level==='universe'?'galaxy':level==='galaxy'?'solar-system':level==='solar'?'planet':null
}
function eventReferencedNodes(ev){
  const manualRefs=(ev.relatedNodeIds||[]).map(byId).filter(Boolean);
  const hay=[ev?.title,ev?.text,...(ev?.tags||[])].join(' ').toLowerCase();
  return nodes.filter(n=>{const name=String(n.name||'').trim().toLowerCase();return name.length>2&&hay.includes(name)})
}
// =================== V20.6g PLANET INHABITANT AUTHORITY ===================
function inhabitantTokens(text){
  return String(text||'')
    .split(/[;,\n|]+/)
    .map(s=>s.trim())
    .filter(Boolean)
}

function lifeNodeNamed(name){
  const key=String(name||'').trim().toLowerCase();
  if(!key)return null;
  return ofType('life').find(l=>String(l.name||'').trim().toLowerCase()===key)||null
}

function exclusivePlanetCreature(planet){
  if(!planet||String(planet.placeScale||inferPlaceScale(planet.placeType))!=='planet'){
    return null
  }

  const names=inhabitantTokens(planet.inhabitants||planet.composition||'');
  if(names.length!==1)return null;

  const creature=lifeNodeNamed(names[0]);
  return isMagicalCreatureNode(creature)?creature:null
}

function creatureExclusiveHomePlanets(creature){
  if(!isMagicalCreatureNode(creature))return[];
  return ofType('place').filter(p=>
    String(p.placeScale||inferPlaceScale(p.placeType))==='planet' &&
    exclusivePlanetCreature(p)?.id===creature.id
  )
}

function currentExclusivePlanetCreature(){
  const active=activePlanetPlace();
  if(active)return exclusivePlanetCreature(active);

  // Procedural/temporary Planet override fallback.
  const names=inhabitantTokens(simState.planetOverride?.inhabitants||'');
  if(names.length!==1)return null;
  const creature=lifeNodeNamed(names[0]);
  return isMagicalCreatureNode(creature)?creature:null
}

function locationInsidePlanet(place,planet){
  if(!place||!planet)return false;
  if(place.id===planet.id)return true;
  return physicalPlacePath(place).some(p=>p.id===planet.id)
}
// ================= END V20.6g PLANET INHABITANT AUTHORITY =================

// =================== V20.6f CREATURE PLACE RESTRICTIONS ===================
function isMagicalCreatureNode(node){
  if(node?.type!=='life'||node.individual)return false;

  const text=[
    node.category,node.name,node.description,node.property,node.requirements
  ].join(' ').toLowerCase();

  // Explicit creature categories win. Ordinary Life nodes that are clearly
  // plants remain unrestricted unless their category says creature.
  if(/creature|beast|animal|monster|fauna|spirit|entity/.test(text))return true;
  if(/plant|flora|tree|fungus|flower|herb/.test(text))return false;

  // Non-plant Life defaults to creature-like for compatibility with older saves.
  return true
}

function creatureLinkedPlaces(creature){
  if(!isMagicalCreatureNode(creature))return[];

  const found=new Map();

  for(const e of edges){
    if(e.blocked||isVisualOnlyEdge(e))continue;
    if(e.a!==creature.id&&e.b!==creature.id)continue;

    const other=byId(e.a===creature.id?e.b:e.a);
    if(other?.type==='place')found.set(other.id,other)
  }

  return[...found.values()]
}

function placeInsideOrSame(place,container){
  if(!place||!container)return false;
  if(place.id===container.id)return true;

  // physicalPlacePath() already understands authored Place containment.
  const path=physicalPlacePath(place);
  return path.some(p=>p.id===container.id)
}

function creatureAllowedAtPlace(creature,place){
  if(!isMagicalCreatureNode(creature))return true;

  // If a Planet says this is its ONLY inhabitant creature, that declaration
  // becomes a strong home-world restriction. The creature cannot randomly
  // appear on other Planets.
  const exclusiveHomes=creatureExclusiveHomePlanets(creature);
  if(exclusiveHomes.length){
    const insideHome=exclusiveHomes.some(home=>locationInsidePlanet(place,home));
    if(!insideHome)return false
  }

  const restrictions=creatureLinkedPlaces(creature);
  if(!restrictions.length)return true;

  return restrictions.some(container=>placeInsideOrSame(place,container))
}

function creaturesAllowedAtPlace(place){
  return ofType('life')
    .filter(isMagicalCreatureNode)
    .filter(creature=>creatureAllowedAtPlace(creature,place))
}

function restrictedCreaturesReferencedByEvent(ev){
  return eventReferencedNodes(ev)
    .filter(isMagicalCreatureNode)
    .filter(creature=>creatureLinkedPlaces(creature).length>0)
}

function creatureRestrictedEventPlaces(ev){
  const creatures=restrictedCreaturesReferencedByEvent(ev);
  if(!creatures.length)return null;

  // If multiple creatures are mentioned, choose only Places valid for ALL of
  // them. This prevents a mixed event from placing one creature outside its
  // authored habitat.
  return ofType('place').filter(place=>
    creatures.every(creature=>creatureAllowedAtPlace(creature,place))
  )
}
// ================= END V20.6f CREATURE PLACE RESTRICTIONS =================

function placeCandidatesForEvent(ev){
  const found=new Map();
  const restricted=creatureRestrictedEventPlaces(ev);
  const restrictedIds=restricted?new Set(restricted.map(p=>p.id)):null;

  for(const n of eventReferencedNodes(ev)){
    if(n.type==='place'){
      if(!restrictedIds||restrictedIds.has(n.id))found.set(n.id,n)
    }

    for(const p of ofType('place')){
      if(!graphNodesLinked(n.id,p.id))continue;
      if(restrictedIds&&!restrictedIds.has(p.id))continue;
      found.set(p.id,p)
    }
  }

  // If the creature has a hard Place restriction but the event did not mention
  // another specific Place, provide the authored habitat itself.
  if(restrictedIds&&!found.size){
    for(const p of restricted)found.set(p.id,p)
  }

  return [...found.values()].sort((a,b)=>placeRank(a)-placeRank(b))
}
function currentProceduralEventLocation(){
  const level=mapDisplayLevel();
  if(level==='planet'){
    ensurePlanet();
    const loc=pick(simState.locations||[]);
    if(loc)return{procedural:!loc.source,sourceId:loc.source||null,name:loc.name,placeScale:'planet-surface',mapLevel:'planet',lat:loc.lat,lon:loc.lon,contextKey:planetWorldKey(),pathNames:(scaleNav.path||[]).map(p=>p.item?.name).filter(Boolean)}
  }else{
    ensureScaleMap();
    const item=pick(simState.spaceMap?.items||[]);
    if(item)return{procedural:!item.sourceId,sourceId:item.sourceId||null,name:item.name,placeScale:mapLevelChildPlaceScale(level)||level,mapLevel:level,worldX:item.x,worldY:item.y,contextKey:worldPathKey(level),pathNames:[...(scaleNav.path||[]).map(p=>p.item?.name).filter(Boolean),item.name]}
  }
  return null
}
function assignEventLocation(ev){
  if(ev.location)return ev.location;

  const restricted=creatureRestrictedEventPlaces(ev);
  let place=placeCandidatesForEvent(ev)[0]||null;

  if(!place&&ofType('place').length&&Math.random()<.72){
    const pool=(restricted||ofType('place')).filter(p=>placeRank(p)>=0);
    if(pool.length)place=pick(pool)
  }

  // A restricted creature event is never allowed to fall through to a random
  // procedural location outside its linked Place.
  if(!place&&restricted?.length){
    place=pick(restricted)
  }

  if(place){
    const path=physicalPlacePath(place);
    ev.location={procedural:false,sourceId:place.id,name:place.name,placeScale:String(place.placeScale||inferPlaceScale(place.placeType)),mapLevel:placeScaleToMapLevel(place),pathIds:path.map(p=>p.id),pathNames:path.map(p=>p.name)};
    return ev.location
  }
  ev.location=currentProceduralEventLocation()||{procedural:true,sourceId:null,name:'Uncharted location',placeScale:mapDisplayLevel(),mapLevel:mapDisplayLevel(),contextKey:worldPathKey(mapDisplayLevel()),worldX:.5,worldY:.5,pathNames:['Uncharted location']};
  return ev.location
}
function eventLocationLabel(ev){
  const loc=ev?.location;if(!loc)return'Unknown location';
  const names=(loc.pathNames||[]).filter(Boolean);
  return names.length?names.join(' › '):loc.name||'Unknown location'
}
function eventTopics(ev){
  const exact=new Set(eventReferencedNodes(ev).map(n=>n.name));
  if(exact.size)return[...exact];
  const generic=new Set(['year','magic','magical','civilization','event','system','galaxy','planet','research','major','becomes']);
  return tokenize([ev?.kind,ev?.title,...(ev?.tags||[])].join(' ')).filter(t=>t.length>4&&!generic.has(t)).slice(0,6)
}
function eventRelationType(previous,current){
  const a=(previous?.kind+' '+previous?.title).toLowerCase(),b=(current?.kind+' '+current?.title).toLowerCase();
  if(current?.parentEventId===previous?.id)return current.parentRelation||'Long-term consequence';
  if(a.includes('shortage')&&b.includes('abundance'))return'Reversal of';
  if((a.includes('abundance')||a.includes('boom'))&&b.includes('crash'))return'Economic consequence';
  if((a.includes('conflict')||a.includes('war'))&&(b.includes('peace')||b.includes('armistice')))return'Ended by';
  return'Related development'
}
function linkEventHistory(ev){
  ev.relatedEvents??=[];
  const topics=new Set(eventTopics(ev));
  for(let i=simState.events.length-1;i>=0&&i>=simState.events.length-80;i--){
    const prev=simState.events[i];if(!prev?.id)continue;
    const explicit=ev.parentEventId===prev.id;
    const shared=eventTopics(prev).filter(t=>topics.has(t));
    if(!explicit&&!shared.length)continue;
    const type=eventRelationType(prev,ev);
    if(!ev.relatedEvents.some(r=>r.id===prev.id))ev.relatedEvents.push({id:prev.id,type,direction:'past'});
    prev.relatedEvents??=[];
    if(!prev.relatedEvents.some(r=>r.id===ev.id))prev.relatedEvents.push({id:ev.id,type,direction:'future'});
    if(explicit||ev.relatedEvents.length>=4)break
  }
}
function scheduleHistoricalConsequences(ev){
  if(ev.generatedFollowup)return;
  simState.pendingEvents??=[];
  const material=ofType('material').find(m=>(ev.tags||[]).includes(m.name)||String(ev.title||'').toLowerCase().includes(String(m.name||'').toLowerCase()));
  const text=(ev.kind+' '+ev.title).toLowerCase();
  if(material&&(text.includes('shortage')||text.includes('scarcity'))){
    const abundance=event('Abundance',`${material.name} abundance`,`Long-running extraction, substitution, and new deposits reverse the earlier shortage. ${material.name} becomes unusually plentiful across connected markets.`,[material.name,'Abundance','Market'],{economy:5,stability:2},'breakthrough',[`Long-term response to “${ev.title}”`]);
    abundance.year=ev.year+30+Math.floor(Math.random()*120);abundance.generatedFollowup=true;abundance.parentEventId=ev.id;abundance.parentRelation='Long-term consequence';abundance.location=deepCloneState(ev.location);
    const crash=event('Market Crash',`${material.name} market crashes`,`Supply now exceeds demand. Prices collapse, speculative stockpiles lose value, and producers dependent on ${material.name} face restructuring.`,[material.name,'Market Crash','Economy'],{economy:-6,stability:-2},'crisis',[`Oversupply followed “${material.name} abundance”`]);
    crash.year=abundance.year+5+Math.floor(Math.random()*35);crash.generatedFollowup=true;crash.parentEventId=abundance.id;crash.parentRelation='Economic consequence';crash.location=deepCloneState(ev.location);
    simState.pendingEvents.push(abundance,crash)
  }
  if(
    (text.includes('conflict')||text.includes('war')) &&
    !(ev.kind==='War'&&(ev.tags||[]).includes('Organization'))
  ){
    const peace=event('Settlement',`Peace talks follow “${ev.title}”`,`After years of pressure following “${ev.title}”, the parties begin negotiating a settlement.`,['Peace','Diplomacy'],{stability:4,danger:-3,economy:1},'normal',[`Long-term exhaustion from “${ev.title}”`]);
    peace.year=ev.year+8+Math.floor(Math.random()*45);peace.generatedFollowup=true;peace.parentEventId=ev.id;peace.parentRelation='Response to';peace.location=deepCloneState(ev.location);simState.pendingEvents.push(peace)
  }
}
// ========================== V20.1 PERSISTENT WORLD STATE ==========================
const V201_EFFECT_DEFAULTS={
  resourceAvailability:100,resourcePrice:100,extraction:100,trade:100,
  construction:100,stability:100,danger:100,prosperity:100,technology:100
};
function ensurePersistentWorldState(){
  simState.worldEffects??={};
  simState.resourceStates??={};
  simState.placeStates??={};
  simState.activeEffects??=[];
}
function effectScopeKey(ev){
  const loc=ev.location||{};
  return loc.sourceId||loc.contextKey||loc.name||'civilization'
}
function effectTargetName(ev){
  return ev.location?.name||simState.civ||'Civilization'
}
function ensurePlaceState(key,name='Unknown'){
  ensurePersistentWorldState();
  return simState.placeStates[key]??={
    key,name,
    stability:100,danger:100,prosperity:100,trade:100,construction:100,technology:100,
    activeEffectIds:[]
  }
}
function ensureResourceState(name){
  ensurePersistentWorldState();
  return simState.resourceStates[name]??={
    name,availability:100,price:100,extraction:100,trade:100,constructionEfficiency:100,
    activeEffectIds:[]
  }
}
function persistentEffectLabel(k){
  return({
    resourceAvailability:'Availability',resourcePrice:'Market price',extraction:'Extraction activity',
    trade:'Trade activity',construction:'Construction efficiency',stability:'Local stability',
    danger:'Local danger',prosperity:'Prosperity',technology:'Technology efficiency'
  })[k]||k
}
function inferPersistentEffects(ev,ctx=simContext()){
  const text=[ev.kind,ev.title,ev.text,...(ev.tags||[])].join(' ').toLowerCase();
  const effects=[];
  const material=(ctx.materials||[]).find(m=>text.includes(String(m.name||'').toLowerCase()));
  const placeKey=effectScopeKey(ev),target=effectTargetName(ev);

  const add=(metric,delta,subject=target,resource=null,duration=null)=>effects.push({
    id:'fx'+uid(),eventId:ev.id,metric,delta,subject,resource,
    scopeKey:placeKey,startYear:ev.year,endYear:duration?ev.year+duration:null,active:true
  });

  if(material){
    if(text.includes('shortage')||text.includes('scarcity')){
      add('resourceAvailability',-38,material.name,material.name);
      add('resourcePrice',+142,material.name,material.name);
      add('extraction',+61,target,material.name);
      add('construction',-19,target,material.name)
    }else if(text.includes('abundance')||text.includes('surplus')){
      add('resourceAvailability',+55,material.name,material.name);
      add('resourcePrice',-48,material.name,material.name);
      add('extraction',+24,target,material.name);
      add('construction',+17,target,material.name)
    }else if(text.includes('market crash')||text.includes('price crash')){
      add('resourcePrice',-67,material.name,material.name);
      add('extraction',-31,target,material.name);
      add('prosperity',-12,target,material.name)
    }else if(text.includes('discovery')||text.includes('deposit')){
      add('resourceAvailability',+22,material.name,material.name);
      add('extraction',+18,target,material.name)
    }
  }

  if(text.includes('war')||text.includes('conflict')||text.includes('invasion')||text.includes('rebellion')){
    add('stability',-18,target,null,40);
    add('danger',+32,target,null,40);
    add('trade',-21,target,null,40);
    add('construction',-12,target,null,40)
  }
  if(text.includes('peace')||text.includes('settlement')||text.includes('armistice')){
    add('stability',+16,target,null,35);
    add('danger',-24,target,null,35);
    add('trade',+13,target,null,35)
  }
  if(text.includes('breakthrough')||text.includes('research complete')||text.includes('technology')){
    add('technology',+8,target,null,null);
    add('construction',+5,target,null,null)
  }
  if(text.includes('disaster')||text.includes('accident')){
    add('stability',-9,target,null,20);
    add('danger',+16,target,null,20);
    add('prosperity',-7,target,null,20)
  }
  if(text.includes('trade')||text.includes('market')||text.includes('commerce')){
    if(!effects.some(e=>e.metric==='trade'))add('trade',ev.tone==='crisis'?-12:+8,target,null,30)
  }

  // Ordinary simulation impacts now leave a smaller persistent local trace too.
  const i=ev.impact||{};
  if(i.stability&&!effects.some(e=>e.metric==='stability'))add('stability',Math.round(i.stability*1.5),target,null,25);
  if(i.danger&&!effects.some(e=>e.metric==='danger'))add('danger',Math.round(i.danger*1.5),target,null,25);
  if(i.economy&&!effects.some(e=>e.metric==='prosperity'))add('prosperity',Math.round(i.economy*1.2),target,null,30);
  if(i.technology&&!effects.some(e=>e.metric==='technology'))add('technology',Math.round(i.technology),target,null,null);

  return effects.filter(e=>e.delta!==0)
}
function applyPersistentEffect(effect){
  ensurePersistentWorldState();
  const place=ensurePlaceState(effect.scopeKey,effect.subject);
  if(effect.resource){
    const r=ensureResourceState(effect.resource);
    if(effect.metric==='resourceAvailability')r.availability=clamp(r.availability+effect.delta,0,300);
    else if(effect.metric==='resourcePrice')r.price=clamp(r.price+effect.delta,1,500);
    else if(effect.metric==='extraction')r.extraction=clamp(r.extraction+effect.delta,0,300);
    else if(effect.metric==='trade')r.trade=clamp(r.trade+effect.delta,0,300);
    else if(effect.metric==='construction')r.constructionEfficiency=clamp(r.constructionEfficiency+effect.delta,0,300);
    if(!r.activeEffectIds.includes(effect.id))r.activeEffectIds.push(effect.id)
  }
  if(effect.metric==='stability')place.stability=clamp(place.stability+effect.delta,0,200);
  if(effect.metric==='danger')place.danger=clamp(place.danger+effect.delta,0,300);
  if(effect.metric==='prosperity')place.prosperity=clamp(place.prosperity+effect.delta,0,300);
  if(effect.metric==='trade')place.trade=clamp(place.trade+effect.delta,0,300);
  if(effect.metric==='construction')place.construction=clamp(place.construction+effect.delta,0,300);
  if(effect.metric==='technology')place.technology=clamp(place.technology+effect.delta,0,300);
  if(!place.activeEffectIds.includes(effect.id))place.activeEffectIds.push(effect.id);
  simState.activeEffects.push(effect)
}
function registerPersistentEventEffects(ev,ctx=simContext()){
  ensurePersistentWorldState();
  if(ev.worldEffectsApplied)return ev.worldEffects||[];
  ev.worldEffects=inferPersistentEffects(ev,ctx);
  for(const fx of ev.worldEffects)applyPersistentEffect(fx);
  ev.worldEffectsApplied=true;
  return ev.worldEffects
}
function expirePersistentWorldEffects(){
  ensurePersistentWorldState();
  for(const fx of simState.activeEffects){
    if(!fx.active||fx.endYear==null||fx.endYear>simState.year)continue;
    fx.active=false;
    const inverse={...fx,id:'expire'+uid(),delta:-fx.delta};
    // Reverse the temporary modifier without registering a new active effect.
    const place=ensurePlaceState(fx.scopeKey,fx.subject);
    if(fx.resource){
      const r=ensureResourceState(fx.resource);
      if(fx.metric==='resourceAvailability')r.availability=clamp(r.availability+inverse.delta,0,300);
      else if(fx.metric==='resourcePrice')r.price=clamp(r.price+inverse.delta,1,500);
      else if(fx.metric==='extraction')r.extraction=clamp(r.extraction+inverse.delta,0,300);
      else if(fx.metric==='trade')r.trade=clamp(r.trade+inverse.delta,0,300);
      else if(fx.metric==='construction')r.constructionEfficiency=clamp(r.constructionEfficiency+inverse.delta,0,300)
    }
    if(fx.metric==='stability')place.stability=clamp(place.stability+inverse.delta,0,200);
    if(fx.metric==='danger')place.danger=clamp(place.danger+inverse.delta,0,300);
    if(fx.metric==='prosperity')place.prosperity=clamp(place.prosperity+inverse.delta,0,300);
    if(fx.metric==='trade')place.trade=clamp(place.trade+inverse.delta,0,300);
    if(fx.metric==='construction')place.construction=clamp(place.construction+inverse.delta,0,300);
    if(fx.metric==='technology')place.technology=clamp(place.technology+inverse.delta,0,300)
  }
}
function worldEffectDisplay(fx){
  const sign=fx.delta>0?'+':'';
  const suffix=fx.metric==='resourcePrice'||fx.metric==='resourceAvailability'||fx.metric==='extraction'||fx.metric==='trade'||fx.metric==='construction'||fx.metric==='stability'||fx.metric==='danger'||fx.metric==='prosperity'||fx.metric==='technology'?'%':'';
  return `${persistentEffectLabel(fx.metric)}: ${sign}${fx.delta}${suffix}`
}
function persistentWorldSummary(){
  ensurePersistentWorldState();
  const resources=Object.values(simState.resourceStates).sort((a,b)=>Math.abs(b.price-100)+Math.abs(b.availability-100)-(Math.abs(a.price-100)+Math.abs(a.availability-100))).slice(0,6);
  const places=Object.values(simState.placeStates).sort((a,b)=>Math.abs(b.stability-100)+Math.abs(b.danger-100)-(Math.abs(a.stability-100)+Math.abs(a.danger-100))).slice(0,6);
  return{resources,places}
}
// ======================== END V20.1 PERSISTENT WORLD STATE ========================
function commitSimulationEvent(ev,ctx=simContext(),options={}){
  if(ev?.kind==='Currency Market'){
    pushRapidEvent(
      'Currency',
      ev.title||'Currency Market',
      ev.value||'',
      eventVisualClass(ev)==='event-positive'?'positive':'negative',
      ev.relatedNodeIds?.[0]||null
    );
    return ev
  }
  if(ev?.rapidOnly){pushRapidEvent(ev.kind||'Rapid',ev.title||'Rapid Event',ev.value||'',ev.tone||'neutral',ev.sourceId||null);return ev}
  const restrictedCreatures=restrictedCreaturesReferencedByEvent(ev);
  if(restrictedCreatures.length){
    ev.reasons??=[];
    for(const creature of restrictedCreatures){
      const names=creatureLinkedPlaces(creature).map(p=>p.name);
      const reason=`${creature.name} is restricted to ${names.join(' / ')}`;
      if(!ev.reasons.includes(reason))ev.reasons.push(reason)
    }
  }
  if(!ev)return null;
  ev.id||='ev'+uid();ev.year??=simState.year;ev.tags||=[];ev.reasons||=[];ev.impact||={};ev.relatedEvents||=[];
  assignEventLocation(ev);linkEventHistory(ev);
  registerPersistentEventEffects(ev,ctx);
  territoryEventEffects(ev);
  simState.events.push(ev);
  if(options.schedule!==false)scheduleHistoricalConsequences(ev);
  return ev
}
function processScheduledHistoricalEvents(ctx){
  simState.pendingEvents??=[];
  expirePersistentWorldEffects();
  const due=simState.pendingEvents.filter(e=>e.year<=simState.year).sort((a,b)=>a.year-b.year);
  if(!due.length)return;
  const ids=new Set(due.map(e=>e.id));simState.pendingEvents=simState.pendingEvents.filter(e=>!ids.has(e.id));
  for(const ev of due){applyImpact(ev);updateWorldFromEvent(ev);postEventEmergence(ev);commitSimulationEvent(ev,ctx,{schedule:false})}
}
function syntheticMapItemForPlace(place){return{name:place.name,sourceId:place.id,authored:true,inhabitants:place.inhabitants||'Unknown',x:.5,y:.5}}
function travelToPhysicalPlace(place){
  if(!place)return;
  const chain=physicalPlacePath(place),root=systemScale();
  scaleNav.level=root;scaleNav.path=[];scaleNav.camera={x:.5,y:.5,zoom:1};scaleNav.selected=null;scaleNav.transitioning=false;simState.planetOverride=null;
  if(root!=='planet')generateScaleMap('',false);
  let current=root;
  for(let guard=0;guard<4;guard++){
    const expected=mapLevelChildPlaceScale(current);if(!expected)break;
    const child=chain.find(p=>String(p.placeScale||inferPlaceScale(p.placeType))===expected);if(!child)break;
    const item=syntheticMapItemForPlace(child);
    if(expected==='planet'){enterPlanetFromMap(item);break}
    childMapFor(item);current=mapDisplayLevel();if(child.id===place.id)break
  }
  refreshWorldMapMode();renderGalacticCoordinates();requestPlanetDraw()
}
function travelToEvent(eventOrIndex){
  const ev=typeof eventOrIndex==='number'?simState.events[eventOrIndex]:eventOrIndex;if(!ev)return;
  if(simState.selectedEventId!==ev.id)focusEventOnTimeline(ev);
  const loc=ev.location||assignEventLocation(ev);
  if(loc.sourceId){const p=byId(loc.sourceId);if(p?.type==='place'){travelToPhysicalPlace(p);return}}
  scaleNav.level=loc.mapLevel||systemScale();scaleNav.camera={x:Number.isFinite(loc.worldX)?loc.worldX:.5,y:Number.isFinite(loc.worldY)?loc.worldY:.5,zoom:3.2};scaleNav.selected=null;scaleNav.transitioning=false;
  if(scaleNav.level==='planet'){ensurePlanet();if(Number.isFinite(loc.lon))planetView.yaw=-loc.lon;if(Number.isFinite(loc.lat))planetView.pitch=loc.lat*.55}else generateScaleMap('',false);
  refreshWorldMapMode();renderGalacticCoordinates();requestPlanetDraw()
}
function coordinateEntries(){
  const entries=[],items=(scaleNav.path||[]).map(p=>p.item).filter(Boolean);
  const hasGalaxy=items.some(item=>String((item.sourceId?byId(item.sourceId):null)?.placeScale||'')==='galaxy');
  if(simState.civ&&!hasGalaxy)entries.push({name:simState.civ,depth:-1});
  items.forEach((item,i)=>entries.push({name:item.name||'Unknown',depth:i}));
  if(mapDisplayLevel()==='planet'){
    const n=simState.planetOverride?.name||simState.planet?.name;
    if(n&&entries.at(-1)?.name!==n)entries.push({name:n,depth:items.length})
  }
  if(!entries.length)entries.push({name:systemScaleLabel(),depth:-1});
  return entries
}
function travelToBreadcrumbDepth(depth){
  if(depth<0){scaleNav.level=systemScale();scaleNav.path=[];scaleNav.camera={x:.5,y:.5,zoom:1};simState.planetOverride=null;if(mapDisplayLevel()==='planet')ensurePlanet();else generateScaleMap();refreshWorldMapMode();renderGalacticCoordinates();requestPlanetDraw();return}
  const items=(scaleNav.path||[]).map(p=>p.item).filter(Boolean).slice(0,depth+1);
  scaleNav.level=systemScale();scaleNav.path=[];scaleNav.camera={x:.5,y:.5,zoom:1};simState.planetOverride=null;if(mapDisplayLevel()!=='planet')generateScaleMap();
  for(const item of items){const next=hierarchyChildLevel(mapDisplayLevel());if(!next)break;if(next==='planet'){enterPlanetFromMap(item);break}childMapFor(item)}
  refreshWorldMapMode();renderGalacticCoordinates();requestPlanetDraw()
}
function renderGalacticCoordinates(){
  const el=$('galacticCoordinates');if(!el)return;
  const entries=coordinateEntries();
  el.innerHTML=entries.map((e,i)=>`<button class="galactic-crumb" data-coordinate-depth="${e.depth}">${E.esc(e.name)}</button>${i<entries.length-1?'<span>›</span>':''}`).join('');
  el.querySelectorAll('[data-coordinate-depth]').forEach(b=>b.onclick=()=>travelToBreadcrumbDepth(+b.dataset.coordinateDepth))
}
function eventAnchorForScale(ev,map){
  const loc=ev?.location;if(!loc||!map)return null;
  if(loc.procedural&&loc.mapLevel===map.scale&&loc.contextKey===worldPathKey(map.scale))return{x:loc.worldX,y:loc.worldY,procedural:true};
  const expected=mapLevelChildPlaceScale(map.scale);if(!expected)return null;
  const path=(loc.pathIds||[]).map(byId).filter(Boolean);
  const anchor=path.find(p=>String(p.placeScale||inferPlaceScale(p.placeType))===expected);if(!anchor)return null;
  const item=map.items.find(q=>q.sourceId===anchor.id);return item?{x:item.x,y:item.y,sourceId:anchor.id}:null
}
function drawScaleEventMarkers(ctx,screen,map,visible){
  for(const ev of (historyMapState.enabled?historicalEventsAtYear(historyMapYear()):(simState.events||[])).slice(-45)){
    const A=eventAnchorForScale(ev,map);if(!A||!Number.isFinite(A.x)||!Number.isFinite(A.y))continue;
    const P=screen(A.x,A.y),age=Math.max(0,historyMapYear()-(ev.year||0)),alpha=Math.max(.32,1-Math.min(1,age/700)*.55),s=4.5+Math.sin(performance.now()/380+(ev.year||0))*.7;
    ctx.save();ctx.translate(P.x,P.y);ctx.rotate(Math.PI/4);ctx.fillStyle=`rgba(255,210,120,${alpha*.72})`;ctx.strokeStyle=`rgba(255,235,185,${alpha})`;ctx.lineWidth=1;ctx.fillRect(-s/2,-s/2,s,s);ctx.strokeRect(-s/2-2,-s/2-2,s+4,s+4);ctx.restore();
    visible.push({name:ev.title,sx:P.x,sy:P.y,sr:6,x:A.x,y:A.y,infoKind:'event',eventId:ev.id})
  }
}
function drawPlanetEventMarkers(ctx,w,h,visible){
  const active=activePlanetPlace();
  for(const ev of (historyMapState.enabled?historicalEventsAtYear(historyMapYear()):(simState.events||[])).slice(-45)){
    const loc=ev.location;if(!loc)continue;let lat=loc.lat,lon=loc.lon;
    if(!Number.isFinite(lat)||!Number.isFinite(lon)){if(!active||!(loc.pathIds||[]).includes(active.id))continue;const s=(simState.locations||[]).find(l=>l.source===loc.sourceId||l.name===loc.name);if(!s)continue;lat=s.lat;lon=s.lon}
    const P=planetProject(lat,lon,w,h);if(!P.front)continue;
    ctx.save();ctx.translate(P.x,P.y);ctx.rotate(Math.PI/4);ctx.fillStyle='rgba(255,205,105,.82)';ctx.strokeStyle='rgba(255,240,195,.95)';ctx.fillRect(-4,-4,8,8);ctx.strokeRect(-6,-6,12,12);ctx.restore();
    visible.push({name:ev.title,sx:P.x,sy:P.y,sr:6,infoKind:'event',eventId:ev.id})
  }
}
// ============================ END V20 LIVING HISTORY ============================
function scaleEvent(ctx){const sc=systemScale(),p=pick(ctx.places||[]),m=pick(ctx.materials||[]),st=pick(ctx.structures||[]);if(sc==='planet')return null;if(sc==='solar')return event('System Event',`${p?.name||'A neighboring planet'} becomes strategically important`,m?`${m.name} extraction reshapes trade across the solar system.`:'Magical travel increasingly connects inhabited worlds.',[p?.name||'Planet','Solar System'],{economy:2,knowledge:1},'normal',[`Mana scale: Solar System`]);if(sc==='galaxy')return event('Galactic Event',`${p?.name||'A frontier system'} enters wider history`,m?`Demand for ${m.name} drives routes and disputes between star systems.`:'Magical civilization expands along interstellar routes.',[p?.name||'System','Galaxy'],{economy:2,knowledge:2},'normal',[`Mana scale: Galaxy`]);return event('Intergalactic Event',`${p?.name||'A distant galaxy'} joins the wider network`,st?`${st.name} becomes part of infrastructure spanning galactic distances.`:'Magical links form across intergalactic distances.',[p?.name||'Galaxy','Universe'],{knowledge:3,economy:2},'normal',[`Mana scale: Universe`])}
function ruleForSpell(s){return rules().filter(r=>ruleApplies(r,s))}
function event(kind,title,text,tags=[],impact={},tone='normal',reasons=[]){return{id:'ev'+uid(),kind,title,text,tags,impact,tone,reasons,relatedEvents:[]}}
function addUnique(arr,v){if(v&&!arr.includes(v))arr.push(v)}
function applyImpact(ev){
  const i=ev.impact||{};
  simState.stability=clamp(simState.stability+(i.stability||0));
  simState.knowledge=clamp(simState.knowledge+(i.knowledge||0));
  simState.economy=clamp(simState.economy+(i.economy||0));
  simState.danger=clamp(simState.danger+(i.danger||0));
  simState.technology=clamp(simState.technology+(i.technology||0));
  simState.population=Math.max(1000,Math.round(simState.population*(1+(i.population||0))));
}
function initialRegions(scale){
  const base=[
    {name:'Capital District',type:'Capital',share:.28,magic:58,stability:78,wealth:72},
    {name:'River Provinces',type:'Agricultural',share:.30,magic:28,stability:74,wealth:48},
    {name:'Highland Marches',type:'Frontier',share:.18,magic:22,stability:62,wealth:34},
    {name:'Arcane Quarter',type:'Research',share:.10,magic:82,stability:69,wealth:66}
  ];
  if(scale!=='small')base.push({name:'Foundry Coast',type:'Industrial',share:.14,magic:46,stability:70,wealth:62});
  if(scale==='large')base.push({name:'Western Reach',type:'Trade',share:.16,magic:35,stability:67,wealth:75});
  const sum=base.reduce((a,r)=>a+r.share,0);
  return base.map(r=>({...r,population:Math.round(simState.population*r.share/sum),dominantClass:null}));
}
function syncRegionMagic(){
  const classes=classNames();
  simState.regions.forEach((r,i)=>{if(classes.length&&!r.dominantClass)r.dominantClass=classes[i%classes.length]})
}
function addCivNode(name,type,ref=''){
  let n=simState.civNodes.find(n=>n.name===name);if(n)return n;
  n={id:'c'+Math.random().toString(36).slice(2),name,type,ref,x:(Math.random()-.5)*500,y:(Math.random()-.5)*320};
  simState.civNodes.push(n);return n
}
function addCivEdge(aName,bName,label){
  const a=simState.civNodes.find(n=>n.name===aName),b=simState.civNodes.find(n=>n.name===bName);if(!a||!b)return;
  if(!simState.civEdges.some(e=>e.a===a.id&&e.b===b.id&&e.label===label))simState.civEdges.push({a:a.id,b:b.id,label})
}
function seedCivGraph(){
  simState.civNodes=[];simState.civEdges=[];addCivNode(simState.civ,'civilization','root');
  simState.regions.forEach(r=>{addCivNode(r.name,'region',r.type);addCivEdge(simState.civ,r.name,'contains')})
}
function createInstitution(name,type,focus,region){
  if(simState.institutions.some(x=>x.name===name))return;
  const obj={name,type,focus,region:region||pick(simState.regions)?.name||'Capital District',members:Math.floor(300+Math.random()*4700),influence:Math.floor(20+Math.random()*45),founded:simState.year};
  simState.institutions.push(obj);addCivNode(name,'institution',focus||type);addCivEdge(simState.civ,name,'supports')
}
function startResearch(title,kind,source,goal,years=12){
  if(simState.research.some(r=>r.title===title&&r.status==='Active'))return;
  simState.research.push({id:'r'+Math.random().toString(36).slice(2),title,kind,source,goal,progress:0,status:'Active',started:simState.year,duration:years})
}
function tickResearch(years){
  for(const r of simState.research.filter(x=>x.status==='Active')){
    r.progress=clamp(r.progress+years*(3.2+simState.knowledge/24),0,100);
    if(r.progress>=100){
      r.status='Complete';simState.knowledge=clamp(simState.knowledge+4);simState.technology=clamp(simState.technology+2);
      addUnique(simState.discoveries,r.title);addCivNode(r.title,'discovery',r.source||r.kind);addCivEdge(simState.civ,r.title,'discovers');
      const ev=event('Research Complete',r.title,`Researchers complete ${r.title}. ${r.goal||'The project expands practical magical knowledge.'}`,[r.kind,'Research'],{knowledge:3,technology:2},'breakthrough',[`Research reached 100%`,`Project began in Year ${r.started}`]);
      ev.year=simState.year;applyImpact(ev);commitSimulationEvent(ev,simContext())
    }
  }
}
function updateProfessions(){
  const ctx=simContext(),jobs=[];
  ctx.classes.forEach(c=>jobs.push({name:`${c} Specialist`,count:Math.round(simState.population*(.001+.0005*Math.min(8,ctx.spells.filter(s=>(s.spellClass||'Unclassified')===c).length)))}));
  if(ctx.tools.length)jobs.push({name:'Arcane Engineer',count:Math.round(simState.population*.0015)});
  if(ctx.materials.length)jobs.push({name:'Magical Material Worker',count:Math.round(simState.population*.0011)});
  if(ctx.rules.length)jobs.push({name:'Rule Theorist',count:Math.round(simState.population*.00035)});
  if(ctx.techniques.length)jobs.push({name:'Technique Instructor',count:Math.round(simState.population*.00045)});
  simState.professions=jobs.sort((a,b)=>b.count-a.count).slice(0,10)
}
function updateWorldFromEvent(ev){
  if(['Discovery','Breakthrough','Theory','Research','Research Complete'].includes(ev.kind))addUnique(simState.discoveries,ev.title);
  if(['Industry','Infrastructure','Trade','Economy','Technology'].includes(ev.kind))addUnique(simState.industries,ev.title);
  if(['Disaster','Accident','Unrest','Shortage','Conflict'].includes(ev.kind))addUnique(simState.crises,ev.title);
  if(ev.kind==='Law')addUnique(simState.laws,ev.title);
  if(['Politics','Debate','Faction'].includes(ev.kind))addUnique(simState.factions,ev.title)
}
function maybeStartResearch(ctx){
  if(simState.research.filter(r=>r.status==='Active').length>=4)return;
  if(ctx.rules.length&&chance(.24)){const r=pick(ctx.rules);startResearch(`Boundary Study: ${r.name}`,'Rule Research',r.name,`Determine the exact limits and exceptions of ${r.name}.`,10+Math.floor(Math.random()*12));return}
  if(ctx.materials.length&&ctx.tools.length&&chance(.25)){const m=pick(ctx.materials),t=pick(ctx.tools);startResearch(`${m.name}–${t.name} Engineering`,'Applied Research',m.name,`Test whether ${m.name} can improve or replace components used in ${t.name}.`,12+Math.floor(Math.random()*12));return}
  if(ctx.spells.length&&chance(.32)){const s=pick(ctx.spells);startResearch(`Advanced ${s.name} Theory`,'Spell Research',s.name,`Derive ${s.name} from deeper principles rather than procedural practice.`,8+Math.floor(Math.random()*14))}
}

function simulationRelationships(){
  return edges.filter(e=>!e.blocked&&(e.linkType==='relationship'||e.type==='relationship')).map(e=>({
    edge:e,a:byId(e.a),b:byId(e.b),value:Number.isFinite(e.relationship)?e.relationship:0,kind:e.relationshipKind||'separate'
  })).filter(x=>x.a&&x.b);
}
function relationshipEvent(rel,ctx){
  const {a,b,value:v}=rel;
  const kind=rel.kind||'separate';
  const mainSpecies=pick(ctx.mainLife||[]);
  const mainName=mainSpecies?.name||'the dominant civilization';
  const cityLocations=(simState.locations||[]).filter(l=>['city','academy','ministry'].includes(l.type));
  const cityName=pick(cityLocations)?.name||pick(ctx.places||[])?.name||'a major settlement';
  const aSentient=a.type==='life'&&a.sentient,bSentient=b.type==='life'&&b.sentient;
  const why=[`${a.name} → ${b.name}`,`Relationship type: ${relationshipKindLabel(kind)}`,`Relationship: ${v>0?'+':''}${v}`];
  if(aSentient)why.push(`${a.name} is Sentient`,`${a.name} ${a.main?'is Main':'is not Main'}`);
  if(bSentient)why.push(`${b.name} is Sentient`,`${b.name} ${b.main?'is Main':'is not Main'}`);

  // WORKS FOR: a subordinate/service relationship rather than ordinary diplomacy.
  if(kind==='worksFor'){
    if(v>=60)return pick([
      ()=>event('Economy',`${a.name} boosts ${b.name} production`,`${a.name} workers and specialists become highly effective within ${b.name}, increasing output, logistics, maintenance, and magical services around ${cityName}.`,[a.name,b.name,'Work','Production'],{economy:7,stability:3,knowledge:1},'major',why),
      ()=>event('Society',`${a.name} service network expands`,`Reliable ${a.name} services spread through ${b.name} institutions, improving transport, upkeep, supply, and everyday magical infrastructure.`,[a.name,b.name,'Work'],{economy:4,stability:4},'normal',why)
    ])();
    if(v>10)return event('Economy',`${a.name} productivity rises`,`Cooperation between ${a.name} workers and ${b.name} institutions improves production and public services around ${cityName}.`,[a.name,b.name,'Work'],{economy:4,stability:2},'normal',why);
    if(v>=-10)return event('Labor',`${a.name} labor dispute slows ${b.name}`,`Disagreements over duties, conditions, or authority reduce output in several ${b.name} operations.`,[a.name,b.name,'Labor'],{economy:-2,stability:-1},'normal',why);
    if(v>-60)return pick([
      ()=>event('Labor',`${a.name} strike disrupts ${b.name}`,`Large groups of ${a.name} workers refuse duties, slowing production and services tied to ${b.name}.`,[a.name,b.name,'Strike'],{economy:-5,stability:-3,danger:1},'major',why),
      ()=>event('Sabotage',`${a.name} sabotages ${b.name} production`,`Hostile ${a.name} groups damage equipment and magical infrastructure used by ${b.name}, causing shortages around ${cityName}.`,[a.name,b.name,'Sabotage'],{economy:-5,stability:-4,danger:4},'major',why)
    ])();
    return pick([
      ()=>event('Rebellion',`${a.name} rebellion erupts against ${b.name}`,`${a.name} groups openly reject ${b.name} authority, seizing workplaces and attacking key infrastructure around ${cityName}.`,[a.name,b.name,'Rebellion'],{economy:-7,stability:-8,danger:8},'crisis',why),
      ()=>event('Rebellion',`${a.name} uprising paralyzes ${b.name} services`,`A coordinated ${a.name} uprising shuts down production, transport, and services controlled by ${b.name}.`,[a.name,b.name,'Rebellion'],{economy:-8,stability:-7,danger:7},'crisis',why)
    ])();
  }

  // CREATED BY: creator/creation dynamics, loyalty, independence and revolt.
  if(kind==='createdBy'){
    if(v>=60)return pick([
      ()=>event('Society',`${a.name} remains loyal to ${b.name}`,`${a.name} communities maintain strong ties to their creator, ${b.name}, assisting research, defense, and magical infrastructure around ${cityName}.`,[a.name,b.name,'Creation','Loyalty'],{stability:5,knowledge:4,economy:3},'major',why),
      ()=>event('Research',`${a.name} improves ${b.name} designs`,`Cooperation between ${a.name} and its creator ${b.name} produces refinements to magical techniques, structures, or crafted systems.`,[a.name,b.name,'Creation','Research'],{knowledge:6,economy:3},'breakthrough',why)
    ])();
    if(v>10)return event('Society',`${a.name} cooperates with creator ${b.name}`,`${a.name} maintains generally cooperative ties with ${b.name}, supporting settlements and institutions near ${cityName}.`,[a.name,b.name,'Creation'],{stability:3,knowledge:2},'normal',why);
    if(v>=-10)return event('Society',`${a.name} questions ${b.name} authority`,`Debate spreads among ${a.name} communities over how much authority their creator ${b.name} should retain.`,[a.name,b.name,'Creation'],{stability:-1,knowledge:1},'normal',why);
    if(v>-60)return pick([
      ()=>event('Conflict',`${a.name} rejects ${b.name} control`,`Groups of ${a.name} refuse orders and dismantle systems used by ${b.name} to control or direct them.`,[a.name,b.name,'Creation dispute'],{stability:-4,economy:-2,danger:3},'major',why),
      ()=>event('Conflict',`${a.name} independence movement grows`,`An organized movement demands independence from creator ${b.name}, producing protests, sabotage, and political instability around ${cityName}.`,[a.name,b.name,'Independence'],{stability:-5,economy:-2,danger:3},'major',why)
    ])();
    return pick([
      ()=>event('Rebellion',`${a.name} revolts against creator ${b.name}`,`${a.name} launches an organized revolt against ${b.name}, attacking control systems and declaring itself independent.`,[a.name,b.name,'Creation','Rebellion'],{stability:-8,economy:-5,danger:8},'crisis',why),
      ()=>event('Crisis',`${a.name} turns on creator ${b.name}`,`The relationship between creation and creator collapses completely as ${a.name} attacks ${b.name} institutions around ${cityName}.`,[a.name,b.name,'Creation','Crisis'],{stability:-9,economy:-5,danger:9},'crisis',why)
    ])();
  }

  // SEPARATE: independent species/groups. Existing diplomacy, raids and wars.
  if(aSentient&&bSentient){
    const neitherMain=!a.main&&!b.main;
    if(v>=75)return pick([
      ()=>event('Alliance',`${a.name}–${b.name} trade corridor opens`,`A permanent trade corridor links ${a.name} and ${b.name} communities through ${cityName}.`,[a.name,b.name,'Trade'],{stability:5,economy:6,knowledge:2},'major',why),
      ()=>event('Alliance',`${a.name} and ${b.name} sign a mutual-defense pact`,`The two independent peoples establish coordinated defenses and emergency assistance.`,[a.name,b.name,'Defense'],{stability:6,economy:2,danger:-2},'major',why)
    ])();
    if(v>10)return event('Diplomacy',`${a.name} and ${b.name} expand trade`,`Merchants establish regular markets and transport agreements around ${cityName}.`,[a.name,b.name,'Trade'],{economy:4,stability:2},'normal',why);
    if(v>=-10)return event('Society',`${a.name}–${b.name} negotiations stall`,`Talks resolve minor issues, but competing claims remain unsettled.`,[a.name,b.name,'Negotiation'],{stability:0,economy:1,danger:1},'normal',why);
    if(v>-60){
      if(neitherMain&&mainSpecies&&chance(.55))return event('Intervention',`${mainName} mediates the ${a.name}–${b.name} dispute`,`After repeated raids and clashes, ${mainName} representatives call both sides to negotiations near ${cityName}.`,[a.name,b.name,mainName,'Intervention'],{stability:2,economy:-1,danger:-1},'major',[...why,`${mainName} is Main`]);
      return event('Conflict',`${a.name} raid strikes ${b.name} settlement`,`A coordinated ${a.name} raid attacks a ${b.name} settlement near ${cityName}, damaging infrastructure and provoking retaliation.`,[a.name,b.name,'Raid'],{stability:-4,economy:-3,danger:5},'major',why);
    }
    if(neitherMain&&mainSpecies&&chance(.72))return event('Intervention',`${mainName} intervenes in the ${a.name}–${b.name} war`,`With raids escalating into organized warfare, ${mainName} enters the conflict to protect ${cityName} and secure major routes.`,[a.name,b.name,mainName,'War','Intervention'],{stability:-2,economy:-3,danger:4},'crisis',[...why,`${mainName} is Main`]);
    return event('War',`${a.name} raid terrorizes ${b.name} settlements`,`Large ${a.name} raiding forces strike multiple ${b.name} settlements around ${cityName}, triggering organized retaliation.`,[a.name,b.name,'Raid','War'],{stability:-8,economy:-5,danger:8},'crisis',why);
  }

  // Separate arbitrary-node relationships retain generic contextual behavior.
  const subject=a,target=b;
  if(v>10)return event('Interaction',`${subject.name} assists ${target.name}`,`${subject.name} begins assisting, protecting, supplying, or improving ${target.name} around ${cityName}.`,[subject.name,target.name,'Relationship'],{stability:2,economy:2,knowledge:1},'normal',why);
  if(v<-10)return event('Threat',`${subject.name} disrupts ${target.name}`,`${subject.name} repeatedly interferes with ${target.name}, causing shortages, failures, attacks, or danger around ${cityName}.`,[subject.name,target.name,'Relationship'],{stability:-3,economy:-2,danger:4},'major',why);
  return event('Interaction',`${subject.name} has mixed interactions with ${target.name}`,`Some encounters prove useful while others create disputes or localized disruption.`,[subject.name,target.name,'Relationship'],{stability:0,danger:1},'normal',why);
}

function makeCivilizationEvent(ctx){
  const pool=[],s=pick(ctx.spells),s2=pick(ctx.spells.filter(x=>x!==s)),m=pick(ctx.materials),t=pick(ctx.tools),tech=pick(ctx.techniques),p=pick(ctx.principles),r=pick(ctx.rules),cls=pick(ctx.classes),region=pick(simState.regions);
  const mainSpecies=pick(ctx.mainLife||[]);
  const otherSentient=pick(ctx.secondarySentients||[]);
  const place=pick(ctx.places||[]);
  const individual=pick(ctx.individuals||[]);
  if(individual){
    const morality=Math.max(-100,Math.min(100,Number(individual.individualMorality)||0));
    const allSpells=nodes.filter(n=>n.type==='spell'&&!n.isHub);
    const allObjects=nodes.filter(n=>n.type==='magicalObject'&&!n.isHub);
    const linkedIds=new Set(edges.filter(e=>!e.blocked&&(e.a===individual.id||e.b===individual.id)).map(e=>e.a===individual.id?e.b:e.a));
    const linkedSpells=allSpells.filter(s=>linkedIds.has(s.id));
    const linkedObjects=allObjects.filter(o=>linkedIds.has(o.id));
    const spellPool=linkedSpells.length?linkedSpells:allSpells;
    const spellMorality=s=>Number.isFinite(+s.morality)?+s.morality:Number.isFinite(+s.goodBad)?+s.goodBad:0;
    const alignedSpells=spellPool.filter(s=>morality<=-25?spellMorality(s)<-20:morality>=25?spellMorality(s)>20:true);
    const chosenSpell=pick(alignedSpells.length?alignedSpells:spellPool);
    const chosenObject=pick(linkedObjects.length?linkedObjects:allObjects);
    const eventPlace=place?.name||'a populated settlement';

    if(morality<=-60){
      pool.push(()=>event(
        'Individual Incident',
        `${individual.name} causes a magical crisis in ${eventPlace}`,
        chosenSpell
          ? `${individual.name} uses ${chosenSpell.name} during a destructive magical incident in ${eventPlace}, forcing the civilization to respond.`
          : `${individual.name} causes a major magical incident in ${eventPlace}, forcing local institutions to respond.`,
        [individual.name,chosenSpell?.name||'Individual',eventPlace],
        {stability:-2,danger:3,knowledge:1},'pale-bad',
        [`${individual.name} morality: ${morality}`,chosenSpell?`${chosenSpell.name} morality: ${spellMorality(chosenSpell)}`:'No spell was selected',chosenSpell&&linkedSpells.includes(chosenSpell)?'Individual is directly linked to this spell':'Action draws from the wider magical system']
      ));
    }else if(morality>=60){
      pool.push(()=>event(
        'Individual Achievement',
        `${individual.name} aids ${eventPlace}`,
        chosenSpell
          ? `${individual.name} uses ${chosenSpell.name} to protect, assist, or improve life in ${eventPlace}.`
          : chosenObject
            ? `${individual.name} uses ${chosenObject.name} in an effort that benefits ${eventPlace}.`
            : `${individual.name} becomes known for actions that benefit ${eventPlace}.`,
        [individual.name,chosenSpell?.name||chosenObject?.name||'Individual',eventPlace],
        {stability:2,danger:-1,knowledge:2},'pale-good',
        [`${individual.name} morality: +${morality}`,chosenSpell?`${chosenSpell.name} morality: ${spellMorality(chosenSpell)}`:'Positive morality biased this action',chosenSpell&&linkedSpells.includes(chosenSpell)||chosenObject&&linkedObjects.includes(chosenObject)?'Action uses a directly linked graph node':'Action draws from the wider magical system']
      ));
    }else{
      pool.push(()=>event(
        'Person',
        `${individual.name} influences events in ${eventPlace}`,
        chosenSpell
          ? `${individual.name} becomes involved in an event using ${chosenSpell.name}; its consequences become part of local history.`
          : `${individual.name} becomes increasingly important through reputation, leadership, research, discovery, politics, or public events.`,
        [individual.name,chosenSpell?.name||'Individual',eventPlace],
        {knowledge:1,stability:Math.random()<.5?1:-1},'normal',
        [`${individual.name} morality: ${morality}`,'Moderate morality allows mixed positive and negative behavior']
      ));
    }

    // Morality is probabilistic: strongly aligned people can occasionally act against type.
    if(Math.random()<0.12&&Math.abs(morality)>=45){
      pool.push(()=>event(
        'Unexpected Choice',
        `${individual.name} acts against expectations`,
        `${individual.name} makes a notable choice that runs against their usual moral pattern, complicating their historical reputation.`,
        [individual.name,'Individual'],{knowledge:1,stability:morality<0?1:-1},'normal',
        [`Usual morality: ${morality}`,'Individual morality is a probability bias, not an absolute behavior lock']
      ));
    }
  }
  const graphRelationship=pick(simulationRelationships());
  if(graphRelationship)pool.push(()=>relationshipEvent(graphRelationship,ctx));

  if(mainSpecies)pool.push(()=>event(
    'Society',
    `${mainSpecies.name} institutions expand`,
    `${mainSpecies.name} communities expand their influence over government, education, infrastructure, and magical law.`,
    [mainSpecies.name,'Main Species'],{stability:2,economy:2,knowledge:1},'normal',
    [`${mainSpecies.name} is marked Main`,`Main automatically implies Sentient`]
  ));

  if(otherSentient&&!simulationRelationships().some(rel=>rel.a.id===otherSentient.id||rel.b.id===otherSentient.id)){
    const rv=Number.isFinite(otherSentient.relationshipWithMain)?otherSentient.relationshipWithMain:0;
    pool.push(()=>event(
      rv>10?'Diplomacy':rv<-10?'Conflict':'Society',
      `${otherSentient.name} relations reshape the frontier`,
      rv>10?`${otherSentient.name} communities expand trade, assistance, shared research, and defensive cooperation with nearby settlements.`:
      rv<-10?`Raids, territorial disputes, sabotage, and organized attacks involving ${otherSentient.name} become increasingly common.`:
      `${otherSentient.name} communities alternate between cooperation, negotiation, competition, and localized disputes.`,
      [otherSentient.name,'Sentient Species','Relationship'],rv>10?{stability:3,economy:3,knowledge:1}:rv<-10?{stability:-4,economy:-2,danger:4}:{stability:0,economy:1,danger:1},rv<-50?'major':'normal',
      [`${otherSentient.name} is Sentient`,`${otherSentient.name} is not Main`,`Relationship with Main: ${rv>0?'+':''}${rv}`]
    ));
  }

  if(place)pool.push(()=>event(
    'Region',
    `${place.name} becomes strategically important`,
    `${place.name}${place.placeType?` (${place.placeType})`:''} grows in importance.${place.inhabitants?` Known inhabitants include ${place.inhabitants}.`:''}${place.government?` Authority is associated with ${place.government}.`:''}`,
    [place.name,'Place'],{economy:2,stability:1,knowledge:1},'normal',
    [`Place exists in the magic graph`]
  ));

  if(s)pool.push(()=>event('Discovery',`${s.name} spreads through society`,`Practical knowledge of ${s.name} expands beyond specialists, creating new civilian and professional applications.`,[s.spellClass||'Spell',s.name],{knowledge:3,economy:2,danger:1},'breakthrough',[`Spell exists in the magic graph`,`Class: ${s.spellClass||'Unclassified'}`]));
  if(s&&s2&&s.spellClass===s2.spellClass)pool.push(()=>event('Research',`A new ${s.spellClass} synthesis`,`${s.name} and ${s2.name} are studied together. Their shared class suggests common underlying structure.`,[s.spellClass,'Research'],{knowledge:5,danger:1},'breakthrough',[`Both spells share the class ${s.spellClass}`]));
  if(m)pool.push(()=>event('Economy',`${m.name} becomes strategically valuable`,`Demand for ${m.name} rises sharply.${m.property?` Its property — ${m.property} — makes it especially valuable.`:''}`,[m.name,'Material'],{economy:5,stability:-1},'normal',[`Material exists in the magic graph`]));
  if(m&&chance(.30))pool.push(()=>event('Shortage',`${m.name} shortage`,`Supply fails to keep pace with magical demand. Workshops ration ${m.name} and researchers begin looking for substitutes.`,[m.name,'Shortage'],{economy:-5,stability:-4,danger:1},'crisis',[`High simulated magical demand`,`Material dependency`]));
  if(t)pool.push(()=>event('Technology',`${t.name} changes magical practice`,`The ${t.name} spreads into broader magical use.${t.composition?` Production depends on ${t.composition}.`:''}`,['Tool',t.name],{knowledge:2,economy:4,technology:3},'normal',[`Tool exists in the magic graph`]));
  if(tech)pool.push(()=>event('Education',`${tech.name} becomes standardized`,`Teachers formalize the ${tech.name} technique.${tech.requirements?` Training requires ${tech.requirements}.`:''}`,['Technique','Education'],{knowledge:4,stability:2,danger:-1},'breakthrough',[`Technique exists in the magic graph`]));
  if(p)pool.push(()=>event('Theory',`${p.name} reshapes magical theory`,`Scholars increasingly use ${p.name} as a foundational explanation.${p.property?` Debate centers on ${p.property}.`:''}`,['Principle',p.name],{knowledge:6},'breakthrough',[`Principle exists in the magic graph`]));
  if(r)pool.push(()=>{const affected=ctx.spells.filter(x=>ruleApplies(r,x));return event('Law',`${r.name} becomes a central magical law`,`Experiments repeatedly confirm ${r.name}, affecting ${affected.length} known spell${affected.length===1?'':'s'}.${r.exceptions?` Its exception — ${r.exceptions} — attracts major research.`:''}`,[r.name,r.strength||'Rule'],{knowledge:3,stability:2},'normal',[`${affected.length} graph spells are governed by this rule`])});
  if(r&&r.exceptions&&chance(.45))pool.push(()=>event('Exploit',`Researchers exploit an exception to ${r.name}`,`A research group deliberately builds around the exception “${r.exceptions}”. The discovery opens an unexpected branch of magical engineering.`,['Rule Exception','Exploit'],{knowledge:8,economy:3,danger:5,stability:-2,technology:3},'major',[`Rule has a defined exception`,`Researchers are actively testing boundaries`]));
  if(cls)pool.push(()=>event('Institution',`The ${cls} Academy is founded`,`Practitioners establish a permanent academy for ${cls} magic. The discipline now has formal teachers, exams, archives, and professional standards.`,['Institution',cls],{knowledge:4,stability:3,economy:1},'major',[`Spell Class ${cls} exists`]));
  if(m&&t)pool.push(()=>event('Industry','Arcane manufacturing expands',`Workshops combine ${m.name} with ${t.name}. Standardized magical components create an increasingly specialized industrial sector.`,['Industry',m.name,t.name],{economy:7,technology:4,danger:1},'major',[`A Tool and Material coexist in the system`]));
  if(t&&chance(.22))pool.push(()=>event('Accident',`${t.name} accident triggers regulation`,`A serious failure involving ${t.name} exposes weaknesses in magical safety standards. Certification and inspection become political issues.`,['Accident',t.name],{stability:-4,danger:6,economy:-2},'crisis',[`Widespread tool use`,`Arcane risk exists`]));
  if(s&&chance(.22))pool.push(()=>event('Infrastructure',`${s.name} enters public infrastructure`,`Engineers make ${s.name} reliable enough for civic use. Services begin depending on a spell once treated as specialist magic.`,['Infrastructure',s.name],{economy:6,stability:4,technology:3},'major',[`Spell has reached mass adoption`]));
  if(s&&chance(.14))pool.push(()=>event('Disaster',`A ${s.spellClass||'magical'} cascade`,`A large-scale magical failure involving ${s.name} spreads farther than expected. The event becomes a defining safety case study.`,['Disaster',s.name],{population:-.012,stability:-8,economy:-5,danger:9,knowledge:4},'crisis',[`High-impact spell use`,`Safety systems failed`]));
  if(region&&cls&&chance(.28))pool.push(()=>event('Regional Change',`${region.name} embraces ${cls} magic`,`${region.name} becomes a center for ${cls} practice. Local education, employment, and infrastructure adapt around the discipline.`,[region.name,cls],{economy:2,knowledge:2},'normal',[`Region has magical specialization`,`Spell Class exists`]));
  if(ctx.classes.length>1&&chance(.25)){const a=pick(ctx.classes),b=pick(ctx.classes.filter(x=>x!==a));pool.push(()=>event('Debate',`${a} and ${b} schools clash`,`Practitioners of ${a} and ${b} disagree over education, funding, and theory. Competing institutions begin forming.`,['Academic Rivalry',a,b],{knowledge:3,stability:-2},'normal',[`Multiple Spell Classes exist`]))}
  if(simState.knowledge>35&&s)pool.push(()=>event('Breakthrough',`Advanced theory transforms ${s.name}`,`Accumulated knowledge allows researchers to derive ${s.name} from first principles rather than rote practice.`,['Breakthrough',s.name],{knowledge:7,economy:4,danger:-1,technology:3},'breakthrough',[`Arcane Knowledge exceeded 35%`]));
  if(simState.economy>45&&m)pool.push(()=>event('Trade',`${m.name} trade goes international`,`Long-distance trade networks specialize in ${m.name}. Magical supply chains begin influencing diplomacy and urban growth.`,['Trade',m.name],{economy:6,stability:1},'major',[`Magic Economy exceeded 45%`]));
  if(simState.danger>45)pool.push(()=>event('Law','The Arcane Safety Charter',`Major institutions agree on common containment, training, and emergency standards after years of rising magical risk.`,['Safety','Regulation'],{danger:-12,stability:6,economy:-2},'major',[`Arcane Risk exceeded 45%`]));
  if(simState.stability<40)pool.push(()=>event('Unrest','Magical institutions face public unrest',`Disputes over access, accidents, regulation, and magical privilege produce widespread unrest.`,['Unrest','Politics'],{stability:-3,economy:-3,danger:3},'crisis',[`Stability fell below 40%`]));

    const harmful=ctx.spells.filter(s=>(s.morality??0)<=-35),beneficial=ctx.spells.filter(s=>(s.morality??0)>=35);
  if(harmful.length){const hs=pick(harmful);pool.push(()=>event('Crime',`${hs.name} appears in serious magical crime`,`Authorities report misuse of ${hs.name}. Its strongly harmful profile pushes lawmakers, investigators, and researchers to debate restrictions and defensive training.`,['Crime',hs.name],{danger:6,stability:-3,knowledge:2},'crisis',[`${hs.name} has morality ${hs.morality}`]))}
  if(beneficial.length){const gs=pick(beneficial);pool.push(()=>event('Society',`${gs.name} enters civilian life`,`Public institutions find practical uses for ${gs.name}. Training expands and the spell begins affecting ordinary work and services.`,['Society',gs.name],{economy:4,stability:3,knowledge:2},'breakthrough',[`${gs.name} has morality +${gs.morality}`]))}
  if(ctx.structures.length){const st=pick(ctx.structures);pool.push(()=>event('Institution',`${st.name} gains influence`,`The ${st.category||'magical organization'} becomes an important part of magical society, shaping education, regulation, research, or public life.`,['Structure',st.name],{stability:2,knowledge:3},'major',[`A Structure exists in the graph`]))}
  const ecologyLife=ctx.life.filter(l=>!l.main);
  if(ecologyLife.length){const lf=pick(ecologyLife);pool.push(()=>event('Ecology',`${lf.name} changes magical ecology`,`Researchers document how ${lf.name} interacts with the wider magical system. Conservation, harvesting, study, or public safety practices begin to form around it.`,['Life',lf.name],{knowledge:4,economy:1,danger:1},'normal',[`${lf.name} is a non-Main Life node in the graph`]))}
  if(!pool.length)return event('Founding','Mana becomes a field of study','Civilization begins systematic study of Mana, but there are not yet enough defined magical concepts for specialized institutions to emerge.',['Mana'],{knowledge:2},'normal',['Only Mana is currently defined']);
  return pick(pool)()
}
function postEventEmergence(ev){
  const ctx=simContext();
  if(ev.kind==='Institution'){
    const cls=ev.tags.find(t=>ctx.classes.includes(t))||pick(ctx.classes)||'Magic';
    createInstitution(`${cls} Academy`,'Academy',cls,pick(simState.regions)?.name)
  }
  if(ev.kind==='Industry'){
    addUnique(simState.industries,ev.title);addCivNode(ev.title,'industry',ev.tags[1]||'Magic');addCivEdge(simState.civ,ev.title,'develops')
  }
  if(ev.kind==='Infrastructure'){addCivNode(ev.title,'infrastructure',ev.tags[1]||'Spell');addCivEdge(simState.civ,ev.title,'builds')}
  if(ev.kind==='Debate'){addUnique(simState.factions,ev.title)}
  maybeStartResearch(ctx)
}
function organizationPairKey(a,b){
  return[a.id,b.id].sort().join('::')
}
function organizationPairState(a,b){
  simState.organizationState??={};
  const key=organizationPairKey(a,b);
  return simState.organizationState[key]??={
    lastEventYear:-9999,
    lastConflictYear:-9999,
    lastTradeYear:-9999,
    lastDiplomacyYear:-9999,
    tension:0,
    tradeMomentum:0,
    atWar:false,
    warStartYear:null,
    warEndYear:null,
    warEventId:null,
    lastWarEndYear:-9999,
    nextWarEligibilityYear:null
  }
}
function organizationWarDuration(){
  return 10+Math.floor(Math.random()*91)
}
function organizationWarEligible(a,b,v,state){
  if(v>-55||state.atWar)return false;

  if(state.nextWarEligibilityYear==null){
    // Initial or post-war eligibility is centuries apart.
    state.nextWarEligibilityYear=
      (state.lastWarEndYear>-9000)
        ?state.lastWarEndYear+300+Math.floor(Math.random()*401)
        :simState.year
  }
  return simState.year>=state.nextWarEligibilityYear
}
function startOrganizationWar(a,b,v,state){
  state.atWar=true;
  state.warStartYear=simState.year;
  state.warEndYear=simState.year+organizationWarDuration();
  state.lastConflictYear=simState.year;
  state.nextWarEligibilityYear=null;

  const ev=event(
    'War',
    `${a.name} declares war on ${b.name}`,
    `After prolonged hostility, ${a.name} and ${b.name} enter open war. The conflict is now an active historical state rather than a repeated yearly warning.`,
    [a.name,b.name,'Organization','War'],
    {stability:-7,danger:10,economy:-5},
    'major',
    [
      `Organization relationship: ${v}`,
      organizationRelationshipLabel(v),
      `War began in Year ${simState.year}`,
      `Projected duration: ${state.warEndYear-simState.year} years`
    ]
  );
  state.warEventId=ev.id;
  return ev
}
function maybeEndOrganizationWar(a,b,state){
  if(!state.atWar||simState.year<state.warEndYear)return null;

  const startId=state.warEventId;
  state.atWar=false;
  state.lastWarEndYear=simState.year;
  state.warStartYear=null;
  state.warEndYear=null;
  state.warEventId=null;
  state.tension=Math.max(0,(state.tension||0)-35);
  state.nextWarEligibilityYear=simState.year+300+Math.floor(Math.random()*401);

  const endings=[
    ['Peace Treaty',`${a.name} and ${b.name} sign a peace treaty`,
      `After years of war, ${a.name} and ${b.name} formally end hostilities and establish a negotiated peace.`],
    ['Armistice',`${a.name} and ${b.name} agree to an armistice`,
      `Exhaustion and mounting costs force both organizations to suspend open conflict.`],
    ['War Ends',`The war between ${a.name} and ${b.name} ends`,
      `The conflict concludes after a prolonged campaign, leaving political, economic, and territorial consequences.`],
    ['Settlement',`${a.name} and ${b.name} accept a settlement`,
      `Mediators and internal pressure produce an agreement ending the war.`]
  ];
  const [kind,title,text]=pick(endings);
  const ev=event(
    kind,title,text,
    [a.name,b.name,'Organization','Peace'],
    {stability:6,danger:-8,economy:3},
    'major',
    [`War ended in Year ${simState.year}`]
  );
  if(startId){
    ev.parentEventId=startId;
    ev.parentRelation='Ended by'
  }
  return ev
}
function organizationWarTick(){
  const relEdges=edges.filter(e=>e.type==='organizationRelationship'&&!e.blocked);

  // Resolve existing wars every year.
  for(const e of relEdges){
    const a=byId(e.a),b=byId(e.b);
    if(!a||!b)continue;
    const ended=maybeEndOrganizationWar(a,b,organizationPairState(a,b));
    if(ended)return ended
  }

  // Global probability: ~0.2% per year when at least one hostile pair is eligible,
  // or roughly one new war per 500 simulated years.
  const eligible=relEdges.map(e=>{
    const a=byId(e.a),b=byId(e.b);
    if(!a||!b)return null;
    const v=Number.isFinite(e.relationship)?e.relationship:0;
    const state=organizationPairState(a,b);
    return{a,b,v,state}
  }).filter(x=>x&&organizationWarEligible(x.a,x.b,x.v,x.state));

  if(!eligible.length||!chance(.002))return null;
  const chosen=pick(eligible);
  return startOrganizationWar(chosen.a,chosen.b,chosen.v,chosen.state)
}

function organizationInteractionEvent(a,b,v,state){
  const rel=organizationRelationshipLabel(v);
  const why=[`Organization relationship: ${v>0?'+':''}${v}`,rel];

  // Severe hostility is intentionally rare. The same pair cannot flood the
  // timeline with repeated war-warning events.
  if(v<=-70){
    // Actual war starts/ends in organizationWarTick().
    const yearsSinceConflict=simState.year-state.lastConflictYear;
    state.tension=Math.min(100,(state.tension||0)+2+Math.random()*5);

    if(yearsSinceConflict>=18&&state.tension>=24&&chance(.055)){
      state.lastConflictYear=simState.year;
      state.tension=Math.max(6,state.tension-22);
      return pick([
        ()=>event('Border Crisis',`${a.name} and ${b.name} enter a border crisis`,
          `A long period of hostility finally produces a serious confrontation between ${a.name} and ${b.name}. Forces mobilize, but open war is not yet inevitable.`,
          [a.name,b.name,'Organization','Border Crisis'],{stability:-3,danger:5,economy:-2},'crisis',why),
        ()=>event('Sanctions',`${a.name} imposes sanctions on ${b.name}`,
          `${a.name} restricts trade, travel, magical resources, or diplomatic access involving ${b.name}.`,
          [a.name,b.name,'Organization','Sanctions'],{economy:-3,stability:-1,danger:1},'normal',why),
        ()=>event('Espionage',`${a.name} and ${b.name} intensify espionage`,
          `Both organizations expand intelligence operations, magical surveillance, infiltration, and counterintelligence against one another.`,
          [a.name,b.name,'Organization','Espionage'],{knowledge:1,danger:2,stability:-1},'normal',why)
      ])()
    }

    if(chance(.11)){
      return pick([
        ()=>event('Diplomacy',`${a.name} and ${b.name} hold emergency talks`,
          `Despite severe hostility, representatives meet to prevent a dispute from escalating further.`,
          [a.name,b.name,'Organization','Diplomacy'],{stability:2,danger:-1},'normal',why),
        ()=>event('Propaganda',`${a.name} condemns ${b.name}`,
          `${a.name} launches a public campaign portraying ${b.name} as a political, magical, or economic threat.`,
          [a.name,b.name,'Organization','Propaganda'],{stability:-1},'normal',why)
      ])()
    }
    return null
  }

  if(v<=-35){
    state.tension=Math.min(100,(state.tension||0)+1);
    if(chance(.12))return pick([
      ()=>event('Diplomatic Dispute',`${a.name} and ${b.name} exchange accusations`,
        `Officials from ${a.name} and ${b.name} publicly dispute policy, territory, resources, or magical conduct.`,
        [a.name,b.name,'Organization','Dispute'],{stability:-1,danger:1},'normal',why),
      ()=>event('Embargo',`${a.name} limits commerce with ${b.name}`,
        `Trade restrictions reduce the flow of goods and magical resources between the two organizations.`,
        [a.name,b.name,'Organization','Embargo'],{economy:-2},'normal',why),
      ()=>event('Mediation',`Mediators approach ${a.name} and ${b.name}`,
        `Neutral representatives attempt to keep the strained relationship from deteriorating further.`,
        [a.name,b.name,'Organization','Mediation'],{stability:2,danger:-1},'normal',why)
    ])();
    return null
  }

  if(v<15){
    if(chance(.075))return pick([
      ()=>event('Diplomatic Visit',`${a.name} receives delegates from ${b.name}`,
        `A routine diplomatic mission discusses travel, law, magical standards, and future cooperation.`,
        [a.name,b.name,'Organization','Diplomacy'],{stability:1},'normal',why),
      ()=>event('Negotiation',`${a.name} and ${b.name} begin negotiations`,
        `Representatives discuss a limited agreement without committing to a formal alliance.`,
        [a.name,b.name,'Organization','Negotiation'],{stability:1,economy:1},'normal',why)
    ])();
    return null
  }

  if(v<50){
    if(chance(.11))return pick([
      ()=>event('Gift Exchange',`${a.name} sends gifts to ${b.name}`,
        `${a.name} sends ceremonial goods, magical artifacts, food, or culturally important gifts to ${b.name}.`,
        [a.name,b.name,'Organization','Gift'],{stability:2,economy:1},'normal',why),
      ()=>event('Research Cooperation',`${a.name} and ${b.name} begin joint research`,
        `Researchers share techniques, observations, and magical knowledge through a limited cooperative program.`,
        [a.name,b.name,'Organization','Research'],{knowledge:3,stability:1},'normal',why),
      ()=>event('Travel Agreement',`${a.name} and ${b.name} ease travel restrictions`,
        `Citizens, merchants, scholars, and envoys can move more easily between territories controlled by the two organizations.`,
        [a.name,b.name,'Organization','Travel'],{economy:1,stability:2},'normal',why)
    ])();
    return null
  }

  // Strong relationships generate varied cooperation, but trade itself has
  // a cooldown so it doesn't dominate the timeline either.
  const yearsSinceTrade=simState.year-state.lastTradeYear;
  if(yearsSinceTrade>=8&&chance(.13)){
    state.lastTradeYear=simState.year;
    state.tradeMomentum=Math.min(100,(state.tradeMomentum||0)+8);
    return pick([
      ()=>event('Organization Trade',`${a.name} and ${b.name} expand trade`,
        `${a.name} and ${b.name} exchange resources, magical goods, crafted products, and specialist services.`,
        [a.name,b.name,'Organization','Trade'],{economy:4,stability:1},'normal',why),
      ()=>event('Diplomatic Gift',`${a.name} delivers a major gift to ${b.name}`,
        `A valuable diplomatic gift strengthens trust and reinforces the relationship between the organizations.`,
        [a.name,b.name,'Organization','Gift'],{stability:3,economy:1},'normal',why),
      ()=>event('Joint Expedition',`${a.name} and ${b.name} launch a joint expedition`,
        `Personnel and resources from both organizations cooperate on exploration, research, surveying, or magical recovery.`,
        [a.name,b.name,'Organization','Expedition'],{knowledge:3,economy:1},'normal',why),
      ()=>event('Mutual Aid',`${a.name} provides aid to ${b.name}`,
        `${a.name} sends supplies, healers, engineers, researchers, or magical specialists to assist ${b.name}.`,
        [a.name,b.name,'Organization','Aid'],{stability:3,economy:1},'normal',why)
    ])()
  }

  if(v>=75&&simState.year-state.lastDiplomacyYear>=15&&chance(.045)){
    state.lastDiplomacyYear=simState.year;
    return event('Alliance Talks',`${a.name} and ${b.name} discuss a formal alliance`,
      `Their long-standing positive relationship leads to negotiations over defense, trade, research, and mutual support.`,
      [a.name,b.name,'Organization','Alliance'],{stability:3,knowledge:1},'major',why)
  }

  return null
}
function pushRapidEvent(kind,title,value='',tone='neutral',sourceId=null){
  simState.rapidEvents??=[];
  simState.rapidEvents.unshift({
    id:'rapid_'+uid(),
    year:simState.year,
    kind,title,value,tone,sourceId,
    rapidOnly:true
  });
  simState.rapidEvents=simState.rapidEvents.slice(0,30)
}
function tickRapidCivilizationUtils(){
  for(const c of civilizationUtils('currency')){
    c.marketIndex??=100;
    const volatility=c.currencyStability==='Volatile'?.035:c.currencyStability==='Floating'?.015:.006;
    c.marketIndex=Math.max(1,c.marketIndex*(1+(Math.random()-.5)*2*volatility));
    if(chance(.12))pushRapidEvent('Currency',c.name,`${c.marketIndex.toFixed(2)}`,c.marketIndex>=100?'positive':'negative',c.id)
  }
  for(const m of ofType('material')){
    for(const p of materialPriceRows(m)){
      if(chance(.045)){
        const jitter=1+(Math.random()-.5)*.05;
        p.amount=Math.max(.01,p.amount*jitter);
        pushRapidEvent('Material',`${m.name} / ${p.currency.name}`,`${p.amount.toFixed(2)} ${p.currency.currencySymbol||'¤'}`,jitter>=1?'positive':'negative',m.id)
      }
    }
  }
}
function renderRapidEvents(){
  const box=$('rapidEventsList');if(!box)return;
  const arr=simState.rapidEvents||[];
  box.innerHTML=arr.length?arr.slice(0,12).map(r=>`
    <div class="rapid-event ${r.tone}">
      <span>${E.esc(r.kind)} · Y${r.year}</span>
      <b>${E.esc(r.title)}</b>
      <strong>${E.esc(r.value||'')}</strong>
    </div>`).join(''):'<div class="auto-empty">Fast-moving prices and micro-events appear here.</div>'
}
function languageEventPhrase(language){
  const phrase=languagePreviewPhrase(language);
  return phrase&&phrase!=='No mappings yet'?phrase:'...'
}

function languageSpeakerLocation(speaker){
  if(!speaker)return pick(ofType('place'))||null;

  const native=edges
    .filter(e=>!e.blocked&&(e.a===speaker.id||e.b===speaker.id))
    .map(e=>byId(e.a===speaker.id?e.b:e.a))
    .filter(n=>n?.type==='place');

  return pick(native)||pick(ofType('place').filter(p=>['city','settlement','region','country','planet'].includes(String(p.placeScale||inferPlaceScale(p.placeType)))))||pick(ofType('place'))||null
}

function attachLanguageEventLocation(ev,place){
  if(!ev||!place)return ev;
  ev.location={
    sourceId:place.id,
    name:place.name,
    pathIds:physicalPlacePath(place).map(p=>p.id),
    mapLevel:placeMapLevel(place)
  };
  return ev
}

function createLanguageCivilizationEvent(language,speakers){
  if(!language||!speakers?.length)return null;

  const speaker=pick(speakers);
  const place=languageSpeakerLocation(speaker);
  const phrase=languageEventPhrase(language);
  const roll=Math.random();

  let ev;

  if(roll<.28){
    ev=event(
      'Language Misunderstanding',
      `${language.name} misunderstanding “${phrase}” causes concern${place?` in ${place.name}`:''}`,
      `${speaker.name} speakers use the ${language.name} phrase “${phrase}”. It is misunderstood by another group, briefly creating confusion and concern${place?` in ${place.name}`:''}.`,
      [speaker.name,language.name,place?.name||'','Civilization Utility','Language','Misunderstanding'].filter(Boolean),
      {stability:-1,danger:1},'normal',
      [
        `${speaker.name} is explicitly linked as a speaker of ${language.name}.`,
        `The phrase was generated from ${language.name}'s authored mappings.`
      ]
    )
  }else if(roll<.52){
    ev=event(
      'Translation',
      `${speaker.name} translators clarify “${phrase}”`,
      `Translators working in ${language.name} explain the phrase “${phrase}”, preventing a misunderstanding and improving communication${place?` in ${place.name}`:''}.`,
      [speaker.name,language.name,place?.name||'','Civilization Utility','Language','Diplomacy'].filter(Boolean),
      {stability:2,knowledge:2},'normal',
      [`${speaker.name} is linked to ${language.name} as a speaker.`]
    )
  }else if(roll<.74){
    ev=event(
      'Popular Phrase',
      `“${phrase}” spreads among ${speaker.name}`,
      `The ${language.name} expression “${phrase}” becomes widely repeated by ${speaker.name}${place?` around ${place.name}`:''}.`,
      [speaker.name,language.name,place?.name||'','Civilization Utility','Language','Culture'].filter(Boolean),
      {stability:1,knowledge:1},'normal',
      [`Phrase generated from the authored ${language.name} vocabulary/script.`]
    )
  }else{
    ev=event(
      'Diplomacy',
      `${language.name} phrase “${phrase}” is used in negotiations`,
      `${speaker.name} representatives deliberately use “${phrase}” during negotiations${place?` in ${place.name}`:''}, making the language itself part of the diplomatic exchange.`,
      [speaker.name,language.name,place?.name||'','Civilization Utility','Language','Diplomacy'].filter(Boolean),
      {stability:2,economy:1},'normal',
      [`${speaker.name} speaks ${language.name}.`]
    )
  }

  ev.relatedNodeIds=[speaker.id,language.id,...(place?[place.id]:[])];
  return attachLanguageEventLocation(ev,place)
}

function maybeCivilizationUtilityEvent(){
  if(!chance(.035))return null;
  const utils=civilizationUtils();
  if(!utils.length)return null;
  const util=pick(utils),linked=linkedLifeForUtility(util);
  if(util.utilityType==='language'&&linked.length){
    return createLanguageCivilizationEvent(util,linked)
  }
  // Currency price/index movement is intentionally RAPID-ONLY.
  // tickRapidCivilizationUtils() owns these updates so they never pollute
  // the historical Timeline.
  if(util.utilityType==='disease'&&linked.length){
    const species=pick(linked);
    const mortality=Math.max(0,Math.min(100,+util.diseaseMortality||10));
    const severe=util.diseaseSeverity==='Severe'||mortality>=35;
    return event(
      'Disease Outbreak',
      `${species.name} catch ${util.name}`,
      `${util.name} spreads among susceptible ${species.name}. ${mortality}% of affected populations are estimated to die during this outbreak.`,
      [util.name,species.name,'Civilization Utility','Disease','Outbreak'],
      {stability:severe?-6:-3,danger:severe?7:3,population:-(mortality/100)*.18},
      'crisis',
      [
        `${species.name} is explicitly linked as susceptible.`,
        `Disease severity: ${util.diseaseSeverity||'Unspecified'}`,
        `Configured mortality: ${mortality}%`
      ]
    )
  }
  if(util.utilityType==='calendar'&&chance(.7)){
    return event('Festival',`${util.name} holiday celebrated`,
      `Communities using ${util.name} celebrate a major holiday or calendar observance.`,
      [util.name,'Civilization Utility','Calendar','Festival'],{stability:2,economy:1},'normal',[`Calendar utility: ${util.name}`])
  }
  if(util.utilityType==='legalCode'&&chance(.55)){
    return event('Legal Reform',`${util.name} is amended`,
      `Lawmakers revise part of ${util.name}, changing rights, enforcement, or magical regulation.`,
      [util.name,'Civilization Utility','Law','Reform'],{stability:1},'major',[`Legal code utility: ${util.name}`])
  }
  if(util.utilityType==='communication'&&chance(.55)){
    return event('Communication',`${util.name} network expands`,
      `The ${util.name} communication system expands its reach, allowing faster coordination between linked groups.`,
      [util.name,'Civilization Utility','Communication'],{knowledge:2,economy:1},'breakthrough',[`Communication utility: ${util.name}`])
  }
  if(util.utilityType==='rankSystem'&&linked.length&&chance(.5)){
    const who=pick(linked);
    return event('Promotion',`${who.name} society adopts new ${util.name} promotions`,
      `Changes to ${util.name} produce a wave of promotions, appointments, and status changes.`,
      [util.name,who.name,'Civilization Utility','Rank'],{stability:1},'normal',[`${who.name} uses ${util.name}.`])
  }
  return null
}
function maybeOrganizationEvent(){
  const orgs=organizations();
  if(orgs.length<2)return null;

  // Organization activity now happens much less frequently overall.
  if(!chance(.07))return null;

  const relEdges=edges.filter(e=>e.type==='organizationRelationship'&&!e.blocked);
  if(!relEdges.length)return null;

  // Prefer pairs that have not had a recent event.
  const candidates=relEdges.map(e=>{
    const a=byId(e.a),b=byId(e.b);
    if(!a||!b)return null;
    const state=organizationPairState(a,b);
    return{e,a,b,state,age:simState.year-(state.lastEventYear||-9999)}
  }).filter(Boolean).sort((x,y)=>y.age-x.age);

  const pool=candidates.slice(0,Math.max(1,Math.ceil(candidates.length*.6)));
  const chosen=pick(pool);
  if(!chosen)return null;

  const {e,a,b,state}=chosen;
  if(simState.year-state.lastEventYear<5)return null;

  const v=Number.isFinite(e.relationship)?e.relationship:0;
  const ev=organizationInteractionEvent(a,b,v,state);
  if(ev)state.lastEventYear=simState.year;
  return ev
}

function advanceSimulation(years){
  if(!simState.civ){startSimulation();return}
  const ctx=simContext();
  for(let y=0;y<years;y++){
    simState.year++;
    simState.population=Math.round(simState.population*(1.002+Math.random()*.004));
    simState.regions.forEach(r=>{r.population=Math.round(r.population*(1.002+Math.random()*.004));r.wealth=clamp(r.wealth+(Math.random()-.47)*.6);r.stability=clamp(r.stability+(Math.random()-.5)*.45)});
    tickResearch(1);
    tickRapidCivilizationUtils();
    const warEvent=organizationWarTick();
    if(warEvent){
      warEvent.year=simState.year;
      commitSimulationEvent(warEvent,simContext())
    }

    const orgEvent=maybeOrganizationEvent();
    if(orgEvent){
      orgEvent.year=simState.year;
      commitSimulationEvent(orgEvent,simContext())
    }
    const utilityEvent=maybeCivilizationUtilityEvent();
    if(utilityEvent){
      utilityEvent.year=simState.year;
      commitSimulationEvent(utilityEvent,simContext())
    }
    processScheduledHistoricalEvents(ctx);
    if(technologySettings.enabled){
      const techChance=Math.min(.035,.0015+(simState.knowledge||0)/12000+(simState.technology||0)/15000+Math.log10(Math.max(10,simState.population||10))/10000);
      if(chance(techChance)){
        const tn=discoverCivilizationTechnology();
        if(tn){
          const tev=event('Technology',`${tn.name} developed`,`${simState.civ} researchers develop ${tn.name}, adding a new branch to the civilization's magical technology tree.`,[tn.name,'Technology'],{technology:3,knowledge:2,economy:2},'breakthrough',[`Technology system is enabled`,`Civilization research produced a new technology`,`Population: ${fmtNum(simState.population)}`]);
          tev.year=simState.year;applyImpact(tev);updateWorldFromEvent(tev);commitSimulationEvent(tev,ctx);
        }
      }
    }
    if(chance(.16+Math.min(.18,ctx.spells.length*.012))){
      const ev=makeCivilizationEvent(ctx);ev.year=simState.year;applyImpact(ev);updateWorldFromEvent(ev);postEventEmergence(ev);commitSimulationEvent(ev,ctx)
    }
  }
  updateProfessions();renderSimulation()
}
function startSimulation(){
  if(simAutoTimer){clearInterval(simAutoTimer);simAutoTimer=null;$('simAuto').textContent='▶ Auto'}
  const era=value('simEra'),scale=value('simScale')||'medium',offsets={'Founding':0,'Early Kingdoms':80,'Arcane Renaissance':350,'Industrial Magic':900};
  const popBase={small:75000,medium:350000,large:1800000}[scale]||350000;
  simState={year:offsets[era]||0,events:[],civ:value('simCivName')||'Aetheria',era,population:popBase,stability:70,knowledge:era==='Founding'?5:era==='Early Kingdoms'?15:era==='Arcane Renaissance'?35:60,economy:era==='Founding'?15:era==='Early Kingdoms'?25:era==='Arcane Renaissance'?45:70,danger:5,technology:era==='Founding'?4:era==='Early Kingdoms'?12:era==='Arcane Renaissance'?35:65,institutions:[],discoveries:[],industries:[],crises:[],laws:[],factions:[],regions:[],research:[],professions:[],civNodes:[],civEdges:[],chainState:{},technologyTimeline:[],techDiscoveries:[],pendingEvents:[],selectedEventId:null,worldEffects:{},resourceStates:{},placeStates:{},activeEffects:[],territoryHistory:[],organizationState:{},rapidEvents:[]};
  simState.regions=initialRegions(scale);syncRegionMagic();seedCivGraph();updateProfessions();renderSimulation()
}
// ============================= V20.4 HISTORICAL MAP =============================
const historyMapState={enabled:false,year:null};

function historyMapYear(){
  return historyMapState.enabled
    ?Math.max(0,Math.min(simState.year||0,historyMapState.year??simState.year))
    :(simState.year||0)
}
function ownerAtYear(place,year){
  if(!place)return null;
  simState.territoryHistory??=[];
  const changes=simState.territoryHistory
    .filter(h=>h.placeId===place.id&&h.year<=year)
    .sort((a,b)=>a.year-b.year);
  if(changes.length){
    const last=changes.at(-1);
    return last.ownerId?byId(last.ownerId):null
  }
  return placeOwner(place)
}
function historicalEventsAtYear(year){
  return (simState.events||[]).filter(ev=>ev.year<=year)
}
function historicalActiveEffectsAtYear(year){
  return (simState.activeEffects||[]).filter(fx=>
    fx.startYear<=year&&(fx.endYear==null||fx.endYear>=year)
  )
}
function historicalPlaceState(place,year){
  const state={stability:100,danger:100,prosperity:100,trade:100,construction:100,technology:100};
  const keys=new Set([place.id,place.name]);
  for(const fx of historicalActiveEffectsAtYear(year)){
    if(!(keys.has(fx.scopeKey)||fx.subject===place.name))continue;
    if(fx.metric==='stability')state.stability=clamp(state.stability+fx.delta,0,200);
    if(fx.metric==='danger')state.danger=clamp(state.danger+fx.delta,0,300);
    if(fx.metric==='prosperity')state.prosperity=clamp(state.prosperity+fx.delta,0,300);
    if(fx.metric==='trade')state.trade=clamp(state.trade+fx.delta,0,300);
    if(fx.metric==='construction')state.construction=clamp(state.construction+fx.delta,0,300);
    if(fx.metric==='technology')state.technology=clamp(state.technology+fx.delta,0,300)
  }
  return state
}
function syncHistoryMapUI(){
  const wrap=$('historyMapScrubber'),slider=$('historyMapYear'),out=$('historyMapYearOut');
  if(!wrap||!slider||!out)return;
  const max=Math.max(0,simState.year||0);
  slider.max=String(max);
  if(historyMapState.year==null)historyMapState.year=max;
  historyMapState.year=Math.max(0,Math.min(max,historyMapState.year));
  slider.value=String(historyMapState.year);
  wrap.classList.toggle('hidden',!historyMapState.enabled);
  $('historyMapToggle')?.classList.toggle('active',historyMapState.enabled);
  out.textContent=historyMapState.enabled?`Year ${historyMapState.year}`:'Live'
}
function setHistoricalMapYear(year){
  historyMapState.enabled=true;
  historyMapState.year=Math.max(0,Math.min(simState.year||0,Math.round(Number(year)||0)));
  syncHistoryMapUI();
  requestPlanetDraw();
  if(!$('simulationModal')?.classList.contains('hidden'))renderSimulation()
}
function exitHistoricalMap(){
  historyMapState.enabled=false;
  historyMapState.year=simState.year||0;
  syncHistoryMapUI();
  requestPlanetDraw();
  if(!$('simulationModal')?.classList.contains('hidden'))renderSimulation()
}
function bindHistoryMapControls(){
  const toggle=$('historyMapToggle');
  if(!toggle||toggle._historyBound)return;
  toggle._historyBound=true;
  toggle.onclick=()=>historyMapState.enabled?exitHistoricalMap():setHistoricalMapYear(simState.year||0);
  $('historyMapYear')?.addEventListener('input',e=>setHistoricalMapYear(+e.target.value));
  $('historyMapLive').onclick=exitHistoricalMap;
  syncHistoryMapUI()
}
// =========================== END V20.4 HISTORICAL MAP ===========================

// ======================== V20.3 FACTIONS & TERRITORY ========================
function politicalFactions(){
  const explicit=organizations();
  const legacy=ofType('life').filter(l=>l.sentient||l.main)
    .concat(ofType('structure').filter(s=>
      /government|empire|kingdom|republic|faction|nation|order|council|authority/i.test(
        `${s.name} ${s.category||''}`
      )
    ));
  return[...new Map([...explicit,...legacy].map(x=>[x.id,x])).values()]
}
function factionColor(faction){
  if(!faction)return'#7890aa';
  if(faction.factionColor)return faction.factionColor;

  const seed=[...String(faction.id||faction.name)].reduce(
    (a,c)=>a+c.charCodeAt(0),0
  );

  const hue=Math.floor(seededUnit(seed,1,919.2)*360);
  return `hsl(${hue} 60% 62%)`
}
function placeOwner(place){
  if(!place)return null;

  if(place.ownerFactionId){
    const owner=byId(place.ownerFactionId);
    if(owner)return owner
  }

  // Existing textual Government/Owner field can automatically resolve
  // to a graph faction without requiring the user to recreate data.
  const text=String(place.government||'').toLowerCase();
  return politicalFactions().find(f=>
    text.includes(String(f.name||'').toLowerCase())
  )||null
}
function setPlaceOwner(place,faction,reason='Ownership changed'){
  if(!place)return;
  const previous=placeOwner(place);

  place.ownerFactionId=faction?.id||null;

  simState.territoryHistory??=[];
  simState.territoryHistory.push({
    id:'territory'+uid(),
    year:simState.year,
    placeId:place.id,
    previousOwnerId:previous?.id||null,
    ownerId:faction?.id||null,
    reason
  })
}
function factionTerritory(){
  const map=new Map();

  for(const p of ofType('place')){
    const owner=historyMapState.enabled?ownerAtYear(p,historyMapYear()):placeOwner(p);
    if(!owner)continue;

    if(!map.has(owner.id)){
      map.set(owner.id,{
        faction:owner,
        color:factionColor(owner),
        places:[]
      })
    }

    map.get(owner.id).places.push(p)
  }

  return[...map.values()]
}
function territoryEventEffects(ev){
  const text=[ev.kind,ev.title,ev.text,...(ev.tags||[])].join(' ').toLowerCase();

  if(!/(war|conquest|invasion|rebellion|uprising|annex)/.test(text))return;

  const place=ev.location?.sourceId?byId(ev.location.sourceId):null;
  if(!place||place.type!=='place')return;

  const factions=politicalFactions().filter(f=>
    text.includes(String(f.name||'').toLowerCase())
  );

  if(text.includes('conquest')||text.includes('annex')||text.includes('invasion')){
    const attacker=factions.find(f=>placeOwner(place)?.id!==f.id)||factions[0];
    if(attacker&&Math.random()<.58){
      setPlaceOwner(place,attacker,ev.title);
      ev.territoryChange={
        placeId:place.id,
        ownerId:attacker.id,
        text:`${place.name} comes under ${attacker.name} control.`
      }
    }
  }

  if(text.includes('rebellion')||text.includes('uprising')){
    const current=placeOwner(place);
    if(current&&Math.random()<.45){
      place.ownerFactionId=null;
      ev.territoryChange={
        placeId:place.id,
        ownerId:null,
        text:`${place.name} breaks from ${current.name} control.`
      }
    }
  }
}
function drawTerritoryMapOverlay(ctx,screen,map){
  if(!map||!['galaxy','solar'].includes(map.scale))return;

  const items=map.items
    .map(q=>({q,p:q.sourceId?byId(q.sourceId):null}))
    .filter(x=>x.p);

  for(const {q,p} of items){
    const owner=placeOwner(p);
    if(!owner)continue;

    const P=screen(q.x,q.y);
    const color=factionColor(owner);

    ctx.save();
    ctx.globalAlpha=.17;
    ctx.fillStyle=color;
    ctx.beginPath();
    ctx.arc(P.x,P.y,map.scale==='galaxy'?19:13,0,Math.PI*2);
    ctx.fill();

    ctx.globalAlpha=.68;
    ctx.strokeStyle=color;
    ctx.lineWidth=1.2;
    ctx.beginPath();
    ctx.arc(P.x,P.y,map.scale==='galaxy'?15:10,0,Math.PI*2);
    ctx.stroke();
    ctx.restore()
  }
}
// ====================== END V20.3 FACTIONS & TERRITORY ======================
function placeActiveEffects(place){
  ensurePersistentWorldState();
  const keys=new Set([place.id,place.name]);
  const pool=historyMapState.enabled
    ?historicalActiveEffectsAtYear(historyMapYear())
    :(simState.activeEffects||[]).filter(fx=>fx.active);
  return pool.filter(fx=>keys.has(fx.scopeKey)||fx.subject===place.name)
}
function placeRecentEvents(place){
  const year=historyMapYear();
  return (simState.events||[]).filter(ev=>
    ev.year<=year&&(
      ev.location?.sourceId===place.id||
      (ev.location?.pathIds||[]).includes(place.id)
    )
  ).slice(-8).reverse()
}
function placeLiveState(place){
  ensurePersistentWorldState();
  if(historyMapState.enabled)return historicalPlaceState(place,historyMapYear());
  return simState.placeStates[place.id]||
         simState.placeStates[place.name]||
         {stability:100,danger:100,trade:100,prosperity:100,construction:100,technology:100}
}
function simulationInspectorEvents(node){
  return (simState.events||[])
    .filter(ev=>{
      const refs=eventReferencedNodes(ev);
      return refs.some(n=>n.id===node.id) ||
        ev.location?.sourceId===node.id ||
        (ev.location?.pathIds||[]).includes(node.id)
    })
    .slice(-12)
    .reverse()
}

function simulationWhyForNode(node){
  const why=[];
  if(node.type==='organization'){
    const st=organizationStatusFor(node);
    if(st.wars.length)why.push(`${st.wars.length} hostile relationship${st.wars.length===1?'':'s'} are below the war-risk threshold.`);
    if(st.tradePartners.length)why.push(`${st.tradePartners.length} positive relationship${st.tradePartners.length===1?'':'s'} support trade and gift exchange.`);
    if(st.places.length)why.push(`The organization is linked to or controls ${st.places.length} Place${st.places.length===1?'':'s'}.`)
  }
  if(node.type==='civilizationUtil'){
    const linked=linkedLifeForUtility(node);
    if(linked.length)why.push(`${linked.map(x=>x.name).join(', ')} ${node.utilityType==='language'?'are the only natural speakers':node.utilityType==='currency'?'are the only natural users':'are the explicitly susceptible Life'} of this utility.`);
    else why.push(`No Life restrictions are linked, so this ${utilitySubtypeLabel(node.utilityType).toLowerCase()} is currently unrestricted.`);
  }
  if(node.type==='place'){
    const owner=placeOwner(node);
    if(owner)why.push(`${owner.name} is the current territorial owner.`);
    const effects=placeActiveEffects(node);
    if(effects.length)why.push(`${effects.length} persistent historical effect${effects.length===1?' is':'s are'} active here.`)
  }
  if(node.type==='life'){
    const homes=creatureLinkedPlaces(node);
    if(homes.length)why.push(`Place links restrict this creature to ${homes.map(p=>p.name).join(', ')}.`);
    const exclusive=creatureExclusiveHomePlanets(node);
    if(exclusive.length)why.push(`It is the sole named inhabitant of ${exclusive.map(p=>p.name).join(', ')}.`)
  }
  if(!why.length)why.push('No strong causal constraint is currently recorded; this node follows ordinary simulation rules.');
  return why
}

function openSimulationInspector(node){
  if(!node)return;
  const panel=$('simulationInspector'),body=$('simulationInspectorBody');
  if(!panel||!body)return;

  if(simulationSideTab==='event')setSimulationSideTab(simulationSideBeforeEvent||'world',{remember:false});
  $('placeInspector')?.classList.add('hidden');
  document.querySelector('.civilization-stage')?.classList.add('event-inspector-open');

  const events=simulationInspectorEvents(node);
  const why=simulationWhyForNode(node);
  let main='';

  if(node.type==='civilizationUtil'){
    const linked=linkedLifeForUtility(node);
    const symbol=symbolById(node.symbolId);
    main=`<div class="sim-inspector-hero"><div class="eyebrow">${utilitySubtypeLabel(node.utilityType)}</div><h2>${E.esc(node.name)}</h2><p>${E.esc(node.description||'')}</p></div>
      <div class="sim-inspector-statgrid">
        <div><b>${linked.length}</b><span>Linked Life</span></div>
        <div><b>${node.utilityType==='currency'?'$'+Number(node.usdEquivalent||0).toLocaleString():node.utilityType==='language'?E.esc(node.languageMode||'—'):E.esc(node.diseaseSeverity||'—')}</b><span>${node.utilityType==='currency'?'USD Equivalent':node.utilityType==='language'?'Mapping': 'Severity'}</span></div>
        <div><b>${node.utilityType==='language'?Object.values(normalizeLanguageMappings(node)).reduce((s,a)=>s+a.length,0):node.utilityType==='currency'?linkedCurrenciesForMaterial(node).length:(node.diseaseSpread||'—')}</b><span>${node.utilityType==='language'?'Mappings':node.utilityType==='currency'?'Linked prices':'Spread'}</span></div>
        <div><b>${symbol?'Custom':'—'}</b><span>Symbol Asset</span></div>
      </div>`
  }else if(node.type==='organization'){
    const st=organizationStatusFor(node);
    main=`
      <div class="sim-inspector-hero">
        <div class="eyebrow">${E.esc(node.organizationType||'Organization')}</div>
        <h2>${E.esc(node.name)}</h2>
        <p>${E.esc(node.description||node.organizationPurpose||'')}</p>
      </div>
      <div class="sim-inspector-statgrid">
        <div><b>${(node.organizationMembers||0).toLocaleString()}</b><span>Members</span></div>
        <div><b>${st.places.length}</b><span>Places</span></div>
        <div><b>${st.tradePartners.length}</b><span>Trade-ready</span></div>
        <div><b>${st.wars.length}</b><span>Hostile</span></div>
      </div>
      <div class="reason-card">Organization interactions are rate-limited per pair. Severe hostility raises tension gradually rather than creating a conflict event every year.</div>
      <div class="eyebrow inspector-section-label">Relationships</div>
      <div class="sim-rel-list">
        ${st.relationships.length?st.relationships.map(r=>`
          <div class="sim-rel-card" style="--rel:${organizationRelationColor(r.value)}">
            <strong>${E.esc(r.other.name)}</strong>
            <span>${organizationRelationshipLabel(r.value)} · ${r.value>0?'+':''}${r.value}</span>
          </div>`).join(''):'<div class="reason-card">No organization relationships yet.</div>'}
      </div>`
  }else if(node.type==='place'){
    const live=placeLiveState(node);
    const owner=placeOwner(node);
    main=`
      <div class="sim-inspector-hero"><div class="eyebrow">Place</div><h2>${E.esc(node.name)}</h2><p>${E.esc(node.description||'')}</p></div>
      <div class="sim-inspector-statgrid">
        <div><b>${Math.round(live.stability||100)}</b><span>Stability</span></div>
        <div><b>${Math.round(live.prosperity||100)}</b><span>Prosperity</span></div>
        <div><b>${Math.round(live.trade||100)}</b><span>Trade</span></div>
        <div><b>${owner?E.esc(owner.name):'—'}</b><span>Owner</span></div>
      </div>`
  }else if(node.type==='life'){
    const homes=creatureLinkedPlaces(node);
    main=`
      <div class="sim-inspector-hero"><div class="eyebrow">Life</div><h2>${E.esc(node.name)}</h2><p>${E.esc(node.description||node.property||'')}</p></div>
      <div class="sim-inspector-statgrid">
        <div><b>${node.main?'Main':node.sentient?'Sentient':'Creature'}</b><span>Role</span></div>
        <div><b>${homes.length}</b><span>Place restrictions</span></div>
        <div><b>${creatureExclusiveHomePlanets(node).length}</b><span>Exclusive worlds</span></div>
        <div><b>${events.length}</b><span>Recent events</span></div>
      </div>`
  }else{
    main=`<div class="sim-inspector-hero"><div class="eyebrow">${E.esc(node.type)}</div><h2>${E.esc(node.name)}</h2><p>${E.esc(node.description||node.property||'')}</p></div>`
  }

  body.innerHTML=main+`
    <div class="eyebrow inspector-section-label">Why?</div>
    <div class="reason-stack">${why.map(x=>`<div class="reason-card">${E.esc(x)}</div>`).join('')}</div>
    <div class="eyebrow inspector-section-label">Recent History</div>
    <div class="sim-inspector-history">${events.length?events.map(ev=>`
      <button data-inspect-event="${ev.id}">
        <span>Year ${ev.year}</span><strong>${E.esc(ev.title)}</strong>
      </button>`).join(''):'<div class="reason-card">No recorded events yet.</div>'}</div>
  `;

  body.querySelectorAll('[data-inspect-event]').forEach(btn=>{
    btn.onclick=()=>{
      const ev=(simState.events||[]).find(e=>e.id===btn.dataset.inspectEvent);
      if(ev)inspectEvent(ev)
    }
  });

  panel.classList.remove('hidden');forceSimulationViewerLayout()
}

function inspectPlace(placeOrId){
  const place=typeof placeOrId==='string'?byId(placeOrId):placeOrId;
  if(!place||place.type!=='place')return;

  const panel=$('placeInspector'),box=$('placeInspectorBody');
  if(!panel||!box)return;

  if(simulationSideTab==='event')setSimulationSideTab(simulationSideBeforeEvent||'world',{remember:false});
  panel.classList.remove('hidden');
  document.querySelector('.civilization-stage')?.classList.add('event-inspector-open');
  forceSimulationViewerLayout();

  const state=placeLiveState(place);
  const effects=placeActiveEffects(place);
  const events=placeRecentEvents(place);
  const bodies=String(place.placeScale)==='solar-system'?systemPlanetaryBodies(place):[];
  const moons=isMoonPlace(place)?moonsOrbiting(place):moonsOrbiting(place);
  const megas=megastructureCountForPlace(place);
  const owner=historyMapState.enabled?ownerAtYear(place,historyMapYear()):placeOwner(place);
  const parent=isMoonPlace(place)?moonOrbitParent(place):immediatePhysicalParent(place);

  box.innerHTML=`
    <div class="event-inspector-title">
      <div><div class="eyebrow">${E.esc(placeHierarchyLabel(place))}</div><h3>${isMoonPlace(place)?'☾ ':isGasGiantPlace(place)?'◉ ':''}${E.esc(place.name)}</h3></div>
      ${isMoonPlace(place)?'<span class="event-tone-badge major">Moon</span>':isGasGiantPlace(place)?'<span class="event-tone-badge breakthrough">Gas Giant</span>':''}
    </div>
    <p>${E.esc(place.description||'An authored physical place in this magical system.')}</p>
    <div class="place-state-grid">
      <div><span>Stability</span><b>${Math.round(state.stability)}%</b></div>
      <div><span>Danger</span><b>${Math.round(state.danger)}%</b></div>
      <div><span>Trade</span><b>${Math.round(state.trade)}%</b></div>
      <div><span>Prosperity</span><b>${Math.round(state.prosperity)}%</b></div>
      <div><span>Construction</span><b>${Math.round(state.construction)}%</b></div>
      <div><span>Technology</span><b>${Math.round(state.technology)}%</b></div>
    </div>
    <div class="eyebrow event-section-label">Physical Information</div>
    <div class="reason-grid">
      ${parent?`<div class="reason-card"><b>${isMoonPlace(place)?'Orbiting':'Parent'}</b><br>${E.esc(parent.name)}</div>`:''}
      ${owner?`<div class="reason-card"><b>Territorial Owner</b><br><span class="territory-owner-dot" style="background:${factionColor(owner)}"></span>${E.esc(owner.name)}</div>`:''}
      ${place.government?`<div class="reason-card"><b>Authority</b><br>${E.esc(place.government)}</div>`:''}
      ${place.inhabitants?`<div class="reason-card"><b>Inhabitants</b><br>${E.esc(place.inhabitants)}</div>`:''}
      <div class="reason-card"><b>Megastructures</b><br>${megas}</div>
      ${bodies.length?`<div class="reason-card"><b>Planetary bodies</b><br>${bodies.length}</div>`:''}
      ${moons.length?`<div class="reason-card"><b>Moons</b><br>${moons.map(m=>E.esc(m.name)).join(', ')}</div>`:''}
    </div>
    <div class="eyebrow event-section-label">Active Historical Effects</div>
    <div class="world-effect-grid">${effects.length?effects.map(fx=>`<div class="world-effect-card ${fx.delta>=0?'positive':'negative'}"><span>${E.esc(fx.resource||fx.subject)}</span><b>${E.esc(worldEffectDisplay(fx))}</b></div>`).join(''):'<div class="reason-card">No active historical modifiers.</div>'}</div>
    <div class="eyebrow event-section-label">Recent History</div>
    <div class="related-events-list">${events.length?events.map(ev=>`<button class="related-event-card ${organizationEventPolarity(ev)}" data-place-event="${ev.id}"><span>Year ${ev.year}</span><b>${E.esc(ev.title)}</b><small>${E.esc(ev.kind)}</small></button>`).join(''):'<div class="reason-card">No recorded events here yet.</div>'}</div>
  `;

  box.querySelectorAll('[data-place-event]').forEach(b=>{
    b.onclick=()=>focusEventOnTimeline(b.dataset.placeEvent,{openInspector:true})
  })
}

function focusEventOnTimeline(eventOrId,{openInspector=false}={}){
  const ev=typeof eventOrId==='string'
    ?(simState.events||[]).find(e=>e.id===eventOrId)
    :eventOrId;
  if(!ev)return;

  simState.selectedEventId=ev.id;
  renderSimulation();

  requestAnimationFrame(()=>{
    const safeId=window.CSS?.escape?CSS.escape(ev.id):String(ev.id).replace(/"/g,'\\"');
    const el=document.querySelector(`.sim-event[data-event-id="${safeId}"]`);
    if(el){
      el.scrollIntoView({behavior:'smooth',block:'center'});
      el.classList.add('timeline-jump-pulse');
      setTimeout(()=>el.classList.remove('timeline-jump-pulse'),900)
    }
  });

  if(openInspector)inspectEvent(ev.id)
}
function forceSimulationViewerLayout(){
  requestAnimationFrame(()=>{
    window.dispatchEvent(new Event('resize'));
    requestPlanetDraw();
    if(!$('simCivGraph')?.classList.contains('hidden'))renderCivGraph()
  });
  setTimeout(()=>{
    requestPlanetDraw();
    if(!$('simCivGraph')?.classList.contains('hidden'))renderCivGraph()
  },40)
}

function inspectEvent(iOrId){
  const ev=typeof iOrId==='string'?simState.events.find(e=>e.id===iOrId):simState.events[iOrId];
  if(!ev)return;
  simState.selectedEventId=ev.id;
  $('placeInspector')?.classList.add('hidden');
  $('simulationInspector')?.classList.add('hidden');

  const panel=$('eventInspector'),box=$('eventInspectorBody');
  if(!panel||!box)return;

  setSimulationSideTab('event');
  forceSimulationViewerLayout();

  const impact=Object.entries(ev.impact||{}).filter(([,v])=>v).map(([k,v])=>`<div class="reason-card"><b>${E.esc(k)}</b><br>${v>0?'+':''}${typeof v==='number'&&Math.abs(v)<1?(v*100).toFixed(1)+'%':v}</div>`).join('');
  const related=(ev.relatedEvents||[]).map(rel=>{const other=simState.events.find(e=>e.id===rel.id);if(!other)return'';return`<button class="related-event-card ${organizationEventPolarity(other)}" data-related-event="${E.esc(other.id)}"><span>${rel.direction==='past'?'←':'→'} ${E.esc(rel.type||'Related')}</span><b>Year ${other.year} · ${E.esc(other.title)}</b><small>${E.esc(eventLocationLabel(other))}</small></button>`}).join('');
  const territoryChange=ev.territoryChange
    ?`<div class="world-effect-card"><span>Territory</span><b>${E.esc(ev.territoryChange.text)}</b></div>`
    :'';
  const worldChanges=(ev.worldEffects||[]).map(fx=>`<div class="world-effect-card ${fx.delta>=0?'positive':'negative'}"><span>${E.esc(fx.resource||fx.subject||effectTargetName(ev))}</span><b>${E.esc(worldEffectDisplay(fx))}</b><small>${fx.endYear?`Active until Year ${fx.endYear}`:'Persistent change'}</small></div>`).join('');

  box.innerHTML=`<div class="event-inspector-title ${organizationEventPolarity(ev)}"><div><div class="eyebrow">Year ${ev.year} · ${E.esc(ev.kind)}</div><h3>${renderCivilizationSymbolRichText(ev.title)}</h3></div><span class="event-tone-badge ${E.esc(ev.tone||'normal')}">${E.esc(ev.tone||'normal')}</span></div>
  <p>${renderCivilizationSymbolRichText(ev.text)}</p>
  <div class="event-location-card"><div><span class="eyebrow">Location</span><b>${E.esc(eventLocationLabel(ev))}</b></div><button id="travelToSelectedEvent" class="primary">⌖ Travel to Event</button></div>
  <div class="eyebrow event-section-label">Why This Happened</div><div class="reason-grid">${(ev.reasons||[]).map(r=>`<div class="reason-card">${E.esc(r)}</div>`).join('')||'<div class="reason-card">Emergent simulation event</div>'}</div>
  <div class="eyebrow event-section-label">Consequences</div><div class="reason-grid">${impact||'<div class="reason-card">No major statistical impact</div>'}</div>
  <div class="eyebrow event-section-label">Persistent World Changes</div><div class="world-effect-grid">${territoryChange}${worldChanges||(!territoryChange?'<div class="reason-card">No persistent world-state changes.</div>':'')}</div>
  <div class="eyebrow event-section-label">Related History</div><div class="related-events-list">${related||'<div class="reason-card">No linked historical events yet.</div>'}</div>`;
  $('travelToSelectedEvent').onclick=()=>{
    focusEventOnTimeline(ev);
    travelToEvent(ev)
  };
  box.querySelectorAll('[data-related-event]').forEach(b=>{
    b.onclick=()=>focusEventOnTimeline(b.dataset.relatedEvent,{openInspector:true})
  })
}
function renderCivGraph(){
  const c=$('civGraphCanvas'),rect=c.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const d=devicePixelRatio||1;c.width=rect.width*d;c.height=rect.height*d;const x=c.getContext('2d');x.setTransform(d,0,0,d,0,0);x.clearRect(0,0,rect.width,rect.height);
  const nodes=simState.civNodes,edges=simState.civEdges;if(!nodes.length)return;
  const centerX=rect.width/2,centerY=rect.height/2;
  nodes.forEach((n,i)=>{if(n.type==='civilization'){n.x=0;n.y=0}else{const a=(i/Math.max(1,nodes.length-1))*Math.PI*2;n.x=Math.cos(a)*(120+Math.min(150,nodes.length*5));n.y=Math.sin(a)*(90+Math.min(110,nodes.length*4))}});
  edges.forEach(e=>{const a=nodes.find(n=>n.id===e.a),b=nodes.find(n=>n.id===e.b);if(!a||!b)return;x.beginPath();x.moveTo(centerX+a.x,centerY+a.y);x.lineTo(centerX+b.x,centerY+b.y);x.strokeStyle='rgba(125,150,200,.32)';x.lineWidth=1;x.stroke();const mx=centerX+(a.x+b.x)/2,my=centerY+(a.y+b.y)/2;x.fillStyle='#7f8ca2';x.font='9px system-ui';x.textAlign='center';x.fillText(e.label,mx,my)});
  nodes.forEach(n=>{const px=centerX+n.x,py=centerY+n.y,r=n.type==='civilization'?30:15;x.beginPath();x.arc(px,py,r,0,Math.PI*2);x.fillStyle=n.type==='civilization'?'#173044':n.type==='region'?'#162238':n.type==='institution'?'#2a1f34':n.type==='industry'?'#173127':'#1a2230';x.fill();x.strokeStyle=n.type==='civilization'?'#7de7ff':'#9caeff';x.stroke();x.fillStyle='#eaf1ff';x.font=`${n.type==='civilization'?'600 ':''}9px system-ui`;x.textAlign='center';x.textBaseline='middle';x.fillText(n.name.length>16?n.name.slice(0,15)+'…':n.name,px,py)})
}

function formatHugePopulation(n){
  if(!Number.isFinite(n))return '∞';
  const units=[[1e33,'Dc'],[1e30,'No'],[1e27,'Oc'],[1e24,'Sp'],[1e21,'Sx'],[1e18,'Qi'],[1e15,'Qa'],[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'K']];
  for(const [v,s] of units)if(Math.abs(n)>=v){
    const x=n/v,d=Math.abs(x)>=100?0:Math.abs(x)>=10?1:2;
    return x.toFixed(d).replace(/\.0+$|(\.\d*[1-9])0+$/,'$1')+s;
  }
  return Math.round(n).toLocaleString();
}
function civilizationStage(pop){
  if(pop>=1e33)return{id:'hyper',name:'Hyperdeveloped Magical World',icon:'✹',description:'The planet has become a near-continuous magical machine-city.',structures:['Planetary arcology lattice','Reality-engine complexes','Global mana computation shell']};
  if(pop>=1e30)return{id:'decillion',name:'Decillion Civilization',icon:'✦',description:'Civilization saturates the planet and nearby space with extreme-density magical infrastructure.',structures:['Planet-spanning mana conduits','Artificial micro-realms','Orbital city shells']};
  if(pop>=1e18)return{id:'ringworld',name:'Ringworld Era',icon:'◎',description:'Population pressure pushes civilization beyond planetary limits into a magic-powered ring habitat.',structures:['Magic Ringworld','Stellar mana collectors','Inter-orbital transit lattice']};
  if(pop>=1e15)return{id:'stellar',name:'Stellar Expansion',icon:'☼',description:'Dense orbital industry and magical energy harvesting surround the world.',structures:['Orbital arcologies','Mana collectors','Moon-scale industry']};
  if(pop>=1e12)return{id:'mega',name:'Megastructure Age',icon:'⬡',description:'Trillion-scale population drives continent-sized magical works and orbital infrastructure.',structures:['Continental arcologies','Orbital academies','Atmospheric mana grid']};
  if(pop>=1e9)return{id:'planetary',name:'Planetary Magical Civilization',icon:'◉',description:'Magic is industrialized across the entire world.',structures:['Global magical transit','Planetary ministries','Industrial enchantment networks']};
  if(pop>=1e6)return{id:'urban',name:'Magical Urbanization',icon:'⌂',description:'Large magical cities, academies, ministries and specialized industries dominate society.',structures:['Major academies','National ministries','Enchanted industry']};
  return{id:'early',name:'Early Magical Society',icon:'◇',description:'Magic remains regionally organized around settlements, guilds and early governments.',structures:['Local academies','Regional councils','Early magical industry']};
}
function ensureCivilizationMilestone(){
  const s=civilizationStage(simState.population);
  if(simState.developmentStage===s.id)return s;
  simState.developmentStage=s.id;
  const milestone=event('Development',`${s.icon} ${s.name}`,s.description,s.structures,{},'major',[`Population reached ${formatHugePopulation(simState.population)}`]);
  milestone.year=simState.year;commitSimulationEvent(milestone,simContext(),{schedule:false});
  return s;
}

function eventIndividualActor(ev){
  const ids=new Set(ev?.relatedNodeIds||[]);
  const haystack=[
    ev?.title,ev?.text,ev?.kind,
    ...(ev?.tags||[])
  ].map(x=>String(x||'').toLowerCase()).join(' ');

  return ofType('life').find(l=>{
    if(!l.individual)return false;
    if(ids.has(l.id))return true;
    const name=String(l.name||'').trim().toLowerCase();
    return !!name&&haystack.includes(name)
  })||null
}

function individualEventVisualClass(ev,baseClass){
  // Individual event generators already mark explicit small-scale morality
  // with pale-good / pale-bad. Honor those first so Achievement/Incident
  // cards never fall back to civilization-scale colors.
  if(ev?.tone==='pale-bad')return'event-individual-negative';
  if(ev?.tone==='pale-good')return'event-individual-positive';

  if(!eventIndividualActor(ev))return baseClass;
  if(baseClass==='event-negative')return'event-individual-negative';
  if(baseClass==='event-positive'||baseClass==='event-breakthrough')return'event-individual-positive';
  return baseClass
}

function eventVisualClass(ev){
  const tags=(ev.tags||[]).map(t=>String(t).toLowerCase());
  const text=[ev.kind,ev.title,...tags].join(' ').toLowerCase();

  // Explicit manual-event tone should have strong authority.
  if(ev.manual){
    if(ev.tone==='breakthrough')return individualEventVisualClass(ev,'event-positive');
    if(ev.tone==='crisis')return individualEventVisualClass(ev,'event-negative');
    if(ev.tone==='major')return individualEventVisualClass(ev,'event-major');
  }

  // Outcome-specific phrases must beat broad conflict words.
  const stronglyPositive=[
    'peace treaty','armistice','war ends','war ended','end of war',
    'peace talks','ceasefire','truce','settlement accepted','conflict ends',
    'hostilities end','reconciliation','peace agreement'
  ];

  // Avoid generic "death": names such as "Death Star" are not themselves
  // negative outcomes. Use actual harm/casualty wording instead.
  const stronglyNegative=[
    'declares war','war begins','war starts','invasion','raid','massacre',
    'border crisis','sanction','espionage','propaganda','embargo',
    'diplomatic dispute','hostile','blockade','crash','disease','outbreak',
    'shortage','scarcity','collapse','disaster','crisis','extinction',
    'riot','famine','attack','danger','crime','betrayal',
    'death toll','dies','died','killed','casualties','fatalities',
    'population destroyed','mass death'
  ];

  const positive=[
    'trade','gift','research cooperation','travel agreement','joint expedition',
    'mutual aid','alliance','peace','settlement','diplomatic visit',
    'negotiation','mediation','diplomacy','abundance','discovery',
    'breakthrough','recovery','prosperity','festival','cure','growth',
    'treaty','rescue','heroic','help','victory','liberation'
  ];

  const negative=['war','conflict','condemn'];

  let base='event-neutral';

  if(stronglyPositive.some(k=>text.includes(k)))base='event-positive';
  else if(stronglyNegative.some(k=>text.includes(k)))base='event-negative';
  else if(positive.some(k=>text.includes(k)))base='event-positive';
  else if(negative.some(k=>text.includes(k)))base='event-negative';
  else if(ev.tone==='breakthrough')base='event-breakthrough';
  else if(ev.tone==='major')base='event-major';
  else if(ev.tone==='crisis')base='event-negative';

  return individualEventVisualClass(ev,base)
}
function organizationEventPolarity(ev){return eventVisualClass(ev)}

function renderSimulation(){
  simState.events??=[];simState.pendingEvents??=[];
  ensurePersistentWorldState();
  for(const ev of simState.events){
    ev.id||='ev'+uid();ev.relatedEvents||=[];
    if(!ev.location)assignEventLocation(ev);
    // Old V20 saves gain persistent state lazily without duplicating timeline entries.
    if(!ev.worldEffectsApplied)registerPersistentEventEffects(ev,simContext())
  }
  expirePersistentWorldEffects();
  const devStage=ensureCivilizationMilestone();

  const ctx=simContext();
  $('simSummary').innerHTML=`<b>${E.esc(simState.civ||'Civilization')}</b> · ${E.esc(simState.era||'Founding')} · ${E.esc(systemScaleLabel())} Scale · Year ${simState.year}. Simulation input: ${ctx.spells.length} spells, ${ctx.classes.length} classes, ${ctx.rules.length} rules, ${ctx.materials.length} materials, ${ctx.tools.length} magical objects, ${ctx.techniques.length} techniques, ${ctx.principles.length} principles, ${ctx.structures.length} structures, ${ctx.life.length} life forms.`;
  $('simPop').textContent=formatHugePopulation(simState.population);$('simStability').textContent=Math.round(simState.stability)+'%';$('simKnowledge').textContent=Math.round(simState.knowledge)+'%';$('simEconomy').textContent=Math.round(simState.economy)+'%';$('simDanger').textContent=Math.round(simState.danger)+'%';$('simTech').textContent=Math.round(simState.technology)+'%';
  renderRapidEvents();
  $('simTimeline').innerHTML=simState.events.length?simState.events.filter(e=>!e.rapidOnly).map((e,i)=>`<div class="sim-event ${e.tone||''} ${organizationEventPolarity(e)} ${simState.selectedEventId===e.id?'selected-event':''} ${historyMapState.enabled&&e.year>historyMapYear()?'history-future-event':''}" data-event="${i}" data-event-id="${E.esc(e.id)}"><div class="sim-year">YEAR ${e.year}<br>${E.esc(e.kind)}</div><div><strong>${renderCivilizationSymbolRichText(e.title)}</strong><p>${renderCivilizationSymbolRichText(e.text)}</p><div class="event-meta-row"><span class="event-location-chip">⌖ ${E.esc(eventLocationLabel(e))}</span>${(e.relatedEvents||[]).length?`<span class="event-related-chip">⟷ ${(e.relatedEvents||[]).length} related</span>`:''}</div>${(e.tags||[]).map(t=>`<span class="sim-tag">${E.esc(t)}</span>`).join('')}</div></div>`).join(''):'<div class="world-section">No major events yet. Advance time to begin the civilization.</div>';
  document.querySelectorAll('.sim-event[data-event]').forEach(el=>el.onclick=()=>inspectEvent(+el.dataset.event));
  const chips=(arr,fn=x=>x)=>arr.length?arr.slice(-14).map(x=>`<span class="world-chip">${E.esc(fn(x))}</span>`).join(''):'<span class="world-chip">None yet</span>';
  const persistent=persistentWorldSummary();
  const resourceCards=persistent.resources.map(r=>`<div class="persistent-state-card"><b>${E.esc(r.name)}</b><span>Availability ${Math.round(r.availability)}%</span><span>Price ${Math.round(r.price)}%</span><span>Extraction ${Math.round(r.extraction)}%</span></div>`).join('')||'<span class="world-chip">No resource disruptions yet</span>';
  const placeCards=persistent.places.map(p=>`<div class="persistent-state-card"><b>${E.esc(p.name)}</b><span>Stability ${Math.round(p.stability)}%</span><span>Danger ${Math.round(p.danger)}%</span><span>Trade ${Math.round(p.trade)}%</span></div>`).join('')||'<span class="world-chip">No localized effects yet</span>';
  $('simWorld').innerHTML=`<div class="development-stage-card"><div class="development-stage-icon">${devStage.icon}</div><div><b>${E.esc(devStage.name)}</b><p>${E.esc(devStage.description)}</p><small>${devStage.structures.map(E.esc).join(' · ')}</small></div></div><div class="world-section v201-world-state"><h3>Persistent World State</h3><div class="persistent-state-grid">${resourceCards}${placeCards}</div></div><div class="world-section"><h3>Institutions</h3>${chips(simState.institutions,x=>x.name)}</div><div class="world-section"><h3>Industries & Infrastructure</h3>${chips(simState.industries)}</div><div class="world-section"><h3>Discoveries</h3>${chips(simState.discoveries)}</div><div class="world-section"><h3>Professions</h3>${simState.professions.map(p=>`<span class="world-chip">${E.esc(p.name)} · ${p.count.toLocaleString()}</span>`).join('')||'<span class="world-chip">None yet</span>'}</div><div class="world-section"><h3>Factions & Debates</h3>${chips(simState.factions)}</div><div class="world-section"><h3>Historical Crises</h3>${chips(simState.crises)}</div>`;

  const harmfulSpells=ctx.spells.filter(s=>(s.morality??0)<-25),helpfulSpells=ctx.spells.filter(s=>(s.morality??0)>25);
  const dominantClasses=[...ctx.classes].slice(0,4);
  const derivedLaws=[...new Set([...harmfulSpells.map(s=>`Restricted use of ${s.name}`),...ctx.rules.slice(0,4).map(r=>`${r.name} influences magical law`)])];
  const education=dominantClasses.map(c=>`${c} studies`).concat(ctx.techniques.slice(0,3).map(t=>`${t.name} training`));
  const ecology=ctx.life.map(l=>`${l.name}: ${l.category||'magical life'}`);
  const organizations=ctx.structures.map(s=>`${s.name}: ${s.category||'structure'}`);
  $('simSociety').innerHTML=`<div class="world-grid">
    <div class="world-section"><h3>⚖ Law & Crime</h3>${chips(derivedLaws)}<p>${harmfulSpells.length} negatively aligned spell(s) currently create pressure for criminal law, restrictions, counter-magic and investigation.</p></div>
    <div class="world-section"><h3>⌂ Everyday Life</h3>${chips(helpfulSpells.map(s=>s.name))}<p>Beneficial magic is more likely to spread into medicine, infrastructure, work, transport, communication and household use.</p></div>
    <div class="world-section"><h3>⌘ Education</h3>${chips(education)}<p>Spell classes and Techniques naturally become subjects, departments, qualifications and specialist careers.</p></div>
    <div class="world-section"><h3>♜ Organizations</h3>${chips(organizations)}<p>Structure nodes are treated as persistent institutions rather than one-off events.</p></div>
    <div class="world-section"><h3>♧ Magical Ecology</h3>${chips(ecology)}<p>Life nodes can create conservation, creature-care, agriculture, ingredient supply and ecological conflicts.</p></div>
    <div class="world-section"><h3>◆ Economy & Objects</h3>${chips(ctx.materials.slice(0,5).map(x=>x.name).concat(ctx.tools.slice(0,5).map(x=>x.name)))}<p>Materials and Magical Objects can create supply chains, professions, workshops, regulation and trade.</p></div>
  </div>`;
  $('simResearch').innerHTML=`<div class="research-grid">${simState.research.length?simState.research.map(r=>`<div class="research-card"><h3>${E.esc(r.title)}</h3><p>${E.esc(r.kind)} · ${E.esc(r.status)}</p><p>${E.esc(r.goal||'')}</p><div class="progress"><i style="width:${r.progress}%"></i></div><p>${Math.round(r.progress)}% complete</p></div>`).join(''):'<div class="research-card"><h3>No research projects yet</h3><p>Projects emerge as the civilization encounters spells, rules, materials, and tools.</p></div>'}</div>`;
  $('simRegions').innerHTML=`<div class="region-grid">${simState.regions.map(r=>`<div class="region-card"><h3>${E.esc(r.name)}</h3><p>${E.esc(r.type)} · Population ${r.population.toLocaleString()}</p><p>Dominant magic: ${E.esc(r.dominantClass||'None yet')}</p><p>Magic ${Math.round(r.magic)}% · Stability ${Math.round(r.stability)}% · Wealth ${Math.round(r.wealth)}%</p></div>`).join('')}</div>`;
  requestAnimationFrame(renderCivGraph)
}

function pulseWeb(){graph.pulseUntil=performance.now()+2500;const sr=rules().map(r=>[r,spells().filter(s=>ruleApplies(r,s)).length]).sort((a,b)=>b[1]-a[1])[0],sc=spells().map(s=>[s,edges.filter(e=>e.a===s.id||e.b===s.id).length]).sort((a,b)=>b[1]-a[1])[0];const box=$('selectionCard');box.classList.remove('hidden');box.innerHTML=`<h3>Magic Web Pulse</h3><p>${sr?`Most influential rule: <b>${E.esc(sr[0].name)}</b> (${sr[1]} spells)`:''}</p><p>${sc?`Most connected spell: <b>${E.esc(sc[0].name)}</b> (${sc[1]} links)`:''}</p>`}


graph.onNodeDragMove=node=>{
  const root=technologyRoot();
  if(root)root.techDropHover=!!(technologySettings.enabled&&node?.id!==TECHNOLOGY_NODE_ID&&(node.type==='magicalObject'||(node.isHub&&node.hubType==='magicalObject'))&&Math.hypot(node.x-root.x,node.y-root.y)<=95);
};
graph.onNodeDragStart=()=>{
  checkpointHistory();
  dragHistoryArmed=true;
};
graph.onNodeDragEnd=(node,moved)=>{
  if(dragHistoryArmed&&moved<1)undoStack.pop();

  if(moved>=1&&technologySettings.enabled&&node?.id!==TECHNOLOGY_NODE_ID){
    const root=technologyRoot();
    if(root&&(node.type==='magicalObject'||(node.isHub&&node.hubType==='magicalObject'))){
      const dropDistance=Math.hypot(node.x-root.x,node.y-root.y);

      if(dropDistance<=95){
        root.techDropHover=false;
        if(node.isHub){
          const cat=node.name;
          node.technological=true;
          nodes.filter(n=>n.type==='magicalObject'&&String(n.category||'').toLowerCase()===String(cat).toLowerCase()).forEach((n,i)=>{
            n.technological=true;
            n.advancement=Number.isFinite(n.advancement)?n.advancement:Math.min(100,20+i*10);
          });
        }else{
          node.technological=true;
          node.advancement=Number.isFinite(node.advancement)?node.advancement:25;
        }
        ensureTechnologyConnections();
        renderTechnologyTree();
      }else if(node.type==='magicalObject'&&node.technological){
        const mana=byId('mana');
        const detachBoundary=(root.y+(mana?.y||0))/2;
        if(node.y>detachBoundary){
          node.technological=false;
          delete node.advancement;
          node.hiddenTechnology=false;
          edges=edges.filter(e=>!(e.techEdge&&(e.a===node.id||e.b===node.id)));
          rebuildEdges();
          node.x=430+(Math.random()-.5)*110;
          node.y=240+(Math.random()-.5)*110;
          node.vx=node.vy=0;
        }
      }
    }
  }

  dragHistoryArmed=false;redoStack=[];updateHistoryButtons();
  ensureTechnologyConnections();renderTechnologyTree();
  graph.setData(nodes.filter(n=>!n.hiddenTechnology),edges.filter(e=>!e.blocked&&byId(e.a)&&byId(e.b)&&!byId(e.a)?.hiddenTechnology&&!byId(e.b)?.hiddenTechnology));
  save();
};
graph.onSelect=selectNode;
graph.onLinkDrop=(a,b)=>openLinkModal(a,b);
graph.onEdgeClick=edge=>{if(edge?.techAdvancement)openAdvancementEditor(edge)};
graph.onEdgeSnip=edge=>{snipEdge(edge)};
graph.onEdgesSnip=batch=>snipEdgesBatch(batch);


// v14 surprise: context-aware inspiration. It fills blank fields only.
const inspiration={
 spell:[
  {eName:'Lumen Veil',eClass:'Charm',eIntent:'Illuminate',eStructure:'Radial field',eTarget:'Area around caster',eOutput:'Soft magical light',eDuration:'Sustained',eRange:'8 m radius',eSource:'Mana',eExtra:'Brightness responds to intent; harmless to living targets'},
  {eName:'Echo Sight',eClass:'Detection',eIntent:'Reveal',eStructure:'Pulse',eTarget:'Hidden enchantments',eOutput:'Visible arcane outlines',eDuration:'0.5 s',eRange:'15 m',eSource:'Mana',eExtra:'Repeated pulses lose accuracy through dense stone'},
  {eName:'Glassward',eClass:'Ward',eIntent:'Protect',eStructure:'Curved barrier',eTarget:'Caster or ally',eOutput:'Transparent force barrier',eDuration:'20 s',eRange:'6 m',eSource:'Mana',eExtra:'Strong against projectiles; weaker against sustained pressure'}
 ],
 rule:[
  {eName:'Law of Arcane Conservation',eRuleClass:'',eText:'Magic may transform energy and matter, but cannot create unlimited usable energy from nothing.',eScope:'all magic',eExceptions:'Temporary violations are possible when drawing from an external magical reservoir.'},
  {eName:'Boundary of Transfiguration',eRuleClass:'Transfiguration',eText:'Transfiguration preserves total mass unless extra matter is supplied.',eScope:'Transfiguration spells',eExceptions:'Conjured mana-matter may temporarily substitute for missing mass.'}
 ],
 material:[{eName:'Moonstone',eCategory:'Crystal',eComposition:'Crystallized mana + lunar mineral',eProperty:'Stores light and detection magic with very low leakage',eRequirements:'Must be refined under moonlight',eUses:'Detection; Charm; Ashwood Wand',eInteraction:'Becomes cloudy after repeated overloads',eDescription:'A pale arcane crystal valued for precise, low-noise spellwork.'}],
 magicalObject:[{eName:'Ashwood Wand',eCategory:'Wand',eComposition:'Ashwood + Moonstone core',eProperty:'Focuses directional and detection spells',eRequirements:'Requires a bonded caster',eUses:'Charm; Detection; Lumen Veil',eInteraction:'A damaged core distorts spell direction',eDescription:'A responsive focus built for precision rather than raw power.'}],
 technique:[{eName:'Silent Casting',eCategory:'Casting Method',eComposition:'Breath control + precise intent shaping',eProperty:'Allows spells to be cast without spoken incantations',eRequirements:'Principle of Resonance; strong concentration',eUses:'Charm; Ward; Detection',eInteraction:'Complex spells require much more concentration',eDescription:'A difficult technique replacing spoken structure with trained mental patterns.'}],
 structure:[{eName:'Arcane Standards Council',eCategory:'Regulatory Organization',eComposition:'Inspectors + researchers + licensed practitioners',eProperty:'Creates safety standards for public magic',eRequirements:'Legal recognition and trained staff',eUses:'Rule; Magical Object; Spell licensing',eInteraction:'May conflict with secretive magical groups',eDescription:'A civic body that emerges when magic becomes widespread.'}],
 life:[
  {eName:'Moonmoss',eCategory:'Magical Plant',eComposition:'Living moss + ambient mana',eProperty:'Glows when exposed to detection magic',eRequirements:'Cool damp habitats',eUses:'Detection; Potion ingredients; research',eInteraction:'Wilts near strong anti-magic fields',eDescription:'A common magical organism used as an environmental mana indicator.',_sentient:false,_main:false,_individual:false},
  {eName:'Vorians',eCategory:'Sentient Magical Species',eComposition:'Living biology + innate resonance sense',eProperty:'Naturally perceives mana-frequency differences',eRequirements:'Habitable settlements and stable mana',eUses:'Vorian; Resonance Relay; magical tools',eInteraction:'Builds organized civilizations and maintains strong trade traditions.',eDescription:'A sentient magical species capable of civilization, diplomacy, language and technological development.',_sentient:true,_main:true,_individual:false},
  {eName:'Aelar Venn',eCategory:'Individual',eComposition:'Sentient magical person',eProperty:'Skilled translator and diplomat',eRequirements:'Vorian; Human Standard',eUses:'Diplomacy; Translation',eInteraction:'Can participate directly in important historical events.',eDescription:'An individual historical figure known for cross-cultural diplomacy.',_sentient:true,_main:false,_individual:true}
 ],
 principle:[{eName:'Principle of Resonance',eCategory:'Fundamental Theory',eComposition:'Mana frequency + sympathetic magical patterns',eProperty:'Similar magical patterns naturally reinforce one another',eRequirements:'Stable mana flow',eUses:'Silent Casting; Moonstone; Charm',eInteraction:'Opposing resonances can weaken or cancel each other',eDescription:'A foundational principle explaining magical compatibility and interference.'}],
 place:[
  {eName:'Lumen',ePlaceType:'City',eInhabitants:'Humans; Aetherians',eGovernment:'Aetherian Crown',eAccess:'Open to citizens and licensed visitors',eAssociations:'Aether Crowns; Aetheric; Moonstone Guild',ePlaceInteraction:'Teleportation is restricted around the central citadel.',eDescription:'A dense magical capital built around ancient resonance towers.'},
  {eName:'Whisperwood',ePlaceType:'Wilderness',eInhabitants:'Moonharts; Glowmoss',eGovernment:'Protected reserve',eAccess:'Permit required beyond marked paths',eAssociations:'Moonhart; Frostlung; Moonstone',ePlaceInteraction:'Ambient mana strengthens living magic after sunset.',eDescription:'A vast enchanted forest used as a protected magical habitat.'}
 ],
 organization:[
  {eName:'Vorian Collective',eOrganizationType:'Federation',eOrganizationPurpose:'Coordinate trade, research and defense between member worlds.',eOrganizationMembers:'8400000',eOrganizationCapital:'Voria',eOrganizationResources:'Crystals; enchanted machinery; research',eDescription:'A cooperative federation whose influence is built on trade and magical research.'},
  {eName:'Arcane Wardens',eOrganizationType:'Order',eOrganizationPurpose:'Protect settlements from dangerous magical phenomena.',eOrganizationMembers:'18000',eOrganizationCapital:'Lumen',eOrganizationResources:'Wards; trained casters; protective artifacts',eDescription:'A transnational magical order specializing in containment and emergency response.'},
  {eName:'Moonstone Exchange',eOrganizationType:'Company',eOrganizationPurpose:'Mine, refine and distribute rare magical materials.',eOrganizationMembers:'62000',eOrganizationCapital:'Silverfall',eOrganizationResources:'Moonstone; freight network; currency reserves',eDescription:'A major magical-material corporation with interests across several regions.'}
 ],
 'civilizationUtil:language':[
  {eName:'Vorian',eLanguageDirection:'Left → Right',eDescription:'A trade language with a compact symbolic script and highly regular pronunciation.',
   _languageGroups:{symbolSymbol:[{from:'A',to:'△'},{from:'V',to:'◇'}],symbolSound:[{from:'△',to:'ah'},{from:'◇',to:'vai'}],wordWord:[{from:'peace',to:'sela'},{from:'trade',to:'vora'}],phrasePhrase:[{from:'safe travels',to:'sela varen'}]}}
 ],
 'civilizationUtil:currency':[
  {eName:'Cuples',eCurrencySymbol:'C',eCurrencyUsd:'2.4',eCurrencySubdivision:'100 Chips = 1 Cuple',eCurrencyForm:'Mixed',eCurrencyStability:'Floating',eCurrencyBacking:'Moonstone reserves',eDescription:'A widely traded currency issued by a network of magical banking guilds.'}
 ],
 'civilizationUtil:disease':[
  {eName:'Frostlung',eDiseaseSpread:'Moderate',eDiseaseSeverity:'Serious',eDiseaseDuration:'Medium',eDiseaseMortality:'18',eDiseaseCure:'Emberroot tonic',eDiseaseOrigin:'Whisperwood',eDescription:'A magical respiratory illness associated with cold, mana-saturated environments.'}
 ],
 'civilizationUtil:calendar':[
  {eName:'Aetherian Calendar',eUtilA:'368',eUtilB:'Dawnmonth; Brightmonth; Embermonth; Frostmonth',eUtilC:'After Founding',eUtilD:'Founding Day; Lantern Night; First Thaw',eDescription:'A civil calendar built around seasonal magical cycles.'}
 ],
 'civilizationUtil:measurement':[
  {eName:'Imperial Arcane Measures',eUtilA:'1 stride = 0.9 m\n1 span = 12 strides',eUtilB:'1 stone = 2.7 kg',eUtilC:'0 Ember = freezing point; 100 Ember = boiling point',eDescription:'A standardized measurement system used in magical engineering and trade.'}
 ],
 'civilizationUtil:legalCode':[
  {eName:'Arcane Civic Code',eUtilA:'Coercive enchantment is prohibited.\nDangerous public casting requires authorization.',eUtilB:'Right to magical education; protection from involuntary mind magic.',eUtilC:'Arcane courts and licensed Wardens',eDescription:'A mature legal system regulating magical practice.'}
 ],
 'civilizationUtil:rankSystem':[
  {eName:'Warden Ranks',eUtilA:'Initiate\nField Warden\nSenior Warden\nCommander\nHigh Warden',eUtilB:'Promotion requires training, field service and examination.',eDescription:'The formal rank structure used by the Arcane Wardens.'}
 ],
 'civilizationUtil:communication':[
  {eName:'Resonance Relay',eUtilA:'Paired enchanted crystals',eUtilB:'Planetary; interstellar with relay stations',eUtilC:'Instant locally; minutes between systems',eDescription:'A magical communications network using synchronized resonance crystals.'}
 ],
 'civilizationUtil:naming':[
  {eName:'Vorian Naming Convention',eUtilA:'Va-, Sel-, Or-, Lum-, -ari, -en',eUtilB:'Family name follows given name; officials add profession title.',eUtilC:'Varen Sel; Lumari Oren; Sela Vael',eDescription:'A naming system that combines a personal root with family and occupational markers.'}
 ]
};
function inspireEditor(){
  let key=editingType;

  if(editingType==='civilizationUtil'){
    const subtype=value('eUtilityType')||window.__pendingCivilizationUtilType||'language';
    key=`civilizationUtil:${subtype}`
  }

  const pool=inspiration[key]||inspiration[editingType]||[];
  if(!pool.length)return;

  const sample=pool[Math.floor(Math.random()*pool.length)];

  for(const [id,text] of Object.entries(sample)){
    if(id.startsWith('_'))continue;
    const el=$(id);
    if(!el)continue;

    // Inspire only fills blank text/numeric fields, but selects are allowed to
    // adopt the inspired value because their defaults otherwise make Inspire
    // look like it did nothing.
    if(el.tagName==='SELECT'){
      if([...el.options].some(o=>o.value===String(text)||o.text===String(text)))el.value=String(text)
    }else if(!String(el.value||'').trim()){
      el.value=text
    }
  }

  if(sample._languageGroups){
    for(const [group,rows] of Object.entries(sample._languageGroups)){
      const box=document.querySelector(`[data-language-section="${group}"] .language-map-rows`);
      if(!box)continue;
      box.innerHTML=rows.map((r,i)=>languageMappingRow(group,r.from,r.to,i)).join('')
    }
    bindLanguageMappingEditor()
  }

  if(sample._sentient!=null&&$('eSentient'))$('eSentient').checked=!!sample._sentient;
  if(sample._main!=null&&$('eMainLife'))$('eMainLife').checked=!!sample._main;
  if(sample._individual!=null&&$('eIndividual'))$('eIndividual').checked=!!sample._individual;

  // Material Inspire can seed a price in every currently authored currency.
  if(editingType==='material'){
    document.querySelectorAll('[data-material-currency]').forEach((el,i)=>{
      if(!String(el.value||'').trim())el.value=String(Math.round(50+Math.random()*950*(i+1)))
    })
  }

  // Organization Inspire also gives relationship sliders varied but sensible
  // starting diplomacy instead of leaving every pair at exactly zero.
  if(editingType==='organization'){
    document.querySelectorAll('.organization-rel-slider').forEach(el=>{
      if(+el.value===0){
        el.value=String(Math.round(Math.random()*120-40));
        el.dispatchEvent(new Event('input',{bubbles:true}))
      }
    })
  }

  const b=$('inspireEditor');
  if(b){b.classList.add('sparked');setTimeout(()=>b.classList.remove('sparked'),450)}
}

function exportProject(){
  const payload={format:'MagicSystemSandbox',version:15,savedAt:new Date().toISOString(),nodes,edges,physicsSettings,autoConnections};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='magic-system-v15.magicgraph';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)
}
async function importProject(file){
  try{
    checkpointHistory();
    const d=JSON.parse(await file.text());if(!Array.isArray(d.nodes))throw new Error('No graph nodes found');

    nodes=d.nodes;
    edges=Array.isArray(d.edges)?d.edges:[];
    nodes.forEach(n=>{
      if(n.type==='tool')n.type='magicalObject';
      if(n.isMegastructure){
        if(n.createdMegastructure===true)n.megaEditorMode='separate';
        else if(!n.megaEditorMode)n.megaEditorMode='attached';
        n.createdMegastructure=n.megaEditorMode==='separate';
      }
    });

    physicsSettings={...physicsSettings,...(d.physicsSettings||{})};
    autoConnections={...autoConnections,...(d.autoConnections||{})};

    // IMPORTANT: imported graphs must never inherit procedural viewer state
    // from whatever graph was loaded previously.
    worldStateCache={maps:{},planets:{}};

    if(typeof simState!=='undefined'){
      simState.spaceMap=null;
      simState.planet=null;
      simState.planetOverride=null;
      simState.locations=[];
    }

    if(typeof scaleNav!=='undefined'){
      scaleNav.level=null;
      scaleNav.path=[];
      scaleNav.camera={x:.5,y:.5,zoom:1};
      scaleNav.selected=null;
      scaleNav.tween=null;
      scaleNav.transitioning=false;
      scaleNav.lastTransitionAt=performance.now();
    }

    restoredWorldState=null;

    selected=null;
    graph.selected=null;
    graph.setPhysicsSettings(physicsSettings);
    rebuildEdges();
    renderLibraries();
    organize();
    graph.fit();
    showSelection();

    // Generate a brand-new hierarchy from the imported graph's authored
    // containment links, then persist that clean state.
    if(typeof generateScaleMap==='function'&&systemScale()!=='planet'){
      generateScaleMap('',true);
    }
    if(typeof refreshWorldMapMode==='function')refreshWorldMapMode();
    if(typeof requestPlanetDraw==='function')requestPlanetDraw();

    save();
  }catch(err){alert('Could not load this graph: '+err.message)}
}
function syncAutoConnectionUI(){
  $('autoConnectionsToggle').textContent=autoConnections.enabled?'ON':'OFF';
  $('autoConnectionsToggle').classList.toggle('off',!autoConnections.enabled);
  $('autoConnectionStatus').textContent=autoConnections.enabled?'Automatic connections are active.':'Automatic connections are off. Manual links remain under your control.'
}
function openAutoConnectionDecision(){
  const turningOff=autoConnections.enabled;
  $('autoConnectionModal').classList.remove('hidden');
  $('autoConnectionTitle').textContent=turningOff?'Turn off Automatic Connections':'Turn on Automatic Connections';
  $('autoConnectionExplain').textContent=turningOff?'Choose what should happen to connections the sandbox already created automatically.':'Choose how automatic connections should resume.';
  const choices=turningOff?[
    ['Keep existing automatic links','Stop generating automatic links, but keep the automatic links already visible.','off-keep'],
    ['Manual links only','Remove automatic links from the visible graph and leave your manual links.','off-manual'],
    ['Delete every connection','Remove manual and automatic links, then turn automatic connections off.','off-all']
  ]:[
    ['Restore all automatic links','Rebuild every automatic relationship implied by the current graph.','on-all'],
    ['Only establish new ones','Keep the current graph as-is; automatic links will be generated as concepts are edited or created from now on.','on-new']
  ];
  $('autoConnectionChoices').innerHTML=choices.map(([a,b,c])=>`<button class="decision-choice" data-autochoice="${c}"><b>${a}</b><span>${b}</span></button>`).join('');
  document.querySelectorAll('[data-autochoice]').forEach(b=>b.onclick=()=>applyAutoChoice(b.dataset.autochoice))
}
function applyAutoChoice(choice){
  checkpointHistory();
  if(choice==='off-keep'){autoConnections={enabled:false,restoreMode:'keep'}}
  if(choice==='off-manual'){edges=edges.filter(e=>e.manual);autoConnections={enabled:false,restoreMode:'manual'}}
  if(choice==='off-all'){edges=[];autoConnections={enabled:false,restoreMode:'manual'}}
  if(choice==='on-all'){autoConnections={enabled:true,restoreMode:'all'};edges=edges.filter(e=>e.manual)}
  if(choice==='on-new'){autoConnections={enabled:true,restoreMode:'new'};edges=edges.filter(e=>e.manual||(!e.manual&&!e.blocked))}
  $('autoConnectionModal').classList.add('hidden');rebuildEdges();syncAutoConnectionUI();save()
}

const uiClickSound=$('uiClickSound');

// V15.4g.1: pooled click audio.
// Reusing a small set of already-loaded Audio objects is more reliable than
// cloning a brand-new <audio> element on every click.
const UI_CLICK_POOL_SIZE=12;
const uiClickPool=[];
let uiClickPoolIndex=0;

if(uiClickSound){
  for(let i=0;i<UI_CLICK_POOL_SIZE;i++){
    const a=new Audio(uiClickSound.src);
    a.preload='auto';
    a.volume=.72;
    // Trigger resource loading immediately.
    try{a.load()}catch(_){}
    uiClickPool.push(a);
  }
}

function playUIClick(){
  if(!uiClickPool.length)return;

  const sound=uiClickPool[uiClickPoolIndex];
  uiClickPoolIndex=(uiClickPoolIndex+1)%uiClickPool.length;

  try{
    // Restart this pool channel from the beginning.
    sound.pause();
    sound.currentTime=0;
    sound.volume=.72;

    const result=sound.play();
    if(result&&typeof result.catch==='function'){
      result.catch(()=>{
        // Retry on a different preloaded channel, never by muting/restarting
        // the same channel that may already be involved in another click.
        setTimeout(()=>{
          const backup=uiClickPool[uiClickPoolIndex];
          uiClickPoolIndex=(uiClickPoolIndex+1)%uiClickPool.length;
          try{
            backup.pause();
            backup.currentTime=0;
            backup.volume=.72;
            backup.play().catch(()=>{});
          }catch(_){}
        },0);
      });
    }
  }catch(_){}
}

// V15.4e.1: play the click sound for a genuine click/tap, but not after dragging.
// Pointer movement beyond the small threshold marks the interaction as a drag.
let uiPointerDown=null;
let uiPointerDragged=false;
const UI_CLICK_DRAG_THRESHOLD=5;

document.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  uiPointerDown={x:e.clientX,y:e.clientY,id:e.pointerId};
  uiPointerDragged=false;
},true);

document.addEventListener('pointermove',e=>{
  if(!uiPointerDown||e.pointerId!==uiPointerDown.id)return;
  if(Math.hypot(e.clientX-uiPointerDown.x,e.clientY-uiPointerDown.y)>UI_CLICK_DRAG_THRESHOLD){
    uiPointerDragged=true;
  }
},true);

document.addEventListener('pointerup',e=>{
  if(!uiPointerDown||e.pointerId!==uiPointerDown.id)return;
  if(!uiPointerDragged)playUIClick();
  uiPointerDown=null;
  uiPointerDragged=false;
},true);

document.addEventListener('pointercancel',()=>{
  uiPointerDown=null;
  uiPointerDragged=false;
},true);


$('undoBtn').onclick=undoHistory;
$('redoBtn').onclick=redoHistory;
$('generateMagicSystem').onclick=generateProceduralMagicSystem;
$('regenPlanet').onclick=()=>{
  if(mapDisplayLevel()==='planet')generatePlanet(true,true);
  else generateScaleMap('',true);
  refreshWorldMapMode();requestPlanetDraw();save()
};
$('planetHome').onclick=()=>{planetView.yaw=0;planetView.pitch=-.12;planetView.zoom=1;planetView.panX=0;planetView.panY=0;requestPlanetDraw()};
window.__pendingCivilizationUtilType=null;
$('createCivilizationUtil')?.addEventListener('click',()=>{
  $('createMenu')?.classList.add('hidden');
  $('civilizationUtilModal')?.classList.remove('hidden')
});
$('closeCivilizationUtil')?.addEventListener('click',()=>$('civilizationUtilModal')?.classList.add('hidden'));
document.querySelectorAll('[data-civ-util]').forEach(btn=>btn.addEventListener('click',()=>{
  window.__pendingCivilizationUtilType=btn.dataset.civUtil;
  $('civilizationUtilModal')?.classList.add('hidden');
  creatingHub=false;
  openEditor('civilizationUtil')
}));
$('openSymbolLibrary')?.addEventListener('click',()=>{
  $('civilizationUtilModal')?.classList.add('hidden');
  $('symbolLibraryModal')?.classList.remove('hidden');
  renderSymbolLibrary()
});
$('closeSymbolLibrary')?.addEventListener('click',()=>{
  $('symbolLibraryModal')?.classList.add('hidden');

  if(editingType==='civilizationUtil'){
    $('editorModal')?.classList.remove('hidden');
    bindCivilizationUtilSymbolPalette();

    if((value('eUtilityType')||window.__pendingCivilizationUtilType)==='language'){
      bindLanguageMappingEditor();
      updateLanguagePreview()
    }
  }
});

const symbolCanvas=$('symbolCanvas');
const symbolCtx=symbolCanvas?.getContext('2d',{willReadFrequently:true});
let symbolDrawing=false;
let symbolTool='brush';
let symbolStart=null;
let symbolSnapshot=null;
let symbolUndoStack=[];
let symbolRedoStack=[];

function symbolCanvasState(){
  return symbolCtx?.getImageData(0,0,symbolCanvas.width,symbolCanvas.height)
}
function restoreSymbolState(state){
  if(state&&symbolCtx)symbolCtx.putImageData(state,0,0)
}
function pushSymbolHistory(){
  const s=symbolCanvasState();if(!s)return;
  symbolUndoStack.push(s);
  if(symbolUndoStack.length>40)symbolUndoStack.shift();
  symbolRedoStack=[]
}
function clearSymbolCanvas(record=false){
  if(!symbolCtx)return;
  if(record)pushSymbolHistory();
  symbolCtx.clearRect(0,0,symbolCanvas.width,symbolCanvas.height)
}
function symbolPoint(ev){
  const r=symbolCanvas.getBoundingClientRect();
  return{
    x:(ev.clientX-r.left)*symbolCanvas.width/r.width,
    y:(ev.clientY-r.top)*symbolCanvas.height/r.height
  }
}
function symbolPaintStyle(){
  symbolCtx.lineWidth=+$('symbolWidth')?.value||10;
  symbolCtx.lineCap='round';symbolCtx.lineJoin='round';
  symbolCtx.strokeStyle=value('symbolColor')||'#f1f5ff';
  symbolCtx.fillStyle=value('symbolColor')||'#f1f5ff'
}
function symbolFloodFill(x,y,color){
  const img=symbolCtx.getImageData(0,0,symbolCanvas.width,symbolCanvas.height);
  const d=img.data,w=img.width,h=img.height;
  x=Math.max(0,Math.min(w-1,Math.floor(x)));y=Math.max(0,Math.min(h-1,Math.floor(y)));
  const idx=(y*w+x)*4,target=[d[idx],d[idx+1],d[idx+2],d[idx+3]];
  const rgb=color.match(/[a-f\d]{2}/gi)?.map(v=>parseInt(v,16))||[241,245,255];
  const repl=[rgb[0],rgb[1],rgb[2],255];
  if(target.every((v,i)=>v===repl[i]))return;
  const stack=[[x,y]],seen=new Uint8Array(w*h);
  while(stack.length){
    const [px,py]=stack.pop(),si=py*w+px;if(seen[si])continue;seen[si]=1;
    const i=si*4;
    if(Math.abs(d[i]-target[0])>8||Math.abs(d[i+1]-target[1])>8||Math.abs(d[i+2]-target[2])>8||Math.abs(d[i+3]-target[3])>8)continue;
    d[i]=repl[0];d[i+1]=repl[1];d[i+2]=repl[2];d[i+3]=repl[3];
    if(px>0)stack.push([px-1,py]);if(px<w-1)stack.push([px+1,py]);
    if(py>0)stack.push([px,py-1]);if(py<h-1)stack.push([px,py+1])
  }
  symbolCtx.putImageData(img,0,0)
}
function renderSymbolPreviewShape(pt){
  if(!symbolSnapshot)return;
  restoreSymbolState(symbolSnapshot);symbolPaintStyle();
  const a=symbolStart,b=pt;if(!a||!b)return;
  symbolCtx.beginPath();
  if(symbolTool==='line'){symbolCtx.moveTo(a.x,a.y);symbolCtx.lineTo(b.x,b.y);symbolCtx.stroke()}
  else if(symbolTool==='rect'){
    symbolCtx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y)
  }else if(symbolTool==='circle'){
    const rx=Math.abs(b.x-a.x),ry=Math.abs(b.y-a.y);
    symbolCtx.ellipse(a.x,a.y,rx,ry,0,0,Math.PI*2);symbolCtx.stroke()
  }
}
document.querySelectorAll('.symbol-tool').forEach(btn=>btn.addEventListener('click',()=>{
  symbolTool=btn.dataset.symbolTool;
  document.querySelectorAll('.symbol-tool').forEach(x=>x.classList.toggle('active',x===btn))
}));
symbolCanvas?.addEventListener('pointerdown',ev=>{
  ev.preventDefault();pushSymbolHistory();
  symbolDrawing=true;symbolStart=symbolPoint(ev);symbolSnapshot=symbolCanvasState();
  symbolCanvas.setPointerCapture(ev.pointerId);
  symbolPaintStyle();
  if(symbolTool==='fill'){
    symbolFloodFill(symbolStart.x,symbolStart.y,value('symbolColor')||'#f1f5ff');
    symbolDrawing=false
  }else if(symbolTool==='eraser'){
    symbolCtx.save();symbolCtx.globalCompositeOperation='destination-out';
    symbolCtx.beginPath();symbolCtx.arc(symbolStart.x,symbolStart.y,(+$('symbolWidth')?.value||10)/2,0,Math.PI*2);symbolCtx.fill();symbolCtx.restore()
  }else if(symbolTool==='brush'){
    symbolCtx.beginPath();symbolCtx.moveTo(symbolStart.x,symbolStart.y)
  }
});
symbolCanvas?.addEventListener('pointermove',ev=>{
  if(!symbolDrawing)return;
  const p=symbolPoint(ev);symbolPaintStyle();
  if(symbolTool==='brush'){symbolCtx.lineTo(p.x,p.y);symbolCtx.stroke()}
  else if(symbolTool==='eraser'){
    symbolCtx.save();symbolCtx.globalCompositeOperation='destination-out';
    symbolCtx.beginPath();symbolCtx.arc(p.x,p.y,(+$('symbolWidth')?.value||10)/2,0,Math.PI*2);symbolCtx.fill();symbolCtx.restore()
  }else renderSymbolPreviewShape(p)
});
symbolCanvas?.addEventListener('pointerup',ev=>{
  if(!symbolDrawing)return;
  if(['line','rect','circle'].includes(symbolTool))renderSymbolPreviewShape(symbolPoint(ev));
  symbolDrawing=false;symbolStart=null;symbolSnapshot=null
});
$('symbolUndo')?.addEventListener('click',()=>{
  if(!symbolUndoStack.length)return;
  const current=symbolCanvasState();if(current)symbolRedoStack.push(current);
  restoreSymbolState(symbolUndoStack.pop())
});
$('symbolRedo')?.addEventListener('click',()=>{
  if(!symbolRedoStack.length)return;
  const current=symbolCanvasState();if(current)symbolUndoStack.push(current);
  restoreSymbolState(symbolRedoStack.pop())
});
$('clearSymbol')?.addEventListener('click',()=>clearSymbolCanvas(true));
$('symbolImportButton')?.addEventListener('click',()=>$('symbolImport')?.click());
$('symbolImport')?.addEventListener('change',ev=>{
  const file=ev.target.files?.[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    const img=new Image();img.onload=()=>{
      pushSymbolHistory();symbolCtx.clearRect(0,0,256,256);
      const scale=Math.min(256/img.width,256/img.height);
      const w=img.width*scale,h=img.height*scale;
      symbolCtx.drawImage(img,(256-w)/2,(256-h)/2,w,h)
    };img.src=reader.result
  };reader.readAsDataURL(file);ev.target.value=''
});
function renderSymbolLibrary(){
  const box=$('symbolLibraryList');if(!box)return;
  box.innerHTML=civilizationSymbols.length?civilizationSymbols.map(s=>`
    <div class="symbol-library-item"><img src="${s.data}"><div><b>${E.esc(s.name)}</b><small>${E.esc(s.id)}</small></div><button data-delete-symbol="${s.id}" class="danger">×</button></div>
  `).join(''):'<div class="auto-empty">No reusable symbols yet.</div>';
  box.querySelectorAll('[data-delete-symbol]').forEach(b=>b.onclick=()=>{
    civilizationSymbols=civilizationSymbols.filter(s=>s.id!==b.dataset.deleteSymbol);
    saveCivilizationSymbols();renderSymbolLibrary()
  })
}
$('saveSymbol')?.addEventListener('click',()=>{
  const name=value('symbolName').trim();if(!name||!symbolCanvas)return;
  civilizationSymbols.push({id:'sym_'+uid(),name,data:symbolCanvas.toDataURL('image/png')});
  saveCivilizationSymbols();$('symbolName').value='';clearSymbolCanvas(false);symbolUndoStack=[];symbolRedoStack=[];renderSymbolLibrary()
});

$('createBtn').onclick=()=>{const menu=$('createMenu'),toggle=$('createHubToggle');menu.classList.toggle('hidden');if(!menu.classList.contains('hidden')&&toggle){toggle.checked=false;toggle.disabled=false}};
document.querySelectorAll('[data-create]').forEach(b=>b.onclick=()=>{
  creatingHub=b.dataset.create!=='spell'&&!!$('createHubToggle')?.checked;
  openEditor(b.dataset.create);
});
$('editBtn').onclick=()=>{if(selected&&selected.type!=='classPoint'&&selected.type!=='technologyRoot')openEditor(selected.type,selected)};
$('deleteBtn').onclick=()=>{
  if(selected?.id===TECHNOLOGY_NODE_ID){resetTechnology();return}
  deleteSelected()
};
$('cloneBtn').onclick=cloneSelected;
$('organizeBtn').onclick=()=>{organize();graph.fit()};$('fitBtn').onclick=()=>graph.fit();$('inspectBtn').onclick=showSelection;$('connectionsBtn').onclick=openConnections;$('pulseBtn').onclick=pulseWeb;
$('freezeBtn').onclick=()=>{
  graph.setFrozen(!graph.frozen);
  $('freezeBtn').classList.toggle('freeze-active',graph.frozen);
  $('freezeBtn').querySelector('span').textContent=graph.frozen?'Unfreeze':'Freeze';
};
function syncSettingsUI(){
  if($('technologyToggle')){
    $('technologyToggle').textContent=technologySettings.enabled?'ON':'OFF';
    $('technologyToggle').classList.toggle('off',!technologySettings.enabled);
    $('technologyStatus').textContent=technologySettings.enabled?'Technology simulation is active.':'Technology is preserved but ignored by simulation.';
  }
  $('pullStrengthSlider').value=Math.round(physicsSettings.pullStrength*100);
  $('largeGraphSlider').value=Math.round(physicsSettings.largeGraphScale*100);
  $('collisionStrength').value=String(physicsSettings.collisionStrength);
  $('globalRulePull').value=String(physicsSettings.globalRulePull);
  $('pullStrengthValue').textContent=Math.round(physicsSettings.pullStrength*100)+'%';
  $('largeGraphValue').textContent=Math.round(physicsSettings.largeGraphScale*100)+'%';
}
$('settingsBtn').onclick=()=>{syncSettingsUI();syncAutoConnectionUI();$('settingsModal').classList.remove('hidden')};
$('saveProjectBtn').onclick=exportProject;
$('loadProjectBtn').onclick=()=>$('loadProjectInput').click();
$('loadProjectInput').onchange=e=>{const f=e.target.files?.[0];if(f)importProject(f);e.target.value=''};
$('technologyToggle').onclick=()=>{
  technologySettings.enabled=!technologySettings.enabled;
  if(technologySettings.enabled){
    for(const n of technologyNodes())n.hiddenTechnology=false;
    ensureTechnologyRoot();
    ensureTechnologyConnections();
  }else{
    nodes=nodes.filter(n=>n.id!==TECHNOLOGY_NODE_ID&&n.type!=='technologySpinePoint');
    edges=edges.filter(e=>!e.techEdge&&e.a!==TECHNOLOGY_NODE_ID&&e.b!==TECHNOLOGY_NODE_ID);
    for(const n of technologyNodes())n.hiddenTechnology=true;
  }
  syncSettingsUI();
  renderTechnologyTree();
  save();
};
$('resetTechnologyBtn')?.addEventListener('click',resetTechnology);
$('autoConnectionsToggle').onclick=openAutoConnectionDecision;
$('closeAutoConnection').onclick=()=>$('autoConnectionModal').classList.add('hidden');
$('auditBtn').onclick=systemAudit;$('closeAudit').onclick=()=>$('auditModal').classList.add('hidden');

$('closeSimulation').onclick=()=>setSimulationWorkspaceOpen(false);
$('closePlaceInspector')?.addEventListener('click',()=>{
  $('placeInspector')?.classList.add('hidden');
  document.querySelector('.civilization-stage')?.classList.remove('event-inspector-open');
  forceSimulationViewerLayout()
});
$('closeSimulationInspector')?.addEventListener('click',()=>{
  $('simulationInspector')?.classList.add('hidden');
  document.querySelector('.civilization-stage')?.classList.remove('event-inspector-open');
  forceSimulationViewerLayout()
});
$('closeEventInspector')?.addEventListener('click',()=>{
  setSimulationSideTab(simulationSideBeforeEvent||'world',{remember:false});
  forceSimulationViewerLayout()
});



$('closeSettings').onclick=()=>$('settingsModal').classList.add('hidden');
$('pullStrengthSlider').oninput=()=>{$('pullStrengthValue').textContent=$('pullStrengthSlider').value+'%'};
$('largeGraphSlider').oninput=()=>{$('largeGraphValue').textContent=$('largeGraphSlider').value+'%'};
$('saveSettings').onclick=()=>{
  physicsSettings={
    pullStrength:+$('pullStrengthSlider').value/100,
    largeGraphScale:+$('largeGraphSlider').value/100,
    collisionStrength:+$('collisionStrength').value,
    globalRulePull:+$('globalRulePull').value
  };
  graph.setPhysicsSettings(physicsSettings);save();$('settingsModal').classList.add('hidden')
};
$('resetPhysics').onclick=()=>{
  physicsSettings={pullStrength:1,largeGraphScale:1,collisionStrength:1,globalRulePull:.375};
  graph.setPhysicsSettings(physicsSettings);syncSettingsUI()
};
$('linkBtn').onclick=()=>{
  graph.setLinkMode(!graph.linkMode);
  $('linkBtn').classList.toggle('active',graph.linkMode);
};
$('closeEditor').onclick=closeEditor;$('cancelEditor').onclick=closeEditor;$('saveEditor').onclick=saveEditor;
// Civilization Utils have their own save route, independent of the generic editor.
document.addEventListener('click',ev=>{
  const saveBtn=ev.target.closest?.('#saveEditor');
  if(!saveBtn||editingType!=='civilizationUtil')return;

  ev.preventDefault();
  ev.stopImmediatePropagation();

  try{
    const ok=saveCivilizationUtilEditor();
    if(!ok){
      saveBtn.textContent='Name required';
      setTimeout(()=>{saveBtn.textContent='Save'},1000)
    }
  }catch(err){
    console.error('Civilization Utility save failed:',err);
    saveBtn.textContent='Save failed';
    setTimeout(()=>{saveBtn.textContent='Save'},1200)
  }
},true);


$('previewAutoConnections').onclick=openAutoConnections;
$('closeAutoConnections').onclick=()=>$('autoConnectionsPanel').classList.add('hidden');
$('closePlanetPalette').onclick=()=>$('planetPalettePanel').classList.add('hidden');
$('closeSolarSystemEditor').onclick=()=>$('solarSystemEditorPanel').classList.add('hidden');
$('closeStarEditor').onclick=()=>$('starEditorPanel').classList.add('hidden');
$('closeMegastructureEditor').onclick=()=>$('megastructureEditorPanel').classList.add('hidden');
$('chooseSeparateMega').onclick=()=>setMegaEditorMode('separate',editingId?byId(editingId):null);
$('chooseAttachedMega').onclick=()=>setMegaEditorMode('attached',editingId?byId(editingId):null);
$('refreshAutoConnections').onclick=()=>{pendingConnectionPlan=inferDraftConnections();renderConnectionPlan()};$('inspireEditor').onclick=inspireEditor;
$('closeLink').onclick=()=>{$('linkModal').classList.add('hidden');resetLinkModalMode()};$('cancelLink').onclick=()=>{$('linkModal').classList.add('hidden');resetLinkModalMode();graph.setLinkMode(false);$('linkBtn').classList.remove('active')};$('saveLink').onclick=saveLink;
$('saveAdvancement').onclick=saveAdvancement;
$('cancelAdvancement').onclick=()=>{$('advancementModal').classList.add('hidden')};
$('closeAdvancement').onclick=()=>{$('advancementModal').classList.add('hidden')};
$('linkType').addEventListener('change',refreshRelationshipLinkUI);
$('linkRelationship')?.addEventListener('input',refreshRelationshipLinkUI);
$('linkRelationshipKind')?.addEventListener('change',refreshRelationshipLinkUI);
$('closeConnections').onclick=()=>$('connectionsModal').classList.add('hidden');document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{activeSystemTab=t.dataset.tab;renderLibraries()});

window.addEventListener('resize',()=>{if(!$('simulationModal').classList.contains('hidden'))requestPlanetDraw()});
window.addEventListener('keydown',e=>{
  const typing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  if(typing)return;
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&!e.shiftKey&&e.key.toLowerCase()==='z'){
    e.preventDefault();undoHistory();
  }else if((mod&&e.key.toLowerCase()==='y')||(mod&&e.shiftKey&&e.key.toLowerCase()==='z')){
    e.preventDefault();redoHistory();
  }
});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(document.body.classList.contains('simulation-map-fullscreen')){setSimulationMapFullscreen(false);return}graph.setLinkMode(false);$('linkBtn').classList.remove('active');document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));document.body.classList.remove('simulation-workspace-open')}if((e.key==='Delete'||e.key==='Backspace')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){if(selected?.id===TECHNOLOGY_NODE_ID)resetTechnology();else deleteSelected()}});


function mountSimulationAtViewportRoot(){
  const modal=$('simulationModal');
  if(!modal)return;

  if(modal.parentElement!==document.body){
    document.body.appendChild(modal)
  }
}

function mountSimulationDialogsAtViewportRoot(){
  const manual=$('manualEventModal');
  if(manual&&manual.parentElement!==document.body){
    document.body.appendChild(manual)
  }
}

function setSimulationWorkspaceOpen(open){
  mountSimulationAtViewportRoot();

  document.body.classList.toggle('simulation-workspace-open',!!open);

  const modal=$('simulationModal');
  if(modal)modal.classList.toggle('hidden',!open);

  if(open){
    requestAnimationFrame(()=>{
      forceSimulationViewerLayout();
      requestPlanetDraw()
    })
  }
}

mountSimulationAtViewportRoot();
mountSimulationDialogsAtViewportRoot();

// One delegated Event Creator trigger survives all viewport-root reparenting.
document.addEventListener('click',ev=>{
  const trigger=ev.target.closest?.('#createTimelineEvent,#manualEventInline');
  if(!trigger)return;

  ev.preventDefault();
  ev.stopPropagation();
  openManualEventCreator()
},true);

$('simulateBtn').onclick=()=>{setSimulationWorkspaceOpen(true);if(!simState.civ)startSimulation();else renderSimulation()};
$('simulateBtn').addEventListener('click',()=>{
  scaleNav.level=systemScale();scaleNav.path=[];scaleNav.camera={x:.5,y:.5,zoom:1};scaleNav.transitioning=false;scaleNav.lastTransitionAt=performance.now();simState.planetOverride=null;
  if(systemScale()==='planet')ensurePlanet();else ensureScaleMap();
  refreshWorldMapMode();bindPlanetControls();setTimeout(requestPlanetDraw,60)
});
$('closeSimulation').onclick=()=>{
  setSimulationWorkspaceOpen(false);
  if(simAutoTimer){
    clearInterval(simAutoTimer);
    simAutoTimer=null;
    $('simAuto').textContent='▶ Auto'
  }
};
$('runSimulation').onclick=startSimulation;
$('runSimulation').addEventListener('click',()=>{generatePlanet();setTimeout(drawPlanet,50)});
function openManualEventCreator(){
  mountSimulationAtViewportRoot();
  mountSimulationDialogsAtViewportRoot();

  const modal=$('manualEventModal');
  if(!modal){
    console.warn('Manual Event Creator modal was not found.');
    return
  }

  if(!simState.civ)startSimulation();

  document.body.classList.add('manual-event-open');
  modal.classList.remove('hidden');
  modal.style.display='flex';
  modal.setAttribute('aria-hidden','false');
  $('manualEventYear').value=simState.year||0;
  $('manualEventTitle').value='';
  $('manualEventText').value='';
  $('manualEventLocation').innerHTML='<option value="">Automatic / none</option>'+
    ofType('place').map(p=>`<option value="${p.id}">${E.esc(p.name)}</option>`).join('');
  const picker=$('manualEventNodes');
  picker.innerHTML=nodes.filter(n=>!['mana','classPoint','technologyRoot'].includes(n.type)).map(n=>
    `<label><input type="checkbox" class="manual-event-node" value="${n.id}"><span>${E.esc(n.name)}</span><small>${E.esc(n.type)}</small></label>`
  ).join('');
  modal.classList.remove('hidden')
}
function saveManualTimelineEvent(){
  const title=value('manualEventTitle').trim(),text=value('manualEventText').trim();
  if(!title||!text)return;
  const refs=[...document.querySelectorAll('.manual-event-node:checked')].map(x=>byId(x.value)).filter(Boolean);
  const ev=event(
    value('manualEventKind')||'Historical Event',
    title,text,
    [...refs.map(n=>n.name),'Manual Event'],
    {
      population:(+value('manualImpactPopulation')||0)/100,
      stability:+value('manualImpactStability')||0,
      economy:+value('manualImpactEconomy')||0,
      knowledge:+value('manualImpactKnowledge')||0,
      danger:+value('manualImpactDanger')||0,
      technology:+value('manualImpactTechnology')||0
    },
    value('manualEventTone')||'normal',
    [
      'Authored manually by the user.',
      refs.length?`Participants: ${refs.map(n=>n.name).join(', ')}`:'No explicit participants.'
    ]
  );
  const authoredYear=+value('manualEventYear')||simState.year||0;
  ev.year=authoredYear;
  ev.manual=true;
  ev.relatedNodeIds=refs.map(n=>n.id);
  const loc=byId(value('manualEventLocation'));
  if(loc?.type==='place'){
    ev.location={sourceId:loc.id,name:loc.name,pathIds:physicalPlacePath(loc).map(p=>p.id),mapLevel:placeMapLevel(loc)}
  }
  applyImpact(ev);updateWorldFromEvent(ev);commitSimulationEvent(ev,simContext());
  simState.events.sort((a,b)=>a.year-b.year);

  if(authoredYear>simState.year){
    simState.year=authoredYear;
    historyMapState.year=authoredYear;
  }

  const manualModal=$('manualEventModal');
  manualModal.classList.add('hidden');
  manualModal.style.display='none';
  manualModal.setAttribute('aria-hidden','true');
  document.body.classList.remove('manual-event-open');
  syncHistoryMapUI();
  renderSimulation();
  focusEventOnTimeline(ev,{openInspector:true})
}

function closeManualEventCreator(){
  const modal=$('manualEventModal');
  modal?.classList.add('hidden');
  if(modal){
    modal.style.display='none';
    modal.setAttribute('aria-hidden','true')
  }
  document.body.classList.remove('manual-event-open')
}
if($('closeManualEvent'))$('closeManualEvent').onclick=closeManualEventCreator;
if($('cancelManualEvent'))$('cancelManualEvent').onclick=closeManualEventCreator;
$('saveManualEvent')?.addEventListener('click',saveManualTimelineEvent);
function setSimulationMapFullscreen(open){
  const dock=$('simMapDock');
  if(!dock)return;

  dock.classList.toggle('fullscreen-map',!!open);
  document.body.classList.toggle('simulation-map-fullscreen',!!open);

  $('closeSimMapFullscreen')?.classList.toggle('hidden',!open);
  $('toggleSimMap')?.classList.toggle('hidden',!!open);

  // V22.2 renderer owns the canvas dimensions.
  requestAnimationFrame(()=>{
    requestPlanetDraw();
    forceSimulationViewerLayout()
  });
  setTimeout(requestPlanetDraw,60)
}

$('toggleSimMap')?.addEventListener('click',()=>setSimulationMapFullscreen(true));
$('closeSimMapFullscreen')?.addEventListener('click',()=>setSimulationMapFullscreen(false));

$('toggleRapidEvents')?.addEventListener('click',()=>{
  $('rapidEventsPanel')?.classList.toggle('collapsed');
  $('toggleRapidEvents').textContent=$('rapidEventsPanel')?.classList.contains('collapsed')?'+':'−'
});

$('simStep1').onclick=()=>advanceSimulation(1);
$('simStep10').onclick=()=>advanceSimulation(10);
$('simStep100').onclick=()=>advanceSimulation(100);
$('simStep1000').onclick=()=>advanceSimulation(1000);
$('simAuto').onclick=()=>{
  if(simAutoTimer){clearInterval(simAutoTimer);simAutoTimer=null;$('simAuto').textContent='▶ Auto'}
  else{simAutoTimer=setInterval(()=>advanceSimulation(5),700);$('simAuto').textContent='⏸ Pause'}
};
let simulationSideTab='world';
let simulationSideBeforeEvent='world';

function setSimulationSideTab(target,{remember=true}={}){
  if(!['world','society','research','event'].includes(target))target='world';

  if(target==='event'&&simulationSideTab!=='event'){
    simulationSideBeforeEvent=simulationSideTab||'world'
  }

  simulationSideTab=target;

  document.querySelectorAll('.sim-side-tab').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.simSide===target)
  });

  const panels={
    world:$('simWorld'),
    society:$('simSociety'),
    research:$('simResearch'),
    event:$('eventInspector')
  };

  Object.entries(panels).forEach(([name,el])=>{
    el?.classList.toggle('hidden',name!==target)
  });

  const titles={
    world:'World Analysis',
    society:'Society',
    research:'Research',
    event:'Event Inspector'
  };
  if($('simInspectorTitle'))$('simInspectorTitle').textContent=titles[target];

  if(remember&&target!=='event'){
    simulationSideBeforeEvent=target
  }
}

document.querySelectorAll('.sim-side-tab').forEach(btn=>{
  btn.onclick=()=>setSimulationSideTab(btn.dataset.simSide)
});

setSimulationSideTab('world',{remember:false});

$('resetSystemBtn').onclick=()=>{
  const withTech=!!technologySettings.enabled;
  const ok=confirm(withTech
    ? 'Reset to MANA + TECHNOLOGY? This removes all created content and custom connections.'
    : 'Reset to MANA? This removes all created content and custom connections.');
  if(!ok)return;

  checkpointHistory();
  if(simAutoTimer){clearInterval(simAutoTimer);simAutoTimer=null}
  localStorage.removeItem('magicSandboxV8');
  localStorage.removeItem('magicSandboxV6');

  nodes=[{id:'mana',type:'mana',name:'MANA',x:0,y:0,vx:0,vy:0,r:45,fixed:true,description:'The magical source from which this system grows.'}];
  edges=[];

  if(withTech){
    nodes.push({id:TECHNOLOGY_NODE_ID,type:'technologyRoot',name:'TECHNOLOGY',x:0,y:-620,vx:0,vy:0,r:30,fixed:true,hubVisual:true,hubType:'technology',technological:true,hiddenTechnology:false,description:'Civilization technology branches upward from Mana.'});
    edges.push({id:uid(),a:'mana',b:TECHNOLOGY_NODE_ID,type:'technology',linkType:'dependency',label:'technology',direction:'forward',techEdge:true,techRootEdge:true,strength:'solid',thickness:2});
  }

  selected=null;graph.selected=null;graph.setData(nodes,edges);graph.setFrozen(false);
  simState={year:0,events:[],civ:'',era:'Founding',population:100000,stability:70,knowledge:5,economy:15,danger:5,technology:4,institutions:[],discoveries:[],industries:[],crises:[],laws:[],factions:[],regions:[],research:[],professions:[],civNodes:[],civEdges:[],chainState:{},technologyTimeline:[],techDiscoveries:[]};
  save();renderLibraries();showSelection();updateStats();graph.fit();
};

historyRestoring=true;
load();graph.setPhysicsSettings(physicsSettings);rebuildEdges();normalizeMoonEdgesVisualOnly();ensureMoonOrbitConnections();if(technologySettings.enabled)ensureTechnologyConnections();renderLibraries();renderTechnologyTree();organize();graph.setData(nodes.filter(n=>!n.hiddenTechnology),edges.filter(e=>!e.blocked&&byId(e.a)&&byId(e.b)&&!byId(e.a)?.hiddenTechnology&&!byId(e.b)?.hiddenTechnology));graph.fit();graph.draw();
historyRestoring=false;undoStack=[];redoStack=[];updateHistoryButtons();
})();