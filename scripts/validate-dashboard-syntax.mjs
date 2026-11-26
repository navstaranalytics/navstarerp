import fs from "node:fs";
import { spawnSync } from "node:child_process";
for (const file of ["public/school-portal.html","public/super-admin.html"]) {
  const html=fs.readFileSync(file,"utf8");
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).filter(x=>x.trim());
  if(!scripts.length) throw new Error("No inline JavaScript found in "+file);
  scripts.forEach((source,index)=>{
    const result=spawnSync(process.execPath,["--check","--input-type=commonjs"],{input:source,encoding:"utf8"});
    if(result.status!==0) throw new Error(file+" script "+index+" syntax error:\n"+result.stderr);
  });
  console.log(file+": "+scripts.length+" inline script(s) passed");
}

for (const file of ["functions/api/data.js","functions/api/school-users.js","functions/api/auth.js","functions/api/schools.js"]) {
  const source=fs.readFileSync(file,"utf8");
  const result=spawnSync(process.execPath,["--check","--input-type=module"],{input:source,encoding:"utf8"});
  if(result.status!==0) throw new Error(file+" syntax error:\\n"+result.stderr);
  console.log(file+": module syntax passed");
}

const pdfCheck=spawnSync(process.execPath,["--check","public/navstar-pdf.js"],{encoding:"utf8"});
if(pdfCheck.status!==0) throw new Error("public/navstar-pdf.js syntax error:\n"+pdfCheck.stderr);
console.log("public/navstar-pdf.js: syntax passed");

import assert from "node:assert/strict";
import { gradeBelongsToSelectedLevels } from "../functions/lib/curriculum-scope.js";
const cbe=["Kenyan CBE"],legacy=["Kenyan 8-4-4"],dual=[...cbe,...legacy];
const selected=["Primary","Pre-Primary","Junior School","Senior School"];
const grade=(curriculum,stage_code,school_level,stage_name=stage_code)=>({curriculum,stage_code,school_level,stage_name});
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan CBE","G4","Primary"),selected,cbe),true);
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan 8-4-4","STD4","Primary"),selected,cbe),false);
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan 8-4-4","STD4","Primary"),["Primary"],legacy),true);
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan CBE","G4","Primary"),["Primary"],legacy),false);
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan CBE","G4","Primary"),["Primary"],dual),true);
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan 8-4-4","STD4","Primary"),["Primary"],dual),true);
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan CBE","PP1","Pre-Primary"),selected,cbe),true);
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan CBE","G10","Senior School"),selected,cbe),true);
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan 8-4-4","FORM4","Secondary"),["8-4-4 Secondary"],legacy),true);

assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan CBE","G4","Primary"),["8-4-4 Primary"],dual),false);
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan 8-4-4","STD4","Primary"),["Senior School"],dual),false);
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan CBE","G10","Senior School"),["Grade 10"],cbe),true);
assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan 8-4-4","FORM4","Secondary"),["Grade 10"],legacy),false);
console.log("Curriculum visibility regression tests passed (CBE, 8-4-4 and dual-curriculum schools).");

const schoolPortal=fs.readFileSync("public/school-portal.html","utf8");
assert.match(schoolPortal,/boarding-houses","boarding-allocations/,"Boarding navigation resources must be available.");
assert.match(schoolPortal,/boarding-houses","boarding-allocations"\]\.includes\(v\)/,"Boarding pages must render the shared records workspace.");
const authSource=fs.readFileSync("functions/api/auth.js","utf8");
assert.match(authSource,/modules,boardingType/,"Authenticated school sessions must expose configured modules and boarding mode.");
const schoolsSource=fs.readFileSync("functions/api/schools.js","utf8");
assert.match(schoolsSource,/meta\.modules=meta\.modules\.filter\(x=>String\(x\)\.toLowerCase\(\)!=="boarding"\)/,"Day schools must not retain an enabled Boarding module.");
console.log("Stage III boarding configuration and workspace regression checks passed.");

const dataApi=fs.readFileSync("functions/api/data.js","utf8");
assert.equal((dataApi.match(/enforceBoardingFeature\(a\.user,name\)/g)||[]).length,4,"Boarding reads, creates, updates and deletes must all enforce the school feature gate.");
assert.match(dataApi,/Boarding is not enabled for this school/,"Day schools must receive a clear API-level boarding feature denial.");
console.log("Boarding API feature-gate regression checks passed.");
