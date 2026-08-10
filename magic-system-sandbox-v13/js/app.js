(()=>{
const $=id=>document.getElementById(id),E=window.MagicEditors;
let nodes=[],edges=[],selected=null,activeSpellClass='All',activeSystemTab='rules',editingId=null,editingType=null;
let physicsSettings={pullStrength:1,largeGraphScale:1,collisionStrength:1,globalRulePull:.375};
const graph=new window.MagicGraph($('graph'));

const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const byId=id=>nodes.find(n=>n.id===id),ofType=t=>nodes.filter(n=>n.type===t),spells=()=>ofType('spell'),rules=()=>ofType('rule');
const tokenize=v=>String(v||'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function save(){localStorage.setItem('magicSandboxV8',JSON.stringify({nodes,edges,physicsSettings}))}
function load(){
  try{const d=JSON.parse(localStorage.getItem('magicSandboxV8')||'null');if(d&&Array.isArray(d.nodes)){nodes=d.nodes;edges=d.edges||[];if(d.physicsSettings)physicsSettings={...physicsSettings,...d.physicsSettings}}}catch(_){}
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
  if((a.type==='tool'&&b.type==='material')||(b.type==='tool'&&a.type==='material'))score+=1;
  if((a.type==='technique'&&b.type==='principle')||(b.type==='technique'&&a.type==='principle'))score+=1;
  return score;
}

function relationLabel(a,b){
  if(a.type==='tool'&&b.type==='material'&&String(a.composition||'').toLowerCase().includes(String(b.name||'').toLowerCase()))return 'made of';
  if(b.type==='tool'&&a.type==='material'&&String(b.composition||'').toLowerCase().includes(String(a.name||'').toLowerCase()))return 'made of';
  if((a.type==='technique'&&b.type==='principle')||(b.type==='technique'&&a.type==='principle'))return 'based on';
  if((a.type==='principle'&&b.type==='tool')||(b.type==='principle'&&a.type==='tool'))return 'governs';
  if((a.type==='tool'&&b.type==='technique')||(b.type==='tool'&&a.type==='technique'))return 'used by';
  return 'related to';
}
function isBlockedAutomatic(a,b,type){
  return edges.some(e=>e.blocked&&e.a===a&&e.b===b&&e.originalType===type);
}
function rebuildEdges(){
  const manual=edges.filter(e=>e.manual);edges=[...manual];
  for(const s of spells())if(!isBlockedAutomatic('mana',s.id,'mana'))edges.push({id:uid(),a:'mana',b:s.id,type:'mana',label:'derived from Mana',direction:'forward'});
  const ss=spells();
  for(let i=0;i<ss.length;i++)for(let j=i+1;j<ss.length;j++){
    if(similarity(ss[i],ss[j])===1&&!isBlockedAutomatic(ss[i].id,ss[j].id,'similar')){
      edges.push({id:uid(),a:ss[i].id,b:ss[j].id,type:'similar',label:'same Spell Class: '+(ss[i].spellClass||'Unclassified'),direction:'both'})
    }
  }
  for(const r of rules())for(const s of ss)if(ruleApplies(r,s)){
    const scope=String(r.scope||'').toLowerCase();let label='governs';
    if(s.spellClass&&scope.includes(String(s.spellClass).toLowerCase()))label='governs spell class';
    else if(scope.startsWith('intent:'))label='governs intent';else if(scope.startsWith('structure:'))label='governs structure';else if(scope.startsWith('output:'))label='governs output';
    if(!isBlockedAutomatic(r.id,s.id,'applies'))edges.push({id:uid(),a:r.id,b:s.id,type:'applies',label,direction:'forward'})
  }
  const extras=nodes.filter(n=>['material','tool','technique','principle'].includes(n.type));
  for(const n of extras)for(const s of ss){
    const classHit=String(n.uses||'').toLowerCase().includes(String(s.spellClass||'').toLowerCase())&&String(s.spellClass||'').trim();
    const smartHit=semanticScore(n,s)>=4;
    if(resourceRelation(n,s)||classHit||smartHit){
      const label=n.type==='material'?'used by spell':n.type==='tool'?'used to cast':n.type==='technique'?'performed through':'guided by principle';
      if(!isBlockedAutomatic(n.id,s.id,'uses'))edges.push({id:uid(),a:n.id,b:s.id,type:'uses',label,direction:'forward'})
    }
  }
  for(let i=0;i<extras.length;i++)for(let j=i+1;j<extras.length;j++){const a=extras[i],b=extras[j];if((resourceRelation(a,b)||semanticScore(a,b)>=3.5)&&!isBlockedAutomatic(a.id,b.id,'related'))edges.push({id:uid(),a:a.id,b:b.id,type:'related',label:relationLabel(a,b),direction:'none'})}
  graph.setData(nodes,edges.filter(e=>!e.blocked));save();updateStats()
}
function classNames(){return [...new Set(spells().map(s=>s.spellClass||'Unclassified'))].sort()}
function renderLibraries(){
  $('spellCount').textContent=spells().length;$('systemCount').textContent=nodes.filter(n=>!['mana','spell'].includes(n.type)).length;
  const filters=$('classFilters');filters.innerHTML='';['All',...classNames()].forEach(c=>{const b=document.createElement('button');b.className='class-chip'+(activeSpellClass===c?' active':'');b.textContent=c;b.onclick=()=>{activeSpellClass=c;renderLibraries()};filters.appendChild(b)});
  const list=$('spellList');list.innerHTML='';spells().filter(s=>activeSpellClass==='All'||(s.spellClass||'Unclassified')===activeSpellClass).forEach(s=>{const el=document.createElement('div');el.className='library-item'+(selected===s?' selected':'');el.innerHTML=`<strong>${E.esc(s.name)}</strong><small>${E.esc(s.spellClass||'Unclassified')} · ${E.esc(s.intent||'No intent')}</small>`;el.onclick=()=>selectNode(s);el.ondblclick=()=>openEditor('spell',s);list.appendChild(el)});
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===activeSystemTab));
  const sys=$('systemList');sys.innerHTML='';let shown=activeSystemTab==='rules'?rules():activeSystemTab==='materials'?ofType('material'):nodes.filter(n=>['tool','technique','principle'].includes(n.type));
  shown.forEach(n=>{const el=document.createElement('div');el.className='library-item'+(selected===n?' selected':'');el.innerHTML=`<strong>${E.esc(n.name)}</strong><small>${E.esc(n.type)}${n.strength?' · '+E.esc(n.strength):''}</small>`;el.onclick=()=>selectNode(n);el.ondblclick=()=>openEditor(n.type,n);sys.appendChild(el)})
}
function updateStats(){$('systemStats').textContent=`${nodes.length} nodes · ${edges.length} links · ${classNames().length} spell classes`}
function selectNode(n){selected=n;graph.selected=n;showSelection();renderLibraries()}
function showSelection(){
  const box=$('selectionCard');if(!selected){box.classList.add('hidden');return}box.classList.remove('hidden');
  if(selected.type==='mana'){box.innerHTML=`<h3>MANA</h3><p>${E.esc(selected.description)}</p><p>${spells().length} spells · ${rules().length} rules</p>`;return}
  if(selected.type==='spell'){box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Class:</b> ${E.esc(selected.spellClass||'Unclassified')}</p><p><b>Intent:</b> ${E.esc(selected.intent)}</p><p><b>Structure:</b> ${E.esc(selected.structure)}</p><p><b>Output:</b> ${E.esc(selected.output)}</p><p><b>Target:</b> ${E.esc(selected.target)}</p>`;return}
  if(selected.type==='rule'){const names=(selected.spellIds||[]).map(id=>byId(id)?.name).filter(Boolean);box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p>${E.esc(selected.text)}</p><p><b>Applies:</b> ${names.length?E.esc(names.join(', ')):E.esc(selected.scope||'All magic')}</p><p><b>Exceptions:</b> ${E.esc(selected.exceptions||'None')}</p>`;return}
  box.innerHTML=`<h3>${E.esc(selected.name)}</h3><p><b>Type:</b> ${E.esc(selected.type)}</p><p>${E.esc(selected.description||selected.property||'')}</p>`
}
function openEditor(type,node=null){
  editingId=node?.id||null;editingType=type;$('editorModal').classList.remove('hidden');$('createMenu').classList.add('hidden');$('editorKindLabel').textContent=node?'Edit':'Create';$('editorTitle').textContent=(node?'Edit ':'New ')+type[0].toUpperCase()+type.slice(1);
  const f=E.field.bind(E);let html='<div class="editor-grid">';
  if(type==='spell')html+=`<div class="editor-hint">Spell Class is completely open-ended. You can use conventional classes like <b>Charm</b> or <b>Transfiguration</b>, or invent classes such as <b>Tool</b>, <b>Ritual</b>, <b>Detection</b>, or anything else. Spells with the exact same class automatically connect.</div>`+f('Name','eName',node?.name||'')+f('Spell class','eClass',node?.spellClass||'',false,'input','placeholder="Charm, Curse, Transfiguration..."')+f('Intent','eIntent',node?.intent||'')+f('Structure','eStructure',node?.structure||'')+f('Target','eTarget',node?.target||'')+f('Output','eOutput',node?.output||'')+f('Duration','eDuration',node?.duration||'')+f('Range','eRange',node?.range||'')+f('Source','eSource',node?.source||'Mana')+f('Extra attributes','eExtra',node?.extra||'',true,'textarea');
  else if(type==='rule')html+=`<div class="editor-hint">Rules can target specific spells, an exact Spell Class, or a broader scope such as <b>intent: Reveal</b>, <b>output: Fire</b>, or <b>all magic</b>. Specific spells have the highest priority.</div>`+f('Rule name','eName',node?.name||'')+f('Strength','eStrength',['Absolute','Strong','Flexible'].map(v=>`<option ${node?.strength===v?'selected':''}>${v}</option>`).join(''),false,'select')+f('Spell class','eRuleClass',node?.spellClass||'',false,'input','placeholder="Charm, Curse, Transfiguration..."')+f('Rule statement','eText',node?.text||'',true,'textarea')+f('Broad scope','eScope',node?.scope||'All magic',true)+E.spellChecks(spells(),node?.spellIds||[])+f('Exceptions','eExceptions',node?.exceptions||'',true,'textarea');
  else html+=`<div class="editor-hint">These fields can reference other nodes by name. For example, a Tool whose composition says <b>Moonstone</b> can automatically connect to a Material named Moonstone; a Technique can name a Principle in Requirements; compatibility can name a Spell Class.</div>`+f(type[0].toUpperCase()+type.slice(1)+' name','eName',node?.name||'')+f('Category','eCategory',node?.category||'')+f('Composition / components','eComposition',node?.composition||'',true,'textarea')+f('Function / property','eProperty',node?.property||'',true,'textarea')+f('Requirements','eRequirements',node?.requirements||'',true,'textarea')+f('Compatible spells / classes','eUses',node?.uses||'',true,'textarea')+f('Limitations / interactions','eInteraction',node?.interaction||'',true,'textarea')+f('Description','eDescription',node?.description||'',true,'textarea');
  $('editorBody').innerHTML=html+'</div>'
}
function closeEditor(){$('editorModal').classList.add('hidden');editingId=null;editingType=null}
const value=id=>$(id)?.value?.trim()||'';
function saveEditor(){
  const type=editingType,name=value('eName');if(!type||!name)return;let n=editingId?byId(editingId):null;
  if(!n){const a=Math.random()*Math.PI*2,d=220+Math.random()*180;n={id:uid(),type,name,x:Math.cos(a)*d,y:Math.sin(a)*d,vx:0,vy:0,r:type==='spell'?17:16};nodes.push(n)}n.name=name;
  if(type==='spell')Object.assign(n,{spellClass:value('eClass')||'Unclassified',intent:value('eIntent'),structure:value('eStructure'),target:value('eTarget'),output:value('eOutput'),duration:value('eDuration'),range:value('eRange'),source:value('eSource')||'Mana',extra:value('eExtra')});
  else if(type==='rule')Object.assign(n,{strength:value('eStrength'),spellClass:value('eRuleClass'),text:value('eText'),scope:value('eScope')||'All magic',exceptions:value('eExceptions'),spellIds:[...document.querySelectorAll('.rule-spell-check:checked')].map(x=>x.value)});
  else Object.assign(n,{category:value('eCategory'),composition:value('eComposition'),property:value('eProperty'),requirements:value('eRequirements'),uses:value('eUses'),interaction:value('eInteraction'),description:value('eDescription')});
  closeEditor();rebuildEdges();renderLibraries();organize();selectNode(n);graph.fit()
}
function deleteSelected(){if(!selected||selected.type==='mana')return;const id=selected.id;nodes=nodes.filter(n=>n.id!==id);edges=edges.filter(e=>e.a!==id&&e.b!==id);for(const r of rules())if(r.spellIds)r.spellIds=r.spellIds.filter(x=>x!==id);selected=null;graph.selected=null;rebuildEdges();renderLibraries();showSelection()}
function organize(){
  const mana=byId('mana');mana.x=0;mana.y=0;const classes=classNames(),ss=spells();
  classes.forEach((cls,ci)=>{const group=ss.filter(s=>(s.spellClass||'Unclassified')===cls),angle=(ci/Math.max(1,classes.length))*Math.PI*2-Math.PI/2,cx=Math.cos(angle)*(260+classes.length*18),cy=Math.sin(angle)*(200+classes.length*14);group.forEach((s,i)=>{const a=(i/Math.max(1,group.length))*Math.PI*2,rad=70+Math.min(80,group.length*7);s.x=cx+Math.cos(a)*rad;s.y=cy+Math.sin(a)*rad;s.vx=s.vy=0})});
  const regions={rule:[-420,-250],material:[420,-250],tool:[430,240],technique:[0,400],principle:[-430,240]};Object.entries(regions).forEach(([type,[cx,cy]])=>{ofType(type).forEach((n,i)=>{const a=i*2.399;n.x=cx+Math.cos(a)*(45+22*Math.sqrt(i));n.y=cy+Math.sin(a)*(45+22*Math.sqrt(i));n.vx=n.vy=0})})
}
function openLinkModal(a,b,edge=null){
  $('linkModal').dataset.editEdgeId=edge?.id||'';$('linkLabel').value=edge?.label||'';$('linkType').value=edge?.linkType||'direct';$('linkStrength').value=edge?.strength||'solid';$('linkThickness').value=String(edge?.thickness||1.6);$('linkDirection').value=edge?.direction||'forward';$('linkPreview').innerHTML=`<b>${E.esc(a.name)}</b>&nbsp; → &nbsp;<b>${E.esc(b.name)}</b>`;$('linkModal').dataset.a=a.id;$('linkModal').dataset.b=b.id;$('linkModal').classList.remove('hidden')
}
function saveLink(){
  const a=$('linkModal').dataset.a,b=$('linkModal').dataset.b;if(!a||!b)return;
  const editId=$('linkModal').dataset.editEdgeId;
  let e=editId?edges.find(x=>x.id===editId):null;
  if(!e){
    // New manual link replaces any existing visible connection between the pair.
    const existing=edges.filter(x=>!x.blocked&&((x.a===a&&x.b===b)||(x.a===b&&x.b===a)));
    for(const old of existing){
      if(old.manual)edges=edges.filter(x=>x!==old);
      else edges.push({id:uid(),a:old.a,b:old.b,type:'blocked',manual:true,blocked:true,originalType:old.type,label:'replaced automatic connection'});
    }
    e={id:uid(),a,b,type:'manual',manual:true};edges.push(e)
  }
  e.label=value('linkLabel')||value('linkType');e.linkType=value('linkType');e.strength=value('linkStrength');e.thickness=+value('linkThickness')||1.6;e.direction=value('linkDirection')||'forward';
  $('linkModal').classList.add('hidden');graph.setLinkMode(false);$('linkBtn').classList.remove('active');
  rebuildEdges();graph.setData(nodes,edges.filter(x=>!x.blocked));updateStats()
}

function snipEdge(edge){
  if(!edge)return;
  if(edge.manual){
    edges=edges.filter(e=>e!==edge);
  }else{
    edges.push({id:uid(),a:edge.a,b:edge.b,type:'blocked',manual:true,blocked:true,originalType:edge.type,label:'snipped automatic connection'});
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
        edges.push({id:uid(),a:e.a,b:e.b,type:'blocked',manual:true,blocked:true,originalType:e.type,label:'override blocker'});
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
  const orphanExtras=nodes.filter(n=>!['mana','spell'].includes(n.type)&&!edges.some(e=>!e.blocked&&(e.a===n.id||e.b===n.id)));
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



let simAutoTimer=null;
let simState={
  year:0,events:[],civ:'',era:'Founding',population:100000,stability:70,knowledge:5,economy:15,danger:5,technology:4,
  institutions:[],discoveries:[],industries:[],crises:[],laws:[],factions:[],regions:[],research:[],professions:[],
  civNodes:[],civEdges:[],chainState:{}
};
function pick(arr){return arr.length?arr[Math.floor(Math.random()*arr.length)]:null}
function chance(p){return Math.random()<p}
function clamp(v,a=0,b=100){return Math.max(a,Math.min(b,v))}
function simContext(){return{spells:spells(),rules:rules(),materials:ofType('material'),tools:ofType('tool'),techniques:ofType('technique'),principles:ofType('principle'),classes:classNames()}}
function ruleForSpell(s){return rules().filter(r=>ruleApplies(r,s))}
function event(kind,title,text,tags=[],impact={},tone='normal',reasons=[]){return{kind,title,text,tags,impact,tone,reasons}}
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
      ev.year=simState.year;applyImpact(ev);simState.events.push(ev)
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
function makeCivilizationEvent(ctx){
  const pool=[],s=pick(ctx.spells),s2=pick(ctx.spells.filter(x=>x!==s)),m=pick(ctx.materials),t=pick(ctx.tools),tech=pick(ctx.techniques),p=pick(ctx.principles),r=pick(ctx.rules),cls=pick(ctx.classes),region=pick(simState.regions);

  if(s)pool.push(()=>event('Discovery',`${s.name} spreads through society`,`Practical knowledge of ${s.name} expands beyond specialists.${s.intent?` Its ${s.intent} intent creates new civilian and professional uses.`:''}`,[s.spellClass||'Spell',s.name],{knowledge:3,economy:2,danger:1},'breakthrough',[`Spell exists in the magic graph`,`Class: ${s.spellClass||'Unclassified'}`]));
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
function advanceSimulation(years){
  if(!simState.civ){startSimulation();return}
  const ctx=simContext();
  for(let y=0;y<years;y++){
    simState.year++;
    simState.population=Math.round(simState.population*(1.002+Math.random()*.004));
    simState.regions.forEach(r=>{r.population=Math.round(r.population*(1.002+Math.random()*.004));r.wealth=clamp(r.wealth+(Math.random()-.47)*.6);r.stability=clamp(r.stability+(Math.random()-.5)*.45)});
    tickResearch(1);
    if(chance(.16+Math.min(.18,ctx.spells.length*.012))){
      const ev=makeCivilizationEvent(ctx);ev.year=simState.year;applyImpact(ev);updateWorldFromEvent(ev);postEventEmergence(ev);simState.events.push(ev)
    }
  }
  updateProfessions();renderSimulation()
}
function startSimulation(){
  if(simAutoTimer){clearInterval(simAutoTimer);simAutoTimer=null;$('simAuto').textContent='▶ Auto'}
  const era=value('simEra'),scale=value('simScale')||'medium',offsets={'Founding':0,'Early Kingdoms':80,'Arcane Renaissance':350,'Industrial Magic':900};
  const popBase={small:75000,medium:350000,large:1800000}[scale]||350000;
  simState={year:offsets[era]||0,events:[],civ:value('simCivName')||'Aetheria',era,population:popBase,stability:70,knowledge:era==='Founding'?5:era==='Early Kingdoms'?15:era==='Arcane Renaissance'?35:60,economy:era==='Founding'?15:era==='Early Kingdoms'?25:era==='Arcane Renaissance'?45:70,danger:5,technology:era==='Founding'?4:era==='Early Kingdoms'?12:era==='Arcane Renaissance'?35:65,institutions:[],discoveries:[],industries:[],crises:[],laws:[],factions:[],regions:[],research:[],professions:[],civNodes:[],civEdges:[],chainState:{}};
  simState.regions=initialRegions(scale);syncRegionMagic();seedCivGraph();updateProfessions();renderSimulation()
}
function inspectEvent(i){
  const ev=simState.events[i];if(!ev)return;const box=$('eventInspector');box.classList.remove('hidden');
  const impact=Object.entries(ev.impact||{}).filter(([,v])=>v).map(([k,v])=>`<div class="reason-card"><b>${E.esc(k)}</b><br>${v>0?'+':''}${typeof v==='number'&&Math.abs(v)<1?(v*100).toFixed(1)+'%':v}</div>`).join('');
  box.innerHTML=`<h3>${E.esc(ev.title)}</h3><p>${E.esc(ev.text)}</p><div class="eyebrow">Why this happened</div><div class="reason-grid">${(ev.reasons||[]).map(r=>`<div class="reason-card">${E.esc(r)}</div>`).join('')||'<div class="reason-card">Emergent simulation event</div>'}</div><div class="eyebrow" style="margin-top:9px">Consequences</div><div class="reason-grid">${impact||'<div class="reason-card">No major statistical impact</div>'}</div>`
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
function renderSimulation(){
  const ctx=simContext();
  $('simSummary').innerHTML=`<b>${E.esc(simState.civ||'Civilization')}</b> · ${E.esc(simState.era||'Founding')} · Year ${simState.year}. Simulation input: ${ctx.spells.length} spells, ${ctx.classes.length} classes, ${ctx.rules.length} rules, ${ctx.materials.length} materials, ${ctx.tools.length} tools, ${ctx.techniques.length} techniques, ${ctx.principles.length} principles.`;
  $('simPop').textContent=simState.population.toLocaleString();$('simStability').textContent=Math.round(simState.stability)+'%';$('simKnowledge').textContent=Math.round(simState.knowledge)+'%';$('simEconomy').textContent=Math.round(simState.economy)+'%';$('simDanger').textContent=Math.round(simState.danger)+'%';$('simTech').textContent=Math.round(simState.technology)+'%';
  $('simTimeline').innerHTML=simState.events.length?simState.events.map((e,i)=>`<div class="sim-event ${e.tone||''}" data-event="${i}"><div class="sim-year">YEAR ${e.year}<br>${E.esc(e.kind)}</div><div><strong>${E.esc(e.title)}</strong><p>${E.esc(e.text)}</p>${e.tags.map(t=>`<span class="sim-tag">${E.esc(t)}</span>`).join('')}</div></div>`).join(''):'<div class="world-section">No major events yet. Advance time to begin the civilization.</div>';
  document.querySelectorAll('.sim-event[data-event]').forEach(el=>el.onclick=()=>inspectEvent(+el.dataset.event));
  const chips=(arr,fn=x=>x)=>arr.length?arr.slice(-14).map(x=>`<span class="world-chip">${E.esc(fn(x))}</span>`).join(''):'<span class="world-chip">None yet</span>';
  $('simWorld').innerHTML=`<div class="world-section"><h3>Institutions</h3>${chips(simState.institutions,x=>x.name)}</div><div class="world-section"><h3>Industries & Infrastructure</h3>${chips(simState.industries)}</div><div class="world-section"><h3>Discoveries</h3>${chips(simState.discoveries)}</div><div class="world-section"><h3>Professions</h3>${simState.professions.map(p=>`<span class="world-chip">${E.esc(p.name)} · ${p.count.toLocaleString()}</span>`).join('')||'<span class="world-chip">None yet</span>'}</div><div class="world-section"><h3>Factions & Debates</h3>${chips(simState.factions)}</div><div class="world-section"><h3>Historical Crises</h3>${chips(simState.crises)}</div>`;
  $('simResearch').innerHTML=`<div class="research-grid">${simState.research.length?simState.research.map(r=>`<div class="research-card"><h3>${E.esc(r.title)}</h3><p>${E.esc(r.kind)} · ${E.esc(r.status)}</p><p>${E.esc(r.goal||'')}</p><div class="progress"><i style="width:${r.progress}%"></i></div><p>${Math.round(r.progress)}% complete</p></div>`).join(''):'<div class="research-card"><h3>No research projects yet</h3><p>Projects emerge as the civilization encounters spells, rules, materials, and tools.</p></div>'}</div>`;
  $('simRegions').innerHTML=`<div class="region-grid">${simState.regions.map(r=>`<div class="region-card"><h3>${E.esc(r.name)}</h3><p>${E.esc(r.type)} · Population ${r.population.toLocaleString()}</p><p>Dominant magic: ${E.esc(r.dominantClass||'None yet')}</p><p>Magic ${Math.round(r.magic)}% · Stability ${Math.round(r.stability)}% · Wealth ${Math.round(r.wealth)}%</p></div>`).join('')}</div>`;
  requestAnimationFrame(renderCivGraph)
}

function pulseWeb(){graph.pulseUntil=performance.now()+2500;const sr=rules().map(r=>[r,spells().filter(s=>ruleApplies(r,s)).length]).sort((a,b)=>b[1]-a[1])[0],sc=spells().map(s=>[s,edges.filter(e=>e.a===s.id||e.b===s.id).length]).sort((a,b)=>b[1]-a[1])[0];const box=$('selectionCard');box.classList.remove('hidden');box.innerHTML=`<h3>Magic Web Pulse</h3><p>${sr?`Most influential rule: <b>${E.esc(sr[0].name)}</b> (${sr[1]} spells)`:''}</p><p>${sc?`Most connected spell: <b>${E.esc(sc[0].name)}</b> (${sc[1]} links)`:''}</p>`}

graph.onSelect=selectNode;graph.onLinkDrop=(a,b)=>openLinkModal(a,b);graph.onEdgeSnip=edge=>{snipEdge(edge);graph.setSnipMode(false);$('snipBtn').classList.remove('snip-active')};

$('createBtn').onclick=()=>$('createMenu').classList.toggle('hidden');document.querySelectorAll('[data-create]').forEach(b=>b.onclick=()=>openEditor(b.dataset.create));
$('editBtn').onclick=()=>{if(selected&&selected.type!=='mana')openEditor(selected.type,selected)};$('deleteBtn').onclick=deleteSelected;$('cloneBtn').onclick=cloneSelected;
$('organizeBtn').onclick=()=>{organize();graph.fit()};$('fitBtn').onclick=()=>graph.fit();$('inspectBtn').onclick=showSelection;$('connectionsBtn').onclick=openConnections;$('pulseBtn').onclick=pulseWeb;
$('freezeBtn').onclick=()=>{
  graph.setFrozen(!graph.frozen);
  $('freezeBtn').classList.toggle('freeze-active',graph.frozen);
  $('freezeBtn').querySelector('span').textContent=graph.frozen?'Unfreeze':'Freeze';
};
function syncSettingsUI(){
  $('pullStrengthSlider').value=Math.round(physicsSettings.pullStrength*100);
  $('largeGraphSlider').value=Math.round(physicsSettings.largeGraphScale*100);
  $('collisionStrength').value=String(physicsSettings.collisionStrength);
  $('globalRulePull').value=String(physicsSettings.globalRulePull);
  $('pullStrengthValue').textContent=Math.round(physicsSettings.pullStrength*100)+'%';
  $('largeGraphValue').textContent=Math.round(physicsSettings.largeGraphScale*100)+'%';
}
$('settingsBtn').onclick=()=>{syncSettingsUI();$('settingsModal').classList.remove('hidden')};
$('auditBtn').onclick=systemAudit;$('closeAudit').onclick=()=>$('auditModal').classList.add('hidden');
$('simulateBtn').onclick=()=>{$('simulationModal').classList.remove('hidden');if(!simState.events.length){simState.civ=value('simCivName')||'Aetheria';renderSimulation()}};
$('closeSimulation').onclick=()=>$('simulationModal').classList.add('hidden');




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
  if(graph.linkMode){graph.setSnipMode(false);$('snipBtn').classList.remove('snip-active')}
};
$('snipBtn').onclick=()=>{
  graph.setSnipMode(!graph.snipMode);
  $('snipBtn').classList.toggle('snip-active',graph.snipMode);
  if(graph.snipMode){graph.setLinkMode(false);$('linkBtn').classList.remove('active')}
};
$('closeEditor').onclick=closeEditor;$('cancelEditor').onclick=closeEditor;$('saveEditor').onclick=saveEditor;
$('closeLink').onclick=()=>$('linkModal').classList.add('hidden');$('cancelLink').onclick=()=>{$('linkModal').classList.add('hidden');graph.setLinkMode(false);$('linkBtn').classList.remove('active')};$('saveLink').onclick=saveLink;
$('closeConnections').onclick=()=>$('connectionsModal').classList.add('hidden');document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{activeSystemTab=t.dataset.tab;renderLibraries()});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){graph.setLinkMode(false);graph.setSnipMode(false);$('linkBtn').classList.remove('active');$('snipBtn').classList.remove('snip-active');document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'))}if((e.key==='Delete'||e.key==='Backspace')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))deleteSelected()});


$('simulateBtn').onclick=()=>{$('simulationModal').classList.remove('hidden');if(!simState.civ)startSimulation();else renderSimulation()};
$('closeSimulation').onclick=()=>{$('simulationModal').classList.add('hidden');if(simAutoTimer){clearInterval(simAutoTimer);simAutoTimer=null;$('simAuto').textContent='▶ Auto'}};
$('runSimulation').onclick=startSimulation;
$('simStep1').onclick=()=>advanceSimulation(1);
$('simStep10').onclick=()=>advanceSimulation(10);
$('simStep50').onclick=()=>advanceSimulation(50);
$('simAuto').onclick=()=>{
  if(simAutoTimer){clearInterval(simAutoTimer);simAutoTimer=null;$('simAuto').textContent='▶ Auto'}
  else{simAutoTimer=setInterval(()=>advanceSimulation(5),700);$('simAuto').textContent='⏸ Pause'}
};
document.querySelectorAll('.sim-tab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.sim-tab').forEach(x=>x.classList.toggle('active',x===b));
  ['timeline','world','research','regions','civgraph'].forEach(name=>{
    const el=$(name==='timeline'?'simTimeline':name==='world'?'simWorld':name==='research'?'simResearch':name==='regions'?'simRegions':'simCivGraph');
    el.classList.toggle('hidden',b.dataset.simtab!==name)
  });
  if(b.dataset.simtab==='civgraph')requestAnimationFrame(renderCivGraph)
});

$('resetSystemBtn').onclick=()=>{
  const ok=confirm('Reset the entire magical system? This removes all spells, rules, materials, tools, techniques, principles, and custom connections, returning the graph to only MANA.');
  if(!ok)return;
  if(simAutoTimer){clearInterval(simAutoTimer);simAutoTimer=null}
  localStorage.removeItem('magicSandboxV8');
  localStorage.removeItem('magicSandboxV6');
  nodes=[{id:'mana',type:'mana',name:'MANA',x:0,y:0,vx:0,vy:0,r:45,fixed:true,description:'The magical source from which this system grows.'}];
  edges=[];selected=null;graph.selected=null;graph.setData(nodes,edges);graph.setFrozen(false);
  simState={year:0,events:[],civ:'',era:'Founding',population:100000,stability:70,knowledge:5,economy:15,danger:5,technology:4,institutions:[],discoveries:[],industries:[],crises:[],laws:[],factions:[],regions:[],research:[],professions:[],civNodes:[],civEdges:[],chainState:{}};
  save();renderLibraries();showSelection();updateStats();graph.fit();
};

load();graph.setPhysicsSettings(physicsSettings);rebuildEdges();renderLibraries();organize();graph.setData(nodes,edges.filter(e=>!e.blocked));graph.fit();graph.draw();
})();