(()=>{
const $=id=>document.getElementById(id),E=window.MagicEditors;
let nodes=[],edges=[],selected=null,activeSpellClass='All',activeSystemTab='rules',editingId=null,editingType=null,creatingHub=false,pendingConnectionPlan=null;
let physicsSettings={pullStrength:1,largeGraphScale:1,collisionStrength:1,globalRulePull:.375};
let autoConnections={enabled:true,restoreMode:'all'};
let technologySettings={enabled:false};
const MAGIC_CREATOR_TYPES=[
  ['spell','Spell','✦','Castable magic with class, intent, structure, morality and effects.'],
  ['rule','Rule','◇','Laws, restrictions, exceptions, and class-specific behavior.'],
  ['material','Material','◆','Magical substances, ingredients, metals, woods and crystals.'],
  ['magicalObject','Magical Object','⌁','Wands, artifacts, focuses, enchanted devices and relics.'],
  ['technique','Technique','⟡','Casting methods, disciplines, movements and trained skills.'],
  ['principle','Principle','◈','Underlying magical theories and fundamental behavior.'],
  ['structure','Structure','▦','Schools, governments, guilds, ministries, academies and organizations.'],
  ['organization','Organization','♜','Empires, governments, guilds, companies, orders, alliances and factions.'],
  ['civilizationUtil','Civilization Utils','⌘','Languages, currencies, diseases, calendars, measurements, laws, ranks and shared systems.'],
  ['life','Life','♧','Magical species, creatures, plants, beings and magical biology.'],
  ['place','Place','⌖','Cities, worlds, dimensions, buildings, landmarks and regions.']
];
const MAGIC_LINK_TYPES=['direct','dependency','influence','relationship','similarity','composition','restriction','opposition','flow','reference','creation','transformation','containment','amplification','cancellation'];
function freshMagicCreator(){return {
  preset:'magic',name:'Magic System',title:'Magic System Sandbox',version:1,
  categories:[
    {id:'magic',label:'Magic',color:'#8aa4ff'},
    {id:'world',label:'World',color:'#78d7b0'},
    {id:'society',label:'Society',color:'#e5b86a'},
    {id:'connections',label:'Connections',color:'#b59cff'}
  ],
  nodeTypes:MAGIC_CREATOR_TYPES.map(([id,label,icon,description])=>({id,label,icon,description,enabled:true,builtin:true,useGeneratedEditor:false,fields:[],category:['spell','rule','technique','principle'].includes(id)?'magic':['structure','organization','civilizationUtil'].includes(id)?'society':'world'})),
  linkTypes:MAGIC_LINK_TYPES.map(id=>({id,label:id[0].toUpperCase()+id.slice(1),enabled:true,category:'connections',style:'solid',thickness:1.6,color:'#cfd7ff',matchMode:'contains'})),
  timelineRules:[]
}}
let creatorSettings=freshMagicCreator();
let creatorDraft=null;
const graph=new window.MagicGraph($('graph'));

const HISTORY_LIMIT=100;
let undoStack=[],redoStack=[],historyRestoring=false,dragHistoryArmed=false;

function historyState(){
  return {
    nodes:JSON.parse(JSON.stringify(nodes)),
    edges:JSON.parse(JSON.stringify(edges)),
    physicsSettings:JSON.parse(JSON.stringify(physicsSettings)),
    autoConnections:JSON.parse(JSON.stringify(autoConnections)),
    creatorSettings:JSON.parse(JSON.stringify(creatorSettings)),
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
  if(state.creatorSettings)creatorSettings=normalizeCreatorSettings(state.creatorSettings);
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
function upgradeCandidateNodes(){
  return nodes.filter(n=>!n.isHub&&(n.type==='material'||n.type==='magicalObject'||n.type==='tool'))
}
function upgradeItemKind(n){
  if(!n)return 'Item';
  if(n.type==='material')return 'Material';
  if(n.isComponent)return 'Component';
  if(n.type==='tool')return 'Tool';
  return 'Magical Object'
}
function upgradeRelationMessages(kind){
  const map={
    Upgrade:['upgrades into','upgraded from'],
    Refinement:['refines into','refined from'],
    Enchantment:['enchants into','enchanted from'],
    Infusion:['infuses into','infused from'],
    Transmutation:['transmutes into','transmuted from'],
    Empowerment:['empowers into','empowered from'],
    Evolution:['evolves into','evolved from'],
    Modification:['modifies into','modified from']
  };
  return map[kind]||['becomes','comes from']
}
function ensureMaterialUpgradeComparePanel(){
  let p=$('materialUpgradeComparePanel');if(p)return p;
  p=document.createElement('aside');p.id='materialUpgradeComparePanel';p.className='material-upgrade-compare-panel detached-editor-panel hidden';
  p.innerHTML=`<div class="material-upgrade-compare-head"><div><div class="eyebrow">Progression tools</div><h3>Upgrade</h3></div><button id="closeMaterialUpgradeCompare" class="icon-btn">×</button></div>
    <p>Select one or more predecessors and successors. Every predecessor will link into every successor, so several inputs can converge on the same result.</p>
    <div class="upgrade-multi-grid">
      <label><span>Predecessors</span><select id="upgradePredecessors" multiple size="7"></select><small>Ctrl/Cmd-click to select several.</small></label>
      <div class="upgrade-flow-mark">→</div>
      <label><span>Successors</span><select id="upgradeSuccessors" multiple size="7"></select><small>Ctrl/Cmd-click to select several.</small></label>
    </div>
    <label class="upgrade-relation-kind">Relationship<select id="upgradeRelationKind"><option value="Upgrade">Upgrade</option><option value="Refinement">Refinement</option><option value="Enchantment">Enchantment</option><option value="Infusion">Infusion</option><option value="Transmutation">Transmutation</option><option value="Empowerment">Empowerment</option><option value="Evolution">Evolution</option><option value="Modification">Modification</option></select></label>
    <div id="upgradeSingleMessageWrap" class="upgrade-single-message">
      <label>Connection message<input id="upgradeSingleMessage" type="text" maxlength="80" placeholder="upgrades into"></label>
    </div>
    <div id="upgradeDualMessageWrap" class="upgrade-message-grid hidden">
      <label>Predecessor-side message<input id="upgradePredecessorMessage" type="text" maxlength="80" placeholder="upgrades into"></label>
      <label>Successor-side message<input id="upgradeSuccessorMessage" type="text" maxlength="80" placeholder="upgraded from"></label>
    </div>
    <div id="materialUpgradeCompareResult" class="material-upgrade-compare-result"></div>
    <div class="material-upgrade-actions"><button id="createUpgradeLink" class="primary">Link Selected</button><button id="clearPairUpgrade" class="ghost">Unlink Selected</button></div>`;
  document.body.appendChild(p);prepareDetachedEditorPanel(p,p.querySelector('.material-upgrade-compare-head'));
  $('closeMaterialUpgradeCompare').onclick=()=>p.classList.add('hidden');
  $('upgradePredecessors').onchange=renderMaterialUpgradeCompare;$('upgradeSuccessors').onchange=renderMaterialUpgradeCompare;
  $('upgradeRelationKind').onchange=()=>{applyUpgradeMessageDefaults(true);renderMaterialUpgradeCompare()};
  $('upgradeSingleMessage').oninput=renderMaterialUpgradeCompare;$('upgradePredecessorMessage').oninput=renderMaterialUpgradeCompare;$('upgradeSuccessorMessage').oninput=renderMaterialUpgradeCompare;
  $('createUpgradeLink').onclick=createMaterialUpgradeLink;$('clearPairUpgrade').onclick=clearMaterialUpgradePair;
  return p
}
function selectedUpgradeIds(id){
  const el=$(id);return el?[...el.selectedOptions].map(o=>o.value).filter(Boolean):[]
}
function applyUpgradeMessageDefaults(force=false){
  const relation=$('upgradeRelationKind')?.value||'Upgrade',defs=upgradeRelationMessages(relation),single=$('upgradeSingleMessage'),a=$('upgradePredecessorMessage'),b=$('upgradeSuccessorMessage');
  if(single&&(force||!single.value.trim()))single.value=defs[0];
  if(a&&(force||!a.value.trim()))a.value=defs[0];
  if(b&&(force||!b.value.trim()))b.value=defs[1]
}
function populateMaterialUpgradeCompare(){
  const items=upgradeCandidateNodes(),opts=items.map(n=>`<option value="${n.id}">${E.esc(n.name||'Unnamed')} · ${E.esc(upgradeItemKind(n))}</option>`).join('');
  const a=$('upgradePredecessors'),b=$('upgradeSuccessors'),oldA=new Set(selectedUpgradeIds('upgradePredecessors')),oldB=new Set(selectedUpgradeIds('upgradeSuccessors'));
  a.innerHTML=opts;b.innerHTML=opts;
  if(oldA.size)[...a.options].forEach(o=>o.selected=oldA.has(o.value));else if(a.options[0])a.options[0].selected=true;
  if(oldB.size)[...b.options].forEach(o=>o.selected=oldB.has(o.value));else if(b.options[1])b.options[1].selected=true;else if(b.options[0])b.options[0].selected=true;
  applyUpgradeMessageDefaults(false);renderMaterialUpgradeCompare()
}
function upgradeSelectedGroups(){
  const predecessors=selectedUpgradeIds('upgradePredecessors').map(byId).filter(Boolean),successors=selectedUpgradeIds('upgradeSuccessors').map(byId).filter(Boolean);
  const pairs=[];for(const base of predecessors)for(const up of successors)if(base.id!==up.id)pairs.push({base,up});
  return {predecessors,successors,pairs}
}
function renderMaterialUpgradeCompare(){
  const host=$('materialUpgradeCompareResult');if(!host)return;const g=upgradeSelectedGroups();
  const oneToOne=g.predecessors.length===1&&g.successors.length===1&&g.pairs.length===1;
  $('upgradeSingleMessageWrap')?.classList.toggle('hidden',!oneToOne);
  $('upgradeDualMessageWrap')?.classList.toggle('hidden',oneToOne);
  if(!g.predecessors.length||!g.successors.length){host.innerHTML='<strong>Select both sides.</strong><small>Choose at least one predecessor and one successor.</small>';return}
  if(!g.pairs.length){host.innerHTML='<strong>No valid links.</strong><small>The same item cannot link to itself.</small>';return}
  const relation=$('upgradeRelationKind')?.value||'Upgrade',defs=upgradeRelationMessages(relation),single=$('upgradeSingleMessage')?.value.trim()||defs[0],pm=$('upgradePredecessorMessage')?.value.trim()||defs[0],sm=$('upgradeSuccessorMessage')?.value.trim()||defs[1];
  const left=g.predecessors.map(n=>E.esc(n.name)).join(', '),right=g.successors.map(n=>E.esc(n.name)).join(', ');
  host.innerHTML=oneToOne
    ?`<strong>1 connection will be created.</strong><small>${left} → ${right} · ${E.esc(relation)}</small><div class="upgrade-chain">Message: <b>${E.esc(single)}</b></div>`
    :`<strong>${g.pairs.length} connections will be created.</strong><small>${left} → ${right} · ${E.esc(relation)}</small><div class="upgrade-chain">Near predecessor: <b>${E.esc(pm)}</b> · Near successor: <b>${E.esc(sm)}</b></div>`
}
function createMaterialUpgradeLink(){
  const g=upgradeSelectedGroups();if(!g.pairs.length)return;checkpointHistory();
  const oneToOne=g.predecessors.length===1&&g.successors.length===1&&g.pairs.length===1;
  const relation=$('upgradeRelationKind')?.value||'Upgrade',defs=upgradeRelationMessages(relation),single=$('upgradeSingleMessage')?.value.trim()||defs[0],pm=$('upgradePredecessorMessage')?.value.trim()||defs[0],sm=$('upgradeSuccessorMessage')?.value.trim()||defs[1];
  const pairKeys=new Set(g.pairs.map(({base,up})=>`${base.id}::${up.id}`));
  edges=edges.filter(e=>!((e.type==='materialUpgrade'||e.type==='upgrade'||e.progressionRelation)&&pairKeys.has(`${e.a}::${e.b}`)));
  for(const {base,up} of g.pairs){
    const edge={id:uid(),a:base.id,b:up.id,type:'upgrade',progressionRelation:true,upgradeRelation:relation,linkType:'relationship',label:oneToOne?single:relation,direction:'forward',manual:true,strength:'solid',thickness:1.8};
    if(!oneToOne){edge.predecessorMessage=pm;edge.successorMessage=sm}
    edges.push(edge)
  }
  for(const up of g.successors){
    const ids=g.predecessors.filter(n=>n.id!==up.id).map(n=>n.id);up.upgradeFromIds=[...new Set([...(Array.isArray(up.upgradeFromIds)?up.upgradeFromIds:[]),...ids])];
    if(ids.length===1){up.upgradeFromId=ids[0];up.upgradeRelation=relation;if(up.type==='material'){up.materialUpgradeFromId=ids[0];up.materialUpgradeQty=Math.max(1,+up.materialUpgradeQty||1)}}
    else if(ids.length>1){up.upgradeFromId='';if(up.type==='material')up.materialUpgradeFromId=''}
  }
  pruneGenericRelatedToEdges();save();graph.setData(nodes.filter(n=>!n.hiddenTechnology),edges.filter(e=>!e.blocked&&byId(e.a)&&byId(e.b)));graph.draw();renderMaterialUpgradeCompare()
}
function clearMaterialUpgradePair(){
  const g=upgradeSelectedGroups();if(!g.pairs.length)return;checkpointHistory();const pairKeys=new Set(g.pairs.map(({base,up})=>`${base.id}::${up.id}`));
  edges=edges.filter(e=>!((e.type==='materialUpgrade'||e.type==='upgrade'||e.progressionRelation)&&pairKeys.has(`${e.a}::${e.b}`)));
  for(const up of g.successors){const remove=new Set(g.predecessors.map(n=>n.id));up.upgradeFromIds=(Array.isArray(up.upgradeFromIds)?up.upgradeFromIds:[]).filter(id=>!remove.has(id));if(remove.has(up.upgradeFromId)){up.upgradeFromId='';up.upgradeRelation=''}if(up.type==='material'&&remove.has(up.materialUpgradeFromId))up.materialUpgradeFromId=''}
  save();graph.setData(nodes.filter(n=>!n.hiddenTechnology),edges.filter(e=>!e.blocked&&byId(e.a)&&byId(e.b)));graph.draw();renderMaterialUpgradeCompare()
}
$('openMaterialUpgradeCompare')?.addEventListener('click',()=>{const p=ensureMaterialUpgradeComparePanel();p.classList.remove('hidden');populateMaterialUpgradeCompare();requestAnimationFrame(()=>keepDetachedPanelOnscreen(p))});

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
function v287pProjectNodesForSave(){
  return nodes.map(n=>{
    const out=deepCloneState(n);
    if(out?.type==='structure'&&!out.isMegastructure&&out.structureModel){
      out.structureModel=scene3DModelForSave(normalizeScene3DModel(out.structureModel))
    }
    return out
  })
}
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
    format:'MagicSystemSandbox',
    version:'28.7bl',
    schemaVersion:28950,
    nodes:v287pProjectNodesForSave(),edges,physicsSettings,autoConnections,technologySettings,creatorSettings,
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
      if(d.creatorSettings)creatorSettings=normalizeCreatorSettings(d.creatorSettings);
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
function mentions(a,b){const hay=[a.name,a.description,a.property,a.category,a.interaction,a.composition,a.requirements,a.method,a.theory,a.extra,a.source,a.output,a.structure,a.uses,a.sourceDetail,...Object.values(a.creatorFields||{})].join(' ').toLowerCase();return tokenize(b.name).some(t=>hay.includes(t))}
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
  const aText=[a.description,a.property,a.category,a.interaction,a.composition,a.requirements,a.method,a.theory,a.extra,a.source,a.output,a.structure,a.uses,a.sourceDetail,...Object.values(a.creatorFields||{})].join(' ').toLowerCase();
  const bText=[b.description,b.property,b.category,b.interaction,b.composition,b.requirements,b.method,b.theory,b.extra,b.source,b.output,b.structure,b.uses,b.sourceDetail,...Object.values(b.creatorFields||{})].join(' ').toLowerCase();
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
  if(a.type==='material'&&a.variantOfMaterialId===b.id)return 'variant of';
  if(b.type==='material'&&b.variantOfMaterialId===a.id)return 'has variant';
  if(a.type==='life'&&a.individual&&[a.familyParent1Id,a.familyParent2Id].includes(b.id))return 'family: child of';
  if(b.type==='life'&&b.individual&&[b.familyParent1Id,b.familyParent2Id].includes(a.id))return 'family: parent of';
  if(a.type==='life'&&a.familyPartnerId===b.id)return 'family: partner';
  if(b.type==='magicalObject'&&a.type==='material'&&String(b.composition||'').toLowerCase().includes(String(a.name||'').toLowerCase()))return 'made of';
  if((a.type==='technique'&&b.type==='principle')||(b.type==='technique'&&a.type==='principle'))return 'based on';
  if((a.type==='principle'&&b.type==='magicalObject')||(b.type==='principle'&&a.type==='magicalObject'))return 'governs';
  if((a.type==='magicalObject'&&b.type==='technique')||(b.type==='magicalObject'&&a.type==='technique'))return 'used by';
  return 'related to';
}
function pruneGenericRelatedToEdges(){
  const norm=v=>String(v||'').trim().toLowerCase();
  const pairKey=e=>[String(e.a||''),String(e.b||'')].sort().join('::');
  const specificPairs=new Set();
  for(const e of edges){
    if(!e||e.blocked)continue;
    if(norm(e.label)!=='related to')specificPairs.add(pairKey(e));
  }
  edges=edges.filter(e=>{
    if(!e||e.blocked)return true;
    return !(norm(e.label)==='related to'&&specificPairs.has(pairKey(e)));
  });
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
  syncNodeCategoryHierarchy();
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

  const extras=nodes.filter(n=>!['mana','spell','rule','classPoint','technologyRoot'].includes(n.type)&&!n.virtual);

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

  applyCreatorAutomaticLinks();

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

  // V28.3: Planet-position links are authoritative graph relationships.
  // rebuildEdges used to discard the v28.2 edge immediately after Save.
  edges=edges.filter(e=>!e.placePlanetLocation);
  for(const place of nodes.filter(n=>n.type==='place'&&n.surfacePlanetId)){
    const planet=byId(place.surfacePlanetId);
    if(!planet||planet.type!=='place'||planet.id===place.id)continue;
    edges.push({id:uid(),a:place.id,b:planet.id,type:'relationship',linkType:'relationship',label:'Is located in',direction:'forward',manual:false,strength:'solid',thickness:1.6,placePlanetLocation:true});
  }
  edges=edges.filter(e=>!e.placeStructureRepeatLink);
  for(const place of nodes.filter(n=>n.type==='place')){
    const included=new Set([...(place.placeStructureIds||[]),...v283PlaceStructurePool(place).map(s=>s.id)]);
    for(const sid of included){
      const structure=byId(sid);if(!structure||structure.type!=='structure')continue;
      edges.push({id:uid(),a:place.id,b:structure.id,type:'relationship',linkType:'relationship',label:'Repeats structure',direction:'forward',manual:false,strength:'solid',thickness:1.45,placeStructureRepeatLink:true})
    }
  }

  // Generic "related to" is only a fallback. If the same pair has any
  // more specific visible relationship, keep the specific label and remove
  // the generic one so labels never overlap or compete.
  pruneGenericRelatedToEdges();
  graph.setData(nodes,edges.filter(e=>!e.blocked));save();updateStats();
}
function classNames(){return [...new Set(spells().map(s=>s.spellClass||'Unclassified'))].sort()}
function renderLibraries(){
  const customMode=creatorSettings.preset!=='magic';
  const leftTitle=$('leftLibraryTitle'),rightTitle=$('rightLibraryTitle'),tabs=$('systemLibraryTabs'),filters=$('classFilters'),list=$('spellList'),sys=$('systemList');
  if(customMode){
    if(leftTitle)leftTitle.textContent='Creator Nodes';if(rightTitle)rightTitle.textContent='All Nodes';if(tabs)tabs.classList.add('hidden');if(filters)filters.classList.add('hidden');
    const authored=nodes.filter(n=>!['mana','classPoint','technologyRoot'].includes(n.type)&&!n.virtual);
    $('spellCount').textContent=authored.length;$('systemCount').textContent=authored.length;
    list.innerHTML='';authored.forEach(n=>{const el=document.createElement('div');el.className='library-item'+(selected===n?' selected':'');el.innerHTML=`<strong>${E.esc(n.name)}</strong><small>${E.esc(creatorType(n.type)?.label||n.type)}</small>`;el.onclick=()=>selectNode(n);el.ondblclick=()=>openEditor(n.type,n);list.appendChild(el)});
    sys.innerHTML='';creatorSettings.nodeTypes.filter(t=>t.enabled!==false).forEach(t=>{const count=nodes.filter(n=>n.type===t.id&&!n.isHub&&!n.virtual).length;const el=document.createElement('div');el.className='library-item creator-type-summary';el.innerHTML=`<strong>${E.esc(t.icon||'◆')} ${E.esc(t.label)}</strong><small>${count} node${count===1?'':'s'} · ${t.useGeneratedEditor||!t.builtin?'Generated editor':'Native editor'}</small>`;sys.appendChild(el)});
    return
  }
  if(leftTitle)leftTitle.textContent='Spells';if(rightTitle)rightTitle.textContent='System';if(tabs)tabs.classList.remove('hidden');if(filters)filters.classList.remove('hidden');
  $('spellCount').textContent=spells().length;$('systemCount').textContent=nodes.filter(n=>!['mana','spell','classPoint'].includes(n.type)).length;
  filters.innerHTML='';['All',...classNames()].forEach(c=>{const b=document.createElement('button');b.className='class-chip'+(activeSpellClass===c?' active':'');b.textContent=c;b.onclick=()=>{activeSpellClass=c;renderLibraries()};filters.appendChild(b)});
  list.innerHTML='';spells().filter(s=>activeSpellClass==='All'||(s.spellClass||'Unclassified')===activeSpellClass).forEach(s=>{const el=document.createElement('div');el.className='library-item'+(selected===s?' selected':'');el.innerHTML=`<strong>${E.esc(s.name)}</strong><small>${E.esc(s.spellClass||'Unclassified')} · ${E.esc(s.intent||'No intent')}</small>`;el.onclick=()=>selectNode(s);el.ondblclick=()=>openEditor('spell',s);list.appendChild(el)});
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===activeSystemTab));
  sys.innerHTML='';let shown=activeSystemTab==='rules'?rules():activeSystemTab==='materials'?ofType('material'):nodes.filter(n=>['magicalObject','technique','principle','structure','organization','civilizationUtil','life','place'].includes(n.type));
  shown.forEach(n=>{const el=document.createElement('div');el.className='library-item'+(selected===n?' selected':'');el.innerHTML=`<strong>${E.esc(n.name)}</strong><small>${E.esc(creatorType(n.type)?.label||n.type)}${n.strength?' · '+E.esc(n.strength):''}</small>`;el.onclick=()=>selectNode(n);el.ondblclick=()=>openEditor(n.type,n);sys.appendChild(el)})
}
function updateStats(){
  const concepts=nodes.filter(n=>n.type!=='classPoint').length;
  $('systemStats').textContent=creatorSettings.preset==='magic'?`${concepts} concepts · ${edges.length} links · ${classNames().length} spell classes`:`${concepts} nodes · ${edges.length} links · ${creatorSettings.nodeTypes.filter(t=>t.enabled!==false).length} node types`
}
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
  if(selected.type==='spell'){box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Class:</b> ${E.esc(selected.spellClass||'Unclassified')}</p><p><b>Intent:</b> ${E.esc(selected.intent)}</p><p><b>Structure:</b> ${E.esc(selected.structure)}</p><p><b>Output:</b> ${E.esc(selected.output)}</p>${selected.failOutput?`<p><b>Fail output:</b> ${E.esc(selected.failOutput)}</p>`:''}<p><b>Target:</b> ${E.esc(selected.target)}</p><p><b>Good / Bad:</b> ${(selected.morality??0)>0?'+':''}${selected.morality??0}</p>`;return}
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
    const parents=[selected.familyParent1Id,selected.familyParent2Id].map(byId).filter(Boolean);
    const partner=selected.familyPartnerId?byId(selected.familyPartnerId):null;
    const children=nodes.filter(x=>x.type==='life'&&x.individual&&(x.familyParent1Id===selected.id||x.familyParent2Id===selected.id));
    const family=selected.individual&&selected.familyEnabled?`<div class="selection-family"><p><b>Family:</b></p>${parents.length?`<p><b>Parent${parents.length>1?'s':''}:</b> ${E.esc(parents.map(x=>x.name).join(', '))}</p>`:''}${partner?`<p><b>Partner:</b> ${E.esc(partner.name)}</p>`:''}${children.length?`<p><b>Children:</b> ${E.esc(children.map(x=>x.name).join(', '))}</p>`:''}${!parents.length&&!partner&&!children.length?'<p>No family links yet.</p>':''}</div>`:'';
    box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Life role:</b> ${E.esc(role)}</p>${morality}<p><b>Category:</b> ${E.esc(selected.category||'Life')}</p>${family}<p>${E.esc(selected.description||selected.property||'')}</p><button class="selection-inspect-btn" data-sim-inspect="${selected.id}">Simulation Inspector</button>`;
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
  if(selected.type==='civilizationUtil'){
    const subtype=utilitySubtypeLabel(selected.utilityType||'Utility');
    const genome=selected.utilityType==='disease'&&(selected.diseaseKind||'Disease')==='Disease'?normalizePathogenGenome(selected.diseaseGenome||''):'';
    box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>${E.esc(subtype)}${selected.utilityType==='disease'?' · '+E.esc(selected.diseaseKind||'Disease'):''}</b></p>${selected.utilityType==='disease'?`<p><b>Severity:</b> ${E.esc(selected.diseaseSeverity||'—')} · <b>Spread:</b> ${E.esc(selected.diseaseSpread||'—')}</p>${genome?`<p><b>Genetic structure:</b></p><div class="dna-viewer-six">${pathogenGeneChunks(genome).map((x,i)=>`<span class="dna-viewer-strand"><small>${i+1}</small>${pathogenViewerHelixMarkup(x,pathogenGeneChunks(pathogenComplement(genome))[i])}</span>`).join('')}</div><p class="dna-viewer-flaws">${(()=>{const st=pathogenGenomeStats(genome);return `<b>${st.flaws}</b> genetic flaws · ${st.missing} missing · ${st.corrupt} corrupted U`})()}</p>`:''}`:''}<p>${E.esc(selected.description||'')}</p>`;
    return
  }
  if(selected.type==='place'){
    const base=selected.variantOfPlaceId?byId(selected.variantOfPlaceId):null,model=normalizeScene3DModel(selected.placeModel),instances=scene3DRepeatInstances(model).length;
    box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Place type:</b> ${E.esc(selected.placeType||selected.category||'Place')}</p>${base?`<p><b>Variant of:</b> ${E.esc(base.name)}</p>`:''}<p><b>3D model:</b> ${model.variants.length} variant${model.variants.length===1?'':'s'} · ${instances} instance${instances===1?'':'s'} · ${E.esc(model.environment)}</p><p><b>Inhabitants:</b> ${E.esc(selected.inhabitants||'Unspecified')}</p><p><b>Authority:</b> ${E.esc(selected.government||'Unspecified')}</p><p>${E.esc(selected.description||'')}</p><button class="selection-inspect-btn" data-sim-inspect="${selected.id}">Simulation Inspector</button>`;
    box.querySelector('[data-sim-inspect]')?.addEventListener('click',()=>openSimulationInspector(selected));
    return
  }
  if(selected.type==='material'){
    const texPreview=materialTexturePreviewPixels(selected.materialTexture,32),px=texPreview.pixels,rar=materialRarityInfo(selected.materialRarity??55,selected.name||'This material');
    const variantBase=selected.variantOfMaterialId?byId(selected.variantOfMaterialId):null;
    box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Material</b> · ${E.esc(selected.category||'Uncategorized')} · <b>${E.esc(rar.tier)}</b></p>${variantBase?`<p><b>Variant of:</b> ${E.esc(variantBase.name)}</p>`:''}<div class="material-texture-mini" style="--material-preview-size:${texPreview.size}">${px.map(c=>`<i style="background:${/^#[0-9a-f]{6}$/i.test(c)?c:'transparent'}"></i>`).join('')}</div><p class="material-rarity-inspect">${E.esc(rar.comparison)}</p><p>${E.esc(selected.description||selected.property||'')}</p>`;return
  }
  if(selected.type==='magicalObject'){
    const recipe=selected.craftingRecipe||{ingredients:[]},names=(recipe.ingredients||[]).map(i=>{const n=byId(i.nodeId);return n?`${compactMaterialQuantity(i.qty||1)}× ${n.name}`:''}).filter(Boolean);
    box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Magical Object${selected.isComponent?' · Component':''}</b>${selected.technological?' · Technological':''}</p>${names.length?`<p><b>Crafting:</b> ${E.esc(names.join(' + '))}</p>`:''}<p>${E.esc(selected.description||selected.property||'')}</p>`;return
  }
  if(selected.type==='structure'&&!selected.isMegastructure){
    const base=selected.variantOfStructureId?byId(selected.variantOfStructureId):null,model=normalizeScene3DModel(selected.structureModel),instances=scene3DRepeatInstances(model).length;
    box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Structure</b></p>${base?`<p><b>Variant of:</b> ${E.esc(base.name)}</p>`:''}<p><b>3D model:</b> ${model.variants.length} variant${model.variants.length===1?'':'s'} · ${instances} instance${instances===1?'':'s'} · ${E.esc(model.environment)}</p><p>${E.esc(selected.description||selected.property||'')}</p>`;return
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
  if(type==='spell')Object.assign(d,{spellClass:value('eClass')||'Unclassified',intent:value('eIntent'),structure:value('eStructure'),target:value('eTarget'),output:value('eOutput'),duration:value('eDuration'),range:value('eRange'),source:value('eSource')||'Mana',failOutput:value('eFailOutput'),extra:value('eExtra')});
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
  const plan=[],add=(target,label,type='uses',reason='Matched the information in this node with an existing graph concept.')=>{
    if(!target||target.id===editingId||plan.some(p=>p.targetId===target.id&&p.label===label))return;
    plan.push({targetId:target.id,label,type,direction:'forward',reason});
  };
  const mana=byId('mana');
  const mentionsMana=[d.uses,d.compatibility,d.requirements,d.composition,d.source].some(v=>fieldParts(v).includes('mana')||String(v||'').trim().toLowerCase()==='mana');
  if(d.type==='spell'||mentionsMana)add(mana,d.type==='spell'?'derived from Mana':'compatible with Mana',d.type==='spell'?'mana':'uses',d.type==='spell'?'Every Spell is automatically rooted in Mana.':'A field explicitly mentions Mana, so the sandbox treats Mana as a dependency/compatibility source.');

  if(d.type==='spell'){
    const cls=String(d.spellClass||'Unclassified').toLowerCase();
    for(const s of spells())if(s.id!==editingId&&String(s.spellClass||'Unclassified').toLowerCase()===cls)add(s,'same Spell Class: '+d.spellClass,'similar',`Both spells use the Spell Class “${d.spellClass||'Unclassified'}”, so they are grouped as class-similar.`);
  }else if(d.type==='rule'){
    const hub=hubForName(d.spellClass)||hubForName(d.scope);
    if(hub)add(hub,'governs '+hub.name,'applies',`The Rule's class/scope exactly matches the Hub “${hub.name}”.`);
    else{
      const cp=classPointFor(d.spellClass);
      if(cp)add(cp,'governs entire Spell Class','applies',`The Rule targets the entire “${d.spellClass}” Spell Class, so it connects to that class point instead of every spell individually.`);
      else for(const id of d.spellIds||[])add(byId(id),'governs selected spell','applies','This spell was explicitly selected in the Rule editor.');
    }
  }else{
    const hub=hubForName(d.category)||hubForName(d.uses)||hubForName(d.compatibility);
    if(hub)add(hub,fieldParts(d.category).includes(String(hub.name).toLowerCase())?'category: '+hub.name:'compatible with '+hub.name,'hubmember',fieldParts(d.category).includes(String(hub.name).toLowerCase())?`Category exactly matches the Hub “${hub.name}”.`:`A relationship field explicitly references the Hub “${hub.name}”.`);

    if(d.type==='place'){
      for(const p of ofType('place')){
        if(p.id===editingId)continue;
        const pname=String(p.name||'').trim().toLowerCase();
        const mentioned=[d.uses,d.associations,d.compatibility,d.description,d.interaction].some(v=>fieldParts(v).includes(pname)||String(v||'').toLowerCase().includes(pname));
        if(!mentioned)continue;
        const draftRank=PLACE_LEVELS.findIndex(([v])=>v===String(d.placeScale||inferPlaceScale(d.placeType)).toLowerCase());
        const targetRank=placeRank(p);
        if(draftRank>targetRank)add(p,'contains','contains',`“${p.name}” is mentioned by this Place and is a smaller place scale, so it is inferred to be contained here.`);
        else if(targetRank>draftRank)add(p,'located in','contains',`“${p.name}” is mentioned by this Place and is a larger place scale, so this Place is inferred to be located inside it.`);
      }
    }

    for(const n of nodes){
      if(n.id===editingId||n.type==='classPoint'||n.type==='mana'||n.isHub)continue;
      if(resourceRelation(d,n)||semanticScore(d,n)>=4){
        const resource=resourceRelation(d,n);
        const score=semanticScore(d,n);
        add(n,relationLabel(d,n),'related',resource?`A resource/requirement/usage field directly overlaps with “${n.name}”.`:`Semantic match score ${score} reached the auto-link threshold of 4 from shared terms across description, category, composition, requirements, uses, or interaction.`);
      }
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
      <div class="auto-connection-reason"><span>WHY</span>${E.esc(p.reason||'Matched the current node fields to this graph concept using the automatic connection rules.')}</div>
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
function systemScaleLabel(level=systemScale()){return({planet:'Planet',solar:'Solar System',galaxy:'Galaxy',universe:'Universe',surface:'Surface',place:'Place'})[level]||'Planet'}
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
  const cur=String(current||'').toLowerCase(),
        allowed=allowedPlaceLevels(),
        currentRank=PLACE_LEVELS.findIndex(x=>x[0]===cur),
        allowedRank=allowed.length?PLACE_LEVELS.findIndex(x=>x[0]===allowed[allowed.length-1][0]):-1,
        levels=currentRank>allowedRank?PLACE_LEVELS.slice(0,currentRank+1):allowed;
  // Never silently downgrade an existing large Place just because the current creation cap is lower.
  return levels.map(([v,l])=>`<option value="${v}" ${cur===v?'selected':''}>${l}</option>`).join('');
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

function placeAllows3DModel(place){
  const scale=String(place?.placeScale||inferPlaceScale(place?.placeType||place?.category||'')).toLowerCase(),country=PLACE_LEVELS.findIndex(x=>x[0]==='country'),rank=PLACE_LEVELS.findIndex(x=>x[0]===scale);
  return rank<0||rank<country
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


// ===================== V22.8f CENTERED EDITOR SCALER =====================
const EDITOR_VIEWPORT_MARGIN=18;
const EDITOR_MIN_SCALE=.46;

function editorNaturalSize(){
  const shell=$('editorModal')?.querySelector('.editor-shell');
  if(!shell)return{width:650,height:720};

  // Measure at 1:1 before applying scale.
  const previous=shell.style.transform;
  shell.style.transform='translate(-50%,-50%) scale(1)';

  const width=Math.max(
    1,
    shell.scrollWidth,
    shell.offsetWidth,
    shell.getBoundingClientRect().width
  );
  const height=Math.max(
    1,
    shell.scrollHeight,
    shell.offsetHeight,
    shell.getBoundingClientRect().height
  );

  shell.style.transform=previous;
  return{width,height}
}

function fitEditorToViewport(){
  const modal=$('editorModal');
  const shell=modal?.querySelector('.editor-shell');
  if(!modal||!shell||modal.classList.contains('hidden'))return;

  // Always anchor the shell at the exact viewport center.
  shell.style.position='absolute';
  shell.style.left='50%';
  shell.style.top='50%';
  shell.style.right='auto';
  shell.style.bottom='auto';
  shell.style.margin='0';
  shell.style.transformOrigin='center center';

  // First measure the editor at natural authored size.
  shell.style.transform='translate(-50%,-50%) scale(1)';
  const natural=editorNaturalSize();

  const availableW=Math.max(1,window.innerWidth-EDITOR_VIEWPORT_MARGIN*2);
  const availableH=Math.max(1,window.innerHeight-EDITOR_VIEWPORT_MARGIN*2);

  const scale=Math.max(
    EDITOR_MIN_SCALE,
    Math.min(
      1,
      availableW/natural.width,
      availableH/natural.height
    )
  );

  shell.dataset.editorScale=scale.toFixed(4);
  shell.style.setProperty('--editor-fit-scale',String(scale));
}

let editorFitRAF=0;
function requestEditorFit(){
  cancelAnimationFrame(editorFitRAF);
  editorFitRAF=requestAnimationFrame(fitEditorToViewport)
}

window.addEventListener('resize',requestEditorFit);
window.addEventListener('orientationchange',()=>setTimeout(requestEditorFit,60));
const editorLayoutObserver=new MutationObserver(()=>{
  if(!$('editorModal')?.classList.contains('hidden')){
    requestEditorFit();
    requestAnimationFrame(bindDraggableEditorPanels);
    requestAnimationFrame(bindGlobalDraggableMenus)
  }
});
if($('editorModal')){
  editorLayoutObserver.observe($('editorModal'),{
    subtree:true,
    attributes:true,
    attributeFilter:['class','style']
  })
}

const globalMenuDragObserver=new MutationObserver(()=>requestAnimationFrame(bindGlobalDraggableMenus));
globalMenuDragObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
requestAnimationFrame(bindGlobalDraggableMenus);


// ===================== V22.8h STABLE DRAGGABLE UI PANELS =====================
const draggablePanelState=new WeakMap();

function panelDragOffset(panel){
  return{
    x:+panel.dataset.dragX||0,
    y:+panel.dataset.dragY||0
  }
}

function applyPanelDragTransform(panel){
  const {x,y}=panelDragOffset(panel);
  panel.style.setProperty('--panel-drag-x',`${x}px`);
  panel.style.setProperty('--panel-drag-y',`${y}px`)
}

function clampPanelDrag(panel,nextX,nextY){
  const current=panelDragOffset(panel);
  const rect=panel.getBoundingClientRect();

  // Work out where the panel would land if we change from the current offset
  // to the proposed offset.
  let left=rect.left+(nextX-current.x);
  let top=rect.top+(nextY-current.y);
  let right=left+rect.width;
  let bottom=top+rect.height;

  const pad=8;
  const vw=window.innerWidth;
  const vh=window.innerHeight;

  if(left<pad)nextX+=pad-left;
  if(top<pad)nextY+=pad-top;
  if(right>vw-pad)nextX-=right-(vw-pad);
  if(bottom>vh-pad)nextY-=bottom-(vh-pad);

  return{x:nextX,y:nextY}
}


/* ===== v28 floating role controller + detached editor focus ===== */
function ensureHubRolePanel(){
  let panel=$('hubRolePanel');if(panel)return panel;
  panel=document.createElement('aside');panel.id='hubRolePanel';panel.className='hub-role-panel detached-editor-panel hidden';
  panel.innerHTML=`
    <div class="hub-role-panel-head"><div><div class="eyebrow">Node Role</div><b>Graph Level</b></div><button type="button" id="closeHubRolePanel" class="icon-btn" title="Hide role controller">×</button></div>
    <div id="hubRoleRail" class="hub-role-rail" data-role="normal">
      <div class="hub-role-rail-label hub-label">Hub</div>
      <div class="hub-role-track">
        <button type="button" class="hub-role-stop stop-hub" data-hub-role="hub" aria-label="Hub"></button>
        <button type="button" class="hub-role-stop stop-semi" data-hub-role="semi" aria-label="Semi-Hub"></button>
        <button type="button" class="hub-role-stop stop-normal" data-hub-role="normal" aria-label="Node"></button>
        <div id="hubRoleThumb" class="hub-role-thumb" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="2" aria-valuenow="0" aria-label="Node role"></div>
      </div>
      <div class="hub-role-rail-label semi-label">Semi-Hub</div>
      <div class="hub-role-rail-label node-label">Node</div>
    </div>
    <small class="hub-role-panel-help">Drag this window anywhere. The slider changes the currently edited node between Hub, Semi-Hub, and Node.</small>`;
  document.body.appendChild(panel);
  makePanelDraggable(panel,panel.querySelector('.hub-role-panel-head'));
  $('closeHubRolePanel').onclick=()=>panel.classList.add('hidden');
  return panel
}
function showHubRolePanel(role='normal'){
  const panel=ensureHubRolePanel(),rail=$('hubRoleRail');panel.classList.remove('hidden');panel.dataset.dragX=panel.dataset.dragX||'0';panel.dataset.dragY=panel.dataset.dragY||'0';
  rail.dataset.role=role;rail.style.removeProperty('--hub-role-drag-y');
  const thumb=$('hubRoleThumb'),order=['normal','semi','hub'],idx=Math.max(0,order.indexOf(role));thumb?.setAttribute('aria-valuenow',String(idx));thumb?.setAttribute('aria-valuetext',role==='hub'?'Hub':role==='semi'?'Semi-Hub':'Node');
  rail.querySelectorAll('[data-hub-role]').forEach(stop=>stop.classList.toggle('active',stop.dataset.hubRole===role));
  requestAnimationFrame(()=>keepDetachedPanelOnscreen(panel));return panel
}
function hideHubRolePanel(){$('hubRolePanel')?.classList.add('hidden')}
function installDetachedEditorFocus(panel,head){
  if(!panel||!head||panel.dataset.focusInstalled==='1')return;panel.dataset.focusInstalled='1';
  const actions=head.querySelector('.special-editor-window-actions')||head.querySelector('.editor-window-actions')||head;
  const button=document.createElement('button');button.type='button';button.className='icon-btn detached-focus-btn';button.title='Focus / fullscreen';button.textContent='⛶';
  button.onclick=e=>{e.stopPropagation();panel.classList.toggle('detached-editor-maximized');button.textContent=panel.classList.contains('detached-editor-maximized')?'🗗':'⛶';panel.dataset.dragX='0';panel.dataset.dragY='0';applyPanelDragTransform(panel);requestAnimationFrame(()=>keepDetachedPanelOnscreen(panel))};
  const close=actions.querySelector('button:last-child');if(close&&actions!==head)actions.insertBefore(button,close);else actions.appendChild(button)
}
function prepareDetachedEditorPanel(panel,head){
  if(!panel)return panel;if(head){makePanelDraggable(panel,head);head.addEventListener('dblclick',e=>{if(e.target.closest('button,input,select,textarea'))return;const b=panel.querySelector('.detached-focus-btn');b?.click()})}installDetachedEditorFocus(panel,head);return panel
}



/* ============================ V28 SHARED 3D SCENE MODELLER ============================ */
/*
  This is a real WebGL modelling viewport shared by Places and non-megastructure
  Structures.  It deliberately stays dependency-free so exported projects keep
  working offline.
*/
let placeModelDraft=null,structureModelDraft=null;
let scene3DModel=null,scene3DTargetNode=null,scene3DTargetType='place',scene3DSelected=null;
let scene3DCamera={yaw:.72,pitch:.42,distance:28,target:[0,2,0]};
let scene3DGL=null,scene3DProgram=null,scene3DGeometryCache=new Map(),scene3DDrag=null,scene3DKeyMode='';
let scene3DLastViewProj=null;
// v28.7ap — Wedge primitive + repaired in-viewport part dragging. Landscape coordinates
// remain the same as the actual Surface loader. One modeller unit = one Surface world unit.
const LANDSCAPE_SURFACE_SIZE=360,LANDSCAPE_SURFACE_HALF=LANDSCAPE_SURFACE_SIZE/2;
let sceneLandscapeWeatherDraft={skyColor:'#8fc8ee',type:'none',weatherSkyColor:'#56616b',intensity:.82,preview:true};

function scene3DEnvironmentPreset(env='grass'){
  if(env==='desert')return{sky:[.49,.70,.86,1],ground:'#c7a15a',grid:'#6f5a37'};
  if(env==='gas')return{sky:[.53,.41,.66,1],ground:'#9b7f98',grid:'#645067'};
  return{sky:[.42,.67,.86,1],ground:'#5d8b4b',grid:'#365a32'}
}
function scene3DPartDefaults(kind='Cube'){
  const defaults={
    Cube:{color:'#9aa6b2',sx:2.8,sy:2.8,sz:2.8},
    Wedge:{color:'#a6b0bb',sx:3.4,sy:2.8,sz:4.2},
    Building:{color:'#aeb9c4',sx:4,sy:4.5,sz:4},
    Tower:{color:'#b9c5d1',sx:2.8,sy:8,sz:2.8},
    Cylinder:{color:'#9fb6c6',sx:3,sy:4,sz:3},
    Sphere:{color:'#8eafd0',sx:3,sy:3,sz:3},
    Dome:{color:'#7ea9c8',sx:4,sy:2.2,sz:4},
    Cone:{color:'#b99576',sx:3.5,sy:5,sz:3.5},
    Pyramid:{color:'#bea77d',sx:4,sy:4,sz:4},
    Tree:{color:'#4f8b48',sx:3,sy:5,sz:3},
    Rock:{color:'#777b80',sx:3.5,sy:2.5,sz:3.1},
    Monument:{color:'#c9b780',sx:2.5,sy:7,sz:2.5}
  };
  const d=defaults[kind]||defaults.Cube;
  return{id:'mesh-'+uid(),kind,label:kind,color:d.color,x:0,y:d.sy/2,z:0,rx:0,ry:0,rz:0,sx:d.sx,sy:d.sy,sz:d.sz}
}
function normalizeScene3DModel(model){
  const src=model&&typeof model==='object'?deepCloneState(model):{};
  const legacyParts=Array.isArray(src.parts)?src.parts.map(p=>({
    ...scene3DPartDefaults(p.kind||'Building'),
    ...p,
    x:Number(p.x)||0,y:Number.isFinite(+p.y)?+p.y:(Number(p.h)||Number(p.sy)||3)/2,z:Number(p.z)||0,
    sx:Number(p.sx)||Number(p.w)||2.8,sy:Number(p.sy)||Number(p.h)||3,sz:Number(p.sz)||Number(p.d)||2.8,
    rx:Number(p.rx)||0,ry:Number(p.ry)||Number(p.rotation||0)*Math.PI/180,rz:Number(p.rz)||0
  })) : [];
  let variants=Array.isArray(src.variants)?src.variants.map((v,i)=>({
    id:v.id||'variant-'+uid(),name:String(v.name||`Variant ${i+1}`),
    parts:Array.isArray(v.parts)?v.parts.map(p=>({...scene3DPartDefaults(p.kind||'Cube'),...p})):[]
  })) : [];
  if(!variants.length)variants=[{id:'default',name:'Default',parts:legacyParts}];
  if(legacyParts.length&&!variants.some(v=>v.parts?.length)){
    const target=variants.find(v=>v.id===src.activeVariantId)||variants[0];target.parts=legacyParts
  }
  const drawableVariant=variants.find(v=>v.parts?.length),requested=variants.find(v=>v.id===src.activeVariantId);
  const activeVariantId=(requested?.parts?.length?requested:drawableVariant||requested||variants[0]).id;
  const rawR=src.repetition||{};
  return{
    environment:['grass','desert','gas'].includes(src.environment)?src.environment:'grass',
    groundColor:src.groundColor||scene3DEnvironmentPreset(src.environment||'grass').ground,
    skyColor:v287zNormHex(src.skyColor)||src.skyColor||'',
    variants,activeVariantId,
    parts:variants.find(v=>v.id===activeVariantId)?.parts||[],
    repetition:{
      enabled:!!rawR.enabled,
      mode:['grid','line','radial','area'].includes(rawR.mode)?rawR.mode:'grid',
      countX:Math.max(1,Math.min(50,+rawR.countX||1)),
      countZ:Math.max(1,Math.min(50,+rawR.countZ||1)),
      count:Math.max(1,Math.min(400,+rawR.count||6)),
      spacingX:Math.max(.5,Math.min(200,+rawR.spacingX||8)),
      spacingZ:Math.max(.5,Math.min(200,+rawR.spacingZ||8)),
      radius:Math.max(1,Math.min(400,+rawR.radius||14)),
      areaWidth:Math.max(1,Math.min(300,+rawR.areaWidth||70)),
      areaDepth:Math.max(1,Math.min(300,+rawR.areaDepth||70)),
      scaleVariation:Math.max(0,Math.min(80,+rawR.scaleVariation||0)),
      variantMode:['active','cycle','random'].includes(rawR.variantMode)?rawR.variantMode:'active'
    }
  }
}
function scene3DActiveVariant(model=scene3DModel){
  if(!model)return null;
  const vars=Array.isArray(model.variants)?model.variants:[],active=vars.find(v=>v.id===model.activeVariantId);
  // v28.7c: loaded models can retain an empty active variant while their real geometry lives in another variant.
  // Rendering that empty variant produced labels with no buildings. Prefer the active variant only when it has geometry.
  return (active?.parts?.length?active:null)||vars.find(v=>v?.parts?.length)||active||vars[0]||null
}
function syncScene3DLegacyParts(model=scene3DModel){
  if(!model)return model;const v=scene3DActiveVariant(model);model.parts=v?v.parts:[];return model
}
function scene3DModelForSave(model=scene3DModel){return deepCloneState(syncScene3DLegacyParts(model))}
function scene3DRepeatInstances(model=scene3DModel,seedKey='default'){
  if(!model)return[];
  const R=model.repetition||{},vars=Array.isArray(model.variants)?model.variants:[],drawable=vars.filter(v=>Array.isArray(v?.parts)&&v.parts.some(p=>p&&!p.hidden)),active=scene3DActiveVariant(model);
  if(!drawable.length)return[];
  const num=(v,d,min,max)=>Math.max(min,Math.min(max,Number.isFinite(+v)?+v:d)),
        mode=['grid','line','radial','area'].includes(R.mode)?R.mode:'grid',
        countX=Math.round(num(R.countX,1,1,50)),countZ=Math.round(num(R.countZ,1,1,50)),count=Math.round(num(R.count,6,1,400)),
        spacingX=num(R.spacingX,8,.1,200),spacingZ=num(R.spacingZ,8,.1,200),radius=num(R.radius,14,.1,400),
        areaWidth=num(R.areaWidth,70,1,300),areaDepth=num(R.areaDepth,70,1,300),variation=num(R.scaleVariation,0,0,80)/100;
  const rand=(i,s='')=>v283Hash(`land-repeat:${seedKey}:${i}:${s}`);
  const choose=i=>{if(R.variantMode==='cycle')return drawable[i%drawable.length];if(R.variantMode==='random')return drawable[Math.floor(rand(i,'variant')*drawable.length)%drawable.length];return drawable.includes(active)?active:drawable[0]};
  const scaleFor=i=>variation?1+(rand(i,'scale')*2-1)*variation:1;
  if(!R.enabled)return[{variant:drawable.includes(active)?active:drawable[0],ox:0,oz:0,index:0,key:`${seedKey}:repeat:0`,scale:1}];
  const out=[];
  if(mode==='radial'){
    for(let i=0;i<count;i++){const jitter=(rand(i,'angle')-.5)*(.32/count*Math.PI*2),t=i/count*Math.PI*2+jitter,rr=radius*(.86+rand(i,'radius')*.28);out.push({variant:choose(i),ox:Math.cos(t)*rr,oz:Math.sin(t)*rr,index:i,key:`${seedKey}:repeat:${i}`,scale:scaleFor(i)})}
  }else if(mode==='line'){
    for(let i=0;i<count;i++)out.push({variant:choose(i),ox:(i-(count-1)/2)*spacingX,oz:0,index:i,key:`${seedKey}:repeat:${i}`,scale:scaleFor(i)})
  }else if(mode==='area'){
    // v28.7ak: stratified 2D scatter. Every Area layout occupies both axes instead
    // of occasionally looking like a noisy line, while still remaining procedural.
    const aspect=Math.max(.15,areaWidth/Math.max(1,areaDepth)),cols=Math.max(1,Math.ceil(Math.sqrt(count*aspect))),rows=Math.max(1,Math.ceil(count/cols));
    for(let i=0;i<count;i++){const col=i%cols,row=Math.floor(i/cols),jx=(rand(i,'x')-.5)*.82,jz=(rand(i,'z')-.5)*.82;out.push({variant:choose(i),ox:(((col+.5+jx)/cols)-.5)*areaWidth,oz:(((row+.5+jz)/rows)-.5)*areaDepth,index:i,key:`${seedKey}:repeat:${i}`,scale:scaleFor(i)})}
  }else{
    let i=0;for(let z=0;z<countZ;z++)for(let x=0;x<countX;x++,i++)out.push({variant:choose(i),ox:(x-(countX-1)/2)*spacingX,oz:(z-(countZ-1)/2)*spacingZ,index:i,key:`${seedKey}:repeat:${i}`,scale:scaleFor(i)})
  }
  return out
}
function scene3DBakeRepetition(){
  if(!scene3DModel?.repetition?.enabled)return;
  const active=scene3DActiveVariant();if(!active)return;
  const baked=[];
  for(const inst of scene3DRepeatInstances(scene3DModel)){
    for(const src of inst.variant?.parts||[]){
      if(src.hidden)continue;
      const p=deepCloneState(src);p.id='mesh-'+uid();p.x=(p.x||0)*inst.scale+inst.ox;p.y=(p.y||0)*inst.scale;p.z=(p.z||0)*inst.scale+inst.oz;p.sx=(p.sx||1)*inst.scale;p.sy=(p.sy||1)*inst.scale;p.sz=(p.sz||1)*inst.scale;p.label=(p.label||p.kind)+(inst.index?` ${inst.index+1}`:'');baked.push(p)
    }
  }
  active.parts=baked;scene3DModel.repetition.enabled=false;scene3DSelected=baked[0]?.id||null;syncScene3DLegacyParts();scene3DSyncRepeatUI();scene3DSyncInspector();scene3DRenderViewport()
}
function scene3DRepetitionAgain(){
  if(!scene3DModel?.repetition)return;scene3DModel.repetition.enabled=true;scene3DSyncRepeatUI();scene3DRenderViewport()
}
/* ---- tiny matrix library ---- */
function m4Identity(){return[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}
function m4Mul(a,b){const o=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o}
function m4Translate(x,y,z){const m=m4Identity();m[12]=x;m[13]=y;m[14]=z;return m}
function m4Scale(x,y,z){const m=m4Identity();m[0]=x;m[5]=y;m[10]=z;return m}
function m4RotX(a){const c=Math.cos(a),s=Math.sin(a),m=m4Identity();m[5]=c;m[6]=s;m[9]=-s;m[10]=c;return m}
function m4RotY(a){const c=Math.cos(a),s=Math.sin(a),m=m4Identity();m[0]=c;m[2]=-s;m[8]=s;m[10]=c;return m}
function m4RotZ(a){const c=Math.cos(a),s=Math.sin(a),m=m4Identity();m[0]=c;m[1]=s;m[4]=-s;m[5]=c;return m}
function m4Perspective(fov,aspect,near,far){const f=1/Math.tan(fov/2),nf=1/(near-far);return[f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]}
function v3Sub(a,b){return[a[0]-b[0],a[1]-b[1],a[2]-b[2]]}
function v3Cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function v3Norm(a){const d=Math.hypot(...a)||1;return a.map(v=>v/d)}
function v3Dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
function m4LookAt(eye,target,up=[0,1,0]){const z=v3Norm(v3Sub(eye,target)),x=v3Norm(v3Cross(up,z)),y=v3Cross(z,x);return[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-v3Dot(x,eye),-v3Dot(y,eye),-v3Dot(z,eye),1]}
function m4TransformPoint(m,p){const x=p[0],y=p[1],z=p[2],w=p[3]??1;return[m[0]*x+m[4]*y+m[8]*z+m[12]*w,m[1]*x+m[5]*y+m[9]*z+m[13]*w,m[2]*x+m[6]*y+m[10]*z+m[14]*w,m[3]*x+m[7]*y+m[11]*z+m[15]*w]}
function scene3DModelMatrix(p,ox=0,oz=0){
  let m=m4Translate((p.x||0)+ox,p.y||0,(p.z||0)+oz);
  m=m4Mul(m,m4RotY(p.ry||0));m=m4Mul(m,m4RotX(p.rx||0));m=m4Mul(m,m4RotZ(p.rz||0));m=m4Mul(m,m4Scale(p.sx||1,p.sy||1,p.sz||1));return m
}
function scene3DHexRgb(hex){const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||''));if(!m)return[.65,.7,.75,1];const n=parseInt(m[1],16);return[((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255,1]}

/* ---- geometry ---- */
function scene3DGeometry(kind){
  const key=kind||'Cube';if(scene3DGeometryCache.has(key))return scene3DGeometryCache.get(key);
  const pos=[],nor=[];
  const tri=(a,b,c,n)=>{pos.push(...a,...b,...c);nor.push(...n,...n,...n)};
  if(['Cube','Building','Rock','Monument'].includes(key)){
    const V=[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]];
    for(const [a,b,c,d,n] of [[0,1,2,3,[0,0,-1]],[5,4,7,6,[0,0,1]],[4,0,3,7,[-1,0,0]],[1,5,6,2,[1,0,0]],[3,2,6,7,[0,1,0]],[4,5,1,0,[0,-1,0]]]){tri(V[a],V[b],V[c],n);tri(V[a],V[c],V[d],n)}
  }else if(key==='Wedge'){
    // Triangular prism: low edge at -Z, tall vertical edge at +Z.
    // This is real geometry, so the same Wedge appears in the modeller and Surface loader.
    const LF=[-.5,-.5,-.5],RF=[.5,-.5,-.5],LB=[-.5,-.5,.5],RB=[.5,-.5,.5],LT=[-.5,.5,.5],RT=[.5,.5,.5];
    tri(LF,RF,RB,[0,-1,0]);tri(LF,RB,LB,[0,-1,0]);                    // bottom
    tri(LB,RB,RT,[0,0,1]);tri(LB,RT,LT,[0,0,1]);                     // tall back
    tri(LF,LB,LT,[-1,0,0]);                                         // left triangle
    tri(RF,RT,RB,[1,0,0]);                                          // right triangle
    const slope=v3Norm([0,1,-1]);tri(LF,RT,RF,slope);tri(LF,LT,RT,slope); // slope
  }else if(key==='Pyramid'){
    const A=[-.5,-.5,-.5],B=[.5,-.5,-.5],C=[.5,-.5,.5],D=[-.5,-.5,.5],T=[0,.5,0];tri(A,C,B,[0,-1,0]);tri(A,D,C,[0,-1,0]);tri(A,B,T,[0,.45,-.89]);tri(B,C,T,[.89,.45,0]);tri(C,D,T,[0,.45,.89]);tri(D,A,T,[-.89,.45,0])
  }else{
    const seg=key==='Sphere'?18:24;
    if(key==='Sphere'||key==='Dome'){
      const latN=key==='Dome'?7:12,latMax=key==='Dome'?Math.PI/2:Math.PI;
      for(let y=0;y<latN;y++){const a0=y/latN*latMax-(key==='Dome'?0:Math.PI/2),a1=(y+1)/latN*latMax-(key==='Dome'?0:Math.PI/2);for(let i=0;i<seg;i++){const t0=i/seg*Math.PI*2,t1=(i+1)/seg*Math.PI*2;const q=(a,t)=>[Math.cos(a)*Math.cos(t)*.5,Math.sin(a)*.5,Math.cos(a)*Math.sin(t)*.5],A=q(a0,t0),B=q(a0,t1),C=q(a1,t1),D=q(a1,t0);tri(A,B,C,v3Norm(A));tri(A,C,D,v3Norm(A))}}
    }else{
      const cone=key==='Cone'||key==='Tree',topR=cone?0:.5,bottomR=.5;
      for(let i=0;i<seg;i++){const t0=i/seg*Math.PI*2,t1=(i+1)/seg*Math.PI*2,A=[Math.cos(t0)*bottomR,-.5,Math.sin(t0)*bottomR],B=[Math.cos(t1)*bottomR,-.5,Math.sin(t1)*bottomR],C=[Math.cos(t1)*topR,.5,Math.sin(t1)*topR],D=[Math.cos(t0)*topR,.5,Math.sin(t0)*topR],n=v3Norm([Math.cos((t0+t1)/2),cone?.45:0,Math.sin((t0+t1)/2)]);tri(A,B,C,n);tri(A,C,D,n);tri([0,-.5,0],B,A,[0,-1,0]);if(!cone)tri([0,.5,0],D,C,[0,1,0])}
    }
  }
  const geo={positions:new Float32Array(pos),normals:new Float32Array(nor)};scene3DGeometryCache.set(key,geo);return geo
}
function scene3DShader(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s}
function scene3DInitGL(canvas){
  const gl=canvas.getContext('webgl',{antialias:true,alpha:false,preserveDrawingBuffer:false});if(!gl)return null;
  const vs=scene3DShader(gl,gl.VERTEX_SHADER,`attribute vec3 aPosition;attribute vec3 aNormal;uniform mat4 uMVP;uniform mat4 uModel;varying vec3 vN;varying vec3 vW;varying vec3 vLP;varying vec3 vLN;void main(){vec4 w=uModel*vec4(aPosition,1.0);vW=w.xyz;vN=normalize(mat3(uModel)*aNormal);vLP=aPosition;vLN=aNormal;gl_Position=uMVP*vec4(aPosition,1.0);}`);
  const fs=scene3DShader(gl,gl.FRAGMENT_SHADER,`precision mediump float;uniform vec4 uColor;uniform vec3 uLight;uniform bool uUseTexture;uniform sampler2D uTexture;uniform int uFace;uniform bool uTileTexture;uniform vec2 uTileRepeat;varying vec3 vN;varying vec3 vW;varying vec3 vLP;varying vec3 vLN;const float PI=3.14159265;void main(){vec4 base=uColor;if(uUseTexture){vec2 uv=vec2(.5);bool ok=false;if(uFace==0){ok=vLN.z>.55;uv=vLP.xy+.5;}else if(uFace==1){ok=vLN.z<-.55;uv=vec2(-vLP.x,vLP.y)+.5;}else if(uFace==2){ok=vLN.x<-.55;uv=vec2(vLP.z,vLP.y)+.5;}else if(uFace==3){ok=vLN.x>.55;uv=vec2(-vLP.z,vLP.y)+.5;}else if(uFace==4){ok=vLN.y>.55;uv=vLP.xz+.5;}else if(uFace==5){ok=vLN.y<-.55;uv=vec2(vLP.x,-vLP.z)+.5;}else{ok=abs(vLN.y)<.72;uv=vec2(atan(vLP.z,vLP.x)/(2.0*PI)+.5,vLP.y+.5);}if(!ok)discard;vec2 sampleUV=uTileTexture?fract(uv*uTileRepeat):clamp(uv,vec2(.001),vec2(.999));base=texture2D(uTexture,sampleUV);}float d=max(0.0,dot(normalize(vN),normalize(uLight)));float amb=.32;float shade=amb+d*.68;float fog=clamp((length(vW)-25.0)/85.0,0.0,.52);vec3 c=base.rgb*shade;c=mix(c,vec3(.56,.69,.79),fog);gl_FragColor=vec4(c,base.a);}`);
  const pr=gl.createProgram();gl.attachShader(pr,vs);gl.attachShader(pr,fs);gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(pr));
  return{gl,program:pr,textureCache:new Map(),loc:{p:gl.getAttribLocation(pr,'aPosition'),n:gl.getAttribLocation(pr,'aNormal'),mvp:gl.getUniformLocation(pr,'uMVP'),model:gl.getUniformLocation(pr,'uModel'),color:gl.getUniformLocation(pr,'uColor'),light:gl.getUniformLocation(pr,'uLight'),useTexture:gl.getUniformLocation(pr,'uUseTexture'),texture:gl.getUniformLocation(pr,'uTexture'),face:gl.getUniformLocation(pr,'uFace'),tileTexture:gl.getUniformLocation(pr,'uTileTexture'),tileRepeat:gl.getUniformLocation(pr,'uTileRepeat')}}
}
function scene3DDrawMesh(renderer,kind,model,vp,color){
  const {gl,program,loc}=renderer,geo=scene3DGeometry(kind);gl.useProgram(program);
  if(!geo._buffers)geo._buffers=new WeakMap();let buf=geo._buffers.get(gl);if(!buf){buf={p:gl.createBuffer(),n:gl.createBuffer()};gl.bindBuffer(gl.ARRAY_BUFFER,buf.p);gl.bufferData(gl.ARRAY_BUFFER,geo.positions,gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,buf.n);gl.bufferData(gl.ARRAY_BUFFER,geo.normals,gl.STATIC_DRAW);geo._buffers.set(gl,buf)}
  gl.bindBuffer(gl.ARRAY_BUFFER,buf.p);gl.enableVertexAttribArray(loc.p);gl.vertexAttribPointer(loc.p,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,buf.n);gl.enableVertexAttribArray(loc.n);gl.vertexAttribPointer(loc.n,3,gl.FLOAT,false,0,0);
  gl.uniformMatrix4fv(loc.model,false,new Float32Array(model));gl.uniformMatrix4fv(loc.mvp,false,new Float32Array(m4Mul(vp,model)));gl.uniform4fv(loc.color,new Float32Array(scene3DHexRgb(color)));gl.uniform3fv(loc.light,new Float32Array([.55,.85,.4]));gl.uniform1i(loc.useTexture,0);gl.drawArrays(gl.TRIANGLES,0,geo.positions.length/3)
}

function scene3DGLTexture(renderer,data){
  if(!data)return null;if(renderer.textureCache.has(data))return renderer.textureCache.get(data);
  const {gl}=renderer,rec={texture:gl.createTexture(),ready:false};renderer.textureCache.set(data,rec);gl.bindTexture(gl.TEXTURE_2D,rec.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([180,180,180,255]));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  const img=new Image();img.onload=()=>{gl.bindTexture(gl.TEXTURE_2D,rec.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);rec.ready=true;scene3DRenderViewport()};img.src=data;return rec
}
function scene3DTextureRepeatForFace(p,face,t){
  const tileSize=Math.max(.25,Math.min(100,Number(t?.tileSize)||2.5)),
        sx=Math.max(.1,Math.abs(Number(p?.sx)||1)),
        sy=Math.max(.1,Math.abs(Number(p?.sy)||1)),
        sz=Math.max(.1,Math.abs(Number(p?.sz)||1));
  let w=sx,h=sy;
  if(face==='left'||face==='right'){w=sz;h=sy}
  else if(face==='top'||face==='bottom'){w=sx;h=sz}
  else if(face==='wrap'){w=Math.PI*(sx+sz)*.5;h=sy}
  return[
    Math.max(1,w/tileSize),
    Math.max(1,h/tileSize)
  ]
}
function scene3DDrawTexturedFace(renderer,p,kind,model,vp,t,face){
  const rec=scene3DGLTexture(renderer,t?.data);if(!rec)return;
  const {gl,program,loc}=renderer,geo=scene3DGeometry(kind);gl.useProgram(program);const buf=geo._buffers?.get(gl);if(!buf)return;
  gl.bindBuffer(gl.ARRAY_BUFFER,buf.p);gl.enableVertexAttribArray(loc.p);gl.vertexAttribPointer(loc.p,3,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,buf.n);gl.enableVertexAttribArray(loc.n);gl.vertexAttribPointer(loc.n,3,gl.FLOAT,false,0,0);
  gl.uniformMatrix4fv(loc.model,false,new Float32Array(model));gl.uniformMatrix4fv(loc.mvp,false,new Float32Array(m4Mul(vp,model)));
  gl.uniform4fv(loc.color,new Float32Array([1,1,1,1]));gl.uniform3fv(loc.light,new Float32Array([.55,.85,.4]));
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,rec.texture);gl.uniform1i(loc.texture,0);
  gl.uniform1i(loc.face,{front:0,back:1,left:2,right:3,top:4,bottom:5,wrap:6}[face]??0);
  const tiled=t?.mode==='tile',repeat=scene3DTextureRepeatForFace(p,face,t);
  gl.uniform1i(loc.tileTexture,tiled?1:0);gl.uniform2fv(loc.tileRepeat,new Float32Array(repeat));
  gl.uniform1i(loc.useTexture,1);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-2,-2);
  gl.drawArrays(gl.TRIANGLES,0,geo.positions.length/3);
  gl.disable(gl.POLYGON_OFFSET_FILL);gl.depthMask(true);gl.depthFunc(gl.LESS);gl.uniform1i(loc.useTexture,0)
}
function scene3DRenderFaceTextures(renderer,p,kind,model,vp){
  for(const [face,t] of Object.entries(p.faceTextures||{}))if(t?.data)scene3DDrawTexturedFace(renderer,p,kind,model,vp,t,face)
}
function scene3DRenderPart(renderer,p,vp,ox=0,oz=0){
  if(p.kind==='Tree'){
    const trunk={...p,kind:'Cylinder',color:'#6e5035',sx:(p.sx||3)*.26,sy:(p.sy||5)*.55,sz:(p.sz||3)*.26,y:(p.y||0)-(p.sy||5)*.20};
    const crown={...p,kind:'Sphere',sx:p.sx||3,sy:(p.sy||5)*.65,sz:p.sz||3,y:(p.y||0)+(p.sy||5)*.18};
    scene3DDrawMesh(renderer,'Cylinder',scene3DModelMatrix(trunk,ox,oz),vp,trunk.color);scene3DDrawMesh(renderer,'Sphere',scene3DModelMatrix(crown,ox,oz),vp,p.color);return
  }
  const kind=p.kind==='Tower'?'Cylinder':p.kind,model=scene3DModelMatrix(p,ox,oz);scene3DDrawMesh(renderer,kind,model,vp,p.color);scene3DRenderFaceTextures(renderer,p,kind,model,vp)
}
function scene3DCameraMatrices(canvas){
  const c=scene3DCamera,cp=Math.cos(c.pitch),eye=[c.target[0]+Math.sin(c.yaw)*cp*c.distance,c.target[1]+Math.sin(c.pitch)*c.distance,c.target[2]+Math.cos(c.yaw)*cp*c.distance],aspect=Math.max(.2,canvas.width/canvas.height);
  const view=m4LookAt(eye,c.target,[0,1,0]),proj=m4Perspective(Math.PI/4,aspect,.1,500);return{eye,view,proj,vp:m4Mul(proj,view)}
}
function scene3DProject(world,canvas,vp=scene3DLastViewProj){
  if(!vp)return null;const q=m4TransformPoint(vp,[...world,1]);if(!q[3])return null;const x=q[0]/q[3],y=q[1]/q[3],z=q[2]/q[3];return{x:(x*.5+.5)*canvas.width,y:(1-(y*.5+.5))*canvas.height,z,w:q[3]}
}
function scene3DPartWorldCenter(p,ox=0,oz=0){return[(p.x||0)+ox,p.y||0,(p.z||0)+oz]}

function scene3DSoftwareFallback(canvas,overlay,W,H){
  const ctx=canvas.getContext('2d');if(!ctx)return false;
  const env=scene3DEnvironmentPreset(scene3DModel.environment),landscapeMode=scene3DTargetType==='landscape',skyHex=landscapeMode?v287alScenePreviewSky():'',skyRgb=skyHex?v271ParseHex(skyHex):null,rgb=skyRgb?[skyRgb.r,skyRgb.g,skyRgb.b,1]:env.sky.map((v,i)=>i<3?Math.round(v*255):v),grad=ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);grad.addColorStop(.58,landscapeMode?`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`:`rgb(${Math.min(255,rgb[0]+35)},${Math.min(255,rgb[1]+35)},${Math.min(255,rgb[2]+35)})`);grad.addColorStop(.581,scene3DModel.groundColor||env.ground);grad.addColorStop(1,scene3DModel.groundColor||env.ground);ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
  const {vp}=scene3DCameraMatrices(canvas);scene3DLastViewProj=vp;canvas._scenePick=[];
  ctx.strokeStyle='rgba(255,255,255,.09)';ctx.lineWidth=1;
  if(!landscapeMode)for(let i=-20;i<=20;i+=2){const A=scene3DProject([i,0,-20],canvas,vp),B=scene3DProject([i,0,20],canvas,vp),C=scene3DProject([-20,0,i],canvas,vp),D=scene3DProject([20,0,i],canvas,vp);if(A&&B){ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke()}if(C&&D){ctx.beginPath();ctx.moveTo(C.x,C.y);ctx.lineTo(D.x,D.y);ctx.stroke()}}
  for(const inst of scene3DRepeatInstances(scene3DModel)){
    for(const p of inst.variant?.parts||[]){
      if(p.hidden)continue;
      const P=scene3DProject([(p.x||0)+inst.ox,p.y||0,(p.z||0)+inst.oz],canvas,vp);if(!P||P.w<=0)continue;const size=Math.max(5,520/Math.max(.8,P.w)),ww=Math.max(5,(p.sx||1)*size),hh=Math.max(7,(p.sy||1)*size);
      ctx.save();ctx.globalAlpha=inst.index===0?1:.72;ctx.fillStyle=p.color||'#9aa6b2';ctx.strokeStyle='rgba(0,0,0,.35)';
      if(['Sphere','Dome'].includes(p.kind)){ctx.beginPath();ctx.ellipse(P.x,P.y,ww*.48,hh*.48,0,0,Math.PI*2);ctx.fill();ctx.stroke()}
      else if(['Cylinder','Tower'].includes(p.kind)){ctx.fillRect(P.x-ww*.4,P.y-hh*.5,ww*.8,hh);ctx.beginPath();ctx.ellipse(P.x,P.y-hh*.5,ww*.4,Math.max(2,ww*.12),0,0,Math.PI*2);ctx.fill()}
      else if(['Cone','Pyramid','Tree','Rock'].includes(p.kind)){ctx.beginPath();ctx.moveTo(P.x,P.y-hh*.55);ctx.lineTo(P.x-ww*.48,P.y+hh*.45);ctx.lineTo(P.x+ww*.48,P.y+hh*.45);ctx.closePath();ctx.fill();ctx.stroke()}
      else{ctx.fillRect(P.x-ww*.5,P.y-hh*.5,ww,hh);ctx.strokeRect(P.x-ww*.5,P.y-hh*.5,ww,hh)}
      ctx.restore();if(inst.index===0)canvas._scenePick.push({part:p,x:P.x,y:P.y,r:Math.max(18,Math.min(70,Math.max(ww,hh)*.55))})
    }
  }
  scene3DDrawGizmo(canvas,overlay,vp);return true
}
function scene3DRenderViewport(){
  const canvas=$('scene3DCanvas'),overlay=$('scene3DGizmo');if(!canvas||!scene3DModel)return;
  const rect=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,1.75),W=Math.max(2,Math.round(rect.width*d)),H=Math.max(2,Math.round(rect.height*d));if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;overlay.width=W;overlay.height=H}
  let renderer=canvas._sceneRenderer;
  if(renderer===undefined){renderer=scene3DInitGL(canvas);canvas._sceneRenderer=renderer||false}
  if(!renderer){
    scene3DSoftwareFallback(canvas,overlay,W,H);
    const v=scene3DActiveVariant(),rep=scene3DModel.repetition;$('scene3DStatus').textContent=`Software fallback · ${v?.parts.length||0} object${(v?.parts.length||0)===1?'':'s'} · ${scene3DModel.variants.length} variant${scene3DModel.variants.length===1?'':'s'}${rep.enabled?` · repeated ${scene3DRepeatInstances(scene3DModel).length}×`:''}`;return
  }
  const {gl}=renderer,env=scene3DEnvironmentPreset(scene3DModel.environment),landscapeMode=scene3DTargetType==='landscape',skyHex=landscapeMode?v287alScenePreviewSky():'',skyRgb=skyHex?v271ParseHex(skyHex):null,clearSky=skyRgb?[skyRgb.r/255,skyRgb.g/255,skyRgb.b/255,1]:env.sky;gl.viewport(0,0,W,H);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(...clearSky);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  const {vp}=scene3DCameraMatrices(canvas);scene3DLastViewProj=vp;
  // Landscape authoring uses the EXACT 360 × 360 world-space baseplate used by
  // surface3DDrawLandscape(). The grid is an editor guide only and is never loaded
  // as scenery. This makes every X/Z position directly match the visited Surface.
  const ground={x:0,y:-.32,z:0,rx:0,ry:0,rz:0,sx:landscapeMode?LANDSCAPE_SURFACE_SIZE:90,sy:landscapeMode?.55:.2,sz:landscapeMode?LANDSCAPE_SURFACE_SIZE:90};
  scene3DDrawMesh(renderer,'Cube',scene3DModelMatrix(ground),vp,scene3DModel.groundColor||env.ground);
  if(landscapeMode){
    const guide='#455465';
    for(let i=-LANDSCAPE_SURFACE_HALF;i<=LANDSCAPE_SURFACE_HALF;i+=20){
      scene3DDrawMesh(renderer,'Cube',scene3DModelMatrix({x:i,y:.002,z:0,sx:.08,sy:.018,sz:LANDSCAPE_SURFACE_SIZE}),vp,guide);
      scene3DDrawMesh(renderer,'Cube',scene3DModelMatrix({x:0,y:.003,z:i,sx:LANDSCAPE_SURFACE_SIZE,sy:.018,sz:.08}),vp,guide)
    }
    // Bright boundary = the exact loader edge.
    for(const edge of [
      {x:-LANDSCAPE_SURFACE_HALF,z:0,sx:.28,sz:LANDSCAPE_SURFACE_SIZE},
      {x: LANDSCAPE_SURFACE_HALF,z:0,sx:.28,sz:LANDSCAPE_SURFACE_SIZE},
      {x:0,z:-LANDSCAPE_SURFACE_HALF,sx:LANDSCAPE_SURFACE_SIZE,sz:.28},
      {x:0,z: LANDSCAPE_SURFACE_HALF,sx:LANDSCAPE_SURFACE_SIZE,sz:.28}
    ])scene3DDrawMesh(renderer,'Cube',scene3DModelMatrix({...edge,y:.018,sy:.028}),vp,'#9fdcff')
  }else for(let i=-20;i<=20;i+=2){scene3DDrawMesh(renderer,'Cube',scene3DModelMatrix({x:i,y:.005,z:0,sx:.018,sy:.012,sz:40}),vp,env.grid);scene3DDrawMesh(renderer,'Cube',scene3DModelMatrix({x:0,y:.006,z:i,sx:40,sy:.012,sz:.018}),vp,env.grid)}
  // v28.1 backdrop is Structure-only. A Landscape literally IS the environment.
  const backdropSeed=(i,s=0)=>{const n=Math.sin(i*71.37+s*39.11)*43758.5453;return n-Math.floor(n)};
  if(!landscapeMode&&(scene3DModel.environment==='grass'||scene3DModel.environment==='desert')){
    const desert=scene3DModel.environment==='desert';
    for(let i=0;i<16;i++){
      const x=(backdropSeed(i,1)-.5)*72,z=24+backdropSeed(i,2)*30,w=5+backdropSeed(i,3)*10,h=(desert?.45:.75)*(4+backdropSeed(i,4)*10),col=desert?'#c9a45c':'#6f9657';
      scene3DDrawMesh(renderer,'Dome',scene3DModelMatrix({x,y:-.08,z,sx:w*1.7,sy:h,sz:w,rx:0,ry:0,rz:0}),vp,col)
    }
    for(let i=0;i<12;i++){
      const x=-58+i*10+(backdropSeed(i,5)-.5)*5,z=58+backdropSeed(i,6)*20,w=9+backdropSeed(i,7)*12,h=18+backdropSeed(i,8)*24,col=desert?'#8f6948':'#52634e';
      scene3DDrawMesh(renderer,'Cone',scene3DModelMatrix({x,y:h*.48-1,z,sx:w,sy:h,sz:w*.82,rx:0,ry:backdropSeed(i,9)*.4,rz:0}),vp,col)
    }
  }else if(!landscapeMode&&scene3DModel.environment==='gas'){
    for(let i=0;i<26;i++){const x=(backdropSeed(i,10)-.5)*75,z=22+backdropSeed(i,11)*38,s=5+backdropSeed(i,12)*9;scene3DDrawMesh(renderer,'Sphere',scene3DModelMatrix({x,y:-1+backdropSeed(i,13)*5,z,sx:s*1.8,sy:s*.42,sz:s,rx:0,ry:0,rz:0}),vp,i%2?'#a98ca5':'#c3a6bb')}
  }
  canvas._scenePick=[];
  for(const inst of scene3DRepeatInstances(scene3DModel)){
    for(const p of inst.variant?.parts||[]){
      if(p.hidden)continue;
      scene3DRenderPart(renderer,{...p,x:(p.x||0)*inst.scale,y:(p.y||0)*inst.scale,z:(p.z||0)*inst.scale,sx:(p.sx||1)*inst.scale,sy:(p.sy||1)*inst.scale,sz:(p.sz||1)*inst.scale},vp,inst.ox,inst.oz);
      if(inst.index===0){const P=scene3DProject(scene3DPartWorldCenter(p),canvas,vp);if(P&&P.w>0)canvas._scenePick.push({part:p,x:P.x,y:P.y,r:Math.max(18,Math.min(65,900/P.w*Math.max(p.sx||1,p.sy||1,p.sz||1)))})}
    }
  }
  scene3DDrawGizmo(canvas,overlay,vp);v287alDrawSceneWeatherPreview(overlay);
  const v=scene3DActiveVariant(),rep=scene3DModel.repetition;$('scene3DStatus').textContent=`${scene3DTargetType==='landscape'?`Surface footprint ${LANDSCAPE_SURFACE_SIZE}×${LANDSCAPE_SURFACE_SIZE} · `:''}${v?.parts.length||0} object${(v?.parts.length||0)===1?'':'s'} · ${scene3DModel.variants.length} variant${scene3DModel.variants.length===1?'':'s'}${rep.enabled?` · repeated ${scene3DRepeatInstances(scene3DModel).length}×`:''}`
}
function scene3DGizmoWorldHandles(p){
  const x=p.x||0,y=p.y||0,z=p.z||0,sx=p.sx||1,sy=p.sy||1,sz=p.sz||1,c=scene3DCamera,cp=Math.cos(c.pitch),eye=[c.target[0]+Math.sin(c.yaw)*cp*c.distance,c.target[1]+Math.sin(c.pitch)*c.distance,c.target[2]+Math.cos(c.yaw)*cp*c.distance];
  const signX=eye[0]>=x?1:-1,signZ=eye[2]>=z?1:-1;
  return[{axis:'x',kind:'scale',world:[x+signX*(sx*.65+1),y,z],color:'#ff5a65',label:'X'},{axis:'y',kind:'scale',world:[x,y+sy*.65+1,z],color:'#67e56f',label:'Y'},{axis:'z',kind:'scale',world:[x,y,z+signZ*(sz*.65+1)],color:'#5a8cff',label:'Z'},{axis:'lift',kind:'lift',world:[x,y+sy*.65+3,z],color:'#5de2ff',label:'↑'},{axis:'move',kind:'move',world:[x,y,z],color:'#ffffff',label:'•'}]
}
function scene3DDrawGizmo(canvas,overlay,vp){
  const ctx=overlay.getContext('2d');ctx.clearRect(0,0,overlay.width,overlay.height);overlay._handles=[];const p=scene3DActiveVariant()?.parts.find(x=>x.id===scene3DSelected);if(!p)return;
  const C=scene3DProject([p.x||0,p.y||0,p.z||0],canvas,vp);if(!C)return;ctx.lineWidth=3;
  for(const H of scene3DGizmoWorldHandles(p)){const P=scene3DProject(H.world,canvas,vp);if(!P)continue;ctx.strokeStyle=H.color;ctx.beginPath();ctx.moveTo(C.x,C.y);ctx.lineTo(P.x,P.y);ctx.stroke();ctx.fillStyle=H.color;ctx.strokeStyle='#0a0d12';ctx.lineWidth=2;ctx.beginPath();ctx.rect(P.x-7,P.y-7,14,14);ctx.fill();ctx.stroke();ctx.fillStyle='#07111c';ctx.font='700 8px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(H.label,P.x,P.y);overlay._handles.push({...H,x:P.x,y:P.y,cx:C.x,cy:C.y,ux:(P.x-C.x)/(Math.hypot(P.x-C.x,P.y-C.y)||1),uy:(P.y-C.y)/(Math.hypot(P.x-C.x,P.y-C.y)||1)})}
  // rotation ring, intentionally subtle
  ctx.strokeStyle='rgba(255,215,90,.72)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(C.x,C.y,36,0,Math.PI*2);ctx.stroke();overlay._rotationRing={x:C.x,y:C.y,r:36}
}

function scene3DSyncOutliner(){
  const host=$('scene3DOutliner'),v=scene3DActiveVariant();if(!host||!v)return;
  $('scene3DOutlinerCount').textContent=String(v.parts.length);
  host.innerHTML=v.parts.map(p=>`<div class="scene3d-outliner-row ${p.id===scene3DSelected?'active':''}" data-scene-object="${p.id}"><button type="button" class="scene3d-eye" title="${p.hidden?'Show':'Hide'}">${p.hidden?'○':'◉'}</button><span>${E.esc(p.label||p.kind)}</span><small>${E.esc(p.kind)}</small></div>`).join('');
  host.querySelectorAll('[data-scene-object]').forEach(row=>{row.onclick=e=>{const id=row.dataset.sceneObject,p=v.parts.find(x=>x.id===id);if(e.target.closest('.scene3d-eye')){p.hidden=!p.hidden;scene3DRenderViewport();scene3DSyncOutliner();return}scene3DSelected=id;scene3DSyncInspector();scene3DRenderViewport()}})
}

function scene3DAlignOptions(axis){
  const v=scene3DActiveVariant(),p=v?.parts.find(x=>x.id===scene3DSelected);
  return `<option value="">Match ${axis.toUpperCase()} to…</option>`+(v?.parts||[]).filter(x=>x!==p).map(x=>`<option value="${x.id}">${E.esc(x.label||x.kind)}</option>`).join('')
}
function scene3DAlignAxis(axis,otherId){
  const v=scene3DActiveVariant(),p=v?.parts.find(x=>x.id===scene3DSelected),q=v?.parts.find(x=>x.id===otherId);if(!p||!q)return;
  p[axis]=Number(q[axis])||0;scene3DSyncInspector();scene3DRenderViewport()
}
function v284V3Add(a,b){return[a[0]+b[0],a[1]+b[1],a[2]+b[2]]}
function v284V3Scale(a,s){return[a[0]*s,a[1]*s,a[2]*s]}
function scene3DClientToCanvas(canvas,cx,cy){const r=canvas.getBoundingClientRect();return{x:(cx-r.left)/r.width*canvas.width,y:(cy-r.top)/r.height*canvas.height}}
function scene3DUnprojectRay(canvas,cx,cy){
  const pt=scene3DClientToCanvas(canvas,cx,cy),{eye}=scene3DCameraMatrices(canvas),target=scene3DCamera.target;
  const forward=v3Norm(v3Sub(target,eye)),right=v3Norm(v3Cross(forward,[0,1,0])),up=v3Norm(v3Cross(right,forward)),aspect=canvas.width/canvas.height,tan=Math.tan(Math.PI/8),nx=pt.x/canvas.width*2-1,ny=1-pt.y/canvas.height*2;
  return{origin:eye,dir:v3Norm(v284V3Add(forward,v284V3Add(v284V3Scale(right,nx*aspect*tan),v284V3Scale(up,ny*tan))))}
}
function scene3DRayPlaneY(canvas,cx,cy,y=0){
  const ray=scene3DUnprojectRay(canvas,cx,cy);if(Math.abs(ray.dir[1])<1e-5)return null;const t=(y-ray.origin[1])/ray.dir[1];if(t<=0)return null;return v284V3Add(ray.origin,v284V3Scale(ray.dir,t))
}
function scene3DSyncInspector(){
  scene3DSyncOutliner();
  const p=scene3DActiveVariant()?.parts.find(x=>x.id===scene3DSelected),ids=['sceneObjName','sceneObjColor','scenePosX','scenePosY','scenePosZ','sceneRotX','sceneRotY','sceneRotZ'];ids.forEach(id=>{if($(id))$(id).disabled=!p});if(!p){$('scene3DSelectionLabel').textContent='Nothing selected';$('scene3DDimensions').textContent='—';return}
  $('scene3DSelectionLabel').textContent=p.label||p.kind;$('sceneObjName').value=p.label||p.kind;$('sceneObjColor').value=p.color||'#9aa6b2';$('scenePosX').value=(p.x||0).toFixed(2);$('scenePosY').value=(p.y||0).toFixed(2);$('scenePosZ').value=(p.z||0).toFixed(2);$('sceneRotX').value=((p.rx||0)*180/Math.PI).toFixed(1);$('sceneRotY').value=((p.ry||0)*180/Math.PI).toFixed(1);$('sceneRotZ').value=((p.rz||0)*180/Math.PI).toFixed(1);$('scene3DDimensions').innerHTML=`<b>${(p.sx||1).toFixed(2)}</b> X × <b>${(p.sy||1).toFixed(2)}</b> Y × <b>${(p.sz||1).toFixed(2)}</b> Z`;
  for(const axis of ['x','y','z']){const s=$('sceneAlign'+axis.toUpperCase());if(s){s.innerHTML=scene3DAlignOptions(axis);s.value=''}}
  scene3DSyncTextureStatus()
}
function scene3DSyncVariantUI(){
  const sel=$('sceneVariantSelect');if(!sel||!scene3DModel)return;sel.innerHTML=scene3DModel.variants.map(v=>`<option value="${v.id}" ${v.id===scene3DModel.activeVariantId?'selected':''}>${E.esc(v.name)}</option>`).join('');
  const mergeSel=$('sceneVariantMergeSelect');if(mergeSel){const others=scene3DModel.variants.filter(v=>v.id!==scene3DModel.activeVariantId),current=mergeSel.value;mergeSel.innerHTML=others.map(v=>`<option value="${v.id}">${E.esc(v.name)} · ${v.parts?.length||0} objects</option>`).join('');if(others.some(v=>v.id===current))mergeSel.value=current;if($('sceneVariantMerge'))$('sceneVariantMerge').disabled=!others.length;if(!others.length)$('sceneVariantMergeBox')?.classList.add('hidden')}
  const R=scene3DModel.repetition;$('sceneRepeatEnabled').checked=!!R.enabled;$('sceneRepeatMode').value=R.mode;$('sceneRepeatCountX').value=R.countX;$('sceneRepeatCountZ').value=R.countZ;$('sceneRepeatCount').value=R.count;$('sceneRepeatSpacingX').value=R.spacingX;$('sceneRepeatSpacingZ').value=R.spacingZ;$('sceneRepeatRadius').value=R.radius;if($('sceneRepeatAreaWidth'))$('sceneRepeatAreaWidth').value=R.areaWidth;if($('sceneRepeatAreaDepth'))$('sceneRepeatAreaDepth').value=R.areaDepth;if($('sceneRepeatScaleVariation'))$('sceneRepeatScaleVariation').value=R.scaleVariation;if($('sceneRepeatScaleVariationOut'))$('sceneRepeatScaleVariationOut').textContent=`${Math.round(R.scaleVariation||0)}%`;$('sceneRepeatVariantMode').value=R.variantMode;scene3DRefreshRepeatVisibility()
}
function scene3DRefreshRepeatVisibility(){
  const R=scene3DModel?.repetition;if(!R)return;const host=$('sceneRepeatControls');host?.classList.toggle('repeat-off',!R.enabled);host?.querySelectorAll('input,select').forEach(el=>el.disabled=!R.enabled);
  if($('sceneRepeatBake'))$('sceneRepeatBake').disabled=!R.enabled;if($('sceneRepeatAgain'))$('sceneRepeatAgain').disabled=!!R.enabled;
  document.querySelectorAll('[data-repeat-mode]').forEach(el=>el.classList.toggle('hidden',!String(el.dataset.repeatMode).split(',').includes(R.mode)))
}

function scene3DSelectedPart(){return scene3DActiveVariant()?.parts.find(x=>x.id===scene3DSelected)||null}
function scene3DSyncTextureStatus(){
  const p=scene3DSelectedPart(),face=$('sceneTextureFace')?.value||'front',st=$('sceneTextureStatus'),
        t=p?.faceTextures?.[face],mode=t?.mode==='tile'?'tile':'stretch';
  if(st)st.textContent=t
    ?`${face}: ${t.name||'texture'} · ${mode==='tile'?`Tiled · ${Number(t.tileSize)||2.5} unit tiles`:'Stretched'} · ${Math.round((t.data?.length||0)/1024)} KB embedded`
    :`No texture on ${face}.`;
  if($('sceneTextureMode'))$('sceneTextureMode').value=mode;
  if($('sceneTextureTileSize'))$('sceneTextureTileSize').value=String(Number(t?.tileSize)||2.5);
  if($('sceneTextureTileControls'))$('sceneTextureTileControls').classList.toggle('hidden',mode!=='tile'||!t)
}
function scene3DSetTextureMode(){
  const p=scene3DSelectedPart(),face=$('sceneTextureFace')?.value||'front',t=p?.faceTextures?.[face];if(!t)return;
  t.mode=$('sceneTextureMode')?.value==='tile'?'tile':'stretch';
  t.tileSize=Math.max(.25,Math.min(100,+$('sceneTextureTileSize')?.value||2.5));
  scene3DSyncTextureStatus();scene3DRenderViewport()
}
function scene3DApplyTextureFile(file){
  const p=scene3DSelectedPart(),face=$('sceneTextureFace')?.value||'front';if(!p||!file||!file.type.startsWith('image/'))return;
  const reader=new FileReader();reader.onload=()=>{p.faceTextures=p.faceTextures||{};p.faceTextures[face]={name:file.name,type:file.type,data:String(reader.result),mode:'stretch',tileSize:2.5};scene3DSyncTextureStatus();scene3DRenderViewport()};reader.readAsDataURL(file)
}
function scene3DTextureAverage(data,cb){
  const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=c.height=16;const x=c.getContext('2d');x.drawImage(img,0,0,16,16);const d=x.getImageData(0,0,16,16).data;let r=0,g=0,b=0;for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2]}const n=d.length/4;cb(`#${[r/n,g/n,b/n].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('')}`)};img.src=data
}
function scene3DAddPart(){const kind=$('scenePrimitiveKind').value,p=scene3DPartDefaults(kind),v=scene3DActiveVariant();v.parts.push(p);scene3DSelected=p.id;scene3DSyncInspector();scene3DRenderViewport()}
function scene3DDeleteSelected(){const v=scene3DActiveVariant();if(!v||!scene3DSelected)return;v.parts=v.parts.filter(p=>p.id!==scene3DSelected);scene3DSelected=null;scene3DSyncInspector();scene3DRenderViewport()}
function scene3DDuplicateSelected(){const v=scene3DActiveVariant(),p=v?.parts.find(p=>p.id===scene3DSelected);if(!p)return;const q={...deepCloneState(p),id:'mesh-'+uid(),label:(p.label||p.kind)+' Copy',x:(p.x||0)+1,z:(p.z||0)+1};v.parts.push(q);scene3DSelected=q.id;scene3DSyncInspector();scene3DRenderViewport()}
function scene3DFocusSelected(){const p=scene3DActiveVariant()?.parts.find(p=>p.id===scene3DSelected);if(!p)return;scene3DCamera.target=[p.x||0,p.y||0,p.z||0];scene3DCamera.distance=Math.max(7,Math.max(p.sx||1,p.sy||1,p.sz||1)*4);scene3DRenderViewport()}
function scene3DHitTest(canvas,e){
  const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*canvas.width,y=(e.clientY-r.top)/r.height*canvas.height,overlay=$('scene3DGizmo');
  const handle=[...(overlay?._handles||[])].find(h=>Math.hypot(x-h.x,y-h.y)<14);if(handle)return{kind:'handle',handle,x,y};
  const ring=overlay?._rotationRing;if(ring&&Math.abs(Math.hypot(x-ring.x,y-ring.y)-ring.r)<8)return{kind:'rotate',x,y};
  const obj=[...(canvas._scenePick||[])].sort((A,B)=>A.r-B.r).find(H=>Math.hypot(x-H.x,y-H.y)<H.r);return obj?{kind:'object',part:obj.part,x,y}:{kind:'empty',x,y}
}

function scene3DVisibleTextureFace(p){
  if(['Cylinder','Tower','Cone'].includes(p?.kind))return'wrap';const c=scene3DCamera,cp=Math.cos(c.pitch),eye=[c.target[0]+Math.sin(c.yaw)*cp*c.distance,c.target[1]+Math.sin(c.pitch)*c.distance,c.target[2]+Math.cos(c.yaw)*cp*c.distance];let d=[eye[0]-(p.x||0),eye[1]-(p.y||0),eye[2]-(p.z||0)];
  // Convert camera direction into object-local coordinates so a rotated cube still receives the visible face.
  const rz=-(p.rz||0),rx=-(p.rx||0),ry=-(p.ry||0),rotZ=v=>[v[0]*Math.cos(rz)-v[1]*Math.sin(rz),v[0]*Math.sin(rz)+v[1]*Math.cos(rz),v[2]],rotX=v=>[v[0],v[1]*Math.cos(rx)-v[2]*Math.sin(rx),v[1]*Math.sin(rx)+v[2]*Math.cos(rx)],rotY=v=>[v[0]*Math.cos(ry)+v[2]*Math.sin(ry),v[1],-v[0]*Math.sin(ry)+v[2]*Math.cos(ry)];d=rotY(rotX(rotZ(d)));const ax=Math.abs(d[0]),ay=Math.abs(d[1]),az=Math.abs(d[2]);if(ay>ax&&ay>az)return d[1]>=0?'top':'bottom';if(ax>az)return d[0]>=0?'right':'left';return d[2]>=0?'front':'back'
}
function scene3DApplyTextureFileToPart(file,p,face){
  if(!p||!file||!file.type.startsWith('image/'))return;const reader=new FileReader();reader.onload=()=>{p.faceTextures=p.faceTextures||{};p.faceTextures[face]={name:file.name,type:file.type,data:String(reader.result),mode:'stretch',tileSize:2.5};scene3DSelected=p.id;if($('sceneTextureFace'))$('sceneTextureFace').value=face;scene3DSyncInspector();scene3DRenderViewport()};reader.readAsDataURL(file)
}
function v285SolveScreenBasis(dx,dy,ax,ay,bx,by){const det=ax*by-ay*bx;if(Math.abs(det)<1e-5)return null;return{x:(dx*by-dy*bx)/det,z:(ax*dy-ay*dx)/det}}
function scene3DGroundScreenBasis(canvas,p){const vp=scene3DLastViewProj||scene3DCameraMatrices(canvas).vp,c=scene3DProject([p.x||0,p.y||0,p.z||0],canvas,vp),x=scene3DProject([(p.x||0)+1,p.y||0,p.z||0],canvas,vp),z=scene3DProject([p.x||0,p.y||0,(p.z||0)+1],canvas,vp);if(!c||!x||!z)return null;const r=canvas.getBoundingClientRect(),sx=r.width/canvas.width,sy=r.height/canvas.height;return{ax:(x.x-c.x)*sx,ay:(x.y-c.y)*sy,bx:(z.x-c.x)*sx,by:(z.y-c.y)*sy}}
function surface3DGroundScreenBasis(canvas,world){const glc=$('surfaceWebGLCanvas'),target=glc&&!glc.classList.contains('hidden')?glc:canvas,{vp}=surface3DCameraMatrices(target),c=surface3DProject([world.x,0,world.z],target,vp),x=surface3DProject([world.x+1,0,world.z],target,vp),z=surface3DProject([world.x,0,world.z+1],target,vp);if(!c||!x||!z)return null;const r=target.getBoundingClientRect(),sx=r.width/target.width,sy=r.height/target.height;return{ax:(x.x-c.x)*sx,ay:(x.y-c.y)*sy,bx:(z.x-c.x)*sx,by:(z.y-c.y)*sy}}
function scene3DBindCanvas(){
  const canvas=$('scene3DCanvas');if(!canvas||canvas.dataset.v28Bound)return;canvas.dataset.v28Bound='1';canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files')){e.preventDefault();canvas.classList.add('texture-dragover')}});
  canvas.addEventListener('dragleave',()=>canvas.classList.remove('texture-dragover'));
  canvas.addEventListener('drop',e=>{const file=e.dataTransfer?.files?.[0];if(!file?.type?.startsWith('image/'))return;e.preventDefault();canvas.classList.remove('texture-dragover');const hit=scene3DHitTest(canvas,e),p=hit.kind==='object'?hit.part:scene3DSelectedPart();if(p)scene3DApplyTextureFileToPart(file,p,scene3DVisibleTextureFace(p))});
  canvas.addEventListener('pointerdown',e=>{
    const hit=scene3DHitTest(canvas,e),p=scene3DActiveVariant()?.parts.find(x=>x.id===scene3DSelected);
    scene3DDrag={pointerId:e.pointerId,lastX:e.clientX,lastY:e.clientY,startX:e.clientX,startY:e.clientY,kind:'orbit',part:p,axis:null,snapshot:p?deepCloneState(p):null,startGround:p?scene3DRayPlaneY(canvas,e.clientX,e.clientY,p.y||0):null};
    if(e.button===1)scene3DDrag.kind=e.shiftKey?'pan':'orbit';
    else if(e.button===2)scene3DDrag.kind='pan';
    else if(hit.kind==='handle'){
      scene3DDrag.kind=hit.handle.kind;scene3DDrag.axis=hit.handle.axis;scene3DDrag.handle=hit.handle;
      scene3DDrag.startScale=p?{x:p.sx||1,y:p.sy||1,z:p.sz||1}:null;
      const q=scene3DClientToCanvas(canvas,e.clientX,e.clientY);
      scene3DDrag.startAlong=(q.x-hit.handle.cx)*hit.handle.ux+(q.y-hit.handle.cy)*hit.handle.uy;
      // The center white handle is itself the Move handle. Previously it intercepted
      // the object click but never initialized a movement basis/plane, so dragging a
      // selected part did nothing. Give it the exact same drag state as object-drag.
      if(hit.handle.kind==='move'&&p){
        scene3DDrag.part=p;
        scene3DDrag.snapshot=deepCloneState(p);
        scene3DDrag.startGround=scene3DRayPlaneY(canvas,e.clientX,e.clientY,p.y||0);
        scene3DDrag.groundBasis=scene3DGroundScreenBasis(canvas,p)
      }
    }
    else if(hit.kind==='rotate'){scene3DDrag.kind='rotate';const q=scene3DClientToCanvas(canvas,e.clientX,e.clientY),ring=$('scene3DGizmo')?._rotationRing;scene3DDrag.startAngle=ring?Math.atan2(q.y-ring.y,q.x-ring.x):0;scene3DDrag.startRY=p?.ry||0}
    else if(hit.kind==='object'){
      scene3DSelected=hit.part.id;scene3DDrag.part=hit.part;scene3DDrag.snapshot=deepCloneState(hit.part);
      scene3DDrag.kind=scene3DKeyMode||'move';
      scene3DDrag.startGround=scene3DRayPlaneY(canvas,e.clientX,e.clientY,hit.part.y||0);
      scene3DDrag.groundBasis=scene3DGroundScreenBasis(canvas,hit.part);scene3DSyncInspector()
    }
    else scene3DDrag.kind=e.shiftKey?'pan':'orbit';
    canvas.setPointerCapture?.(e.pointerId);scene3DRenderViewport();e.preventDefault()
  });
  canvas.addEventListener('pointermove',e=>{
    if(!scene3DDrag)return;const dx=e.clientX-scene3DDrag.lastX,dy=e.clientY-scene3DDrag.lastY;scene3DDrag.lastX=e.clientX;scene3DDrag.lastY=e.clientY;const p=scene3DActiveVariant()?.parts.find(x=>x.id===scene3DSelected),k=scene3DCamera.distance/28;
    if(scene3DDrag.kind==='orbit'){scene3DCamera.yaw+=dx*.008;scene3DCamera.pitch=Math.max(-1.48,Math.min(1.48,scene3DCamera.pitch+dy*.007))}
    else if(scene3DDrag.kind==='pan'){const right=[Math.cos(scene3DCamera.yaw),0,-Math.sin(scene3DCamera.yaw)],f=.022*k;scene3DCamera.target[0]-=right[0]*dx*f;scene3DCamera.target[2]-=right[2]*dx*f;scene3DCamera.target[1]+=dy*f}
    else if(p&&(scene3DDrag.kind==='move'||scene3DDrag.kind==='grab')){
      const snap=scene3DDrag.snapshot,start=scene3DDrag.startGround;
      const now=scene3DRayPlaneY(canvas,e.clientX,e.clientY,snap?.y||p.y||0);
      if(snap&&start&&now){
        p.x=(snap.x||0)+(now[0]-start[0]);
        p.z=(snap.z||0)+(now[2]-start[2])
      }else{
        // Near-horizontal camera angles can make the ray nearly parallel to the
        // movement plane, so retain the screen-basis solver as a robust fallback.
        const B=scene3DDrag.groundBasis,D=B?v285SolveScreenBasis(e.clientX-scene3DDrag.startX,e.clientY-scene3DDrag.startY,B.ax,B.ay,B.bx,B.by):null;
        if(D&&snap){p.x=(snap.x||0)+D.x;p.z=(snap.z||0)+D.z}
      }
    }
    else if(p&&scene3DDrag.kind==='scale'){const H=scene3DDrag.handle||{},q=scene3DClientToCanvas(canvas,e.clientX,e.clientY),along=(q.x-H.cx)*(H.ux||1)+(q.y-H.cy)*(H.uy||0),delta=(along-(scene3DDrag.startAlong||0))*(scene3DCamera.distance/28)*.024,S=scene3DDrag.startScale||{x:p.sx||1,y:p.sy||1,z:p.sz||1};if(scene3DDrag.axis==='x')p.sx=Math.max(.1,S.x+delta);if(scene3DDrag.axis==='y')p.sy=Math.max(.1,S.y+delta);if(scene3DDrag.axis==='z')p.sz=Math.max(.1,S.z+delta)}
    else if(p&&scene3DDrag.kind==='lift'){const H=scene3DDrag.handle||{},q=scene3DClientToCanvas(canvas,e.clientX,e.clientY),along=(q.x-H.cx)*(H.ux||0)+(q.y-H.cy)*(H.uy||-1),delta=(along-(scene3DDrag.startAlong||0))*(scene3DCamera.distance/28)*.03;p.y=Math.max(-40,Math.min(80,(scene3DDrag.snapshot?.y||0)+delta))}
    else if(p&&scene3DDrag.kind==='uniformScale'){const s=Math.max(.1,1+(e.clientX-scene3DDrag.startX-(e.clientY-scene3DDrag.startY))*.012);const S=scene3DDrag.snapshot||p;p.sx=Math.max(.1,(S.sx||1)*s);p.sy=Math.max(.1,(S.sy||1)*s);p.sz=Math.max(.1,(S.sz||1)*s)}
    else if(p&&scene3DDrag.kind==='rotate'){const q=scene3DClientToCanvas(canvas,e.clientX,e.clientY),ring=$('scene3DGizmo')?._rotationRing;if(ring){const ang=Math.atan2(q.y-ring.y,q.x-ring.x);p.ry=(scene3DDrag.startRY||0)+(ang-(scene3DDrag.startAngle||0))}}
    else if(p&&scene3DDrag.kind==='rotateKey')p.ry=(scene3DDrag.snapshot?.ry||0)+(e.clientX-scene3DDrag.startX)*.012;
    scene3DSyncInspector();scene3DRenderViewport()
  });
  canvas.addEventListener('pointerup',e=>{scene3DDrag=null;scene3DKeyMode='';$('scene3DMode')&&( $('scene3DMode').textContent='Select' );canvas.releasePointerCapture?.(e.pointerId)});
  canvas.addEventListener('pointercancel',()=>{scene3DDrag=null;scene3DKeyMode=''});
  canvas.addEventListener('wheel',e=>{e.preventDefault();const maxD=scene3DTargetType==='landscape'?460:180;scene3DCamera.distance=Math.max(2,Math.min(maxD,scene3DCamera.distance*Math.exp(e.deltaY*.001)));scene3DRenderViewport()},{passive:false});
  canvas.tabIndex=0;
  canvas.addEventListener('keydown',e=>{
    if(e.target!==canvas)return;
    if(e.key==='Delete'||e.key==='Backspace'){scene3DDeleteSelected();e.preventDefault();return}
    if(e.shiftKey&&e.key.toLowerCase()==='d'){scene3DDuplicateSelected();e.preventDefault();return}
    if(e.key.toLowerCase()==='f'){scene3DFocusSelected();e.preventDefault();return}
    if(e.key.toLowerCase()==='g'){scene3DKeyMode='grab';$('scene3DMode').textContent='Grab (click object and drag)';e.preventDefault();return}
    if(e.key.toLowerCase()==='s'){scene3DKeyMode='uniformScale';$('scene3DMode').textContent='Scale (click object and drag)';e.preventDefault();return}
    if(e.key.toLowerCase()==='r'){scene3DKeyMode='rotateKey';$('scene3DMode').textContent='Rotate (click object and drag)';e.preventDefault();return}
    if(e.key==='1'){scene3DCamera.yaw=0;scene3DCamera.pitch=0;scene3DRenderViewport();return}
    if(e.key==='3'){scene3DCamera.yaw=Math.PI/2;scene3DCamera.pitch=0;scene3DRenderViewport();return}
    if(e.key==='7'){scene3DCamera.pitch=Math.PI/2-0.01;scene3DRenderViewport();return}
  })
}
function scene3DInspectorInput(){
  const p=scene3DActiveVariant()?.parts.find(x=>x.id===scene3DSelected);if(!p)return;
  p.label=$('sceneObjName').value;p.color=$('sceneObjColor').value;p.x=+$('scenePosX').value||0;p.y=+$('scenePosY').value||0;p.z=+$('scenePosZ').value||0;p.rx=(+$('sceneRotX').value||0)*Math.PI/180;p.ry=(+$('sceneRotY').value||0)*Math.PI/180;p.rz=(+$('sceneRotZ').value||0)*Math.PI/180;scene3DRenderViewport()
}
function ensureScene3DPanel(){
  let panel=$('scene3DPanel');if(panel)return panel;
  panel=document.createElement('aside');panel.id='scene3DPanel';panel.className='scene3d-panel detached-editor-panel hidden';panel.innerHTML=`
    <div class="scene3d-head"><div><div class="eyebrow" id="scene3DEyebrow">3D Model</div><h3 id="scene3DTitle">Scene Modeller</h3></div><div class="scene3d-head-actions special-editor-window-actions"><span id="scene3DMode">Select</span><button type="button" id="scene3DMinimize" class="icon-btn">—</button><button type="button" id="scene3DClose" class="icon-btn">×</button></div></div>
    <div class="scene3d-toolbar">
      <select id="scenePrimitiveKind"><option>Cube</option><option>Wedge</option><option>Building</option><option>Tower</option><option>Cylinder</option><option>Sphere</option><option>Dome</option><option>Cone</option><option>Pyramid</option><option>Tree</option><option>Rock</option><option>Monument</option></select><button id="sceneAddPrimitive" class="primary">+ Add</button>
      <button id="sceneDuplicate" class="ghost">Duplicate</button><button id="sceneDelete" class="danger ghost">Delete</button>
      <span class="scene3d-sep scene-environment-only"></span><label id="sceneEnvironmentWrap">Environment<select id="sceneEnvironment"><option value="grass">Grass landscape</option><option value="desert">Desert</option><option value="gas">Gas giant atmosphere</option></select></label>
      <button id="sceneFocus" class="ghost">Focus Selected</button>
    </div>
    <div class="scene3d-main">
      <div class="scene3d-viewport"><canvas id="scene3DCanvas"></canvas><canvas id="scene3DGizmo"></canvas><div class="scene3d-corner-help"><b>Blender-style controls</b><span>MMB drag Orbit</span><span>Shift+MMB / RMB Pan</span><span>Wheel Zoom</span><span>LMB drag Move · G Move · S Scale · R Rotate</span><span>1 Front · 3 Side · 7 Top · F Focus</span><span>Shift+D Duplicate · Del Delete</span><span id="sceneLandscapeFootprintHint" class="hidden">Loader footprint: 360 × 360 world units · cyan edge = exact Surface boundary</span></div></div>
      <aside class="scene3d-inspector">
        <section><div class="scene3d-section-title">Outliner <span id="scene3DOutlinerCount">0</span></div><div id="scene3DOutliner" class="scene3d-outliner"></div></section>
        <section><div class="scene3d-section-title">Object <span id="scene3DSelectionLabel">Nothing selected</span></div><label>Name<input id="sceneObjName"></label><label>Color<input id="sceneObjColor" type="color"></label><div class="scene3d-texture-box"><div><b>Face Texture</b><small>Choose a face, then drop an image here or browse your PC.</small></div><select id="sceneTextureFace"><option value="front">Front</option><option value="back">Back</option><option value="left">Left</option><option value="right">Right</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="wrap">Wrap / curved side</option></select><label>Texture layout<select id="sceneTextureMode"><option value="stretch">Stretch</option><option value="tile">Tile / Repeat</option></select></label><label id="sceneTextureTileControls" class="hidden">Tile size <input id="sceneTextureTileSize" type="number" min=".25" max="100" step=".25" value="2.5"><small>World units per repeated image. Smaller = more copies.</small></label><div id="sceneTextureDrop" class="scene-texture-drop" tabindex="0">Drop texture image here<br><button type="button" id="sceneTextureBrowse" class="ghost">Browse PC…</button><input id="sceneTextureFile" type="file" accept="image/*" hidden></div><div id="sceneTextureStatus" class="scene-texture-status">No texture on this face.</div><button type="button" id="sceneTextureClear" class="danger ghost">Clear Face Texture</button></div></section>
        <section><div class="scene3d-section-title">Transform</div><div class="scene3d-xyz"><label>X<input id="scenePosX" type="number" step=".1"></label><label>Y<input id="scenePosY" type="number" step=".1"></label><label>Z<input id="scenePosZ" type="number" step=".1"></label></div><small>Position</small><div class="scene3d-align-grid"><select id="sceneAlignX"></select><select id="sceneAlignY"></select><select id="sceneAlignZ"></select></div><small>Comfort align — set this object's X, Y, or Z exactly to another object's position.</small><div class="scene3d-xyz"><label>X<input id="sceneRotX" type="number" step="1"></label><label>Y<input id="sceneRotY" type="number" step="1"></label><label>Z<input id="sceneRotZ" type="number" step="1"></label></div><small>Rotation °</small><div id="scene3DDimensions" class="scene3d-dimensions">—</div><small>Drag X / Y / Z to scale. Drag the cyan ↑ handle to move the object vertically without typing Y.</small></section>
        <section><div class="scene3d-section-title">Variants</div><select id="sceneVariantSelect"></select><div class="scene3d-button-grid"><button id="sceneVariantDuplicate" class="ghost">Duplicate Variant</button><button id="sceneVariantRename" class="ghost">Rename</button><button id="sceneVariantDelete" class="danger ghost">Delete</button><button id="sceneVariantMerge" class="ghost">Merge Variants</button></div><div id="sceneVariantMergeBox" class="scene-variant-merge-box hidden"><small>Combine the current variant with another one into a brand-new variant. Both source variants stay unchanged.</small><label>Merge current with<select id="sceneVariantMergeSelect"></select></label><label>New variant name<input id="sceneVariantMergeName" placeholder="Merged Variant"></label><div class="scene-repeat-actions"><button id="sceneVariantMergeConfirm" type="button" class="primary">Create Merged Variant</button><button id="sceneVariantMergeCancel" type="button" class="ghost">Cancel</button></div></div></section>
        <section><div class="scene3d-section-title">Repetition <label class="inline-check"><input id="sceneRepeatEnabled" type="checkbox"> Enabled</label></div><div id="sceneRepeatControls"><label>Layout<select id="sceneRepeatMode"><option value="grid">Grid</option><option value="line">Line</option><option value="radial">Radial</option><option value="area">Area scatter</option></select></label><label>Variants<select id="sceneRepeatVariantMode"><option value="active">Current variant</option><option value="cycle">Cycle variants</option><option value="random">Random variants</option></select></label><div data-repeat-mode="grid" class="scene3d-xyz"><label>X count<input id="sceneRepeatCountX" type="number" min="1" max="20"></label><label>Z count<input id="sceneRepeatCountZ" type="number" min="1" max="20"></label></div><label data-repeat-mode="line,radial,area">Count<input id="sceneRepeatCount" type="number" min="1" max="400"></label><div data-repeat-mode="grid,line" class="scene3d-xyz"><label>X spacing<input id="sceneRepeatSpacingX" type="number" min=".5" max="50" step=".5"></label><label data-repeat-mode="grid">Z spacing<input id="sceneRepeatSpacingZ" type="number" min=".5" max="50" step=".5"></label></div><label data-repeat-mode="radial">Radius<input id="sceneRepeatRadius" type="number" min="1" max="400" step=".5"></label><div data-repeat-mode="area" class="scene3d-xyz"><label>Area width<input id="sceneRepeatAreaWidth" type="number" min="1" max="300" step="1"></label><label>Area depth<input id="sceneRepeatAreaDepth" type="number" min="1" max="300" step="1"></label></div><label>Size variation <input id="sceneRepeatScaleVariation" type="range" min="0" max="80" step="1" value="0"><small id="sceneRepeatScaleVariationOut">0%</small></label><div class="scene-repeat-actions"><button id="sceneRepeatBake" type="button" class="primary">Save Repetition</button><button id="sceneRepeatAgain" type="button" class="ghost">Repetition Again</button></div><small>Save Repetition converts every repeated instance into real editable objects in the current variant, then turns repetition off.</small></div></section>
      </aside>
    </div>
    <div class="special-editor-savebar"><span id="scene3DStatus">Ready</span><button id="scene3DSaveReturn" class="primary">Save & Return</button></div>`;
  document.body.appendChild(panel);prepareDetachedEditorPanel(panel,panel.querySelector('.scene3d-head'));
  $('scene3DClose').onclick=()=>{panel.classList.add('hidden');$('sceneLandscapeWeatherPanel')?.classList.add('hidden')};$('scene3DMinimize').onclick=()=>minimizeSpecialEditor(panel,'3D Model');
  $('sceneAddPrimitive').onclick=scene3DAddPart;$('sceneDelete').onclick=scene3DDeleteSelected;$('sceneDuplicate').onclick=scene3DDuplicateSelected;$('sceneFocus').onclick=scene3DFocusSelected;
  $('sceneEnvironment').onchange=e=>{scene3DModel.environment=e.target.value;scene3DModel.groundColor=scene3DEnvironmentPreset(e.target.value).ground;scene3DRenderViewport()};
  for(const id of ['sceneObjName','sceneObjColor','scenePosX','scenePosY','scenePosZ','sceneRotX','sceneRotY','sceneRotZ'])$(id).addEventListener('input',scene3DInspectorInput);
  for(const axis of ['x','y','z'])$('sceneAlign'+axis.toUpperCase()).onchange=e=>{if(e.target.value)scene3DAlignAxis(axis,e.target.value)};
  $('sceneTextureFace').onchange=scene3DSyncTextureStatus;$('sceneTextureMode').onchange=scene3DSetTextureMode;$('sceneTextureTileSize').oninput=scene3DSetTextureMode;$('sceneTextureBrowse').onclick=()=>$('sceneTextureFile').click();$('sceneTextureFile').onchange=e=>scene3DApplyTextureFile(e.target.files?.[0]);
  const textureDrop=$('sceneTextureDrop');textureDrop.ondragover=e=>{e.preventDefault();textureDrop.classList.add('dragover')};textureDrop.ondragleave=()=>textureDrop.classList.remove('dragover');textureDrop.ondrop=e=>{e.preventDefault();textureDrop.classList.remove('dragover');scene3DApplyTextureFile(e.dataTransfer.files?.[0])};
  $('sceneTextureClear').onclick=()=>{const p=scene3DSelectedPart(),face=$('sceneTextureFace').value;if(p?.faceTextures){delete p.faceTextures[face];scene3DSyncTextureStatus();scene3DRenderViewport()}};
  $('sceneVariantSelect').onchange=e=>{scene3DModel.activeVariantId=e.target.value;scene3DSelected=scene3DActiveVariant()?.parts[0]?.id||null;syncScene3DLegacyParts();scene3DSyncInspector();scene3DRenderViewport()};
  $('sceneVariantDuplicate').onclick=()=>{const v=scene3DActiveVariant();if(!v)return;const nv={id:'variant-'+uid(),name:v.name+' Variant',parts:deepCloneState(v.parts).map(p=>({...p,id:'mesh-'+uid()}))};scene3DModel.variants.push(nv);scene3DModel.activeVariantId=nv.id;scene3DSelected=nv.parts[0]?.id||null;scene3DSyncVariantUI();scene3DSyncInspector();scene3DRenderViewport()};
  $('sceneVariantRename').onclick=()=>{const v=scene3DActiveVariant();if(!v)return;const name=prompt('Variant name',v.name);if(name?.trim()){v.name=name.trim();scene3DSyncVariantUI()}};
  $('sceneVariantDelete').onclick=()=>{if(scene3DModel.variants.length<=1)return;const i=scene3DModel.variants.findIndex(v=>v.id===scene3DModel.activeVariantId);scene3DModel.variants.splice(Math.max(0,i),1);scene3DModel.activeVariantId=scene3DModel.variants[0].id;scene3DSelected=scene3DActiveVariant()?.parts[0]?.id||null;scene3DSyncVariantUI();scene3DSyncInspector();scene3DRenderViewport()};
  const refreshVariantMerge=()=>{const active=scene3DActiveVariant(),sel=$('sceneVariantMergeSelect'),box=$('sceneVariantMergeBox');if(!sel||!box)return;const others=(scene3DModel?.variants||[]).filter(v=>v.id!==active?.id);sel.innerHTML=others.map(v=>`<option value="${v.id}">${E.esc(v.name)} · ${v.parts?.length||0} objects</option>`).join('');$('sceneVariantMerge').disabled=!others.length;if(!others.length)box.classList.add('hidden');if($('sceneVariantMergeName')&&!$('sceneVariantMergeName').value&&active&&others[0])$('sceneVariantMergeName').placeholder=`${active.name} + ${others[0].name}`};
  $('sceneVariantMerge').onclick=()=>{refreshVariantMerge();const box=$('sceneVariantMergeBox');if($('sceneVariantMerge').disabled)return;box.classList.toggle('hidden');if(!box.classList.contains('hidden')){$('sceneVariantMergeName').value='';$('sceneVariantMergeSelect').focus()}};
  $('sceneVariantMergeCancel').onclick=()=>$('sceneVariantMergeBox').classList.add('hidden');
  $('sceneVariantMergeSelect').onchange=()=>{const active=scene3DActiveVariant(),other=scene3DModel?.variants?.find(v=>v.id===$('sceneVariantMergeSelect').value);if(active&&other)$('sceneVariantMergeName').placeholder=`${active.name} + ${other.name}`};
  $('sceneVariantMergeConfirm').onclick=()=>{const a=scene3DActiveVariant(),b=scene3DModel?.variants?.find(v=>v.id===$('sceneVariantMergeSelect').value);if(!a||!b||a.id===b.id)return;const cloneParts=(parts,sourceName)=>(parts||[]).map(p=>({...deepCloneState(p),id:'mesh-'+uid(),mergedFromVariant:sourceName}));const requested=$('sceneVariantMergeName').value.trim(),name=requested||`${a.name} + ${b.name}`,nv={id:'variant-'+uid(),name,parts:[...cloneParts(a.parts,a.name),...cloneParts(b.parts,b.name)]};scene3DModel.variants.push(nv);scene3DModel.activeVariantId=nv.id;scene3DSelected=nv.parts[0]?.id||null;syncScene3DLegacyParts();scene3DSyncVariantUI();scene3DSyncInspector();scene3DRenderViewport();$('sceneVariantMergeBox').classList.add('hidden');refreshVariantMerge()};
  const repeatInput=()=>{const R=scene3DModel.repetition;R.enabled=$('sceneRepeatEnabled').checked;R.mode=$('sceneRepeatMode').value;R.variantMode=$('sceneRepeatVariantMode').value;R.countX=Math.max(1,+$('sceneRepeatCountX').value||1);R.countZ=Math.max(1,+$('sceneRepeatCountZ').value||1);R.count=Math.max(1,+$('sceneRepeatCount').value||1);R.spacingX=Math.max(.5,+$('sceneRepeatSpacingX').value||8);R.spacingZ=Math.max(.5,+$('sceneRepeatSpacingZ').value||8);R.radius=Math.max(1,+$('sceneRepeatRadius').value||14);R.areaWidth=Math.max(1,+$('sceneRepeatAreaWidth')?.value||70);R.areaDepth=Math.max(1,+$('sceneRepeatAreaDepth')?.value||70);R.scaleVariation=Math.max(0,Math.min(80,+$('sceneRepeatScaleVariation')?.value||0));if($('sceneRepeatScaleVariationOut'))$('sceneRepeatScaleVariationOut').textContent=`${Math.round(R.scaleVariation)}%`;scene3DRefreshRepeatVisibility();scene3DRenderViewport()};
  for(const id of ['sceneRepeatEnabled','sceneRepeatMode','sceneRepeatVariantMode','sceneRepeatCountX','sceneRepeatCountZ','sceneRepeatCount','sceneRepeatSpacingX','sceneRepeatSpacingZ','sceneRepeatRadius','sceneRepeatAreaWidth','sceneRepeatAreaDepth','sceneRepeatScaleVariation'])$(id).addEventListener('input',repeatInput);
  $('sceneRepeatBake').onclick=scene3DBakeRepetition;$('sceneRepeatAgain').onclick=scene3DRepetitionAgain;
  $('scene3DSaveReturn').onclick=()=>{
    syncScene3DLegacyParts();
    structureModelDraft=scene3DModelForSave(scene3DModel);
    if(scene3DTargetType==='structure'&&scene3DTargetNode?.type==='structure'&&!scene3DTargetNode.isMegastructure){
      scene3DTargetNode.structureModel=deepCloneState(structureModelDraft);
      save()
    }
    const s=$('structureModelSummary');
    if(s)s.textContent=`${scene3DModel.variants.length} variant${scene3DModel.variants.length===1?'':'s'} · ${scene3DRepeatInstances(scene3DModel).length} instance${scene3DRepeatInstances(scene3DModel).length===1?'':'s'}`;
    panel.classList.add('hidden')
  };
  scene3DBindCanvas();return panel
}
function openShared3DModelEditor(node,targetType='structure'){
  if(targetType!=='structure'||(node&&node.type!=='structure'))return;
  const panel=ensureScene3DPanel();scene3DTargetNode=node||null;scene3DTargetType='structure';
  const src=structureModelDraft||node?.structureModel;
  scene3DModel=normalizeScene3DModel(src);structureModelDraft=scene3DModel;
  scene3DSelected=scene3DActiveVariant()?.parts[0]?.id||null;scene3DCamera={yaw:.72,pitch:.42,distance:28,target:[0,2,0]};scene3DKeyMode='';
  $('scene3DEyebrow').textContent=targetType==='place'?'Place':'Structure';$('scene3DTitle').textContent=(node?.name||$('eName')?.value||'Untitled')+' · 3D Model';$('sceneEnvironment').value=scene3DModel.environment;scene3DSyncVariantUI();scene3DSyncInspector();panel.classList.remove('hidden');requestAnimationFrame(()=>{keepDetachedPanelOnscreen(panel);scene3DRenderViewport();$('scene3DCanvas')?.focus()})
}

function v28SuggestedSceneEnvironment(node,targetType){
  if(targetType==='place'){
    const planet=node?.surfacePlanetId?byId(node.surfacePlanetId):null;
    if(planet?.gasGiant)return'gas';
    if(/desert|dune|arid|sand/i.test([node?.placeType,node?.name,node?.description].join(' ')))return'desert';
    return'grass'
  }
  if(targetType==='structure'){
    const linked=ofType('place').find(p=>node&&graphNodesLinked(node.id,p.id));
    const planet=linked?.surfacePlanetId?byId(linked.surfacePlanetId):null;if(planet?.gasGiant)return'gas';
    if(/desert|dune|arid|sand/i.test([linked?.placeType,linked?.name,linked?.description].join(' ')))return'desert'
  }
  return'grass'
}
function bindPlaceModelEditor(node){
  const btn=$('openPlaceModelEditor'),launcher=btn?.closest('.place-model-launcher'),empty=$('.country-plus-model-empty');if(!btn)return;
  const scaleSelect=$('ePlaceScale'),syncAllowed=()=>{const draft={...node,placeScale:scaleSelect?.value||node?.placeScale},allowed=placeAllows3DModel(draft);launcher?.classList.toggle('hidden',!allowed);empty?.classList.toggle('hidden',allowed);btn.disabled=!allowed};
  scaleSelect?.addEventListener('change',syncAllowed);syncAllowed();
  const own=normalizeScene3DModel(node?.placeModel),base=node?.variantOfPlaceId?byId(node.variantOfPlaceId):null;
  placeModelDraft=own.variants.some(v=>v.parts.length)?own:normalizeScene3DModel(base?.placeModel);
  if(!node?.placeModel?.environment&&!base?.placeModel?.environment){placeModelDraft.environment=v28SuggestedSceneEnvironment(node,'place');placeModelDraft.groundColor=scene3DEnvironmentPreset(placeModelDraft.environment).ground}
  btn.onclick=()=>{const draft={...node,placeScale:$('ePlaceScale')?.value||node?.placeScale};if(placeAllows3DModel(draft))openShared3DModelEditor(node,'place')}
}
function bindStructureModelEditor(node){
  const btn=$('openStructureModelEditor');if(!btn)return;
  const own=normalizeScene3DModel(node?.structureModel),base=node?.variantOfStructureId?byId(node.variantOfStructureId):null;
  structureModelDraft=own.variants.some(v=>v.parts.length)?own:normalizeScene3DModel(base?.structureModel);
  if(!node?.structureModel?.environment&&!base?.structureModel?.environment){structureModelDraft.environment=v28SuggestedSceneEnvironment(node,'structure');structureModelDraft.groundColor=scene3DEnvironmentPreset(structureModelDraft.environment).ground}
  const sync=()=>{const mega=!!$('eIsMegastructure')?.checked;$('structureModelLauncher')?.classList.toggle('hidden',mega);btn.disabled=mega};
  $('eIsMegastructure')?.addEventListener('change',sync);sync();btn.onclick=()=>openShared3DModelEditor(node,'structure')
}


/* ============================ V28 UNIVERSAL CATEGORY SIDEBAR ============================ */
let universalCategoryDraft={category:'',parent:''};
function v28TypeLabel(type){
  const custom=creatorSettings?.nodeTypes?.find(t=>t.id===type)?.label;if(custom)return custom;
  return({mana:'Mana',spell:'Spell',rule:'Rule',material:'Material',magicalObject:'Magical Object',technique:'Technique',principle:'Principle',structure:'Structure',life:'Life',place:'Place',organization:'Organization',civilizationUtil:'Civilization Utility'})[type]||String(type||'Category')
}
function v28NodeGraphCategory(n){return String(n?.graphCategory||n?.category||'').trim()}
function v28NodeGraphParent(n){return String(n?.graphParentCategory||n?.parentCategory||'').trim()}
function v28KnownCategories(extra=''){
  const out=new Map(),add=(name,parent='')=>{name=String(name||'').trim();if(!name)return;if(!out.has(name.toLowerCase()))out.set(name.toLowerCase(),{name,parent:String(parent||'').trim()});else if(parent&&!out.get(name.toLowerCase()).parent)out.get(name.toLowerCase()).parent=String(parent).trim()};
  for(const n of nodes)if(!n.virtual){add(v28NodeGraphCategory(n),v28NodeGraphParent(n))}
  for(const cat of creatorSettings?.categories||[]){const parent=(creatorSettings.categories||[]).find(p=>p.id===cat.parentId);add(cat.label||cat.id,parent?.label||parent?.id||'')}
  add(extra);return[...out.values()].sort((a,b)=>a.name.localeCompare(b.name))
}
function v28CategoryParent(category){
  const q=String(category||'').trim().toLowerCase();if(!q)return'';
  const authored=nodes.find(n=>!n.virtual&&v28NodeGraphCategory(n).toLowerCase()===q&&v28NodeGraphParent(n));if(authored)return v28NodeGraphParent(authored);
  const c=(creatorSettings?.categories||[]).find(c=>String(c.label||c.id).trim().toLowerCase()===q||String(c.id).toLowerCase()===q);if(c?.parentId){const p=creatorSettings.categories.find(x=>x.id===c.parentId);return p?.label||p?.id||''}return''
}
function v28CategoryPath(category,parent=universalCategoryDraft.parent){
  const path=[],seen=new Set();let cur=String(category||'').trim(),par=String(parent||'').trim();if(cur)path.unshift(cur);
  while(par&&path.length<12){const k=par.toLowerCase();if(seen.has(k))break;seen.add(k);path.unshift(par);par=v28CategoryParent(par)}
  return path.join(' › ')||'Uncategorized'
}
function ensureUniversalCategoryPanel(){
  let panel=$('universalCategoryPanel');if(panel)return panel;
  panel=document.createElement('aside');panel.id='universalCategoryPanel';panel.className='universal-category-panel detached-editor-panel hidden';panel.innerHTML=`
    <div class="universal-category-head"><div><div class="eyebrow">Always available</div><b>Category</b></div><span id="universalCategoryType">Node</span></div>
    <div class="universal-category-body">
      <label>Category<input id="universalCategoryName" list="universalCategoryList" placeholder="Type or choose any category"><datalist id="universalCategoryList"></datalist></label>
      <label>Subcategory of<select id="universalCategoryParent"><option value="">Nothing — top level</option></select></label>
      <div id="universalCategoryPath" class="universal-category-path">Uncategorized</div>
      <small>This menu appears for every node type. Setting a parent applies to the category itself, so every node in that category shares the same hierarchy.</small>
      <div class="universal-category-all"><div><b>All categories</b><span id="universalCategoryCount">0</span></div><div id="universalCategoryAllRows"></div></div>
    </div>`;
  document.body.appendChild(panel);makePanelDraggable(panel,panel.querySelector('.universal-category-head'));
  $('universalCategoryName').addEventListener('input',()=>{universalCategoryDraft.category=$('universalCategoryName').value.trim();v28RefreshUniversalCategoryPanel()});
  $('universalCategoryParent').addEventListener('change',()=>{const parent=$('universalCategoryParent').value;if(parent&&parent.toLowerCase()===universalCategoryDraft.category.toLowerCase()){$('universalCategoryParent').value='';universalCategoryDraft.parent=''}else universalCategoryDraft.parent=parent;v28RefreshUniversalCategoryPanel(false)});
  return panel
}

function v28CategoryWouldCycle(category,parent){
  category=String(category||'').trim();parent=String(parent||'').trim();if(!category||!parent)return false;if(category.toLowerCase()===parent.toLowerCase())return true;
  const map=new Map(v28KnownCategories(category).map(c=>[c.name.toLowerCase(),String(c.parent||'').toLowerCase()]));map.set(category.toLowerCase(),parent.toLowerCase());
  let cur=parent.toLowerCase(),seen=new Set([category.toLowerCase()]);while(cur){if(seen.has(cur))return true;seen.add(cur);cur=map.get(cur)||''}return false
}
function v28SetGlobalCategoryParent(category,parent){
  category=String(category||'').trim();parent=String(parent||'').trim();if(!category||v28CategoryWouldCycle(category,parent))return false;
  for(const n of nodes)if(!n.virtual&&v28NodeGraphCategory(n).toLowerCase()===category.toLowerCase())n.graphParentCategory=parent;
  const def=(creatorSettings?.categories||[]).find(c=>String(c.label||c.id).trim().toLowerCase()===category.toLowerCase()||String(c.id).toLowerCase()===category.toLowerCase());
  if(def){const p=(creatorSettings.categories||[]).find(c=>String(c.label||c.id).trim().toLowerCase()===parent.toLowerCase()||String(c.id).toLowerCase()===parent.toLowerCase());def.parentId=p?.id||''}
  if(universalCategoryDraft.category.toLowerCase()===category.toLowerCase())universalCategoryDraft.parent=parent;
  rebuildEdges();save();return true
}
function v28RefreshUniversalCategoryPanel(rebuildParent=true){
  const cat=universalCategoryDraft.category,known=v28KnownCategories(cat),list=$('universalCategoryList'),parent=$('universalCategoryParent');if(!list||!parent)return;
  list.innerHTML=known.map(c=>`<option value="${E.esc(c.name)}"></option>`).join('');
  if(rebuildParent){const keep=universalCategoryDraft.parent||v28CategoryParent(cat);parent.innerHTML='<option value="">Nothing — top level</option>'+known.filter(c=>c.name.toLowerCase()!==cat.toLowerCase()).map(c=>`<option value="${E.esc(c.name)}">${E.esc(c.name)}</option>`).join('');parent.value=keep;universalCategoryDraft.parent=parent.value||keep||''}
  $('universalCategoryPath').textContent=v28CategoryPath(cat,universalCategoryDraft.parent);
  $('universalCategoryCount').textContent=String(known.length);
  const allHost=$('universalCategoryAllRows');
  allHost.innerHTML=known.map(c=>`<div class="universal-category-row" data-universal-category="${E.esc(c.name)}"><b>${E.esc(c.name)}</b><select title="Parent category"><option value="">Top level</option>${known.filter(p=>p.name.toLowerCase()!==c.name.toLowerCase()).map(p=>`<option value="${E.esc(p.name)}" ${String(c.parent).toLowerCase()===p.name.toLowerCase()?'selected':''}>↳ ${E.esc(p.name)}</option>`).join('')}</select></div>`).join('');
  allHost.querySelectorAll('[data-universal-category] select').forEach(sel=>sel.onchange=()=>{const row=sel.closest('[data-universal-category]'),catName=row.dataset.universalCategory,previous=v28CategoryParent(catName);if(!v28SetGlobalCategoryParent(catName,sel.value)){sel.value=previous;sel.classList.add('requirement-missing');setTimeout(()=>sel.classList.remove('requirement-missing'),800)}v28RefreshUniversalCategoryPanel()})
}
function showUniversalCategoryPanel(node,type){
  const panel=ensureUniversalCategoryPanel();
  let category=node?.graphCategory||node?.category||'';
  if(!category&&type==='civilizationUtil')category=utilitySubtypeLabel(node?.utilityType||window.__pendingCivilizationUtilType||'language');
  if(!category)category=v28TypeLabel(type);
  universalCategoryDraft={category:String(category||'').trim(),parent:String(node?.graphParentCategory||node?.parentCategory||v28CategoryParent(category)||'').trim()};
  $('universalCategoryName').value=universalCategoryDraft.category;$('universalCategoryType').textContent=v28TypeLabel(type);panel.classList.remove('hidden');v28RefreshUniversalCategoryPanel();requestAnimationFrame(()=>keepDetachedPanelOnscreen(panel))
}
function hideUniversalCategoryPanel(){$('universalCategoryPanel')?.classList.add('hidden')}
function applyUniversalCategoryToNode(n){
  if(!n)return;
  const cat=String(universalCategoryDraft.category||'').trim(),parent=String(universalCategoryDraft.parent||'').trim();
  n.graphCategory=cat;n.graphParentCategory=(parent&&parent.toLowerCase()!==cat.toLowerCase())?parent:'';
  if(cat){
    for(const other of nodes){
      if(other===n||other.virtual)continue;
      if(v28NodeGraphCategory(other).toLowerCase()===cat.toLowerCase())other.graphParentCategory=n.graphParentCategory
    }
  }
}

function makePanelDraggable(panel,handle){
  if(!panel||!handle||draggablePanelState.has(panel))return;

  const state={
    dragging:false,
    pointerId:null,
    startClientX:0,
    startClientY:0,
    startOffsetX:0,
    startOffsetY:0
  };
  draggablePanelState.set(panel,state);
  panel.classList.add('draggable-ui-panel');

  handle.classList.add('drag-handle');

  handle.addEventListener('pointerdown',ev=>{
    if(ev.button!==0)return;
    if(ev.target.closest('button,input,select,textarea,a,label'))return;

    const offset=panelDragOffset(panel);

    state.dragging=true;
    state.pointerId=ev.pointerId;
    state.startClientX=ev.clientX;
    state.startClientY=ev.clientY;
    state.startOffsetX=offset.x;
    state.startOffsetY=offset.y;

    handle.setPointerCapture?.(ev.pointerId);
    panel.classList.add('ui-panel-dragging');
    document.body.classList.add('dragging-ui-panel');

    ev.preventDefault()
  });

  handle.addEventListener('pointermove',ev=>{
    if(!state.dragging||ev.pointerId!==state.pointerId)return;

    let nextX=state.startOffsetX+(ev.clientX-state.startClientX);
    let nextY=state.startOffsetY+(ev.clientY-state.startClientY);

    const clamped=clampPanelDrag(panel,nextX,nextY);
    panel.dataset.dragX=String(clamped.x);
    panel.dataset.dragY=String(clamped.y);
    applyPanelDragTransform(panel)
  });

  const finish=ev=>{
    if(!state.dragging)return;
    if(ev?.pointerId!=null&&ev.pointerId!==state.pointerId)return;

    state.dragging=false;
    state.pointerId=null;
    panel.classList.remove('ui-panel-dragging');
    document.body.classList.remove('dragging-ui-panel')
  };

  handle.addEventListener('pointerup',finish);
  handle.addEventListener('pointercancel',finish)
}

function bindDraggableEditorPanels(){
  const modal=$('editorModal');
  if(!modal)return;

  // MAIN EDITOR is its own drag entity.
  // Side panels are siblings and do not move when the main card is dragged.
  const main=modal.querySelector('.editor-main-card');
  const mainHandle=main?.querySelector('.modal-head');
  if(main&&mainHandle)makePanelDraggable(main,mainHandle);

  // Side panels stay in normal layout and move via transform offsets too.
  const sidePanels=[
    '.auto-connections-drawer',
    '.planet-palette-panel',
    '.solar-system-editor-panel',
    '.star-editor-panel',
    '.megastructure-editor-panel'
  ];

  sidePanels.forEach(sel=>{
    const panel=modal.querySelector(sel);
    if(!panel||panel.classList.contains('hidden'))return;

    const handle=
      panel.querySelector('.section-title-row,.panel-head,.drawer-head,.modal-head,h3,h2')
      ||panel.firstElementChild;

    if(handle)makePanelDraggable(panel,handle)
  })
}

function keepDetachedPanelOnscreen(panel){
  if(!panel||panel.classList.contains('hidden'))return;
  const off=panelDragOffset(panel),next=clampPanelDrag(panel,off.x,off.y);
  panel.dataset.dragX=String(next.x);panel.dataset.dragY=String(next.y);applyPanelDragTransform(panel)
}

function bindGlobalDraggableMenus(){
  // Every conventional modal card gets a draggable title bar.
  document.querySelectorAll('.modal:not(.hidden) .modal-card').forEach(card=>{
    const head=card.querySelector(':scope > .modal-head');
    if(head)makePanelDraggable(card,head)
  });
  // Detached editor panels are true viewport siblings, not layout children.
  [['materialTexturePanel','.material-texture-panel-head'],['craftingGraphPanel','.crafting-graph-head']].forEach(([id,sel])=>{
    const panel=$(id),head=panel?.querySelector(sel);if(panel&&head)makePanelDraggable(panel,head)
  });
  const mega=document.querySelector('body > .mega-painter.expanded');
  const megaHead=mega?.querySelector(':scope > .section-title-row');
  if(mega&&megaHead)makePanelDraggable(mega,megaHead);
  const create=$('createMenu');
  const createHead=create?.querySelector(':scope > .eyebrow');
  if(create&&!create.classList.contains('hidden')&&createHead)makePanelDraggable(create,createHead)
}

function resetDraggableEditorPanels(){
  const modal=$('editorModal');
  if(!modal)return;

  modal.querySelectorAll(
    '.editor-main-card,.auto-connections-drawer,.planet-palette-panel,.solar-system-editor-panel,.star-editor-panel,.megastructure-editor-panel,#materialTexturePanel,#craftingGraphPanel'
  ).forEach(panel=>{
    panel.dataset.dragX='0';
    panel.dataset.dragY='0';
    panel.style.removeProperty('--panel-drag-x');
    panel.style.removeProperty('--panel-drag-y');
    panel.classList.remove('ui-panel-dragging')
  })
}

// Resizing keeps moved panels visible without changing positioning mode.
window.addEventListener('resize',()=>{
  document.querySelectorAll(
    '#editorModal .editor-main-card,#editorModal .auto-connections-drawer,#editorModal .planet-palette-panel,#editorModal .solar-system-editor-panel,#editorModal .star-editor-panel,#editorModal .megastructure-editor-panel,body>#materialTexturePanel,body>#craftingGraphPanel,body>.mega-painter.expanded'
  ).forEach(panel=>{
    const off=panelDragOffset(panel);
    const next=clampPanelDrag(panel,off.x,off.y);
    panel.dataset.dragX=String(next.x);
    panel.dataset.dragY=String(next.y);
    applyPanelDragTransform(panel)
  })
});

function sanitizePathogenGenome(raw){
  // Fictional worldbuilding genome. "-" is a persistent missing-gene/base slot; U is deliberately corrupted/flawed.
  return String(raw||'').toUpperCase().replace(/[^ACGTU-]/g,'').slice(0,72)
}
function normalizePathogenGenome(raw){
  const s=sanitizePathogenGenome(raw);return (s+'-'.repeat(72)).slice(0,72)
}
function generatePathogenGenome(length=72){
  const chars='ACGT';let out='';for(let i=0;i<Math.min(72,Math.max(0,length));i++)out+=chars[Math.floor(Math.random()*chars.length)];return (out+'-'.repeat(72)).slice(0,72)
}
function pathogenComplement(seq){const c={A:'T',T:'A',C:'G',G:'C',U:'U','-':'-'};return [...normalizePathogenGenome(seq)].map(x=>c[x]||'-').join('')}
function pathogenGenomeStats(seq){
  const s=normalizePathogenGenome(seq),present=[...s].filter(x=>x!=='-'),gc=present.filter(x=>x==='G'||x==='C').length,corrupt=[...s].filter(x=>x==='U').length,missing=[...s].filter(x=>x==='-').length;
  // Missing genetic material is treated as a stronger flaw than a corrupted base in this fictional model.
  const flaws=corrupt+(missing*2);
  return {length:present.length,totalSlots:72,gc:present.length?Math.round(gc/present.length*100):0,segments:6,corrupt,missing,flaws}
}
function selectedPathogenGene(){const sel=$('eDiseaseGeneSelect');return Math.max(0,Math.min(5,+sel?.value||0))}
function setSelectedPathogenGene(i){const sel=$('eDiseaseGeneSelect');if(sel)sel.value=String(Math.max(0,Math.min(5,i|0)))}
function pathogenGeneChunks(seq){return normalizePathogenGenome((seq ?? $('eDiseaseGenome')?.value) || '').match(/.{12}/g)||Array(6).fill('------------')}
function pathogenHelixMarkup(seq,compSeq,{large=false,geneIndex=0,viewer=false}={}){
  const letters=[...String(seq||'').padEnd(12,'-').slice(0,12)],comps=[...String(compSeq||'').padEnd(12,'-').slice(0,12)],n=12;
  const color={A:'#8f6cff',T:'#4eb6ff',C:'#ffc94f',G:'#5fe0a0',U:'#ff5e68','-':'#7890a8'};
  if(!large){
    const left=[],right=[],rungs=[];
    for(let i=0;i<n;i++){
      const t=i/(n-1),phase=t*Math.PI*4-Math.PI/2,w=Math.sin(phase)*25;
      const x1=27+w,x2=73-w,y=7+t*86,b=letters[i],cb=comps[i]||'-',missing=b==='-';
      left.push(`${x1.toFixed(2)},${y.toFixed(2)}`);right.push(`${x2.toFixed(2)},${y.toFixed(2)}`);
      rungs.push(`<line class="dna-svg-rung ${missing?'missing':''} ${b==='U'?'corrupt':''}" x1="${x1.toFixed(2)}" y1="${y.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${color[b]||color['-']}"${missing?' stroke-dasharray="3 3"':''}><title>${missing?'Missing gene/base':`Base ${b} paired with ${cb}`}</title></line>`);
    }
    return `<span class="dna-helix-stage mini"><svg class="dna-editor-svg mini" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-label="DNA strand"><polyline class="dna-svg-backbone left" points="${left.join(' ')}"></polyline><polyline class="dna-svg-backbone right" points="${right.join(' ')}"></polyline>${rungs.join('')}</svg></span>`;
  }

  // v25.3k: the CLICKED / ENLARGED gene block is intentionally canvas-backed.
  // Previous builds proved the interaction coordinates were correct while SVG paint
  // could be hidden by inherited/legacy CSS. Canvas is isolated from that CSS stack.
  const W=960,H=300,x0=54,x1=906,cy=150,amp=88,cycles=2.35;
  const hits=[];
  for(let i=0;i<n;i++){
    const t=(i+.5)/n,x=x0+t*(x1-x0),phase=t*Math.PI*2*cycles-Math.PI/2,w=Math.sin(phase)*amp;
    const yA=cy+w,yB=cy-w,b=letters[i],missing=b==='-';
    const top=Math.min(yA,yB),bottom=Math.max(yA,yB);
    const leftPct=(x/W*100).toFixed(3),topPct=(top/H*100).toFixed(3),heightPct=Math.max(8,(bottom-top)/H*100).toFixed(3);
    if(!missing){
      hits.push(`<span draggable="true" data-gene-base="${i}" data-gene-index="${geneIndex}" class="dna-enlarged-hit ${b==='U'?'corrupt':''}" style="--dna-x:${leftPct}%;--dna-y:${topPct}%;--dna-h:${heightPct}%" title="Drag base ${b}"><i>${b}</i></span>`);
    }else{
      hits.push(`<span class="dna-enlarged-missing" style="--dna-x:${leftPct}%;--dna-y:50%" title="Missing gene/base">∅</span>`);
    }
  }
  const safeSeq=letters.join('');
  const safeComp=comps.join('');
  return `<span class="dna-enlarged-stage dna-canvas-stage" data-dna-large-seq="${safeSeq}" data-dna-large-comp="${safeComp}" style="position:relative;display:block;width:100%;max-width:${W}px;aspect-ratio:${W}/${H};height:auto;margin:auto;overflow:hidden;isolation:isolate;">
    <canvas class="dna-enlarged-canvas" width="${W}" height="${H}" aria-label="Editable enlarged DNA strand" style="position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:2;"></canvas>${hits.join('')}
  </span>`;
}

function paintPathogenEnlargedCanvases(root=document){
  const color={A:'#8f6cff',T:'#4eb6ff',C:'#ffc94f',G:'#5fe0a0',U:'#ff5e68','-':'#7890a8'};
  root.querySelectorAll('.dna-canvas-stage').forEach(stage=>{
    const canvas=stage.querySelector('.dna-enlarged-canvas');
    if(!canvas)return;
    const ctx=canvas.getContext('2d');
    if(!ctx)return;

    // v25.3k stability: paint at the stage's ACTUAL laid-out size.
    // CSS owns the panel height; JS never changes it. This prevents the renderer
    // from squashing the editor when its width changes.
    const rect=stage.getBoundingClientRect();
    const cssW=Math.max(180,Math.floor(rect.width||stage.clientWidth||720));
    const cssH=Math.max(180,Math.floor(rect.height||stage.clientHeight||270));
    const dpr=Math.min(2,window.devicePixelRatio||1);
    const pxW=Math.max(1,Math.round(cssW*dpr)),pxH=Math.max(1,Math.round(cssH*dpr));
    if(canvas.width!==pxW)canvas.width=pxW;
    if(canvas.height!==pxH)canvas.height=pxH;
    canvas.style.width='100%';
    canvas.style.height='100%';

    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cssW,cssH);

    const n=12;
    const padX=Math.max(18,cssW*.055);
    const x0=padX,x1=cssW-padX;
    const cy=cssH/2;
    const amp=Math.min(cssH*.29,Math.max(26,cssH/2-20));
    const cycles=2.35;
    const seq=String(stage.dataset.dnaLargeSeq||'').padEnd(n,'-').slice(0,n);
    const comp=String(stage.dataset.dnaLargeComp||'').padEnd(n,'-').slice(0,n);

    const traceBackbone=(flip,stroke,alpha)=>{
      ctx.save();
      ctx.beginPath();
      for(let j=0;j<=240;j++){
        const t=j/240,x=x0+t*(x1-x0),phase=t*Math.PI*2*cycles-Math.PI/2,w=Math.sin(phase)*amp*flip,y=cy+w;
        if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.strokeStyle=stroke;ctx.globalAlpha=alpha;
      ctx.lineWidth=Math.max(4,Math.min(10,cssH*.033));
      ctx.lineCap='round';ctx.lineJoin='round';
      ctx.shadowColor='rgba(91,174,236,.28)';ctx.shadowBlur=Math.max(3,cssH*.02);
      ctx.stroke();ctx.restore();
    };
    traceBackbone(1,'#8fbfe7',.92);
    traceBackbone(-1,'#d1e9ff',.78);

    for(let i=0;i<n;i++){
      const t=(i+.5)/n,x=x0+t*(x1-x0),phase=t*Math.PI*2*cycles-Math.PI/2,w=Math.sin(phase)*amp;
      const yA=cy+w,yB=cy-w,b=seq[i]||'-',cb=comp[i]||'-',missing=b==='-';
      ctx.save();
      ctx.beginPath();ctx.moveTo(x,yA);ctx.lineTo(x,yB);
      ctx.strokeStyle=color[b]||color['-'];ctx.lineCap='round';
      ctx.lineWidth=missing?Math.max(2,cssH*.014):Math.max(6,Math.min(12,cssH*.04));
      ctx.globalAlpha=missing?.62:1;
      if(missing)ctx.setLineDash([Math.max(5,cssH*.034),Math.max(4,cssH*.027)]);
      ctx.shadowColor=b==='U'?'rgba(255,94,104,.7)':'rgba(120,190,255,.22)';
      ctx.shadowBlur=b==='U'?Math.max(5,cssH*.03):Math.max(2,cssH*.013);
      ctx.stroke();ctx.restore();

      if(!missing && cssH>=125){
        const mid=(yA+yB)/2;
        ctx.save();
        const fontSize=Math.max(8,Math.min(12,cssH*.04));
        ctx.font=`700 ${fontSize}px ui-monospace, monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
        const label=b+(cb&&cb!=='-'?'/'+cb:'');
        const tw=Math.max(20,ctx.measureText(label).width+8),th=fontSize+7;
        ctx.fillStyle='rgba(7,17,27,.94)';ctx.fillRect(x-tw/2,mid-th/2,tw,th);
        ctx.fillStyle='#e7f5ff';ctx.fillText(label,x,mid);ctx.restore();
      }
    }

    // Repaint this exact block if its editor column changes size.
    if(!stage.__dnaResizeObserver && typeof ResizeObserver!=='undefined'){
      stage.__dnaResizeObserver=new ResizeObserver(()=>{
        if(stage.__dnaResizeFrame)cancelAnimationFrame(stage.__dnaResizeFrame);
        stage.__dnaResizeFrame=requestAnimationFrame(()=>paintPathogenEnlargedCanvases(stage.parentElement||document));
      });
      stage.__dnaResizeObserver.observe(stage);
    }
  });
}
function pathogenViewerHelixMarkup(seq,compSeq){
  // Compact node-info renderer: one SVG owns both backbones and rungs so tiny viewer scaling cannot de-sync them.
  const letters=[...String(seq||'').padEnd(12,'-').slice(0,12)],comps=[...String(compSeq||'').padEnd(12,'-').slice(0,12)];
  const ptsL=[],ptsR=[],rungs=[],n=12;
  const color={A:'#71df9d',T:'#66bfff',C:'#ffd36a',G:'#b995ff',U:'#ff74bc','-':'#9b5f75'};
  letters.forEach((b,i)=>{
    const t=i/(n-1),phase=t*Math.PI*4-Math.PI/2,wave=Math.sin(phase)*21;
    const xL=27+wave,xR=73-wave,y=4+t*92,cb=comps[i]||'-';
    ptsL.push(`${xL.toFixed(2)},${y.toFixed(2)}`);ptsR.push(`${xR.toFixed(2)},${y.toFixed(2)}`);
    const missing=b==='-',stroke=color[b]||'#91a4b8',dash=missing?' stroke-dasharray="3 2"':'';
    rungs.push(`<line x1="${xL.toFixed(2)}" y1="${y.toFixed(2)}" x2="${xR.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${stroke}" stroke-width="3.2" stroke-linecap="round"${dash}><title>${missing?'Missing gene/base':`Base ${b} paired with ${cb}`}</title></line>`);
  });
  return `<svg class="dna-viewer-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-label="DNA strand"><polyline class="dna-viewer-backbone left" points="${ptsL.join(' ')}"></polyline><polyline class="dna-viewer-backbone right" points="${ptsR.join(' ')}"></polyline>${rungs.join('')}</svg>`;
}

function ensureDiseaseStrandSidePanel(){let panel=$('diseaseStrandSidePanel');if(panel)return panel;panel=document.createElement('aside');panel.id='diseaseStrandSidePanel';panel.className='disease-strand-side-panel detached-editor-panel hidden';panel.innerHTML=`<div class="disease-strand-side-head"><div><div class="eyebrow">Disease</div><b>Selected DNA Strand</b></div><button id="closeDiseaseStrandSide" class="icon-btn">×</button></div><div id="diseaseStrandSideBody"></div>`;document.body.appendChild(panel);makePanelDraggable(panel,panel.querySelector('.disease-strand-side-head'));$('closeDiseaseStrandSide').onclick=()=>panel.classList.add('hidden');return panel}
function renderDiseaseStrandSidePanel(detail,palette){const panel=ensureDiseaseStrandSidePanel(),body=$('diseaseStrandSideBody');panel.classList.remove('hidden');body.innerHTML=`${detail}<aside class="dna-palette-panel"><div class="dna-palette-title">BASE PALETTE</div>${palette}<div class="dna-palette-help">Selecting another strand updates this side menu.</div></aside>`;paintPathogenEnlargedCanvases(body)}
function renderPathogenGenome(){
  const input=$('eDiseaseGenome'),view=$('pathogenGenomeView'),stats=$('pathogenGenomeStats');if(!input||!view||!stats)return;
  const clean=normalizePathogenGenome(input.value);if(input.value!==clean)input.value=clean;
  const chunks=pathogenGeneChunks(clean),comp=pathogenGeneChunks(pathogenComplement(clean));
  let selected=selectedPathogenGene();setSelectedPathogenGene(selected);
  const palette=`<div class="dna-base-palette"><span>DRAG BASES ONTO A STRAND</span>${['A','C','G','T','U'].map(b=>`<b draggable="true" class="dna-palette-base ${b==='U'?'corrupt':''}" data-palette-base="${b}" title="${b==='U'?'Corrupted / flawed fictional base':'Base '+b}">${b}</b>`).join('')}</div>`;
  const field=chunks.map((x,i)=>{const y=comp[i]||'';const miss=[...x].filter(b=>b==='-').length,cor=[...x].filter(b=>b==='U').length,flaws=cor+miss*2;return `<button type="button" class="dna-strand-card ${i===selected?'selected':''} ${(cor||miss)?'has-corruption':''}" data-dna-gene="${i}">
    <span class="dna-strand-index">Gene block ${i+1}</span>
    ${pathogenHelixMarkup(x,y)}
    <span class="dna-strand-count">${12-miss} / 12</span>
    <span class="dna-strand-flaws ${flaws?'bad':'good'}">Flaws: ${flaws}</span>
  </button>`}).join('');
  const active=chunks[selected]||'------------',activeComp=comp[selected]||'------------';
  const activeMiss=[...active].filter(b=>b==='-').length,activeCor=[...active].filter(b=>b==='U').length,activeFlaws=activeCor+activeMiss*2;
  const detail=`<div class="dna-selected-detail"><div class="dna-selected-head"><div><small>SELECTED DNA STRAND</small><b>Gene block ${selected+1}</b></div><code>${E.esc(active)}</code></div><div class="dna-large-helix" data-gene-drop="${selected}">${pathogenHelixMarkup(active,activeComp,{large:true,geneIndex:selected})}</div><div class="dna-strand-information"><div><small>Genes present</small><b>${12-activeMiss} / 12</b></div><div><small>Missing genes</small><b class="${activeMiss?'warn':''}">${activeMiss}</b></div><div><small>Corrupted U</small><b class="${activeCor?'warn':''}">${activeCor}</b></div><div><small>Strand flaws</small><b class="${activeFlaws?'warn':''}">${activeFlaws}</b></div></div><div class="dna-detail-note">Colored rungs are genes/bases; dashed ∅ rungs are missing genetic slots and count as stronger flaws.</div></div>`;
  view.innerHTML=`<div class="dna-workbench"><div class="dna-overview-title">GENOME OVERVIEW (6 STRANDS)</div><div class="dna-strand-field" data-dna-field>${field}</div><div class="dna-base-palette-inline">${palette}</div></div>`;renderDiseaseStrandSidePanel(detail,palette);
  const st=pathogenGenomeStats(clean);stats.innerHTML=`<b>${st.length}/${st.totalSlots}</b> genes present · <b>${st.gc}%</b> GC-style ratio · <b>6</b> strands · <b class="${st.corrupt?'dna-stat-warn':''}">${st.corrupt}</b> corrupted U · <b class="${st.missing?'dna-stat-warn':''}">${st.missing}</b> missing · <b class="${st.flaws?'dna-stat-warn':''}">${st.flaws}</b> total flaws`;
  paintPathogenEnlargedCanvases(view);
  const sel=$('eDiseaseGeneSelect');if(sel)sel.innerHTML=chunks.map((_,i)=>`<option value="${i}" ${i===selected?'selected':''}>Strand ${i+1}</option>`).join('');
  document.querySelectorAll('[data-dna-gene]').forEach(el=>el.addEventListener('click',()=>{setSelectedPathogenGene(+el.dataset.dnaGene);renderPathogenGenome()}));
  document.querySelectorAll('[data-palette-base]').forEach(el=>el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/x-dna-new',el.dataset.paletteBase);e.dataTransfer.effectAllowed='copy'}));
  document.querySelectorAll('[data-gene-base]').forEach(el=>{
    el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/x-dna-existing',JSON.stringify({gene:+el.dataset.geneIndex,base:+el.dataset.geneBase}));e.dataTransfer.effectAllowed='move';window.__dnaDropAccepted=false});
    el.addEventListener('dragend',e=>{if(window.__dnaDropAccepted)return;const hit=document.elementFromPoint(e.clientX,e.clientY);if(hit?.closest?.('.dna-workbench'))return;removePathogenBase(+el.dataset.geneIndex,+el.dataset.geneBase)})
  });
  document.querySelectorAll('[data-gene-drop],[data-dna-gene],[data-dna-field]').forEach(zone=>{
    zone.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect=e.dataTransfer.types.includes('text/x-dna-existing')?'move':'copy';zone.classList.add('dna-drop-ready')});
    zone.addEventListener('dragleave',()=>zone.classList.remove('dna-drop-ready'));
    zone.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();zone.classList.remove('dna-drop-ready');window.__dnaDropAccepted=true;const targetGene=Number.isFinite(+zone.dataset.geneDrop)?+zone.dataset.geneDrop:Number.isFinite(+zone.dataset.dnaGene)?+zone.dataset.dnaGene:selectedPathogenGene();const fresh=e.dataTransfer.getData('text/x-dna-new');const moving=e.dataTransfer.getData('text/x-dna-existing');if(fresh)insertPathogenBase(targetGene,fresh);else if(moving){try{const m=JSON.parse(moving);movePathogenBase(m.gene,m.base,targetGene)}catch{}}})
  })
}
function mutateAbstractGene(seq,geneIndex,count=2){
  const arr=[...normalizePathogenGenome(seq)],chars='ACGT',start=Math.max(0,Math.min(5,geneIndex))*12,end=start+12;
  const candidates=[];for(let i=start;i<end;i++)if(arr[i]!=='-')candidates.push(i);if(!candidates.length)return arr.join('');
  for(let k=0;k<count;k++){const i=candidates[Math.floor(Math.random()*candidates.length)],old=arr[i];arr[i]=old==='U'?chars[Math.floor(Math.random()*4)]:chars.replace(old,'')[Math.floor(Math.random()*3)]}
  return arr.join('')
}
function insertPathogenBase(geneIndex,base){
  const input=$('eDiseaseGenome');if(!input)return;const arr=[...normalizePathogenGenome(input.value)],b=sanitizePathogenGenome(base).replace(/-/g,'').slice(0,1);if(!b)return;const start=Math.max(0,Math.min(5,geneIndex))*12,end=start+12;let i=arr.findIndex((v,idx)=>idx>=start&&idx<end&&v==='-');if(i<0)i=end-1;arr[i]=b;input.value=arr.join('');setSelectedPathogenGene(geneIndex);renderPathogenGenome()
}
function removePathogenBase(geneIndex,baseIndex){
  const input=$('eDiseaseGenome');if(!input)return;const arr=[...normalizePathogenGenome(input.value)],i=Math.max(0,Math.min(5,geneIndex))*12+Math.max(0,Math.min(11,baseIndex));if(arr[i]==='-')return;arr[i]='-';input.value=arr.join('');setSelectedPathogenGene(geneIndex);renderPathogenGenome()
}
function movePathogenBase(fromGene,baseIndex,toGene){
  const input=$('eDiseaseGenome');if(!input)return;const arr=[...normalizePathogenGenome(input.value)],i=Math.max(0,Math.min(5,fromGene))*12+Math.max(0,Math.min(11,baseIndex));const b=arr[i];if(!b||b==='-')return;arr[i]='-';const start=Math.max(0,Math.min(5,toGene))*12,end=start+12;let target=arr.findIndex((v,idx)=>idx>=start&&idx<end&&v==='-');if(target<0)target=end-1;arr[target]=b;input.value=arr.join('');setSelectedPathogenGene(toGene);renderPathogenGenome()
}
function bindPathogenGenomeEditor(){
  const input=$('eDiseaseGenome');if(!input)return;
  input.value=normalizePathogenGenome(input.value);
  input.addEventListener('input',()=>{input.value=normalizePathogenGenome(input.value);renderPathogenGenome()});
  $('eDiseaseGeneSelect')?.addEventListener('change',renderPathogenGenome);
  $('regeneratePathogenGenome')?.addEventListener('click',()=>{input.value=generatePathogenGenome(72);renderPathogenGenome()});
  $('shortenPathogenGenome')?.addEventListener('click',()=>{const arr=[...normalizePathogenGenome(input.value)],present=arr.map((v,i)=>v!=='-'?i:-1).filter(i=>i>=0);for(let k=0;k<Math.min(6,present.length);k++){const at=present[present.length-1-k];arr[at]='-'}input.value=arr.join('');renderPathogenGenome()});
  $('extendPathogenGenome')?.addEventListener('click',()=>{const arr=[...normalizePathogenGenome(input.value)],chars='ACGT';let filled=0;for(let i=0;i<arr.length&&filled<6;i++)if(arr[i]==='-'){arr[i]=chars[Math.floor(Math.random()*4)];filled++}input.value=arr.join('');renderPathogenGenome()});
  $('mutatePathogenGene')?.addEventListener('click',()=>{input.value=mutateAbstractGene(input.value,selectedPathogenGene(),1+Math.floor(Math.random()*3));renderPathogenGenome()});
  $('removePathogenGene')?.addEventListener('click',()=>{const arr=[...normalizePathogenGenome(input.value)],i=selectedPathogenGene()*12;for(let j=i;j<i+12;j++)arr[j]='-';input.value=arr.join('');renderPathogenGenome()});
  $('addPathogenGene')?.addEventListener('click',()=>{const arr=[...normalizePathogenGenome(input.value)],i=selectedPathogenGene()*12,g=generatePathogenGenome(12).slice(0,12);for(let j=0;j<12;j++)arr[i+j]=g[j];input.value=arr.join('');renderPathogenGenome()});
  $('radiatePathogenGenome')?.addEventListener('click',()=>{let arr=[...normalizePathogenGenome(input.value)];const present=arr.map((v,i)=>v!=='-'?i:-1).filter(i=>i>=0),hits=Math.max(2,Math.min(12,Math.round(present.length/12)));for(let i=0;i<hits&&present.length;i++){const at=present[Math.floor(Math.random()*present.length)];if(Math.random()<.27)arr[at]='U';else{const chars='ACGT',old=arr[at];arr[at]=old==='U'?chars[Math.floor(Math.random()*4)]:chars.replace(old,'')[Math.floor(Math.random()*3)]}}input.value=arr.join('');renderPathogenGenome()});
  renderPathogenGenome()
}

function materialRarityInfo(value,name='This material'){
  const v=Math.max(0,Math.min(100,+value||0)),n=String(name||'This material').trim()||'This material';
  let uniquePlace='';
  try{
    const mat=nodes.find(x=>x.type==='material'&&String(x.name||'').trim().toLowerCase()===n.toLowerCase());
    if(mat&&typeof graphNodesLinked==='function'){
      const linked=nodes.filter(x=>x.type==='place'&&graphNodesLinked(mat.id,x.id));
      const system=linked.find(x=>/system/i.test(String(x.placeType||x.category||x.name||'')))||linked[0];
      if(system)uniquePlace=system.name||''
    }
  }catch{}
  if(v<=2)return{tier:'Divine',comparison:'Practically none exists in the whole setting.'};
  if(v<=10)return{tier:'Mythic',comparison:uniquePlace?`Only ${uniquePlace} is known to contain ${n}.`:`Only a tiny number of known systems contain ${n}.`};
  if(v<=22)return{tier:'Legendary',comparison:`Fewer than 1 in 100,000 planets are known to contain ${n}.`};
  if(v<=38)return{tier:'Epic',comparison:`Roughly 1 in ${Math.round(1200-(v-22)*55).toLocaleString()} planets contains usable deposits.`};
  if(v<=58)return{tier:'Rare',comparison:`Around ${Math.max(2,Math.round((v-38)*.55+2))}% of planets contain detectable amounts.`};
  if(v<=82)return{tier:'Uncommon',comparison:`About ${Math.round(32+(v-58)*2.25)}% of planets have this material.`};
  return{tier:'Common',comparison:`About ${Math.min(99,Math.round(86+(v-82)*.72))}% of planets have this material.`}
}
function bindMaterialRarityEditor(){
  const slider=$('eMaterialRarity'),tier=$('materialRarityTier'),text=$('materialRarityComparison'),name=$('eName');if(!slider)return;
  const update=()=>{const info=materialRarityInfo(slider.value,name?.value||'This material');if(tier){tier.textContent=info.tier;tier.dataset.tier=info.tier.toLowerCase()}if(text)text.textContent=info.comparison;slider.style.setProperty('--rarity-pos',`${slider.value}%`)};
  slider.addEventListener('input',update);name?.addEventListener('input',update);update()
}

let materialTextureDraft=null,materialTextureTool='brush',materialTextureUndoStack=[],materialTextureRedoStack=[],materialTextureSelection=new Set(),materialTextureSelectionMode='rect',materialTextureSelectStart=null,materialTextureLasso=[],materialTextureHover=null,texturePainterKind='material';
function materialTextureSize(){return Math.max(8,Math.min(256,+materialTextureDraft?.size||32))}
function blankMaterialTexture(size=32){size=[8,16,32,64,128,256].includes(+size)?+size:32;return {size,pixels:Array(size*size).fill('#00000000')}}
function resampleMaterialTexture(t,newSize){
  const old=t&&Array.isArray(t.pixels)?t:blankMaterialTexture(32),oldSize=Math.max(1,+old.size||Math.round(Math.sqrt(old.pixels.length))||32),out=blankMaterialTexture(newSize);
  for(let y=0;y<newSize;y++)for(let x=0;x<newSize;x++){const sx=Math.min(oldSize-1,Math.floor(x/newSize*oldSize)),sy=Math.min(oldSize-1,Math.floor(y/newSize*oldSize));out.pixels[y*newSize+x]=String(old.pixels[sy*oldSize+sx]||'#00000000')}
  return out
}
function normalizeMaterialTexture(t){
  if(!t||!Array.isArray(t.pixels))return blankMaterialTexture(32);
  let size=Math.max(1,+t.size||Math.round(Math.sqrt(t.pixels.length))||32);
  if(![8,16,32,64,128,256].includes(size)){size=[8,16,32,64,128,256].reduce((best,n)=>Math.abs(n-size)<Math.abs(best-size)?n:best,32)}
  const out=blankMaterialTexture(size),limit=Math.min(out.pixels.length,t.pixels.length);for(let i=0;i<limit;i++)out.pixels[i]=String(t.pixels[i]||'#00000000');return out
}
function cloneMaterialTexture(t){const n=normalizeMaterialTexture(t);return {size:n.size,pixels:[...n.pixels]}}
function pushMaterialTextureHistory(){if(!materialTextureDraft)return;materialTextureUndoStack.push(cloneMaterialTexture(materialTextureDraft));if(materialTextureUndoStack.length>40)materialTextureUndoStack.shift();materialTextureRedoStack=[]}
function materialTexturePreviewPixels(t,max=32){
  const n=normalizeMaterialTexture(t),size=n.size,target=Math.min(max,size),out=[];
  for(let y=0;y<target;y++)for(let x=0;x<target;x++){const sx=Math.min(size-1,Math.floor(x/target*size)),sy=Math.min(size-1,Math.floor(y/target*size));out.push(n.pixels[sy*size+sx]||'#00000000')}
  return {size:target,pixels:out}
}
function renderMaterialTextureEditor(preview=null){
  refreshMaterialTextureInlinePreview();const canvas=$('materialTextureCanvas');if(!canvas||!materialTextureDraft)return;const ctx=canvas.getContext('2d'),size=materialTextureSize(),cell=canvas.width/size;ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<size*size;i++){const col=materialTextureDraft.pixels[i];if(col&&col!=='#00000000'){ctx.fillStyle=col;ctx.fillRect((i%size)*cell,Math.floor(i/size)*cell,Math.ceil(cell+.01),Math.ceil(cell+.01))}}
  if(size<=64){ctx.save();ctx.strokeStyle='rgba(150,180,220,.13)';ctx.lineWidth=1;for(let k=0;k<=size;k++){const p=Math.round(k*cell)+.5;ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,canvas.height);ctx.stroke();ctx.beginPath();ctx.moveTo(0,p);ctx.lineTo(canvas.width,p);ctx.stroke()}ctx.restore()}
  if(materialTextureSelection.size){ctx.save();ctx.fillStyle='rgba(93,201,255,.24)';ctx.strokeStyle='rgba(130,225,255,.8)';for(const i of materialTextureSelection){const xx=i%size,yy=(i/size)|0;ctx.fillRect(xx*cell,yy*cell,cell,cell);if(cell>=3)ctx.strokeRect(xx*cell+.5,yy*cell+.5,cell-1,cell-1)}ctx.restore()}
  const ghost=preview||(materialTextureHover&&['brush','eraser'].includes(materialTextureTool)?{type:'brush',at:materialTextureHover}:null);if(ghost){ctx.save();ctx.globalAlpha=.38;ctx.fillStyle=ghost.erase?'#ff8f8f':materialTextureColor();ctx.strokeStyle=ctx.fillStyle;const draw=(xx,yy)=>{if(xx>=0&&yy>=0&&xx<size&&yy<size)ctx.fillRect(xx*cell,yy*cell,Math.max(1,cell),Math.max(1,cell))};if(ghost.type==='brush'){for(const q of materialTextureFootprint(ghost.at.x,ghost.at.y))draw(q[0],q[1])}else{const pts=[];if(ghost.type==='line'){let x0=ghost.a.x,y0=ghost.a.y,x1=ghost.b.x,y1=ghost.b.y,dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1,err=dx+dy;for(;;){pts.push([x0,y0]);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx}if(e2<=dx){err+=dx;y0+=sy}}}else if(ghost.type==='rect'){const xa=Math.min(ghost.a.x,ghost.b.x),xb=Math.max(ghost.a.x,ghost.b.x),ya=Math.min(ghost.a.y,ghost.b.y),yb=Math.max(ghost.a.y,ghost.b.y);for(let xx=xa;xx<=xb;xx++)pts.push([xx,ya],[xx,yb]);for(let yy=ya;yy<=yb;yy++)pts.push([xa,yy],[xb,yy])}else if(ghost.type==='circle'){const centered=!!$('materialTextureCircleCenter')?.checked;let cx,cy,rx,ry;if(centered){cx=ghost.a.x;cy=ghost.a.y;rx=Math.abs(ghost.b.x-ghost.a.x);ry=Math.abs(ghost.b.y-ghost.a.y)}else{cx=(ghost.a.x+ghost.b.x)/2;cy=(ghost.a.y+ghost.b.y)/2;rx=Math.abs(ghost.b.x-ghost.a.x)/2;ry=Math.abs(ghost.b.y-ghost.a.y)/2}const steps=Math.max(20,Math.ceil(Math.PI*2*Math.max(rx,ry)*2));for(let i=0;i<steps;i++){const t=i/steps*Math.PI*2;pts.push([Math.round(cx+Math.cos(t)*Math.max(.5,rx)),Math.round(cy+Math.sin(t)*Math.max(.5,ry))])}}for(const [xx,yy] of pts)for(const q of materialTextureFootprint(xx,yy))draw(q[0],q[1])}ctx.restore()}
}
function materialTextureCellFromEvent(e){const canvas=$('materialTextureCanvas'),r=canvas.getBoundingClientRect(),size=materialTextureSize();return{x:Math.max(0,Math.min(size-1,Math.floor((e.clientX-r.left)/r.width*size))),y:Math.max(0,Math.min(size-1,Math.floor((e.clientY-r.top)/r.height*size)))}}
function materialTextureFootprint(x,y){const size=materialTextureSize(),th=Math.max(1,Math.min(32,+$('materialTextureThickness')?.value||1)),shape=Math.max(0,Math.min(100,+$('materialBrushShape')?.value||50)),r=Math.max(.5,th/2),pow=2+(shape/100)*18,out=[];for(let yy=Math.floor(y-r);yy<=Math.ceil(y+r);yy++)for(let xx=Math.floor(x-r);xx<=Math.ceil(x+r);xx++){if(xx<0||yy<0||xx>=size||yy>=size)continue;const dx=Math.abs((xx+.5)-(x+.5))/r,dy=Math.abs((yy+.5)-(y+.5))/r;if(Math.pow(dx,pow)+Math.pow(dy,pow)<=1.05)out.push([xx,yy])}if(!out.length&&x>=0&&y>=0&&x<size&&y<size)out.push([x,y]);return out}
function setMaterialTexturePixel(x,y,col){const size=materialTextureSize();for(const [xx,yy] of materialTextureFootprint(x,y))materialTextureDraft.pixels[yy*size+xx]=col}
function materialTextureColor(){return $('materialTextureColor')?.value||'#8aa4ff'}
function materialTextureLine(a,b,col){let x0=a.x,y0=a.y,x1=b.x,y1=b.y,dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1,err=dx+dy;for(;;){setMaterialTexturePixel(x0,y0,col);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx}if(e2<=dx){err+=dx;y0+=sy}}}
function materialTextureRect(a,b,col){const x0=Math.min(a.x,b.x),x1=Math.max(a.x,b.x),y0=Math.min(a.y,b.y),y1=Math.max(a.y,b.y);for(let x=x0;x<=x1;x++){setMaterialTexturePixel(x,y0,col);setMaterialTexturePixel(x,y1,col)}for(let y=y0;y<=y1;y++){setMaterialTexturePixel(x0,y,col);setMaterialTexturePixel(x1,y,col)}}
function materialTextureCircle(a,b,col){const centered=!!$('materialTextureCircleCenter')?.checked;let cx,cy,rx,ry;if(centered){cx=a.x;cy=a.y;rx=Math.abs(b.x-a.x);ry=Math.abs(b.y-a.y)}else{cx=(a.x+b.x)/2;cy=(a.y+b.y)/2;rx=Math.abs(b.x-a.x)/2;ry=Math.abs(b.y-a.y)/2}rx=Math.max(.5,rx);ry=Math.max(.5,ry);const steps=Math.max(20,Math.ceil(Math.PI*2*Math.max(rx,ry)*2));for(let i=0;i<steps;i++){const t=i/steps*Math.PI*2;setMaterialTexturePixel(Math.round(cx+Math.cos(t)*rx),Math.round(cy+Math.sin(t)*ry),col)}}
function materialTextureFill(x,y,col){const size=materialTextureSize(),target=materialTextureDraft.pixels[y*size+x];if(target===col)return;const q=[[x,y]],seen=new Set();while(q.length){const [cx,cy]=q.pop();if(cx<0||cy<0||cx>=size||cy>=size)continue;const k=cy*size+cx;if(seen.has(k)||materialTextureDraft.pixels[k]!==target)continue;seen.add(k);materialTextureDraft.pixels[k]=col;q.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1])}}
function ensureMaterialTexturePanel(){
  let panel=$('materialTexturePanel');if(panel)return panel;
  panel=document.createElement('aside');panel.id='materialTexturePanel';panel.className='material-texture-panel hidden';panel.dataset.activeTool='brush';panel.innerHTML=`
    <div class="material-texture-panel-head"><div><div class="eyebrow" id="texturePainterEyebrow">Material</div><h3><span id="texturePainterTitle">Texture Painter</span> · <span id="materialTextureResolutionTitle">32×32</span></h3></div><button type="button" id="closeMaterialTexturePanel" class="icon-btn">×</button></div>
    <p class="material-texture-panel-help">Resolution can range from 8×8 to 256×256. Existing art is resampled when you change it.</p>
    <div class="painter-three-column material-painter-layout">
      <nav class="painter-tool-rail material-texture-toolbar" aria-label="Material painter tools">
        <button type="button" class="material-texture-tool active" data-material-texture-tool="brush" title="Brush">✎<span>Brush</span></button>
        <button type="button" class="material-texture-tool" data-material-texture-tool="line" title="Line">╱<span>Line</span></button>
        <button type="button" class="material-texture-tool" data-material-texture-tool="rect" title="Rectangle">□<span>Rect</span></button>
        <button type="button" class="material-texture-tool" data-material-texture-tool="circle" title="Circle">○<span>Circle</span></button>
        <button type="button" class="material-texture-tool" data-material-texture-tool="fill" title="Fill">▣<span>Fill</span></button>
        <button type="button" class="material-texture-tool" data-material-texture-tool="eraser" title="Eraser">⌫<span>Erase</span></button>
        <button type="button" class="material-texture-tool" data-material-texture-tool="select" title="Select">⌖<span>Select</span></button>
        <i class="painter-rail-divider"></i>
        <button type="button" id="materialTextureUndo" title="Undo">↶<span>Undo</span></button>
        <button type="button" id="materialTextureRedo" title="Redo">↷<span>Redo</span></button>
        <button type="button" id="clearMaterialTexture" title="Clear">×<span>Clear</span></button>
      </nav>
      <div class="painter-canvas-column material-texture-canvas-wrap"><canvas id="materialTextureCanvas" width="640" height="640"></canvas></div>
      <aside class="painter-options-rail material-texture-controls">
        <div class="painter-options-title"><span>TOOL OPTIONS</span><b id="materialTextureToolName">Brush</b></div>
        <label data-material-tools="brush,line,rect,circle,fill,eraser,select">Pixel quality<select id="materialTextureResolution"><option>8</option><option>16</option><option selected>32</option><option>64</option><option>128</option><option>256</option></select><small>8×8 → 256×256</small></label>
        <label data-material-tools="brush,line,rect,circle,fill">Paint color<input id="materialTextureColor" type="color" value="#8aa4ff"></label>
        <label data-material-tools="brush,line,rect,circle,eraser">Thickness <output id="materialTextureThicknessOut">1 px</output><input id="materialTextureThickness" type="range" min="1" max="32" step="1" value="1"></label>
        <label class="life-check compact" data-material-tools="circle"><input id="materialTextureCircleCenter" type="checkbox"><span><b>Circle from center</b><small>Drag outward from the starting point.</small></span></label>
        <label data-material-tools="brush,eraser">Brush shape <output id="materialBrushShapeOut">50%</output><input id="materialBrushShape" type="range" min="0" max="100" value="50"><small>Circle ← → Square</small></label>
        <label data-material-tools="select">Selection mode<select id="materialSelectMode"><option value="rect">Rectangle</option><option value="lasso">Lasso</option></select></label>
        <button type="button" id="materialDeleteSelection" data-material-tools="select" class="danger ghost">Delete selection</button>
        <div class="painter-option-note" data-material-tools="brush,line,rect,circle,eraser"><b>Pixel locked</b><small>Every mark snaps exactly to the selected material grid.</small></div>
        <div class="painter-option-note" data-material-tools="fill"><b>Flood Fill</b><small>Fills one contiguous region of identical pixels.</small></div>
      </aside>
    </div>`;
  document.body.appendChild(panel);
  panel.classList.add('detached-editor-panel');
  const head=panel.querySelector('.material-texture-panel-head');
  if(head)prepareDetachedEditorPanel(panel,head);
  $('closeMaterialTexturePanel').onclick=()=>panel.classList.add('hidden');
  const savebar=document.createElement('div');savebar.className='special-editor-savebar';savebar.innerHTML='<span>Pixel-art changes are synchronized to the current editor preview.</span><button type="button" class="primary">Save & Return</button>';savebar.querySelector('button').onclick=()=>{refreshMaterialTextureInlinePreview();panel.classList.add('hidden')};panel.appendChild(savebar);
  return panel
}
function updateMaterialPainterToolUI(){
  const panel=$('materialTexturePanel');if(!panel)return;panel.dataset.activeTool=materialTextureTool;
  const nice={brush:'Brush',line:'Line',rect:'Rectangle',circle:'Circle',fill:'Fill',eraser:'Eraser',select:'Select'}[materialTextureTool]||materialTextureTool;
  if($('materialTextureToolName'))$('materialTextureToolName').textContent=nice;
  panel.querySelectorAll('[data-material-tools]').forEach(el=>{const tools=el.dataset.materialTools.split(',');el.classList.toggle('tool-option-hidden',!tools.includes(materialTextureTool))});
  if($('materialTextureThicknessOut'))$('materialTextureThicknessOut').textContent=`${+$('materialTextureThickness')?.value||1} px`;if($('materialBrushShapeOut'))$('materialBrushShapeOut').textContent=`${+$('materialBrushShape')?.value||50}%`
}
function refreshMaterialTextureInlinePreview(){
  const host=$('materialTextureInlinePreview');if(!host||!materialTextureDraft)return;const p=materialTexturePreviewPixels(materialTextureDraft,32);host.style.setProperty('--material-preview-size',String(p.size));host.innerHTML=p.pixels.map(c=>`<i style="background:${/^#[0-9a-f]{6}$/i.test(c)?c:'transparent'}"></i>`).join('')
}
function materialSelectionRect(a,b){const size=materialTextureSize(),out=new Set(),x0=Math.min(a.x,b.x),x1=Math.max(a.x,b.x),y0=Math.min(a.y,b.y),y1=Math.max(a.y,b.y);for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)out.add(y*size+x);return out}
function pointInPoly(x,y,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i].x,yi=poly[i].y,xj=poly[j].x,yj=poly[j].y,hit=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi||1e-9)+xi);if(hit)inside=!inside}return inside}
function materialSelectionLasso(poly){const size=materialTextureSize(),out=new Set();if(poly.length<3)return out;for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(pointInPoly(x+.5,y+.5,poly))out.add(y*size+x);return out}
function bindMaterialTextureCanvas(){
  const c=$('materialTextureCanvas');if(!c||c.dataset.bound==='1')return;c.dataset.bound='1';let down=false,start=null,last=null;
  const col=()=>materialTextureTool==='eraser'?'#00000000':materialTextureColor();
  document.querySelectorAll('.material-texture-tool').forEach(btn=>btn.addEventListener('click',()=>{materialTextureTool=btn.dataset.materialTextureTool;document.querySelectorAll('.material-texture-tool').forEach(x=>x.classList.toggle('active',x===btn));materialTextureHover=null;updateMaterialPainterToolUI();renderMaterialTextureEditor()}));
  $('materialTextureThickness')?.addEventListener('input',()=>{updateMaterialPainterToolUI();renderMaterialTextureEditor()});$('materialBrushShape')?.addEventListener('input',()=>{updateMaterialPainterToolUI();renderMaterialTextureEditor()});
  $('materialTextureResolution')?.addEventListener('change',e=>{const size=+e.target.value||32;if(size===materialTextureSize())return;pushMaterialTextureHistory();materialTextureDraft=resampleMaterialTexture(materialTextureDraft,size);materialTextureSelection.clear();if($('materialTextureResolutionTitle'))$('materialTextureResolutionTitle').textContent=`${size}×${size}`;renderMaterialTextureEditor()});
  $('materialSelectMode')?.addEventListener('change',e=>materialTextureSelectionMode=e.target.value);
  $('materialDeleteSelection')?.addEventListener('click',()=>{if(!materialTextureSelection.size)return;pushMaterialTextureHistory();for(const i of materialTextureSelection)materialTextureDraft.pixels[i]='#00000000';materialTextureSelection.clear();renderMaterialTextureEditor()});updateMaterialPainterToolUI();
  c.addEventListener('pointerdown',e=>{e.preventDefault();start=materialTextureCellFromEvent(e);last=start;c.setPointerCapture?.(e.pointerId);if(materialTextureTool==='select'){down=true;materialTextureSelectStart=start;materialTextureLasso=[start];materialTextureSelection=materialTextureSelectionMode==='rect'?new Set([start.y*materialTextureSize()+start.x]):new Set();renderMaterialTextureEditor();return}pushMaterialTextureHistory();down=true;if(materialTextureTool==='fill'){materialTextureFill(start.x,start.y,col());down=false;renderMaterialTextureEditor()}else if(materialTextureTool==='brush'||materialTextureTool==='eraser'){setMaterialTexturePixel(start.x,start.y,col());renderMaterialTextureEditor()}});
  c.addEventListener('pointermove',e=>{const p0=materialTextureCellFromEvent(e);materialTextureHover=p0;if(!down){renderMaterialTextureEditor();return}let p=p0;if(e.shiftKey&&start&&materialTextureTool!=='select'){const dx=p.x-start.x,dy=p.y-start.y;p=Math.abs(dx)>=Math.abs(dy)?{x:p.x,y:start.y}:{x:start.x,y:p.y}}if(materialTextureTool==='select'){if(materialTextureSelectionMode==='lasso'){if(!materialTextureLasso.length||materialTextureLasso.at(-1).x!==p.x||materialTextureLasso.at(-1).y!==p.y)materialTextureLasso.push(p);materialTextureSelection=materialSelectionLasso(materialTextureLasso)}else materialTextureSelection=materialSelectionRect(materialTextureSelectStart,p);renderMaterialTextureEditor();return}if(materialTextureTool==='brush'||materialTextureTool==='eraser'){materialTextureLine(last,p,col());last=p;renderMaterialTextureEditor()}else if(['line','rect','circle'].includes(materialTextureTool))renderMaterialTextureEditor({type:materialTextureTool,a:start,b:p})});
  c.addEventListener('pointerup',e=>{if(!down)return;let p=materialTextureCellFromEvent(e);if(materialTextureTool==='select'){down=false;renderMaterialTextureEditor();return}if(e.shiftKey&&start){const dx=p.x-start.x,dy=p.y-start.y;p=Math.abs(dx)>=Math.abs(dy)?{x:p.x,y:start.y}:{x:start.x,y:p.y}}if(materialTextureTool==='line')materialTextureLine(start,p,col());else if(materialTextureTool==='rect')materialTextureRect(start,p,col());else if(materialTextureTool==='circle')materialTextureCircle(start,p,col());down=false;start=null;last=null;renderMaterialTextureEditor()});
  c.addEventListener('pointerleave',()=>{if(!down){materialTextureHover=null;renderMaterialTextureEditor()}});
  $('materialTextureUndo')?.addEventListener('click',()=>{if(!materialTextureUndoStack.length)return;materialTextureRedoStack.push(cloneMaterialTexture(materialTextureDraft));materialTextureDraft=materialTextureUndoStack.pop();renderMaterialTextureEditor()});
  $('materialTextureRedo')?.addEventListener('click',()=>{if(!materialTextureRedoStack.length)return;materialTextureUndoStack.push(cloneMaterialTexture(materialTextureDraft));materialTextureDraft=materialTextureRedoStack.pop();renderMaterialTextureEditor()});
  $('clearMaterialTexture')?.addEventListener('click',()=>{pushMaterialTextureHistory();materialTextureDraft=blankMaterialTexture(materialTextureSize());materialTextureSelection.clear();renderMaterialTextureEditor()})
}
function bindMaterialTextureEditor(node,kind='material'){
  texturePainterKind=kind==='object'?'object':'material';
  materialTextureDraft=normalizeMaterialTexture(texturePainterKind==='object'?node?.objectTexture:node?.materialTexture);materialTextureTool='brush';materialTextureUndoStack=[];materialTextureRedoStack=[];materialTextureSelection=new Set();materialTextureHover=null;refreshMaterialTextureInlinePreview();
  $('openMaterialTexturePanel')?.addEventListener('click',()=>{const panel=ensureMaterialTexturePanel();panel.classList.remove('hidden');panel.dataset.dragX='0';panel.dataset.dragY='0';applyPanelDragTransform(panel);bindMaterialTextureCanvas();if($('texturePainterEyebrow'))$('texturePainterEyebrow').textContent=texturePainterKind==='object'?'Magical Object':'Material';if($('texturePainterTitle'))$('texturePainterTitle').textContent=texturePainterKind==='object'?'2D Object Drawer':'Texture Painter';if($('materialTextureResolution'))$('materialTextureResolution').value=String(materialTextureSize());if($('materialTextureResolutionTitle'))$('materialTextureResolutionTitle').textContent=`${materialTextureSize()}×${materialTextureSize()}`;renderMaterialTextureEditor();requestAnimationFrame(()=>keepDetachedPanelOnscreen(panel))})
}
function materialTextureEditorData(){return materialTextureDraft?normalizeMaterialTexture(materialTextureDraft):blankMaterialTexture()}

function ensureMaterialUpgradeTreePanel(){
  let panel=$('materialUpgradeTreePanel');if(panel)return panel;
  panel=document.createElement('aside');panel.id='materialUpgradeTreePanel';panel.className='material-upgrade-tree-panel detached-editor-panel hidden';panel.innerHTML=`<div class="material-upgrade-tree-head"><div><div class="eyebrow">Materials</div><h3>Upgrade Tree</h3></div><button type="button" id="closeMaterialUpgradeTree" class="icon-btn">×</button></div><p>Links are generated from each Material's <b>Made from</b> recipe. Hover quantities to see the exact amount.</p><div id="materialUpgradeTreeCanvas" class="material-upgrade-tree-canvas"></div>`;document.body.appendChild(panel);prepareDetachedEditorPanel(panel,panel.querySelector('.material-upgrade-tree-head'));$('closeMaterialUpgradeTree').onclick=()=>panel.classList.add('hidden');return panel
}
function materialUpgradeTreeLevels(materials){
  const map=new Map(materials.map(m=>[m.id,m])),memo=new Map();
  const depth=(m,seen=new Set())=>{if(memo.has(m.id))return memo.get(m.id);if(!m.materialUpgradeFromId||!map.has(m.materialUpgradeFromId)||seen.has(m.id)){memo.set(m.id,0);return 0}const ns=new Set(seen);ns.add(m.id);const d=1+depth(map.get(m.materialUpgradeFromId),ns);memo.set(m.id,d);return d};
  const groups=[];for(const m of materials){const d=Math.min(12,depth(m));(groups[d]||(groups[d]=[])).push(m)}return groups
}
function renderMaterialUpgradeTree(){
  const host=$('materialUpgradeTreeCanvas');if(!host)return;const mats=nodes.filter(n=>n.type==='material'&&!n.isHub);if(!mats.length){host.innerHTML='<div class="auto-empty">Create Materials to build an upgrade chain.</div>';return}
  const groups=materialUpgradeTreeLevels(mats),cols=Math.max(1,groups.length),cw=230,rowH=112,pad=36,H=Math.max(300,...groups.map(g=>(g?.length||0)*rowH+pad*2)),W=Math.max(620,cols*cw+pad*2),pos=new Map();
  groups.forEach((g,level)=>(g||[]).forEach((m,i)=>pos.set(m.id,{x:pad+level*cw,y:pad+i*rowH,w:174,h:68})));
  const paths=[];for(const m of mats){const a=pos.get(m.materialUpgradeFromId),b=pos.get(m.id);if(!a||!b)continue;const x1=a.x+a.w,y1=a.y+a.h/2,x2=b.x,y2=b.y+b.h/2,mx=(x1+x2)/2,q=Math.max(1,+m.materialUpgradeQty||1);paths.push(`<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/><text x="${mx}" y="${(y1+y2)/2-7}" text-anchor="middle"><title>Exact: ${E.esc(String(q))}</title>${E.esc(compactMaterialQuantity(q))}×</text>`)}
  host.style.width=W+'px';host.style.height=H+'px';host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${paths.join('')}</svg>`+mats.map(m=>{const p=pos.get(m.id),ac=materialShortName(m);return `<div class="material-upgrade-node" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px"><b>${E.esc(m.name||'Unnamed')}</b><span>${E.esc(ac)}</span></div>`}).join('')
}
function bindMaterialUpgradeTreeEditor(){
  $('openMaterialUpgradeTree')?.addEventListener('click',()=>{const p=ensureMaterialUpgradeTreePanel();p.classList.remove('hidden');p.dataset.dragX='0';p.dataset.dragY='0';applyPanelDragTransform(p);renderMaterialUpgradeTree();requestAnimationFrame(()=>keepDetachedPanelOnscreen(p))})
}

function compactMaterialQuantity(value){
  const n=Number(value);if(!Number.isFinite(n))return String(value??'');const a=Math.abs(n);if(a<1000)return Number.isInteger(n)?String(n):String(+n.toFixed(2));
  const units=['K','M','B','T','Qa','Qi','Sx','Sp','Oc','No','Dc'];let u=-1,v=a;while(v>=1000&&u<units.length-1){v/=1000;u++}const sign=n<0?'-':'';return sign+(v>=100?Math.round(v):v>=10?v.toFixed(1):v.toFixed(2)).replace(/\.0+$|(?<=\.[0-9])0$/,'')+units[u]
}
function materialShortName(n){return String(n?.acronym||n?.materialAcronym||n?.name||'?').trim()||'?'}

let craftingGraphDraft=null,craftingGraphNode=null,craftingTool='move';
let craftingSelectedIds=new Set(),craftingLinkMode='process',craftingInsertRefId='';
function craftingCandidateNodes(editingNode){return nodes.filter(n=>!n.isHub&&n.id!==editingNode?.id&&(n.type==='material'||n.type==='magicalObject'||n.type==='tool'))}
function normalizeCraftingGraph(node){
  const recipe=node?.craftingRecipe||{},g=recipe.graph;
  if(g&&Array.isArray(g.nodes)&&Array.isArray(g.links))return {nodes:g.nodes.map(n=>({...n})),links:g.links.map(l=>({...l})),failOutput:String(recipe.failOutput||g.failOutput||'')};
  const product={id:'product',kind:'product',refId:node?.id||'',label:node?.name||'Product',x:50,y:50};
  const out={nodes:[product],links:[],failOutput:String(recipe.failOutput||'')};
  (recipe.ingredients||[]).forEach((it,i)=>{const ref=byId(it.nodeId),id='ingredient-'+uid();out.nodes.push({id,kind:'ingredient',refId:it.nodeId,label:ref?.name||'Ingredient',qty:Number(it.qty)||1,x:12+(i%2)*20,y:18+Math.floor(i/2)*19});out.links.push({id:uid(),a:id,b:'product',label:'',direct:true})});
  if(recipe.process){const id='process-'+uid();out.nodes.push({id,kind:'process',label:String(recipe.process).split('\n')[0].slice(0,48)||'Process',x:50,y:72})}
  return out
}
function ensureCraftingPanel(){
  let panel=$('craftingGraphPanel');if(panel)return panel;
  panel=document.createElement('aside');panel.id='craftingGraphPanel';panel.className='crafting-graph-panel crafting-v287at hidden detached-editor-panel';panel.innerHTML=`
    <div class="crafting-graph-head"><div><div class="eyebrow">Magical Object</div><h3>Crafting Editor</h3></div><button type="button" id="closeCraftingGraph" class="icon-btn">×</button></div>
    <div class="crafting-workspace">
      <nav class="crafting-side-tools" aria-label="Crafting tools">
        <button type="button" id="craftingMoveTool" class="active" data-tip="Move">↔<span>Move</span></button>
        <button type="button" id="craftingLinkTool" data-tip="Link">⌁<span>Link</span></button>
        <button type="button" id="craftingInsertTool" data-tip="Insert">＋<span>Insert</span></button>
        <button type="button" id="craftingCreateProcessTool" data-tip="Create Process">◆<span>Process</span></button>
        <button type="button" id="craftingEditTool" data-tip="Edit">✎<span>Edit</span></button>
      </nav>
      <section class="crafting-main-area">
        <div id="craftingToolOptions" class="crafting-tool-options">
          <div class="crafting-tool-pane" data-craft-pane="move"><b>Move</b><span>Drag ingredients, helpers and processes anywhere on the graph.</span></div>
          <div class="crafting-tool-pane hidden" data-craft-pane="link"><div class="crafting-link-mode"><button type="button" id="craftingDirectMode">Direct</button><button type="button" id="craftingProcessMode" class="active">Process</button></div><input id="craftingProcessName" placeholder="Process name"><button type="button" id="craftingConfirmLink" class="primary" disabled>Confirm</button><button type="button" id="craftingCancelLink" class="ghost">Clear</button></div>
          <div class="crafting-tool-pane hidden" data-craft-pane="insert"><select id="craftingInsertKind"><option value="permanent">Permanent material / component / object</option><option value="temporary">Temporary material / helper / other</option></select><div id="craftingPermanentInsert"><select id="craftingAddSelect"><option value="">Choose an existing object…</option></select><label class="crafting-qty">× <input id="craftingAddQty" type="text" inputmode="numeric" autocomplete="off" value="1" placeholder="e.g. 450 000"></label><button type="button" id="craftingAddNode" class="primary">Insert</button></div><div id="craftingTemporaryInsert" class="hidden"><input id="craftingTemporaryInput" placeholder="Temporary material / helper / other"><select id="craftingTemporaryType"><option value="material">Temporary material</option><option value="component">Temporary component</option><option value="tool">Temporary tool</option><option value="other">Temporary other</option></select><button type="button" id="craftingAddTemporary" class="primary">Insert temporary</button></div></div>
          <div class="crafting-tool-pane hidden" data-craft-pane="process"><b>Create Process</b><input id="craftingNewProcessName" placeholder="Process name — e.g. Weld"><span>Click anywhere on the graph to place the process.</span></div>
          <div class="crafting-tool-pane hidden" data-craft-pane="edit"><b>Edit</b><span>Click a process to rename it. Double-click a temporary node to convert it into a real Material, Component, Tool or Magical Object.</span></div>
        </div>
        <div id="craftingLinkHint" class="crafting-link-hint">Move · drag nodes around the recipe.</div>
        <div id="craftingGraphCanvas" class="crafting-graph-canvas"><svg id="craftingGraphSvg" aria-hidden="true"></svg><div id="craftingGraphNodes"></div></div>
      </section>
    </div>
    <div class="crafting-fail-control"><button type="button" id="craftingFailToggle" class="fail-output-plus"><span>＋</span>Fail output</button><div id="craftingFailBody" class="fail-output-body hidden"><textarea id="craftingFailOutput" rows="3" placeholder="What happens when crafting fails?"></textarea></div></div>
    <div class="crafting-graph-foot"><div><button type="button" id="craftingDeleteSelected" class="danger ghost">Delete selected</button><button type="button" id="craftingSaveReturn" class="primary">Save & Return</button></div><span>Double-click TEMP nodes to promote them into real authored ingredients.</span></div>`;
  document.body.appendChild(panel);const head=panel.querySelector('.crafting-graph-head');if(head)prepareDetachedEditorPanel(panel,head);
  $('closeCraftingGraph').onclick=()=>panel.classList.add('hidden');
  $('craftingMoveTool').onclick=()=>setCraftingTool('move');$('craftingLinkTool').onclick=()=>setCraftingTool('link');$('craftingInsertTool').onclick=()=>setCraftingTool('insert');$('craftingCreateProcessTool').onclick=()=>setCraftingTool('process');$('craftingEditTool').onclick=()=>setCraftingTool('edit');
  $('craftingProcessMode').onclick=()=>setCraftingLinkMode('process');$('craftingDirectMode').onclick=()=>setCraftingLinkMode('direct');
  $('craftingAddNode').onclick=e=>{e.preventDefault();e.stopPropagation();addCraftingGraphNode()};$('craftingAddTemporary').onclick=e=>{e.preventDefault();e.stopPropagation();addTemporaryCraftingNode()};$('craftingConfirmLink').onclick=confirmCraftingLink;$('craftingCancelLink').onclick=clearCraftingLinkSelection;$('craftingDeleteSelected').onclick=deleteCraftingSelected;$('craftingSaveReturn').onclick=()=>{const status=$('craftingOpenStatus');if(status)status.textContent=`Crafting synced · ${craftingGraphDraft.nodes.filter(n=>n.kind==='ingredient').length} ingredients`;panel.classList.add('hidden')};
  $('craftingInsertKind').onchange=()=>{const temp=$('craftingInsertKind').value==='temporary';$('craftingPermanentInsert').classList.toggle('hidden',temp);$('craftingTemporaryInsert').classList.toggle('hidden',!temp)};$('craftingAddSelect').onchange=e=>{craftingInsertRefId=e.target.value||''};
  $('craftingTemporaryInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addTemporaryCraftingNode()}});
  $('craftingFailToggle').onclick=()=>{const body=$('craftingFailBody'),open=body.classList.toggle('hidden')===false;$('craftingFailToggle').classList.toggle('open',open);if(open)$('craftingFailOutput').focus()};$('craftingFailOutput').oninput=e=>{if(craftingGraphDraft)craftingGraphDraft.failOutput=e.target.value};
  $('craftingGraphCanvas').addEventListener('click',e=>{if(e.target.closest('[data-craft-id]'))return;if(craftingTool==='process')placeCraftingProcessAt(e)});
  return panel
}
function setCraftingLinkMode(mode){craftingLinkMode=mode==='direct'?'direct':'process';$('craftingProcessMode')?.classList.toggle('active',craftingLinkMode==='process');$('craftingDirectMode')?.classList.toggle('active',craftingLinkMode==='direct');const input=$('craftingProcessName');if(input)input.placeholder=craftingLinkMode==='process'?'Process name — e.g. Weld, Enchant, Assemble':'Message beside direct line';updateCraftingLinkControls()}
function setCraftingTool(tool){craftingTool=tool;craftingSelectedIds.clear();window.__craftingSelected=null;const ids={move:'craftingMoveTool',link:'craftingLinkTool',insert:'craftingInsertTool',process:'craftingCreateProcessTool',edit:'craftingEditTool'};Object.entries(ids).forEach(([k,id])=>$(id)?.classList.toggle('active',tool===k));document.querySelectorAll('#craftingGraphPanel [data-craft-pane]').forEach(p=>p.classList.toggle('hidden',p.dataset.craftPane!==tool));if(tool==='insert'){populateCraftingCandidates();const sel=$('craftingAddSelect');if(sel)sel.disabled=false;const add=$('craftingAddNode');if(add)add.disabled=false;const temp=$('craftingAddTemporary');if(temp)temp.disabled=false}const h=$('craftingLinkHint');if(h)h.textContent=tool==='link'?'Link · select 2+ nodes, choose Direct or Process, then Confirm.':tool==='insert'?'Insert · add a permanent ingredient or a temporary helper.':tool==='process'?'Create Process · name it, then click the graph.':tool==='edit'?'Edit · click a process; double-click TEMP to convert it.':'Move · drag nodes around the recipe.';updateCraftingLinkControls();renderCraftingGraph()}
function clearCraftingLinkSelection(){craftingSelectedIds.clear();updateCraftingLinkControls();renderCraftingGraph()}
function updateCraftingLinkControls(){const n=craftingSelectedIds.size,b=$('craftingConfirmLink'),h=$('craftingLinkHint');if(b)b.disabled=craftingTool!=='link'||n<2;if(h&&craftingTool==='link')h.textContent=`${n} node${n===1?'':'s'} selected · keep selecting, then press Confirm.`}
function craftingNodeRefLabel(n){if(n.kind==='product')return $('eName')?.value.trim()||n.label||'Product';if(n.kind==='process'||n.kind==='temporary')return n.label||'Process';const ref=byId(n.refId);return ref?.name||n.label||'Missing node'}
function populateCraftingCandidates(preserve=true){const sel=$('craftingAddSelect');if(!sel)return;const wanted=preserve?(sel.value||craftingInsertRefId):'';const candidates=craftingCandidateNodes(craftingGraphNode);sel.innerHTML='<option value="">Insert material / component / object…</option>'+candidates.map(n=>`<option value="${n.id}">${E.esc(n.name)} · ${n.type==='material'?'Material':n.isComponent?'Component':n.type==='tool'?'Tool':'Magical Object'}</option>`).join('');if(wanted&&candidates.some(n=>n.id===wanted)){sel.value=wanted;craftingInsertRefId=wanted}else if(!sel.value&&craftingInsertRefId&&!candidates.some(n=>n.id===craftingInsertRefId))craftingInsertRefId=''}
function craftingOpenInsertPosition(){
  // Inserted nodes must always land somewhere visibly free. The old random
  // placement could put a later ingredient directly under an existing node,
  // making a successful insert look like it did nothing.
  const occupied=(craftingGraphDraft?.nodes||[]).map(n=>({x:Number(n.x)||50,y:Number(n.y)||50}));
  const xs=[14,28,42,72,86,58],ys=[14,29,44,59,74,89];
  let best={x:14,y:14},bestScore=-1;
  for(const x of xs)for(const y of ys){
    const nearest=occupied.length?Math.min(...occupied.map(o=>Math.hypot((x-o.x)*1.15,y-o.y))):999;
    if(nearest>=14)return{x,y};
    if(nearest>bestScore){bestScore=nearest;best={x,y}}
  }
  // Even a very crowded recipe gets a deterministic stagger instead of an
  // exact overlap.
  const i=occupied.length;
  return{x:10+(i*13)%80,y:10+(i*17)%80}
}
function craftingEnsureDraft(){
  if(!craftingGraphDraft)craftingGraphDraft=normalizeCraftingGraph(craftingGraphNode);
  if(!craftingGraphDraft||typeof craftingGraphDraft!=='object')craftingGraphDraft={nodes:[],links:[],failOutput:''};
  if(!Array.isArray(craftingGraphDraft.nodes))craftingGraphDraft.nodes=[];
  if(!Array.isArray(craftingGraphDraft.links))craftingGraphDraft.links=[];
  if(!craftingGraphDraft.nodes.some(n=>n&&n.kind==='product'))craftingGraphDraft.nodes.unshift({id:'product',kind:'product',refId:craftingGraphNode?.id||'',label:craftingGraphNode?.name||$('eName')?.value.trim()||'Product',x:50,y:50});
  return craftingGraphDraft
}
function parseCraftingQuantity(raw){
  // Quantity fields are authored by humans and often include grouping separators
  // such as 450 000, 450,000, NBSP, or thin spaces. A native type=number
  // rejects those strings before our handler can read them, so normalize them
  // explicitly and only then convert to a number.
  const text=String(raw??'').trim().replace(/[\s\u00a0\u202f,_']/g,'');
  if(!text)return 1;
  const n=Number(text);
  if(!Number.isFinite(n)||n<=0)return null;
  return Math.max(1,Math.floor(n))
}
function formatCraftingQuantity(value,compact=false){
  // Crafting quantities are display metadata only. Never expand a quantity into
  // repeated nodes/elements, and never send it through material acronym logic.
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return '1';
  const whole=Math.floor(n);
  if(compact){
    const units=['K','M','B','T','Qa','Qi','Sx','Sp','Oc','No','Dc'];
    if(whole<1000)return String(whole);
    let v=whole,u=-1;
    while(v>=1000&&u<units.length-1){v/=1000;u++}
    let text=v>=100?String(Math.round(v)):v>=10?v.toFixed(1):v.toFixed(2);
    text=text.replace(/\.0+$/,'').replace(/(\.\d*[1-9])0+$/,'$1');
    return text+units[u]
  }
  // Group manually so this remains safe even if Intl/locale formatting behaves oddly.
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g,' ')
}
function commitCraftingWorkspaceInsert(ref,qty){
  if(!ref)return null;
  const graph=craftingEnsureDraft(),pos=craftingOpenInsertPosition(),inserted={id:'craft-'+uid(),kind:'ingredient',refId:String(ref.id||''),label:String(ref.name||'Ingredient'),qty:Math.max(1,Math.floor(Number(qty)||1)),x:pos.x,y:pos.y};
  graph.nodes.push(inserted);craftingInsertRefId=ref.id;window.__craftingSelected=inserted.id;renderCraftingGraph();return inserted
}
function addCraftingGraphNode(){
  const sel=$('craftingAddSelect'),status=$('craftingOpenStatus'),selectedId=sel?.value||craftingInsertRefId,ref=selectedId?byId(selectedId):null;
  if(!ref){if(status)status.textContent='Choose a Material, Component, Magical Object, or Tool to insert.';sel?.focus();return}
  const qtyInput=$('craftingAddQty'),qty=parseCraftingQuantity(qtyInput?.value);
  if(qty===null){if(status)status.textContent='Quantity must be a positive number. Spaces and commas are allowed.';qtyInput?.focus();return}
  const inserted=commitCraftingWorkspaceInsert(ref,qty);
  if(!inserted){if(status)status.textContent='Insert failed — the item was not added to the crafting graph.';return}
  if(sel)sel.value=ref.id;populateCraftingCandidates(true);if(status)status.textContent=`Inserted ${formatCraftingQuantity(qty,false)}× ${ref.name}.`
}
function addTemporaryCraftingNode(){
  const input=$('craftingTemporaryInput'),label=String(input?.value||'').trim();if(!label){input?.focus();return}
  const graph=craftingEnsureDraft(),pos=craftingOpenInsertPosition(),inserted={id:'temp-'+uid(),kind:'temporary',temporary:true,tempType:$('craftingTemporaryType')?.value||'material',label:label.slice(0,80),x:pos.x,y:pos.y};
  graph.nodes.push(inserted);window.__craftingSelected=inserted.id;if(input)input.value='';renderCraftingGraph()
}
function placeCraftingProcessAt(ev){const graph=craftingEnsureDraft(),canvas=$('craftingGraphCanvas');if(!canvas)return;const r=canvas.getBoundingClientRect(),label=String($('craftingNewProcessName')?.value||'').trim()||'Process';graph.nodes.push({id:'process-'+uid(),kind:'process',label:label.slice(0,64),x:Math.max(4,Math.min(96,(ev.clientX-r.left)/Math.max(1,r.width)*100)),y:Math.max(5,Math.min(95,(ev.clientY-r.top)/Math.max(1,r.height)*100))});renderCraftingGraph()}
function editCraftingProcess(n){const next=prompt('Process name',n.label||'Process');if(next!==null&&String(next).trim()){n.label=String(next).trim().slice(0,64);renderCraftingGraph()}}
function convertTemporaryCraftingNode(n){const candidates=craftingCandidateNodes(craftingGraphNode);if(!candidates.length)return;let box=document.getElementById('craftingTempConvert');if(box)box.remove();box=document.createElement('div');box.id='craftingTempConvert';box.className='crafting-convert-popover';box.innerHTML=`<b>Convert “${E.esc(n.label||'Temporary')}”</b><span>Choose the authored object this temporary node becomes.</span><select id="craftingConvertSelect"><option value="">Choose Material / Component / Object / Tool…</option>${candidates.map(x=>`<option value="${x.id}">${E.esc(x.name)} · ${x.type==='material'?'Material':x.isComponent?'Component':x.type==='tool'?'Tool':'Magical Object'}</option>`).join('')}</select><div><button id="craftingConvertCancel" class="ghost">Cancel</button><button id="craftingConvertGo" class="primary">Convert</button></div>`;document.body.appendChild(box);$('craftingConvertCancel').onclick=()=>box.remove();$('craftingConvertGo').onclick=()=>{const ref=byId($('craftingConvertSelect').value);if(!ref)return;n.kind='ingredient';n.refId=ref.id;n.label=ref.name;n.qty=n.qty||1;delete n.temporary;delete n.tempType;box.remove();renderCraftingGraph()}}
function craftingNodeClick(id){const n=craftingGraphDraft?.nodes?.find(x=>x.id===id);if(craftingTool==='edit'&&n?.kind==='process'){editCraftingProcess(n);return}if(craftingTool!=='link'){window.__craftingSelected=id;renderCraftingGraph();return}if(craftingSelectedIds.has(id))craftingSelectedIds.delete(id);else craftingSelectedIds.add(id);updateCraftingLinkControls();renderCraftingGraph()}
function confirmCraftingLink(){
  const graph=craftingEnsureDraft();if(craftingSelectedIds.size<2)return;const ids=[...craftingSelectedIds],map=new Map(graph.nodes.map(n=>[n.id,n])),label=String($('craftingProcessName')?.value||'').trim();
  if(craftingLinkMode==='direct'){const anchor=ids[0];for(const id of ids.slice(1)){if(anchor===id)continue;if(!graph.links.some(l=>l.direct&&((l.a===anchor&&l.b===id)||(l.a===id&&l.b===anchor))))graph.links.push({id:uid(),a:anchor,b:id,label,direct:true})}}
  else{const selected=ids.map(id=>map.get(id)).filter(Boolean),product=selected.find(n=>n.kind==='product'),sources=selected.filter(n=>n!==product),px=selected.reduce((s,n)=>s+(Number(n.x)||50),0)/Math.max(1,selected.length),py=selected.reduce((s,n)=>s+(Number(n.y)||50),0)/Math.max(1,selected.length),pid='process-'+uid();graph.nodes.push({id:pid,kind:'process',label:(label||'Process').slice(0,64),x:product?(px+(Number(product.x)||50))/2:px,y:product?(py+(Number(product.y)||50))/2:py});for(const n of sources)graph.links.push({id:uid(),a:n.id,b:pid,label:''});if(product)graph.links.push({id:uid(),a:pid,b:product.id,label:''})}
  craftingSelectedIds.clear();if($('craftingProcessName'))$('craftingProcessName').value='';updateCraftingLinkControls();renderCraftingGraph()
}
function pointSegDistance(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1;if(!dx&&!dy)return Math.hypot(px-x1,py-y1);const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy)));return Math.hypot(px-(x1+t*dx),py-(y1+t*dy))}
function craftingProcessLabelSide(n,map,w,h,used){const text=craftingNodeRefLabel(n),tw=Math.min(150,Math.max(38,text.length*6.3)),th=18,cx=(Number(n.x)||50)/100*w,cy=(Number(n.y)||50)/100*h,candidates=[['top',cx-tw/2,cy-34],['right',cx+16,cy-th/2],['bottom',cx-tw/2,cy+16],['left',cx-tw-16,cy-th/2]],nodeBoxes=[...map.values()].filter(o=>o.id!==n.id&&o.kind!=='process').map(o=>{const x=(Number(o.x)||50)/100*w,y=(Number(o.y)||50)/100*h,ww=84,hh=84;return{x:x-ww/2,y:y-hh/2,w:ww,h:hh}}),lines=(craftingGraphDraft.links||[]).map(l=>[map.get(l.a),map.get(l.b)]).filter(x=>x[0]&&x[1]),overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;let best=candidates[0],bestScore=1e9;for(const q of candidates){const box={x:q[1],y:q[2],w:tw,h:th};let score=0;if(box.x<4||box.y<4||box.x+box.w>w-4||box.y+box.h>h-4)score+=1000;for(const b of nodeBoxes)if(overlap(box,b))score+=350;for(const b of used)if(overlap(box,b))score+=260;const qx=box.x+box.w/2,qy=box.y+box.h/2;for(const [aa,bb] of lines){if(aa.id===n.id||bb.id===n.id)continue;const d=pointSegDistance(qx,qy,(Number(aa.x)||50)/100*w,(Number(aa.y)||50)/100*h,(Number(bb.x)||50)/100*w,(Number(bb.y)||50)/100*h);if(d<18)score+=(18-d)*12}if(score<bestScore){bestScore=score;best=q}}used.push({x:best[1],y:best[2],w:tw,h:th});return best[0]}
function bindCraftingNodeElement(el,n,map){
  el.addEventListener('click',ev=>{ev.stopPropagation();craftingNodeClick(n.id)});
  if(n.kind==='temporary')el.addEventListener('dblclick',ev=>{ev.preventDefault();ev.stopPropagation();convertTemporaryCraftingNode(n)});
  if(n.kind!=='product')el.addEventListener('pointerdown',ev=>{if(craftingTool!=='move')return;ev.preventDefault();el.setPointerCapture?.(ev.pointerId);const canvas=$('craftingGraphCanvas');if(!canvas)return;const move=mv=>{const rr=canvas.getBoundingClientRect();n.x=Math.max(4,Math.min(96,(mv.clientX-rr.left)/Math.max(1,rr.width)*100));n.y=Math.max(5,Math.min(95,(mv.clientY-rr.top)/Math.max(1,rr.height)*100));el.style.left=n.x+'%';el.style.top=n.y+'%';renderCraftingGraphLinks(map)},up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)})
}
function renderCraftingGraphLinks(mapArg){
  const svg=$('craftingGraphSvg'),graph=craftingGraphDraft;if(!svg||!graph)return;const map=mapArg||new Map((graph.nodes||[]).map(n=>[n.id,n]));svg.replaceChildren();const ns='http://www.w3.org/2000/svg';
  for(const l of graph.links||[]){const aa=map.get(l.a),bb=map.get(l.b);if(!aa||!bb)continue;const x1=Number(aa.x)||50,y1=Number(aa.y)||50,x2=Number(bb.x)||50,y2=Number(bb.y)||50,line=document.createElementNS(ns,'line');line.setAttribute('x1',x1+'%');line.setAttribute('y1',y1+'%');line.setAttribute('x2',x2+'%');line.setAttribute('y2',y2+'%');svg.appendChild(line);if(l.direct&&l.label){const text=document.createElementNS(ns,'text');text.setAttribute('x',((x1+x2)/2)+'%');text.setAttribute('y',((y1+y2)/2)+'%');text.setAttribute('dy','-7');text.setAttribute('class','craft-link-label');text.textContent=String(l.label);svg.appendChild(text)}}
}
function renderCraftingGraph(){
  const host=$('craftingGraphNodes'),svg=$('craftingGraphSvg');if(!host||!svg)return;const graph=craftingEnsureDraft(),product=graph.nodes.find(n=>n&&n.kind==='product');if(product){product.x=50;product.y=50;product.label=$('eName')?.value.trim()||product.label||'Product'}
  const clean=graph.nodes.filter(n=>n&&typeof n==='object'&&n.id);graph.nodes=clean;const map=new Map(clean.map(n=>[n.id,n]));renderCraftingGraphLinks(map);
  const canvas=$('craftingGraphCanvas'),r=canvas?.getBoundingClientRect()||{width:640,height:420},used=[],labelSides=new Map();for(const n of clean)if(n.kind==='process')labelSides.set(n.id,craftingProcessLabelSide(n,map,r.width||640,r.height||420,used));
  const frag=document.createDocumentFragment();for(const n of clean){n.x=Number.isFinite(Number(n.x))?Math.max(4,Math.min(96,Number(n.x))):50;n.y=Number.isFinite(Number(n.y))?Math.max(5,Math.min(95,Number(n.y))):50;const el=document.createElement('div');el.dataset.craftId=n.id;el.style.left=n.x+'%';el.style.top=n.y+'%';const picked=craftingSelectedIds.has(n.id),selected=window.__craftingSelected===n.id;
    if(n.kind==='process'){el.className='craft-node process'+(picked?' link-picked':'')+(selected?' selected':'');const dot=document.createElement('span');dot.className='craft-process-dot';const b=document.createElement('b');b.className='craft-process-label '+(labelSides.get(n.id)||'top');b.textContent=craftingNodeRefLabel(n);el.append(dot,b)}
    else{el.className='craft-node graph-style '+String(n.kind||'ingredient')+(picked?' link-picked':'')+(selected?' selected':'');const ref=n.kind==='product'?craftingGraphNode:byId(n.refId),type=n.kind==='temporary'?'tool':(ref?.type||'magicalObject'),base=window.MAGIC_DATA?.COLORS?.[type]||'#aab4c7';el.style.setProperty('--craft-node-color',base);const b=document.createElement('b');b.textContent=craftingNodeRefLabel(n);el.appendChild(b);if(n.kind==='ingredient'){const em=document.createElement('em'),sp=document.createElement('span'),q=Math.max(1,Number(n.qty)||1);sp.title='Exact: '+formatCraftingQuantity(q,false);sp.textContent=formatCraftingQuantity(q,true)+'×';em.appendChild(sp);el.appendChild(em)}else if(n.kind==='temporary'){const em=document.createElement('em');em.textContent='TEMP · '+String(n.tempType||'other').toUpperCase();el.appendChild(em)}}
    bindCraftingNodeElement(el,n,map);frag.appendChild(el)
  }host.replaceChildren(frag);host.onclick=()=>{if(craftingTool==='move'){window.__craftingSelected=null;renderCraftingGraph()}}
}
function deleteCraftingSelected(){const id=window.__craftingSelected;if(!id||id==='product'||!craftingGraphDraft)return;craftingGraphDraft.nodes=craftingGraphDraft.nodes.filter(n=>n.id!==id);craftingGraphDraft.links=craftingGraphDraft.links.filter(l=>l.a!==id&&l.b!==id);craftingSelectedIds.delete(id);window.__craftingSelected=null;renderCraftingGraph()}
function bindCraftingEditor(node){
  craftingGraphNode=node||null;craftingGraphDraft=normalizeCraftingGraph(node);craftingInsertRefId='';const button=$('toggleCraftingPanel');if(!button)return;
  const syncHubDisabled=()=>{const hub=value('eHubRole')==='hub';button.disabled=hub;button.title=hub?'Hubs do not have crafting recipes':'';button.closest('.crafting-editor-shell')?.toggleAttribute('data-hub-disabled',hub);if(hub)$('craftingGraphPanel')?.classList.add('hidden')};syncHubDisabled();
  button.addEventListener('click',()=>{syncHubDisabled();if(button.disabled)return;const name=$('eName')?.value.trim(),status=$('craftingOpenStatus');if(!name){$('eName')?.classList.add('requirement-missing');if(status)status.textContent='Name this Magical Object before opening its Crafting Graph.';return}$('eName')?.classList.remove('requirement-missing');if(status)status.textContent='';const panel=ensureCraftingPanel();panel.classList.remove('hidden');panel.dataset.dragX='0';panel.dataset.dragY='0';applyPanelDragTransform(panel);populateCraftingCandidates();$('craftingFailOutput').value=craftingGraphDraft.failOutput||'';$('craftingFailBody').classList.toggle('hidden',!craftingGraphDraft.failOutput);setCraftingTool('move');renderCraftingGraph();requestAnimationFrame(()=>keepDetachedPanelOnscreen(panel))});
  $('eName')?.addEventListener('input',()=>{if(craftingGraphDraft?.nodes){const p=craftingGraphDraft.nodes.find(n=>n.kind==='product');if(p)p.label=$('eName').value.trim()||p.label;renderCraftingGraph()}});$('eHubRole')?.addEventListener('change',syncHubDisabled)
}
function collectCraftingRecipe(){const graph=craftingGraphDraft||{nodes:[],links:[],failOutput:''},ingredients=graph.nodes.filter(n=>n.kind==='ingredient'&&n.refId).map(n=>({nodeId:n.refId,qty:Number(n.qty)||1})),process=graph.nodes.filter(n=>n.kind==='process').map(n=>n.label).filter(Boolean).join(' → '),failOutput=String(graph.failOutput||$('craftingFailOutput')?.value||'');return {ingredients,process,failOutput,graph:{nodes:graph.nodes.map(n=>({...n})),links:graph.links.map(l=>({...l})),failOutput}}}


/* ===== v28 detachable Language Graph Editor ===== */
let languageGraphDraft=null,languageGraphNode=null,languageGraphTool='move',languageGraphSelected=new Set();
function normalizeLanguageGraph(node){
  const raw=node?.languageEditorGraph;
  if(raw&&Array.isArray(raw.nodes)&&Array.isArray(raw.links))return {nodes:raw.nodes.map(n=>({...n})),links:raw.links.map(l=>({...l}))};
  return {nodes:[{id:'language-main',kind:'main',label:node?.name||'Language',x:50,y:50}],links:[]}
}
function ensureLanguageGraphPanel(){
  let panel=$('languageGraphPanel');if(panel)return panel;
  panel=document.createElement('aside');panel.id='languageGraphPanel';panel.className='language-graph-panel detached-editor-panel hidden';panel.innerHTML=`
    <div class="language-graph-head"><div><div class="eyebrow">Civilization Utility</div><h3>Language Graph</h3></div><div class="special-editor-window-actions"><button type="button" id="minimizeLanguageGraph" class="icon-btn" title="Minimize">—</button><button type="button" id="closeLanguageGraph" class="icon-btn">×</button></div></div>
    <p class="language-graph-help">The glowing center orb is the language itself. Add Sounds, Symbols, Words, Phrases, Grammar, or custom pieces and connect them.</p>
    <div class="language-graph-toolbar">
      <select id="languagePartType"><option>Sound</option><option>Symbol</option><option>Word</option><option>Phrase</option><option>Grammar</option><option>Meaning</option><option>Custom</option></select>
      <input id="languagePartLabel" placeholder="e.g. /sh/, Hello, Formal greeting">
      <button type="button" id="languageAddPart" class="ghost">+ Insert</button>
      <button type="button" id="languageMoveTool" class="active">↔ Move</button><button type="button" id="languageLinkTool">⌁ Link</button>
      <input id="languageLinkLabel" placeholder="Connection label">
      <button type="button" id="languageConfirmLink" class="primary" disabled>Confirm</button>
    </div>
    <div id="languageGraphHint" class="crafting-link-hint">Move tool · drag language pieces around the orb.</div>
    <div id="languageGraphCanvas" class="language-graph-canvas"><svg id="languageGraphSvg"></svg><div id="languageGraphNodes"></div></div>
    <div class="language-graph-foot"><div><button type="button" id="languageDeletePart" class="danger ghost">Delete selected</button><button type="button" id="languageSaveReturn" class="primary">Save & Return</button></div><span id="languageSyncStatus">This graph is stored inside the Language node.</span></div>`;
  document.body.appendChild(panel);prepareDetachedEditorPanel(panel,panel.querySelector('.language-graph-head'));
  $('closeLanguageGraph').onclick=()=>panel.classList.add('hidden');
  $('minimizeLanguageGraph').onclick=()=>minimizeSpecialEditor(panel,'Language Graph');
  $('languageAddPart').onclick=addLanguageGraphPart;$('languageMoveTool').onclick=()=>setLanguageGraphTool('move');$('languageLinkTool').onclick=()=>setLanguageGraphTool('link');$('languageConfirmLink').onclick=confirmLanguageGraphLink;$('languageDeletePart').onclick=deleteLanguageGraphPart;
  $('languageSaveReturn').onclick=()=>{const count=languageGraphDraft?.nodes?.filter(n=>n.kind!=='main').length||0;const launcher=$('openLanguageGraphEditor')?.closest('.special-editor-launcher');if(launcher?.querySelector('small'))launcher.querySelector('small').textContent=`${count} language pieces synced from the graph editor.`;panel.classList.add('hidden')};
  return panel
}
function minimizeSpecialEditor(panel,label){
  if(!panel)return;panel.classList.add('hidden');let tray=$('minimizedEditorsTray');if(!tray){tray=document.createElement('div');tray.id='minimizedEditorsTray';document.body.appendChild(tray)}
  const old=[...tray.querySelectorAll('[data-special-editor]')].find(x=>x.dataset.specialEditor===panel.id);if(old)return;
  const chip=document.createElement('button');chip.className='minimized-editor-chip';chip.dataset.specialEditor=panel.id;chip.textContent=label;chip.onclick=()=>{panel.classList.remove('hidden');chip.remove();requestAnimationFrame(()=>keepDetachedPanelOnscreen(panel))};tray.appendChild(chip)
}
function setLanguageGraphTool(tool){languageGraphTool=tool;languageGraphSelected.clear();$('languageMoveTool')?.classList.toggle('active',tool==='move');$('languageLinkTool')?.classList.toggle('active',tool==='link');renderLanguageGraph()}
function addLanguageGraphPart(){if(!languageGraphDraft)return;const label=String($('languagePartLabel')?.value||'').trim(),kind=$('languagePartType')?.value||'Custom';if(!label)return;languageGraphDraft.nodes.push({id:'lang-'+uid(),kind:kind.toLowerCase(),label:label.slice(0,80),x:18+Math.random()*64,y:16+Math.random()*68});$('languagePartLabel').value='';renderLanguageGraph()}
function languageGraphNodeClick(id){if(languageGraphTool==='link'){languageGraphSelected.has(id)?languageGraphSelected.delete(id):languageGraphSelected.add(id);$('languageConfirmLink').disabled=languageGraphSelected.size<2}else window.__languageGraphSelected=id;renderLanguageGraph()}
function confirmLanguageGraphLink(){if(!languageGraphDraft||languageGraphSelected.size<2)return;const ids=[...languageGraphSelected],label=String($('languageLinkLabel')?.value||'').trim();for(let i=1;i<ids.length;i++){if(!languageGraphDraft.links.some(l=>(l.a===ids[0]&&l.b===ids[i])||(l.a===ids[i]&&l.b===ids[0])))languageGraphDraft.links.push({id:uid(),a:ids[0],b:ids[i],label})}languageGraphSelected.clear();$('languageConfirmLink').disabled=true;$('languageLinkLabel').value='';renderLanguageGraph()}
function deleteLanguageGraphPart(){const id=window.__languageGraphSelected;if(!id||id==='language-main'||!languageGraphDraft)return;languageGraphDraft.nodes=languageGraphDraft.nodes.filter(n=>n.id!==id);languageGraphDraft.links=languageGraphDraft.links.filter(l=>l.a!==id&&l.b!==id);window.__languageGraphSelected=null;renderLanguageGraph()}
function renderLanguageGraph(){
  const host=$('languageGraphNodes'),svg=$('languageGraphSvg');if(!host||!svg||!languageGraphDraft)return;const main=languageGraphDraft.nodes.find(n=>n.kind==='main');if(main){main.x=50;main.y=50;main.label=$('eName')?.value.trim()||main.label||'Language'}
  const map=new Map(languageGraphDraft.nodes.map(n=>[n.id,n]));svg.innerHTML=languageGraphDraft.links.map(l=>{const aa=map.get(l.a),bb=map.get(l.b);if(!aa||!bb)return'';return`<line x1="${aa.x}%" y1="${aa.y}%" x2="${bb.x}%" y2="${bb.y}%"></line>${l.label?`<text x="${(aa.x+bb.x)/2}%" y="${(aa.y+bb.y)/2}%" dy="-6">${E.esc(l.label)}</text>`:''}`}).join('');
  host.innerHTML=languageGraphDraft.nodes.map(n=>`<div class="language-graph-node ${n.kind==='main'?'main-orb':''} ${languageGraphSelected.has(n.id)?'link-picked':''} ${window.__languageGraphSelected===n.id?'selected':''}" data-language-part="${n.id}" style="left:${n.x}%;top:${n.y}%"><small>${n.kind==='main'?'LANGUAGE':E.esc(n.kind.toUpperCase())}</small><b>${E.esc(n.label)}</b></div>`).join('');
  host.querySelectorAll('[data-language-part]').forEach(el=>{const id=el.dataset.languagePart,n=map.get(id);el.onclick=e=>{e.stopPropagation();languageGraphNodeClick(id)};if(n.kind!=='main')el.onpointerdown=e=>{if(languageGraphTool!=='move')return;e.preventDefault();const canvas=$('languageGraphCanvas'),move=mv=>{const r=canvas.getBoundingClientRect();n.x=Math.max(5,Math.min(95,(mv.clientX-r.left)/r.width*100));n.y=Math.max(7,Math.min(93,(mv.clientY-r.top)/r.height*100));renderLanguageGraph()},up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)}})
}
function bindLanguageGraphEditor(node){
  const btn=$('openLanguageGraphEditor');if(!btn)return;languageGraphNode=node||null;languageGraphDraft=normalizeLanguageGraph(node);
  btn.onclick=()=>{const panel=ensureLanguageGraphPanel();panel.classList.remove('hidden');panel.dataset.dragX='0';panel.dataset.dragY='0';applyPanelDragTransform(panel);setLanguageGraphTool('move');renderLanguageGraph();requestAnimationFrame(()=>keepDetachedPanelOnscreen(panel))}
}

function updateDiseaseKindEditor(){
  const kind=$('eDiseaseKind')?.value||'Disease';
  const isSymptom=kind==='Symptom';

  const diseaseOnlyIds=[
    'eDiseaseSpread',
    'eDiseaseMortality',
    'eDiseaseCure',
    'eDiseaseOrigin'
  ];

  diseaseOnlyIds.forEach(id=>{
    const el=$(id);
    if(el?.closest('label'))el.closest('label').classList.toggle('hidden',isSymptom)
  });

  document.querySelector('.disease-symptom-picker')?.classList.toggle('hidden',isSymptom);
  document.querySelector('.pathogen-genome-editor')?.classList.toggle('hidden',isSymptom);

  // Symptoms use Severity + Duration + Description.
  // Diseases use the full epidemiology form plus selected Symptoms.
  const hint=$('editorBody')?.querySelector('.editor-hint');
  if(hint){
    hint.innerHTML=isSymptom
      ?'<b>Symptom.</b> Define a reusable manifestation such as fever, coughing, hallucinations, magical fatigue, or crystal growth. Symptoms can be attached to multiple Diseases.'
      :'<b>Disease.</b> Define spread, mortality, treatment, origin, and at least one reusable Symptom.'
  }
}


function normalizeCreatorSettings(raw){
  const base=freshMagicCreator(),src=raw&&typeof raw==='object'?raw:{};
  const out={...base,...src};
  out.categories=Array.isArray(src.categories)?src.categories.map((c,i)=>({id:String(c.id||`category${i+1}`).replace(/[^a-zA-Z0-9_-]/g,''),label:String(c.label||c.id||`Category ${i+1}`),color:/^#[0-9a-f]{6}$/i.test(String(c.color||''))?String(c.color):'#8aa4ff',parentId:String(c.parentId||'')})):base.categories;
  out.nodeTypes=Array.isArray(src.nodeTypes)&&src.nodeTypes.length?src.nodeTypes.map((t,i)=>({id:String(t.id||`custom${i+1}`).replace(/[^a-zA-Z0-9_-]/g,''),label:String(t.label||t.id||`Type ${i+1}`),icon:String(t.icon||'◆').slice(0,4),description:String(t.description||''),enabled:t.enabled!==false,builtin:!!t.builtin,useGeneratedEditor:!!t.useGeneratedEditor,category:String(t.category||''),fields:Array.isArray(t.fields)?t.fields.map((f,j)=>({key:String(f.key||`field${j+1}`).replace(/[^a-zA-Z0-9_-]/g,''),label:String(f.label||f.key||`Field ${j+1}`),kind:['input','textarea','number','select'].includes(f.kind)?f.kind:'input',placeholder:String(f.placeholder||''),options:Array.isArray(f.options)?f.options.map(String):String(f.options||'').split(',').map(x=>x.trim()).filter(Boolean)})):[]})):base.nodeTypes;
  out.linkTypes=Array.isArray(src.linkTypes)?src.linkTypes.map((l,i)=>({id:String(l.id||`link${i+1}`).replace(/[^a-zA-Z0-9_-]/g,''),label:String(l.label||l.id||`Link ${i+1}`),enabled:l.enabled!==false,auto:!!l.auto,fromType:String(l.fromType||''),toType:String(l.toType||''),sourceField:String(l.sourceField||''),direction:['forward','backward','both','none'].includes(l.direction)?l.direction:'forward',category:String(l.category||''),style:['solid','dashed','dotted'].includes(l.style)?l.style:'solid',thickness:Math.max(.5,Math.min(6,Number(l.thickness)||1.6)),color:/^#[0-9a-f]{6}$/i.test(String(l.color||''))?String(l.color):'#cfd7ff',matchMode:['contains','exact','list'].includes(l.matchMode)?l.matchMode:'contains'})):base.linkTypes.map(l=>({...l,auto:false,fromType:'',toType:'',sourceField:'',direction:'forward'}));
  out.timelineRules=Array.isArray(src.timelineRules)?src.timelineRules.map((r,i)=>({id:String(r.id||`timeline${i+1}`),name:String(r.name||`Event Rule ${i+1}`),enabled:r.enabled!==false,nodeType:String(r.nodeType||''),kind:String(r.kind||'Event'),title:String(r.title||'{node} changes history'),text:String(r.text||'{node} becomes important to {civilization}.'),cause:String(r.cause||'{node} exists in the creator graph'),tone:String(r.tone||'normal'),impact:{knowledge:Number(r.impact?.knowledge)||0,economy:Number(r.impact?.economy)||0,technology:Number(r.impact?.technology)||0,stability:Number(r.impact?.stability)||0,danger:Number(r.impact?.danger)||0}})):[];
  return out
}
function creatorType(type){return creatorSettings.nodeTypes.find(t=>t.id===type)}
function generatedCreatorType(type){if(type==='civilizationUtil')return null;const t=creatorType(type);return t&&(t.useGeneratedEditor||!t.builtin)?t:null}
function creatorTemplate(str,node){return String(str||'').replace(/\{node\}/g,node?.name||'Unknown').replace(/\{year\}/g,String(simState?.year??0)).replace(/\{civilization\}/g,String(simState?.civ||'Civilization'))}
function applyCreatorBranding(){
  const title=$('creatorSystemTitle'),label=$('creatorVersionLabel');
  if(title)title.textContent=creatorSettings.title||`${creatorSettings.name||'Custom'} Sandbox`;
  if(label)label.textContent=`V28.7bl · ${creatorSettings.name||'Custom'} creator`;
  document.title=`${creatorSettings.title||creatorSettings.name||'Creator Sandbox'} v28.7bl`;
  const p=$('activeCreatorPresetName');if(p)p.textContent=creatorSettings.name||'Custom';
  renderCreatorCreateMenu();refreshCreatorLinkTypes()
}
function renderCreatorCreateMenu(){
  const grid=document.querySelector('#createMenu .create-grid');if(!grid)return;
  const builtins=new Map(MAGIC_CREATOR_TYPES.map(x=>[x[0],x]));
  for(const [id] of builtins){
    const btn=id==='civilizationUtil'?$('createCivilizationUtil'):grid.querySelector(`[data-create="${id}"]`),def=creatorSettings.nodeTypes.find(t=>t.id===id);
    if(!btn)continue;
    btn.classList.toggle('hidden',def?.enabled===false||!def);
    if(def){btn.querySelector('b').textContent=def.icon||'◆';btn.querySelector('span').textContent=def.label||id;btn.querySelector('small').textContent=def.description||''}
  }
  grid.querySelectorAll('.creator-custom-create').forEach(x=>x.remove());
  creatorSettings.nodeTypes.filter(t=>!builtins.has(t.id)&&t.enabled!==false).forEach(def=>{
    const b=document.createElement('button');b.className='creator-custom-create';b.dataset.create=def.id;b.title=def.label;
    b.innerHTML=`<b>${E.esc(def.icon||'◆')}</b><span>${E.esc(def.label)}</span><small>${E.esc(def.description||'Custom creator node.')}</small>`;
    b.onclick=()=>{creatingHub=!!$('createHubToggle')?.checked;openEditor(def.id)};grid.appendChild(b)
  })
}
function creatorLinkDef(id){return creatorSettings.linkTypes.find(l=>l.id===id)}
function refreshCreatorLinkTypes(){
  const sel=$('linkType');if(!sel)return;
  const current=sel.value;
  sel.innerHTML=creatorSettings.linkTypes.filter(x=>x.enabled!==false).map(x=>`<option value="${E.esc(x.id)}">${E.esc(x.label)}</option>`).join('');
  if([...sel.options].some(o=>o.value===current))sel.value=current;
  else if(sel.options.length)sel.selectedIndex=0
}
function generatedEditorHtml(def,node){
  const f=E.field.bind(E);let html=`<div class="editor-grid"><div class="editor-hint full"><b>${E.esc(def.label)} generated editor.</b> This form comes from the active V25 Creator Definition.</div>`;
  html+=f(`${def.label} name`,'eName',node?.name||'',false,'input',`placeholder="e.g. ${E.esc(def.label)}"`);
  for(const field of def.fields||[]){
    const id='creatorField_'+field.key,val=node?.creatorFields?.[field.key]??node?.[field.key]??'';
    if(field.kind==='textarea')html+=f(field.label,id,val,true,'textarea',`placeholder="${E.esc(field.placeholder||'')}"`);
    else if(field.kind==='select')html+=f(field.label,id,(field.options||[]).map(o=>`<option ${String(val)===String(o)?'selected':''}>${E.esc(o)}</option>`).join(''),false,'select');
    else if(field.kind==='number')html+=f(field.label,id,val,false,'input',`type="number" placeholder="${E.esc(field.placeholder||'')}"`);
    else html+=f(field.label,id,val,false,'input',`placeholder="${E.esc(field.placeholder||'')}"`)
  }
  html+=f('Description','eDescription',node?.description||'',true,'textarea','placeholder="Describe this node."');
  return html
}
function saveGeneratedCreatorNode(type){
  const def=generatedCreatorType(type),name=value('eName');if(!def||!name)return false;
  checkpointHistory();let n=editingId?byId(editingId):null;
  if(!n){const a=Math.random()*Math.PI*2,d=220+Math.random()*180;n={id:uid(),type,name,x:Math.cos(a)*d,y:Math.sin(a)*d,vx:0,vy:0,r:16};nodes.push(n)}
  n.type=type;n.name=name;n.description=value('eDescription');n.creatorFields={};
  for(const field of def.fields||[]){const v=value('creatorField_'+field.key);n.creatorFields[field.key]=field.kind==='number'?(Number(v)||0):v;n[field.key]=n.creatorFields[field.key]}
  if($('eHubRole'))setNodeHubRole(n,value('eHubRole'));
  applyUniversalCategoryToNode(n);
  closeEditor();rebuildEdges();ensureTechnologyConnections();renderLibraries();renderTechnologyTree();organize();selectNode(n);graph.fit();save();return true
}
function creatorNodeTypeOptions(selected=''){return creatorDraft.nodeTypes.filter(t=>t.enabled!==false).map(t=>`<option value="${E.esc(t.id)}" ${t.id===selected?'selected':''}>${E.esc(t.label)}</option>`).join('')}
function creatorCategoryOptions(selected=''){return `<option value="">Uncategorized</option>`+(creatorDraft.categories||[]).map(c=>`<option value="${E.esc(c.id)}" ${c.id===selected?'selected':''}>${E.esc(c.label)}</option>`).join('')}
function creatorFieldRow(field={}){return `<div class="creator-field-row"><input class="cf-key" value="${E.esc(field.key||'field')}" placeholder="key"><input class="cf-label" value="${E.esc(field.label||'Field')}" placeholder="Label"><select class="cf-kind">${['input','textarea','number','select'].map(k=>`<option ${field.kind===k?'selected':''}>${k}</option>`).join('')}</select><input class="cf-options" value="${E.esc((field.options||[]).join(', '))}" placeholder="Select options"><input class="cf-placeholder" value="${E.esc(field.placeholder||'')}" placeholder="Placeholder"><button type="button" class="creator-mini-danger">×</button></div>`}
function renderCreatorEditor(){
  creatorDraft=normalizeCreatorSettings(creatorDraft||creatorSettings);$('creatorName').value=creatorDraft.name||'';$('creatorTitle').value=creatorDraft.title||'';$('creatorPreset').value=creatorDraft.preset==='magic'?'magic':'custom';
  const types=$('creatorTypesList');types.innerHTML=creatorDraft.nodeTypes.map((t,i)=>`<article class="creator-item" data-creator-type="${i}"><div class="creator-item-top"><input class="ct-icon" value="${E.esc(t.icon)}" maxlength="4"><input class="ct-label" value="${E.esc(t.label)}"><input class="ct-id" value="${E.esc(t.id)}" ${t.builtin?'readonly':''}><select class="ct-category" title="Category">${creatorCategoryOptions(t.category)}</select><label class="creator-check"><input class="ct-enabled" type="checkbox" ${t.enabled!==false?'checked':''}>Enabled</label><label class="creator-check"><input class="ct-generated" type="checkbox" ${t.useGeneratedEditor||!t.builtin?'checked':''} ${t.id==='civilizationUtil'?'disabled':''}>Generated Editor</label><button class="creator-danger ct-delete" ${t.builtin?'disabled title="Built-in type can be disabled instead"':''}>Delete</button></div><textarea class="ct-description" rows="2" placeholder="Description">${E.esc(t.description||'')}</textarea><div class="creator-fields"><div class="creator-fields-head"><b>Editor fields</b><button type="button" class="ghost ct-add-field">+ Field</button></div><div class="creator-field-list">${(t.fields||[]).map(creatorFieldRow).join('')}</div></div></article>`).join('');
  const categories=$('creatorCategoriesList');
  const categoryTools=categories?.parentElement?.querySelector('.creator-category-hierarchy-tools')||document.createElement('div');
  if(categories&&!categoryTools.classList.contains('creator-category-hierarchy-tools')){categoryTools.className='creator-category-hierarchy-tools';categoryTools.innerHTML='<div><b>Category Hierarchy</b><small>Choose any category and nest it under any other category. Nodes inherit this hierarchy automatically.</small></div><button type="button" id="openCategoryHierarchy" class="primary">◎ Manage Hierarchy</button>';categories.before(categoryTools)}
  categories.innerHTML=(creatorDraft.categories||[]).map((cat,i)=>`<article class="creator-item creator-category-item" data-creator-category="${i}"><input class="cc-label" value="${E.esc(cat.label)}" placeholder="Category name"><input class="cc-id" value="${E.esc(cat.id)}" placeholder="category-id"><select class="cc-parent" title="Branches from"><option value="">Top-level</option>${(creatorDraft.categories||[]).filter((_,j)=>j!==i).map(p=>`<option value="${E.esc(p.id)}" ${cat.parentId===p.id?'selected':''}>↳ ${E.esc(p.label)}</option>`).join('')}</select><input class="cc-color" type="color" value="${E.esc(cat.color||'#8aa4ff')}"><button class="creator-danger cc-delete">Delete</button></article>`).join('');
  const links=$('creatorLinksList');links.innerHTML=creatorDraft.linkTypes.map((l,i)=>`<article class="creator-item creator-link-item" data-creator-link="${i}"><div class="creator-link-main"><input class="cl-label" value="${E.esc(l.label)}" placeholder="Label"><input class="cl-id" value="${E.esc(l.id)}" placeholder="id"><select class="cl-category" title="Connection category">${creatorCategoryOptions(l.category)}</select><label class="creator-check"><input class="cl-enabled" type="checkbox" ${l.enabled!==false?'checked':''}>Enabled</label><label class="creator-check"><input class="cl-auto" type="checkbox" ${l.auto?'checked':''}>Automatic</label><button class="creator-danger cl-delete">Delete</button></div><div class="creator-link-style"><label>Line style<select class="cl-style">${['solid','dashed','dotted'].map(v=>`<option ${l.style===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Thickness<input class="cl-thickness" type="number" min="0.5" max="6" step="0.1" value="${l.thickness||1.6}"></label><label>Color<input class="cl-color" type="color" value="${E.esc(l.color||'#cfd7ff')}"></label><label>Auto match<select class="cl-match">${[['contains','Contains target name'],['exact','Exact target name'],['list','Comma/semicolon list']].map(([v,n])=>`<option value="${v}" ${l.matchMode===v?'selected':''}>${n}</option>`).join('')}</select></label></div><div class="creator-link-rule"><label>Source type<select class="cl-from"><option value="">Any</option>${creatorNodeTypeOptions(l.fromType)}</select></label><label>Target type<select class="cl-to"><option value="">Any</option>${creatorNodeTypeOptions(l.toType)}</select></label><label>Source field key<input class="cl-field" value="${E.esc(l.sourceField||'')}" placeholder="e.g. fuel"></label><label>Direction<select class="cl-direction">${['forward','backward','both','none'].map(d=>`<option ${l.direction===d?'selected':''}>${d}</option>`).join('')}</select></label><small>Automatic rules can match by contains, exact name, or a comma/semicolon-separated list. Style settings are used for auto-links and as defaults for new manual links.</small></div></article>`).join('');
  const timeline=$('creatorTimelineList');timeline.innerHTML=creatorDraft.timelineRules.map((r,i)=>`<article class="creator-item creator-event-item" data-creator-event="${i}"><div class="creator-item-top"><input class="ce-name" value="${E.esc(r.name)}" placeholder="Rule name"><select class="ce-node-type"><option value="">Any node</option>${creatorNodeTypeOptions(r.nodeType)}</select><label class="creator-check"><input class="ce-enabled" type="checkbox" ${r.enabled!==false?'checked':''}>Enabled</label><button class="creator-danger ce-delete">Delete</button></div><div class="creator-event-grid"><label>Event kind<input class="ce-kind" value="${E.esc(r.kind)}"></label><label>Tone<select class="ce-tone">${['normal','major','breakthrough','crisis','pale-good','pale-bad'].map(t=>`<option ${r.tone===t?'selected':''}>${t}</option>`).join('')}</select></label><label class="full">Title template<input class="ce-title" value="${E.esc(r.title)}"></label><label class="full">Event text<textarea class="ce-text" rows="2">${E.esc(r.text)}</textarea></label><label class="full">Cause / reasoning<textarea class="ce-cause" rows="2">${E.esc(r.cause)}</textarea></label><label>Knowledge<input class="ce-impact" data-impact="knowledge" type="number" value="${r.impact?.knowledge||0}"></label><label>Economy<input class="ce-impact" data-impact="economy" type="number" value="${r.impact?.economy||0}"></label><label>Technology<input class="ce-impact" data-impact="technology" type="number" value="${r.impact?.technology||0}"></label><label>Stability<input class="ce-impact" data-impact="stability" type="number" value="${r.impact?.stability||0}"></label><label>Danger<input class="ce-impact" data-impact="danger" type="number" value="${r.impact?.danger||0}"></label></div></article>`).join('');
  $('creatorDefinitionJson').value=JSON.stringify(creatorDraft,null,2);bindCreatorEditorRows();$('openCategoryHierarchy')?.addEventListener('click',openCategoryHierarchyPanel)
}
function harvestCreatorVisual(){
  if(!creatorDraft)return;
  creatorDraft.name=$('creatorName').value.trim()||'Custom Creator';creatorDraft.title=$('creatorTitle').value.trim()||`${creatorDraft.name} Sandbox`;creatorDraft.preset=$('creatorPreset').value;
  document.querySelectorAll('[data-creator-type]').forEach(row=>{const t=creatorDraft.nodeTypes[+row.dataset.creatorType];if(!t)return;t.icon=row.querySelector('.ct-icon').value||'◆';t.label=row.querySelector('.ct-label').value||t.id;t.id=row.querySelector('.ct-id').value.replace(/[^a-zA-Z0-9_-]/g,'')||t.id;t.category=row.querySelector('.ct-category')?.value||'';t.enabled=row.querySelector('.ct-enabled').checked;t.useGeneratedEditor=row.querySelector('.ct-generated').checked;t.description=row.querySelector('.ct-description').value;t.fields=[...row.querySelectorAll('.creator-field-row')].map(fr=>({key:fr.querySelector('.cf-key').value.replace(/[^a-zA-Z0-9_-]/g,'')||'field',label:fr.querySelector('.cf-label').value||'Field',kind:fr.querySelector('.cf-kind').value,options:fr.querySelector('.cf-options').value.split(',').map(x=>x.trim()).filter(Boolean),placeholder:fr.querySelector('.cf-placeholder').value}))});
  creatorDraft.categories=[...document.querySelectorAll('[data-creator-category]')].map((row,i)=>({id:row.querySelector('.cc-id').value.replace(/[^a-zA-Z0-9_-]/g,'')||`category${i+1}`,label:row.querySelector('.cc-label').value||`Category ${i+1}`,color:row.querySelector('.cc-color').value||'#8aa4ff',parentId:row.querySelector('.cc-parent')?.value||''}));
  document.querySelectorAll('[data-creator-link]').forEach(row=>{const l=creatorDraft.linkTypes[+row.dataset.creatorLink];if(!l)return;l.label=row.querySelector('.cl-label').value||l.id;l.id=row.querySelector('.cl-id').value.replace(/[^a-zA-Z0-9_-]/g,'')||l.id;l.enabled=row.querySelector('.cl-enabled').checked;l.auto=!!row.querySelector('.cl-auto')?.checked;l.fromType=row.querySelector('.cl-from')?.value||'';l.toType=row.querySelector('.cl-to')?.value||'';l.sourceField=row.querySelector('.cl-field')?.value.trim()||'';l.direction=row.querySelector('.cl-direction')?.value||'forward';l.category=row.querySelector('.cl-category')?.value||'';l.style=row.querySelector('.cl-style')?.value||'solid';l.thickness=Math.max(.5,Math.min(6,+row.querySelector('.cl-thickness')?.value||1.6));l.color=row.querySelector('.cl-color')?.value||'#cfd7ff';l.matchMode=row.querySelector('.cl-match')?.value||'contains'});
  document.querySelectorAll('[data-creator-event]').forEach(row=>{const r=creatorDraft.timelineRules[+row.dataset.creatorEvent];if(!r)return;r.name=row.querySelector('.ce-name').value||'Event Rule';r.nodeType=row.querySelector('.ce-node-type').value;r.enabled=row.querySelector('.ce-enabled').checked;r.kind=row.querySelector('.ce-kind').value||'Event';r.tone=row.querySelector('.ce-tone').value;r.title=row.querySelector('.ce-title').value;r.text=row.querySelector('.ce-text').value;r.cause=row.querySelector('.ce-cause').value;r.impact={};row.querySelectorAll('.ce-impact').forEach(el=>r.impact[el.dataset.impact]=Number(el.value)||0)});
  $('creatorDefinitionJson').value=JSON.stringify(creatorDraft,null,2)
}
function bindCreatorEditorRows(){
  document.querySelectorAll('.ct-add-field').forEach(btn=>btn.onclick=()=>{const row=btn.closest('[data-creator-type]'),list=row.querySelector('.creator-field-list');list.insertAdjacentHTML('beforeend',creatorFieldRow({key:'field',label:'Field',kind:'input'}));bindCreatorEditorRows()});
  document.querySelectorAll('.creator-mini-danger').forEach(btn=>btn.onclick=()=>btn.closest('.creator-field-row')?.remove());
  document.querySelectorAll('.ct-delete:not([disabled])').forEach(btn=>btn.onclick=()=>{harvestCreatorVisual();creatorDraft.nodeTypes.splice(+btn.closest('[data-creator-type]').dataset.creatorType,1);renderCreatorEditor()});
  document.querySelectorAll('.cc-delete').forEach(btn=>btn.onclick=()=>{harvestCreatorVisual();const row=btn.closest('[data-creator-category]'),removed=creatorDraft.categories.splice(+row.dataset.creatorCategory,1)[0];if(removed){creatorDraft.nodeTypes.forEach(t=>{if(t.category===removed.id)t.category=''});creatorDraft.linkTypes.forEach(l=>{if(l.category===removed.id)l.category=''});creatorDraft.categories.forEach(c=>{if(c.parentId===removed.id)c.parentId=''})}renderCreatorEditor()});
  document.querySelectorAll('.cl-delete').forEach(btn=>btn.onclick=()=>{harvestCreatorVisual();creatorDraft.linkTypes.splice(+btn.closest('[data-creator-link]').dataset.creatorLink,1);renderCreatorEditor()});
  document.querySelectorAll('.ce-delete').forEach(btn=>btn.onclick=()=>{harvestCreatorVisual();creatorDraft.timelineRules.splice(+btn.closest('[data-creator-event]').dataset.creatorEvent,1);renderCreatorEditor()})
}

function ensureCategoryHierarchyPanel(){
  let panel=$('categoryHierarchyPanel');if(panel)return panel;
  panel=document.createElement('aside');panel.id='categoryHierarchyPanel';panel.className='category-hierarchy-panel detached-editor-panel hidden';panel.innerHTML=`
    <div class="category-hierarchy-head"><div><div class="eyebrow">Creator Editor</div><h3>Category Hierarchy</h3></div><button id="closeCategoryHierarchy" class="icon-btn">×</button></div>
    <p>Every category can be top-level or a subcategory of any other category. Circular loops are prevented automatically.</p>
    <div id="categoryHierarchyRows" class="category-hierarchy-rows"></div>
    <div class="special-editor-savebar"><span>Subcategory circles will stay inside their parent category on the main graph.</span><button id="categoryHierarchyDone" class="primary">Apply & Return</button></div>`;
  document.body.appendChild(panel);prepareDetachedEditorPanel(panel,panel.querySelector('.category-hierarchy-head'));$('closeCategoryHierarchy').onclick=()=>panel.classList.add('hidden');$('categoryHierarchyDone').onclick=()=>{harvestCategoryHierarchyPanel();panel.classList.add('hidden');renderCreatorEditor()};return panel
}
function categoryWouldCycle(catId,parentId){
  if(!catId||!parentId)return false;if(catId===parentId)return true;const map=new Map((creatorDraft.categories||[]).map(c=>[c.id,c.parentId||'']));map.set(catId,parentId);let cur=parentId,seen=new Set([catId]);while(cur){if(seen.has(cur))return true;seen.add(cur);cur=map.get(cur)||''}return false
}
function renderCategoryHierarchyPanel(){
  const host=$('categoryHierarchyRows');if(!host)return;const cats=creatorDraft.categories||[];
  host.innerHTML=cats.map(cat=>`<div class="category-hierarchy-row" data-hierarchy-category="${E.esc(cat.id)}"><span class="category-hierarchy-swatch" style="background:${E.esc(cat.color||'#8aa4ff')}"></span><b>${E.esc(cat.label)}</b><span>is a subcategory of</span><select><option value="">Nothing — top level</option>${cats.filter(p=>p.id!==cat.id).map(p=>`<option value="${E.esc(p.id)}" ${cat.parentId===p.id?'selected':''}>${E.esc(p.label)}</option>`).join('')}</select></div>`).join('');
  host.querySelectorAll('select').forEach(sel=>sel.onchange=()=>{const row=sel.closest('[data-hierarchy-category]'),id=row.dataset.hierarchyCategory;if(categoryWouldCycle(id,sel.value)){sel.value=(creatorDraft.categories.find(c=>c.id===id)?.parentId||'');sel.classList.add('requirement-missing');setTimeout(()=>sel.classList.remove('requirement-missing'),900)}})
}
function harvestCategoryHierarchyPanel(){
  document.querySelectorAll('[data-hierarchy-category]').forEach(row=>{const cat=creatorDraft.categories.find(c=>c.id===row.dataset.hierarchyCategory),parent=row.querySelector('select')?.value||'';if(cat&&!categoryWouldCycle(cat.id,parent))cat.parentId=parent})
}
function openCategoryHierarchyPanel(){harvestCreatorVisual();const panel=ensureCategoryHierarchyPanel();renderCategoryHierarchyPanel();panel.classList.remove('hidden');requestAnimationFrame(()=>keepDetachedPanelOnscreen(panel))}
function creatorParentCategoryForNode(n){
  if(!n?.category)return'';const q=String(n.category).trim().toLowerCase(),cat=(creatorSettings.categories||[]).find(c=>String(c.id).toLowerCase()===q||String(c.label).trim().toLowerCase()===q);if(!cat?.parentId)return'';const p=(creatorSettings.categories||[]).find(x=>x.id===cat.parentId);return p?.label||p?.id||''
}
function syncNodeCategoryHierarchy(){
  for(const n of nodes){if(n.virtual||n.isHub)continue;const inherited=creatorParentCategoryForNode(n);if(inherited)n.parentCategory=inherited}
}

function openCreatorEditorModal(){creatorDraft=normalizeCreatorSettings(JSON.parse(JSON.stringify(creatorSettings)));renderCreatorEditor();$('addonsModal').classList.add('hidden');$('creatorEditorModal').classList.remove('hidden')}
function applyCreatorAutomaticLinks(){
  for(const rule of creatorSettings.linkTypes||[]){
    if(rule.enabled===false||!rule.auto||!rule.sourceField)continue;
    const sources=nodes.filter(n=>!n.virtual&&!n.isHub&&(!rule.fromType||n.type===rule.fromType));
    const targets=nodes.filter(n=>!n.virtual&&!n.isHub&&(!rule.toType||n.type===rule.toType));
    for(const a of sources){
      const raw=a.creatorFields?.[rule.sourceField]??a[rule.sourceField]??'';
      const hay=String(raw).trim().toLowerCase();if(!hay)continue;
      const list=hay.split(/[;,|]/).map(x=>x.trim()).filter(Boolean);
      for(const b of targets){if(a===b||!b.name)continue;const targetName=String(b.name).trim().toLowerCase();const matched=rule.matchMode==='exact'?hay===targetName:rule.matchMode==='list'?list.includes(targetName):hay.includes(targetName);if(!matched)continue;
        const exists=edges.some(e=>!e.blocked&&((e.a===a.id&&e.b===b.id)||(e.a===b.id&&e.b===a.id))&&(e.creatorRuleId===rule.id||e.manual));
        if(!exists&&!isBlockedAutomatic(a.id,b.id,rule.id))edges.push({id:uid(),a:a.id,b:b.id,type:rule.id,linkType:rule.id,label:rule.label||rule.id,direction:rule.direction||'forward',creatorAuto:true,creatorRuleId:rule.id,strength:rule.style||'solid',thickness:rule.thickness||1.6,color:rule.color||'#cfd7ff',creatorCategory:rule.category||''})
      }
    }
  }
}
function addCreatorTimelineEvents(pool){
  for(const rule of creatorSettings.timelineRules||[]){
    if(rule.enabled===false)continue;const candidates=rule.nodeType?nodes.filter(n=>n.type===rule.nodeType&&!n.isHub&&!n.virtual):nodes.filter(n=>!n.isHub&&!n.virtual&&n.type!=='mana');if(!candidates.length)continue;
    pool.push(()=>{const node=pick(candidates);return event(rule.kind||'Event',creatorTemplate(rule.title,node),creatorTemplate(rule.text,node),[node?.name||'Creator Event',rule.name||'Custom'],{...(rule.impact||{})},rule.tone||'normal',[creatorTemplate(rule.cause,node),`Creator rule: ${rule.name||'Custom event'}`].filter(Boolean))})
  }
  const failedSpells=nodes.filter(n=>n.type==='spell'&&!n.isHub&&String(n.failOutput||'').trim());
  if(failedSpells.length)pool.push(()=>{const s=pick(failedSpells);return event('Spell Failure',`${s.name} fails during use`,s.failOutput,[s.name,'Failure'],{danger:Math.max(1,Math.round(Math.max(0,-(s.morality||0))/18)),knowledge:2},(s.morality||0)<-15?'crisis':'normal',[`${s.name} has a defined fail output`])});
  const failedCraft=nodes.filter(n=>n.type==='magicalObject'&&!n.isHub&&String(n.craftingRecipe?.failOutput||'').trim());
  if(failedCraft.length)pool.push(()=>{const o=pick(failedCraft);return event('Crafting Failure',`${o.name} production fails`,o.craftingRecipe.failOutput,[o.name,'Crafting','Failure'],{economy:-2,knowledge:2,danger:1},'normal',[`${o.name} has a crafting failure output`])});
  const helperCraft=nodes.filter(n=>n.type==='magicalObject'&&!n.isHub&&n.craftingRecipe?.graph?.nodes?.some(x=>x.kind==='temporary'));
  if(helperCraft.length)pool.push(()=>{const o=pick(helperCraft),helpers=o.craftingRecipe.graph.nodes.filter(x=>x.kind==='temporary').map(x=>x.label).slice(0,3);return event('Crafting Innovation',`${o.name} process is refined`,`Craftspeople improve production of ${o.name} by using temporary aids such as ${helpers.join(', ')} without consuming them as permanent ingredients.`,[o.name,'Crafting','Process'],{economy:3,technology:2,knowledge:2},'breakthrough',[`Recipe contains temporary crafting helpers`])});
  const located=nodes.filter(n=>n.type==='material'&&n.materialPlaceId&&byId(n.materialPlaceId));
  if(located.length)pool.push(()=>{const m=pick(located),p=byId(m.materialPlaceId),rel=m.materialPlaceMode==='only-found'?'only known source':m.materialPlaceMode==='mostly-found'?'main concentration':'common source';return event('Resource',`${m.name} reshapes the importance of ${p.name}`,`${p.name} becomes a ${rel} of ${m.name}, changing trade, research, settlement, and strategic planning.`,[m.name,p.name,'Resource'],{economy:3,stability:m.materialPlaceMode==='only-found'?-2:1,knowledge:1},'major',[`Material occurrence is explicitly assigned to ${p.name}`])});
}


function failOutputControlHtml(id,current='',title='Fail output'){
  const has=!!String(current||'').trim();
  return `<div class="full fail-output-control ${has?'open':''}" data-fail-control="${id}">
    <button type="button" class="fail-output-plus" aria-expanded="${has?'true':'false'}"><span>＋</span>${E.esc(title)}</button>
    <div class="fail-output-body ${has?'':'hidden'}"><textarea id="${id}" rows="3" placeholder="What happens when this fails?">${E.esc(current||'')}</textarea><small>This can generate failure events in the civilization timeline.</small></div>
  </div>`
}
function bindFailOutputControls(root=document){
  root.querySelectorAll?.('[data-fail-control]').forEach(box=>{
    const btn=box.querySelector('.fail-output-plus'),body=box.querySelector('.fail-output-body');if(!btn||!body||btn.dataset.bound)return;btn.dataset.bound='1';
    btn.onclick=()=>{const open=body.classList.toggle('hidden')===false;box.classList.toggle('open',open);btn.setAttribute('aria-expanded',String(open));if(open)body.querySelector('textarea,input')?.focus()}
  })
}


let countryBorderDraft=[];
const COUNTRY_BORDER_COLS=64,COUNTRY_BORDER_ROWS=32;
function countryBorderKey(kind,x,y){return `${kind}:${x}:${y}`}
function parseCountryBorderKey(key){const [kind,x,y]=String(key||'').split(':');return{kind,x:+x,y:+y}}
function normalizeCountryBorderSegments(list){return [...new Set((Array.isArray(list)?list:[]).filter(k=>/^[vh]:\d+:\d+$/.test(String(k))))]}
let countryBorderView={yaw:.45,pitch:-.12};
function countryBorderPainterPlanet(){
  if(countryUsesImplicitPlanet())return activeSurfacePlanetNode()||activePlanetPlace()||(simState.planet?{id:'__active_planet__',name:simState.planet.name||'Active Planet',gasGiant:!!simState.planet.gasGiant,__useActiveModel:true}:null);
  return byId(value('eSurfacePlanet'))||null
}
function countryPainterProject(lat,lon,w,h){
  const yaw=countryBorderView.yaw,pitch=countryBorderView.pitch,cl=Math.cos(lat);let x=cl*Math.cos(lon),y=Math.sin(lat),z=cl*Math.sin(lon);
  const cy=Math.cos(yaw),sy=Math.sin(yaw);[x,z]=[x*cy-z*sy,x*sy+z*cy];const cp=Math.cos(pitch),sp=Math.sin(pitch);[x,y]=[x*cp-y*sp,x*sp+y*cp];const R=Math.min(w,h)*.43;return{x:w/2+z*R,y:h/2-y*R,front:x>0,depth:x,R}
}
function countryPainterInverse(canvas,clientX,clientY){
  const r=canvas.getBoundingClientRect(),w=r.width,h=r.height,R=Math.min(w,h)*.43,z=(clientX-r.left-w/2)/R,y=-(clientY-r.top-h/2)/R;if(z*z+y*y>1)return null;let x=Math.sqrt(Math.max(0,1-z*z-y*y));const cp=Math.cos(countryBorderView.pitch),sp=Math.sin(countryBorderView.pitch);[x,y]=[x*cp+y*sp,-x*sp+y*cp];const cy=Math.cos(countryBorderView.yaw),sy=Math.sin(countryBorderView.yaw);[x,z]=[x*cy+z*sy,-x*sy+z*cy];return{lat:Math.asin(Math.max(-1,Math.min(1,y))),lon:Math.atan2(z,x)}
}
function countryPainterTerrainColor(planet,lat,lon){
  const active=activeSurfacePlanetNode();if(active&&planet&&active.id===planet.id){const c=planetTerrainColorAt(lat,lon);if(c)return c}
  if(planet?.gasGiant){const bands=[planet.planetGasColor||'#d6b783',planet.planetGasColor2||'#a87a58',planet.planetGasColor3||'#eee0b5'];return bands[Math.abs(Math.floor((lat+Math.PI/2)*10))%3]}
  const seed=[...String(planet?.id||planet?.name||'planet')].reduce((a,c)=>a+c.charCodeAt(0),0),n=planetSmooth(lat*2.25,lon*2.25,seed+99),threshold=(.56-(+planet?.planetLandCoverage||45)/500),land=n>threshold;
  if(!land&&planet?.planetOceanEnabled!==false){const deep=(threshold-n)>.10||planetSmooth(lat*4.2,lon*4.2,seed+733)>.72;return deep?(planet?.planetOceanColor2||'#102f58'):(planet?.planetOceanColor||'#315f9f')}
  const p0=planet?.planetLandColor||'#5d8f5a',p1=planet?.planetLandColor2||'#78915b',p2=planet?.planetLandColor3||'#8d8655',moist=planetSmooth(lat*3.1,lon*3.1,seed+301);
  // v28.7am: procedural terrestrial terrain NEVER invents hidden biome accents.
  // The planet uses only the three visible land palette colors, even before an explicit Save Palette.
  return n>.69?p2:moist>.56?p1:p0
}
function v287yCountryPlanetSnapshot(planet){
  if(!planet)return null;
  const sig=v287afSnapshotSignature(planet),cachedPreview=v287afPlanetSnapshotCache.get(planet.id);
  if(cachedPreview?.sig===sig)return cachedPreview.snap;
  const active=activeSurfacePlanetNode();
  if((planet.__useActiveModel||active?.id===planet.id)&&simState.planet&&planetTerrainCache.length){const snap={planet:deepCloneState(simState.planet),cells:deepCloneState(planetTerrainCache)};v287afPlanetSnapshotCache.set(planet.id,{sig,snap});return snap}
  const cached=Object.values(worldStateCache.planets||{}).find(v=>v?.planet?.name===planet.name);
  const oldPlanet=simState.planet,oldOverride=simState.planetOverride,oldCells=planetTerrainCache;
  try{
    simState.planetOverride=v287yPlanetOverrideFromNode(planet);
    if(cached?.planet)simState.planet={...deepCloneState(cached.planet),...simState.planetOverride};
    else{
      const seed=simState.planetOverride.seed,count=3+(Math.abs(Math.floor(seed))%4),shape=buildContinents(seed,count);
      simState.planet={seed,name:planet.name,continents:count,continentData:shape.continents,islandData:shape.islands,...simState.planetOverride}
    }
    buildPlanetTerrainCache();
    const snap={planet:deepCloneState(simState.planet),cells:deepCloneState(planetTerrainCache)};v287afPlanetSnapshotCache.set(planet.id,{sig,snap});return snap
  }finally{simState.planet=oldPlanet;simState.planetOverride=oldOverride;planetTerrainCache=oldCells}
}
const v287afSphereVectorCache=new Map();
function v287yPainterProject(lat,lon,w,h){
  const key=lat+'|'+lon;let v=v287afSphereVectorCache.get(key);
  if(!v){const cl=Math.cos(lat);v=[cl*Math.cos(lon),Math.sin(lat),cl*Math.sin(lon)];v287afSphereVectorCache.set(key,v)}
  let x=v[0],y=v[1],z=v[2],yaw=countryBorderView.yaw,pitch=countryBorderView.pitch;
  const cy=Math.cos(yaw),sy=Math.sin(yaw);[x,z]=[x*cy-z*sy,x*sy+z*cy];const cp=Math.cos(pitch),sp=Math.sin(pitch);[x,y]=[x*cp-y*sp,x*sp+y*cp];const R=Math.min(w,h)*.43;
  return{x:w/2+z*R,y:h/2-y*R,front:x>0,depth:x,R}
}
function v287yLandscapeTileForPlanet(planet,lat,lon){const key=v287pSurfacePixelIndex(lat,lon);return planet?.planetLandscapeTiles?.[key]||null}
function v287yRenderActualPlanetModel(ctx,w,h,planet){
  const snap=v287yCountryPlanetSnapshot(planet);if(!snap)return;
  const R=Math.min(w,h)*.43,cx=w/2,cy=h/2,p=snap.planet||{},gas=!!p.gasGiant;
  const oceanBase=gas?(p.gasColor||'#d6b783'):(p.oceanEnabled===false?(p.landColor||'#8a7654'):(p.oceanColor||'#315f9f'));
  const oceanDeep=gas?(p.gasColor2||'#a87a58'):(p.oceanEnabled===false?(p.landColor2||oceanBase):(p.oceanColor2||'#102f58'));
  const grad=ctx.createRadialGradient(cx-R*.3,cy-R*.35,R*.1,cx,cy,R*1.1);grad.addColorStop(0,oceanBase);grad.addColorStop(.62,oceanBase);grad.addColorStop(1,oceanDeep);
  ctx.fillStyle=grad;ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.fill();ctx.save();ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.clip();
  for(const cell of snap.cells||[]){const mid=v287yPainterProject(cell.midLat,cell.midLon,w,h);if(!mid.front)continue;const ps=[v287yPainterProject(cell.lat0,cell.lon0,w,h),v287yPainterProject(cell.lat0,cell.lon1,w,h),v287yPainterProject(cell.lat1,cell.lon1,w,h),v287yPainterProject(cell.lat1,cell.lon0,w,h)];if(ps.every(q=>!q.front))continue;const custom=v287yLandscapeTileForPlanet(planet,cell.midLat,cell.midLon);ctx.fillStyle=custom?.color||cell.color;ctx.beginPath();ctx.moveTo(ps[0].x,ps[0].y);for(let i=1;i<4;i++)ctx.lineTo(ps[i].x,ps[i].y);ctx.closePath();ctx.fill()}
  ctx.restore();ctx.strokeStyle='rgba(150,216,245,.45)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.stroke()
}
function ensureCountryBorderPainter(){
  let panel=$('countryBorderPainter');if(panel)return panel;
  panel=document.createElement('aside');panel.id='countryBorderPainter';panel.className='country-border-painter hidden';
  panel.innerHTML=`<div class="country-border-head"><div><div class="eyebrow">Country Place</div><h3>Border Painter</h3></div><button id="closeCountryBorderPainter" class="icon-btn">×</button></div>
    <div class="country-border-tools"><button data-border-mode="draw" class="active">✎ Draw</button><button data-border-mode="erase">⌫ Erase</button><button data-border-mode="rotate">↻ Rotate Globe</button><button id="countryBorderProcedural">Procedural</button><button id="countryBorderClear">Clear All</button></div>
    <canvas id="countryBorderCanvas" width="720" height="720"></canvas>
    <div class="country-border-status"><b id="countryBorderCount">0 border segments</b><small id="countryBorderPlanetNote">Draw directly on the globe. Right-drag rotates. Right-click while drawing erases.</small></div>`;
  document.body.appendChild(panel);prepareDetachedEditorPanel(panel,panel.querySelector('.country-border-head'));
  const canvas=$('countryBorderCanvas'),ctx=canvas.getContext('2d');let mode='draw',drag=false,lastClient=null,strokeChanged=false;
  const persist=()=>{const n=editingId?byId(editingId):null;if(n?.type==='place'&&String(n.placeScale||inferPlaceScale(n.placeType))==='country'){n.countryBorderSegments=normalizeCountryBorderSegments(countryBorderDraft);save()}requestPlanetDraw?.()};
  const redraw=()=>{
    const w=canvas.width,h=canvas.height,planet=countryBorderPainterPlanet();ctx.clearRect(0,0,w,h);ctx.fillStyle='#07101a';ctx.fillRect(0,0,w,h);
    const note=$('countryBorderPlanetNote');if(note)note.textContent=planet?`${planet.name||'Planet'} · draw on the real terrain globe · left-drag ${mode==='erase'?'erases':'draws'} · right-drag rotates`:(countryUsesImplicitPlanet()?'Planet-scale system · open the world map once so the active planet can be sampled.':'Choose a planet in the Country Editor before painting.');
    if($('countryBorderCount'))$('countryBorderCount').textContent=`${countryBorderDraft.length} border segment${countryBorderDraft.length===1?'':'s'}`;
    if(!planet){ctx.fillStyle='#dbe7f8';ctx.font='600 18px system-ui';ctx.textAlign='center';ctx.fillText('Choose a planet first',w/2,h/2);return}
    v287yRenderActualPlanetModel(ctx,w,h,planet);
    const R=Math.min(w,h)*.43,cx=w/2,cy=h/2;ctx.save();ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.clip();ctx.strokeStyle='#ffffff';ctx.lineWidth=5;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=5;ctx.beginPath();
    for(const key of normalizeCountryBorderSegments(countryBorderDraft)){const a=countryBorderLatLonEndpoint(key,0),b=countryBorderLatLonEndpoint(key,1),A=countryPainterProject(a.lat,a.lon,w,h),B=countryPainterProject(b.lat,b.lon,w,h);if(A.front&&B.front&&Math.hypot(A.x-B.x,A.y-B.y)<R*.38){ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y)}}
    ctx.stroke();ctx.restore();
  };
  panel._redraw=redraw;
  const inverseAt=(clientX,clientY)=>countryPainterInverse(canvas,clientX,clientY);
  const keyForPoint=(clientX,clientY)=>{const q=inverseAt(clientX,clientY);if(!q)return null;const gx=(q.lon+Math.PI)/(Math.PI*2)*COUNTRY_BORDER_COLS,gy=(Math.PI/2-q.lat)/Math.PI*COUNTRY_BORDER_ROWS;const vx=Math.round(gx),hy=Math.round(gy),dv=Math.abs(gx-vx),dh=Math.abs(gy-hy);if(dv<=dh)return countryBorderKey('v',((vx%COUNTRY_BORDER_COLS)+COUNTRY_BORDER_COLS)%COUNTRY_BORDER_COLS,Math.max(0,Math.min(COUNTRY_BORDER_ROWS-1,Math.floor(gy))));return countryBorderKey('h',Math.max(0,Math.min(COUNTRY_BORDER_COLS-1,Math.floor(gx))),Math.max(0,Math.min(COUNTRY_BORDER_ROWS,hy)))};
  const applyKey=(key,erase=false)=>{if(!key)return;const set=new Set(countryBorderDraft),before=set.size;erase?set.delete(key):set.add(key);countryBorderDraft=[...set];if(set.size!==before)strokeChanged=true};
  const paintSegment=(a,b,erase=false)=>{if(!a||!b)return;const dist=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(dist/5));for(let i=0;i<=steps;i++){const t=i/steps;applyKey(keyForPoint(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t),erase)}redraw()};
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{drag=true;strokeChanged=false;lastClient={x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId);if(mode==='rotate'||e.button===2)return;paintSegment(lastClient,lastClient,mode==='erase')});
  canvas.addEventListener('pointermove',e=>{if(!drag||!lastClient)return;const now={x:e.clientX,y:e.clientY};if(mode==='rotate'||(e.buttons&2)){const dx=now.x-lastClient.x,dy=now.y-lastClient.y;countryBorderView.yaw+=dx*.009;countryBorderView.pitch=Math.max(-1.25,Math.min(1.25,countryBorderView.pitch+dy*.007));redraw()}else paintSegment(lastClient,now,mode==='erase');lastClient=now});
  const stop=()=>{if(strokeChanged)persist();drag=false;lastClient=null;strokeChanged=false};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
  panel.querySelectorAll('[data-border-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.borderMode;panel.querySelectorAll('[data-border-mode]').forEach(x=>x.classList.toggle('active',x===b));canvas.style.cursor=mode==='rotate'?'grab':'crosshair';redraw()});
  $('countryBorderClear').onclick=()=>{countryBorderDraft=[];persist();redraw()};
  $('countryBorderProcedural').onclick=()=>{const seed=[...String(value('eName')||'Country')].reduce((a,c)=>a+c.charCodeAt(0),0),cx=8+(seed%48),cy=6+((seed*7)%20),rx=5+(seed%7),ry=3+((seed*3)%5),pts=[];for(let i=0;i<36;i++){const a=i/36*Math.PI*2,x=Math.round(cx+Math.cos(a)*rx*(.78+.22*Math.sin(a*3+seed))),y=Math.round(cy+Math.sin(a)*ry*(.82+.18*Math.cos(a*4+seed)));pts.push([Math.max(0,Math.min(63,x)),Math.max(0,Math.min(31,y))])}const out=new Set();for(let i=0;i<pts.length;i++){let [x,y]=pts[i],[tx,ty]=pts[(i+1)%pts.length],guard=0;while((x!==tx||y!==ty)&&guard++<100){if(Math.abs(tx-x)>=Math.abs(ty-y)){const nx=x+Math.sign(tx-x);out.add(countryBorderKey('v',((Math.max(x,nx)%64)+64)%64,Math.max(0,Math.min(31,y))));x=nx}else{const ny=y+Math.sign(ty-y);out.add(countryBorderKey('h',Math.max(0,Math.min(63,x)),Math.max(0,Math.min(32,Math.max(y,ny)))));y=ny}}}countryBorderDraft=[...out];persist();redraw()};
  $('closeCountryBorderPainter').onclick=()=>panel.classList.add('hidden');return panel
}
function openCountryBorderPainter(){const panel=ensureCountryBorderPainter();panel.classList.remove('hidden');panel._redraw?.();requestAnimationFrame(()=>keepDetachedPanelOnscreen(panel))}

function systemScaleIsLargerThanPlanet(){return ['solar','galaxy','universe'].includes(systemScale())}
function countryUsesImplicitPlanet(){return systemScale()==='planet'}
function countryPlanetMatches(country,planet){
  if(!country||!planet)return false;
  return countryUsesImplicitPlanet()?true:country.surfacePlanetId===planet.id
}
function countryContainedCandidatePlaces(country){
  const countryRank=PLACE_LEVELS.findIndex(([v])=>v==='country');
  return ofType('place').filter(p=>{
    if(p.id===country?.id||p.isHub)return false;
    const scale=String(p.placeScale||inferPlaceScale(p.placeType||p.category||'')).toLowerCase();
    const rank=PLACE_LEVELS.findIndex(([v])=>v===scale);
    // Unknown old Places are still useful choices; only explicit Country+ scales are excluded.
    if(rank>=countryRank&&rank>=0)return false;
    if(systemScaleIsLargerThanPlanet()&&country?.surfacePlanetId&&p.surfacePlanetId&&p.surfacePlanetId!==country.surfacePlanetId)return false;
    return true
  })
}
function syncCountryContainedPlaceEdges(country){
  if(!country||String(country.placeScale||inferPlaceScale(country.placeType))!=='country')return;
  const chosen=new Set(Array.isArray(country.countryContainedPlaceIds)?country.countryContainedPlaceIds:[]);
  edges=edges.filter(e=>!(e.countryExplicitContainment&&e.a===country.id));
  for(const id of chosen){
    const child=byId(id);if(!child)continue;
    edges.push({id:uid(),a:country.id,b:id,type:'relationship',linkType:'containment',label:'Contains',direction:'forward',manual:true,strength:'solid',thickness:1.6,placeContainment:true,countryExplicitContainment:true});
    if(systemScaleIsLargerThanPlanet()&&country.surfacePlanetId&&!child.surfacePlanetId)child.surfacePlanetId=country.surfacePlanetId
  }
}

function placeAllowsSideControls(place){
  const scale=String(place?.placeScale||inferPlaceScale(place?.placeType||place?.category||'')).toLowerCase();
  const country=PLACE_LEVELS.findIndex(x=>x[0]==='country'),rank=PLACE_LEVELS.findIndex(x=>x[0]===scale);
  // Country-and-smaller Places use these controls normally. Planet is the one intentional
  // larger-scale exception because it owns planet-surface Structure population/wilderness.
  return scale==='planet'||rank<0||rank<=country
}
let v287yTilePaintMode='__auto__';
let v287zLandscapePlanetId='',v287zLandscapeSampleColor='',v287zLandscapeView={yaw:.45,pitch:-.12},v287zLandscapeEditingColor='';
const v287afPlanetSnapshotCache=new Map();
function v287afSnapshotSignature(planet){return JSON.stringify([planet?.id,planet?.planetModelSeed,planet?.gasGiant,planet?.planetPaletteSaved,planet?.planetLandCoverage,planet?.planetLandEnabled,planet?.planetOceanEnabled,planet?.planetLandColor,planet?.planetLandColor2,planet?.planetLandColor3,planet?.planetOceanColor,planet?.planetOceanColor2,planet?.planetSkyColor,planet?.planetGasColor,planet?.planetGasColor2,planet?.planetGasColor3,planet?.planetGasContrast]);}
function v287afInvalidatePlanetPreview(planet){if(planet?.id)v287afPlanetSnapshotCache.delete(planet.id)}
let v287adPendingLandscapeAfterPalette=false,v287adPaletteTargetPlanetId='';
function v287adPaletteOwner(){
  const editing=editingId?byId(editingId):null;
  if(editing&&editing.type==='place'&&String(value('ePlaceScale')||editing.placeScale||inferPlaceScale(editing.placeType))==='planet')return editing;
  if(selected&&selected.type==='place'&&String(selected.placeScale||inferPlaceScale(selected.placeType))==='planet')return selected;
  const picked=v287zPlanetCandidates().find(p=>p.id===v287adPaletteTargetPlanetId)||v287zLandscapePlanet();
  return picked&&picked.id!=='__active_planet__'?picked:null
}
function v287adHasSavedPalette(planet){
  // Explicit save is intentional: older projects are prompted once so Landscape authoring
  // never starts from an unsaved palette draft.
  return !!planet?.planetPaletteSaved
}
function v287adCommitPlanetPalette(){
  const planet=v287adPaletteOwner();
  if(!planet)return false;
  Object.assign(planet,{
    planetLandColor:value('ePlanetLandColor')||planet.planetLandColor||'#5d8f5a',
    planetLandColor2:value('ePlanetLandColor2')||planet.planetLandColor2||'#78915b',
    planetLandColor3:value('ePlanetLandColor3')||planet.planetLandColor3||'#8d8655',
    // v28.7ak: a saved custom palette intentionally disables the old hidden
    // biome accents (legacy Accent 2/3/4). Keep the fields null so old saves
    // cannot leak green/rock/polar patches back into the globe or Surface.
    planetLandColor4:null,
    planetLandColor5:null,
    planetLandColor6:null,
    planetOceanColor:value('ePlanetOceanColor')||planet.planetOceanColor||'#315f9f',
    planetOceanColor2:value('ePlanetOceanColor2')||planet.planetOceanColor2||'#102f58',
    isMoon:!!$('ePlanetIsMoon')?.checked,
    orbitingId:$('ePlanetIsMoon')?.checked?(value('eMoonOrbiting')||null):null,
    gasGiant:!!$('ePlanetGasGiant')?.checked,
    planetGasColor:value('ePlanetGasColor')||planet.planetGasColor||'#d6b783',
    planetGasColor2:value('ePlanetGasColor2')||planet.planetGasColor2||'#a87a58',
    planetGasColor3:value('ePlanetGasColor3')||planet.planetGasColor3||'#eee0b5',
    planetGasContrast:Math.max(0,Math.min(100,+value('ePlanetGasContrast')||55)),
    planetLandCoverage:Math.max(0,Math.min(100,+value('ePlanetLandCoverage')||45)),
    planetLandEnabled:$('ePlanetLandEnabled')?.checked!==false,
    planetOceanEnabled:$('ePlanetOceanEnabled')?.checked!==false,
    planetSkyColor:value('ePlanetSkyColor')||planet.planetSkyColor||'#8fc8ee',
    planetCloudsEnabled:$('ePlanetCloudsEnabled')?.checked!==false,
    planetCloudColor:value('ePlanetCloudColor')||planet.planetCloudColor||'#eef8ff',
    planetCloudCoverage:Math.max(0,Math.min(100,+value('ePlanetCloudCoverage')||45)),
    planetCloudOpacity:Math.max(0,Math.min(100,+value('ePlanetCloudOpacity')||38)),
    planetCountryBordersEnabled:$('ePlanetCountryBordersEnabled')?.checked!==false,
    planetProceduralBorders:!!$('ePlanetProceduralBorders')?.checked,
    planetPaletteSaved:true,
    planetModelSeed:planet.planetModelSeed||v287yPlanetSeed(planet)
  });
  v287afInvalidatePlanetPreview(planet);invalidateWorldStateForNode?.(planet);save();
  const status=$('planetPaletteSaveStatus');if(status){status.textContent='Palette saved';setTimeout(()=>{if(status)status.textContent=''},1300)}
  return true
}
function v287adOpenPaletteForLandscape(planet){
  if(!planet)return;
  v287adPaletteTargetPlanetId=planet.id;
  v287zLandscapePlanetId=planet.id;
  v287adPendingLandscapeAfterPalette=true;
  const palette=$('planetPalettePanel');if(!palette){console.error('Planet palette panel is missing');return}
  palette.classList.remove('hidden');
  prepareDetachedEditorPanel(palette,palette.querySelector('.auto-panel-head'));
  const status=$('planetPaletteSaveStatus');if(status)status.textContent='Save this palette to continue to Landscape Editor';
  requestAnimationFrame(()=>keepDetachedPanelOnscreen(palette))
}

function v287zPlanetCandidates(){
  const authored=ofType('place').filter(p=>String(p.placeScale||inferPlaceScale(p.placeType))==='planet'&&!p.isHub);
  if(authored.length)return authored;
  const active=activeSurfacePlanetNode()||activePlanetPlace();if(active)return[active];
  if(simState.planet)return[{id:'__active_planet__',name:simState.planet.name||'Active Planet',gasGiant:!!simState.planet.gasGiant,__useActiveModel:true}];
  return[]
}
function v287zLandscapePlanet(){return v287zPlanetCandidates().find(p=>p.id===v287zLandscapePlanetId)||v287zPlanetCandidates()[0]||null}
function v287zLandscapeRules(planet=v287zLandscapePlanet()){if(!planet)return{};planet.planetLandscapeColorRules=planet.planetLandscapeColorRules||{};return planet.planetLandscapeColorRules}
function v287zNormHex(c){const m=/^#?([0-9a-f]{6})$/i.exec(String(c||''));return m?'#'+m[1].toLowerCase():''}
function v287zColorDistance(a,b){const A=v271ParseHex(a),B=v271ParseHex(b);if(!A||!B)return 999;return Math.hypot(A.r-B.r,A.g-B.g,A.b-B.b)}
function v287zLandscapeRuleForSurface(planet,color){const rules=planet?.planetLandscapeColorRules||{},exact=rules[v287zNormHex(color)];if(exact)return exact;return Object.values(rules).find(r=>r&&v287zColorDistance(r.color,color)<=Math.max(0,+r.tolerance||0))||null}
function v287ajRgbHex(r,g,b){return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,v|0)).toString(16).padStart(2,'0')).join('')}
function v287ajNearestPaletteColor(planet,color){
  const key=v287zNormHex(color);if(!planet||!key)return'';
  const candidates=v287agLandscapePaletteEntries(planet).map(([label,c])=>({label,color:v287zNormHex(c)})).filter(x=>x.color);
  if(!candidates.length)return key;
  let best=candidates[0],bestD=Infinity;
  for(const c of candidates){const d=v287zColorDistance(key,c.color);if(d<bestD){best=c;bestD=d}}
  return best.color
}
function v287ajLandscapeColorLabel(planet,color){const key=v287zNormHex(color);const hit=v287agLandscapePaletteEntries(planet).find(([,c])=>v287zNormHex(c)===key);return hit?.[0]||'Terrain'}
function v287zLandscapeSampleAt(canvas,clientX,clientY,planetOverride=null){
  // v28.7ak: sample the pixels that are ACTUALLY visible on the preview globe.
  // The older inverse-lat/lon picker could select a neighboring terrain cell near
  // projected cell edges, so the model opened for a different color than the one
  // the user had visibly clicked.
  const planet=planetOverride||canvas?.closest?.('#landscapeEditor')?._planet||v287zLandscapePlanet();if(!planet||!canvas)return'';
  const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return'';
  const sx=canvas.width/r.width,sy=canvas.height/r.height;
  const x=(clientX-r.left)*sx,y=(clientY-r.top)*sy;
  const R=Math.min(canvas.width,canvas.height)*.43,cx=canvas.width/2,cy=canvas.height/2;
  if((x-cx)*(x-cx)+(y-cy)*(y-cy)>R*R)return'';
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return'';
  // A tiny neighborhood makes anti-aliased cell boundaries reliable. Choose the
  // palette color whose rendered RGB is closest to any nearby visible pixel.
  const ix=Math.max(0,Math.min(canvas.width-1,Math.round(x))),iy=Math.max(0,Math.min(canvas.height-1,Math.round(y)));
  const rad=2,x0=Math.max(0,ix-rad),y0=Math.max(0,iy-rad),x1=Math.min(canvas.width-1,ix+rad),y1=Math.min(canvas.height-1,iy+rad);
  let data;try{data=ctx.getImageData(x0,y0,x1-x0+1,y1-y0+1).data}catch(_){return''}
  const palette=v287agLandscapePaletteEntries(planet).map(([label,c])=>({label,color:v287zNormHex(c)})).filter(v=>v.color);
  if(!palette.length)return'';
  let best='',bestD=Infinity;
  for(let i=0;i<data.length;i+=4){if(data[i+3]<180)continue;const actual=v287ajRgbHex(data[i],data[i+1],data[i+2]);for(const p of palette){const d=v287zColorDistance(actual,p.color);if(d<bestD){bestD=d;best=p.color}}}
  return best
}
function v287zRenderLandscapePlanetPreview(ctx,w,h,planet){const old=countryBorderView;countryBorderView=v287zLandscapeView;v287yRenderActualPlanetModel(ctx,w,h,planet);countryBorderView=old}
function v287alWeatherDefaultTint(type){return type==='sandstorm'?'#c49345':type==='storm'?'#242333':'#56616b'}
function v287alNormalizeLandscapeWeather(src={},planet=null){
  const type=['rain','storm','sandstorm'].includes(src?.type)?src.type:'none';
  return{
    skyColor:v287zNormHex(src?.skyColor)||planet?.planetSkyColor||'#8fc8ee',
    type,
    weatherSkyColor:v287zNormHex(src?.weatherSkyColor)||v287alWeatherDefaultTint(type),
    intensity:Math.max(0,Math.min(1,Number.isFinite(+src?.intensity)?+src.intensity:.82)),
    preview:src?.preview!==false
  }
}
function v287alScenePreviewSky(){
  const d=sceneLandscapeWeatherDraft||{},base=v287zNormHex(d.skyColor)||scene3DModel?.skyColor||scene3DTargetNode?.planetSkyColor||'#8fc8ee';
  if(scene3DTargetType!=='landscape'||!d.preview||d.type==='none')return base;
  return v271HexMix(base,v287zNormHex(d.weatherSkyColor)||v287alWeatherDefaultTint(d.type),Math.max(0,Math.min(.92,(+d.intensity||0)*.82)))
}
function v287alDrawSceneWeatherPreview(overlay){
  if(scene3DTargetType!=='landscape'||!overlay||!sceneLandscapeWeatherDraft?.preview||sceneLandscapeWeatherDraft.type==='none')return;
  const ctx=overlay.getContext('2d'),w=overlay.width,h=overlay.height,d=sceneLandscapeWeatherDraft,I=Math.max(0,Math.min(1,+d.intensity||0)),t=performance.now()*.001;
  ctx.save();
  if(d.type==='rain'){
    ctx.strokeStyle=`rgba(190,225,248,${.25+.5*I})`;ctx.lineWidth=1.25;const n=Math.round(35+120*I);
    for(let i=0;i<n;i++){const x=(i*83+t*130)%w,y=(i*47+t*250)%h;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-5,y+13+I*10);ctx.stroke()}
  }else if(d.type==='sandstorm'){
    ctx.fillStyle=`rgba(191,135,64,${.08+.18*I})`;ctx.fillRect(0,0,w,h);ctx.strokeStyle=`rgba(245,210,145,${.18+.25*I})`;ctx.lineWidth=2;
    for(let i=0;i<50+I*70;i++){const y=(i*31)%h,x=(i*97+t*180)%w;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+30+I*42,y+2);ctx.stroke()}
  }else{
    ctx.fillStyle=`rgba(21,20,31,${.10+.22*I})`;ctx.fillRect(0,0,w,h);
    if(Math.floor(t*2.3)%17===0){ctx.fillStyle=`rgba(240,240,255,${.07+.08*I})`;ctx.fillRect(0,0,w,h)}
  }
  ctx.restore()
}
let sceneLandscapeWeatherPreviewRAF=0,sceneLandscapeWeatherPreviewLast=0;
function v287alStartLandscapeWeatherPreview(){
  if(sceneLandscapeWeatherPreviewRAF)return;
  const tick=ts=>{
    const panel=$('scene3DPanel'),canvas=$('scene3DCanvas'),overlay=$('scene3DGizmo');
    if(!panel||panel.classList.contains('hidden')||scene3DTargetType!=='landscape'||!sceneLandscapeWeatherDraft?.preview||sceneLandscapeWeatherDraft.type==='none'){sceneLandscapeWeatherPreviewRAF=0;return}
    if(ts-sceneLandscapeWeatherPreviewLast>42&&canvas&&overlay&&scene3DLastViewProj){sceneLandscapeWeatherPreviewLast=ts;scene3DDrawGizmo(canvas,overlay,scene3DLastViewProj);v287alDrawSceneWeatherPreview(overlay)}
    sceneLandscapeWeatherPreviewRAF=requestAnimationFrame(tick)
  };
  sceneLandscapeWeatherPreviewRAF=requestAnimationFrame(tick)
}
function v287alEnsureLandscapeWeatherPanel(){
  let p=$('sceneLandscapeWeatherPanel');if(p)return p;
  p=document.createElement('aside');p.id='sceneLandscapeWeatherPanel';p.className='scene-landscape-weather-panel hidden';
  p.innerHTML=`<div class="scene-landscape-weather-head"><div><div class="eyebrow">Landscape Editor</div><h3>Weather Editor</h3></div><button type="button" id="sceneLandscapeWeatherClose" class="icon-btn">×</button></div>
    <p>These settings belong to this sampled terrain color. The event becomes the default weather whenever this landscape color is visited.</p>
    <label>Landscape sky<input id="sceneLandscapeSkyColor" type="color"></label>
    <label>Special weather event<select id="sceneLandscapeWeatherType"><option value="none">None</option><option value="rain">Rain</option><option value="storm">Storm + lightning</option><option value="sandstorm">Sandstorm</option></select></label>
    <label>Weather sky / haze color<input id="sceneLandscapeWeatherSkyColor" type="color"></label>
    <label>Intensity <output id="sceneLandscapeWeatherIntensityOut">82%</output><input id="sceneLandscapeWeatherIntensity" type="range" min="0" max="100" value="82"></label>
    <label class="inline-check"><input id="sceneLandscapeWeatherPreview" type="checkbox" checked> Preview event while modelling</label>
    <button type="button" id="sceneLandscapeUsePlanetSky" class="ghost">Use Planet Sky</button>
    <small>Manual Surface weather still overrides this default event.</small>`;
  document.body.appendChild(p);prepareDetachedEditorPanel(p,p.querySelector('.scene-landscape-weather-head'));
  $('sceneLandscapeWeatherClose').onclick=()=>p.classList.add('hidden');
  const pull=()=>{if(scene3DTargetType!=='landscape')return;sceneLandscapeWeatherDraft={...sceneLandscapeWeatherDraft,skyColor:$('sceneLandscapeSkyColor').value,type:$('sceneLandscapeWeatherType').value,weatherSkyColor:$('sceneLandscapeWeatherSkyColor').value,intensity:(+$('sceneLandscapeWeatherIntensity').value||0)/100,preview:!!$('sceneLandscapeWeatherPreview').checked};scene3DModel.skyColor=sceneLandscapeWeatherDraft.skyColor;$('sceneLandscapeWeatherIntensityOut').textContent=Math.round(sceneLandscapeWeatherDraft.intensity*100)+'%';scene3DRenderViewport();v287alStartLandscapeWeatherPreview()};
  for(const id of ['sceneLandscapeSkyColor','sceneLandscapeWeatherType','sceneLandscapeWeatherSkyColor','sceneLandscapeWeatherIntensity','sceneLandscapeWeatherPreview'])$(id).addEventListener('input',pull);
  $('sceneLandscapeWeatherType').addEventListener('change',()=>{const type=$('sceneLandscapeWeatherType').value;if(type!=='none')$('sceneLandscapeWeatherSkyColor').value=v287alWeatherDefaultTint(type);pull()});
  $('sceneLandscapeUsePlanetSky').onclick=()=>{$('sceneLandscapeSkyColor').value=scene3DTargetNode?.planetSkyColor||'#8fc8ee';pull()};
  return p
}
function v287alSyncLandscapeWeatherPanel(rule,planet){
  const p=v287alEnsureLandscapeWeatherPanel();sceneLandscapeWeatherDraft=v287alNormalizeLandscapeWeather({...rule?.weather,skyColor:rule?.skyColor||rule?.weather?.skyColor},planet);
  $('sceneLandscapeSkyColor').value=sceneLandscapeWeatherDraft.skyColor;$('sceneLandscapeWeatherType').value=sceneLandscapeWeatherDraft.type;$('sceneLandscapeWeatherSkyColor').value=sceneLandscapeWeatherDraft.weatherSkyColor;$('sceneLandscapeWeatherIntensity').value=Math.round(sceneLandscapeWeatherDraft.intensity*100);$('sceneLandscapeWeatherIntensityOut').textContent=Math.round(sceneLandscapeWeatherDraft.intensity*100)+'%';$('sceneLandscapeWeatherPreview').checked=sceneLandscapeWeatherDraft.preview;
  p.classList.remove('hidden');v287alStartLandscapeWeatherPreview();requestAnimationFrame(()=>keepDetachedPanelOnscreen(p));return p
}
function v287zEnsureSceneLandscapeExtras(){const panel=ensureScene3DPanel();let extra=$('sceneLandscapeExtras');if(!extra){extra=document.createElement('section');extra.id='sceneLandscapeExtras';extra.className='scene-landscape-extras hidden';extra.innerHTML=`<div class="scene3d-section-title">Landscape Placement</div><label>Placement<select id="sceneLandscapePlacementMode"><option value="single">Single placement — no repetition</option><option value="procedural">Procedural repetition</option></select></label><label>Occurrence pattern<select id="sceneLandscapeSeedMode"><option value="same-color">Same procedural layout for every matching color tile</option><option value="per-tile">Unique procedural layout for each occurrence</option></select></label><button type="button" id="sceneLandscapeWeatherOpen" class="ghost">☁ Weather Editor</button><small>Single placement keeps exactly the objects you model. Procedural repetition uses the Repetition section above; Area fills a true 2D area, while Radial places around a circle.</small>`;panel.querySelector('.scene3d-inspector')?.appendChild(extra);$('sceneLandscapePlacementMode').onchange=e=>{if(scene3DTargetType!=='landscape'||!scene3DModel?.repetition)return;scene3DModel.repetition.enabled=e.target.value==='procedural';if($('sceneRepeatEnabled'))$('sceneRepeatEnabled').checked=scene3DModel.repetition.enabled;scene3DSyncRepeatUI();scene3DRenderViewport()};$('sceneLandscapeWeatherOpen').onclick=()=>{const wp=v287alEnsureLandscapeWeatherPanel();wp.classList.remove('hidden');requestAnimationFrame(()=>keepDetachedPanelOnscreen(wp))}}return extra}
function v287zBindSceneSaveHandler(){const b=$('scene3DSaveReturn');if(!b)return;b.onclick=()=>{syncScene3DLegacyParts();if(scene3DTargetType==='landscape'){const planet=scene3DTargetNode||v287zLandscapePlanet(),color=v287zLandscapeEditingColor||v287zLandscapeSampleColor;if(planet&&color){const rules=v287zLandscapeRules(planet),key=v287zNormHex(color),old=rules[key]||{};rules[key]={...old,color:key,model:scene3DModelForSave(scene3DModel),skyColor:v287zNormHex(sceneLandscapeWeatherDraft?.skyColor)||scene3DModel.skyColor||planet.planetSkyColor||'#8fc8ee',weather:{type:['rain','storm','sandstorm'].includes(sceneLandscapeWeatherDraft?.type)?sceneLandscapeWeatherDraft.type:'none',weatherSkyColor:v287zNormHex(sceneLandscapeWeatherDraft?.weatherSkyColor)||v287alWeatherDefaultTint(sceneLandscapeWeatherDraft?.type),intensity:Math.max(0,Math.min(1,+sceneLandscapeWeatherDraft?.intensity||0)),preview:sceneLandscapeWeatherDraft?.preview!==false},seedMode:$('sceneLandscapeSeedMode')?.value||old.seedMode||'same-color',replaceScenery:true,tolerance:Math.max(0,+old.tolerance||0)};save();v287yEnsureLandscapeEditor()._redraw?.()}$('scene3DPanel')?.classList.add('hidden');$('sceneLandscapeWeatherPanel')?.classList.add('hidden');const le=$('landscapeEditor');if(le){le.classList.remove('hidden');le._redraw?.();requestAnimationFrame(()=>keepDetachedPanelOnscreen(le))}return}structureModelDraft=scene3DModelForSave(scene3DModel);if(scene3DTargetType==='structure'&&scene3DTargetNode?.type==='structure'&&!scene3DTargetNode.isMegastructure){scene3DTargetNode.structureModel=deepCloneState(structureModelDraft);save()}const s=$('structureModelSummary');if(s)s.textContent=`${scene3DModel.variants.length} variant${scene3DModel.variants.length===1?'':'s'} · ${scene3DRepeatInstances(scene3DModel).length} instance${scene3DRepeatInstances(scene3DModel).length===1?'':'s'}`;$('scene3DPanel')?.classList.add('hidden')}}
function openShared3DModelEditor(node,targetType='structure'){
  if(targetType!=='structure'||(node&&node.type!=='structure'))return;
  const panel=ensureScene3DPanel();scene3DTargetNode=node||null;scene3DTargetType='structure';v287zEnsureSceneLandscapeExtras().classList.add('hidden');$('sceneLandscapeWeatherPanel')?.classList.add('hidden');$('sceneLandscapeFootprintHint')?.classList.add('hidden');$('sceneEnvironmentWrap')?.classList.remove('hidden');document.querySelector('.scene-environment-only')?.classList.remove('hidden');
  const src=structureModelDraft||node?.structureModel;scene3DModel=normalizeScene3DModel(src);structureModelDraft=scene3DModel;scene3DSelected=scene3DActiveVariant()?.parts[0]?.id||null;scene3DCamera={yaw:.72,pitch:.42,distance:28,target:[0,2,0]};scene3DKeyMode='';
  $('scene3DEyebrow').textContent='Structure';$('scene3DTitle').textContent=(node?.name||$('eName')?.value||'Untitled')+' · 3D Model';$('sceneEnvironment').value=scene3DModel.environment;scene3DSyncVariantUI();scene3DSyncInspector();v287zBindSceneSaveHandler();panel.classList.remove('hidden');requestAnimationFrame(()=>{keepDetachedPanelOnscreen(panel);scene3DRenderViewport();$('scene3DCanvas')?.focus()})
}
function v287zOpenLandscapeModelEditor(color,planetOverride=null){
  // v28.7ak: never rediscover the planet after the user has sampled it. The old
  // flow could lose the active/editing planet between the Landscape panel and
  // the shared modeller, causing this function to silently return.
  const planet=planetOverride||v287zLandscapePlanet();
  const key=v287zNormHex(color);
  if(!planet||!key)throw new Error(!planet?'Landscape planet was lost before the 3D modeller opened.':'The sampled landscape color is invalid.');
  if(planet.id)v287zLandscapePlanetId=planet.id;
  const rule=v287zLandscapeRules(planet)[key]||{};v287zLandscapeEditingColor=key;
  const panel=ensureScene3DPanel();
  if(!panel)throw new Error('The shared 3D modeller panel could not be created.');
  // Make the window visible FIRST. Even if a later UI refresh fails, the user is
  // not left with a mysterious no-op.
  panel.classList.remove('hidden');panel.style.zIndex='10250';
  const extra=v287zEnsureSceneLandscapeExtras();
  scene3DTargetNode=planet;scene3DTargetType='landscape';
  scene3DModel=normalizeScene3DModel(rule.model||{environment:'grass',groundColor:key,skyColor:rule.skyColor||planet.planetSkyColor||'#8fc8ee',variants:[{id:'default',name:'Default',parts:[]}],activeVariantId:'default',repetition:{enabled:false,mode:'area',count:18,areaWidth:150,areaDepth:150,scaleVariation:18,variantMode:'active'}});
  scene3DModel.groundColor=key;scene3DModel.skyColor=rule.skyColor||scene3DModel.skyColor||planet.planetSkyColor||'#8fc8ee';scene3DSelected=scene3DActiveVariant()?.parts[0]?.id||null;scene3DCamera={yaw:.72,pitch:.48,distance:335,target:[0,0,0]};scene3DKeyMode='';
  if($('scene3DEyebrow'))$('scene3DEyebrow').textContent='Landscape Color';
  if($('scene3DTitle'))$('scene3DTitle').textContent=`${planet.name||'Planet'} · ${key} Landscape`;
  if($('sceneEnvironment'))$('sceneEnvironment').value=scene3DModel.environment;
  $('sceneEnvironmentWrap')?.classList.add('hidden');document.querySelector('.scene-environment-only')?.classList.add('hidden');
  extra?.classList.remove('hidden');
  if($('sceneLandscapePlacementMode'))$('sceneLandscapePlacementMode').value=scene3DModel.repetition?.enabled?'procedural':'single';
  if($('sceneLandscapeSeedMode'))$('sceneLandscapeSeedMode').value=rule.seedMode||'same-color';
  $('sceneLandscapeFootprintHint')?.classList.remove('hidden');v287alSyncLandscapeWeatherPanel(rule,planet);
  scene3DSyncVariantUI();scene3DSyncInspector();v287zBindSceneSaveHandler();
  requestAnimationFrame(()=>{keepDetachedPanelOnscreen(panel);try{scene3DRenderViewport()}catch(err){console.error('Landscape modeller viewport render failed:',err);if($('scene3DStatus'))$('scene3DStatus').textContent='Viewport error: '+(err?.message||err)}$('scene3DCanvas')?.focus()});
  return panel
}
function v287agLandscapePaletteEntries(planet){
  if(!planet)return[];
  if(planet.gasGiant)return[
    ['Gas Primary',planet.planetGasColor||'#d6b783'],['Gas Secondary',planet.planetGasColor2||'#a87a58'],['Gas Accent',planet.planetGasColor3||'#eee0b5']
  ];
  return[
    ['Land Primary',planet.planetLandColor||'#5d8f5a'],['Land Secondary',planet.planetLandColor2||'#78915b'],['Land Accent',planet.planetLandColor3||'#8d8655'],
    ['Ocean',planet.planetOceanColor||'#315f9f'],['Deep Ocean',planet.planetOceanColor2||'#102f58']
  ];
}
function v287agOpenLandscapeColor(color,planetOverride=null){
  const key=v287zNormHex(color);if(!key)return false;
  const landscape=$('landscapeEditor'),planet=planetOverride||landscape?._planet||v287zLandscapePlanet();
  v287zLandscapeSampleColor=key;
  const sw=$('landscapeSampleSwatch'),lab=$('landscapeSampleLabel'),btn=$('landscapeModelColor');
  if(sw)sw.style.background=key;if(lab)lab.textContent=`Selected ${key} · opening 3D modeller…`;if(btn)btn.disabled=false;
  try{
    const scene=v287zOpenLandscapeModelEditor(key,planet);
    if(!scene||scene.classList.contains('hidden'))throw new Error('The 3D modeller did not become visible.');
    // Only hide the sampler after we know the modeller exists and is visible.
    if(landscape)landscape.classList.add('hidden');
    requestAnimationFrame(()=>keepDetachedPanelOnscreen(scene));
    return true
  }catch(err){
    console.error('Landscape 3D modeller failed to open:',err);
    if(lab)lab.textContent='3D modeller failed to open — '+(err?.message||err);
    if(landscape)landscape.classList.remove('hidden');
    return false
  }
}
function v287yEnsureLandscapeEditor(){
  let p=$('landscapeEditor');if(p)return p;p=document.createElement('aside');p.id='landscapeEditor';p.className='planet-authoring-panel landscape-editor landscape-color-editor hidden';p.innerHTML=`<div class="planet-authoring-head"><div><div class="eyebrow">Planet Surface</div><h3>Landscape Editor</h3></div><button class="icon-btn" id="closeLandscapeEditor">×</button></div>
    <p>Choose a planet, then click a terrain color on its real globe. The 3D model you author for that sampled color is used everywhere the same color appears.</p>
    <div class="landscape-planet-row"><label>Planet<select id="landscapePlanetSelect"></select></label><button id="landscapeResetView" class="ghost">Reset Globe</button></div>
    <canvas id="landscapePlanetCanvas" width="720" height="720"></canvas>
    <div class="scene3d-section-title">Saved planet colors</div><div id="landscapePaletteSwatches" class="landscape-palette-swatches"></div>
    <div class="landscape-sample-card"><span id="landscapeSampleSwatch"></span><div><b id="landscapeSampleLabel">Click the globe to sample a color</b><small>Click a terrain color to open its 3D landscape modeller · right-drag rotates.</small></div><button id="landscapeModelColor" class="primary" disabled>◫ Model This Color in 3D</button></div>
    <div class="scene3d-section-title">Authored color landscapes</div><div id="landscapeRuleList" class="landscape-rule-list"></div>`;
  document.body.appendChild(p);prepareDetachedEditorPanel(p,p.querySelector('.planet-authoring-head'));$('closeLandscapeEditor').onclick=()=>p.classList.add('hidden');
  const c=$('landscapePlanetCanvas'),ctx=c.getContext('2d');let rotating=false,last=null;
  const redraw=()=>{const planet=p._planet||v287zLandscapePlanet();ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#07101a';ctx.fillRect(0,0,c.width,c.height);if(!planet){ctx.fillStyle='#dce8f8';ctx.font='600 18px system-ui';ctx.textAlign='center';ctx.fillText('Save a Planet Color Palette first',c.width/2,c.height/2);return}v287zRenderLandscapePlanetPreview(ctx,c.width,c.height,planet);const palHost=$('landscapePaletteSwatches');if(palHost){palHost.innerHTML=v287agLandscapePaletteEntries(planet).map(([label,color])=>`<button type="button" class="landscape-palette-swatch" data-landscape-palette-color="${E.esc(v287zNormHex(color))}"><i style="background:${E.esc(color)}"></i><span>${E.esc(label)}</span><small>${E.esc(v287zNormHex(color))}</small></button>`).join('');palHost.querySelectorAll('[data-landscape-palette-color]').forEach(b=>b.onclick=()=>v287agOpenLandscapeColor(b.dataset.landscapePaletteColor,planet))}const rules=v287zLandscapeRules(planet),host=$('landscapeRuleList');host.innerHTML=Object.values(rules).length?Object.values(rules).map(r=>`<div class="landscape-rule-row" data-land-color="${E.esc(r.color)}"><span style="background:${E.esc(r.color)}"></span><div><b>${E.esc(r.color)}</b><small>${r.seedMode==='per-tile'?'Unique per occurrence':'Same pattern everywhere'} · ${scene3DRepeatInstances(normalizeScene3DModel(r.model||{}),r.color).length} local instance${scene3DRepeatInstances(normalizeScene3DModel(r.model||{}),r.color).length===1?'':'s'}</small></div><button data-edit-land class="ghost">Edit 3D</button><button data-delete-land class="danger ghost">Delete</button></div>`).join(''):'<small>No sampled-color landscapes yet.</small>';host.querySelectorAll('[data-edit-land]').forEach(b=>b.onclick=()=>v287zOpenLandscapeModelEditor(b.closest('[data-land-color]').dataset.landColor,planet));host.querySelectorAll('[data-delete-land]').forEach(b=>b.onclick=()=>{const color=b.closest('[data-land-color]').dataset.landColor;delete v287zLandscapeRules(planet)[color];save();redraw()})};p._redraw=redraw;
  let redrawQueued=false;const queueRedraw=()=>{if(redrawQueued)return;redrawQueued=true;requestAnimationFrame(()=>{redrawQueued=false;redraw()})};
  c.addEventListener('contextmenu',e=>e.preventDefault());c.addEventListener('pointerdown',e=>{if(e.button===2){rotating=true;last={x:e.clientX,y:e.clientY};c.setPointerCapture?.(e.pointerId);c.style.cursor='grabbing';return}if(e.button!==0)return;const planet=p._planet||v287zLandscapePlanet(),color=v287zLandscapeSampleAt(c,e.clientX,e.clientY,planet);if(!color){$('landscapeSampleLabel').textContent='Click directly on a visible planet color';return}v287agOpenLandscapeColor(color,planet)});c.addEventListener('pointermove',e=>{if(rotating&&last){const dx=e.clientX-last.x,dy=e.clientY-last.y;v287zLandscapeView.yaw+=dx*.009;v287zLandscapeView.pitch=Math.max(-1.25,Math.min(1.25,v287zLandscapeView.pitch-dy*.007));last={x:e.clientX,y:e.clientY};queueRedraw();return}const planet=p._planet||v287zLandscapePlanet(),color=v287zLandscapeSampleAt(c,e.clientX,e.clientY,planet);if(color){const sw=$('landscapeSampleSwatch'),lab=$('landscapeSampleLabel');if(sw)sw.style.background=color;if(lab)lab.textContent=`Under cursor: ${v287ajLandscapeColorLabel(planet,color)} · ${color} · click to model`}});const stopRotate=()=>{rotating=false;last=null;c.style.cursor='crosshair'};c.addEventListener('pointerup',stopRotate);c.addEventListener('pointercancel',stopRotate);
  $('landscapePlanetSelect').onchange=e=>{v287zLandscapePlanetId=e.target.value;v287zLandscapeSampleColor='';$('landscapeModelColor').disabled=true;$('landscapeSampleLabel').textContent='Click the globe to sample a color';$('landscapeSampleSwatch').style.background='transparent';redraw()};$('landscapeResetView').onclick=()=>{v287zLandscapeView={yaw:.45,pitch:-.12};redraw()};$('landscapeModelColor').onclick=()=>v287agOpenLandscapeColor(v287zLandscapeSampleColor,p._planet||v287zLandscapePlanet());return p
}
function v287yOpenLandscapeEditor(){
  const p=v287yEnsureLandscapeEditor(),sel=$('landscapePlanetSelect');
  let list=v287zPlanetCandidates();
  const editing=editingId?byId(editingId):null;
  const selectedPlanet=selected&&selected.type==='place'&&String(selected.placeScale||inferPlaceScale(selected.placeType))==='planet'?selected:null;
  const editorPlanet=editing&&editing.type==='place'&&String(value('ePlaceScale')||editing.placeScale||inferPlaceScale(editing.placeType))==='planet'?editing:null;
  const current=editorPlanet||selectedPlanet;
  if(current&&!list.some(q=>q.id===current.id))list=[current,...list];
  sel.innerHTML=list.map(q=>`<option value="${E.esc(q.id)}">${E.esc(q.name||'Planet')}</option>`).join('');
  if(!list.length){
    const fallback=editing&&editing.type==='place'?editing:selected&&selected.type==='place'?selected:null;
    if(fallback){v287adOpenPaletteForLandscape(fallback);return}
    console.warn('Landscape Editor: no planet is available to author.');
    return
  }
  if(current)v287zLandscapePlanetId=current.id;
  if(!list.some(q=>q.id===v287zLandscapePlanetId))v287zLandscapePlanetId=list[0].id;
  sel.value=v287zLandscapePlanetId;
  const planet=list.find(q=>q.id===v287zLandscapePlanetId)||v287zLandscapePlanet();
  if(planet&&!v287adHasSavedPalette(planet)){v287adOpenPaletteForLandscape(planet);return}
  p._planet=planet||null;
  p.classList.remove('hidden');
  p._redraw?.();
  requestAnimationFrame(()=>keepDetachedPanelOnscreen(p))
}

function ensurePlaceControlsSidePanel(){
  let panel=$('placeControlsSidePanel');if(panel)return panel;
  panel=document.createElement('aside');panel.id='placeControlsSidePanel';panel.className='place-controls-side-panel hidden';
  panel.innerHTML=`<div class="place-controls-side-head"><div><b>Place Controls</b><small>Planet location, placement & Structure population</small></div><button type="button" id="placeControlsSideClose" class="ghost">×</button></div><div id="placeControlsSideBody" class="place-controls-side-body"></div>`;
  document.body.appendChild(panel);$('placeControlsSideClose').onclick=()=>panel.classList.add('hidden');prepareDetachedEditorPanel(panel,panel.querySelector('.place-controls-side-head'));return panel
}
function syncPlanetPlaceEditorSafety(scale){
  const planetMode=String(scale||'').toLowerCase()==='planet';
  // v28.7ac: keep the REAL Place editor intact. Only remove the old population/icon
  // controls that are meaningless for a root Planet and could trigger huge/recursive
  // placement paths. Do not hide ownership, description, relationships, etc.
  const hideIds=[
    'ePlaceIconText','ePlaceIconSymbol','editPlaceIconSymbols',
    'ePlacePopulationMode',
    'ePlaceStructureDensity','ePlaceStructureSpread','ePlaceStructureY','ePlaceStructurePlacementMode','ePlaceStructureVariantMode'
  ];
  for(const id of hideIds){
    const el=$(id);if(!el)continue;
    const host=el.closest('label,.editor-hint');
    if(host)host.classList.toggle('hidden',planetMode);
  }
  // Planet-wide controls remain available through the detached Planet Controls panel.
  // The main editor itself is never collapsed or replaced.
}
function syncPlaceControlsVisibility(){
  const panel=$('placeControlsSidePanel');if(!panel||editingType!=='place')return;
  const draft={...(editingId?byId(editingId):{}),placeScale:$('ePlaceScale')?.value||'building',placeType:$('ePlaceType')?.value||''};
  panel.classList.toggle('hidden',!placeAllowsSideControls(draft));
  const scale=String(draft.placeScale).toLowerCase(),countryMode=scale==='country',planetMode=scale==='planet';
  syncPlanetPlaceEditorSafety(scale);

  const paletteLauncher=$('planetPaletteLauncher');if(paletteLauncher)paletteLauncher.classList.toggle('hidden',!planetMode);
  if(!planetMode)$('planetPalettePanel')?.classList.add('hidden');
  const headTitle=panel.querySelector('.place-controls-side-head b'),headSmall=panel.querySelector('.place-controls-side-head small');
  if(headTitle)headTitle.textContent=countryMode?'Country Editor':planetMode?'Planet Controls':'Place Controls';
  if(headSmall)headSmall.textContent=countryMode?'Politics, borders & contained Places':planetMode?'Planet-wide generation & palette':'Planet location, placement & Structure population';
  panel.classList.toggle('country-controls-mode',countryMode);
  panel.classList.toggle('planet-controls-mode',planetMode);

  const countryBox=panel.querySelector('.country-editor-fields');if(countryBox)countryBox.classList.toggle('hidden',!countryMode);
  const planetHost=$('eSurfacePlanet')?.closest('label');if(planetHost){
    // v28.7aq: restore the parent-planet selector for every non-Planet Place.
    // Countries in Planet-scale systems still use the implicit active globe.
    const hidePlanetAssignment=planetMode||(countryMode&&countryUsesImplicitPlanet());
    planetHost.classList.toggle('hidden',hidePlanetAssignment);
    planetHost.dataset.placeControlGroup=countryMode?'country':'general';
  }
  const implicit=panel.querySelector('.country-implicit-planet-note');if(implicit)implicit.classList.toggle('hidden',!countryMode||!countryUsesImplicitPlanet());

  const populationCard=panel.querySelector('.place-population-card');
  if(populationCard){
    populationCard.classList.toggle('hidden',countryMode);
    // At Planet scale, remove ONLY the old controls from the screenshot / legacy Place population path.
    // Keep: Generate everywhere, tile authoring, Landscape Editor, and permitted Structure checkboxes.
    const hideForPlanet=['ePlacePopulationMode','ePlaceStructureDensity','ePlaceStructureSpread','ePlaceStructureY','ePlaceStructurePlacementMode','ePlaceStructureVariantMode'];
    for(const id of hideForPlanet){const host=populationCard.querySelector('#'+id)?.closest('label');if(host)host.classList.toggle('hidden',planetMode)}
    populationCard.querySelector('.planet-everywhere-control')?.classList.toggle('hidden',!planetMode);
    populationCard.querySelector('.planet-tile-authoring-controls')?.classList.toggle('hidden',!planetMode);
        const title=populationCard.querySelector('#placePopulationTitle'),help=populationCard.querySelector('#placePopulationHelp');
    if(title)title.textContent=planetMode?'Planet-wide Structure Generation':'Place Structure Population';
    if(help)help.textContent=planetMode?'Choose which authored Structures may generate across streamed planet tiles. Legacy Place scatter controls have been removed; planet population uses streamed tiles only.':'City markers can populate automatically. Custom markers can use only the Structures you choose.';
  }

  // Any legacy icon controls that older builds may have already moved into the side panel are never shown for Planet mode.
  for(const id of ['ePlaceIconText','ePlaceIconSymbol','editPlaceIconSymbols']){
    const el=panel.querySelector('#'+id);const host=el?.closest('label,.editor-hint');if(host)host.classList.toggle('hidden',planetMode);
  }
  requestAnimationFrame(()=>keepDetachedPanelOnscreen(panel));
}
function movePlaceControlsToSidePanel(){
  const panel=ensurePlaceControlsSidePanel(),body=$('placeControlsSideBody');if(!panel||!body)return;body.innerHTML='';
  const paletteLauncher=document.createElement('div');
  paletteLauncher.id='planetPaletteLauncher';
  paletteLauncher.className='planet-palette-launcher hidden';
  paletteLauncher.innerHTML=`<button type="button" id="openPlanetPalette" class="ghost planet-palette-open">🎨 Planet Color Palette</button><small>Edit land, ocean, gas-band, cloud, coverage, and Moon/planet colors. This is the palette used by the actual globe and sampled-color Landscape Editor.</small>`;
  body.appendChild(paletteLauncher);
  // launcher is handled by the delegated editor-button handler so moving panels cannot break it.

  const moved=new Set();
  const addHost=(host,group='general')=>{if(host&&!moved.has(host)){moved.add(host);host.dataset.placeControlGroup=group;body.appendChild(host)}};

  // Country-specific controls still intentionally live in the side panel.
  const country=document.querySelector('#editorModal .country-editor-fields');addHost(country,'country');
  if(country&&!country.querySelector('.country-implicit-planet-note'))country.insertAdjacentHTML('afterbegin','<div class="country-implicit-planet-note editor-hint hidden"><b>Planet:</b> This magic system is Planet-scale, so this Country automatically belongs to the active globe.</div>');
  // v28.7aq: this is a general Place-location control, not a Country-only control.
  const planetHost=$('eSurfacePlanet')?.closest('label');addHost(planetHost,'general');

  // IMPORTANT v28.7ac: do NOT move Planet icon / generic Place controls into this panel.
  // That was the screenshot bug. Keep those in the real Place editor.
  // The side menu gets only the population card, whose unsafe planet controls are hidden by syncPlaceControlsVisibility().
  addHost(document.querySelector('#editorModal .place-population-card'),'general');

  $('ePlaceScale')?.addEventListener('change',syncPlaceControlsVisibility);
  syncPlaceControlsVisibility();
  panel.classList.remove('hidden');requestAnimationFrame(()=>keepDetachedPanelOnscreen(panel));
}
function hidePlaceControlsSidePanel(){$('placeControlsSidePanel')?.classList.add('hidden');$('countryBorderPainter')?.classList.add('hidden')}
function openEditor(type,node=null){
  if(type==='place')countryBorderDraft=normalizeCountryBorderSegments(node?.countryBorderSegments||[]);
  // v25.3k stability: editorModal used to live inside .graph-wrap, whose layout
  // could make fixed-position editor geometry relative to the graph column.
  // Mount it at document.body so all viewport bounds are real viewport bounds.
  const editorModal=$('editorModal');
  if(editorModal&&editorModal.parentElement!==document.body)document.body.appendChild(editorModal);
  resetDraggableEditorPanels();
  pendingConnectionPlan=null;editingId=node?.id||null;editingType=type;$('editorModal').classList.remove('hidden');$('editorModal').classList.remove('place-side-editor');$('createMenu').classList.add('hidden');$('editorKindLabel').textContent=node?'Edit':'Create';$('editorTitle').textContent=(node?'Edit ':creatingHub?'New Hub: ':'New ')+(type==='magicalObject'?'Magical Object':type[0].toUpperCase()+type.slice(1));
  const f=E.field.bind(E);let html='<div class="editor-grid">';
  const creatorDef=generatedCreatorType(type);
  if(creatorDef){html=generatedEditorHtml(creatorDef,node);}
  else if(type==='mana')html+=`<div class="editor-hint">Mana is the root source of this magical system. You can rename it and define what kind of magical energy it represents without removing its role as the central source.</div>`
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
    +failOutputControlHtml('eFailOutput',node?.failOutput||'','Fail output')
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
      +`<div class="full material-rarity-card">
        <div class="material-rarity-head"><div><b>Material rarity</b><small>Left = rarer · Right = more common</small></div><strong id="materialRarityTier">${materialRarityInfo(node?.materialRarity??55,node?.name||'This material').tier}</strong></div>
        <input id="eMaterialRarity" class="material-rarity-slider" type="range" min="0" max="100" step="1" value="${Number.isFinite(node?.materialRarity)?node.materialRarity:55}">
        <div class="material-rarity-axis"><span>DIVINE / ALMOST NONE</span><span>COMMON / WIDESPREAD</span></div>
        <div id="materialRarityComparison" class="material-rarity-comparison">${E.esc(materialRarityInfo(node?.materialRarity??55,node?.name||'This material').comparison)}</div>
      </div>`
      +f('Category','eCategory',node?.category||'',false,'input')
      +f('Composition','eComposition',node?.composition||'',true,'textarea')
      +f('Properties','eProperty',node?.property||'',true,'textarea')
      +f('Requirements','eRequirements',node?.requirements||'',true,'textarea')
      +f('Uses','eUses',node?.uses||'',true,'textarea')
      +f('Interaction','eInteraction',node?.interaction||'',true,'textarea')
      +f('Description','eDescription',node?.description||'',true,'textarea');
    const materialPlaces=nodes.filter(x=>x.type==='place'&&!x.virtual&&!x.isHub);
    html+=f('Primary occurrence','eMaterialPlace','<option value="">No primary place</option>'+materialPlaces.map(p=>`<option value="${p.id}" ${node?.materialPlaceId===p.id?'selected':''}>${E.esc(p.name)}</option>`).join(''),false,'select')
      +f('Occurrence relationship','eMaterialPlaceMode',['commonly-found','mostly-found','only-found'].map(v=>`<option value="${v}" ${(node?.materialPlaceMode||'commonly-found')===v?'selected':''}>${v==='only-found'?'Only found here':v==='mostly-found'?'Found mostly here':'Commonly found here'}</option>`).join(''),false,'select');
    const variantMaterials=nodes.filter(x=>x.type==='material'&&!x.isHub&&x.id!==node?.id);
    html+=f('Variant of material','eMaterialVariantOf',
      '<option value="">None</option>'+variantMaterials.map(m=>`<option value="${m.id}" ${node?.variantOfMaterialId===m.id?'selected':''}>${E.esc(m.name||'Unnamed material')}</option>`).join(''),
      false,'select')
      +`<div class="full material-variant-note"><small>Use this for forms of the same underlying material: refined, corrupted, charged, crystalline, alloyed, synthetic, etc. The graph will create a <b>Variant of</b> relationship automatically.</small></div>`;
    html+=f('Acronym / short name','eMaterialAcronym',node?.materialAcronym||node?.acronym||'',false,'input','placeholder="e.g. Dia, HD, HDB" maxlength="16"');
    const prices=new Map((node?.currencyPrices||[]).map(p=>[p.currencyId,p.amount]));
    html+=`<div class="full material-texture-launcher"><div><b>Material Texture</b><small>Open the larger pixel painter on the right. Choose anything from 8×8 pixel-art up to a 256×256 material texture in the larger painter.</small></div><div class="material-texture-launch-actions"><div id="materialTextureInlinePreview" class="material-texture-mini"></div><button type="button" id="openMaterialTexturePanel" class="primary">▦ Open Material Painter</button></div></div>`;
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
        +`<div class="full special-editor-launcher"><div><b>Language Graph Editor</b><small>Build the language visually from Sounds, Symbols, Words, Phrases, grammar ideas and other pieces around the central language orb.</small></div><button type="button" id="openLanguageGraphEditor" class="primary">◉ Open Language Editor</button></div>`
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
      const diseaseKind=node?.diseaseKind||'Disease';
      const symptoms=ofType('civilizationUtil').filter(u=>u.utilityType==='disease'&&u.diseaseKind==='Symptom'&&u.id!==node?.id);
      const linkedSymptoms=node?edges.filter(e=>!e.blocked&&e.type==='diseaseSymptom'&&(e.a===node.id||e.b===node.id))
        .map(e=>byId(e.a===node.id?e.b:e.a)).filter(Boolean):[];

      html+=`<div class="editor-hint"><b>Disease / Symptom.</b> Symptoms are reusable building blocks. A Disease needs at least one linked Symptom before it can be saved.</div>`
        +f('Kind','eDiseaseKind',['Disease','Symptom'].map(v=>`<option ${diseaseKind===v?'selected':''}>${v}</option>`).join(''),false,'select')
        +f('Spread','eDiseaseSpread',['Low','Moderate','High','Extreme'].map(v=>`<option ${node?.diseaseSpread===v?'selected':''}>${v}</option>`).join(''),false,'select')
        +f('Severity','eDiseaseSeverity',['Mild','Moderate','Serious','Severe'].map(v=>`<option ${node?.diseaseSeverity===v?'selected':''}>${v}</option>`).join(''),false,'select')
        +f('Duration','eDiseaseDuration',['Short','Medium','Long','Chronic'].map(v=>`<option ${node?.diseaseDuration===v?'selected':''}>${v}</option>`).join(''),false,'select')
        +f('Mortality %','eDiseaseMortality',node?.diseaseMortality??10,false,'input','type="number" min="0" max="100" step="1"')
        +f('Known cure / treatment','eDiseaseCure',node?.diseaseCure||'',false,'input','placeholder="Object, Material, Technique..."')
        +f('Origin','eDiseaseOrigin',node?.diseaseOrigin||'',false,'input','placeholder="Place or region"')
        +`<div class="full pathogen-genome-editor">
          <div class="pathogen-genome-head"><div><b>Pathogen DNA-style genome</b><small>Fictional worldbuilding genetics: paired strands and abstract gene blocks. It is not a real biological model.</small></div><div class="pathogen-genome-actions"><button type="button" id="shortenPathogenGenome" class="ghost">½</button><button type="button" id="extendPathogenGenome" class="ghost">+ DNA</button><button type="button" id="regeneratePathogenGenome" class="ghost">Regenerate</button></div></div>
          <div id="pathogenGenomeView" class="pathogen-genome-view dna-helix-view"></div>
          <div id="pathogenGenomeStats" class="pathogen-genome-stats"></div>
          <div class="pathogen-gene-tools"><select id="eDiseaseGeneSelect"></select><button type="button" id="mutatePathogenGene">Mutate gene</button><button type="button" id="addPathogenGene" class="ghost">+ Gene</button><button type="button" id="removePathogenGene" class="ghost">− Gene</button><button type="button" id="radiatePathogenGenome" class="danger-soft">☢ Abstract radiation</button></div>
          <small class="pathogen-safety-note">Mutation and radiation are intentionally abstract/randomized simulation controls for fictional worldbuilding.</small>
          <textarea id="eDiseaseGenome" maxlength="512" spellcheck="false" placeholder="ACGT...">${E.esc(sanitizePathogenGenome(node?.diseaseGenome||generatePathogenGenome(72)))}</textarea>
        </div>`
        +`<div class="full disease-symptom-picker">
          <div class="organization-rel-head"><b>Symptoms used by this Disease</b><small>Required for Disease; ignored when Kind is Symptom.</small></div>
          ${symptoms.length?symptoms.map(s=>`<label class="life-check"><input class="disease-symptom-check" value="${s.id}" type="checkbox" ${linkedSymptoms.some(x=>x.id===s.id)?'checked':''}><span><b>${E.esc(s.name)}</b><small>Symptom</small></span></label>`).join(''):'<div class="auto-empty">No Symptoms exist yet. Create a Symptom first.</div>'}
        </div>`
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
    html+=`<div class="full organization-rel-editor"><div class="organization-rel-head"><b>Exclusive Life Access</b><small>If at least one Life node is linked, only linked Life naturally ${subtype==='language'?'speaks this language':subtype==='currency'?'uses this currency':subtype==='disease'?(node?.diseaseKind==='Symptom'?'can experience this symptom':'is susceptible to this disease'):'uses this civilization utility'}.</small></div>
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
      +f('Inhabitants / peoples','eOrganizationInhabitants',node?.organizationInhabitants||'',true,'textarea','placeholder="e.g. Ewoks; Humans; Vorians — matching Life names create graph links"')
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
    +f('Place scale','ePlaceScale',placeScaleOptions(node?.gasGiant?'planet':(node?.placeScale||inferPlaceScale(node?.placeType||node?.category||''))),false,'select')
    +f('Located on planet','eSurfacePlanet',
      '<option value="">Not placed on a planet surface</option>'+
      nodes.filter(x=>x.type==='place'&&x.id!==node?.id&&(x.gasGiant||String(x.placeScale||inferPlaceScale(x.placeType))==='planet')).map(p=>`<option value="${p.id}" ${node?.surfacePlanetId===p.id?'selected':''}>${E.esc(p.name)}</option>`).join(''),
      false,'select')
    +`<div class="full country-editor-fields ${(node?.placeScale||inferPlaceScale(node?.placeType))==='country'?'':'hidden'}">
      <div class="country-editor-title"><b>Country Editor</b><button type="button" id="openCountryBorderPainter" class="ghost">▱ Paint Borders</button></div>
      <div class="country-editor-grid">
        <label>Population<input id="eCountryPopulation" type="number" min="0" step="1" value="${Math.max(0,+node?.countryPopulation||0)}"></label>
        <label>Capital<input id="eCountryCapital" value="${E.esc(node?.countryCapital||'')}" placeholder="e.g. Aurelia City"></label>
        <label>Area / size<input id="eCountryArea" value="${E.esc(node?.countryArea||'')}" placeholder="e.g. 1.2 million km²"></label>
        <label>Government type<input id="eCountryGovernmentType" value="${E.esc(node?.countryGovernmentType||'')}" placeholder="e.g. Federation"></label>
        <label class="full">Economy / development<input id="eCountryEconomy" value="${E.esc(node?.countryEconomy||'')}" placeholder="e.g. Industrial, post-scarcity, agrarian"></label>
        <label class="full">Places inside this country
          <select id="eCountryContainedPlaces" multiple size="3">${countryContainedCandidatePlaces(node).map(p=>`<option value="${p.id}" ${(node?.countryContainedPlaceIds||[]).includes(p.id)?'selected':''}>${E.esc(p.name)} · ${E.esc(String(p.placeScale||inferPlaceScale(p.placeType)))}</option>`).join('')}</select>
          <small>${countryContainedCandidatePlaces(node).length?'Ctrl/Cmd-click to pick multiple smaller Places. Leave everything unselected for none.':'No smaller Place nodes exist yet — this country contains none.'}</small>
        </label>
      </div>
      <small>Borders and contained Places are stored directly on this Country.</small>
    </div>`
    +f('Planet-level icon text','ePlaceIconText',node?.placeIconText||'',false,'input','placeholder="e.g. ⛩, CITY, ✦, △"')
    +f('Planet-level custom symbol','ePlaceIconSymbol',symbolOptions(node?.placeIconSymbolId||''),false,'select')
    +`<div class="full editor-hint place-icon-hint"><div><b>Planet icon:</b> choose a custom Symbol or type any short icon/text. No icon means entering this Place shows barren landscape only.</div><button type="button" id="editPlaceIconSymbols" class="ghost">✎ Edit Symbols</button></div>`
    +`<div class="full place-population-card">
      <div class="place-population-head"><div><b id="placePopulationTitle">Place Structure Population</b><small id="placePopulationHelp">City markers can populate automatically. Custom markers can use only the Structures you choose.</small></div></div>
      <label>Population rule<select id="ePlacePopulationMode">
        <option value="auto" ${(node?.placePopulationMode||'auto')==='auto'?'selected':''}>Auto — city markers use authored Structures</option>
        <option value="custom" ${node?.placePopulationMode==='custom'?'selected':''}>Custom structure set</option>
        <option value="none" ${node?.placePopulationMode==='none'?'selected':''}>Landscape only</option>
      </select></label>
      <label class="inline-check planet-everywhere-control hidden"><input id="ePlanetStructuresEverywhere" type="checkbox" ${node?.planetStructuresEverywhere?'checked':''}> Generate permitted Structures everywhere across the planet</label><div class="planet-tile-authoring-controls hidden"><button type="button" id="openPlanetTileEditor" class="ghost">▦ Structure/Countryside Tiles</button><button type="button" id="openLandscapeEditor" class="ghost">⛰ Landscape Editor</button><small>Tile rules are streamed per visited surface tile, so planet-wide generation does not instantiate the whole globe at once.</small></div>
      <label>Density<input id="ePlaceStructureDensity" type="number" min="1" max="80" value="${Math.max(1,Math.min(80,+node?.placeStructureDensity||14))}"></label>
      <div class="place-placement-mode" id="ePlaceStructurePlacementMode"><span>Placement</span><label class="inline-check"><input id="ePlacePlacementGrid" name="placeStructurePlacement" type="radio" value="grid" ${(node?.placeStructurePlacement||'scatter')==='grid'?'checked':''}> Grid</label><label class="inline-check"><input id="ePlacePlacementScatter" name="placeStructurePlacement" type="radio" value="scatter" ${(node?.placeStructurePlacement||'scatter')!=='grid'?'checked':''}> Scatter</label><small>Grid keeps neat rows. Scatter distributes Structures across a real area while still obeying Density and Spreadness.</small></div>
      <label id="ePlaceStructureVariantMode">Structure variants<select id="ePlaceVariantMode">
        <option value="active" ${(!node?.placeStructureVariantMode&&!node?.placeRandomStructureVariants)||node?.placeStructureVariantMode==='active'?'selected':''}>Current variant only</option>
        <option value="cycle" ${node?.placeStructureVariantMode==='cycle'?'selected':''}>Cycle through variants</option>
        <option value="random" ${node?.placeStructureVariantMode==='random'||(!node?.placeStructureVariantMode&&node?.placeRandomStructureVariants)?'selected':''}>Random variant per placement</option>
      </select><small>Controls which authored Structure variant each generated placement uses. Cycle repeats variants in order; Random makes a deterministic mixed population.</small></label>
      <label>Spreadness <output id="ePlaceStructureSpreadOut">${Math.max(25,Math.min(300,+node?.placeStructureSpread||100))}%</output>
        <input id="ePlaceStructureSpread" type="range" min="25" max="300" step="5" value="${Math.max(25,Math.min(300,+node?.placeStructureSpread||100))}">
        <small>25% = compact · 100% = normal · 300% = very spread out.</small>
      </label>
      <label>Structure Y alteration<input id="ePlaceStructureY" type="number" step="0.1" min="-500" max="500" value="${Math.max(-500,Math.min(500,Number.isFinite(+node?.placeStructureY)?+node.placeStructureY:0))}"><small>Raises or lowers repeated Structures when this Place is rendered in the landscape.</small></label>
      <div class="place-structure-choices">${nodes.filter(x=>x.type==='structure'&&!x.isMegastructure).map(s=>`<label class="place-structure-choice"><input class="place-structure-check" type="checkbox" value="${s.id}" ${(node?.placeStructureIds||[]).includes(s.id)?'checked':''}><span>${E.esc(s.name)}</span></label>`).join('')||'<small>No authored Structures yet.</small>'}</div>
    </div>`
    +f('Variant of Place','eVariantOfPlace',
      '<option value="">None — original place</option>'+nodes.filter(x=>x.type==='place'&&!x.isHub&&x.id!==node?.id).map(x=>`<option value="${x.id}" ${node?.variantOfPlaceId===x.id?'selected':''}>${E.esc(x.name)}</option>`).join(''),
      false,'select')
    +`<div class="full place-side-editor-note"><b>Place Editor</b><small>Place-specific world controls now live here directly. Places no longer have a separate 3D modelling workspace.</small></div>`

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
    if(type==='material'){
      const places=nodes.filter(x=>x.type==='place'&&!x.virtual&&!x.isHub);
      html+=f('Primary occurrence','eMaterialPlace',
        '<option value="">No primary place</option>'+places.map(p=>`<option value="${p.id}" ${node?.materialPlaceId===p.id?'selected':''}>${E.esc(p.name)}</option>`).join(''),
        false,'select')
        +f('Occurrence relationship','eMaterialPlaceMode',
          ['commonly-found','mostly-found','only-found'].map(v=>`<option value="${v}" ${(node?.materialPlaceMode||'commonly-found')===v?'selected':''}>${v==='only-found'?'Only found here':v==='mostly-found'?'Found mostly here':'Commonly found here'}</option>`).join(''),
          false,'select');
      const variantMaterials=nodes.filter(x=>x.type==='material'&&!x.isHub&&x.id!==node?.id);
      html+=f('Variant of material','eMaterialVariantOf',
        '<option value="">None</option>'+variantMaterials.map(m=>`<option value="${m.id}" ${node?.variantOfMaterialId===m.id?'selected':''}>${E.esc(m.name||'Unnamed material')}</option>`).join(''),
        false,'select');
    }
    if(type==='structure')html+=`
      <label class="full life-check mega-structure-check">
        <input id="eIsMegastructure" type="checkbox" ${node?.isMegastructure?'checked':''}>
        <span><b>Megastructure</b><small>Give this Structure a physical civilization-scale appearance, from planetary construction up to galactic engineering. Ordinary 3D modelling is disabled while this is on.</small></span>
      </label>
      <label class="full">Variant of Structure
        <select id="eVariantOfStructure"><option value="">None — original structure</option>${nodes.filter(x=>x.type==='structure'&&!x.isHub&&!x.isMegastructure&&x.id!==node?.id).map(x=>`<option value="${x.id}" ${node?.variantOfStructureId===x.id?'selected':''}>${E.esc(x.name)}</option>`).join('')}</select>
        <small>Use this for building families, architectural variants, alternate towers, repeated city blocks, and related structural designs.</small>
      </label>
      <div id="structureModelLauncher" class="full place-model-launcher ${node?.isMegastructure?'hidden':''}"><div><b>3D Structure Model</b><small>Uses the exact same WebGL modeller as Places, including environment, variants, repetition, camera navigation, and gizmos.</small></div><div><span id="structureModelSummary">${node?.structureModel?.variants?.length||1} model variant${(node?.structureModel?.variants?.length||1)===1?'':'s'}</span><button type="button" id="openStructureModelEditor" class="primary">◫ Open 3D Software</button></div></div>`;
    if(type==='magicalObject'){
      const recipe=node?.craftingRecipe||{ingredients:[],process:''};
      html+=`
      <label class="full life-check tech-object-check"><input id="eTechnological" type="checkbox" ${node?.technological?'checked':''}>
        <span><b>Technological</b><small>Add this Magical Object to the Technology Tree and technological history. It can become part of civilization research and advancement.</small></span>
      </label>
      <label class="full life-check component-object-check"><input id="eIsComponent" type="checkbox" ${node?.isComponent?'checked':''}>
        <span><b>Component</b><small>Allows this object to be selected as an ingredient/component while crafting other Magical Objects.</small></span>
      </label>
      <div class="full material-texture-launcher magical-object-drawer-launcher"><div><b>2D Magical Object Drawer</b><small>Draw this object's icon / appearance with the exact same 8×8 → 256×256 pixel tools as the Material Painter.</small></div><div class="material-texture-launch-actions"><div id="materialTextureInlinePreview" class="material-texture-mini"></div><button type="button" id="openMaterialTexturePanel" class="primary">▦ Open 2D Drawer</button></div></div>
      <div class="full crafting-editor-shell" ${node?.isHub?'data-hub-disabled="true"':''}><button type="button" id="toggleCraftingPanel" ${node?.isHub?'disabled title="Hubs do not have crafting recipes"':''} class="crafting-open-button">⚒ Open Crafting Graph</button><div id="craftingOpenStatus" class="crafting-open-status"></div><small class="crafting-inline-help">Opens as a graph to the right. Name this object first, then insert Materials, Components, Magical Objects, or Tools and connect them through named processes.</small></div>`;
    }
    if(type==='life')html+=`
      <div class="full life-role-editor">
        <div class="life-role-title">Civilization role</div>
        <label class="life-check"><input id="eSentient" type="checkbox" ${node?.sentient?'checked':''}><span><b>Sentient</b><small>Can reason, organize, communicate, form settlements, alliances, governments, raids, or wars.</small></span></label>
        <label class="life-check"><input id="eMainLife" type="checkbox" ${node?.main?'checked':''}><span><b>Main</b><small>A dominant / controlling civilization-building creature in this world. Main automatically means Sentient. Multiple Main species are allowed.</small></span></label>
        <label class="life-check"><input id="eIndividual" type="checkbox" ${node?.individual?'checked':''}><span><b>Individual</b><small>This node represents one specific person or unique creature rather than a whole species. Useful for famous people, rulers, inventors, heroes, historical figures, or singular beings.</small></span></label>

        <div id="individualFamilyWrap" class="life-family-wrap ${node?.individual?'':'hidden'}">
          <div class="life-family-head">
            <div><b>Family Tree</b><small>Optional relationships between Individual Life nodes.</small></div>
            <label class="life-family-enable"><input id="eFamilyEnabled" type="checkbox" ${node?.familyEnabled?'checked':''}> Enable</label>
          </div>
          <div id="lifeFamilyFields" class="life-family-fields ${node?.familyEnabled?'':'hidden'}">
            ${(()=>{
              const people=nodes.filter(x=>x.type==='life'&&x.individual&&!x.isHub&&x.id!==node?.id);
              const opts=(selectedId)=>'<option value="">None</option>'+people.map(p=>`<option value="${p.id}" ${selectedId===p.id?'selected':''}>${E.esc(p.name||'Unnamed individual')}</option>`).join('');
              return `
                <label>Parent 1<select id="eFamilyParent1">${opts(node?.familyParent1Id||'')}</select></label>
                <label>Parent 2<select id="eFamilyParent2">${opts(node?.familyParent2Id||'')}</select></label>
                <label>Partner / spouse<select id="eFamilyPartner">${opts(node?.familyPartnerId||'')}</select></label>
                <div class="life-family-children"><b>Children</b><div id="eFamilyChildrenPreview">${
                  nodes.filter(x=>x.type==='life'&&x.individual&&!x.isHub&&(x.familyParent1Id===node?.id||x.familyParent2Id===node?.id))
                    .map(x=>`<span>${E.esc(x.name||'Unnamed individual')}</span>`).join('') || '<small>None linked yet.</small>'
                }</div><small>Children are derived automatically from other Individual Life nodes that list this person as a parent.</small></div>`;
            })()}
          </div>
        </div>
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
  // v28: role value lives in the form, while the actual controller is a
  // detached draggable viewport widget.
  if(type!=='mana'&&!node?.virtual){
    const role=node?nodeHubRole(node):(creatingHub?'hub':'normal');
    html+=`<input id="eHubRole" type="hidden" value="${role}">`;
  }

  $('editorBody').innerHTML=html+'</div>' 
  bindFailOutputControls($('editorBody'));
  showUniversalCategoryPanel(node,type);

  $('craftingGraphPanel')?.classList.add('hidden');
  $('materialTexturePanel')?.classList.add('hidden');$('editorModal')?.querySelector('.editor-shell')?.classList.remove('material-painter-open');
  $('autoConnectionsPanel').classList.add('hidden');
  if(type==='civilizationUtil'){
    bindCivilizationUtilSymbolPalette();

    const utilType=node?.utilityType||window.__pendingCivilizationUtilType;
    if(utilType==='language'){
      bindLanguageMappingEditor();
      bindLanguageGraphEditor(node);
    }
    if(utilType==='disease'){
      $('eDiseaseKind')?.addEventListener('change',updateDiseaseKindEditor);
      bindPathogenGenomeEditor();
      updateDiseaseKindEditor()
    }
  }
  if(type==='material'){bindMaterialTextureEditor(node,'material');bindMaterialRarityEditor();bindMaterialUpgradeTreeEditor()}
  if(type==='magicalObject')bindMaterialTextureEditor(node,'object')

  if(type==='life'){
    const famEnabled=$('eFamilyEnabled'),famFields=$('lifeFamilyFields'),individualBox=$('eIndividual');
    const syncFamilyVisibility=()=>{
      const isIndividual=!!individualBox?.checked;
      $('individualFamilyWrap')?.classList.toggle('hidden',!isIndividual);
      famFields?.classList.toggle('hidden',!(isIndividual&&famEnabled?.checked));
    };
    famEnabled?.addEventListener('change',syncFamilyVisibility);
    individualBox?.addEventListener('change',syncFamilyVisibility);
    syncFamilyVisibility();
  }

  if(type!=='place')hidePlaceControlsSidePanel();
  if(type==='magicalObject')bindCraftingEditor(node);
  if(type==='place'){
    placeModelDraft=null;
    const spread=$('ePlaceStructureSpread'),spreadOut=$('ePlaceStructureSpreadOut');
    if(spread&&spreadOut){
      const syncSpread=()=>{spreadOut.textContent=`${spread.value}%`};
      spread.addEventListener('input',syncSpread);
      syncSpread()
    }
    const iconBtn=$('editPlaceIconSymbols');
    if(iconBtn)iconBtn.onclick=()=>{$('symbolLibraryModal')?.classList.remove('hidden');renderSymbolLibrary()};
    requestAnimationFrame(movePlaceControlsToSidePanel);
  }
  if(type==='structure')bindStructureModelEditor(node);
  // v28.7o: conventional editor cards (including Place) use the same drag engine
  // as the other editors. This call was previously defined but never invoked here.
  requestAnimationFrame(bindDraggableEditorPanels);
  $('previewAutoConnections').classList.toggle('hidden',type==='mana');
  if($('eHubRole'))showHubRolePanel(value('eHubRole')||'normal');else hideHubRolePanel();

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
      hidden.dispatchEvent(new Event('change',{bubbles:true}));

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
      const craftBtn=$('toggleCraftingPanel');if(craftBtn){const hub=role==='hub';craftBtn.disabled=hub;craftBtn.title=hub?'Hubs do not have crafting recipes':'';craftBtn.closest('.crafting-editor-shell')?.toggleAttribute('data-hub-disabled',hub);if(hub)$('craftingGraphPanel')?.classList.add('hidden')}

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
        hidden.dispatchEvent(new Event('change',{bubbles:true}));
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
      $('ePlanetSkyColor').value=n?.planetSkyColor||'#8fc8ee';
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
      $('ePlanetCountryBordersEnabled').checked=n?.planetCountryBordersEnabled!==false;
      $('ePlanetProceduralBorders').checked=!!n?.planetProceduralBorders;
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
    $('eSurfacePlanet')?.addEventListener('change',()=>{$('countryBorderPainter')?._redraw?.()});
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
  requestEditorFit();
  requestAnimationFrame(bindDraggableEditorPanels);
  requestAnimationFrame(bindGlobalDraggableMenus);
}



function closeEditor(){
  hidePlaceControlsSidePanel();hideHubRolePanel();hideUniversalCategoryPanel();$('diseaseStrandSidePanel')?.classList.add('hidden');
  resetDraggableEditorPanels();if(megaPainterState?.expanded)toggleMegaPainterExpanded(false);$('autoConnectionsPanel').classList.add('hidden');$('planetPalettePanel')?.classList.add('hidden');$('solarSystemEditorPanel')?.classList.add('hidden');$('starEditorPanel')?.classList.add('hidden');$('megastructureEditorPanel')?.classList.add('hidden');$('materialTexturePanel')?.classList.add('hidden');$('craftingGraphPanel')?.classList.add('hidden');$('languageGraphPanel')?.classList.add('hidden');$('scene3DPanel')?.classList.add('hidden');$('editorModal')?.querySelector('.editor-shell')?.classList.remove('material-painter-open','crafting-panel-open');$('editorModal').classList.remove('place-side-editor');$('editorModal').classList.add('hidden');editingId=null;editingType=null;creatingHub=false;pendingConnectionPlan=null}
const value=id=>$(id)?.value?.trim()||'';
function saveCivilizationUtilEditor(){
  if(editingType!=='civilizationUtil')return false;

  const name=value('eName');
  if(!name)return false;

  const requestedSubtype=value('eUtilityType')||window.__pendingCivilizationUtilType||'language';
  if(requestedSubtype==='disease'&&(value('eDiseaseKind')||'Disease')==='Disease'){
    const selectedSymptoms=[...document.querySelectorAll('.disease-symptom-check:checked')];
    if(!selectedSymptoms.length){
      const saveBtn=$('saveEditor');
      if(saveBtn){
        saveBtn.textContent='Add a symptom';
        setTimeout(()=>{saveBtn.textContent='Save'},1400)
      }
      document.querySelector('.disease-symptom-picker')?.classList.add('requirement-missing');
      return false
    }
  }

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
      languageMappings:Object.values(languageGroups).flat(),
      languageEditorGraph:languageGraphDraft?{nodes:languageGraphDraft.nodes.map(x=>({...x})),links:languageGraphDraft.links.map(x=>({...x}))}:(n.languageEditorGraph||null)
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
    const diseaseKind=value('eDiseaseKind')||'Disease';
    Object.assign(n,{
      diseaseKind,
      category:diseaseKind,
      diseaseSpread:value('eDiseaseSpread'),
      diseaseSeverity:value('eDiseaseSeverity'),
      diseaseDuration:value('eDiseaseDuration'),
      diseaseMortality:Math.max(0,Math.min(100,+value('eDiseaseMortality')||0)),
      diseaseCure:value('eDiseaseCure'),
      diseaseOrigin:value('eDiseaseOrigin'),
      diseaseGenome:normalizePathogenGenome(value('eDiseaseGenome'))
    });

    edges=edges.filter(e=>!(e.type==='diseaseSymptom'&&(e.a===n.id||e.b===n.id)));
    if(diseaseKind==='Disease'){
      document.querySelectorAll('.disease-symptom-check:checked').forEach(ch=>{
        const symptom=byId(ch.value);
        if(symptom)edges.push({
          id:uid(),a:n.id,b:symptom.id,type:'diseaseSymptom',
          linkType:'relationship',label:'Has Symptom',direction:'forward',
          manual:true,strength:'solid',thickness:1.5
        })
      })
    }
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

  // Universal category is independent of the utility's semantic subtype.
  applyUniversalCategoryToNode(n);

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


function removeAutoRelationshipEdgesFor(nodeId,relationKinds){
  for(let i=edges.length-1;i>=0;i--){
    const e=edges[i];
    if(e?.v26RelationshipAuto&&e.a===nodeId&&relationKinds.includes(e.v26RelationshipKind))edges.splice(i,1);
  }
}
function ensureV26RelationshipEdge(aId,bId,label,kind,direction='forward'){
  if(!aId||!bId||aId===bId)return;
  const existing=edges.find(e=>e.a===aId&&e.b===bId&&e.v26RelationshipAuto&&e.v26RelationshipKind===kind);
  if(existing){existing.label=label;return existing}
  const e={id:uid(),a:aId,b:bId,type:'relationship',linkType:'relationship',label,direction,manual:false,strength:'solid',thickness:1.6,v26RelationshipAuto:true,v26RelationshipKind:kind};
  edges.push(e);return e
}
function syncFamilyTreeEdges(n){
  if(!n||n.type!=='life')return;
  removeAutoRelationshipEdgesFor(n.id,['family-parent-1','family-parent-2','family-partner']);
  if(!n.individual||!n.familyEnabled)return;
  if(n.familyParent1Id)ensureV26RelationshipEdge(n.id,n.familyParent1Id,'child of','family-parent-1');
  if(n.familyParent2Id)ensureV26RelationshipEdge(n.id,n.familyParent2Id,'child of','family-parent-2');
  if(n.familyPartnerId){
    ensureV26RelationshipEdge(n.id,n.familyPartnerId,'partner','family-partner','both');
    const p=byId(n.familyPartnerId);
    if(p?.type==='life'&&p.individual&&p.familyEnabled&&!p.familyPartnerId)p.familyPartnerId=n.id;
  }
}
function syncMaterialVariantEdge(n){
  if(!n||n.type!=='material')return;
  removeAutoRelationshipEdgesFor(n.id,['material-variant']);
  if(n.variantOfMaterialId)ensureV26RelationshipEdge(n.id,n.variantOfMaterialId,'variant of','material-variant');
}
function syncV28NodeVariantEdge(n){
  if(!n||!['place','structure'].includes(n.type))return;
  removeAutoRelationshipEdgesFor(n.id,['place-variant','structure-variant']);
  const id=n.type==='place'?n.variantOfPlaceId:n.variantOfStructureId;if(id)ensureV26RelationshipEdge(n.id,id,'variant of',n.type==='place'?'place-variant':'structure-variant')
}
function syncV282PlaceLocationEdge(n){
  if(!n||n.type!=='place')return;
  edges=edges.filter(e=>!(e.placePlanetLocation&&e.a===n.id));
  if(n.surfacePlanetId&&byId(n.surfacePlanetId))edges.push({id:uid(),a:n.id,b:n.surfacePlanetId,type:'relationship',linkType:'relationship',label:'Is located in',direction:'forward',manual:false,strength:'solid',thickness:1.6,placePlanetLocation:true})
}
function placeHasPlanetIcon(n){return!!(n&&(String(n.placeIconText||'').trim()||n.placeIconSymbolId))}


function saveEditor(){
  if(generatedCreatorType(editingType)){saveGeneratedCreatorNode(editingType);return}
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
  else if(type==='spell')Object.assign(n,{spellClass:value('eClass')||'Unclassified',intent:value('eIntent'),structure:value('eStructure'),target:value('eTarget'),output:value('eOutput'),duration:value('eDuration'),range:value('eRange'),source:value('eSource')||'Mana',failOutput:value('eFailOutput'),morality:+($('eMorality')?.value||0),extra:value('eExtra')});
  else if(type==='rule')Object.assign(n,{strength:value('eStrength'),spellClass:value('eRuleClass'),text:value('eText'),scope:value('eScope')||'All magic',exceptions:value('eExceptions'),spellIds:[...document.querySelectorAll('.rule-spell-check:checked')].map(x=>x.value)});
  else if(type==='place')Object.assign(n,{
    placeType:value('ePlaceType'),
    placeScale:value('ePlaceScale')||inferPlaceScale(value('ePlaceType')),
    planetLandColor:value('ePlanetLandColor')||'#5d8f5a',
    planetLandColor2:value('ePlanetLandColor2')||'#78915b',
    planetLandColor3:value('ePlanetLandColor3')||'#8d8655',
    planetLandColor4:n?.planetPaletteSaved?null:n?.planetLandColor4,
    planetLandColor5:n?.planetPaletteSaved?null:n?.planetLandColor5,
    planetLandColor6:n?.planetPaletteSaved?null:n?.planetLandColor6,
    planetOceanColor:value('ePlanetOceanColor')||'#315f9f',
    planetOceanColor2:value('ePlanetOceanColor2')||'#102f58',
    planetSkyColor:value('ePlanetSkyColor')||n.planetSkyColor||'#8fc8ee',
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
    planetCountryBordersEnabled:$('ePlanetCountryBordersEnabled')?.checked!==false,
    planetProceduralBorders:!!$('ePlanetProceduralBorders')?.checked,
    planetPaletteSaved:value('ePlaceScale')==='planet'?(n.planetPaletteSaved||false):n.planetPaletteSaved,
    planetModelSeed:n.planetModelSeed||v287yPlanetSeed(n),
    planetStructureTiles:n.planetStructureTiles||{},
    planetLandscapeTiles:n.planetLandscapeTiles||{},
    planetLandscapeModels:n.planetLandscapeModels||{},
    planetLandscapeColorRules:n.planetLandscapeColorRules||{},
    countryPopulation:Math.max(0,+value('eCountryPopulation')||0),
    countryCapital:value('eCountryCapital'),
    countryArea:value('eCountryArea'),
    countryGovernmentType:value('eCountryGovernmentType'),
    countryEconomy:value('eCountryEconomy'),
    countryBorderSegments:normalizeCountryBorderSegments(countryBorderDraft),
    countryContainedPlaceIds:[...($('eCountryContainedPlaces')?.selectedOptions||[])].map(o=>o.value),
    starPreset:value('eStarPreset')||n.starPreset||'G',
    starColor:value('eStarColor')||n.starColor||STAR_PRESETS.G.core,
    starColor2:value('eStarColor2')||n.starColor2||STAR_PRESETS.G.outer,
    starGlow:value('eStarGlow')||n.starGlow||STAR_PRESETS.G.glow,
    starSize:Math.max(.4,Math.min(3,+value('eStarSize')||n.starSize||1)),
    surfacePlanetId:value('ePlaceScale')==='planet'?null:((value('ePlaceScale')==='country'&&countryUsesImplicitPlanet())?null:(value('eSurfacePlanet')||null)),
    placeIconText:value('ePlaceScale')==='planet'?'':value('ePlaceIconText'),
    placeIconSymbolId:value('ePlaceScale')==='planet'?null:(value('ePlaceIconSymbol')||null),
    allowWildernessStructures:false,
    placePopulationMode:value('ePlaceScale')==='planet'?'custom':(value('ePlacePopulationMode')||'auto'),
    placeRandomStructures:false,
    planetStructuresEverywhere:!!$('ePlanetStructuresEverywhere')?.checked,
    placeRandomStructureVariants:value('ePlaceVariantMode')==='random',
    placeStructureVariantMode:['active','cycle','random'].includes(value('ePlaceVariantMode'))?value('ePlaceVariantMode'):'active',
    placeStructureDensity:Math.max(1,Math.min(80,+value('ePlaceStructureDensity')||14)),
    placeStructurePlacement:$('ePlacePlacementGrid')?.checked?'grid':'scatter',
    placeStructureSpread:Math.max(25,Math.min(300,+value('ePlaceStructureSpread')||100)),
    placeStructureY:Math.max(-500,Math.min(500,Number.isFinite(+value('ePlaceStructureY'))?+value('ePlaceStructureY'):0)),
    placeStructureIds:[...document.querySelectorAll('.place-structure-check:checked')].map(x=>x.value),
    structurePlacementOffsets:n.structurePlacementOffsets||{},
    surfaceLat:Number.isFinite(+n.surfaceLat)?+n.surfaceLat:(Math.random()-.5)*1.6,
    surfaceLon:Number.isFinite(+n.surfaceLon)?+n.surfaceLon:(Math.random()-.5)*Math.PI*2,
    placeModel:null,
    variantOfPlaceId:value('ePlaceScale')==='planet'?null:(value('eVariantOfPlace')||null),
    ownerFactionId:value('ePlaceScale')==='planet'?null:(value('eOwnerFaction')||null),
    inhabitants:value('ePlaceScale')==='planet'?'':value('eInhabitants'),
    government:value('ePlaceScale')==='planet'?'':value('eGovernment'),
    access:value('ePlaceScale')==='planet'?'':value('eAccess'),
    associations:value('ePlaceScale')==='planet'?'':value('eAssociations'),
    interaction:value('ePlaceScale')==='planet'?'':value('ePlaceInteraction'),
    description:value('ePlaceScale')==='planet'?'':value('eDescription'),
    // Mirror into the generic relationship fields so the existing V15
    // automatic-connection engine understands Places without a rewrite.
    category:value('ePlaceType'),
    composition:value('ePlaceScale')==='planet'?'':value('eInhabitants'),
    property:value('ePlaceScale')==='planet'?'':value('eGovernment'),
    requirements:value('ePlaceScale')==='planet'?'':value('eAccess'),
    uses:value('ePlaceScale')==='planet'?'':value('eAssociations')
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
      organizationInhabitants:value('eOrganizationInhabitants'),
      organizationCapital:value('eOrganizationCapital'),
      organizationResources:value('eOrganizationResources'),
      category:value('eOrganizationType')||'Organization',
      property:value('eOrganizationPurpose'),
      uses:value('eOrganizationResources'),
      description:value('eDescription')
    });

    edges=edges.filter(e=>!(e.type==='organizationInhabitant'&&(e.a===n.id||e.b===n.id)));
    const inhabitantNames=String(n.organizationInhabitants||'')
      .split(/[;,\n|]+/)
      .map(x=>x.trim().toLowerCase())
      .filter(Boolean);
    for(const life of ofType('life')){
      if(!inhabitantNames.includes(String(life.name||'').trim().toLowerCase()))continue;
      edges.push({
        id:uid(),a:n.id,b:life.id,type:'organizationInhabitant',
        linkType:'relationship',label:'Inhabited By',direction:'forward',
        manual:true,strength:'solid',thickness:1.5
      })
    }

    document.querySelectorAll('[data-org-rel]').forEach(row=>{
      const other=byId(row.dataset.orgRel);
      const slider=row.querySelector('.org-rel-slider');
      if(other&&slider)setOrganizationRelationship(n,other,+slider.value)
    })
  }
  else {
    Object.assign(n,{category:value('eCategory'),parentCategory:n.parentCategory||'',composition:value('eComposition'),property:value('eProperty'),requirements:value('eRequirements'),uses:value('eUses'),interaction:value('eInteraction'),description:value('eDescription')});
    if(type==='material'){
      n.materialRarity=Math.max(0,Math.min(100,+value('eMaterialRarity')||0));
      n.materialPlaceId=value('eMaterialPlace')||'';
      n.materialPlaceMode=value('eMaterialPlaceMode')||'commonly-found';
      n.variantOfMaterialId=value('eMaterialVariantOf')||'';
      if(n.variantOfMaterialId===n.id)n.variantOfMaterialId='';
      n.materialTexture=materialTextureEditorData();
      n.materialAcronym=value('eMaterialAcronym').trim();n.acronym=n.materialAcronym;
      // Upgrade relationships are edited from the separate Material Tools toolbar.
      if(n.materialUpgradeFromId===n.id)n.materialUpgradeFromId='';
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
      n.variantOfStructureId=n.isMegastructure?null:(value('eVariantOfStructure')||null);
      if(!n.isMegastructure)n.structureModel=structureModelDraft?scene3DModelForSave(structureModelDraft):(n.structureModel||normalizeScene3DModel(null));
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
    if(type==='magicalObject'){
      n.technological=!!$('eTechnological')?.checked;n.isComponent=!!$('eIsComponent')?.checked;
      n.objectTexture=materialTextureEditorData();
      if(!n.isHub)n.craftingRecipe=collectCraftingRecipe(); else delete n.craftingRecipe;
    }
    if(type==='life'){
      n.sentient=!!$('eSentient')?.checked;
      n.main=!!$('eMainLife')?.checked;
      if(n.main)n.sentient=true;
      if(!n.sentient)n.main=false;
      n.relationshipWithMain=(n.sentient&&!n.main)?+(value('eRelationshipMain')||0):0;
      n.individual=!!$('eIndividual')?.checked;
      n.individualMorality=n.individual?Math.max(-100,Math.min(100,+value('eIndividualMorality')||0)):0;
      n.familyEnabled=n.individual&&!!$('eFamilyEnabled')?.checked;
      n.familyParent1Id=n.familyEnabled?(value('eFamilyParent1')||''):'';
      n.familyParent2Id=n.familyEnabled?(value('eFamilyParent2')||''):'';
      n.familyPartnerId=n.familyEnabled?(value('eFamilyPartner')||''):'';
      if(n.familyParent2Id&&n.familyParent2Id===n.familyParent1Id)n.familyParent2Id='';
      if(n.familyPartnerId===n.id)n.familyPartnerId='';
    }
  }
  if($('eHubRole')&&type!=='mana'){
    setNodeHubRole(n,value('eHubRole'))
  }else if(!editingId&&creatingHub&&type!=='spell'){
    setNodeHubRole(n,'hub')
  }
  if(type!=='mana'&&pendingConnectionPlan){
    n.connectionPlan=pendingConnectionPlan.map(p=>({...p}));
  }

  applyUniversalCategoryToNode(n);
  if(type==='life')syncFamilyTreeEdges(n);
  if(type==='material')syncMaterialVariantEdge(n);
  if(type==='place'||type==='structure')syncV28NodeVariantEdge(n);
  if(type==='place'){syncV282PlaceLocationEdge(n);syncCountryContainedPlaceEdges(n)}

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
  e.label=value('linkLabel')||value('linkType');e.linkType=value('linkType');const creatorLink=creatorLinkDef(e.linkType);e.strength=value('linkStrength');e.thickness=+value('linkThickness')||1.6;e.direction=value('linkDirection')||'forward';e.color=creatorLink?.color||e.color;e.creatorCategory=creatorLink?.category||'';e.relationship=e.linkType==='relationship'?+(value('linkRelationship')||0):undefined;e.relationshipKind=e.linkType==='relationship'?(value('linkRelationshipKind')||'separate'):undefined;if(e.linkType==='relationship')e.label=`${relationshipKindLabel(e.relationshipKind)} · relationship ${e.relationship>0?'+':''}${e.relationship}`;
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



const WORLD_RENDER_SCHEMA=23207;
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
      organizationInhabitants:mainLife?.name||'',
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
    id:uid(),type:'civilizationUtil',utilityType:'disease',category:'Disease',diseaseKind:'Disease',
    name:v16Unique(v16Pick(['Frostlung','Mana Fever','Glassblight'])),
    diseaseSpread:v16Pick(['Low','Moderate','High']),
    diseaseSeverity:v16Pick(['Mild','Moderate','Serious']),
    diseaseDuration:v16Pick(['Short','Medium','Long']),
    diseaseMortality:Math.floor(Math.random()*24),
    diseaseCure:ofType('material')[1]?.name||'Magical treatment',
    diseaseOrigin:planet.name,
    diseaseGenome:generatePathogenGenome(72),
    description:'A procedurally generated disease used by ecology and history simulation.',
    x:380,y:340,vx:0,vy:0,r:16
  };
  const symptomA={
    id:uid(),type:'civilizationUtil',utilityType:'disease',category:'Symptom',diseaseKind:'Symptom',
    name:v16Unique(v16Pick(['Mana Cough','Crystal Fever','Frost Chills'])),
    diseaseSeverity:v16Pick(['Mild','Moderate','Serious']),
    diseaseDuration:v16Pick(['Short','Medium','Long']),
    description:'A procedurally generated symptom used by diseases.',
    x:400,y:360,vx:0,vy:0,r:15
  };
  const symptomB={
    id:uid(),type:'civilizationUtil',utilityType:'disease',category:'Symptom',diseaseKind:'Symptom',
    name:v16Unique(v16Pick(['Arcane Fatigue','Glowrash','Resonance Ache'])),
    diseaseSeverity:v16Pick(['Mild','Moderate','Serious']),
    diseaseDuration:v16Pick(['Short','Medium','Long']),
    description:'A procedurally generated symptom used by diseases.',
    x:420,y:375,vx:0,vy:0,r:15
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
  nodes.push(language,currency,symptomA,symptomB,disease,calendar,legal,ranks,communication);
  edges.push({id:uid(),a:disease.id,b:symptomA.id,type:'diseaseSymptom',linkType:'relationship',label:'Has Symptom',direction:'forward',manual:true,strength:'solid',thickness:1.5});
  edges.push({id:uid(),a:disease.id,b:symptomB.id,type:'diseaseSymptom',linkType:'relationship',label:'Has Symptom',direction:'forward',manual:true,strength:'solid',thickness:1.5});

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

let planetView={yaw:0,pitch:-.12,zoom:1,panX:0,panY:0,drag:false,dragMode:'rotate',lastX:0,lastY:0,political:false};
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
  // v28.7y: deterministic planet geometry. The border painter and world map
  // now resolve the exact same continent/island model for a given planet.
  let rs=(Math.abs(Math.floor(+seed||1))>>>0)||1;
  const rnd=()=>{rs=(Math.imul(rs,1664525)+1013904223)>>>0;return rs/4294967296};

  while(continents.length<count&&attempts<500){
    attempts++;
    const lat=(rnd()-.5)*Math.PI*1.25;
    const lon=(rnd()*2-1)*Math.PI;
    const radius=.42+rnd()*.34;

    // Keep major continent seeds fairly separated so they form distinct,
    // readable landmasses instead of one noisy global blob.
    const tooClose=continents.some(c=>angularDistance(lat,lon,c.lat,c.lon)<(radius+c.radius)*.72);
    if(tooClose)continue;

    const lobes=[];
    const lobeCount=3+Math.floor(rnd()*4);
    for(let i=0;i<lobeCount;i++){
      const a=rnd()*Math.PI*2;
      const d=radius*(.15+rnd()*.42);
      lobes.push({
        lat:Math.max(-1.42,Math.min(1.42,lat+Math.sin(a)*d*.72)),
        lon:lon+Math.cos(a)*d,
        radius:radius*(.28+rnd()*.34)
      });
    }

    continents.push({
      lat,lon,radius,
      warpA:rnd()*Math.PI*2,
      warpB:rnd()*Math.PI*2,
      lobes
    });
  }

  // Sparse islands: enough for visual variety, but not enough to create
  // disconnected-rectangle confetti.
  const islands=[];
  const islandCount=Math.max(3,Math.floor(count*1.6));
  for(let i=0;i<islandCount;i++){
    const parent=continents[Math.floor(rnd()*continents.length)];
    const a=rnd()*Math.PI*2;
    const d=parent.radius*(1.05+rnd()*.95);
    islands.push({
      lat:Math.max(-1.48,Math.min(1.48,parent.lat+Math.sin(a)*d*.7)),
      lon:parent.lon+Math.cos(a)*d,
      radius:.07+rnd()*.12
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

      const isLand=simState.planet?.oceanEnabled===false||(simState.planet?.landEnabled!==false&&(centerField>threshold+.012||cornerHits>=2));
      const n=planetSmooth(midLat*2.25,midLon*2.25,simState.planet.seed+99);
      const moist=planetSmooth(midLat*3.1,midLon*3.1,simState.planet.seed+301);

      if(!isLand){
        if(simState.planet?.oceanEnabled===false)continue;
        // Deep Ocean is now an actual map/sphere terrain class instead of only
        // being used as limb shading. Near coasts use Ocean; sufficiently deep
        // water (plus a little broad variation) uses Deep Ocean.
        const depth=threshold-centerField;
        const deep=depth>.105||planetSmooth(midLat*4.15,midLon*4.15,simState.planet.seed+733)>.76;
        const color=deep?(simState.planet?.oceanColor2||'#102f58'):(simState.planet?.oceanColor||'#315f9f');
        planetTerrainCache.push({lat0,lat1,lon0,lon1,midLat,midLon,color,ocean:true,deepOcean:deep});
        continue;
      }

      const p0=simState.planet?.landColor||'#5d8f5a',p1=simState.planet?.landColor2||'#78915b',p2=simState.planet?.landColor3||'#8d8655';
      // v28.7am: no legacy/hidden biome accents at all. The renderer and loader
      // share exactly the three user-visible terrestrial palette colors.
      const color=n>.69?p2:moist>.56?p1:p0;
      planetTerrainCache.push({lat0,lat1,lon0,lon1,midLat,midLon,color,ocean:false});
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
      simState.planet.paletteSaved=!!simState.planetOverride.paletteSaved;
    simState.planet.landColor4=simState.planetOverride.landColor4;
      simState.planet.landColor4=simState.planetOverride.landColor4;
      simState.planet.oceanColor=simState.planetOverride.oceanColor;
      simState.planet.oceanColor2=simState.planetOverride.oceanColor2;
      simState.planet.skyColor=simState.planetOverride.skyColor||'#8fc8ee';
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

  const seed=Number.isFinite(+simState.planetOverride?.seed)?+simState.planetOverride.seed:Math.floor(Math.random()*1e9);
  const name=simState.planetOverride?.name||v16WorldName();
  const continentCount=3+(Math.abs(Math.floor(seed))%4);
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
    simState.planet.paletteSaved=!!simState.planetOverride.paletteSaved;
    simState.planet.landColor4=simState.planetOverride.landColor4;
    simState.planet.oceanColor=simState.planetOverride.oceanColor;
    simState.planet.oceanColor2=simState.planetOverride.oceanColor2;
    simState.planet.skyColor=simState.planetOverride.skyColor||'#8fc8ee';
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
  eraserMode:'object',selection:null,selectedCommands:[],hover:null,
  undoStack:[],redoStack:[],
  importImageCache:new Map(),expanded:false,
  shiftBrushAxis:null,shiftBrushLastRaw:null,shiftBrushLastPoint:null
};
function megaBlockinessValue(){
  // Kept as the stored command property for backwards compatibility, but in
  // V23.2i this value controls EDGE SHARPNESS only. It no longer changes the
  // geometry or quantizes a line onto a staircase.
  return Math.max(0,Math.min(100,+$('eMegaBlockiness')?.value||0))
}
function megaSnapEnabled(){return !!$('eMegaSnapGrid')?.checked}
function megaSnapGridValue(){return Math.max(4,Math.min(96,+$('eMegaSnapGridSize')?.value||24))}
function snapMegaPoint(pt){
  if(!pt||!megaSnapEnabled())return pt;
  const g=megaSnapGridValue();
  return {
    x:Math.max(0,Math.min(1,Math.round(pt.x*768/g)*g/768)),
    y:Math.max(0,Math.min(1,Math.round(pt.y*384/g)*g/384))
  }
}
function megaCircleFromCenter(){
  return !!$('eMegaCircleCenter')?.checked
}
function constrainMegaAxisPoint(start,pt){
  if(!start||!pt)return pt;
  // Compare in canonical painter pixels, not normalized units. The painter is
  // 2:1, so this keeps Shift behavior visually 90 degrees in every UI size.
  const dx=Math.abs(pt.x-start.x)*768,dy=Math.abs(pt.y-start.y)*384;
  return dx>=dy?{x:pt.x,y:start.y}:{x:start.x,y:pt.y}
}
function resetMegaShiftBrush(){
  megaPainterState.shiftBrushAxis=null;
  megaPainterState.shiftBrushLastRaw=null;
  megaPainterState.shiftBrushLastPoint=null
}
function orthogonalMegaBrushPoint(raw){
  const lastRaw=megaPainterState.shiftBrushLastRaw||megaPainterState.start||raw;
  const lastPoint=megaPainterState.shiftBrushLastPoint||megaPainterState.start||raw;
  const dx=(raw.x-lastRaw.x)*768,dy=(raw.y-lastRaw.y)*384;
  const ax=Math.abs(dx),ay=Math.abs(dy);

  let axis=megaPainterState.shiftBrushAxis;
  if(!axis)axis=ax>=ay?'x':'y';
  else if(axis==='x'&&ay>ax*1.35&&ay>1.5)axis='y';
  else if(axis==='y'&&ax>ay*1.35&&ax>1.5)axis='x';

  let out=axis==='x'?{x:raw.x,y:lastPoint.y}:{x:lastPoint.x,y:raw.y};
  if(megaSnapEnabled())out=snapMegaPoint(out);

  megaPainterState.shiftBrushAxis=axis;
  megaPainterState.shiftBrushLastRaw=raw;
  megaPainterState.shiftBrushLastPoint=out;
  return out
}

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
  return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/Math.max(1,r.width))),y:Math.max(0,Math.min(1,(e.clientY-r.top)/Math.max(1,r.height)))}
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
  const block=Math.max(0,Math.min(100,Number(cmd.blockiness)||0));
  ctx.save();
  const tone=heightMode
    ?(()=>{const v=Math.max(-100,Math.min(100,cmd.height||0)),g=Math.round(128+v*1.27);return `rgb(${g},${g},${g})`})()
    :(cmd.color||'#6fdcff');
  ctx.strokeStyle=tone;ctx.fillStyle=tone;ctx.lineWidth=Math.max(1,cmd.width||4);
  // Edge Sharpness affects only stroke styling, never authored geometry.
  const shape=Math.max(0,Math.min(100,Number(cmd.brushShape??50)));ctx.lineCap=(cmd.type==='brush'&&shape>=60)||block>=55?'square':'round';
  ctx.lineJoin=block>=75?'miter':block>=35?'bevel':'round';
  ctx.miterLimit=2+block/10;
  if(cmd.type==='brush'){
    const pts=cmd.points||[];if(pts.length){ctx.beginPath();let a=P(pts[0]);ctx.moveTo(a.x,a.y);for(const q of pts.slice(1)){a=P(q);ctx.lineTo(a.x,a.y)}ctx.stroke()}
  }else if(cmd.type==='line'){
    const a=P(cmd.a),b=P(cmd.b);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()
  }else if(cmd.type==='circle'){
    const a=P(cmd.a),b=P(cmd.b);ctx.beginPath();
    if(cmd.centerMode){
      ctx.ellipse(a.x,a.y,Math.max(1,Math.abs(b.x-a.x)),Math.max(1,Math.abs(b.y-a.y)),0,0,Math.PI*2)
    }else{
      ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.max(1,Math.abs(b.x-a.x)/2),Math.max(1,Math.abs(b.y-a.y)/2),0,0,Math.PI*2)
    }
    ctx.stroke()
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
  const block=Math.max(0,Math.min(100,Number(cmd.blockiness)||0));

  ctx.save();
  ctx.strokeStyle='#fff';
  ctx.fillStyle='#fff';
  ctx.lineWidth=1;
  const shape=Math.max(0,Math.min(100,Number(cmd.brushShape??50)));ctx.lineCap=(cmd.type==='brush'&&shape>=60)||block>=55?'square':'round';
  ctx.lineJoin=block>=75?'miter':block>=35?'bevel':'round';

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
    if(cmd.centerMode){
      ctx.ellipse(
        a.x,a.y,
        Math.max(.5,Math.abs(b.x-a.x)),
        Math.max(.5,Math.abs(b.y-a.y)),
        0,0,Math.PI*2
      )
    }else{
      ctx.ellipse(
        (a.x+b.x)/2,(a.y+b.y)/2,
        Math.max(.5,Math.abs(b.x-a.x)/2),
        Math.max(.5,Math.abs(b.y-a.y)/2),
        0,0,Math.PI*2
      )
    }
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
function megaGuideDisplayMetrics(canvas){
  const rect=canvas.getBoundingClientRect();
  const sx=rect.width/Math.max(1,canvas.width);
  const sy=rect.height/Math.max(1,canvas.height);

  return{
    rect,
    sx:Math.max(.0001,sx),
    sy:Math.max(.0001,sy),
    // Convert a desired DISPLAY-pixel radius into canvas X/Y radii.
    canvasRadius(displayRadius){
      return{
        rx:displayRadius/Math.max(.0001,sx),
        ry:displayRadius/Math.max(.0001,sy)
      }
    }
  }
}

function megaGuideScreenCircle(ctx,cx,cy,displayRadius,metrics){
  const {rx,ry}=metrics.canvasRadius(displayRadius);
  ctx.beginPath();
  ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
}

function renderMegaPlanetGuide(){
  const c=$('megaPlanetGuide');if(!c)return;
  const ctx=c.getContext('2d'),w=c.width,h=c.height;
  const metrics=megaGuideDisplayMetrics(c);
  ctx.clearRect(0,0,w,h);

  // New, unsaved megastructures have no editingId yet.
  // The selected editor mode is authoritative for showing the guide.
  const n=editingId?byId(editingId):null;
  const mode=megaEditorMode || n?.megaEditorMode || (n?.createdMegastructure?'separate':null);
  if(!mode)return;

  // ATTACHED — exact old V19.7 Planet Surface Guide.
  if(mode==='attached'){
    const cx=w/2,cy=h/2;
    const displayR=Math.min(metrics.rect.height*.43,metrics.rect.width*.23);
    const {rx:Rrx,ry:Rry}=metrics.canvasRadius(displayR);
    const R=Math.min(Rrx,Rry);

    const g=ctx.createRadialGradient(cx-Rrx*.35,cy-Rry*.38,R*.08,cx,cy,R);
    g.addColorStop(0,'rgba(150,205,235,.34)');
    g.addColorStop(.55,'rgba(62,112,150,.22)');
    g.addColorStop(1,'rgba(8,18,30,.12)');
    ctx.fillStyle=g;
    megaGuideScreenCircle(ctx,cx,cy,displayR,metrics);ctx.fill();

    ctx.save();
    megaGuideScreenCircle(ctx,cx,cy,displayR,metrics);ctx.clip();
    ctx.strokeStyle='rgba(180,225,245,.16)';
    ctx.lineWidth=1;

    for(let i=-3;i<=3;i++){
      const yy=cy+i*Rry/4;
      const dy=(yy-cy)/Math.max(.0001,Rry);
      const rx=Rrx*Math.sqrt(Math.max(0,1-dy*dy));
      ctx.beginPath();
      ctx.ellipse(cx,yy,rx,Rry*.055,0,0,Math.PI*2);
      ctx.stroke()
    }

    for(let i=-3;i<=3;i++){
      ctx.beginPath();
      ctx.ellipse(cx,cy,Rrx*Math.cos(i*.18),Rry,0,0,Math.PI*2);
      ctx.stroke()
    }
    ctx.restore();

    ctx.strokeStyle='rgba(195,235,250,.55)';
    ctx.lineWidth=1.5;
    megaGuideScreenCircle(ctx,cx,cy,displayR,metrics);ctx.stroke();

    // If editing an existing mega, show linked planet name when available.
    const hostPlanet=n?ofType('place').find(p=>
      String(p.placeScale||inferPlaceScale(p.placeType))==='planet' &&
      graphNodesLinked(n.id,p.id)
    ):null;

    ctx.fillStyle='rgba(205,238,250,.8)';
    ctx.font='11px sans-serif';
    ctx.textAlign='center';
    ctx.fillText(hostPlanet?`PLANET SURFACE GUIDE · ${hostPlanet.name}`:'PLANET SURFACE GUIDE',cx,cy+Rry+20);
    return
  }

  // SEPARATE — relative-size guide must also work before the node is saved.
  if(mode==='separate'){
    const megaDiam=Math.max(.05,+value('eCreatedMegaSize')||1);

    // Calculate sizes in DISPLAY pixels, then compensate X/Y independently.
    // This guarantees a sphere-like circular guide on screen.
    const usableDisplay=Math.min(metrics.rect.width*.82,metrics.rect.height*.78);
    const planetDisplayD=Math.max(18,Math.min(usableDisplay,usableDisplay/megaDiam));
    const megaDisplayD=Math.max(18,Math.min(usableDisplay,planetDisplayD*megaDiam));

    const planetR=metrics.canvasRadius(planetDisplayD/2);
    const megaR=metrics.canvasRadius(megaDisplayD/2);

    ctx.save();
    ctx.setLineDash([7,5]);
    ctx.lineWidth=1.5;
    ctx.strokeStyle='rgba(120,190,235,.82)';
    ctx.fillStyle='rgba(70,135,180,.10)';
    ctx.beginPath();
    ctx.ellipse(w/2,h/2,planetR.rx,planetR.ry,0,0,Math.PI*2);
    ctx.fill();
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle='rgba(180,220,245,.92)';
    ctx.font='12px system-ui';
    ctx.textAlign='center';
    ctx.fillText('Planet · 1× diameter',w/2,Math.max(16,h/2-planetD/2-9));

    ctx.strokeStyle='rgba(245,220,145,.82)';
    ctx.setLineDash([3,4]);
    ctx.beginPath();ctx.ellipse(w/2,h/2,megaR.rx,megaR.ry,0,0,Math.PI*2);ctx.stroke();

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

    if(preview){ctx.save();ctx.globalAlpha=.42;drawMegaVectorCommand(ctx,preview,w,h,true);ctx.restore()}
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

    if(preview){ctx.save();ctx.globalAlpha=.42;drawMegaVectorCommand(ctx,preview,w,h,false);ctx.restore()};
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
  // Selection + pre-paint ghost are visual only.
  if(megaPainterState.selection){ctx.save();ctx.fillStyle='rgba(93,201,255,.12)';ctx.strokeStyle='rgba(130,225,255,.9)';ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.beginPath();const sel=megaPainterState.selection;if(sel.mode==='rect'){const a=sel.a,b=sel.b;ctx.rect(Math.min(a.x,b.x)*w,Math.min(a.y,b.y)*h,Math.abs(b.x-a.x)*w,Math.abs(b.y-a.y)*h)}else if(sel.points?.length){ctx.moveTo(sel.points[0].x*w,sel.points[0].y*h);for(const p of sel.points.slice(1))ctx.lineTo(p.x*w,p.y*h);ctx.closePath()}ctx.fill();ctx.stroke();ctx.restore()}
  if(megaPainterState.hover&&['brush','eraser'].includes(megaPainterState.tool)&&!megaPainterState.drawing){const p=megaPainterState.hover,width=+$('eMegaPaintWidth')?.value||8,shape=+$('eMegaBrushShape')?.value||50;ctx.save();ctx.globalAlpha=.42;ctx.fillStyle=megaPainterState.tool==='eraser'?'#ff8f8f':($('eMegaPaintColor')?.value||'#6fdcff');const x=p.x*w,y=p.y*h;ctx.beginPath();if(shape<50)ctx.arc(x,y,width/2,0,Math.PI*2);else ctx.rect(x-width/2,y-width/2,width,width);ctx.fill();ctx.restore()}
  renderMegaIconPreview();
  renderMegaPlanetGuide();
  updateMegaDominantDebugPanel();

  
}
function updateMegaPainterToolUI(){
  const tool=megaPainterState.tool;
  document.querySelectorAll('[data-mega-tools]').forEach(el=>{const tools=el.dataset.megaTools.split(',');el.classList.toggle('tool-option-hidden',!tools.includes(tool))});
  if($('eMegaPaintWidthOut'))$('eMegaPaintWidthOut').textContent=`${+$('eMegaPaintWidth')?.value||8} px`;if($('eMegaBrushShapeOut'))$('eMegaBrushShapeOut').textContent=`${+$('eMegaBrushShape')?.value||50}%`;
}
function setMegaPaintTool(tool){
  megaPainterState.tool=tool;resetMegaShiftBrush();if(tool!=='select'){megaPainterState.selection=null;megaPainterState.selectedCommands=[]}
  document.querySelectorAll('.mega-paint-tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));updateMegaPainterToolUI()
}
function setMegaPaintMode(mode){
  megaPainterState.mode=mode;
  const height=mode==='height';
  $('eMegaHeightMode').classList.toggle('active',height);
  $('megaHeightSettings').classList.toggle('hidden',!height);
  renderMegaPainter()
}
function megaPainterData(){
  // Saving is always generated from the canonical texture space, never from
  // the current DOM/CSS size or expanded-painter position.
  const solid=renderMegaSolidTexture(768,384),height=renderMegaHeightTexture(768,384);
  return {
    commands:deepCloneState(megaPainterState.commands),
    heightCommands:deepCloneState(megaPainterState.heightCommands),
    imports:deepCloneState(megaPainterState.imports),
    paintFill:megaPainterState.paintFill,
    heightFill:megaPainterState.heightFill,
    planetRelativeMapping:true,
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
  const painter=document.querySelector('.mega-painter');
  const backdrop=$('megaPainterBackdrop');
  if(!painter||!backdrop)return;

  bindMegaPainterBackdrop();

  const expand=force===null
    ?!painter.classList.contains('expanded')
    :!!force;

  if(expand){
    if(!megaPainterHome){
      megaPainterHome={parent:painter.parentNode,next:painter.nextSibling}
    }

    document.body.appendChild(backdrop);
    document.body.appendChild(painter);

    backdrop.classList.remove('hidden');
    painter.classList.add('expanded');
    document.body.classList.add('mega-painter-open');

    setTimeout(()=>{
      requestCleanMegaFit();
      renderMegaPainter();
      renderMegaPlanetGuide()
    },30)
  }else{
    backdrop.classList.add('hidden');
    painter.classList.remove('expanded');
    document.body.classList.remove('mega-painter-open');

    const stage=painter.querySelector('.mega-paint-stage');
    if(stage){
      stage.style.removeProperty('width');
      stage.style.removeProperty('height')
    }

    if(megaPainterHome?.parent){
      if(
        megaPainterHome.next &&
        megaPainterHome.next.parentNode===megaPainterHome.parent
      ){
        megaPainterHome.parent.insertBefore(painter,megaPainterHome.next)
      }else{
        megaPainterHome.parent.appendChild(painter)
      }
    }

    setTimeout(()=>{
      renderMegaPainter();
      renderMegaPlanetGuide()
    },0)
  }
}
function megaCommandDistance(cmd,p){
  const seg=(p,a,b)=>{if(!a||!b)return Infinity;const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y,l2=vx*vx+vy*vy||1,t=Math.max(0,Math.min(1,(wx*vx+wy*vy)/l2));return Math.hypot(p.x-(a.x+t*vx),p.y-(a.y+t*vy))};
  if(cmd.type==='brush'||cmd.type==='pixelErase'){const pts=cmd.points||[];let best=Infinity;for(let i=1;i<pts.length;i++)best=Math.min(best,seg(p,pts[i-1],pts[i]));if(pts.length===1)best=Math.hypot(p.x-pts[0].x,p.y-pts[0].y);return best}
  if(cmd.type==='line')return seg(p,cmd.a,cmd.b);
  if(cmd.type==='rect'){const a=cmd.a,b=cmd.b;return Math.min(seg(p,{x:a.x,y:a.y},{x:b.x,y:a.y}),seg(p,{x:b.x,y:a.y},{x:b.x,y:b.y}),seg(p,{x:b.x,y:b.y},{x:a.x,y:b.y}),seg(p,{x:a.x,y:b.y},{x:a.x,y:a.y}))}
  if(cmd.type==='circle'){const cx=cmd.centerMode?cmd.a.x:(cmd.a.x+cmd.b.x)/2,cy=cmd.centerMode?cmd.a.y:(cmd.a.y+cmd.b.y)/2,rx=(cmd.centerMode?Math.abs(cmd.b.x-cmd.a.x):Math.abs(cmd.b.x-cmd.a.x)/2)||.001,ry=(cmd.centerMode?Math.abs(cmd.b.y-cmd.a.y):Math.abs(cmd.b.y-cmd.a.y)/2)||.001;return Math.abs(Math.sqrt(((p.x-cx)/rx)**2+((p.y-cy)/ry)**2)-1)*Math.min(rx,ry)}
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
// ===================== V23.2f CLEAN EXPANDED PAINTER =====================
function fitCleanExpandedMegaPainter(){
  const painter=document.querySelector('body > .mega-painter.expanded');
  const workspace=painter?.querySelector('.mega-paint-workspace');
  const stage=painter?.querySelector('.mega-paint-stage');
  const preview=painter?.querySelector('.mega-icon-preview-wrap');
  if(!painter||!workspace||!stage)return;

  const wr=workspace.getBoundingClientRect();
  const pr=preview?.getBoundingClientRect();
  // Measure the ACTUAL first grid column instead of reconstructing it from
  // nominal widths. Reparenting into the expanded overlay can introduce
  // fractional layout values; using the real column edge prevents the slight
  // display/bake alignment drift that showed up after expansion.
  const columnRight=pr&&pr.width?pr.left-12:wr.right;
  const availableW=Math.max(160,columnRight-wr.left);
  const availableH=Math.max(80,wr.height);

  let width=Math.min(availableW,availableH*2);
  let height=width/2;
  if(height>availableH){height=availableH;width=height*2}

  // Keep fractional CSS pixels. Flooring only one dimension can subtly break
  // the exact 2:1 display transform on high-DPI/fractional layouts.
  stage.style.width=`${width}px`;
  stage.style.height=`${height}px`;
  renderMegaPlanetGuide()
}

let cleanMegaFitRAF=0;
function requestCleanMegaFit(){
  cancelAnimationFrame(cleanMegaFitRAF);
  cleanMegaFitRAF=requestAnimationFrame(fitCleanExpandedMegaPainter)
}

window.addEventListener('resize',requestCleanMegaFit);

function megaSelectionSamplePoints(cmd){if(!cmd)return[];if(cmd.points)return cmd.points;if(cmd.a&&cmd.b)return[cmd.a,cmd.b,{x:(cmd.a.x+cmd.b.x)/2,y:(cmd.a.y+cmd.b.y)/2}];if(cmd.at)return[cmd.at];return[]}
function megaSelectionContainsPoint(sel,p){if(!sel||!p)return false;if(sel.mode==='rect'){const x0=Math.min(sel.a.x,sel.b.x),x1=Math.max(sel.a.x,sel.b.x),y0=Math.min(sel.a.y,sel.b.y),y1=Math.max(sel.a.y,sel.b.y);return p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1}return pointInPoly(p.x,p.y,sel.points||[])}
function finalizeMegaSelection(){const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands,sel=megaPainterState.selection;megaPainterState.selectedCommands=collection.filter(cmd=>megaSelectionSamplePoints(cmd).some(p=>megaSelectionContainsPoint(sel,p)))}
function deleteMegaSelection(){if(!megaPainterState.selectedCommands?.length)return;pushMegaPainterHistory();const chosen=new Set(megaPainterState.selectedCommands),key=megaPainterState.mode==='height'?'heightCommands':'commands';megaPainterState[key]=megaPainterState[key].filter(x=>!chosen.has(x));megaPainterState.selectedCommands=[];megaPainterState.selection=null;renderMegaPainter()}
function bindMegaPainter(){
  const c=megaPaintCanvas();if(!c||c.dataset.bound)return;c.dataset.bound='1';
  document.querySelectorAll('.mega-paint-tool').forEach(b=>b.addEventListener('click',()=>setMegaPaintTool(b.dataset.tool)));
  $('eMegaPaintWidth')?.addEventListener('input',updateMegaPainterToolUI);$('eMegaBrushShape')?.addEventListener('input',()=>{if($('eMegaBrushShapeOut'))$('eMegaBrushShapeOut').textContent=`${+$('eMegaBrushShape').value||50}%`;renderMegaPainter()});$('eMegaDeleteSelection')?.addEventListener('click',deleteMegaSelection);updateMegaPainterToolUI();
  syncMegaEraserModeButton();
  $('eMegaEraserMode').addEventListener('click',()=>{megaPainterState.eraserMode=megaPainterState.eraserMode==='object'?'pixel':'object';syncMegaEraserModeButton()});
  $('eMegaPaintUndo').addEventListener('click',megaPainterUndo);
  $('eMegaPaintRedo').addEventListener('click',megaPainterRedo);
  $('eMegaImportButton').addEventListener('click',()=>$('eMegaImport').click());
  $('eMegaHeightMode').addEventListener('click',()=>setMegaPaintMode(megaPainterState.mode==='height'?'paint':'height'));
  $('eMegaExpandPaint').addEventListener('click',()=>toggleMegaPainterExpanded());
  $('eMegaExpandedClose')?.addEventListener('click',()=>toggleMegaPainterExpanded(false));
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
  $('eMegaBlockiness')?.addEventListener('input',()=>{
    const v=megaBlockinessValue();$('eMegaBlockinessOut').textContent=v+'%'
  });
  const syncMegaSnapUI=()=>{
    const on=megaSnapEnabled(),wrap=$('eMegaSnapGridSizeWrap');
    wrap?.classList.toggle('is-disabled',!on);
    const out=$('eMegaSnapGridSizeOut');if(out)out.textContent=megaSnapGridValue()+'px'
  };
  $('eMegaSnapGrid')?.addEventListener('change',()=>{syncMegaSnapUI();renderMegaPainter()});
  $('eMegaSnapGridSize')?.addEventListener('input',syncMegaSnapUI);
  syncMegaSnapUI();
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
    const pt=megaPaintPoint(e);megaPainterState.hover=pt;
    if(megaPainterState.tool==='select'){megaPainterState.drawing=true;const mode=$('eMegaSelectMode')?.value||'rect';megaPainterState.selection={mode,a:pt,b:pt,points:[pt]};megaPainterState.selectedCommands=[];c.setPointerCapture(e.pointerId);renderMegaPainter();return}
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

    const drawPt=snapMegaPoint(pt);
    megaPainterState.drawing=true;megaPainterState.start=drawPt;megaPainterState.current=drawPt;
    resetMegaShiftBrush();
    megaPainterState.shiftBrushLastRaw=pt;
    megaPainterState.shiftBrushLastPoint=drawPt;
    const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
    const base={color:$('eMegaPaintColor').value,width:+$('eMegaPaintWidth').value||8,height:+$('eMegaHeight').value||0,blockiness:megaBlockinessValue(),snapGrid:megaSnapEnabled()?megaSnapGridValue():0,centerMode:megaCircleFromCenter(),brushShape:+$('eMegaBrushShape')?.value||50};
    if(megaPainterState.tool==='brush')collection.push({type:'brush',points:[drawPt],...base});
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
    const rawPt=megaPaintPoint(e);megaPainterState.hover=rawPt;if(!megaPainterState.drawing){renderMegaPainter();return}
    if(megaPainterState.tool==='select'){if(megaPainterState.selection?.mode==='lasso')megaPainterState.selection.points.push(rawPt);else megaPainterState.selection.b=rawPt;renderMegaPainter();return}

    let pt=rawPt;
    if(megaPainterState.tool==='brush'){
      if(e.shiftKey)pt=orthogonalMegaBrushPoint(rawPt);
      else{
        // Releasing Shift starts a fresh freehand segment cleanly.
        resetMegaShiftBrush();
        megaPainterState.shiftBrushLastRaw=rawPt;
        pt=snapMegaPoint(rawPt);
        megaPainterState.shiftBrushLastPoint=pt
      }
    }else{
      if(e.shiftKey&&megaPainterState.tool==='line')pt=constrainMegaAxisPoint(megaPainterState.start,rawPt);
      pt=snapMegaPoint(pt)
    }
    megaPainterState.current=pt;
    if(megaPainterState.activeImport){
      megaPainterState.activeImport.x=Math.max(0,Math.min(1,pt.x));megaPainterState.activeImport.y=Math.max(0,Math.min(1,pt.y));renderMegaPainter();return
    }
    const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
    if(megaPainterState.tool==='brush'||(megaPainterState.tool==='eraser'&&megaPainterState.eraserMode==='pixel')){collection.at(-1)?.points?.push(pt);renderMegaPainter()}
    else if(['line','circle','rect'].includes(megaPainterState.tool)){
      renderMegaPainter({type:megaPainterState.tool,a:megaPainterState.start,b:pt,color:$('eMegaPaintColor').value,width:+$('eMegaPaintWidth').value||8,height:+$('eMegaHeight').value||0,blockiness:megaBlockinessValue(),snapGrid:megaSnapEnabled()?megaSnapGridValue():0,centerMode:megaCircleFromCenter(),brushShape:+$('eMegaBrushShape')?.value||50})
    }
  });
  const finish=e=>{
    if(!megaPainterState.drawing)return;
    const rawPt=megaPaintPoint(e);
    if(megaPainterState.tool==='select'){if(megaPainterState.selection?.mode==='rect')megaPainterState.selection.b=rawPt;megaPainterState.drawing=false;finalizeMegaSelection();renderMegaPainter();return}
    let pt=rawPt;
    if(megaPainterState.tool==='brush'){
      if(e.shiftKey)pt=orthogonalMegaBrushPoint(rawPt);
      else pt=snapMegaPoint(rawPt)
    }else{
      if(e.shiftKey&&megaPainterState.tool==='line')pt=constrainMegaAxisPoint(megaPainterState.start,rawPt);
      pt=snapMegaPoint(pt)
    }
    const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
    if(!megaPainterState.activeImport&&['line','circle','rect'].includes(megaPainterState.tool)){
      collection.push({type:megaPainterState.tool,a:megaPainterState.start,b:pt,color:$('eMegaPaintColor').value,width:+$('eMegaPaintWidth').value||8,height:+$('eMegaHeight').value||0,blockiness:megaBlockinessValue(),snapGrid:megaSnapEnabled()?megaSnapGridValue():0,centerMode:megaCircleFromCenter(),brushShape:+$('eMegaBrushShape')?.value||50})
    }
    megaPainterState.drawing=false;megaPainterState.start=null;megaPainterState.current=null;resetMegaShiftBrush();renderMegaPainter()
  };
  c.addEventListener('pointerup',finish);c.addEventListener('pointercancel',finish);c.addEventListener('pointerleave',()=>{if(!megaPainterState.drawing){megaPainterState.hover=null;renderMegaPainter()}})
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
// V24 — Planet-relative paint coordinates.
// The old painter used linear longitude/latitude UVs. That makes authored
// widths look progressively larger/smaller once projected onto a sphere.
// This mapping keeps painter size proportional to the planet's projected
// diameter: a feature occupying 25% of the guide occupies ~25% of the globe
// when it faces the camera, regardless of painter CSS stretching.
function megaPlanetRelativeUV(u,v){
  const lon=(u-.5)*Math.PI*2;
  const lat=(.5-v)*Math.PI;
  let q;
  if(lon< -Math.PI/2)q=-2-Math.sin(lon);
  else if(lon>Math.PI/2)q=2-Math.sin(lon);
  else q=Math.sin(lon);
  return{
    u:Math.max(0,Math.min(1,.5+.25*q)),
    v:Math.max(0,Math.min(1,.5-.5*Math.sin(lat)))
  }
}
function megaSurfaceTexturePixel(mega,dataUrl,u,v){
  if(!dataUrl)return null;
  const mapped=megaPlanetRelativeUV(u,v);
  return megaTexturePixel(dataUrl,mapped.u,mapped.v)
}
function megaHeightAtUV(mega,u,v){
  const p=megaSurfaceTexturePixel(mega,mega?.megaPaintData?.heightDataUrl,u,v);if(!p)return 0;
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
  const p=tex?megaSurfaceTexturePixel(mega,tex,u,v):null;

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

      const paint=tex?megaSurfaceTexturePixel(mega,tex,u,v):null;
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
      const c0=megaSurfaceTexturePixel(mega,tex,(ix+.5)/cols,vm);

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
        const c=megaSurfaceTexturePixel(mega,tex,(end+.5)/cols,vm);
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
    const rr=Math.sqrt(seededUnit(seed,i,227))*R*.92;
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
    const color=megaSurfaceTexturePixel(mega,tex,u,v);
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

    const authored=v287yLandscapeTileForPlanet(activeSurfacePlanetNode(),cell.midLat,cell.midLon);ctx.fillStyle=authored?.color||cell.color;
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
  return ofType('place').find(p=>p.name===name&&(p.gasGiant||String(p.placeScale||inferPlaceScale(p.placeType))==='planet'))||null;
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


/* ============================ V27 PLANET SURFACE ZOOM ============================ */
let surfaceView={active:false,lat:0,lon:0,biome:'green-landscape',sky:'#8ec8ef',ground:'#5f8a49',gas:false,cameraX:0,cameraZ:0,zoom:1,yaw:0,pitch:.30,dragPlaceId:null,dragStructureKey:null,focusPlaceId:null,lastRightDown:0,captions:true,tool:'move'};
function inversePlanetScreenPoint(canvas,clientX,clientY){const r=canvas.getBoundingClientRect(),w=r.width,h=r.height,R=Math.min(w,h)*.39*planetView.zoom,zz=(clientX-r.left-w/2-planetView.panX)/R,yy=-(clientY-r.top-h/2-planetView.panY)/R;if(zz*zz+yy*yy>1)return null;let x=Math.sqrt(Math.max(0,1-zz*zz-yy*yy)),y=yy,z=zz;const cp=Math.cos(planetView.pitch),sp=Math.sin(planetView.pitch);[x,y]=[x*cp+y*sp,-x*sp+y*cp];const cy=Math.cos(planetView.yaw),sy=Math.sin(planetView.yaw);[x,z]=[x*cy+z*sy,-x*sy+z*cy];return{lat:Math.asin(Math.max(-1,Math.min(1,y))),lon:Math.atan2(z,x)}}
function v271ParseHex(hex){const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||''));if(!m)return null;const n=parseInt(m[1],16);return{r:(n>>16)&255,g:(n>>8)&255,b:n&255}}
function v271HexMix(a,b,t=.5){const A=v271ParseHex(a)||{r:80,g:120,b:80},B=v271ParseHex(b)||A;return`#${[A.r+(B.r-A.r)*t,A.g+(B.g-A.g)*t,A.b+(B.b-A.b)*t].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('')}`}
function planetTerrainColorAt(lat,lon){const twopi=Math.PI*2,L=((lon+Math.PI)%twopi+twopi)%twopi-Math.PI;const cell=(planetTerrainCache||[]).find(c=>lat>=c.lat0&&lat<=c.lat1&&L>=c.lon0&&L<=c.lon1);return cell?.color||null}
function surfaceFromPlanetPoint(lat,lon){const p=simState.planet||{},active=activeSurfacePlanetNode(),custom=v287yLandscapeTileForPlanet(active,lat,lon),sample=custom?.color||planetTerrainColorAt(lat,lon),landRule=v287zLandscapeRuleForSurface(active,sample),authoredSky=landRule?.skyColor||active?.planetSkyColor||p.skyColor||'#8fc8ee';if(custom?.type==='lava'||custom?.type==='bright-lava')return{lat,lon,biome:'lava-landscape',ground:custom.color||'#cf4b18',sky:authoredSky,gas:false,sampledColor:custom.color};if(p.gasGiant){const gas=sample||p.gasColor||'#d6b783';return{lat,lon,biome:'gas-atmosphere',ground:gas,sky:authoredSky,gas:true,sampledColor:gas}}const col=sample||((planetIsLand(lat,lon)?p.landColor:p.oceanColor)||'#5d8f5a'),rgb=v271ParseHex(col)||{r:90,g:130,b:70};let biome;if(rgb.b>rgb.r*1.12&&rgb.b>rgb.g*1.05)biome='ocean-water';else if(rgb.r>rgb.b*1.35&&rgb.g>rgb.b*1.2&&Math.abs(rgb.r-rgb.g)<95)biome='desert';else biome='green-landscape';return{lat,lon,biome,ground:col,sky:authoredSky,gas:false,sampledColor:col}}
function activeSurfacePlanetNode(){try{return activePlanetPlace()}catch{return null}}
function surfacePlaces(){const planet=activeSurfacePlanetNode(),pid=planet?.id;if(!planet)return[];return nodes.filter(n=>n.type==='place'&&!n.isHub&&n.id!==pid&&(n.surfacePlanetId===pid||(countryUsesImplicitPlanet()&&String(n.placeScale||inferPlaceScale(n.placeType))==='country')))}
function v287qSurfaceTool(){return['move','drag','weather'].includes(surfaceView.tool)?surfaceView.tool:'move'}
function v287qWeatherType(){if(surfaceView.gas||surfaceView.biome==='gas-atmosphere')return'storm';if(surfaceView.biome==='desert')return'sandstorm';return'rain'}
function v287qWeatherLabel(type=v287qWeatherType()){return type==='sandstorm'?'Sandstorm':type==='storm'?'Storm':'Rain'}
function ensureSurfaceToolBar(){
  const canvas=$('planetCanvas'),stage=canvas?.parentElement;if(!stage)return null;
  let bar=$('surfaceToolBar');
  if(!bar){
    bar=document.createElement('div');bar.id='surfaceToolBar';bar.className='surface-tool-bar hidden';
    bar.innerHTML=`<button type="button" data-surface-tool="move"><b>✥</b><span>Move</span></button><button type="button" data-surface-tool="drag"><b>↔</b><span>Drag</span></button><button type="button" data-surface-tool="weather"><b>☁</b><span>Weather</span></button><small id="surfaceToolHint"></small>`;
    stage.appendChild(bar);
    bar.querySelectorAll('[data-surface-tool]').forEach(btn=>btn.onclick=()=>{surfaceView.tool=btn.dataset.surfaceTool;v287qSyncSurfaceToolBar();requestPlanetDraw()})
  }
  v287qSyncSurfaceToolBar();return bar
}
function v287qSyncSurfaceToolBar(){
  const bar=$('surfaceToolBar');if(!bar)return;
  const show=surfaceView.active&&['surface','place'].includes(mapDisplayLevel());bar.classList.toggle('hidden',!show);
  const tool=v287qSurfaceTool();bar.querySelectorAll('[data-surface-tool]').forEach(b=>b.classList.toggle('active',b.dataset.surfaceTool===tool));
  const hint=$('surfaceToolHint');if(hint)hint.textContent=tool==='drag'?'Drag · enlarged Structure hitboxes':tool==='weather'?`Weather · ${v287qWeatherLabel()} · click to toggle · weather builds in`:'Move · pan · wheel zoom · right-drag rotate'
}
function v287qHideSurfaceToolBar(){$('surfaceToolBar')?.classList.add('hidden')}
function v287qWeatherContextKey(){
  if(mapDisplayLevel()==='place'){const place=byId(surfaceView.focusPlaceId||scaleNav.selected?.sourceId);return place?`place:${place.id}`:'place:none'}
  return`surface:${v287pSurfacePixelIndex(surfaceView.lat||0,surfaceView.lon||0)}`
}
function v287qWeatherStore(){const planet=activeSurfacePlanetNode();if(!planet)return[];if(!Array.isArray(planet.surfaceWeatherSeeds))planet.surfaceWeatherSeeds=[];return planet.surfaceWeatherSeeds}
function v287qWeatherSeedsForCurrentView(){const key=v287qWeatherContextKey();return v287qWeatherStore().filter(s=>s&&s.contextKey===key)}
function v287qSeedWeatherAt(x,z){
  const planet=activeSurfacePlanetNode();if(!planet)return null;
  const type=v287qWeatherType(),contextKey=v287qWeatherContextKey(),store=v287qWeatherStore(),
        current=store.findLast?.(s=>s?.contextKey===contextKey)||[...store].reverse().find(s=>s?.contextKey===contextKey)||null;

  // Toggle: seeding the same weather again clears weather from this whole area.
  if(current?.type===type){
    for(let i=store.length-1;i>=0;i--)if(store[i]?.contextKey===contextKey)store.splice(i,1);
    save();requestPlanetDraw();
    return{off:true,type,contextKey}
  }

  // Otherwise replace any old weather for this exact Surface pixel / entered Place.
  for(let i=store.length-1;i>=0;i--)if(store[i]?.contextKey===contextKey)store.splice(i,1);

  const seed={
    id:'weather-'+uid(),
    contextKey,
    type,
    intensity:.82,
    seed:Math.floor(Math.random()*1e9),
    startedAt:Date.now()
  };
  store.push(seed);
  save();v287qStartWeatherAnimation();requestPlanetDraw();
  return seed
}
function v287qGroundPointFromClient(canvas,clientX,clientY){
  const target=($('surfaceWebGLCanvas')&&!$('surfaceWebGLCanvas').classList.contains('hidden'))?$('surfaceWebGLCanvas'):canvas;if(!target)return null;
  const world={x:surfaceView.cameraX||0,z:surfaceView.cameraZ||0},B=surface3DGroundScreenBasis(canvas,world);if(!B)return null;
  const {vp}=surface3DCameraMatrices(target),P=surface3DProject([world.x,0,world.z],target,vp);if(!P)return null;
  const tr=target.getBoundingClientRect(),sx=tr.width/target.width,sy=tr.height/target.height,px=tr.left+P.x*sx,py=tr.top+P.y*sy,D=v285SolveScreenBasis(clientX-px,clientY-py,B.ax,B.ay,B.bx,B.by);
  return D?{x:world.x+D.x,z:world.z+D.z}:null
}
function v287tWeatherAgeSeconds(w=v287rActiveWeather()){
  if(!w)return Infinity;
  return Math.max(0,(Date.now()-(Number(w.startedAt)||Date.now()))/1000)
}
function v287tEase01(x){
  x=Math.max(0,Math.min(1,x));
  return x*x*(3-2*x)
}
function v287tWeatherPhase(w=v287rActiveWeather()){
  const age=v287tWeatherAgeSeconds(w),I=Math.max(0,Math.min(1,Number.isFinite(+w?.intensity)?+w.intensity:1));
  if(!w)return{age,sky:0,effect:0,stormSpin:0,lightning:0};
  if(w.type==='rain'){
    return{age,sky:v287tEase01(age/1.8)*I,effect:v287tEase01((age-1.15)/1.35)*I,stormSpin:0,lightning:0}
  }
  if(w.type==='sandstorm'){
    return{age,sky:v287tEase01(age/1.65)*I,effect:v287tEase01((age-.85)/1.55)*I,stormSpin:0,lightning:0}
  }
  return{
    age,
    sky:v287tEase01(age/1.9)*I,
    effect:v287tEase01((age-.7)/2.2)*I,
    stormSpin:v287tEase01((age-.55)/4.5)*I,
    lightning:v287tEase01((age-4.1)/2.2)*I
  }
}
function v287alLandscapeWeatherForCurrentSurface(){
  const planet=activeSurfacePlanetNode(),rule=v287zLandscapeRuleForSurface(planet,surfaceView.sampledColor||surfaceView.ground),w=rule?.weather;
  if(!w||!['rain','storm','sandstorm'].includes(w.type))return null;
  return{id:`landscape-weather:${rule.color}:${w.type}`,contextKey:v287qWeatherContextKey(),type:w.type,intensity:Math.max(0,Math.min(1,Number.isFinite(+w.intensity)?+w.intensity:.82)),seed:Math.floor(v283Hash(`landscape-weather:${planet?.id}:${rule.color}:${w.type}`)*1e9),startedAt:1,authoredLandscape:true,skyColor:v287zNormHex(w.weatherSkyColor)||v287alWeatherDefaultTint(w.type)}
}
function v287rActiveWeather(){
  return v287qWeatherSeedsForCurrentView().at(-1)||v287alLandscapeWeatherForCurrentSurface()||null
}
function v287rWeatherSky(baseSky=surfaceView.sky||'#8fc8ee'){
  const w=v287rActiveWeather();if(!w)return baseSky;
  const phase=v287tWeatherPhase(w),m=phase.sky,custom=v287zNormHex(w.skyColor);
  if(custom)return v271HexMix(baseSky,custom,Math.min(.95,m));
  if(w.type==='rain')return v271HexMix(baseSky,'#56616b',.76*m);
  if(w.type==='sandstorm')return v271HexMix(baseSky,'#c49345',.82*m);
  if(w.type==='storm')return v271HexMix(baseSky,'#242333',.82*m);
  return baseSky
}
function v287rWeatherGround(baseGround=surfaceView.ground||'#5f8a49'){
  const w=v287rActiveWeather();if(!w)return baseGround;
  const phase=v287tWeatherPhase(w),m=phase.sky;
  if(w.type==='rain')return v271HexMix(baseGround,'#34413e',.38*m);
  if(w.type==='sandstorm')return v271HexMix(baseGround,'#a87432',.70*m);
  if(w.type==='storm')return v271HexMix(baseGround,'#343241',.42*m);
  return baseGround
}
function v287qWeatherRand(seed,i){const x=Math.sin((seed||1)*.000013+i*12.9898)*43758.5453;return x-Math.floor(x)}
function v287qDrawWeather(ctx,w,h,projectFn){
  const s=v287rActiveWeather();if(!s)return;
  const t=performance.now()*.001,phase=v287tWeatherPhase(s),skyP=phase.sky,effectP=phase.effect;
  ctx.save();

  if(s.type==='rain'){
    ctx.fillStyle=`rgba(55,62,69,${.22*skyP})`;ctx.fillRect(0,0,w,h);
    ctx.fillStyle=`rgba(35,42,49,${.22*skyP})`;ctx.fillRect(0,0,w,h*.48);
    if(effectP>0){
      ctx.globalAlpha=effectP;ctx.strokeStyle='rgba(184,220,244,.64)';ctx.lineWidth=1.3;
      const rainCount=Math.round(180*effectP);
      for(let i=0;i<rainCount;i++){
        const x=((v287qWeatherRand(s.seed,i)*w+t*78+i*19)%(w+50))-25,
              y=((v287qWeatherRand(s.seed,i+300)*h+t*190+i*27)%(h+50))-25,
              len=9+v287qWeatherRand(s.seed,i+600)*14;
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-4,y+len);ctx.stroke()
      }
      ctx.globalAlpha=1
    }
  }else if(s.type==='sandstorm'){
    const g=ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,`rgba(214,171,91,${.44*skyP})`);
    g.addColorStop(.48,`rgba(193,139,66,${.36*skyP})`);
    g.addColorStop(1,`rgba(160,107,48,${.25*skyP})`);
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    if(effectP>0){
      ctx.globalAlpha=effectP;ctx.strokeStyle='rgba(244,205,130,.48)';ctx.lineWidth=2;
      const sandCount=Math.round(125*effectP);
      for(let i=0;i<sandCount;i++){
        const y=v287qWeatherRand(s.seed,i+90)*h,
              x=((v287qWeatherRand(s.seed,i+450)*w+t*135+i*33)%(w+120))-60,
              len=20+v287qWeatherRand(s.seed,i+800)*52;
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+len,y+2);ctx.stroke()
      }
      ctx.globalAlpha=1
    }
  }else{
    ctx.fillStyle=`rgba(25,23,34,${.30*skyP})`;ctx.fillRect(0,0,w,h);
    const spinP=phase.stormSpin;
    if(spinP>0){
      ctx.globalAlpha=.35+.65*effectP;
      for(let i=0;i<28;i++){
        const y=(i/28)*h+Math.sin(t*(.10+.16*spinP)+i*.8)*9,
              speed=5+spinP*(10+(i%5)*3.2),
              x=((t*speed+i*91)%(w+360))-180;
        ctx.strokeStyle=`rgba(163,157,196,${.045+(i%4)*.016})`;
        ctx.lineWidth=14+(i%6)*4;
        ctx.beginPath();ctx.moveTo(x-220,y);ctx.lineTo(x+270,y+Math.sin(i)*11);ctx.stroke()
      }
      ctx.globalAlpha=1
    }
    if(phase.lightning>0){
      const cadence=Math.max(12,Math.round(26-9*phase.lightning)),
            flash=Math.floor(t*3+(s.seed%19))%cadence===0;
      if(flash){
        ctx.fillStyle=`rgba(228,227,245,${.075+.055*phase.lightning})`;ctx.fillRect(0,0,w,h);
        const lx=w*(.15+.7*v287qWeatherRand(s.seed,901));
        ctx.strokeStyle='rgba(246,245,255,.94)';ctx.shadowColor='rgba(190,185,235,.85)';ctx.shadowBlur=13;ctx.lineWidth=2.4;
        ctx.beginPath();ctx.moveTo(lx,h*.02);ctx.lineTo(lx-20,h*.18);ctx.lineTo(lx+8,h*.29);ctx.lineTo(lx-17,h*.44);ctx.lineTo(lx+3,h*.60);ctx.stroke()
      }
    }
  }
  ctx.restore()
}
let v287qWeatherRAF=0;
function v287qStartWeatherAnimation(){
  if(v287qWeatherRAF)return;
  const tick=()=>{v287qWeatherRAF=0;if(surfaceView.active&&['surface','place'].includes(mapDisplayLevel())&&v287qWeatherSeedsForCurrentView().length){requestPlanetDraw();v287qWeatherRAF=requestAnimationFrame(tick)}};
  v287qWeatherRAF=requestAnimationFrame(tick)
}
function ensureSurfacePanel(){return $('planetViewPanel')}
function enterSurfaceView(lat,lon){
  const sampled=surfaceFromPlanetPoint(lat,lon);
  surfaceView={...surfaceView,...sampled,active:true,cameraX:0,cameraZ:0,zoom:1,yaw:0,pitch:.30,focusPlaceId:null};
  if(mapDisplayLevel()==='planet'){
    scaleNav.path.push({level:'planet',item:{name:simState.planetOverride?.name||simState.planet?.name||'Planet',sourceId:activeSurfacePlanetNode()?.id||null,surfaceLat:lat,surfaceLon:lon}});
  }
  scaleNav.level='surface';
  scaleNav.lastTransitionAt=performance.now();
  refreshWorldMapMode();renderGalacticCoordinates();ensureSurfaceToolBar();v287qStartWeatherAnimation();requestPlanetDraw()
}
function enterPlaceFromSurface(place){
  if(!place)return;
  surfaceView.focusPlaceId=place.id;
  // Once inside a Place, stop using the parent Surface's latitude/longitude offset.
  // Place landscapes are local scenes: terrain, camera, and Structure population all share (0,0).
  surfaceView.cameraX=0;surfaceView.cameraZ=0;surfaceView.zoom=Math.max(1.65,surfaceView.zoom);surfaceView.yaw=0;surfaceView.pitch=.26;
  scaleNav.path.push({level:'surface',item:{name:surfaceView.biome.replaceAll('-',' '),sourceId:activeSurfacePlanetNode()?.id||null,surfaceLat:surfaceView.lat,surfaceLon:surfaceView.lon}});
  scaleNav.level='place';scaleNav.selected={sourceId:place.id,name:place.name};scaleNav.lastTransitionAt=performance.now();
  selected=place;graph.selected=place;showSelection();refreshWorldMapMode();renderGalacticCoordinates();ensureSurfaceToolBar();v287qStartWeatherAnimation();requestPlanetDraw()
}
function exitSurfaceView(){
  if(mapDisplayLevel()==='place'){backScaleLevel();return}
  if(mapDisplayLevel()==='surface'){backScaleLevel();return}
  surfaceView.active=false
}
function surfaceProject(x,z,w,h){const scale=40*surfaceView.zoom,depth=Math.max(.2,1+(z-surfaceView.cameraZ)*.06);return{x:w/2+(x-surfaceView.cameraX)*scale/depth,y:h*.38+(z-surfaceView.cameraZ)*scale*.55/depth,depth,scale:scale/depth}}
function placeSurfaceRelative(place){return{x:((place.surfaceLon??surfaceView.lon)-surfaceView.lon)*28*Math.cos(surfaceView.lat),z:-((place.surfaceLat??surfaceView.lat)-surfaceView.lat)*28}}

function v28ResolvedSceneModel(node){
  if(!node||node.type!=='structure')return normalizeScene3DModel(null);

  // Structures have existed through several save layouts. Resolve all of them
  // before deciding that the Structure has no drawable geometry.
  const candidates=[
    node.structureModel,
    node.structureModel?.model,
    node.model,
    Array.isArray(node.structureParts)?{parts:node.structureParts,repetition:node.structureRepetition}:null,
    Array.isArray(node.parts)?{parts:node.parts,repetition:node.repetition}:null
  ].filter(Boolean);

  for(const raw of candidates){
    try{
      const model=normalizeScene3DModel(raw);
      if(model.variants?.some(v=>Array.isArray(v.parts)&&v.parts.some(part=>part&&!part.hidden)))return model
    }catch(err){
      console.warn('Structure model candidate could not be normalized',node.name||node.id,err)
    }
  }

  const base=node.variantOfStructureId?byId(node.variantOfStructureId):null;
  if(base?.type==='structure'&&base.id!==node.id){
    const inherited=v28ResolvedSceneModel(base);
    if(inherited.variants?.some(v=>Array.isArray(v.parts)&&v.parts.some(part=>part&&!part.hidden)))return inherited
  }

  return normalizeScene3DModel(null)
}
function v287hDrawableStructureModel(node){
  const model=v28ResolvedSceneModel(node);
  return model?.variants?.some(v=>Array.isArray(v.parts)&&v.parts.some(part=>part&&!part.hidden))?model:null
}

function v28SurfaceDrawPart(ctx,part,P,scale,yOffset=0){
  const sx=Math.max(.4,part.sx||2.8)*scale*.52,sy=Math.max(.4,part.sy||3)*scale,sz=Math.max(.4,part.sz||2.8)*scale*.24,c=part.color||'#9aa6b2';
  ctx.save();ctx.translate(P.x,P.y-(Number(yOffset)||0)*scale);ctx.fillStyle=c;
  if(part.kind==='Sphere'||part.kind==='Dome'){ctx.beginPath();ctx.ellipse(0,-sy*.38,sx*.55,Math.max(2,sy*(part.kind==='Dome'?.26:.48)),0,0,Math.PI*2);ctx.fill()}
  else if(part.kind==='Cylinder'||part.kind==='Tower'){ctx.fillRect(-sx*.45,-sy,sx*.9,sy);ctx.beginPath();ctx.ellipse(0,-sy,sx*.45,sz,0,0,Math.PI*2);ctx.fill()}
  else if(part.kind==='Cone'||part.kind==='Tree'){if(part.kind==='Tree'){ctx.fillStyle='#6e5035';ctx.fillRect(-sx*.09,-sy*.55,sx*.18,sy*.55);ctx.fillStyle=c}ctx.beginPath();ctx.moveTo(0,-sy);ctx.lineTo(-sx*.55,0);ctx.lineTo(sx*.55,0);ctx.closePath();ctx.fill()}
  else if(part.kind==='Pyramid'||part.kind==='Rock'){ctx.beginPath();ctx.moveTo(0,-sy);ctx.lineTo(-sx*.55,0);ctx.lineTo(sx*.55,0);ctx.closePath();ctx.fill()}
  else{ctx.fillRect(-sx/2,-sy,sx,sy);ctx.fillStyle='rgba(255,255,255,.16)';ctx.beginPath();ctx.moveTo(-sx/2,-sy);ctx.lineTo(0,-sy-sz);ctx.lineTo(sx/2,-sy);ctx.closePath();ctx.fill()}
  ctx.restore()
}
function v28DrawSceneModelOnSurface(ctx,model,rel,w,h,scaleMul=1,yAlter=0){
  model=normalizeScene3DModel(model);
  const fit=v287jLandscapeModelTransform(model),localScale=Math.max(.035,fit.scale*.43);
  for(const inst of scene3DRepeatInstances(model)){
    for(const part of inst.variant?.parts||[]){
      if(part.hidden)continue;
      const x=rel.x+((Number(inst.ox)||0)+(Number(part.x)||0)-fit.cx)*localScale,
            z=rel.z+((Number(inst.oz)||0)+(Number(part.z)||0)-fit.cz)*localScale,
            P=surfaceProject(x,z,w,h);
      v28SurfaceDrawPart(ctx,part,P,Math.max(5,P.scale*.12*scaleMul*fit.scale/.42),yAlter-fit.minY)
    }
  }
}
function v283Hash(seed){
  let h=2166136261>>>0;for(const ch of String(seed)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0)/4294967295
}
function v283IsCityPlace(place){
  return /\bcity\b/i.test(String(place?.placeIconText||''))||/\bcity\b/i.test(String(place?.placeType||''))
}
function v283PlaceStructurePool(place){
  if(!place||place.placePopulationMode==='none')return[];
  const all=nodes.filter(n=>n.type==='structure'&&!n.isMegastructure),
        ids=new Set(place.placeStructureIds||[]),
        explicit=all.filter(n=>ids.has(n.id));

  // Explicit Place population is authoritative. Do not silently delete a selected
  // Structure here because of model-format/resolution problems; rendering handles it.
  if(explicit.length)return explicit;
  if(place.placePopulationMode==='custom')return[];

  // Automatic city population still prefers Structures that actually have geometry.
  const drawable=all.filter(n=>!!v287hDrawableStructureModel(n));
  return placeHasPlanetIcon(place)&&v283IsCityPlace(place)?drawable:[]
}
function v287pSurfacePixelIndex(lat,lon){
  const rows=32,cols=64,
        r=Math.max(0,Math.min(rows-1,Math.floor(((lat+Math.PI/2)/Math.PI)*rows))),
        twopi=Math.PI*2,
        L=((lon+Math.PI)%twopi+twopi)%twopi-Math.PI,
        c=Math.max(0,Math.min(cols-1,Math.floor(((L+Math.PI)/twopi)*cols)));
  return`${r}:${c}`
}
function v287pPlaceIconOnCurrentSurfacePixel(place){
  return !!place&&placeHasPlanetIcon(place)&&
    v287pSurfacePixelIndex(place.surfaceLat??0,place.surfaceLon??0)===
    v287pSurfacePixelIndex(surfaceView.lat??0,surfaceView.lon??0)
}

function v287nSurfacePopulationSources(){
  const level=mapDisplayLevel();

  if(level==='place'){
    const focused=byId(surfaceView.focusPlaceId||scaleNav.selected?.sourceId);
    return focused&&placeHasPlanetIcon(focused)?[focused]:[]
  }

  if(level!=='surface')return[];

  const planet=activeSurfacePlanetNode();
  if(!planet)return[];

  // Surface-level Structure population belongs primarily to the authored Places
  // on this planet (city, skycity, fortress, etc.). The old v28.7i path incorrectly
  // looked only at the Planet node itself, which is why a perfectly configured
  // SkyCity Place produced "No planet population source".
  const candidates=[
    ...surfacePlaces(),
    ...surfacePlacesForPlanet(planet)
  ];

  const seen=new Set(),sources=[];
  for(const place of candidates){
    if(!place||place.id===planet.id||seen.has(place.id))continue;
    seen.add(place.id);

    // v28.7p hard terrain rule: an authored Place only populates the exact
    // planet-surface pixel carrying its icon. Empty/iconless terrain stays barren.
    if(!v287pPlaceIconOnCurrentSurfacePixel(place))continue;
    if(place.placePopulationMode==='none')continue;

    const explicit=Array.isArray(place.placeStructureIds)&&place.placeStructureIds.length>0;
    const automatic=place.placePopulationMode!=='custom'&&v283PlaceStructurePool(place).length>0;
    if(explicit||automatic)sources.push(place)
  }

  // v28.7x: Planet-scale Places may explicitly allow a selected Structure set
  // to generate on every surface patch. This is opt-in and never overrides the
  // authored icon-local population rules above.
  if(planet.planetStructuresEverywhere&&planet.placePopulationMode!=='none'&&v283PlaceStructurePool(planet).length){
    const tileKey=v287pSurfacePixelIndex(surfaceView.lat??0,surfaceView.lon??0),rule=planet.planetStructureTiles?.[tileKey];
    // __none__ is a hard exclusion; __countryside__ intentionally remains empty wilderness.
    if(rule!=='__none__'&&rule!=='__countryside__')sources.push(planet)
  }

  return sources
}

// Compatibility helper: callers that still expect one source get the first real source.
function v287iLandscapePopulationSource(){
  return v287nSurfacePopulationSources()[0]||null
}

function v287ySurfaceStructurePool(source){
  const base=v283PlaceStructurePool(source);if(source?.id!==activeSurfacePlanetNode()?.id)return base;
  const key=v287pSurfacePixelIndex(surfaceView.lat??0,surfaceView.lon??0),rule=source.planetStructureTiles?.[key];
  if(rule&&rule!=='__auto__'){const exact=base.find(n=>n.id===rule);return exact?[exact]:[]}
  return base
}
function v28SurfaceStructureEntities(){
  const result=[];
  const level=mapDisplayLevel(),
        sources=v287nSurfacePopulationSources();

  if(!sources.length)return result;

  for(const source of sources){
    const pool=v287ySurfaceStructurePool(source);
    if(!pool.length)continue;

    const planetSurfaceMode=level==='surface',
          isPlanetWide=planetSurfaceMode&&source.id===activeSurfacePlanetNode()?.id,
          // Entered Place = local scene at 0,0.
          // Surface authored Place = its actual marker location on this surface patch.
          // Planet-wide wilderness = current patch origin.
          center=level==='place'
            ?{x:0,z:0}
            :isPlanetWide
              ?{x:0,z:0}
              :placeSurfaceRelative(source),
          // v28.7ar: Place population can be intentionally regular or organic.
          // Legacy Places default to Scatter so old saves no longer appear as rigid city grids.
          random=(source.placeStructurePlacement||'scatter')==='scatter',
          density=Math.max(1,Math.min(isPlanetWide?18:80,+source.placeStructureDensity||14)),
          offsets=source.structurePlacementOffsets||{},
          patchSeed=planetSurfaceMode
            ?`${source.id}:surface:${(+surfaceView.lat||0).toFixed(3)}:${(+surfaceView.lon||0).toFixed(3)}`
            :`${source.id}:place`;

    for(let i=0;i<density;i++){
      const node=pool[i%pool.length],
            key=`${source.id}:${node.id}:${planetSurfaceMode?'surface':'place'}:${i}`,
            legacyKey=`${source.id}:${node.id}:${i}`,
            saved=offsets[key]||offsets[legacyKey];

      let ox=0,oz=0;

      if(saved){
        ox=+saved.x||0;
        oz=+saved.z||0
      }else if(random){
        if(i===0){
          ox=0;oz=0
        }else{
          // v28.7o: wider Place population scatter + deterministic anti-clumping.
          // Density 15 now occupies a noticeably broader footprint instead of a tight pile.
          const spreadFactor=Math.max(.25,Math.min(3,(+source.placeStructureSpread||100)/100)),
                spread=Math.min(220,(42+Math.sqrt(density)*5.5)*spreadFactor),
                minGap=Math.max(4,Math.min(30,(spread/(Math.sqrt(density)+2))*.92)),
                occupied=result.filter(e=>e.place?.id===source.id).map(e=>e.rel);
          let best=null,bestGap=-1;
          for(let attempt=0;attempt<18;attempt++){
            const ang=v283Hash(patchSeed+':angle:'+i+':'+attempt)*Math.PI*2,
                  rad=10+Math.sqrt(v283Hash(patchSeed+':radius:'+i+':'+attempt))*spread,
                  cx=Math.cos(ang)*rad,
                  cz=Math.sin(ang)*rad,
                  gap=occupied.length
                    ?Math.min(...occupied.map(q=>Math.hypot((center.x+cx)-q.x,(center.z+cz)-q.z)))
                    :Infinity;
            if(gap>bestGap){bestGap=gap;best={x:cx,z:cz}}
            if(gap>=minGap){best={x:cx,z:cz};break}
          }
          ox=best?.x||0;
          oz=best?.z||0
        }
      }else{
        const cols=Math.ceil(Math.sqrt(density)),
              rows=Math.ceil(density/cols),
              row=Math.floor(i/cols),
              col=i%cols;
        const spreadFactor=Math.max(.25,Math.min(3,(+source.placeStructureSpread||100)/100)),
              gridSpacing=9*spreadFactor;
        ox=(col-(cols-1)/2)*gridSpacing;
        oz=(row-(rows-1)/2)*gridSpacing
      }

      const drawableVariants=(v287hDrawableStructureModel(node)?.variants||[]).filter(v=>Array.isArray(v.parts)&&v.parts.some(p=>p&&!p.hidden)),
            variantMode=['active','cycle','random'].includes(source.placeStructureVariantMode)
              ?source.placeStructureVariantMode
              :(source.placeRandomStructureVariants?'random':'active'),
            randomVariantId=variantMode==='cycle'&&drawableVariants.length
              ?drawableVariants[i%drawableVariants.length].id
              :variantMode==='random'&&drawableVariants.length
                ?drawableVariants[Math.floor(v283Hash(patchSeed+':variant:'+node.id+':'+i)*drawableVariants.length)%drawableVariants.length].id
                :null;

      result.push({
        node,
        key,
        place:source,
        generated:true,
        repeatIndex:i,
        randomVariantId,
        planetSurfaceMode,
        rel:{x:center.x+ox,z:center.z+oz}
      })
    }
  }

  return result
}


/* ============================ V28.1 WEBGL SURFACE / PLACE LANDSCAPE ============================ */
function ensureSurfaceWebGLCanvases(baseCanvas=$('planetCanvas')){
  if(!baseCanvas)return null;const stage=baseCanvas.parentElement;if(!stage)return null;
  let glc=$('surfaceWebGLCanvas'),hud=$('surfaceWebGLHud');
  if(!glc){glc=document.createElement('canvas');glc.id='surfaceWebGLCanvas';glc.className='surface-webgl-layer';baseCanvas.after(glc)}
  if(!hud){hud=document.createElement('canvas');hud.id='surfaceWebGLHud';hud.className='surface-webgl-hud';glc.after(hud)}
  return{glc,hud,stage}
}
function hideSurfaceWebGLLayers(){
  $('surfaceWebGLCanvas')?.classList.add('hidden');$('surfaceWebGLHud')?.classList.add('hidden');v287qHideSurfaceToolBar()
}
function surface3DShader(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s}
function surface3DInitGL(canvas){
  const gl=canvas.getContext('webgl',{antialias:true,alpha:false,preserveDrawingBuffer:false});if(!gl)return null;
  // Place/Surface rendering now carries the modeller's local position and normal
  // through the shader so saved per-face textures can use the same UV rules.
  const vs=surface3DShader(gl,gl.VERTEX_SHADER,`attribute vec3 aPosition;attribute vec3 aNormal;uniform mat4 uMVP;uniform mat4 uModel;varying vec3 vN;varying vec3 vW;varying vec3 vLP;varying vec3 vLN;void main(){vec4 w=uModel*vec4(aPosition,1.0);vW=w.xyz;vN=normalize(mat3(uModel)*aNormal);vLP=aPosition;vLN=aNormal;gl_Position=uMVP*vec4(aPosition,1.0);}`);
  const fs=surface3DShader(gl,gl.FRAGMENT_SHADER,`precision mediump float;uniform vec4 uColor;uniform vec3 uLight;uniform vec3 uEye;uniform vec3 uFog;uniform bool uUseTexture;uniform sampler2D uTexture;uniform int uFace;uniform bool uTileTexture;uniform vec2 uTileRepeat;varying vec3 vN;varying vec3 vW;varying vec3 vLP;varying vec3 vLN;const float PI=3.14159265;void main(){vec4 base=uColor;if(uUseTexture){vec2 uv=vec2(.5);bool ok=false;if(uFace==0){ok=vLN.z>.55;uv=vLP.xy+.5;}else if(uFace==1){ok=vLN.z<-.55;uv=vec2(-vLP.x,vLP.y)+.5;}else if(uFace==2){ok=vLN.x<-.55;uv=vec2(vLP.z,vLP.y)+.5;}else if(uFace==3){ok=vLN.x>.55;uv=vec2(-vLP.z,vLP.y)+.5;}else if(uFace==4){ok=vLN.y>.55;uv=vLP.xz+.5;}else if(uFace==5){ok=vLN.y<-.55;uv=vec2(vLP.x,-vLP.z)+.5;}else{ok=abs(vLN.y)<.72;uv=vec2(atan(vLP.z,vLP.x)/(2.0*PI)+.5,vLP.y+.5);}if(!ok)discard;vec2 sampleUV=uTileTexture?fract(uv*uTileRepeat):clamp(uv,vec2(.001),vec2(.999));base=texture2D(uTexture,sampleUV);}float d=max(0.0,dot(normalize(vN),normalize(uLight)));float shade=.36+d*.64;float fd=distance(vW,uEye);float fog=clamp((fd-48.0)/105.0,0.0,.78);vec3 c=base.rgb*shade;c=mix(c,uFog,fog);gl_FragColor=vec4(c,base.a*uColor.a);}`);
  const pr=gl.createProgram();gl.attachShader(pr,vs);gl.attachShader(pr,fs);gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(pr));
  return{gl,program:pr,textureCache:new Map(),loc:{p:gl.getAttribLocation(pr,'aPosition'),n:gl.getAttribLocation(pr,'aNormal'),mvp:gl.getUniformLocation(pr,'uMVP'),model:gl.getUniformLocation(pr,'uModel'),color:gl.getUniformLocation(pr,'uColor'),light:gl.getUniformLocation(pr,'uLight'),eye:gl.getUniformLocation(pr,'uEye'),fog:gl.getUniformLocation(pr,'uFog'),useTexture:gl.getUniformLocation(pr,'uUseTexture'),texture:gl.getUniformLocation(pr,'uTexture'),face:gl.getUniformLocation(pr,'uFace'),tileTexture:gl.getUniformLocation(pr,'uTileTexture'),tileRepeat:gl.getUniformLocation(pr,'uTileRepeat')}}
}
function surface3DDrawMesh(renderer,kind,model,vp,color,eye,fog,alpha=1){
  const {gl,program,loc}=renderer,geo=scene3DGeometry(kind);gl.useProgram(program);
  if(!geo._buffers)geo._buffers=new WeakMap();let buf=geo._buffers.get(gl);if(!buf){buf={p:gl.createBuffer(),n:gl.createBuffer()};gl.bindBuffer(gl.ARRAY_BUFFER,buf.p);gl.bufferData(gl.ARRAY_BUFFER,geo.positions,gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,buf.n);gl.bufferData(gl.ARRAY_BUFFER,geo.normals,gl.STATIC_DRAW);geo._buffers.set(gl,buf)}
  gl.bindBuffer(gl.ARRAY_BUFFER,buf.p);gl.enableVertexAttribArray(loc.p);gl.vertexAttribPointer(loc.p,3,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,buf.n);gl.enableVertexAttribArray(loc.n);gl.vertexAttribPointer(loc.n,3,gl.FLOAT,false,0,0);
  gl.uniformMatrix4fv(loc.model,false,new Float32Array(model));gl.uniformMatrix4fv(loc.mvp,false,new Float32Array(m4Mul(vp,model)));
  const rgba=scene3DHexRgb(color);rgba[3]=Math.max(0,Math.min(1,alpha));
  gl.uniform4fv(loc.color,new Float32Array(rgba));gl.uniform3fv(loc.light,new Float32Array([.45,.88,.34]));gl.uniform3fv(loc.eye,new Float32Array(eye));gl.uniform3fv(loc.fog,new Float32Array(fog));gl.uniform1i(loc.useTexture,0);gl.drawArrays(gl.TRIANGLES,0,geo.positions.length/3)
}
function surface3DGLTexture(renderer,data){
  if(!data)return null;
  if(!renderer.textureCache)renderer.textureCache=new Map();
  if(renderer.textureCache.has(data))return renderer.textureCache.get(data);
  const {gl}=renderer,rec={texture:gl.createTexture(),ready:false,failed:false};
  renderer.textureCache.set(data,rec);
  gl.bindTexture(gl.TEXTURE_2D,rec.texture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([180,180,180,255]));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  const img=new Image();
  img.onload=()=>{try{gl.bindTexture(gl.TEXTURE_2D,rec.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);rec.ready=true;requestPlanetDraw()}catch(err){rec.failed=true;console.warn('Place texture upload failed',err)}};
  img.onerror=()=>{rec.failed=true;console.warn('Place texture image could not be decoded')};
  img.src=data;
  return rec
}
function surface3DDrawTexturedFace(renderer,sourcePart,kind,model,vp,eye,fog,t,face){
  const rec=surface3DGLTexture(renderer,t?.data);if(!rec||rec.failed)return;
  const {gl,program,loc}=renderer,geo=scene3DGeometry(kind);gl.useProgram(program);const buf=geo._buffers?.get(gl);if(!buf)return;
  gl.bindBuffer(gl.ARRAY_BUFFER,buf.p);gl.enableVertexAttribArray(loc.p);gl.vertexAttribPointer(loc.p,3,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,buf.n);gl.enableVertexAttribArray(loc.n);gl.vertexAttribPointer(loc.n,3,gl.FLOAT,false,0,0);
  gl.uniformMatrix4fv(loc.model,false,new Float32Array(model));gl.uniformMatrix4fv(loc.mvp,false,new Float32Array(m4Mul(vp,model)));
  gl.uniform4fv(loc.color,new Float32Array([1,1,1,1]));gl.uniform3fv(loc.light,new Float32Array([.45,.88,.34]));gl.uniform3fv(loc.eye,new Float32Array(eye));gl.uniform3fv(loc.fog,new Float32Array(fog));
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,rec.texture);gl.uniform1i(loc.texture,0);
  gl.uniform1i(loc.face,{front:0,back:1,left:2,right:3,top:4,bottom:5,wrap:6}[face]??0);
  const tiled=t?.mode==='tile',repeat=scene3DTextureRepeatForFace(sourcePart,face,t);
  gl.uniform1i(loc.tileTexture,tiled?1:0);gl.uniform2fv(loc.tileRepeat,new Float32Array(repeat));gl.uniform1i(loc.useTexture,1);
  gl.depthFunc(gl.LEQUAL);gl.depthMask(false);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-2,-2);
  gl.drawArrays(gl.TRIANGLES,0,geo.positions.length/3);
  gl.disable(gl.POLYGON_OFFSET_FILL);gl.depthMask(true);gl.depthFunc(gl.LESS);gl.uniform1i(loc.useTexture,0)
}
function surface3DRenderFaceTextures(renderer,sourcePart,kind,model,vp,eye,fog){
  for(const [face,t] of Object.entries(sourcePart.faceTextures||{}))if(t?.data)surface3DDrawTexturedFace(renderer,sourcePart,kind,model,vp,eye,fog,t,face)
}
function surface3DCameraMatrices(canvas){
  const z=Math.max(.45,surfaceView.zoom||1),target=[surfaceView.cameraX||0,1.8,surfaceView.cameraZ||0],distance=34/z+10,yaw=surfaceView.yaw||0,pitch=Math.max(.08,Math.min(1.12,surfaceView.pitch??.30)),cp=Math.cos(pitch);
  const eye=[target[0]+Math.sin(yaw)*cp*distance,target[1]+Math.sin(pitch)*distance,target[2]-Math.cos(yaw)*cp*distance],view=m4LookAt(eye,target,[0,1,0]),proj=m4Perspective(Math.PI/3,Math.max(.2,canvas.width/canvas.height),.1,620);return{eye,target,view,proj,vp:m4Mul(proj,view)}
}
function surface3DProject(world,canvas,vp){
  const q=m4TransformPoint(vp,[...world,1]);if(!q[3]||q[3]<=0)return null;const x=q[0]/q[3],y=q[1]/q[3];return{x:(x*.5+.5)*canvas.width,y:(1-(y*.5+.5))*canvas.height,w:q[3]}
}
function surface3DSeed(i,salt=0){
  const n=Math.sin((surfaceView.lat||0)*971.3+(surfaceView.lon||0)*613.7+i*91.731+salt*37.11)*43758.5453;return n-Math.floor(n)
}
function surface3DColorMix(a,b,t){return v271HexMix(a,b,Math.max(0,Math.min(1,t)))}
function surface3DDrawLandscape(renderer,vp,eye,fog){
  const biome=surfaceView.biome,base=v287rWeatherGround(surfaceView.ground||'#5f8a49'),cx=0,cz=0;
  const surfacePlanet=activeSurfacePlanetNode(),accent2=(surfacePlanet?.planetLandColor3||simState.planet?.landColor3||'#8d8655');
  surface3DDrawMesh(renderer,'Cube',scene3DModelMatrix({x:cx,y:-.32,z:cz,rx:0,ry:0,rz:0,sx:360,sy:.55,sz:360}),vp,base,eye,fog);
  // v28.7ac sampled-color landscape model. The rule belongs to a terrain color, not one map tile.
  const planet=activeSurfacePlanetNode(),tileKey=v287pSurfacePixelIndex(surfaceView.lat??0,surfaceView.lon??0),landRule=v287zLandscapeRuleForSurface(planet,surfaceView.sampledColor||surfaceView.ground||base);
  if(landRule?.model){
    const landModel=normalizeScene3DModel(landRule.model),seedKey=landRule.seedMode==='per-tile'?`${landRule.color}:${tileKey}`:landRule.color,instances=scene3DRepeatInstances(landModel,seedKey).slice(0,240);
    // Exact modeller-to-loader mapping: authored X/Z and sizes are world-space 1:1.
    for(const inst of instances){for(const p of inst.variant?.parts||[]){if(p.hidden)continue;const is=Number(inst.scale)||1;surface3DRenderPart(renderer,{...p,x:(p.x||0)*is,y:(p.y||0)*is,z:(p.z||0)*is,sx:(p.sx||1)*is,sy:(p.sy||1)*is,sz:(p.sz||1)*is},vp,eye,fog,inst.ox,inst.oz,1)}}
    if(landRule.replaceScenery)return
  }

  if(biome==='lava-landscape'){surface3DDrawMesh(renderer,'Cube',scene3DModelMatrix({x:cx,y:.02,z:cz,sx:365,sy:.12,sz:365}),vp,base,eye,fog);return}
  if(surfaceView.gas||biome==='gas-atmosphere'){
    // Translucent gas-cloud banks. Disable depth writes while drawing them so clouds
    // tint Structures instead of acting like opaque walls that permanently occlude them.
    const {gl}=renderer;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for(let i=0;i<82;i++){
      const activeWeather=v287rActiveWeather(),
            stormWeather=activeWeather?.type==='storm',
            stormPhase=stormWeather?v287tWeatherPhase(activeWeather):null,
            spin=stormPhase?.stormSpin||0,
            drift=stormWeather?performance.now()*(.0000018+spin*.000009)*(8+(i%6)*1.8):0,
            ang=surface3DSeed(i,1)*Math.PI*2+drift,
            rad=10+Math.sqrt(surface3DSeed(i,2))*150,
            x=cx+Math.cos(ang)*rad,z=cz+Math.sin(ang)*rad;
      if(surface3DSeed(i,3)<(stormWeather?.22:.34))continue;
      const s=5+surface3DSeed(i,4)*18,y=-.4+surface3DSeed(i,5)*8,
            col=surface3DColorMix(base,v287rWeatherSky(surfaceView.sky||'#d8c2dc'),.18+surface3DSeed(i,6)*.62),
            alpha=.20+surface3DSeed(i,7)*.16;
      for(let puff=0;puff<3;puff++){
        const pa=surface3DSeed(i,puff+11)*Math.PI*2,pr=surface3DSeed(i,puff+15)*s*.55;
        surface3DDrawMesh(renderer,'Sphere',scene3DModelMatrix({x:x+Math.cos(pa)*pr,y:y+surface3DSeed(i,puff+19)*2,z:z+Math.sin(pa)*pr,sx:s*(1.5+surface3DSeed(i,puff+23)),sy:s*(.24+surface3DSeed(i,puff+27)*.22),sz:s*(.8+surface3DSeed(i,puff+31)*.7),rx:0,ry:pa,rz:0}),vp,col,eye,fog,alpha)
      }
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    return
  }
  if(biome==='ocean-water'){
    const water=surface3DColorMix(base,'#9bd7ec',.08);surface3DDrawMesh(renderer,'Cube',scene3DModelMatrix({x:cx,y:.02,z:cz,sx:365,sy:.12,sz:365}),vp,water,eye,fog);
    for(let i=0;i<34;i++){const ang=surface3DSeed(i,6)*Math.PI*2,rad=10+surface3DSeed(i,7)*145,x=cx+Math.cos(ang)*rad,z=cz+Math.sin(ang)*rad,s=3+surface3DSeed(i,8)*10;surface3DDrawMesh(renderer,'Dome',scene3DModelMatrix({x,y:-.15,z,sx:s*1.8,sy:.35+surface3DSeed(i,9)*.4,sz:s}),vp,surface3DColorMix(water,'#d8f3ff',.18),eye,fog)}
    return
  }
  const desert=biome==='desert';
  for(let i=0;i<58;i++){
    const ang=surface3DSeed(i,10)*Math.PI*2,rad=8+Math.sqrt(surface3DSeed(i,11))*135,x=cx+Math.cos(ang)*rad,z=cz+Math.sin(ang)*rad,s=5+surface3DSeed(i,12)*16,sy=(desert?.25:.42)+surface3DSeed(i,13)*(desert?.35:.72),col=surface3DColorMix(base,desert?'#e7c47c':accent2,.12+surface3DSeed(i,14)*.28);
    surface3DDrawMesh(renderer,'Dome',scene3DModelMatrix({x,y:-.16,z,sx:s*1.95,sy:s*sy*.42,sz:s*1.25,rx:0,ry:ang,rz:0}),vp,col,eye,fog)
  }
  // Wide, lower mountain ring: bigger bases and gentler silhouettes.
  for(let i=0;i<34;i++){
    const ang=i/34*Math.PI*2+(surface3DSeed(i,20)-.5)*.13,rad=118+surface3DSeed(i,21)*48,x=cx+Math.cos(ang)*rad,z=cz+Math.sin(ang)*rad,w=24+surface3DSeed(i,22)*32,h=18+surface3DSeed(i,23)*26,mountainBase=desert?'#8d6845':'#52634e',col=surface3DColorMix(mountainBase,surfaceView.sky||'#8fc8ee',.08+surface3DSeed(i,24)*.18);
    surface3DDrawMesh(renderer,'Cone',scene3DModelMatrix({x,y:h*.48-1,z,sx:w*1.55,sy:h,sz:w*1.35,rx:0,ry:ang,rz:0}),vp,col,eye,fog);
    surface3DDrawMesh(renderer,'Dome',scene3DModelMatrix({x,y:-.2,z,sx:w*2.1,sy:h*.22,sz:w*1.8,rx:0,ry:ang,rz:0}),vp,surface3DColorMix(col,base,.35),eye,fog)
  }
  if(!desert)for(let i=0;i<64;i++){
    if(surface3DSeed(i,40)<.35)continue;const ang=surface3DSeed(i,41)*Math.PI*2,rad=10+surface3DSeed(i,42)*112,x=cx+Math.cos(ang)*rad,z=cz+Math.sin(ang)*rad,s=.6+surface3DSeed(i,43)*1.4;
    surface3DDrawMesh(renderer,'Cylinder',scene3DModelMatrix({x,y:s*1.3,z,sx:s*.28,sy:s*2.6,sz:s*.28,rx:0,ry:0,rz:0}),vp,'#654a31',eye,fog);surface3DDrawMesh(renderer,'Sphere',scene3DModelMatrix({x,y:s*3,z,sx:s*1.8,sy:s*1.9,sz:s*1.8,rx:0,ry:0,rz:0}),vp,surface3DColorMix(base,accent2,.55),eye,fog)
  }
}
function v287oPlaceVariantModel(model,ent){
  if(!model||!ent?.randomVariantId)return model;
  const picked=model.variants?.find(v=>v.id===ent.randomVariantId);
  if(!picked?.parts?.some(p=>p&&!p.hidden))return model;
  const out=deepCloneState(model);
  out.activeVariantId=picked.id;
  out.parts=out.variants.find(v=>v.id===picked.id)?.parts||[];
  // The Place-level option means this landscape placement owns the random choice.
  // Keep the Structure's repetition geometry, but use the selected variant consistently within it.
  out.repetition={...(out.repetition||{}),variantMode:'active'};
  return out
}

function v287jLandscapeModelMetrics(model){
  const repeat=scene3DRepeatInstances(model),pts=[];
  for(const inst of repeat){
    for(const p of inst.variant?.parts||[]){
      if(!p||p.hidden)continue;
      const is=Number(inst.scale)||1,sx=Math.abs(Number(p.sx)||1)*is,sy=Math.abs(Number(p.sy)||1)*is,sz=Math.abs(Number(p.sz)||1)*is,
            x=(Number(p.x)||0)*is+(Number(inst.ox)||0),
            y=(Number(p.y)||0)*is,
            z=(Number(p.z)||0)*is+(Number(inst.oz)||0);
      pts.push({x0:x-sx/2,x1:x+sx/2,y0:y-sy/2,y1:y+sy/2,z0:z-sz/2,z1:z+sz/2})
    }
  }
  if(!pts.length)return{cx:0,cz:0,minY:0,maxY:1,span:1};
  const minX=Math.min(...pts.map(p=>p.x0)),maxX=Math.max(...pts.map(p=>p.x1)),
        minY=Math.min(...pts.map(p=>p.y0)),maxY=Math.max(...pts.map(p=>p.y1)),
        minZ=Math.min(...pts.map(p=>p.z0)),maxZ=Math.max(...pts.map(p=>p.z1));
  return{cx:(minX+maxX)/2,cz:(minZ+maxZ)/2,minY,maxY,span:Math.max(1,maxX-minX,maxZ-minZ,maxY-minY)}
}
function v287jLandscapeModelTransform(model){
  const m=v287jLandscapeModelMetrics(model);
  // Preserve normal authored size. Only shrink truly enormous modeller coordinates enough
  // to keep the Structure visible in the Place landscape.
  const scale=Math.min(.62,Math.max(.035,28/m.span));
  return{...m,scale}
}

function surface3DRenderPart(renderer,p,vp,eye,fog,ox=0,oz=0,scale=.58){
  const q={...p,x:ox+(p.x||0)*scale,y:(p.y||0)*scale,z:oz+(p.z||0)*scale,sx:(p.sx||1)*scale,sy:(p.sy||1)*scale,sz:(p.sz||1)*scale};
  if(p.kind==='Tree'){
    const trunk={...q,kind:'Cylinder',color:'#6e5035',sx:q.sx*.26,sy:q.sy*.55,sz:q.sz*.26,y:q.y-q.sy*.20};
    const crown={...q,kind:'Sphere',sx:q.sx,sy:q.sy*.65,sz:q.sz,y:q.y+q.sy*.18};
    surface3DDrawMesh(renderer,'Cylinder',scene3DModelMatrix(trunk),vp,trunk.color,eye,fog);surface3DDrawMesh(renderer,'Sphere',scene3DModelMatrix(crown),vp,p.color,eye,fog);return
  }
  const kind=p.kind==='Tower'?'Cylinder':p.kind,model=scene3DModelMatrix(q);
  surface3DDrawMesh(renderer,kind,model,vp,p.color||'#9aa6b2',eye,fog);
  surface3DRenderFaceTextures(renderer,p,kind,model,vp,eye,fog)
}
function surface3DRenderModel(renderer,model,rel,vp,eye,fog,scale=.58){
  model=normalizeScene3DModel(model);
  for(const inst of scene3DRepeatInstances(model))for(const p of inst.variant?.parts||[]){if(p.hidden)continue;surface3DRenderPart(renderer,{...p,x:(p.x||0)*(inst.scale||1),y:(p.y||0)*(inst.scale||1),z:(p.z||0)*(inst.scale||1),sx:(p.sx||1)*(inst.scale||1),sy:(p.sy||1)*(inst.scale||1),sz:(p.sz||1)*(inst.scale||1)},vp,eye,fog,rel.x+inst.ox*scale,rel.z+inst.oz*scale,scale)}
}
function v287lDrawStructureMarker(ctx,x,y,index,label='',bad=false){
  if(!Number.isFinite(x)||!Number.isFinite(y))return;
  ctx.save();
  ctx.translate(x,y);
  ctx.lineWidth=2;
  ctx.strokeStyle=bad?'#ff4d5e':'#61e6ff';
  ctx.fillStyle=bad?'rgba(255,55,75,.18)':'rgba(40,220,255,.18)';
  ctx.beginPath();ctx.arc(0,0,8,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.moveTo(-13,0);ctx.lineTo(13,0);ctx.moveTo(0,-13);ctx.lineTo(0,13);ctx.stroke();
  ctx.fillStyle=bad?'#ff7180':'#bff7ff';ctx.font='800 9px ui-monospace,monospace';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(String(index+1),0,-19);
  ctx.fillStyle=bad?'#ff7180':'#dffcff';ctx.font='800 12px system-ui';ctx.fillText('◆',0,0);
  if(label){ctx.font='700 9px system-ui';ctx.fillStyle='#e8fbff';ctx.fillText(label,0,24)}
  ctx.restore()
}
function v287mStructureDebugState(){
  const level=mapDisplayLevel(),
        focusedId=surfaceView.focusPlaceId||scaleNav.selected?.sourceId||null,
        focused=focusedId?byId(focusedId):null,
        activePlanet=activeSurfacePlanetNode(),
        sources=v287nSurfacePopulationSources(),
        entities=v28SurfaceStructureEntities();

  let selectedIds=[],configured=0,poolCount=0;
  for(const source of sources){
    const ids=Array.isArray(source.placeStructureIds)?source.placeStructureIds:[];
    selectedIds.push(...ids);
    if(ids.length||source.placePopulationMode!=='custom')
      configured+=Math.max(1,Math.min(80,+source.placeStructureDensity||14));
    poolCount+=v283PlaceStructurePool(source).length
  }

  let problem='';
  if(!sources.length){
    if(level==='place')problem=`No Place population source · focus=${focusedId||'none'}`;
    else if(level==='surface'){
      const authored=activePlanet?surfacePlaces().length:0;
      problem=`No authored Place population source · active=${activePlanet?.name||'none'} · places=${authored}`
    }else problem=`Renderer level=${level}`;
  }else if(!entities.length){
    problem=`${sources.length} source${sources.length===1?'':'s'} · generated 0`
  }

  return{
    level,focusedId,focused,activePlanet,
    source:sources[0]||null,
    sources,
    entities,
    selectedIds,
    density:configured,
    expectedConfigured:configured,
    pool:{length:poolCount},
    problem
  }
}
function v287lDrawMissingBadge(ctx,w,missing,expected,rendered,state=null){
  const s=state||v287mStructureDebugState(),
        configured=s.expectedConfigured||0,
        generated=s.entities?.length||0,
        isBad=!!s.problem||missing>0,
        title=s.problem?`DEBUG: ${s.problem}`:
              missing>0?`Missing ${missing} instance${missing===1?'':'s'}`:
              `Structures: ${rendered}/${expected}`,
        line2=`level=${s.level} · configured=${configured} · generated=${generated} · pool=${s.pool?.length||0}`,
        line3=`sources=${s.sources?.length||0} · first=${s.source?.name||s.source?.id||'NONE'} · selected=${s.selectedIds?.length||0}`,
        bw=Math.min(470,Math.max(310,w-28)),bh=58,x=Math.max(8,w-bw-14),y=14;

  ctx.save();
  ctx.fillStyle=isBad?'rgba(100,5,15,.94)':'rgba(5,55,65,.92)';
  ctx.strokeStyle=isBad?'#ff5364':'#55eaff';ctx.lineWidth=1.5;
  ctx.fillRect(x,y,bw,bh);ctx.strokeRect(x,y,bw,bh);
  ctx.textAlign='left';ctx.textBaseline='middle';
  ctx.font='800 11px system-ui';ctx.fillStyle=isBad?'#ff8793':'#aef8ff';
  ctx.fillText((isBad?'⚠ ':'◆ ')+title,x+10,y+14);
  ctx.font='700 9px ui-monospace,monospace';ctx.fillStyle='#e8f8ff';
  ctx.fillText(line2,x+10,y+32);ctx.fillText(line3,x+10,y+47);
  ctx.restore()
}
function v287lStructureDebugExpected(){
  const s=v287mStructureDebugState();
  return{entities:s.entities,expected:s.entities.length,state:s}
}

function renderSurfaceWebGL(baseCanvas=$('planetCanvas')){
  const layers=ensureSurfaceWebGLCanvases(baseCanvas);if(!layers)return false;const {glc,hud}=layers,rect=baseCanvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,1.65);
  const W=Math.max(2,Math.round(rect.width*d)),H=Math.max(2,Math.round(rect.height*d));if(glc.width!==W||glc.height!==H){glc.width=W;glc.height=H;hud.width=W;hud.height=H}
  glc.classList.remove('hidden');hud.classList.remove('hidden');
  let renderer=glc._surfaceRenderer;if(renderer===undefined){try{renderer=surface3DInitGL(glc)}catch(err){console.warn('Surface WebGL init failed',err);renderer=null}glc._surfaceRenderer=renderer||false}
  if(!renderer){glc.classList.add('hidden');hud.classList.add('hidden');return false}
  const {gl}=renderer,weatherSky=v287rWeatherSky(surfaceView.sky||'#8fc8ee'),sky=scene3DHexRgb(weatherSky),fog=[sky[0],sky[1],sky[2]];gl.viewport(0,0,W,H);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(sky[0],sky[1],sky[2],1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  const {eye,vp}=surface3DCameraMatrices(glc);surface3DDrawLandscape(renderer,vp,eye,fog);

  const placeMode=mapDisplayLevel()==='place',focused=placeMode?byId(surfaceView.focusPlaceId||scaleNav.selected?.sourceId):null,focusedHasStructures=!!focused&&focused.placePopulationMode!=='none'&&Array.isArray(focused.placeStructureIds)&&focused.placeStructureIds.length>0,barren=placeMode&&focused&&!placeHasPlanetIcon(focused)&&!focusedHasStructures&&!activeSurfacePlanetNode()?.allowWildernessStructures;
  const visible=[];
  for(const place of surfacePlaces()){
    if(placeMode&&place.id!==focused?.id)continue;
    const rel=placeSurfaceRelative(place);
    // Icon-bearing Places are markers on Surface; their model exists only inside that exact Place.
    // Places no longer render legacy Place models; their scoped Structures render below.
    const P=surface3DProject([rel.x,1.3,rel.z],glc,vp);if(P&&!barren&&!placeMode&&placeHasPlanetIcon(place)){visible.push({place,x:P.x/d,y:P.y/d,r:Math.max(24,44/Math.max(.6,P.w*.04)),rel,clip:P})}
  }
  const visibleStructures=[],debugStructures=[],debugInfo=v287lStructureDebugExpected();
  let renderedStructureInstances=0;
  if(!barren)for(let entIndex=0;entIndex<debugInfo.entities.length;entIndex++){
    const ent=debugInfo.entities[entIndex];
    // Marker is based on intended population coordinates, independent of model rendering.
    const markerP=surface3DProject([ent.rel.x,1.5,ent.rel.z],glc,vp);
    if(markerP)debugStructures.push({ent,index:entIndex,x:markerP.x/d,y:markerP.y/d,clip:markerP,bad:false});
    try{
      const rawModel=v287hDrawableStructureModel(ent.node),model=v287oPlaceVariantModel(rawModel,ent);
      if(!model){
        const dm=debugStructures.find(x=>x.ent===ent);if(dm)dm.bad=true;
        console.warn('Place landscape Structure has no drawable 3D model',ent.node?.name||ent.node?.id);continue
      }
      const repeat=scene3DRepeatInstances(model),
            fit=v287jLandscapeModelTransform(model),
            scale=fit.scale,
            gasLift=activeSurfacePlanetNode()?.gasGiant?8:0,
            placeY=Math.max(-500,Math.min(500,+ent.place?.placeStructureY||0))+gasLift,
            groundLift=-fit.minY;

      for(const inst of repeat){
        const parts=(inst.variant?.parts||[]).filter(part=>part&&!part.hidden);
        if(!parts.length)continue;

        // Translate authored model coordinates into a local footprint around this generated
        // landscape placement. This prevents a model authored away from world origin from
        // silently rendering hundreds of units away from the Place.
        const ix=(Number(inst.ox)||0)-fit.cx,
              iz=(Number(inst.oz)||0)-fit.cz;

        for(const part of parts){
          try{
            surface3DRenderPart(
              renderer,
              {...part,x:(Number(part.x)||0),y:(Number(part.y)||0)+groundLift+placeY,z:(Number(part.z)||0)},
              vp,eye,fog,
              ent.rel.x+ix*scale,
              ent.rel.z+iz*scale,
              scale
            )
          }catch(partErr){
            console.warn('Skipped malformed Structure part in Place landscape',ent.node?.name||ent.node?.id,partErr)
          }
        }

        renderedStructureInstances++;
        const P=surface3DProject([ent.rel.x+ix*scale,Math.max(.9,placeY*scale+.9),ent.rel.z+iz*scale],glc,vp);
        if(P)visibleStructures.push({...ent,repeatKey:inst.key,x:P.x/d,y:P.y/d,r:22,clip:P})
      }
    }catch(err){
      const dm=debugStructures.find(x=>x.ent===ent);if(dm)dm.bad=true;
      console.error('Place landscape Structure render failed',ent.node?.name||ent.node?.id,err)
    }
  }
  baseCanvas._surfacePlaces=visible;baseCanvas._surfaceStructures=visibleStructures;baseCanvas._surfaceStructureDebug=debugStructures;

  const ctx=hud.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,rect.width,rect.height);ctx.textAlign='center';
  // DEBUG: intended Structure positions are visible even when geometry is missing.
  for(const m of debugStructures){
    if(m.clip?.w<=0)continue;
    v287lDrawStructureMarker(ctx,m.x,m.y,m.index,m.ent.node?.name||'Structure',m.bad)
  }
  const expectedRendered=debugInfo.entities.reduce((sum,e)=>{
    const model=v287hDrawableStructureModel(e.node);return sum+(model?Math.max(1,scene3DRepeatInstances(model).length):1)
  },0);
  const missingStructures=Math.max(0,expectedRendered-renderedStructureInstances);
  v287lDrawMissingBadge(ctx,rect.width,missingStructures,expectedRendered,renderedStructureInstances,debugInfo.state);
  v287qDrawWeather(ctx,rect.width,rect.height,(x,z)=>{const Q=surface3DProject([x,1.5,z],glc,vp);return Q?{x:Q.x/d,y:Q.y/d,scale:Math.max(4,24/Math.max(.35,Q.w||1))}:null});
  ensureSurfaceToolBar();v287qStartWeatherAnimation();
  if(surfaceView.captions!==false){
    for(const v of visibleStructures){if(v.clip.w<=0)continue;ctx.font='600 9px system-ui';ctx.lineWidth=3;ctx.strokeStyle='rgba(2,6,10,.65)';ctx.strokeText(v.node.name,v.x,v.y-10);ctx.fillStyle='#dcecff';ctx.fillText(v.node.name,v.x,v.y-10)}
  }
  if(mapDisplayLevel()==='place'){
    const place=byId(surfaceView.focusPlaceId||scaleNav.selected?.sourceId);
    if(place){
      ctx.textAlign='left';ctx.fillStyle='rgba(5,10,17,.72)';ctx.fillRect(14,14,Math.min(390,rect.width-28),48);
      ctx.font='11px system-ui';ctx.fillStyle='#a9bfd7';
      ctx.fillText(focusedHasStructures?'PLACE VIEW · Structure population active · drag to rotate · wheel to zoom':placeHasPlanetIcon(place)?'PLACE VIEW · drag to rotate · wheel to zoom':'PLACE VIEW · landscape only',28,40)
    }
  }
  return true
}

function renderSurfaceView(canvas=$('planetCanvas'),ctx=null,width=null,height=null){
  if(!canvas||!surfaceView.active)return;
  // v28.7m diagnostic: render path heartbeat is stored even before WebGL/fallback selection.
  canvas._structureDebugHeartbeat={time:Date.now(),level:mapDisplayLevel(),focus:surfaceView.focusPlaceId||scaleNav.selected?.sourceId||null};
  if(!ctx&&renderSurfaceWebGL(canvas))return;
  hideSurfaceWebGLLayers();
  const rect=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,1.5),w=width||rect.width,h=height||rect.height;
  if(!ctx){if(canvas.width!==Math.round(w*d)||canvas.height!==Math.round(h*d)){canvas.width=Math.round(w*d);canvas.height=Math.round(h*d)}ctx=canvas.getContext('2d',{alpha:false});ctx.setTransform(d,0,0,d,0,0)}
  ctx.clearRect(0,0,w,h);
  const weatherSky=v287rWeatherSky(surfaceView.sky),weatherGround=v287rWeatherGround(surfaceView.ground),
        sky=ctx.createLinearGradient(0,0,0,h*.5);
  sky.addColorStop(0,v271HexMix(weatherSky,'#ffffff',.10));sky.addColorStop(1,weatherSky);ctx.fillStyle=sky;ctx.fillRect(0,0,w,h*.42);
  ctx.fillStyle=weatherGround;ctx.fillRect(0,h*.38,w,h*.62);
  if(surfaceView.gas){
    const activeStorm=v287rActiveWeather(),
          stormSpin=activeStorm?.type==='storm'?v287tWeatherPhase(activeStorm).stormSpin:0,
          stormDrift=activeStorm?.type==='storm'?(performance.now()*(.004+stormSpin*.013))%90:0;
    for(let i=0;i<15;i++){
      ctx.globalAlpha=.045+(i%3)*.012;ctx.fillStyle=i%2?weatherSky:weatherGround;
      ctx.fillRect(-90+((i%2)?stormDrift:-stormDrift),h*.39+i*24,w+180,11+((i*7)%13))
    }
    ctx.globalAlpha=1
  }else if(surfaceView.biome==='ocean-water'){
    for(let i=0;i<34;i++){ctx.strokeStyle='rgba(225,248,255,.14)';ctx.beginPath();ctx.moveTo(0,h*.43+i*14);ctx.quadraticCurveTo(w*.5,h*.43+i*14+Math.sin(i)*8,w,h*.43+i*14);ctx.stroke()}
  }else{
    ctx.strokeStyle='rgba(255,255,255,.08)';
    for(let z=-8;z<26;z+=2){const A=surfaceProject(-24,z,w,h),B=surfaceProject(24,z,w,h);ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke()}
    if(surfaceView.biome==='green-landscape'){ctx.fillStyle='rgba(22,75,28,.30)';for(let i=0;i<110;i++){const x=((Math.sin(i*72.37)+1)/2)*w,y=h*.42+((Math.sin(i*31.9)+1)/2)*h*.55;ctx.fillRect(x,y,2,10)}}
  }
  const fallbackPlaceMode=mapDisplayLevel()==='place',fallbackFocus=fallbackPlaceMode?byId(surfaceView.focusPlaceId||scaleNav.selected?.sourceId):null,fallbackHasStructures=!!fallbackFocus&&fallbackFocus.placePopulationMode!=='none'&&Array.isArray(fallbackFocus.placeStructureIds)&&fallbackFocus.placeStructureIds.length>0,fallbackBarren=fallbackPlaceMode&&fallbackFocus&&!placeHasPlanetIcon(fallbackFocus)&&!fallbackHasStructures&&!activeSurfacePlanetNode()?.allowWildernessStructures;
  const visible=[];
  for(const place of surfacePlaces()){
    if(fallbackPlaceMode&&place.id!==fallbackFocus?.id)continue;const rel=placeSurfaceRelative(place),P=surfaceProject(rel.x,rel.z,w,h);if(P.y<h*.30||P.y>h*1.08)continue;
    // Legacy Place models are intentionally ignored in fallback Place view.
    if(!fallbackPlaceMode&&placeHasPlanetIcon(place)){visible.push({place,x:P.x,y:P.y,r:Math.max(32,42/Math.max(.72,P.depth)),rel})}
  }
  const visibleStructures=[],fallbackDebug=v287lStructureDebugExpected(),fallbackMarkers=[];
  let fallbackRendered=0;
  if(!fallbackBarren)for(let entIndex=0;entIndex<fallbackDebug.entities.length;entIndex++){
    const ent=fallbackDebug.entities[entIndex];
    try{
      const P=surfaceProject(ent.rel.x,ent.rel.z,w,h);
      fallbackMarkers.push({ent,index:entIndex,x:P.x,y:P.y,bad:false});

      const rawModel=v287hDrawableStructureModel(ent.node),model=v287oPlaceVariantModel(rawModel,ent);
      if(!model){fallbackMarkers[fallbackMarkers.length-1].bad=true;console.warn('Fallback Place landscape Structure has no drawable 3D model',ent.node?.name||ent.node?.id);continue}

      v28DrawSceneModelOnSurface(ctx,model,ent.rel,w,h,.72,Math.max(-500,Math.min(500,+ent.place?.placeStructureY||0))+(activeSurfacePlanetNode()?.gasGiant?8:0));
      if(surfaceView.captions!==false){
        ctx.fillStyle='rgba(235,244,255,.9)';ctx.font='600 10px system-ui';ctx.textAlign='center';ctx.fillText(ent.node.name,P.x,P.y+12)
      }
      fallbackRendered+=Math.max(1,scene3DRepeatInstances(model).length);
      visibleStructures.push({...ent,x:P.x,y:P.y,r:25})
    }catch(err){
      const dm=fallbackMarkers.find(x=>x.ent===ent);if(dm)dm.bad=true;
      console.error('Fallback Place landscape Structure render failed',ent.node?.name||ent.node?.id,err)
    }
  }
  // DEBUG markers are independent from geometry so failed models still leave a visible target.
  for(const m of fallbackMarkers)v287lDrawStructureMarker(ctx,m.x,m.y,m.index,m.ent.node?.name||'Structure',m.bad);
  const fallbackExpected=fallbackDebug.entities.reduce((sum,e)=>{const model=v287hDrawableStructureModel(e.node);return sum+(model?Math.max(1,scene3DRepeatInstances(model).length):1)},0);
  v287lDrawMissingBadge(ctx,w,Math.max(0,fallbackExpected-fallbackRendered),fallbackExpected,fallbackRendered,fallbackDebug.state);
  v287qDrawWeather(ctx,w,h,(x,z)=>surfaceProject(x,z,w,h));ensureSurfaceToolBar();v287qStartWeatherAnimation();
  canvas._surfacePlaces=visible;canvas._surfaceStructures=visibleStructures;canvas._surfaceStructureDebug=fallbackMarkers;
  if(surfaceView.focusPlaceId){
    const H=visible.find(v=>v.place.id===surfaceView.focusPlaceId);
    if(H){ctx.strokeStyle='#ffe487';ctx.lineWidth=3;ctx.beginPath();ctx.arc(H.x,H.y,H.r*1.25,0,Math.PI*2);ctx.stroke()}
  }
  if(mapDisplayLevel()==='place'){
    const place=byId(surfaceView.focusPlaceId||scaleNav.selected?.sourceId);
    if(place){
      ctx.fillStyle='rgba(5,10,17,.72)';ctx.fillRect(14,14,Math.min(330,w-28),48);
      ctx.font='11px system-ui';ctx.fillStyle='#a9bfd7';ctx.textAlign='left';
      ctx.fillText('PLACE VIEW · wheel to zoom · drag to pan · right-click/back to Surface',28,40)
    }
  }
}
function bindSurfaceCanvas(){/* v28 Surface input is handled by the existing planetCanvas handlers. */}

function hierarchyChildLevel(level){return level==='universe'?'galaxy':level==='galaxy'?'solar':level==='solar'?'planet':level==='planet'?'surface':level==='surface'?'place':null}
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
function v287yPlanetSeed(node){
  let h=2166136261>>>0;for(const ch of String(node?.id||node?.sourceId||node?.name||'planet')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0
}
function v287yPlanetOverrideFromNode(planet){return{
  name:planet?.name||'Planet',seed:planet?.planetModelSeed||v287yPlanetSeed(planet),
  landColor:planet?.planetLandColor||'#5d8f5a',landColor2:planet?.planetLandColor2||'#78915b',landColor3:planet?.planetLandColor3||'#8d8655',landColor4:planet?.planetLandColor4||null,landColor5:planet?.planetLandColor5||null,landColor6:planet?.planetLandColor6||null,paletteSaved:!!planet?.planetPaletteSaved,
  oceanColor:planet?.planetOceanColor||'#315f9f',oceanColor2:planet?.planetOceanColor2||'#102f58',skyColor:planet?.planetSkyColor||'#8fc8ee',isMoon:!!planet?.isMoon,orbitingId:planet?.orbitingId||null,
  gasGiant:!!planet?.gasGiant,gasColor:planet?.planetGasColor||'#d6b783',gasColor2:planet?.planetGasColor2||'#a87a58',gasColor3:planet?.planetGasColor3||'#eee0b5',
  gasContrast:Number.isFinite(+planet?.planetGasContrast)?+planet.planetGasContrast:55,landCoverage:Number.isFinite(+planet?.planetLandCoverage)?+planet.planetLandCoverage:45,
  landEnabled:planet?.planetLandEnabled!==false,oceanEnabled:planet?.planetOceanEnabled!==false,cloudsEnabled:planet?.planetCloudsEnabled!==false,
  cloudColor:planet?.planetCloudColor||'#eef8ff',cloudCoverage:Number.isFinite(+planet?.planetCloudCoverage)?+planet.planetCloudCoverage:45,cloudOpacity:Number.isFinite(+planet?.planetCloudOpacity)?+planet.planetCloudOpacity:38,
  inhabitants:planet?.inhabitants||'None'} }
function enterPlanetFromMap(item){
  cacheCurrentScaleMap();
  scaleNav.path.push({level:mapDisplayLevel(),item});scaleNav.level='planet';scaleNav.selected=item;scaleNav.lastTransitionAt=performance.now();
  const p=(item.sourceId?byId(item.sourceId):null)||
    ofType('place').find(x=>
      x.name===item.name &&
      String(x.placeScale||inferPlaceScale(x.placeType))==='planet'
    );
  const planetNode=p&&(p.gasGiant||String(p.placeScale||inferPlaceScale(p.placeType))==='planet')?p:null;
  simState.planetOverride={
    name:item.name,
    seed:planetNode?.planetModelSeed||v287yPlanetSeed(planetNode||item),
    landColor:planetNode?.planetLandColor||'#5d8f5a',
    landColor2:planetNode?.planetLandColor2||'#78915b',
    landColor3:planetNode?.planetLandColor3||'#8d8655',
    landColor4:planetNode?.planetLandColor4||null,
    landColor5:planetNode?.planetLandColor5||null,
    landColor6:planetNode?.planetLandColor6||null,
    paletteSaved:!!planetNode?.planetPaletteSaved,
    oceanColor:planetNode?.planetOceanColor||'#315f9f',
    oceanColor2:planetNode?.planetOceanColor2||'#102f58',
    skyColor:planetNode?.planetSkyColor||'#8fc8ee',
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
  const current=mapDisplayLevel();
  if(current==='place'){scaleNav.path.pop();scaleNav.level='surface';scaleNav.selected=null;surfaceView.focusPlaceId=null;refreshWorldMapMode();renderGalacticCoordinates();requestPlanetDraw();return}
  if(current==='surface'){scaleNav.path.pop();scaleNav.level='planet';surfaceView.active=false;refreshWorldMapMode();renderGalacticCoordinates();requestPlanetDraw();return}
  if(current==='planet')cacheCurrentPlanet();else cacheCurrentScaleMap();
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
      height:+$('eMegaHeight').value||0,
      blockiness:megaBlockinessValue(),
      snapGrid:megaSnapEnabled()?megaSnapGridValue():0,
      centerMode:megaCircleFromCenter()
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
      height:+$('eMegaHeight').value||0,
      blockiness:megaBlockinessValue(),
      snapGrid:megaSnapEnabled()?megaSnapGridValue():0,
      centerMode:megaCircleFromCenter()
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
    const base={color:$('eMegaPaintColor').value,width:+$('eMegaPaintWidth').value||8,height:+$('eMegaHeight').value||0,blockiness:megaBlockinessValue(),centerMode:megaCircleFromCenter(),brushShape:+$('eMegaBrushShape')?.value||50};
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
    let uv=createdMega3DToolUV(e);if(!uv)return;
    if(e.shiftKey&&(megaPainterState.tool==='brush'||megaPainterState.tool==='line'))uv=constrainMegaAxisPoint(createdMega3D.drawStart,uv);
    createdMega3D.lastUV=uv;
    const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
    if(megaPainterState.tool==='brush'){
      collection.at(-1)?.points?.push(uv);
      saveActiveCreatedMegaFace();renderMegaPainter();renderCreatedMega3D()
    }else if(['line','circle','rect'].includes(megaPainterState.tool)){
      createdMega3D.preview={type:megaPainterState.tool,a:createdMega3D.drawStart,b:uv,blockiness:megaBlockinessValue(),centerMode:megaCircleFromCenter()}
      renderCreatedMega3D()
    }
  });

  const finish=e=>{
    if(createdMega3D.drag){createdMega3D.drag=false;c.releasePointerCapture?.(e.pointerId);return}
    if(!createdMega3D.draw)return;
    let uv=createdMega3DToolUV(e)||createdMega3D.lastUV;
    if(uv&&e.shiftKey&&(megaPainterState.tool==='brush'||megaPainterState.tool==='line'))uv=constrainMegaAxisPoint(createdMega3D.drawStart,uv);
    const collection=megaPainterState.mode==='height'?megaPainterState.heightCommands:megaPainterState.commands;
    if(uv&&['line','circle','rect'].includes(megaPainterState.tool)){
      const committed=createdMega3D.preview||{type:megaPainterState.tool,a:createdMega3D.drawStart,b:uv};
      collection.push({
        type:committed.type,
        a:deepCloneState(committed.a),
        b:deepCloneState(committed.b),
        color:$('eMegaPaintColor').value,
        width:+$('eMegaPaintWidth').value||8,
        height:+$('eMegaHeight').value||0,
        blockiness:committed.blockiness??megaBlockinessValue(),
        centerMode:committed.centerMode??megaCircleFromCenter()
      })
    }
    createdMega3D.draw=false;createdMega3D.drawStart=null;createdMega3D.lastUV=null;createdMega3D.preview=null;
    c.releasePointerCapture?.(e.pointerId);saveActiveCreatedMegaFace();renderMegaPainter();renderCreatedMega3D()
  };
  c.addEventListener('pointerup',finish);c.addEventListener('pointercancel',finish);c.addEventListener('pointerleave',()=>{if(!megaPainterState.drawing){megaPainterState.hover=null;renderMegaPainter()}});
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
  const sc=mapDisplayLevel(),planet=sc==='planet',surface=sc==='surface',placeView=sc==='place',e=document.querySelector('#planetViewPanel .planet-panel-head .eyebrow');
  if(e)e.textContent=systemScaleLabel(sc);
  $('planetName').textContent=planet?(simState.planet?.name||'Procedural World'):surface?(surfaceView.biome||'Surface').replaceAll('-',' ').replace(/\b\w/g,m=>m.toUpperCase()):placeView?(byId(surfaceView.focusPlaceId||scaleNav.selected?.sourceId)?.name||'Place'):systemScaleLabel(sc)+' Map';

  const contextItem=scaleNav.path.at(-1)?.item||null;
  const contextPlace=contextItem?.sourceId?byId(contextItem.sourceId):activePlanetPlace();
  const contextMegaCount=contextPlace?megastructureCountForPlace(contextPlace):0;

  if(surface||placeView){
    $('planetMeta').textContent=`${surfaceView.sampledColor||surfaceView.ground} · ${(surfaceView.lat*180/Math.PI).toFixed(2)}° lat · ${(surfaceView.lon*180/Math.PI).toFixed(2)}° lon · ${surfacePlaces().length} authored Place${surfacePlaces().length===1?'':'s'}`
  }else if(!planet){
    $('planetMeta').textContent=`${placesForMapScale(sc).length} authored child places · ${contextMegaCount} megastructure${contextMegaCount===1?'':'s'} · ${(simState.spaceMap?.routes||[]).filter(r=>r.type==='trade').length} trade routes · ${(simState.spaceMap?.routes||[]).filter(r=>r.type==='war').length} war routes`
  }else if(contextPlace){
    $('planetMeta').textContent=`${contextMegaCount} megastructure${contextMegaCount===1?'':'s'} · ${$('planetMeta').textContent||''}`.replace(/ · 0 megastructures · /,' · ')
  }

  $('regenPlanet').textContent=surface||placeView?'Surface is sampled from Planet':planet?'↻ Regenerate':'↻ Regenerate Map';$('regenPlanet').disabled=surface||placeView;

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
  if(h)h.textContent=surface?'Left-drag to move · Right-drag to rotate · Drag Places to move · Double-click to enter · Scroll to zoom · Double-right-click to Planet':placeView?'Left-drag to move · Right-drag to rotate · Drag Structures to move · Scroll to zoom · Double-right-click to Surface':planet?'Drag in any direction to rotate · Scroll to zoom · Double-click terrain to enter Surface':'Scroll to zoom · Click objects for info · Double-click to enter · Right-click to go back'
}



function countryBorderLatLonEndpoint(seg,end=0){
  const q=parseCountryBorderKey(seg),cols=COUNTRY_BORDER_COLS,rows=COUNTRY_BORDER_ROWS;
  if(q.kind==='v'){return{lon:-Math.PI+(q.x/cols)*Math.PI*2,lat:Math.PI/2-((q.y+end)/rows)*Math.PI}}
  return{lon:-Math.PI+((q.x+end)/cols)*Math.PI*2,lat:Math.PI/2-(q.y/rows)*Math.PI}
}
function drawProjectedBorderLine(ctx,w,h,a,b){
  let prev=null;for(let i=0;i<=6;i++){const t=i/6,lat=a.lat+(b.lat-a.lat)*t;let dl=b.lon-a.lon;if(dl>Math.PI)dl-=Math.PI*2;if(dl<-Math.PI)dl+=Math.PI*2;const lon=a.lon+dl*t,P=planetProject(lat,lon,w,h);if(P.front&&prev?.front&&Math.hypot(P.x-prev.x,P.y-prev.y)<Math.min(w,h)*.3){ctx.moveTo(prev.x,prev.y);ctx.lineTo(P.x,P.y)}prev=P}
}
function proceduralCountryBorder(country){
  const lat=Number.isFinite(+country.surfaceLat)?+country.surfaceLat:0,lon=Number.isFinite(+country.surfaceLon)?+country.surfaceLon:0,seed=[...String(country.id)].reduce((a,c)=>a+c.charCodeAt(0),0),pts=[];
  const rx=.28+(seed%8)*.018,ry=.18+((seed>>2)%7)*.015;for(let i=0;i<28;i++){const a=i/28*Math.PI*2,r=1+.18*Math.sin(a*3+seed)+.09*Math.cos(a*5+seed*.2);pts.push({lat:Math.max(-1.48,Math.min(1.48,lat+Math.sin(a)*ry*r)),lon:lon+Math.cos(a)*rx*r/Math.max(.35,Math.cos(lat))})}return pts
}
function drawCountryBorders(ctx,w,h){
  const planet=activeSurfacePlanetNode();if(!planet)return;
  const political=!!planetView.political;if(!political)return;
  const countries=nodes.filter(n=>n.type==='place'&&!n.isHub&&String(n.placeScale||inferPlaceScale(n.placeType))==='country'&&countryPlanetMatches(n,planet));
  if(!countries.length)return;ctx.save();ctx.strokeStyle='rgba(255,255,255,.96)';ctx.lineWidth=Math.max(1.2,(political?2.3:1.8)*planetView.zoom);ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=4;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
  for(const c of countries){const segs=normalizeCountryBorderSegments(c.countryBorderSegments);if(segs.length){for(const seg of segs)drawProjectedBorderLine(ctx,w,h,countryBorderLatLonEndpoint(seg,0),countryBorderLatLonEndpoint(seg,1))}else if(planet.planetProceduralBorders){const pts=proceduralCountryBorder(c);for(let i=0;i<pts.length;i++)drawProjectedBorderLine(ctx,w,h,pts[i],pts[(i+1)%pts.length])}}
  ctx.stroke();
  if(political){
    ctx.shadowBlur=4;ctx.font=`700 ${Math.max(10,12*planetView.zoom)}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';
    for(const c of countries){const P=planetProject(c.surfaceLat??0,c.surfaceLon??0,w,h);if(!P.front)continue;ctx.fillStyle='rgba(255,255,255,.97)';ctx.fillText(c.name,P.x,P.y)}
  }
  ctx.restore()
}

const v282PlanetIconImages=new Map();
function v282PlanetIconImage(symbolId){
  const sym=symbolById(symbolId);if(!sym?.data)return null;
  if(v282PlanetIconImages.has(symbolId))return v282PlanetIconImages.get(symbolId);
  const img=new Image();img.onload=()=>requestPlanetDraw();img.src=sym.data;v282PlanetIconImages.set(symbolId,img);return img
}
function drawPlanetPlaceIcons(ctx,w,h){
  const planet=activeSurfacePlanetNode();if(!planet)return;
  const canvas=$('planetCanvas');if(canvas)canvas._planetPlaceIcons=[];
  const items=nodes.filter(n=>n.type==='place'&&!n.isHub&&n.surfacePlanetId===planet.id&&placeHasPlanetIcon(n));ctx.save();
  for(const place of items){
    const P=planetProject(place.surfaceLat??0,place.surfaceLon??0,w,h);if(!P.front)continue;
    const size=Math.max(18,Math.min(34,22*planetView.zoom)),img=place.placeIconSymbolId?v282PlanetIconImage(place.placeIconSymbolId):null;
    ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=6;ctx.fillStyle='rgba(7,14,22,.82)';ctx.strokeStyle='rgba(225,242,255,.88)';ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(P.x,P.y,size*.64,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
    if(img?.complete&&img.naturalWidth){ctx.drawImage(img,P.x-size*.46,P.y-size*.46,size*.92,size*.92)}
    else{ctx.fillStyle='#f4fbff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`700 ${Math.max(10,size*.46)}px system-ui`;ctx.fillText(String(place.placeIconText||'◆').slice(0,5),P.x,P.y)}
    // Planet-level labels remain. Only the Surface-level floating Place label was removed.
    ctx.fillStyle='rgba(238,247,255,.92)';ctx.font='600 9px system-ui';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(place.name,P.x,P.y+size*.72);
    if(canvas)canvas._planetPlaceIcons.push({place,x:P.x,y:P.y,r:size*.82})
  }
  ctx.restore()
}
function drawPlanet(){
  if(mapDisplayLevel()!=='surface'&&mapDisplayLevel()!=='place')hideSurfaceWebGLLayers();
  if(mapDisplayLevel()==='surface'||mapDisplayLevel()==='place'){const canvas=$('planetCanvas'),modal=$('simulationModal');if(!canvas||!modal||modal.classList.contains('hidden'))return;renderSurfaceView(canvas);return}
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

  drawCountryBorders(ctx,r.width,r.height);

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

  // Authored Place icons live directly on the Planet level.
  drawPlanetPlaceIcons(ctx,r.width,r.height);

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
  const captionBtn=$('togglePlaceCaptions');if(captionBtn&&!captionBtn.dataset.bound){captionBtn.dataset.bound='1';captionBtn.onclick=()=>{surfaceView.captions=surfaceView.captions===false;captionBtn.classList.toggle('active',surfaceView.captions!==false);captionBtn.textContent=surfaceView.captions===false?'Aa̶':'Aa';requestPlanetDraw()};captionBtn.classList.toggle('active',surfaceView.captions!==false)}
  const politicalBtn=$('togglePoliticalMap');if(politicalBtn&&!politicalBtn.dataset.bound){politicalBtn.dataset.bound='1';politicalBtn.onclick=()=>{planetView.political=!planetView.political;politicalBtn.classList.toggle('active',planetView.political);politicalBtn.textContent=planetView.political?'⚑ Political':'⚐ Political';requestPlanetDraw()};politicalBtn.classList.toggle('active',!!planetView.political)}
  const c=$('planetCanvas');if(!c||c._v16Bound)return;c._v16Bound=true;

  c.addEventListener('contextmenu',e=>e.preventDefault());

  c.addEventListener('pointerdown',e=>{
    if(mapDisplayLevel()==='surface'||mapDisplayLevel()==='place'){
      const r=c.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
      const hit=[...(c._surfacePlaces||[])].reverse().find(v=>Math.hypot(mx-v.x,my-v.y)<v.r);
      const tool=v287qSurfaceTool(),hitScale=tool==='drag'?2.45:1,
            structureHit=[...(c._surfaceStructures||[])].reverse().find(v=>Math.hypot(mx-v.x,my-v.y)<Math.max(v.r*hitScale,tool==='drag'?48:v.r));
      const right=e.button===2;
      if(right){
        const now=performance.now();if(now-(surfaceView.lastRightDown||0)<360){surfaceView.lastRightDown=0;backScaleLevel();return}surfaceView.lastRightDown=now
      }
      if(!right&&tool==='weather'){const point=v287qGroundPointFromClient(c,e.clientX,e.clientY);if(point)v287qSeedWeatherAt(point.x,point.z);e.preventDefault();return}
      c.__surfacePointer={x:e.clientX,y:e.clientY,startClientX:e.clientX,startClientY:e.clientY,hitId:hit?.place?.id||null,structureKey:structureHit?.key||null,button:e.button,moved:false,tool};c.__surfacePointer.worldBasis=surface3DGroundScreenBasis(c,{x:surfaceView.cameraX||0,z:surfaceView.cameraZ||0});if(hit?.place)c.__surfacePointer.placeStart={lat:hit.place.surfaceLat??surfaceView.lat,lon:hit.place.surfaceLon??surfaceView.lon,rel:placeSurfaceRelative(hit.place)};
      if(!right&&tool==='drag'&&structureHit){
        surfaceView.dragStructureKey=structureHit.key;
        const owner=structureHit.place,center=mapDisplayLevel()==='place'?{x:0,z:0}:placeSurfaceRelative(owner),cur=owner?.structurePlacementOffsets?.[structureHit.key]||{x:structureHit.rel.x-center.x,z:structureHit.rel.z-center.z};
        c.__surfacePointer.structureOwnerId=owner?.id||null;c.__surfacePointer.structureStart={x:+cur.x||0,z:+cur.z||0};c.__surfacePointer.structureBasis=surface3DGroundScreenBasis(c,structureHit.rel)
      }else if(!right&&tool==='drag'&&hit&&mapDisplayLevel()==='surface')surfaceView.dragPlaceId=hit.place.id;
      c.setPointerCapture?.(e.pointerId);e.preventDefault();return
    }
    const r=c.getBoundingClientRect();
    const mx=e.clientX-r.left,my=e.clientY-r.top;

    if(mapDisplayLevel()==='planet'&&e.button===0){
      const iconHit=[...(c._planetPlaceIcons||[])].reverse().find(v=>Math.hypot(mx-v.x,my-v.y)<=v.r);
      if(iconHit){
        c.__planetIconDrag={place:iconHit.place,pointerId:e.pointerId,moved:false,startX:e.clientX,startY:e.clientY};
        c.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        return
      }
    }

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
    if((mapDisplayLevel()==='surface'||mapDisplayLevel()==='place')&&c.__surfacePointer){
      const st=c.__surfacePointer,dx=e.clientX-st.x,dy=e.clientY-st.y;st.x=e.clientX;st.y=e.clientY;if(Math.abs(dx)+Math.abs(dy)>1)st.moved=true;
      if(st.button===2){surfaceView.yaw+=dx*.009;surfaceView.pitch=Math.max(.08,Math.min(1.08,(surfaceView.pitch??.3)+dy*.006))}
      else if(surfaceView.dragStructureKey){
        const owner=byId(st.structureOwnerId),ent=(c._surfaceStructures||[]).find(v=>v.key===surfaceView.dragStructureKey);
        if(owner&&ent){owner.structurePlacementOffsets=owner.structurePlacementOffsets||{};const B=st.structureBasis,S=st.structureStart,D=B?v285SolveScreenBasis(e.clientX-st.startClientX,e.clientY-st.startClientY,B.ax,B.ay,B.bx,B.by):null;if(D&&S)owner.structurePlacementOffsets[ent.key]={x:S.x+D.x,z:S.z+D.z}}
      }
      else if(surfaceView.dragPlaceId&&mapDisplayLevel()==='surface'){const p=byId(surfaceView.dragPlaceId),B=st.worldBasis,S=st.placeStart,D=B?v285SolveScreenBasis(e.clientX-st.startClientX,e.clientY-st.startClientY,B.ax,B.ay,B.bx,B.by):null;if(p&&S&&D){p.surfaceLon=S.lon+D.x/(28*Math.cos(surfaceView.lat)||28);p.surfaceLat=S.lat-D.z/28}}
      else if(st.tool==='move'){const B=st.worldBasis,D=B?v285SolveScreenBasis(e.clientX-st.startClientX,e.clientY-st.startClientY,B.ax,B.ay,B.bx,B.by):null;if(D){surfaceView.cameraX=(st.cameraStartX??(st.cameraStartX=surfaceView.cameraX||0))-D.x;surfaceView.cameraZ=(st.cameraStartZ??(st.cameraStartZ=surfaceView.cameraZ||0))-D.z}}
      requestPlanetDraw();e.preventDefault();return
    }
    if(c.__planetIconDrag&&c.__planetIconDrag.pointerId===e.pointerId){
      const drag=c.__planetIconDrag,point=inversePlanetScreenPoint(c,e.clientX,e.clientY);
      if(point){
        drag.place.surfaceLat=point.lat;
        drag.place.surfaceLon=point.lon;
        drag.moved ||= Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>2;
        requestPlanetDraw()
      }
      e.preventDefault();
      return
    }
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
    if((mapDisplayLevel()==='surface'||mapDisplayLevel()==='place')&&c.__surfacePointer){
      const movedId=surfaceView.dragPlaceId,movedStructure=surfaceView.dragStructureKey;surfaceView.dragPlaceId=null;surfaceView.dragStructureKey=null;c.__surfacePointer=null;c.releasePointerCapture?.(e.pointerId);if(movedId||movedStructure)save();requestPlanetDraw();return
    }
    if(c.__planetIconDrag&&c.__planetIconDrag.pointerId===e.pointerId){
      const moved=c.__planetIconDrag.moved;
      c.__planetIconDrag=null;
      c.releasePointerCapture?.(e.pointerId);
      if(moved)save();
      requestPlanetDraw();
      return
    }
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
    if(c.__planetIconDrag&&c.__planetIconDrag.pointerId===e.pointerId)c.__planetIconDrag=null;
    if(strategicMegaDrag&&strategicMegaDrag.pointerId===e.pointerId)strategicMegaDrag=null;
    planetView.drag=false
  });

  c.addEventListener('dblclick',e=>{
    if(mapDisplayLevel()==='planet'){const point=inversePlanetScreenPoint(c,e.clientX,e.clientY);if(point)enterSurfaceView(point.lat,point.lon);return}
    if(mapDisplayLevel()==='surface'){const r0=c.getBoundingClientRect(),mx0=e.clientX-r0.left,my0=e.clientY-r0.top;const H=[...(c._surfacePlaces||[])].reverse().find(v=>Math.hypot(mx0-v.x,my0-v.y)<v.r);if(H)enterPlaceFromSurface(H.place);return}
    if(mapDisplayLevel()==='place')return;
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
  c.addEventListener('contextmenu',e=>{e.preventDefault();if(mapDisplayLevel()!=='surface'&&mapDisplayLevel()!=='place'&&mapDisplayLevel()!=='planet'&&scaleNav.path.length)backScaleLevel()});
  c.addEventListener('wheel',e=>{
    e.preventDefault();
    if(mapDisplayLevel()==='surface'||mapDisplayLevel()==='place'){
      const current=mapDisplayLevel(),old=surfaceView.zoom,requested=old*Math.exp(-e.deltaY*.001);
      if(e.deltaY>0&&old<=.451&&requested<.45){backScaleLevel();return}
      // v28.2: scrolling NEVER enters a Place. Entry is double-click only.
      surfaceView.zoom=Math.max(.45,Math.min(6,requested));requestPlanetDraw();return
    }
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
    if(e.deltaY<0&&oldZoom>=3.79&&requested>3.8){
      const point=inversePlanetScreenPoint(c,e.clientX,e.clientY);
      if(point){enterSurfaceView(point.lat,point.lon);return}
    }
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
  const entries=[],path=scaleNav.path||[],items=path.map(p=>p.item).filter(Boolean);
  const hasGalaxy=items.some(item=>String((item.sourceId?byId(item.sourceId):null)?.placeScale||'')==='galaxy');
  if(simState.civ&&!hasGalaxy)entries.push({name:simState.civ,depth:-1,level:systemScale()});
  path.forEach((step,i)=>entries.push({name:step.item?.name||'Unknown',depth:i,level:step.level}));
  const current=mapDisplayLevel();
  if(current==='planet'){
    const n=simState.planetOverride?.name||simState.planet?.name;if(n&&entries.at(-1)?.name!==n)entries.push({name:n,depth:path.length,level:'planet'})
  }else if(current==='surface'){
    const n=simState.planetOverride?.name||simState.planet?.name;if(n&&entries.at(-1)?.name!==n)entries.push({name:n,depth:path.length,level:'planet'});
    entries.push({name:(surfaceView.biome||'Surface').replaceAll('-',' '),depth:path.length+1,level:'surface'})
  }else if(current==='place'){
    const n=simState.planetOverride?.name||simState.planet?.name;
    if(n&&!entries.some(e=>e.level==='planet'&&e.name===n))entries.push({name:n,depth:path.length,level:'planet'});
    if(!entries.some(e=>e.level==='surface'))entries.push({name:(surfaceView.biome||'Surface').replaceAll('-',' '),depth:path.length+1,level:'surface'});
    const p=byId(surfaceView.focusPlaceId||scaleNav.selected?.sourceId);if(p)entries.push({name:p.name,depth:path.length+2,level:'place'})
  }
  if(!entries.length)entries.push({name:systemScaleLabel(),depth:-1,level:systemScale()});
  return entries
}
function travelToBreadcrumbDepth(depth){
  if(depth<0){scaleNav.level=systemScale();scaleNav.path=[];scaleNav.camera={x:.5,y:.5,zoom:1};simState.planetOverride=null;if(mapDisplayLevel()==='planet')ensurePlanet();else generateScaleMap();refreshWorldMapMode();renderGalacticCoordinates();requestPlanetDraw();return}
  const items=(scaleNav.path||[]).map(p=>p.item).filter(Boolean).slice(0,depth+1);
  scaleNav.level=systemScale();scaleNav.path=[];scaleNav.camera={x:.5,y:.5,zoom:1};simState.planetOverride=null;if(mapDisplayLevel()!=='planet')generateScaleMap();
  for(const item of items){const next=hierarchyChildLevel(mapDisplayLevel());if(!next)break;if(next==='planet'){enterPlanetFromMap(item);break}childMapFor(item)}
  refreshWorldMapMode();renderGalacticCoordinates();requestPlanetDraw()
}
function travelToCoordinateEntry(entry){
  if(!entry)return;
  const current=mapDisplayLevel();
  if(entry.level==='place')return;
  if(entry.level==='surface'){
    if(current==='place'){backScaleLevel();return}
    if(current==='surface')return
  }
  if(entry.level==='planet'&&(current==='surface'||current==='place')){
    while(mapDisplayLevel()==='place'||mapDisplayLevel()==='surface')backScaleLevel();
    return
  }
  travelToBreadcrumbDepth(entry.depth)
}
function renderGalacticCoordinates(){
  const el=$('galacticCoordinates');if(!el)return;
  const entries=coordinateEntries();
  el.innerHTML=entries.map((e,i)=>`<button class="galactic-crumb" data-coordinate-index="${i}">${E.esc(e.name)}</button>${i<entries.length-1?'<span>›</span>':''}`).join('');
  el.querySelectorAll('[data-coordinate-index]').forEach(b=>b.onclick=()=>travelToCoordinateEntry(entries[+b.dataset.coordinateIndex]))
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
  const pool=[],positiveSpells=ctx.spells.filter(x=>(x.morality??0)>=-15),s=pick(positiveSpells),s2=pick(positiveSpells.filter(x=>x!==s)),anySpell=pick(ctx.spells),m=pick(ctx.materials),t=pick(ctx.tools),tech=pick(ctx.techniques),p=pick(ctx.principles),r=pick(ctx.rules),cls=pick(ctx.classes),region=pick(simState.regions);
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
  if(cls&&nodes.some(s=>s.type==='spell'&&!s.isHub&&(s.spellClass||'Unclassified')===cls&&(s.morality??0)>=-15))pool.push(()=>event('Institution',`The ${cls} Academy is founded`,`Practitioners establish a permanent academy for ${cls} magic. The discipline now has formal teachers, exams, archives, and professional standards.`,['Institution',cls],{knowledge:4,stability:3,economy:1},'major',[`Spell Class ${cls} exists`]));
  if(m&&t)pool.push(()=>event('Industry','Arcane manufacturing expands',`Workshops combine ${m.name} with ${t.name}. Standardized magical components create an increasingly specialized industrial sector.`,['Industry',m.name,t.name],{economy:7,technology:4,danger:1},'major',[`A Tool and Material coexist in the system`]));
  if(t&&chance(.22))pool.push(()=>event('Accident',`${t.name} accident triggers regulation`,`A serious failure involving ${t.name} exposes weaknesses in magical safety standards. Certification and inspection become political issues.`,['Accident',t.name],{stability:-4,danger:6,economy:-2},'crisis',[`Widespread tool use`,`Arcane risk exists`]));
  if(s&&chance(.22))pool.push(()=>event('Infrastructure',`${s.name} enters public infrastructure`,`Engineers make ${s.name} reliable enough for civic use. Services begin depending on a spell once treated as specialist magic.`,['Infrastructure',s.name],{economy:6,stability:4,technology:3},'major',[`Spell has reached mass adoption`]));
  if(anySpell&&chance(.14))pool.push(()=>event('Disaster',`A ${anySpell.spellClass||'magical'} cascade`,`A large-scale magical failure involving ${anySpell.name} spreads farther than expected. The event becomes a defining safety case study.`,['Disaster',anySpell.name],{population:-.012,stability:-8,economy:-5,danger:9,knowledge:4},'crisis',[`High-impact spell use`,`Safety systems failed`]));
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
  addCreatorTimelineEvents(pool);
  if(!pool.length)return event('Founding','Mana becomes a field of study','Civilization begins systematic study of Mana, but there are not yet enough defined magical concepts for specialized institutions to emerge.',['Mana'],{knowledge:2},'normal',['Only Mana is currently defined']);
  return pick(pool)()
}
function postEventEmergence(ev){
  const ctx=simContext();
  if(ev.kind==='Institution'){
    const cls=ev.tags.find(t=>ctx.classes.includes(t))||pick(ctx.classes)||'Magic';
    if(nodes.some(s=>s.type==='spell'&&!s.isHub&&(s.spellClass||'Unclassified')===cls&&(s.morality??0)>=-15))createInstitution(`${cls} Academy`,'Academy',cls,pick(simState.regions)?.name)
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
  if(util.utilityType==='disease'&&linked.length&&(util.diseaseKind||'Disease')!=='Symptom'){
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
graph.onSelect=n=>{const canonical=n?.id?byId(n.id):null;selectNode(canonical||n)};
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

// ===================== V23 READABLE SAVE CONVERTER =====================

function readableScalar(value){
  if(value==null)return'';
  if(Array.isArray(value))return value.map(readableScalar).filter(Boolean).join('; ');
  if(typeof value==='object')return'';
  return civilizationSymbolPlainText
    ?civilizationSymbolPlainText(String(value))
    :String(value)
}

function readableLine(label,value,indent='- '){
  const text=readableScalar(value).trim();
  return text?`${indent}${label} - ${text}`:''
}

function readableNodeTypeLabel(type){
  return({
    spell:'Spells',
    rule:'Rules',
    material:'Materials',
    magicalObject:'Magical Objects',
    technique:'Techniques',
    principle:'Principles',
    structure:'Structures',
    organization:'Organizations',
    life:'Life',
    place:'Places',
    civilizationUtil:'Civilization Utils'
  })[type]||String(type||'Other')
}

function readableUtilityDetails(n){
  const out=[];
  const subtype=n.utilityType||'utility';

  out.push(readableLine('Type',utilitySubtypeLabel?.(subtype)||subtype));

  if(subtype==='language'){
    out.push(readableLine('Direction',n.languageDirection));
    const groups=n.languageMappingGroups||{};
    const labels={
      symbolSymbol:'Symbol → Symbol',
      symbolSound:'Symbol → Sound',
      wordWord:'Word → Word',
      phrasePhrase:'Phrase → Phrase'
    };
    for(const [key,label] of Object.entries(labels)){
      const rows=groups[key]||[];
      if(rows.length){
        out.push(`- ${label}`);
        for(const row of rows){
          out.push(`  - ${readableScalar(row.from)} → ${readableScalar(row.to)}`)
        }
      }
    }
  }

  if(subtype==='currency'){
    out.push(
      readableLine('Symbol',n.currencySymbol),
      readableLine('USD Equivalent',n.usdEquivalent),
      readableLine('Subdivision',n.currencySubdivision),
      readableLine('Form',n.currencyForm),
      readableLine('Stability',n.currencyStability),
      readableLine('Backing',n.currencyBacking)
    )
  }

  if(subtype==='disease'){
    out.push(
      readableLine('Spread',n.diseaseSpread),
      readableLine('Severity',n.diseaseSeverity),
      readableLine('Duration',n.diseaseDuration),
      readableLine('Mortality',n.diseaseMortality!=null?`${n.diseaseMortality}%`:''),
      readableLine('Cure',n.diseaseCure),
      readableLine('Origin',n.diseaseOrigin),
      readableLine('Genetic String',n.diseaseGenome)
    )
  }

  if(subtype==='calendar'){
    out.push(
      readableLine('Days',n.calendarDays),
      readableLine('Months',n.calendarMonths),
      readableLine('Era',n.calendarEra),
      readableLine('Holidays',n.calendarHolidays)
    )
  }

  if(subtype==='measurement'){
    out.push(
      readableLine('Distance',n.measurementDistance),
      readableLine('Mass',n.measurementMass),
      readableLine('Temperature',n.measurementTemperature)
    )
  }

  if(subtype==='legalCode'){
    out.push(
      readableLine('Laws',n.legalLaws),
      readableLine('Rights',n.legalRights),
      readableLine('Enforcement',n.legalEnforcement)
    )
  }

  if(subtype==='rankSystem'){
    out.push(
      readableLine('Ranks',n.rankEntries),
      readableLine('Promotion',n.rankPromotion)
    )
  }

  if(subtype==='communication'){
    out.push(
      readableLine('Medium',n.communicationMedium),
      readableLine('Range',n.communicationRange),
      readableLine('Latency',n.communicationLatency)
    )
  }

  if(subtype==='naming'){
    out.push(
      readableLine('Given Names',n.namingGiven),
      readableLine('Family Names',n.namingFamily),
      readableLine('Examples',n.namingExamples)
    )
  }

  out.push(readableLine('Description',n.description));
  return out.filter(Boolean)
}

function readableCraftingRecipeLines(n,project){
  const g=n?.craftingRecipe?.graph;
  if(!g||!Array.isArray(g.nodes)||!Array.isArray(g.links)||!g.nodes.length)return[];
  const all=(project?.nodes||[]).filter(Boolean),by=id=>all.find(x=>x.id===id),map=new Map(g.nodes.map(x=>[x.id,x]));
  const name=x=>{if(!x)return'Unknown';if(x.kind==='product')return n.name||x.label||'Result';if(x.kind==='ingredient')return by(x.refId)?.name||x.label||'Material';return x.label||'Other'};
  const qty=x=>Math.max(1,Number(x?.qty)||1),qname=x=>`${readableScalar(qty(x))} ${readableScalar(name(x))}`;
  const processed=new Map(),tags=x=>processed.get(x.id)||[],state=x=>`${qname(x)}${tags(x).length?' '+tags(x).map(t=>`[${t}]`).join(' '):''}`;
  // The recipe notation intentionally uses the process name + ed (or + d after e).
  const past=p=>{p=String(p||'Process').trim();if(!p)return'Processed';return /e$/i.test(p)?p+'d':p+'ed'};
  const addTag=(x,label)=>{if(!x||x.kind!=='ingredient')return;const arr=[...tags(x)],tag=past(label);if(!arr.includes(tag))arr.push(tag);processed.set(x.id,arr)};
  const nonDirectIn=id=>g.links.filter(l=>l.b===id&&!l.direct).map(l=>map.get(l.a)).filter(Boolean);
  const nonDirectOut=id=>g.links.filter(l=>l.a===id&&!l.direct).map(l=>map.get(l.b)).filter(Boolean);
  const directAround=id=>g.links.filter(l=>l.direct&&(l.a===id||l.b===id)).map(l=>({l,other:map.get(l.a===id?l.b:l.a),out:l.a===id})).filter(x=>x.other);
  const lines=[],ingredients=g.nodes.filter(x=>x.kind==='ingredient'),temps=g.nodes.filter(x=>x.kind==='temporary'),processes=g.nodes.filter(x=>x.kind==='process');
  for(const x of ingredients)lines.push(`- Acquire ${qname(x)}`);
  for(const x of temps)lines.push(`- Grab ${readableScalar(name(x))}`);
  if(ingredients.length||temps.length)lines.push('');

  // Render process nodes first. Temporary helpers can be attached by ordinary process links
  // OR by a direct process↔helper link, which is common in older saved graphs.
  const processSources=new Map();
  for(const proc of processes){
    const linked=nonDirectIn(proc.id),direct=directAround(proc.id);
    const permanents=linked.filter(x=>x.kind==='ingredient');
    const helpers=[...linked.filter(x=>x.kind==='temporary'),...direct.map(x=>x.other).filter(x=>x.kind==='temporary')].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);
    processSources.set(proc.id,permanents);
    const action=readableScalar(proc.label||'Process');
    if(helpers.length&&permanents.length){
      // A helper/tool applies the process to each selected material independently.
      for(const src of permanents){
        const helper=helpers[0];
        lines.push(`* Get ${state(src)} and ${action} with the ${readableScalar(name(helper))}`);
        addTag(src,action)
      }
    }else if(permanents.length>1){
      // Multiple materials and no tool/helper = one combined process step.
      const [first,...rest]=permanents;
      lines.push(`* Get ${state(first)} and ${action} with ${rest.map(state).join(' and ')}`);
      permanents.forEach(x=>addTag(x,action))
    }else if(permanents.length===1){
      lines.push(`* Get ${state(permanents[0])} and ${action}`);
      addTag(permanents[0],action)
    }else{
      const meaningful=linked.filter(x=>x.kind!=='product'&&x.kind!=='process');
      for(const src of meaningful)lines.push(`* Get ${src.kind==='ingredient'?state(src):readableScalar(name(src))} and ${action}`)
    }
    // Carry process state into an authored ingredient node when the graph explicitly does so.
    const combined=[];for(const src of permanents)for(const t of tags(src))if(!combined.includes(t))combined.push(t);
    for(const dst of nonDirectOut(proc.id))if(dst.kind==='ingredient'&&combined.length)processed.set(dst.id,[...combined])
  }

  // Direct links are recipe operations. Several old graphs use process→tool→product as
  // routing; translate that to an operation on the processed material and suppress the
  // final bookkeeping link into the product.
  const consumedDirect=new Set();
  for(const proc of processes){
    const srcs=processSources.get(proc.id)||[];
    const primary=srcs[0];
    for(const {l,other,out} of directAround(proc.id)){
      if(other.kind!=='temporary'||!primary)continue;
      consumedDirect.add(l.id);
      const action=readableScalar(l.label||'Use');
      const helper=readableScalar(name(other));
      const phrase=/\b(into|onto|through|to|in|on)$/i.test(action)?`${action} the ${helper}`:`${action} with the ${helper}`;
      lines.push(`- Get ${state(primary)} and ${phrase}`);
      addTag(primary,action)
    }
  }

  for(const l of g.links.filter(l=>l.direct)){
    if(consumedDirect.has(l.id))continue;
    const a=map.get(l.a),b=map.get(l.b);if(!a||!b)continue;
    // Product links are terminal routing. A material→product direct action is still useful;
    // process/helper→product links are redundant because Results in already states the output.
    if(b.kind==='product'||a.kind==='product'){
      const other=b.kind==='product'?a:b,product=b.kind==='product'?b:a;
      if(other.kind==='process'||other.kind==='temporary')continue;
      const action=readableScalar(l.label||'Combine');
      const left=other.kind==='ingredient'?state(other):readableScalar(name(other));
      if(/\b(into|onto|to)$/i.test(action))lines.push(`- Get ${left} and ${action} ${readableScalar(name(product))}`);
      else lines.push(`- Get ${left} and ${action}`);
      if(other.kind==='ingredient')addTag(other,action);
      continue
    }
    if(a.kind==='process'||b.kind==='process')continue;
    const action=readableScalar(l.label||'Combine');
    const left=a.kind==='ingredient'?state(a):readableScalar(name(a));
    const right=b.kind==='ingredient'?state(b):readableScalar(name(b));
    lines.push(`- Get ${left} and ${action} with ${right}`);
    if(a.kind==='ingredient')addTag(a,action)
  }
  if(processes.length||g.links.some(l=>l.direct))lines.push('');
  lines.push(`- Results in ${readableScalar(n.name||'Result')}`);
  return lines
}

function readableNodeDetails(n,project){
  const out=[];

  switch(n.type){
    case'spell':
      out.push(
        readableLine('Intent',n.intent),
        readableLine('Structure',n.structure),
        readableLine('Target',n.target),
        readableLine('Output',n.output),
        readableLine('Duration',n.duration),
        readableLine('Range',n.range),
        readableLine('Source',n.source),
        readableLine('Extra attributes',n.extra)
      );
      break;

    case'rule':
      out.push(
        readableLine('Strength',n.strength),
        readableLine('Spell Class',n.spellClass),
        readableLine('Scope',n.scope),
        readableLine('Rule',n.text),
        readableLine('Description',n.description)
      );
      break;

    case'material':
      out.push(
        readableLine('Category',n.category),
        readableLine('Composition',n.composition),
        readableLine('Properties',n.property),
        readableLine('Requirements',n.requirements),
        readableLine('Uses',n.uses),
        readableLine('Interaction',n.interaction),
        readableLine('Description',n.description)
      );
      break;

    case'magicalObject':
      out.push(
        readableLine('Category',n.category),
        readableLine('Composition',n.composition),
        readableLine('Properties',n.property),
        readableLine('Requirements',n.requirements),
        readableLine('Uses',n.uses),
        readableLine('Interaction',n.interaction),
        readableLine('Description',n.description)
      );
      {const recipeLines=readableCraftingRecipeLines(n,project);if(recipeLines.length){out.push('- Recipe',...recipeLines)}}
      break;

    case'technique':
      out.push(
        readableLine('Category',n.category),
        readableLine('Requirements',n.requirements),
        readableLine('Uses',n.uses),
        readableLine('Interaction',n.interaction),
        readableLine('Description',n.description)
      );
      break;

    case'principle':
      out.push(
        readableLine('Category',n.category),
        readableLine('Property',n.property),
        readableLine('Interaction',n.interaction),
        readableLine('Description',n.description)
      );
      break;

    case'structure':{
      const model=n.isMegastructure?null:normalizeScene3DModel(n.structureModel),
            active=model?.variants?.find(v=>v.id===model.activeVariantId),
            variantSummary=model?.variants?.map((v,i)=>{
              const visible=(v.parts||[]).filter(p=>p&&!p.hidden),
                    kinds=[...new Set(visible.map(p=>p.kind||'Cube'))];
              return `${i+1}. ${v.name||`Variant ${i+1}`} — ${visible.length} object${visible.length===1?'':'s'}${kinds.length?` [${kinds.join(', ')}]`:''}${v.id===model.activeVariantId?' (active)':''}`
            })||[],
            rep=model?.repetition||{},
            repSummary=model
              ?rep.enabled
                ?`${rep.mode||'grid'} · ${scene3DRepeatInstances(model).length} instance${scene3DRepeatInstances(model).length===1?'':'s'} · variant mode ${rep.variantMode||'active'}`
                :'Off · 1 instance'
              :'';

      out.push(
        readableLine('Category',n.category),
        readableLine('Composition',n.composition),
        readableLine('Purpose / Property',n.property),
        readableLine('Requirements',n.requirements),
        readableLine('Interaction',n.interaction),
        readableLine('3D Model Environment',model?.environment),
        readableLine('3D Active Variant',active?.name),
        readableLine('3D Variant Count',model?.variants?.length),
        readableLine('3D Variants',variantSummary),
        readableLine('3D Repetition',repSummary),
        readableLine('Variant of Structure',n.variantOfStructureId),
        readableLine('Description',n.description)
      );
      break;
    }

    case'organization':
      out.push(
        readableLine('Type',n.organizationType||n.category),
        readableLine('Purpose',n.organizationPurpose||n.property),
        readableLine('Members',n.organizationMembers),
        readableLine('Inhabitants',n.organizationInhabitants),
        readableLine('Capital',n.organizationCapital),
        readableLine('Resources',n.organizationResources),
        readableLine('Description',n.description)
      );
      break;

    case'life':
      out.push(
        readableLine('Category',n.category),
        readableLine('Role',[
          n.main?'Main':null,
          n.sentient?'Sentient':null,
          n.individual?'Individual':null
        ].filter(Boolean)),
        readableLine('Composition',n.composition),
        readableLine('Properties',n.property),
        readableLine('Requirements',n.requirements),
        readableLine('Uses',n.uses),
        readableLine('Interaction',n.interaction),
        readableLine('Description',n.description)
      );
      break;

    case'place':
      out.push(
        readableLine('Type',n.placeType),
        readableLine('Scale',n.placeScale),
        readableLine('Inhabitants',n.inhabitants),
        readableLine('Government',n.government),
        readableLine('Access',n.access),
        readableLine('Associations',n.associations),
        readableLine('Interaction',n.interaction),
        readableLine('Description',n.description)
      );
      break;

    case'civilizationUtil':
      return readableUtilityDetails(n);
  }

  return out.filter(Boolean)
}

function readableNodeHeading(n){
  const name=readableScalar(n.name)||'Unnamed';

  if(n.isSemiHub)return`- ${name} -`;

  if(n.type==='spell'){
    return`- ${name}${n.spellClass?` - [${readableScalar(n.spellClass)}]`:''}`
  }

  if(n.type==='organization'){
    return`- ${name}${n.organizationType?` - [${readableScalar(n.organizationType)}]`:''}`
  }

  if(n.type==='place'){
    return`- ${name}${n.placeType?` - [${readableScalar(n.placeType)}]`:''}`
  }

  if(n.type==='civilizationUtil'){
    return`- ${name}${n.utilityType?` - [${readableScalar(utilitySubtypeLabel?.(n.utilityType)||n.utilityType)}]`:''}`
  }

  return`- ${name}`
}

function readableConnectionsForNode(n,project){
  const allNodes=(project?.nodes||[]).filter(Boolean);
  const allEdges=(project?.edges||[]).filter(e=>e&&!e.blocked);
  const nodeById=id=>allNodes.find(x=>x.id===id);

  const rows=[];
  const seen=new Set();

  for(const e of allEdges){
    if(e.a!==n.id&&e.b!==n.id)continue;
    const outgoing=e.a===n.id;
    const other=nodeById(outgoing?e.b:e.a);
    if(!other||other.virtual)continue;

    const label=readableScalar(e.label||e.type||'related to').trim()||'related to';
    const otherName=readableScalar(other.name||'Unnamed');
    let arrow='↔';
    if(e.direction==='forward')arrow=outgoing?'→':'←';
    else if(e.direction==='backward')arrow=outgoing?'←':'→';

    const key=`${label}|${arrow}|${other.id}`;
    if(seen.has(key))continue;
    seen.add(key);
    rows.push(`  - ${label} ${arrow} ${otherName}`)
  }

  return rows
}

function readableNodeBlock(n,project){
  const lines=[readableNodeHeading(n)];
  const details=readableNodeDetails(n,project);
  lines.push(...details);

  const connections=readableConnectionsForNode(n,project);
  if(connections.length){
    lines.push('- Connections');
    lines.push(...connections)
  }

  return lines.join('\n')
}

function readableHubMembersFromData(hub,allNodes){
  const h=String(hub?.name||'').trim().toLowerCase();
  if(!h)return[];

  const parts=v=>String(v||'')
    .toLowerCase()
    .split(/[;,|]/)
    .map(x=>x.trim())
    .filter(Boolean);

  return allNodes.filter(n=>{
    if(!n||n.virtual||n.isHub||n.type==='mana'||n.id===hub.id)return false;
    if(parts(n.category).includes(h)||String(n.category||'').trim().toLowerCase()===h)return true;

    const fields=[
      n.uses,n.compatibility,n.requirements,n.composition,n.interaction,
      n.description,n.property,n.extra,n.scope,n.spellClass,n.text
    ];

    return fields.some(v=>
      parts(v).includes(h)||String(v||'').trim().toLowerCase()===h
    )
  })
}

function buildReadableProjectText(project){
  const allNodes=(project?.nodes||[])
    .filter(n=>n&&!n.virtual);

  const mana=allNodes.find(n=>n.type==='mana'||n.id==='mana');
  const title=readableScalar(mana?.name||'MANA');

  const lines=[
    `-- ${title} --`,
    ''
  ];

  const hubs=allNodes.filter(n=>n.isHub&&n.type!=='mana');
  const claimed=new Set();

  // Full Hubs become independent mini-sections.
  for(const hub of hubs){
    lines.push(`-- ${readableScalar(hub.name)} --`);
    lines.push('');

    const members=readableHubMembersFromData(hub,allNodes);
    if(!members.length){
      lines.push('(No members)');
    }else{
      for(const member of members){
        claimed.add(member.id);
        lines.push(readableNodeBlock(member,project));
        lines.push('')
      }
    }
    claimed.add(hub.id);
    lines.push('')
  }

  const typeOrder=[
    'spell','rule','material','magicalObject','technique',
    'principle','structure','organization','life','place','civilizationUtil'
  ];

  for(const type of typeOrder){
    const list=allNodes.filter(n=>
      n.type===type &&
      !n.isHub &&
      !claimed.has(n.id)
    );

    if(!list.length)continue;

    lines.push(`-- ${readableNodeTypeLabel(type)} --`);
    lines.push('');

    for(const n of list){
      lines.push(readableNodeBlock(n,project));
      lines.push('')
    }

    lines.push('')
  }

  // Any future/unknown node types still survive readable export.
  const known=new Set(['mana',...typeOrder]);
  const other=allNodes.filter(n=>!known.has(n.type)&&!n.isHub&&!claimed.has(n.id));
  if(other.length){
    lines.push('-- Other --');
    lines.push('');
    for(const n of other){
      lines.push(readableNodeBlock(n,project));
      lines.push('')
    }
  }

  return lines
    .join('\n')
    .replace(/\n{4,}/g,'\n\n\n')
    .trim()+'\n'
}

function downloadReadableProject(project,filename='magic-system-readable.txt'){
  const text=buildReadableProjectText(project);
  const blob=new Blob([text],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),700)
}

function currentReadableProject(){
  return{
    format:'MagicSystemSandbox',
    version:'28.7bl',
    schemaVersion:28950,
    nodes:v287pProjectNodesForSave(),
    edges
  }
}

async function convertSaveFileToReadable(file){
  const data=JSON.parse(await file.text());
  if(!Array.isArray(data.nodes)){
    throw new Error('This file does not contain a Magic System Sandbox node list.')
  }

  const base=String(file.name||'magic-system')
    .replace(/\.(magicgraph|json)$/i,'')
    .replace(/[^\w\- ]+/g,'')
    .trim()||'magic-system';

  downloadReadableProject(data,`${base}-readable.txt`)
}

function exportProject(){
  const payload={
    format:'MagicSystemSandbox',
    version:'28.7bl',
    schemaVersion:28950,
    savedAt:new Date().toISOString(),
    nodes:v287pProjectNodesForSave(),edges,physicsSettings,autoConnections,technologySettings,creatorSettings,
    civilizationSymbols,
    worldStateCache,
    simState:typeof simState==='undefined'?null:simState,
    scaleNav:typeof scaleNav==='undefined'?null:{
      level:scaleNav.level,path:scaleNav.path,camera:scaleNav.camera,selected:scaleNav.selected
    }
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(creatorSettings.name||'creator').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-v28.7bl.magicgraph';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),500)
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
    technologySettings={...technologySettings,...(d.technologySettings||{})};

    if(Array.isArray(d.civilizationSymbols)){
      civilizationSymbols=d.civilizationSymbols;
      saveCivilizationSymbols()
    }

    // New V22.8 saves can carry richer simulation/world state, while older
    // V15/V16/etc. files remain valid because every field is optional.
    if(d.worldStateCache&&typeof d.worldStateCache==='object'){
      worldStateCache=d.worldStateCache
    }
    if(d.simState&&typeof simState!=='undefined'){
      Object.assign(simState,d.simState)
    }

    // Legacy project files did not carry viewer/simulation state, so they
    // still get the old safe reset behavior. Modern V22.8 exports restore it.
    if(!d.worldStateCache){
      worldStateCache={maps:{},planets:{}}
    }

    if(typeof simState!=='undefined'&&!d.simState){
      simState.spaceMap=null;
      simState.planet=null;
      simState.planetOverride=null;
      simState.locations=[]
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
$('planetHome').onclick=()=>{if(mapDisplayLevel()==='surface'||mapDisplayLevel()==='place'){surfaceView.cameraX=0;surfaceView.cameraZ=0;surfaceView.zoom=1;surfaceView.focusPlaceId=null;if(mapDisplayLevel()==='place')scaleNav.level='surface';refreshWorldMapMode();renderGalacticCoordinates();requestPlanetDraw();return}planetView.yaw=0;planetView.pitch=-.12;planetView.zoom=1;planetView.panX=0;planetView.panY=0;requestPlanetDraw()};
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
let symbolRedoStack=[];let symbolSelection=null,symbolHover=null,symbolLasso=[];

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
  const r=symbolCanvas.getBoundingClientRect();let x=(ev.clientX-r.left)*symbolCanvas.width/r.width,y=(ev.clientY-r.top)*symbolCanvas.height/r.height;
  const px=Math.max(1,+$('symbolPixelSize')?.value||8);if($('symbolPixelate')?.checked||$('symbolSnap')?.checked){x=Math.round(x/px)*px;y=Math.round(y/px)*px}
  return{x,y}
}
function constrainedSymbolPoint(a,b){if(!a||!b)return b;const dx=b.x-a.x,dy=b.y-a.y;return Math.abs(dx)>=Math.abs(dy)?{x:b.x,y:a.y}:{x:a.x,y:b.y}}

function symbolPaintStyle(ctx=symbolCtx){
  ctx.lineWidth=+$('symbolWidth')?.value||10;const shape=+$('symbolBrushShape')?.value||50,sharp=$('symbolPixelate')?.checked||shape>=60;ctx.lineCap=sharp?'butt':'round';ctx.lineJoin=sharp?'miter':'round';ctx.strokeStyle=value('symbolColor')||'#f1f5ff';ctx.fillStyle=value('symbolColor')||'#f1f5ff'
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
function symbolOverlay(){return $('symbolOverlayCanvas')?.getContext('2d')}
function clearSymbolOverlay(){const o=$('symbolOverlayCanvas'),x=o?.getContext('2d');if(x)x.clearRect(0,0,o.width,o.height)}
function drawSymbolSelectionOverlay(){const o=$('symbolOverlayCanvas'),x=symbolOverlay();if(!o||!x)return;clearSymbolOverlay();if(symbolSelection){x.save();x.fillStyle='rgba(93,201,255,.18)';x.strokeStyle='rgba(130,225,255,.95)';x.lineWidth=2;x.setLineDash([5,4]);x.beginPath();if(symbolSelection.mode==='rect'){const a=symbolSelection.a,b=symbolSelection.b;x.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y))}else{const pts=symbolSelection.points||[];if(pts.length){x.moveTo(pts[0].x,pts[0].y);for(const p of pts.slice(1))x.lineTo(p.x,p.y);x.closePath()}}x.fill();x.stroke();x.restore()}else if(symbolHover&&['brush','eraser'].includes(symbolTool)){const w=+$('symbolWidth')?.value||10,shape=+$('symbolBrushShape')?.value||50;x.save();x.globalAlpha=.42;x.fillStyle=symbolTool==='eraser'?'#ff8f8f':(value('symbolColor')||'#f1f5ff');x.beginPath();if(shape<50)x.arc(symbolHover.x,symbolHover.y,w/2,0,Math.PI*2);else x.rect(symbolHover.x-w/2,symbolHover.y-w/2,w,w);x.fill();x.restore()}}
function renderSymbolPreviewShape(pt,commit=false){const x=commit?symbolCtx:symbolOverlay();if(!x)return;if(!commit)clearSymbolOverlay();symbolPaintStyle(x);const a=symbolStart,b=window.__symbolShift?constrainedSymbolPoint(a,pt):pt;if(!a||!b)return;x.save();if(!commit)x.globalAlpha=.42;x.beginPath();if(symbolTool==='line'){x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.stroke()}else if(symbolTool==='rect')x.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);else if(symbolTool==='circle'){if($('symbolCircleCenter')?.checked){const rx=Math.abs(b.x-a.x),ry=Math.abs(b.y-a.y);x.ellipse(a.x,a.y,rx,ry,0,0,Math.PI*2);x.stroke()}else{const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,rx=Math.abs(b.x-a.x)/2,ry=Math.abs(b.y-a.y)/2;x.ellipse(cx,cy,Math.max(.5,rx),Math.max(.5,ry),0,0,Math.PI*2);x.stroke()}}x.restore()}
function deleteSymbolSelection(){if(!symbolSelection)return;pushSymbolHistory();symbolCtx.save();symbolCtx.globalCompositeOperation='destination-out';symbolCtx.beginPath();if(symbolSelection.mode==='rect'){const a=symbolSelection.a,b=symbolSelection.b;symbolCtx.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y))}else{const pts=symbolSelection.points||[];if(pts.length){symbolCtx.moveTo(pts[0].x,pts[0].y);for(const p of pts.slice(1))symbolCtx.lineTo(p.x,p.y);symbolCtx.closePath()}}symbolCtx.fillStyle='#000';symbolCtx.fill();symbolCtx.restore();symbolSelection=null;clearSymbolOverlay()}

function updateSymbolPainterToolUI(){
  document.querySelectorAll('[data-symbol-tools]').forEach(el=>{const tools=el.dataset.symbolTools.split(',');el.classList.toggle('tool-option-hidden',!tools.includes(symbolTool))});
  if($('symbolWidthOut'))$('symbolWidthOut').textContent=`${+$('symbolWidth')?.value||10} px`;if($('symbolBrushShapeOut'))$('symbolBrushShapeOut').textContent=`${+$('symbolBrushShape')?.value||50}%`;
}
document.querySelectorAll('.symbol-tool').forEach(btn=>btn.addEventListener('click',()=>{
  symbolTool=btn.dataset.symbolTool;
  document.querySelectorAll('.symbol-tool').forEach(x=>x.classList.toggle('active',x===btn));updateSymbolPainterToolUI()
}));
$('symbolWidth')?.addEventListener('input',()=>{updateSymbolPainterToolUI();drawSymbolSelectionOverlay()});$('symbolBrushShape')?.addEventListener('input',()=>{updateSymbolPainterToolUI();drawSymbolSelectionOverlay()});$('symbolDeleteSelection')?.addEventListener('click',deleteSymbolSelection);updateSymbolPainterToolUI();
symbolCanvas?.addEventListener('pointerdown',ev=>{
  ev.preventDefault();symbolDrawing=true;window.__symbolShift=!!ev.shiftKey;symbolStart=symbolPoint(ev);symbolCanvas.setPointerCapture(ev.pointerId);symbolHover=symbolStart;
  if(symbolTool==='select'){symbolSelection={mode:$('symbolSelectMode')?.value||'rect',a:symbolStart,b:symbolStart,points:[symbolStart]};symbolLasso=[symbolStart];drawSymbolSelectionOverlay();return}
  pushSymbolHistory();symbolPaintStyle();if(symbolTool==='fill'){symbolFloodFill(symbolStart.x,symbolStart.y,value('symbolColor')||'#f1f5ff');symbolDrawing=false}else if(symbolTool==='eraser'){symbolCtx.save();symbolCtx.globalCompositeOperation='destination-out';const w=+$('symbolWidth')?.value||10,shape=+$('symbolBrushShape')?.value||50;symbolCtx.beginPath();if(shape<50)symbolCtx.arc(symbolStart.x,symbolStart.y,w/2,0,Math.PI*2);else symbolCtx.rect(symbolStart.x-w/2,symbolStart.y-w/2,w,w);symbolCtx.fill();symbolCtx.restore()}else if(symbolTool==='brush'){symbolCtx.beginPath();symbolCtx.moveTo(symbolStart.x,symbolStart.y);window.__symbolBrushAnchor=symbolStart}
});
symbolCanvas?.addEventListener('pointermove',ev=>{
  const p0=symbolPoint(ev);symbolHover=p0;if(!symbolDrawing){drawSymbolSelectionOverlay();return}let p=p0;window.__symbolShift=!!ev.shiftKey;
  if(symbolTool==='select'){if(symbolSelection.mode==='lasso'){symbolLasso.push(p);symbolSelection.points=[...symbolLasso]}else symbolSelection.b=p;drawSymbolSelectionOverlay();return}
  symbolPaintStyle();if(symbolTool==='brush'){if(ev.shiftKey){const aa=window.__symbolBrushAnchor||symbolStart||p,p2=constrainedSymbolPoint(aa,p);symbolCtx.lineTo(p2.x,p2.y);symbolCtx.stroke();window.__symbolBrushAnchor=p2;symbolCtx.beginPath();symbolCtx.moveTo(p2.x,p2.y)}else{symbolCtx.lineTo(p.x,p.y);symbolCtx.stroke();window.__symbolBrushAnchor=p}}else if(symbolTool==='eraser'){symbolCtx.save();symbolCtx.globalCompositeOperation='destination-out';const w=+$('symbolWidth')?.value||10,shape=+$('symbolBrushShape')?.value||50;symbolCtx.beginPath();if(shape<50)symbolCtx.arc(p.x,p.y,w/2,0,Math.PI*2);else symbolCtx.rect(p.x-w/2,p.y-w/2,w,w);symbolCtx.fill();symbolCtx.restore()}else renderSymbolPreviewShape(p,false)
});
symbolCanvas?.addEventListener('pointerup',ev=>{if(!symbolDrawing)return;if(symbolTool==='select'){if(symbolSelection?.mode==='rect')symbolSelection.b=symbolPoint(ev);symbolDrawing=false;drawSymbolSelectionOverlay();return}if(['line','rect','circle'].includes(symbolTool)){clearSymbolOverlay();renderSymbolPreviewShape(symbolPoint(ev),true)}symbolDrawing=false;symbolStart=null;window.__symbolBrushAnchor=null;window.__symbolShift=false;drawSymbolSelectionOverlay()});
symbolCanvas?.addEventListener('pointerleave',()=>{if(!symbolDrawing){symbolHover=null;drawSymbolSelectionOverlay()}});
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
      pushSymbolHistory();symbolCtx.clearRect(0,0,symbolCanvas.width,symbolCanvas.height);symbolCtx.imageSmoothingEnabled=!$('symbolPixelate')?.checked;
      const scale=Math.min(symbolCanvas.width/img.width,symbolCanvas.height/img.height);
      const w=img.width*scale,h=img.height*scale;
      symbolCtx.drawImage(img,(symbolCanvas.width-w)/2,(symbolCanvas.height-h)/2,w,h)
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
$('readableExportBtn')?.addEventListener('click',()=>{
  downloadReadableProject(currentReadableProject(),'magic-system-v28.7bl-readable.txt')
});

$('convertSaveBtn')?.addEventListener('click',()=>{
  $('convertSaveInput')?.click()
});

$('convertSaveInput')?.addEventListener('change',async ev=>{
  const file=ev.target.files?.[0];
  if(!file)return;

  try{
    await convertSaveFileToReadable(file)
  }catch(err){
    console.error('Readable save conversion failed:',err);
    alert(`Could not convert this save: ${err.message||err}`)
  }finally{
    ev.target.value=''
  }
});


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
$('addonsBtn')?.addEventListener('click',()=>{syncSettingsUI();applyCreatorBranding();$('addonsModal').classList.remove('hidden')});
$('closeAddons')?.addEventListener('click',()=>$('addonsModal').classList.add('hidden'));
$('openCreatorEditor')?.addEventListener('click',openCreatorEditorModal);
$('closeCreatorEditor')?.addEventListener('click',()=>$('creatorEditorModal').classList.add('hidden'));
$('cancelCreatorChanges')?.addEventListener('click',()=>$('creatorEditorModal').classList.add('hidden'));
$('creatorResetPreset')?.addEventListener('click',()=>{creatorDraft=freshMagicCreator();renderCreatorEditor()});
$('duplicateCreatorPreset')?.addEventListener('click',()=>{harvestCreatorVisual();creatorDraft.preset='custom';creatorDraft.name=creatorDraft.name==='Magic System'?'Custom Creator':creatorDraft.name;creatorDraft.title=creatorDraft.title==='Magic System Sandbox'?`${creatorDraft.name} Sandbox`:creatorDraft.title;renderCreatorEditor()});
document.querySelectorAll('[data-creator-tab]').forEach(btn=>btn.addEventListener('click',()=>{const wasAdvanced=!$('creatorTabAdvanced').classList.contains('hidden');if(wasAdvanced){try{creatorDraft=normalizeCreatorSettings(JSON.parse($('creatorDefinitionJson').value))}catch(err){$('creatorJsonStatus').textContent='Invalid JSON: '+err.message;$('creatorJsonStatus').classList.add('error');return}}else harvestCreatorVisual();renderCreatorEditor();document.querySelectorAll('[data-creator-tab]').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('.creator-tab-panel').forEach(x=>x.classList.add('hidden'));$('creatorTab'+btn.dataset.creatorTab[0].toUpperCase()+btn.dataset.creatorTab.slice(1))?.classList.remove('hidden')}));
$('addCreatorType')?.addEventListener('click',()=>{harvestCreatorVisual();let i=1,id='customType';while(creatorDraft.nodeTypes.some(t=>t.id===id+i))i++;creatorDraft.nodeTypes.push({id:id+i,label:'New Type',icon:'◆',description:'Custom creator node.',enabled:true,builtin:false,useGeneratedEditor:true,category:creatorDraft.categories?.[0]?.id||'',fields:[{key:'category',label:'Category',kind:'input',placeholder:''},{key:'function',label:'Function',kind:'textarea',placeholder:''}]});creatorDraft.preset='custom';renderCreatorEditor()});
$('addCreatorCategory')?.addEventListener('click',()=>{harvestCreatorVisual();let i=1,id='category';while(creatorDraft.categories.some(c=>c.id===id+i))i++;creatorDraft.categories.push({id:id+i,label:'New Category',color:'#8aa4ff',parentId:''});creatorDraft.preset='custom';renderCreatorEditor()});
$('addCreatorLink')?.addEventListener('click',()=>{harvestCreatorVisual();let i=1,id='customLink';while(creatorDraft.linkTypes.some(t=>t.id===id+i))i++;creatorDraft.linkTypes.push({id:id+i,label:'Custom Link',enabled:true,auto:false,fromType:'',toType:'',sourceField:'',direction:'forward',category:creatorDraft.categories?.[0]?.id||'',style:'solid',thickness:1.6,color:'#cfd7ff',matchMode:'contains'});creatorDraft.preset='custom';renderCreatorEditor()});
$('addCreatorTimelineRule')?.addEventListener('click',()=>{harvestCreatorVisual();creatorDraft.timelineRules.push({id:uid(),name:'New Event Rule',enabled:true,nodeType:creatorDraft.nodeTypes[0]?.id||'',kind:'Event',title:'{node} changes history',text:'{node} causes a major change in {civilization} during year {year}.',cause:'{node} exists and satisfies this Creator timeline rule.',tone:'normal',impact:{knowledge:1,economy:0,technology:0,stability:0,danger:0}});creatorDraft.preset='custom';renderCreatorEditor()});
$('formatCreatorJson')?.addEventListener('click',()=>{try{const parsed=normalizeCreatorSettings(JSON.parse($('creatorDefinitionJson').value));creatorDraft=parsed;$('creatorDefinitionJson').value=JSON.stringify(parsed,null,2);$('creatorJsonStatus').textContent='Valid creator definition.';$('creatorJsonStatus').classList.remove('error')}catch(err){$('creatorJsonStatus').textContent='Invalid JSON: '+err.message;$('creatorJsonStatus').classList.add('error')}});
$('saveCreatorDefinition')?.addEventListener('click',()=>{try{const advancedVisible=!$('creatorTabAdvanced').classList.contains('hidden');if(advancedVisible)creatorDraft=normalizeCreatorSettings(JSON.parse($('creatorDefinitionJson').value));else harvestCreatorVisual();creatorSettings=normalizeCreatorSettings(creatorDraft);applyCreatorBranding();renderLibraries();save();$('creatorEditorModal').classList.add('hidden');$('creatorJsonStatus').textContent='Valid creator definition.'}catch(err){$('creatorJsonStatus').textContent='Cannot save: '+err.message;$('creatorJsonStatus').classList.add('error')}});
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


// v28.7af: editor controls are frequently re-parented into draggable side panels.
// Delegate these launch buttons from document so they cannot lose handlers when moved.
document.addEventListener('click',ev=>{
  const btn=ev.target.closest?.('#openCountryBorderPainter,#openPlanetTileEditor,#openLandscapeEditor,#openPlanetPalette,#savePlanetPalette');
  if(!btn)return;
  ev.preventDefault();ev.stopPropagation();
  if(btn.id==='openCountryBorderPainter'){openCountryBorderPainter();return}
  if(btn.id==='openPlanetTileEditor'){v287yOpenPlanetTileEditor();return}
  if(btn.id==='openLandscapeEditor'){v287yOpenLandscapeEditor();return}
  if(btn.id==='openPlanetPalette'){
    const palette=$('planetPalettePanel');if(!palette)return;
    const editing=editingId?byId(editingId):null;if(editing?.type==='place')v287adPaletteTargetPlanetId=editing.id;
    palette.classList.remove('hidden');prepareDetachedEditorPanel(palette,palette.querySelector('.auto-panel-head'));requestAnimationFrame(()=>keepDetachedPanelOnscreen(palette));return
  }
  if(btn.id==='savePlanetPalette'){
    try{
      const owner=v287adPaletteOwner();
      if(!v287adCommitPlanetPalette())return;
      if(owner?.id)v287zLandscapePlanetId=owner.id;
      if(v287adPendingLandscapeAfterPalette){
        v287adPendingLandscapeAfterPalette=false;
        $('planetPalettePanel')?.classList.add('hidden');
        requestAnimationFrame(()=>v287yOpenLandscapeEditor());
      }
    }catch(err){
      console.error('Planet palette save / Landscape continuation failed:',err);
      const status=$('planetPaletteSaveStatus');if(status)status.textContent='Could not save palette — see console';
    }
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
$('linkType').addEventListener('change',()=>{refreshRelationshipLinkUI();const def=creatorLinkDef(value('linkType'));if(def&&!$('linkModal').dataset.editEdgeId&&$('linkModal').dataset.mode!=='plan'){$('linkStrength').value=def.style||'solid';$('linkThickness').value=String(def.thickness||1.6);$('linkDirection').value=def.direction||'forward';if(!$('linkLabel').value.trim())$('linkLabel').value=def.label||def.id}});
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


// ===================== V22.8b RESPONSIVE LAYOUT =====================
// V22.8a used CSS `zoom` on the entire application. That made the app's
// coordinate system disagree with vw/vh units and caused large empty gutters.
// V22.8b keeps the document at 1:1 and lets the actual layout respond instead.
function fitApplicationUI(){
  const w=window.innerWidth||1366;
  const h=window.innerHeight||768;
  document.documentElement.style.setProperty('--viewport-w',`${w}px`);
  document.documentElement.style.setProperty('--viewport-h',`${h}px`);
  document.body.classList.toggle('ui-compact',w<1100||h<700);
  document.body.classList.toggle('ui-small',w<820||h<560);
  requestAnimationFrame(()=>{
    graph?.resize?.();
    if(!$('simulationModal')?.classList.contains('hidden'))requestPlanetDraw?.()
  })
}
let applicationUIResizeRAF=0;
window.addEventListener('resize',()=>{
  cancelAnimationFrame(applicationUIResizeRAF);
  applicationUIResizeRAF=requestAnimationFrame(fitApplicationUI)
});
window.addEventListener('orientationchange',()=>setTimeout(fitApplicationUI,60));

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

const minimizedEditors=[];
function captureEditorFields(){const out={};$('editorBody')?.querySelectorAll('input[id],textarea[id],select[id]').forEach(el=>{out[el.id]={value:el.value,checked:el.checked,type:el.type}});return out}
function restoreEditorFields(fields){for(const [id,s] of Object.entries(fields||{})){const el=$(id);if(!el)continue;if(s.type==='checkbox'||s.type==='radio')el.checked=!!s.checked;else el.value=s.value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}}
function renderMinimizedEditors(){const tray=$('minimizedEditorsTray');if(!tray)return;tray.innerHTML=minimizedEditors.map(s=>`<button type="button" class="minimized-editor-chip" data-minimized-editor="${s.key}"><b>${E.esc(s.title)}</b><small>${E.esc(s.subtitle)}</small></button>`).join('');tray.querySelectorAll('[data-minimized-editor]').forEach(b=>b.onclick=()=>restoreMinimizedEditor(b.dataset.minimizedEditor))}
function minimizeCurrentEditor(){if($('editorModal')?.classList.contains('hidden')||!editingType)return;const key=uid(),node=editingId?byId(editingId):null,s={key,type:editingType,editingId,creatingHub,title:$('editorTitle')?.textContent||'Editor',subtitle:node?.name||$('eName')?.value||'Unsaved',fields:captureEditorFields(),material:materialTextureDraft?cloneMaterialTexture(materialTextureDraft):null,crafting:craftingGraphDraft?JSON.parse(JSON.stringify(craftingGraphDraft)):null,mega:editingType==='structure'?megaPainterData():null};minimizedEditors.push(s);$('editorModal').classList.add('hidden');$('craftingGraphPanel')?.classList.add('hidden');$('materialTexturePanel')?.classList.add('hidden');editingId=null;editingType=null;creatingHub=false;renderMinimizedEditors()}
function restoreMinimizedEditor(key){const i=minimizedEditors.findIndex(s=>s.key===key);if(i<0)return;const s=minimizedEditors.splice(i,1)[0];creatingHub=s.creatingHub;const node=s.editingId?byId(s.editingId):null;openEditor(s.type,node);requestAnimationFrame(()=>{restoreEditorFields(s.fields);if(s.material){materialTextureDraft=cloneMaterialTexture(s.material);refreshMaterialTextureInlinePreview()}if(s.crafting){craftingGraphDraft=JSON.parse(JSON.stringify(s.crafting))}if(s.mega&&s.type==='structure')setMegaPainterData(s.mega);renderMinimizedEditors()})}
$('minimizeEditor')?.addEventListener('click',minimizeCurrentEditor);
renderMinimizedEditors();

historyRestoring=true;
load();graph.setPhysicsSettings(physicsSettings);rebuildEdges();normalizeMoonEdgesVisualOnly();ensureMoonOrbitConnections();if(technologySettings.enabled)ensureTechnologyConnections();fitApplicationUI();
renderLibraries();renderTechnologyTree();organize();graph.setData(nodes.filter(n=>!n.hiddenTechnology),edges.filter(e=>!e.blocked&&byId(e.a)&&byId(e.b)&&!byId(e.a)?.hiddenTechnology&&!byId(e.b)?.hiddenTechnology));graph.fit();graph.draw();
historyRestoring=false;undoStack=[];redoStack=[];updateHistoryButtons();

creatorSettings=normalizeCreatorSettings(creatorSettings);
applyCreatorBranding();
})();

