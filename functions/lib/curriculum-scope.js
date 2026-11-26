const norm=value=>String(value??"").trim().toLowerCase().replace(/\s+/g," ");
const isCbe=value=>/cbe|cbc|competenc/.test(norm(value));
const is844=value=>/8-4-4|844/.test(norm(value));
const hasLevel=(selected,...needles)=>selected.some(value=>needles.some(needle=>norm(value)===needle||norm(value).includes(needle)));
export function gradeBelongsToSelectedLevels(grade,levels,curricula=[]){
 if(!Array.isArray(levels)||!levels.length)return false;
 const selected=levels.map(norm);
 const curriculum=norm(grade?.curriculum);
 const configured=Array.isArray(curricula)?curricula.map(norm):[];
 const cbeEnabled=configured.some(isCbe)||(!configured.length&&selected.some(x=>/pre-primary|junior|senior|grade|^pp[12]$/.test(x)));
 const legacyEnabled=configured.some(is844)||selected.some(x=>is844(x));
 const code=String(grade?.stage_code||"").trim().toUpperCase().replace(/\s+/g,"");
 const level=norm(grade?.school_level).replace(/\s+school$/,"");
 const stage=norm(grade?.stage_name);
 const gradeIs844=is844(curriculum)||/^STD[1-8]$/.test(code)||/^(FORM|F)[1-4]$/.test(code);
 const gradeIsCbe=isCbe(curriculum)||/^PP[12]$/.test(code)||/^G(?:[1-9]|1[0-2])$/.test(code);
 if(gradeIs844){
  if(!legacyEnabled)return false;
  if(/^STD[1-8]$/.test(code))return hasLevel(selected,"primary","8-4-4 primary");
  if(/^(FORM|F)[1-4]$/.test(code))return hasLevel(selected,"secondary","8-4-4 secondary","form");
  return hasLevel(selected,level,stage);
 }
 if(gradeIsCbe){
  if(!cbeEnabled)return false;
  if(/^PP[12]$/.test(code))return hasLevel(selected,"pre-primary","pp1","pp2");
  if(/^G[1-6]$/.test(code))return hasLevel(selected,"primary","grade 1","grade 2","grade 3","grade 4","grade 5","grade 6");
  if(/^G[7-9]$/.test(code))return hasLevel(selected,"junior","junior school");
  if(/^G1[0-2]$/.test(code))return hasLevel(selected,"senior","senior school");
  return hasLevel(selected,level,stage);
 }
 return hasLevel(selected,level,stage);
}
