window.MagicGraph=class MagicGraph{
  constructor(canvas){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');
    this.nodes=[];this.edges=[];this.selected=null;this.pan={x:0,y:0};this.zoom=1;this.drag=null;
    this.linkMode=false;this.linkStart=null;this.linkPoint=null;this.snipMode=false;this.pulseUntil=0;this.frozen=false;this.pullStrength=1;this.largeGraphScale=1;this.collisionStrength=1;this.globalRulePull=0.375;
    this.onSelect=null;this.onLinkDrop=null;this.onEdgeSnip=null;
    this.bind();
  }
  setData(nodes,edges){this.nodes=nodes;this.edges=edges}
  byId(id){return this.nodes.find(n=>n.id===id)}
  worldToScreen(x,y){const r=this.canvas.getBoundingClientRect();return{x:r.width/2+(x+this.pan.x)*this.zoom,y:r.height/2+(y+this.pan.y)*this.zoom}}
  screenToWorld(x,y){const r=this.canvas.getBoundingClientRect();return{x:(x-r.width/2)/this.zoom-this.pan.x,y:(y-r.height/2)/this.zoom-this.pan.y}}
  hit(x,y){const p=this.screenToWorld(x,y);return [...this.nodes].reverse().find(n=>Math.hypot(p.x-n.x,p.y-n.y)<=this.effectiveRadius(n)+8)}
  setLinkMode(on){this.linkMode=!!on;this.linkStart=null;this.linkPoint=null;if(on)this.snipMode=false}
  setSnipMode(on){this.snipMode=!!on;if(on){this.linkMode=false;this.linkStart=null;this.linkPoint=null}}
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
      const a=this.byId(e.a),b=this.byId(e.b);if(!a||!b)continue;
      const A=this.worldToScreen(a.x,a.y),B=this.worldToScreen(b.x,b.y);
      const d=this.pointSegmentDistance(x,y,A.x,A.y,B.x,B.y);
      const threshold=Math.max(7,(e.thickness||1.2)*4);
      if(d<threshold&&d<bestD){best=e;bestD=d}
    }
    return best;
  }
  physics(){
    if(this.frozen)return;
    for(const e of this.edges){
      const a=this.byId(e.a),b=this.byId(e.b);if(!a||!b)continue;
      const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy));
      const target=e.type==='mana'?190:e.type==='similar'?105:e.type==='applies'?220:170;
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
    for(const n of this.nodes)if(!n.fixed&&this.drag?.node!==n){n.vx*=.91;n.vy*=.91;n.x+=n.vx;n.y+=n.vy}
  }
  edgeStyle(e){
    const C=window.MAGIC_DATA;
    if(e.manual)return{color:C.MANUAL_COLORS[e.linkType]||'#cfd7ff',width:e.thickness||1.6,dash:e.strength==='dashed'?[7,5]:e.strength==='dotted'?[2,5]:[]};
    if(e.type==='mana')return{color:'rgba(125,231,255,.34)',width:1.15,dash:[]};
    if(e.type==='similar')return{color:'rgba(198,164,255,.46)',width:1.25,dash:[]};
    if(e.type==='applies')return{color:'rgba(230,182,109,.40)',width:1.15,dash:[6,5]};
    if(e.type==='uses')return{color:'rgba(139,164,212,.34)',width:1.05,dash:[2,5]};
    return{color:'rgba(170,180,199,.30)',width:1,dash:[3,5]};
  }
  nodeColor(n){
    const D=window.MAGIC_DATA;
    if(n.type==='spell'){
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
  drawArrow(from,to,color){
    const ctx=this.ctx,ang=Math.atan2(to.y-from.y,to.x-from.x),len=8;
    ctx.save();ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(to.x,to.y);ctx.lineTo(to.x-Math.cos(ang-.45)*len,to.y-Math.sin(ang-.45)*len);ctx.moveTo(to.x,to.y);ctx.lineTo(to.x-Math.cos(ang+.45)*len,to.y-Math.sin(ang+.45)*len);ctx.stroke();ctx.restore();
  }
  effectiveRadius(n){
    if(n.type==='mana')return 45;
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
    const ctx=this.ctx,r=this.canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;
    if(this.canvas.width!==Math.round(r.width*dpr)||this.canvas.height!==Math.round(r.height*dpr)){this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr)}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,r.width,r.height);this.physics();
    const t=performance.now(),pulsing=t<this.pulseUntil;

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

    for(const e of this.edges){
      const a=this.byId(e.a),b=this.byId(e.b);if(!a||!b)continue;const A=this.worldToScreen(a.x,a.y),B=this.worldToScreen(b.x,b.y),s=this.edgeStyle(e);
      ctx.save();ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.strokeStyle=s.color;ctx.lineWidth=s.width;ctx.setLineDash(s.dash);
      if(this.zoom<.55&&e.type!=='mana'&&!e.manual)ctx.globalAlpha=.22;
      else if(this.zoom<.75&&!e.manual)ctx.globalAlpha=.5;
      if(pulsing)ctx.globalAlpha=.65+.35*Math.sin(t/130+(a.x+b.y)*.01);ctx.stroke();ctx.restore();
      if(e.direction==='forward'||e.direction==='both')this.drawArrow(A,B,s.color);
      if(e.direction==='backward'||e.direction==='both')this.drawArrow(B,A,s.color);
      // Progressive detail: labels only appear when the user is close enough.
      // Important/manual links appear a little earlier than ordinary automatic links.
      const labelThreshold=e.manual?.62:(e.type==='applies'?.72:.82);
      if(this.zoom>=labelThreshold)this.drawEdgeLabel(e,A,B,s);
    }
    if(this.linkMode&&this.linkStart&&this.linkPoint){
      const A=this.worldToScreen(this.linkStart.x,this.linkStart.y);
      ctx.save();ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(this.linkPoint.x,this.linkPoint.y);ctx.strokeStyle='rgba(156,174,255,.8)';ctx.lineWidth=1.5;ctx.setLineDash([7,5]);ctx.stroke();ctx.restore();
    }
    for(const n of this.nodes){
      const p=this.worldToScreen(n.x,n.y),sel=this.selected===n,base=this.nodeColor(n),radius=this.effectiveRadius(n);
      ctx.save();ctx.translate(p.x,p.y);
      if(n.type==='mana'){
        ctx.shadowColor=base;ctx.shadowBlur=24+Math.sin(t/400)*7;ctx.beginPath();ctx.arc(0,0,radius*this.zoom,0,Math.PI*2);ctx.fillStyle='#102b35';ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle=base;ctx.lineWidth=2;ctx.stroke();
        ctx.beginPath();ctx.arc(0,0,(radius+8+Math.sin(t/350)*2)*this.zoom,0,Math.PI*2);ctx.strokeStyle='rgba(125,231,255,.22)';ctx.lineWidth=1;ctx.stroke();
      }else{
        if(sel||pulsing){ctx.shadowColor=base;ctx.shadowBlur=sel?16:7+3*Math.sin(t/250+n.x*.01)}
        ctx.beginPath();ctx.arc(0,0,radius*this.zoom,0,Math.PI*2);ctx.fillStyle='#111725';ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle=sel?'#fff':base;ctx.lineWidth=sel?2.1:1.2;ctx.stroke();
        if(n.type==='spell'){ctx.beginPath();ctx.arc(0,0,(radius+3.5)*this.zoom,0,Math.PI*2);ctx.strokeStyle=base+'55';ctx.lineWidth=.8;ctx.stroke()}
      }
      ctx.fillStyle='#edf3ff';ctx.textAlign='center';ctx.textBaseline='middle';
      if(n.type==='mana'){
        ctx.font=`600 ${Math.max(8.5,11*this.zoom)}px system-ui`;ctx.fillText('MANA',0,0);
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
      if(this.snipMode){
        const edge=this.edgeAtScreen(e.offsetX,e.offsetY);
        if(edge&&this.onEdgeSnip)this.onEdgeSnip(edge);
        return;
      }
      const n=this.hit(e.offsetX,e.offsetY);
      if(this.linkMode){
        if(n){this.linkStart=n;this.linkPoint={x:e.offsetX,y:e.offsetY};this.selected=n;if(this.onSelect)this.onSelect(n)}
        return;
      }
      if(n){this.selected=n;if(this.onSelect)this.onSelect(n);if(!n.fixed)this.drag={node:n}}
      else this.drag={pan:true,x:e.clientX,y:e.clientY,px:this.pan.x,py:this.pan.y};
    });
    window.addEventListener('mousemove',e=>{
      if(this.linkMode&&this.linkStart){const r=this.canvas.getBoundingClientRect();this.linkPoint={x:e.clientX-r.left,y:e.clientY-r.top};return}
      if(!this.drag)return;
      if(this.drag.node){const r=this.canvas.getBoundingClientRect(),p=this.screenToWorld(e.clientX-r.left,e.clientY-r.top);this.drag.node.x=p.x;this.drag.node.y=p.y;this.drag.node.vx=this.drag.node.vy=0}
      else{this.pan.x=this.drag.px+(e.clientX-this.drag.x)/this.zoom;this.pan.y=this.drag.py+(e.clientY-this.drag.y)/this.zoom}
    });
    window.addEventListener('mouseup',e=>{
      if(this.linkMode&&this.linkStart){
        const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
        const target=(x>=0&&y>=0&&x<=r.width&&y<=r.height)?this.hit(x,y):null;
        const start=this.linkStart;this.linkStart=null;this.linkPoint=null;
        if(target&&target!==start&&this.onLinkDrop)this.onLinkDrop(start,target);
        return;
      }
      this.drag=null;
    });
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.max(.3,Math.min(2.2,this.zoom*(e.deltaY>0?.9:1.1)))},{passive:false});
  }
};