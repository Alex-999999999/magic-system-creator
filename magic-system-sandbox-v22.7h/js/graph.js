window.MagicGraph=class MagicGraph{
  constructor(canvas){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');
    this.nodes=[];this.edges=[];this.selected=null;this.pan={x:0,y:0};this.zoom=1;this.drag=null;
    this.linkMode=false;this.linkStart=null;this.linkPoint=null;this.linkEraseStart=null;this.linkEraseLast=null;this.linkEraseEdges=new Set();this.pulseUntil=0;this.frozen=false;this.pullStrength=1;this.largeGraphScale=1;this.collisionStrength=1;this.globalRulePull=0.375;
    this.onSelect=null;this.onLinkDrop=null;this.onEdgeSnip=null;this.onEdgeClick=null;this.onNodeDragMove=null;
    this.bind();
  }
  setData(nodes,edges){this.nodes=nodes;this.edges=edges}
  byId(id){return this.nodes.find(n=>n.id===id)}
  worldToScreen(x,y){const r=this.canvas.getBoundingClientRect();return{x:r.width/2+(x+this.pan.x)*this.zoom,y:r.height/2+(y+this.pan.y)*this.zoom}}
  screenToWorld(x,y){const r=this.canvas.getBoundingClientRect();return{x:(x-r.width/2)/this.zoom-this.pan.x,y:(y-r.height/2)/this.zoom-this.pan.y}}
  hit(x,y){const p=this.screenToWorld(x,y);return [...this.nodes].reverse().find(n=>Math.hypot(p.x-n.x,p.y-n.y)<=this.effectiveRadius(n)+8)}
  setLinkMode(on){this.linkMode=!!on;this.linkStart=null;this.linkPoint=null;this.linkEraseStart=null;this.linkEraseLast=null;this.linkEraseEdges.clear()}
  setFrozen(on){this.frozen=!!on;if(on){for(const n of this.nodes){n.vx=0;n.vy=0}}}
  setPhysicsSettings(s={}){if(Number.isFinite(s.pullStrength))this.pullStrength=s.pullStrength;if(Number.isFinite(s.largeGraphScale))this.largeGraphScale=s.largeGraphScale;if(Number.isFinite(s.collisionStrength))this.collisionStrength=s.collisionStrength;if(Number.isFinite(s.globalRulePull))this.globalRulePull=s.globalRulePull}
  fit(){
    if(!this.nodes.length)return;const xs=this.nodes.map(n=>n.x),ys=this.nodes.map(n=>n.y),r=this.canvas.getBoundingClientRect();
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    this.zoom=Math.max(.35,Math.min(1.25,Math.min(r.width/Math.max(260,maxX-minX+220),r.height/Math.max(220,maxY-minY+220))));
    this.pan.x=-(minX+maxX)/2;this.pan.y=-(minY+maxY)/2;
  }
  graphPullScale(){
    const n=Math.max(1,this.nodes.length);
    const weakened=Math.max(.28,1/Math.pow(1+n/55,.42));
    return 1-(1-weakened)*this.largeGraphScale;
  }
  isGlobalRuleEdge(e){
    if(e.type!=='applies')return false;
    const rule=this.byId(e.a);
    if(!rule||rule.type!=='rule')return false;
    const scope=String(rule.scope||'').trim().toLowerCase();
    const explicit=Array.isArray(rule.spellIds)?rule.spellIds:[];
    return !explicit.length&&(!scope||scope==='all'||scope.includes('all magic'));
  }
  pointSegmentDistance(px,py,x1,y1,x2,y2){
    const dx=x2-x1,dy=y2-y1;
    if(dx===0&&dy===0)return Math.hypot(px-x1,py-y1);
    const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy)));
    const x=x1+t*dx,y=y1+t*dy;
    return Math.hypot(px-x,py-y);
  }
  edgeAtScreen(x,y){
    let best=null,bestD=Infinity;
    for(const e of this.edges){
      if(e.blocked)continue;
      const a=this.byId(e.a),b=this.byId(e.b);if(!a||!b)continue;
      const A=this.worldToScreen(a.x,a.y),B=this.worldToScreen(b.x,b.y);
      const d=this.pointSegmentDistance(x,y,A.x,A.y,B.x,B.y);
      // Deliberately generous: removing a thin connection should not require pixel-perfect aim.
      const threshold=Math.max(11,(e.thickness||1.2)*5);
      if(d<threshold&&d<bestD){best=e;bestD=d}
    }
    return best;
  }
  collectEdgesAlongSegment(x1,y1,x2,y2){
    const found=[];
    const length=Math.hypot(x2-x1,y2-y1);
    const steps=Math.max(1,Math.ceil(length/6));
    for(let i=0;i<=steps;i++){
      const q=i/steps;
      const e=this.edgeAtScreen(x1+(x2-x1)*q,y1+(y2-y1)*q);
      if(e&&!found.includes(e))found.push(e);
    }
    return found;
  }
  physics(){
    if(this.frozen)return;
    for(const e of this.edges){
      const a=this.byId(e.a),b=this.byId(e.b);if(!a||!b)continue;
      const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy));
      const target=e.type==='mana'?190:e.type==='similar'?105:e.type==='applies'?220:e.type==='hubmember'?125:170;
      const baseK=.0012;
      const graphScale=this.graphPullScale();
      const globalRuleScale=this.isGlobalRuleEdge(e)?this.globalRulePull:1;
      const k=baseK*graphScale*globalRuleScale*this.pullStrength;
      const f=(d-target)*k;
      if(!a.fixed){a.vx+=dx/d*f;a.vy+=dy/d*f} if(!b.fixed){b.vx-=dx/d*f;b.vy-=dy/d*f}
    }
    for(let i=0;i<this.nodes.length;i++)for(let j=i+1;j<this.nodes.length;j++){
      const a=this.nodes[i],b=this.nodes[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),min=this.effectiveRadius(a)+this.effectiveRadius(b)+24;
      if(d<min){const f=(min-d)*.004*this.collisionStrength;if(!a.fixed){a.vx-=dx/d*f;a.vy-=dy/d*f}if(!b.fixed){b.vx+=dx/d*f;b.vy+=dy/d*f}}
    }
    for(const n of this.nodes)if(!n.fixed&&!n.isHub&&this.drag?.node!==n){n.vx*=.91;n.vy*=.91;n.x+=n.vx;n.y+=n.vy}
  }
  edgeStyle(e){
    const C=window.MAGIC_DATA;
    if(e.type==='organizationRelationship'){
      const v=Number.isFinite(e.relationship)?e.relationship:0;
      const color=v<=-75?'#ff334f':v<=-40?'#f05252':v<0?'#d8785f':v>=75?'#26e86f':v>=40?'#42d77c':v>0?'#72c98f':'#8792a3';
      return{color,width:e.thickness||1.9,dash:e.strength==='dashed'?[7,5]:e.strength==='dotted'?[2,5]:[]}
    }
    if(e.manual||(e.planned&&e.customized))return{color:C.MANUAL_COLORS[e.linkType]||'#cfd7ff',width:e.thickness||1.6,dash:e.strength==='dashed'?[7,5]:e.strength==='dotted'?[2,5]:[]};
    if(e.type==='technology'||e.techEdge)return{color:'#69d8ff',width:e.thickness||1.8,dash:[]};
    if(e.type==='relationship'||e.linkType==='relationship')return{color:C.MANUAL_COLORS.relationship||'#55d889',width:e.thickness||1.8,dash:e.strength==='dashed'?[7,5]:e.strength==='dotted'?[2,5]:[]};
    if(e.type==='mana')return{color:'rgba(125,231,255,.34)',width:1.15,dash:[]};
    if(e.type==='similar')return{color:'rgba(198,164,255,.46)',width:1.25,dash:[]};
    if(e.type==='applies')return{color:'rgba(230,182,109,.40)',width:1.15,dash:[6,5]};
    if(e.type==='uses')return{color:'rgba(139,164,212,.34)',width:1.05,dash:[2,5]};
    return{color:'rgba(170,180,199,.30)',width:1,dash:[3,5]};
  }
  nodeColor(n){
    const D=window.MAGIC_DATA;
    if(n.type==='spell'||n.type==='classPoint'){
      const classes=[...new Set(this.nodes.filter(x=>x.type==='spell').map(x=>x.spellClass||'Unclassified'))].sort();
      return D.CLASS_COLORS[Math.max(0,classes.indexOf(n.spellClass||'Unclassified'))%D.CLASS_COLORS.length];
    }
    return D.COLORS[n.type]||'#aab4c7';
  }
  roundRect(ctx,x,y,w,h,r){if(ctx.roundRect){ctx.roundRect(x,y,w,h,r);return}ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r)}
  drawEdgeLabel(e,A,B,style){
    const ctx=this.ctx,label=e.label||'related to';const mx=(A.x+B.x)/2,my=(A.y+B.y)/2;
    ctx.save();ctx.font='10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    const tw=ctx.measureText(label).width+14;
    ctx.beginPath();this.roundRect(ctx,mx-tw/2,my-10,tw,20,7);
    ctx.fillStyle='rgba(7,11,18,.94)';ctx.strokeStyle=style.color;ctx.globalAlpha=.92;ctx.fill();ctx.globalAlpha=.55;ctx.stroke();ctx.globalAlpha=1;
    ctx.fillStyle='#c8d1df';ctx.fillText(label,mx,my);ctx.restore();
  }
  drawArrow(fromNode,toNode,color){
    const ctx=this.ctx;
    const from=this.worldToScreen(fromNode.x,fromNode.y),to=this.worldToScreen(toNode.x,toNode.y);
    const dx=to.x-from.x,dy=to.y-from.y,dist=Math.max(1,Math.hypot(dx,dy));
    const ux=dx/dist,uy=dy/dist;
    // The line itself still reaches the node center. Only the arrowhead is pulled
    // back to the visible edge of the destination node.
    const radius=this.effectiveRadius(toNode)*this.zoom+2;
    const tip={x:to.x-ux*radius,y:to.y-uy*radius};
    const ang=Math.atan2(dy,dx),len=8;
    ctx.save();
    ctx.strokeStyle=color;ctx.lineWidth=1.2;
    ctx.beginPath();
    ctx.moveTo(tip.x,tip.y);
    ctx.lineTo(tip.x-Math.cos(ang-.45)*len,tip.y-Math.sin(ang-.45)*len);
    ctx.moveTo(tip.x,tip.y);
    ctx.lineTo(tip.x-Math.cos(ang+.45)*len,tip.y-Math.sin(ang+.45)*len);
    ctx.stroke();ctx.restore();
  }
  effectiveRadius(n){
    if(n.type==='mana')return 45;
    if(n.type==='classPoint'||n.type==='technologySpinePoint')return 1.5;
    if(n.isHub)return 30;
    if(n.isSemiHub)return 23;
    return n.type==='spell'?17:16;
  }
  fitNodeText(text,radius,zoom){
    const ctx=this.ctx;
    const words=String(text||'').split(/\s+/).filter(Boolean);
    const maxWidth=Math.max(22,(radius*1.55)*zoom);
    let fontSize=Math.max(7.2,10.5*zoom);
    let lines=[];
    for(;fontSize>=6.5;fontSize-=.5){
      ctx.font=`600 ${fontSize}px system-ui`;
      lines=[];let line='';
      for(const w of words){
        const test=line?line+' '+w:w;
        if(ctx.measureText(test).width<=maxWidth){line=test}
        else{
          if(line)lines.push(line);
          line=w;
        }
      }
      if(line)lines.push(line);
      if(lines.length<=3 && lines.every(l=>ctx.measureText(l).width<=maxWidth))break;
    }
    // Hard-trim impossible single long words.
    lines=lines.slice(0,3).map(l=>{
      if(ctx.measureText(l).width<=maxWidth)return l;
      let out=l;
      while(out.length>2&&ctx.measureText(out+'…').width>maxWidth)out=out.slice(0,-1);
      return out+'…';
    });
    return {fontSize,lines};
  }
  draw(){
    // V15.3b: category hubs stay at the exact center of their current members.
    const liveHubEdges=this.edges.filter(e=>e.type==='hubmember');
    for(const hub of this.nodes.filter(n=>n.isHub&&!n.virtual)){
      const memberIds=new Set(
        liveHubEdges
          .filter(e=>e.a===hub.id||e.b===hub.id)
          .map(e=>e.a===hub.id?e.b:e.a)
      );
      const members=this.nodes.filter(n=>memberIds.has(n.id));

      // A one-member category has no useful midpoint: its centroid is exactly
      // the member itself, which would glue the Hub on top of that node.
      // Start live centering only once the category has 2+ members.
      if(members.length>=2){
        hub.x=members.reduce((sum,n)=>sum+n.x,0)/members.length;
        hub.y=members.reduce((sum,n)=>sum+n.y,0)/members.length;
        hub.vx=0;hub.vy=0;
      }
    }

    // v15.2a: class points continuously follow the centroid of their spell territory.
    const liveSpells=this.nodes.filter(n=>n.type==='spell');
    for(const point of this.nodes.filter(n=>n.type==='classPoint')){
      const members=liveSpells.filter(s=>(s.spellClass||'Unclassified')===(point.spellClass||'Unclassified'));
      if(members.length){
        point.x=members.reduce((sum,s)=>sum+s.x,0)/members.length;
        point.y=members.reduce((sum,s)=>sum+s.y,0)/members.length;
        point.vx=0;point.vy=0;
      }
    }

    const ctx=this.ctx,r=this.canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;
    if(this.canvas.width!==Math.round(r.width*dpr)||this.canvas.height!==Math.round(r.height*dpr)){this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr)}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,r.width,r.height);this.physics();
    const t=performance.now(),pulsing=t<this.pulseUntil;


    // Editable user-created Hub territories.
    // The Hub is the category center. The outermost member receives ~25px
    // of space between its rendered edge and the category border.
    for(const hub of this.nodes.filter(n=>n.isHub&&!n.virtual)){
      const memberIds=new Set(
        this.edges
          .filter(e=>e.type==='hubmember'&&(e.a===hub.id||e.b===hub.id))
          .map(e=>e.a===hub.id?e.b:e.a)
      );
      const members=this.nodes.filter(n=>memberIds.has(n.id));
      if(!members.length)continue;

      const H=this.worldToScreen(hub.x,hub.y);
      let rad=52;

      for(const member of members){
        const P=this.worldToScreen(member.x,member.y);
        const memberRadius=this.effectiveRadius(member)*this.zoom;
        rad=Math.max(rad,Math.hypot(P.x-H.x,P.y-H.y)+memberRadius+25);
      }

      const color=this.nodeColor(hub);
      ctx.save();
      ctx.beginPath();
      ctx.arc(H.x,H.y,rad,0,Math.PI*2);
      ctx.fillStyle=color+'09';ctx.fill();

      ctx.setLineDash([5,7]);
      ctx.strokeStyle=color+'28';
      ctx.lineWidth=1;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle=color+'bb';
      ctx.font='700 10px system-ui';
      ctx.textAlign='center';
      ctx.fillText(String(hub.name).toUpperCase(),H.x,H.y-rad+15);
      ctx.restore();
    }

    // Spell Class auras: purely visual grouping, not extra nodes or edges.
    const spellNodes=this.nodes.filter(n=>n.type==='spell');
    const classes=[...new Set(spellNodes.map(n=>n.spellClass||'Unclassified'))];
    classes.forEach(cls=>{
      const group=spellNodes.filter(n=>(n.spellClass||'Unclassified')===cls);
      if(group.length<2)return;
      const pts=group.map(n=>this.worldToScreen(n.x,n.y));
      const cx=pts.reduce((s,p)=>s+p.x,0)/pts.length,cy=pts.reduce((s,p)=>s+p.y,0)/pts.length;
      const rad=Math.max(55,...pts.map(p=>Math.hypot(p.x-cx,p.y-cy)+32));
      const color=this.nodeColor(group[0]);
      ctx.save();ctx.beginPath();ctx.arc(cx,cy,rad,0,Math.PI*2);
      ctx.fillStyle=color+'08';ctx.fill();ctx.setLineDash([5,7]);ctx.strokeStyle=color+'22';ctx.lineWidth=1;ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=color+'aa';ctx.font='600 10px system-ui';ctx.textAlign='center';ctx.fillText(String(cls).toUpperCase(),cx,cy-rad+15);ctx.restore();
    });

    // V18.3a: predetermined vertical Technology advancement spine.
    // Rendering belongs here in draw(), never in physics().
    const techRoot=this.nodes.find(n=>n.type==='technologyRoot'&&!n.hiddenTechnology);
    if(techRoot){
      const techs=this.nodes.filter(n=>n.type==='magicalObject'&&n.technological&&!n.hiddenTechnology);
      const maxAdv=techs.length?Math.max(...techs.map(n=>Math.max(0,Number(n.advancement)||0))):0;
      const topY=techRoot.y-(125+Math.log10(maxAdv+1)*235)-120;
      const A=this.worldToScreen(techRoot.x,techRoot.y-this.effectiveRadius(techRoot)-3);
      const B=this.worldToScreen(techRoot.x,topY);
      ctx.save();ctx.strokeStyle='rgba(105,216,255,.75)';ctx.lineWidth=2;ctx.shadowColor='rgba(105,216,255,.35)';ctx.shadowBlur=7;
      ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();ctx.shadowBlur=0;
      for(const n of techs){const p=this.nodes.find(x=>x.id==='techspine:'+n.id);if(!p)continue;const P=this.worldToScreen(p.x,p.y);ctx.beginPath();ctx.moveTo(P.x-5,P.y);ctx.lineTo(P.x+5,P.y);ctx.stroke()}
      ctx.restore();
    }

    for(const e of this.edges){
      const a=this.byId(e.a),b=this.byId(e.b);if(!a||!b)continue;const A=this.worldToScreen(a.x,a.y),B=this.worldToScreen(b.x,b.y),s=this.edgeStyle(e);
      ctx.save();ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.strokeStyle=s.color;ctx.lineWidth=s.width;ctx.setLineDash(s.dash);
      if(this.zoom<.55&&e.type!=='mana'&&!e.manual)ctx.globalAlpha=.22;
      else if(this.zoom<.75&&!e.manual)ctx.globalAlpha=.5;
      if(pulsing)ctx.globalAlpha=.65+.35*Math.sin(t/130+(a.x+b.y)*.01);ctx.stroke();ctx.restore();
      if(e.direction==='forward'||e.direction==='both')this.drawArrow(a,b,s.color);
      if(e.direction==='backward'||e.direction==='both')this.drawArrow(b,a,s.color);
      // Progressive detail: labels only appear when the user is close enough.
      // Important/manual links appear a little earlier than ordinary automatic links.
      const labelThreshold=e.techAdvancement?.52:(e.manual?.62:(e.type==='applies'?.72:.82));
      if(this.zoom>=labelThreshold)this.drawEdgeLabel(e,A,B,s);
    }
    if(this.linkMode&&this.linkEraseStart&&this.linkEraseEdges.size){
      ctx.save();
      for(const edge of this.linkEraseEdges){
        const a=this.byId(edge.a),b=this.byId(edge.b);if(!a||!b)continue;
        const A=this.worldToScreen(a.x,a.y),B=this.worldToScreen(b.x,b.y);
        ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);
        ctx.strokeStyle='rgba(255,92,116,.92)';
        ctx.lineWidth=Math.max(2.6,(edge.thickness||1.2)+1.6);
        ctx.setLineDash([]);
        ctx.stroke();
      }
      ctx.restore();
    }
    if(this.linkMode&&this.linkPoint&&(this.linkStart||this.linkEraseStart)){
      const A=this.linkStart?this.worldToScreen(this.linkStart.x,this.linkStart.y):this.linkEraseStart;
      ctx.save();
      ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(this.linkPoint.x,this.linkPoint.y);
      ctx.strokeStyle=this.linkStart?'rgba(156,174,255,.86)':'rgba(255,120,142,.92)';
      ctx.lineWidth=this.linkStart?1.5:2;
      ctx.setLineDash(this.linkStart?[7,5]:[3,4]);
      ctx.stroke();ctx.setLineDash([]);
      if(!this.linkStart){
        ctx.fillStyle='#ff9aac';ctx.font='700 9px system-ui';ctx.textAlign='center';
        ctx.fillText(this.linkEraseEdges.size?`REMOVE ${this.linkEraseEdges.size} LINK${this.linkEraseEdges.size===1?'':'S'}`:'REMOVE LINKS',this.linkPoint.x,this.linkPoint.y-11);
      }
      ctx.restore();
    }
    for(const n of this.nodes){
      const p=this.worldToScreen(n.x,n.y),sel=this.selected===n,base=this.nodeColor(n),radius=this.effectiveRadius(n);
      ctx.save();ctx.translate(p.x,p.y);
      if(n.isHub||n.hubVisual){
        ctx.shadowColor=base;ctx.shadowBlur=18;
        ctx.beginPath();ctx.arc(0,0,radius*this.zoom,0,Math.PI*2);ctx.fillStyle='#111925';ctx.fill();ctx.shadowBlur=0;
        ctx.strokeStyle=sel?'#fff':base;ctx.lineWidth=sel?2.4:1.8;ctx.stroke();
        ctx.beginPath();ctx.arc(0,0,(radius-5)*this.zoom,0,Math.PI*2);ctx.strokeStyle=base+'66';ctx.lineWidth=1;ctx.stroke();
      }else if(n.isSemiHub){
        // Semi-Hub: prominent, but intentionally less dominant than a Hub.
        ctx.shadowColor=base;ctx.shadowBlur=sel?16:10;
        ctx.beginPath();ctx.arc(0,0,radius*this.zoom,0,Math.PI*2);
        ctx.fillStyle='#111925';ctx.fill();ctx.shadowBlur=0;
        ctx.strokeStyle=sel?'#fff':base;ctx.lineWidth=sel?2.2:1.55;ctx.stroke();

        ctx.save();
        ctx.setLineDash([3.5,4.5]);
        ctx.beginPath();ctx.arc(0,0,(radius+4)*this.zoom,0,Math.PI*2);
        ctx.strokeStyle=base+'66';ctx.lineWidth=.9;ctx.stroke();
        ctx.restore();

        ctx.beginPath();ctx.arc(0,0,(radius-5)*this.zoom,0,Math.PI*2);
        ctx.strokeStyle=base+'35';ctx.lineWidth=.8;ctx.stroke();
      }else if(n.type==='classPoint'||n.type==='technologySpinePoint'){
        ctx.shadowColor=base;ctx.shadowBlur=9;
        ctx.beginPath();ctx.arc(0,0,radius*this.zoom,0,Math.PI*2);
        ctx.fillStyle=base;ctx.fill();ctx.shadowBlur=0;
        ctx.strokeStyle=sel?'#fff':'rgba(255,255,255,.75)';
        ctx.lineWidth=sel?2:1;
        ctx.stroke();
      }else if(n.type==='mana'){
        ctx.shadowColor=base;ctx.shadowBlur=24+Math.sin(t/400)*7;ctx.beginPath();ctx.arc(0,0,radius*this.zoom,0,Math.PI*2);ctx.fillStyle='#102b35';ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle=base;ctx.lineWidth=2;ctx.stroke();
        ctx.beginPath();ctx.arc(0,0,(radius+8+Math.sin(t/350)*2)*this.zoom,0,Math.PI*2);ctx.strokeStyle='rgba(125,231,255,.22)';ctx.lineWidth=1;ctx.stroke();
      }else{
        if(sel||pulsing){ctx.shadowColor=base;ctx.shadowBlur=sel?16:7+3*Math.sin(t/250+n.x*.01)}
        ctx.beginPath();ctx.arc(0,0,radius*this.zoom,0,Math.PI*2);ctx.fillStyle='#111725';ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle=sel?'#fff':base;ctx.lineWidth=sel?2.1:1.2;ctx.stroke();
        if(n.type==='spell'){ctx.beginPath();ctx.arc(0,0,(radius+3.5)*this.zoom,0,Math.PI*2);ctx.strokeStyle=base+'55';ctx.lineWidth=.8;ctx.stroke()}
      }
      ctx.fillStyle='#edf3ff';ctx.textAlign='center';ctx.textBaseline='middle';
      if(n.isHub||n.hubVisual){
        const fitted=this.fitNodeText(n.name,radius,this.zoom);
        ctx.font=`700 ${fitted.fontSize}px system-ui`;
        const lineH=fitted.fontSize*1.05,startY=-(fitted.lines.length-1)*lineH/2;
        fitted.lines.forEach((line,i)=>ctx.fillText(line.toUpperCase(),0,startY+i*lineH));
      }else if(n.isSemiHub){
        const fitted=this.fitNodeText(n.name,radius,this.zoom);
        ctx.font=`650 ${Math.max(7.5,fitted.fontSize+.35)}px system-ui`;
        const lineH=(fitted.fontSize+.35)*1.05,startY=-(fitted.lines.length-1)*lineH/2;
        fitted.lines.forEach((line,i)=>ctx.fillText(line,0,startY+i*lineH));
      }else if(n.type==='mana'){
        ctx.font=`600 ${Math.max(8.5,11*this.zoom)}px system-ui`;ctx.fillText(String(n.name||'MANA').toUpperCase(),0,0);
      }else if(n.type==='classPoint'||n.type==='technologySpinePoint'){
        // Intentionally no text: the tinted territory already names the class.
      }else{
        const fitted=this.fitNodeText(n.name,radius,this.zoom);
        ctx.font=`600 ${fitted.fontSize}px system-ui`;
        const lineH=fitted.fontSize*1.05,startY=-(fitted.lines.length-1)*lineH/2;
        fitted.lines.forEach((line,i)=>ctx.fillText(line,0,startY+i*lineH));
      }
      ctx.restore();
    }
    requestAnimationFrame(()=>this.draw());
  }
  bind(){
    this.canvas.addEventListener('mousedown',e=>{
      const n=this.hit(e.offsetX,e.offsetY);
      if(this.linkMode){
        if(n){
          this.linkStart=n;
          this.linkEraseStart=null;
          this.linkPoint={x:e.offsetX,y:e.offsetY};
          this.selected=n;
          if(this.onSelect)this.onSelect(n);
        }else{
          // Link started from empty space: this gesture is a connection eraser.
          this.linkStart=null;
          this.linkEraseStart={x:e.offsetX,y:e.offsetY};
          this.linkEraseLast={x:e.offsetX,y:e.offsetY};
          this.linkEraseEdges.clear();
          this.linkPoint={x:e.offsetX,y:e.offsetY};
        }
        return;
      }
      if(n){this.selected=n;if(this.onSelect)this.onSelect(n);if(!n.fixed)if(this.onNodeDragStart)this.onNodeDragStart(n);this.drag={node:n,startX:n.x,startY:n.y}}
      else this.drag={pan:true,x:e.clientX,y:e.clientY,px:this.pan.x,py:this.pan.y};
    });
    window.addEventListener('mousemove',e=>{
      if(this.linkMode&&(this.linkStart||this.linkEraseStart)){
        const r=this.canvas.getBoundingClientRect();
        const next={x:e.clientX-r.left,y:e.clientY-r.top};
        this.linkPoint=next;

        if(this.linkEraseStart){
          const prev=this.linkEraseLast||this.linkEraseStart;
          for(const edge of this.collectEdgesAlongSegment(prev.x,prev.y,next.x,next.y)){
            this.linkEraseEdges.add(edge);
          }
          this.linkEraseLast={...next};
        }
        return
      }
      if(!this.drag)return;
      if(this.drag.node){const r=this.canvas.getBoundingClientRect(),p=this.screenToWorld(e.clientX-r.left,e.clientY-r.top);this.drag.node.x=p.x;this.drag.node.y=p.y;this.drag.node.vx=this.drag.node.vy=0;if(this.onNodeDragMove)this.onNodeDragMove(this.drag.node)}
      else{this.pan.x=this.drag.px+(e.clientX-this.drag.x)/this.zoom;this.pan.y=this.drag.py+(e.clientY-this.drag.y)/this.zoom}
    });
    window.addEventListener('mouseup',e=>{
      if(this.linkMode&&(this.linkStart||this.linkEraseStart)){
        const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
        const inside=x>=0&&y>=0&&x<=r.width&&y<=r.height;

        if(this.linkStart){
          const target=inside?this.hit(x,y):null;
          const start=this.linkStart;
          this.linkStart=null;this.linkEraseStart=null;this.linkPoint=null;
          if(target&&target!==start&&this.onLinkDrop)this.onLinkDrop(start,target);
        }else{
          const eraseStart=this.linkEraseStart;
          const eraseLast=this.linkEraseLast||eraseStart;

          if(inside&&eraseLast){
            for(const edge of this.collectEdgesAlongSegment(eraseLast.x,eraseLast.y,x,y)){
              this.linkEraseEdges.add(edge);
            }
          }

          // A simple empty-space → one-line gesture still works even if the
          // pointer hardly moved.
          const direct=inside?this.edgeAtScreen(x,y):null;
          if(direct)this.linkEraseEdges.add(direct);

          const remove=[...this.linkEraseEdges];
          this.linkStart=null;
          this.linkEraseStart=null;
          this.linkEraseLast=null;
          this.linkEraseEdges.clear();
          this.linkPoint=null;

          if(remove.length){
            if(this.onEdgesSnip)this.onEdgesSnip(remove);
            else if(this.onEdgeSnip)remove.forEach(edge=>this.onEdgeSnip(edge));
          }
        }
        return;
      }
      if(this.drag?.node&&this.onNodeDragEnd){
        const moved=Math.hypot(
          this.drag.node.x-(this.drag.startX??this.drag.node.x),
          this.drag.node.y-(this.drag.startY??this.drag.node.y)
        );
        this.onNodeDragEnd(this.drag.node,moved);
      }else if(this.drag?.pan){
        const movedPx=Math.hypot(e.clientX-this.drag.x,e.clientY-this.drag.y);
        if(movedPx<5&&this.onEdgeClick){
          const r=this.canvas.getBoundingClientRect();
          const edge=this.edgeAtScreen(e.clientX-r.left,e.clientY-r.top);
          if(edge)this.onEdgeClick(edge);
        }
      }
      this.drag=null;
    });
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.max(.3,Math.min(2.2,this.zoom*(e.deltaY>0?.9:1.1)))},{passive:false});
  }
};