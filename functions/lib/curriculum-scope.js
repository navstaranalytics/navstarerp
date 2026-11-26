const norm=value=>String(value??"").trim().toLowerCase().replace(/\s+/g," ").replace(/\s+school$/,"");
const isCbe=value=>/cbe|cbc|competenc/.test(norm(value));
const is844=value=>/8-4-4|844/.test(norm(value));
const hasAny=(selected,...needles)=>needles.some(needle=>selected.includes(norm(needle)));
export function gradeBelongsToSelectedLevels(grade,levels,curricula=[]){
 if(!Array.isArray(levels)||!levels.length)return false;
 const selected=levels.map(norm);
 const curriculum=norm(grade?.curriculum);
 const configured=Array.isArray(curricula)?curricula.map(norm):[];
 const cbeEnabled=configured.length?configured.some(isCbe):selected.some(x=>/pre-primary|junior|senior|grade|^pp[12]$/.test(x));
 const legacyEnabled=configured.length?configured.some(is844):selected.some(is844);
 const code=String(grade?.stage_code||"").trim().toUpperCase().replace(/\s+/g,"");
 const level=norm(grade?.school_level);
 const stage=norm(grade?.stage_name);
 const gradeIs844=is844(curriculum)||/^STD[1-8]$/.test(code)||/^(FORM|F)[1-4]$/.test(code);
 const gradeIsCbe=isCbe(curriculum)||/^PP[12]$/.test(code)||/^G(?:[1-9]|1[0-2])$/.test(code);
 if(gradeIs844){
  if(!legacyEnabled)return false;
  if(/^STD[1-8]$/.test(code))return hasAny(selected,"Primary","8-4-4 Primary",code);
  if(/^(FORM|F)[1-4]$/.test(code)){const n=code.replace(/^(FORM|F)/,"");return hasAny(selected,"Secondary","8-4-4 Secondary","Form "+n,code);}
  return hasAny(selected,level,stage,code);
 }
 if(gradeIsCbe){
  if(!cbeEnabled)return false;
  if(/^PP[12]$/.test(code))return hasAny(selected,"Pre-Primary",code);
  if(/^G[1-6]$/.test(code)){const n=code.slice(1);return hasAny(selected,"Primary","Grade "+n,code);}
  if(/^G[7-9]$/.test(code)){const n=code.slice(1);return hasAny(selected,"Junior School","Junior","Grade "+n,code);}
  if(/^G1[0-2]$/.test(code)){const n=code.slice(1);return hasAny(selected,"Senior School","Senior","Grade "+n,code);}
  return hasAny(selected,level,stage,code);
 }
 return hasAny(selected,level,stage,code);
}
