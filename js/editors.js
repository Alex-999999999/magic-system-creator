window.MagicEditors={
  esc(v){return String(v||'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))},
  field(label,id,value='',full=false,kind='input',extra=''){
    const e=this.esc;
    let attrs=String(extra||'').trim();

    // Defensive repair for an accidentally unclosed placeholder attribute.
    // Without this, following editor markup can leak visibly into the field.
    if(/(?:^|\s)placeholder="/.test(attrs)){
      const quoteCount=(attrs.match(/"/g)||[]).length;
      if(quoteCount%2===1)attrs+='"'
    }

    return `<label class="${full?'full':''}">${label}${kind==='textarea'?`<textarea id="${id}" rows="3" ${attrs}>${e(value)}</textarea>`:kind==='select'?`<select id="${id}" ${attrs}>${value}</select>`:`<input id="${id}" value="${e(value)}" ${attrs}>`}</label>`;
  },
  spellChecks(spells,selectedIds=[]){
    if(!spells.length)return '<div class="full"><small style="color:#7f8ba0">No spells exist yet.</small></div>';
    return `<label class="full">Specific spells<div class="check-grid">${spells.map(s=>`<label class="check-row"><input type="checkbox" class="rule-spell-check" value="${s.id}" ${selectedIds.includes(s.id)?'checked':''}>${this.esc(s.name)}</label>`).join('')}</div></label>`;
  }
};