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

const pdfCheck=spawnSync(process.execPath,["--check","public/navstar-pdf.js"],{encoding:"utf8"});
if(pdfCheck.status!==0) throw new Error("public/navstar-pdf.js syntax error:\n"+pdfCheck.stderr);
console.log("public/navstar-pdf.js: syntax passed");
