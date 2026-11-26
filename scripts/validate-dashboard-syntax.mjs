import fs from "node:fs";
import { spawnSync } from "node:child_process";
for (const file of ["public/school-portal.html","public/super-admin.html","public/parent-portal.html"]) {
  const html=fs.readFileSync(file,"utf8");
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).filter(x=>x.trim());
  if(!scripts.length) throw new Error("No inline JavaScript found in "+file);
  scripts.forEach((source,index)=>{
    const result=spawnSync(process.execPath,["--check","--input-type=commonjs"],{input:source,encoding:"utf8"});
    if(result.status!==0) throw new Error(file+" script "+index+" syntax error:\n"+result.stderr);
  });
  console.log(file+": "+scripts.length+" inline script(s) passed");
}

for (const file of ["functions/api/data.js","functions/api/school-users.js","functions/api/auth.js","functions/api/schools.js","functions/api/learner-photos.js","functions/api/documents.js","functions/api/boarding-transfer.js","functions/api/backups.js","functions/api/health.js","worker.js"]) {
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
for (const code of ["PP1","PP2",...Array.from({length:12},(_,i)=>"G"+(i+1))]) {
  const level=code==="PP1"||code==="PP2"?"Pre-Primary":/^G[1-6]$/.test(code)?"Primary":/^G[7-9]$/.test(code)?"Junior School":"Senior School";
  assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan CBE",code,level),["Pre-Primary","Primary","Junior School","Senior School"],cbe),true,"CBE grade "+code+" must remain visible to a CBE school");
  assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan CBE",code,level),["Pre-Primary","Primary","Junior School","Senior School"],legacy),false,"CBE grade "+code+" must not leak into an 8-4-4-only school");
}
for (const code of [...Array.from({length:8},(_,i)=>"STD"+(i+1)),...Array.from({length:4},(_,i)=>"FORM"+(i+1))]) {
  const level=code.startsWith("STD")?"Primary":"Secondary";
  assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan 8-4-4",code,level),["8-4-4 Primary","8-4-4 Secondary"],legacy),true,"8-4-4 class "+code+" must remain available when enabled by Super Admin");
  assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan 8-4-4",code,level),["Pre-Primary","Primary","Junior School","Senior School"],cbe),false,"8-4-4 class "+code+" must not leak into a CBE-only school");
}
for (const code of ["PP1","PP2",...Array.from({length:12},(_,i)=>"G"+(i+1))]) {
  const level=code==="PP1"||code==="PP2"?"Pre-Primary":/^G[1-6]$/.test(code)?"Primary":/^G[7-9]$/.test(code)?"Junior School":"Senior School";
  assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan CBE",code,level),["Pre-Primary","Primary","Junior School","Senior School"],dual),true,"Dual-curriculum schools must retain CBE class "+code);
}
for (const code of [...Array.from({length:8},(_,i)=>"STD"+(i+1)),...Array.from({length:4},(_,i)=>"FORM"+(i+1))]) {
  const level=code.startsWith("STD")?"Primary":"Secondary";
  assert.equal(gradeBelongsToSelectedLevels(grade("Kenyan 8-4-4",code,level),["8-4-4 Primary","8-4-4 Secondary"],dual),true,"Dual-curriculum schools must retain 8-4-4 class "+code);
}

console.log("Curriculum visibility regression tests passed (CBE, 8-4-4 and dual-curriculum schools).");

const schoolPortal=fs.readFileSync("public/school-portal.html","utf8");
assert.match(schoolPortal,/boarding-houses","boarding-allocations/,"Boarding navigation resources must be available.");
assert.match(schoolPortal,/<section id="boardingWorkspace"/,"Boarding tabs must render the dedicated dormitory and allocation workspace.");
assert.match(schoolPortal,/data-edit-boarding-house/,"Dormitories must support editing saved house records.");
assert.match(schoolPortal,/data-vacate-boarding/,"Boarding allocations must support vacating or transferring a bed.");
assert.match(schoolPortal,/boarding-houses","boarding-allocations"\]\.includes\(v\)/,"Boarding pages must render the shared records workspace.");
const authSource=fs.readFileSync("functions/api/auth.js","utf8");
assert.match(authSource,/modules,boardingType/,"Authenticated school sessions must expose configured modules and boarding mode.");
const schoolsSource=fs.readFileSync("functions/api/schools.js","utf8");
assert.match(schoolsSource,/meta\.modules=meta\.modules\.filter\(x=>String\(x\)\.toLowerCase\(\)!=="boarding"\)/,"Day schools must not retain an enabled Boarding module.");
console.log("Stage III boarding configuration and workspace regression checks passed.");
const boardingIntegrity=fs.readFileSync("migrations/0026_boarding_allocation_integrity.sql","utf8");
assert.ok(boardingIntegrity.includes("CREATE TRIGGER IF NOT EXISTS boarding_allocations_validate_insert"),"D1 must validate new active boarding placements.");
assert.ok(boardingIntegrity.includes("CREATE TRIGGER IF NOT EXISTS boarding_allocations_validate_update"),"D1 must validate active boarding placement updates.");
assert.ok(boardingIntegrity.includes("Learner already has an active boarding allocation"),"D1 must prevent a learner from occupying multiple active beds.");
assert.ok(boardingIntegrity.includes("Room and bed are already occupied"),"D1 must prevent two learners occupying the same bed.");
assert.ok(boardingIntegrity.includes("Dormitory capacity reached"),"D1 must enforce dormitory capacity under concurrent writes.");
console.log("Stage III D1 boarding placement integrity checks passed.");
const backupWorkflowHandoff=fs.readFileSync(".github/workflows/d1-backup-to-r2.yml","utf8");
assert.ok(backupWorkflowHandoff.includes("id: upload"),"The R2 upload step must expose its object key as a step output.");
assert.ok(backupWorkflowHandoff.includes('echo "object_key=$OBJECT_KEY" >> "$GITHUB_OUTPUT"'),"The upload step must publish the object key.");
assert.ok(backupWorkflowHandoff.includes("OBJECT_KEY: ${{ steps.upload.outputs.object_key }}"),"Backup verification must receive the uploaded object key explicitly.");
assert.ok(backupWorkflowHandoff.includes("navstar-erp-storage/$OBJECT_KEY"),"R2 read-back and registration must use the same object key.");
assert.equal(backupWorkflowHandoff.includes("$object_key"),false,"Backup workflow must not use an undefined lower-case object_key variable.");
const recoveryRunbook=fs.readFileSync("docs/disaster-recovery.md","utf8");
assert.ok(recoveryRunbook.includes("R2 Object Read & Write"),"Recovery documentation must state the required R2 token permission.");
assert.ok(recoveryRunbook.includes("restore drill"),"Recovery documentation must require a non-production restore drill.");
console.log("Stage V backup workflow and disaster-recovery documentation checks passed.");
const reportPublishApi=fs.readFileSync("functions/api/report-card-publish.js","utf8");
assert.ok(reportPublishApi.includes('"academics.manage"'),"Only authorised academic administrators may publish report cards.");
assert.ok(reportPublishApi.includes("status IN ('draft','approved')"),"Publication must only transition draft or approved reports.");
assert.ok(reportPublishApi.includes("at least one assessed learning area"),"Empty report cards must not be published.");
assert.ok(reportPublishApi.includes("report_card.published"),"Report-card publication must be audited.");
const reportGenerator=fs.readFileSync("functions/api/report-card-generate.js","utf8");
assert.ok(reportGenerator.includes("Published reports are protected from draft regeneration"),"Draft generation must not silently overwrite published reports.");
const reportPortal=fs.readFileSync("public/school-portal.html","utf8");
assert.ok(reportPortal.includes("data-publish-report"),"School administrators must have a publish action for draft report cards.");
assert.ok(reportPortal.includes("/api/report-cards/publish"),"The publish action must call the dedicated publication API.");
assert.ok(fs.readFileSync("worker.js","utf8").includes("reportCardPublishPost"),"The worker must route report-card publication requests.");
console.log("Stage IV report-card publication and published-record protection checks passed.");
const feeReceiptsApi=fs.readFileSync("functions/api/fee-receipts.js","utf8");
assert.ok(feeReceiptsApi.includes("fee.receipt.recorded"),"Successful fee receipts must create an audit record.");
assert.ok(feeReceiptsApi.includes("await env.DB.batch(statements)"),"Receipt creation and its audit record must be committed atomically.");
assert.ok(feeReceiptsApi.includes("beforeAccount.balance"),"Receipts must be checked against the current outstanding balance.");
assert.ok(feeReceiptsApi.includes("A fee receipt cannot be dated in the future."),"Future-dated fee receipts must be rejected.");
assert.ok(feeReceiptsApi.includes("Receipt saved, audited and fee balance reconciled."),"Receipt and account changes must be verified after saving.");
console.log("Stage VI fee receipt audit, validation and balance reconciliation checks passed.");
const dateValidationSource=fs.readFileSync("functions/api/data.js","utf8");
assert.ok(dateValidationSource.includes("!/^\\d{4}-\\d{2}-\\d{2}$/.test(end)"),"Academic-year and term end dates must use a working ISO date pattern.");
assert.ok(dateValidationSource.includes("values.mark_submission_deadline&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(values.mark_submission_deadline)"),"Mark submission deadlines must use a working ISO date pattern.");
assert.equal(dateValidationSource.includes("!/^\\\\d{4}-\\\\d{2}-\\\\d{2}$/.test(end)"),false,"Academic calendar validation must not contain a double-escaped digit pattern.");
console.log("Stage II academic calendar and Stage IV mark-deadline date validation checks passed.");


const dataApi=fs.readFileSync("functions/api/data.js","utf8");
assert.equal((dataApi.match(/enforceBoardingFeature\(a\.user,name\)/g)||[]).length,4,"Boarding reads, creates, updates and deletes must all enforce the school feature gate.");
assert.match(dataApi,/Boarding is not enabled for this school/,"Day schools must receive a clear API-level boarding feature denial.");
assert.match(dataApi,/Boarding placements can only be vacated here/,"Direct allocation edits must not bypass the dedicated transfer workflow.");
assert.match(dataApi,/vacating date cannot be earlier than the placement start date/,"A boarding placement cannot be vacated before it starts.");
assert.match(dataApi,/reached its configured bed capacity/,"Boarding allocation API must enforce house capacity server-side.");
assert.match(dataApi,/already has an active boarding allocation/,"Boarding allocation API must prevent multiple active placements for one learner.");
assert.match(dataApi,/That room and bed are already occupied/,"Boarding allocation API must prevent duplicate active bed assignments.");
console.log("Boarding API feature-gate regression checks passed.");

const authApi=fs.readFileSync("functions/api/auth.js","utf8");
assert.match(authApi,/\['parent','student'\]\.includes\(user\.role_key\).*parent-portal/,"Parent and learner accounts must be routed to their dedicated portal.");
assert.match(authApi,/modules:user\.modules\|\|\[\],boardingType:user\.boardingType\|\|"day"/,"School feature configuration must be exposed to authenticated clients.");
console.log("Parent and learner portal routing regression checks passed.");

const parentPortal=fs.readFileSync("public/parent-portal.html","utf8");
assert.match(parentPortal,/api\("\/api\/portal\/me"\)/,"Parent and learner portal must call the registered /api/portal/me route.");
const brandingApi=fs.readFileSync("functions/api/branding.js","utf8");
assert.match(brandingApi,/writeReadDelete:"passed"/,"Storage health check must verify an R2 upload, read-back and delete.");
assert.match(brandingApi,/await env\.R2\.delete\(key\)/,"Temporary R2 health-check objects must be cleaned up.");
console.log("Parent portal endpoint and live R2 storage-check regression assertions passed.");

assert.match(parentPortal,/data\.learningAreas/,"Parent portal must render published learning-area results.");
assert.match(parentPortal,/data\.overallScore/,"Parent portal must display the published overall result.");
console.log("Published report detail rendering regression checks passed.");

const portalApi=fs.readFileSync("functions/api/portal.js","utf8");
assert.match(portalApi,/JOIN attendance_sessions ats ON ats\.id=ar\.session_id/,"Family attendance summaries must join the learner's attendance sessions.");
assert.match(portalApi,/ats\.academic_year_id IS \?/,"Family attendance summaries must be scoped to the active enrolment academic year.");
assert.match(portalApi,/attendance_status='excused'/,"Family attendance summaries must count excused sessions separately.");
console.log("Family attendance academic-year scoping regression checks passed.");

const learnerPhotosApi=fs.readFileSync("functions/api/learner-photos.js","utf8");
assert.match(learnerPhotosApi, /["']\/passport\/["']\+crypto\.randomUUID\(\)/, "Learner passport replacements must use versioned R2 keys to protect the previous file until verification.");
assert.match(learnerPhotosApi,/const storedBytes=new Uint8Array\(await stored\.arrayBuffer\(\)\)/,"Learner passport uploads must read back the uploaded R2 object.");
assert.match(learnerPhotosApi,/Old learner passport cleanup failed/,"Previous R2 passport objects should be cleaned up only after the new database pointer is saved.");
console.log("Learner passport R2 replacement integrity regression checks passed.");

const workerSource=fs.readFileSync("worker.js","utf8");
assert.match(workerSource,/request\.method === "DELETE"\) return learnerPhotoDelete/,"Worker must expose the learner passport photo DELETE route.");
assert.match(workerSource,/onRequestDeletePhoto as learnerPhotoDelete/,"Worker must import the learner passport photo deletion handler.");
assert.match(schoolPortal,/data-delete-learner-photo/,"School learner records must expose the remove-photo action.");
const photoDeleteSource=fs.readFileSync("functions/api/learner-photos.js","utf8");
assert.match(photoDeleteSource,/export async function onRequestDeletePhoto/,"Learner passport photo removal must have a dedicated handler.");
console.log("Learner passport photo removal route and UI regression checks passed.");
const documentsApi=fs.readFileSync("functions/api/documents.js","utf8");
const documentsMigration=fs.readFileSync("migrations/0023_school_document_storage.sql","utf8");
assert.match(workerSource,/onRequestGet as schoolDocumentsGet/,"Worker must import the school document API handlers.");
assert.match(workerSource,/route === "\/api\/documents"/,"Worker must expose the school document API route.");
assert.match(documentsApi,/MAX_BYTES=25\*1024\*1024/,"School document uploads must enforce the 25 MB limit.");
assert.match(documentsApi,/await env\.R2\.put\(key,bytes/,"School documents must be stored in R2.");
assert.match(documentsApi,/sameBytes=!!stored&&storedBytes\.byteLength===bytes\.byteLength&&await hash\(storedBytes\)===await hash\(bytes\)/,"School document uploads must verify R2 read-back bytes by SHA-256.");
assert.match(documentsApi,/school_id=\?/,"School document operations must be scoped to the authenticated school.");
assert.match(documentsMigration,/CREATE TABLE IF NOT EXISTS school_documents/,"D1 must store school document metadata.");
assert.match(schoolPortal,/id="documentsWorkspace"[\s\S]*?id="documentUploadForm"[\s\S]*?id="documentsTable"/,"School Admin must have a dedicated document upload and register workspace.");
assert.match(schoolPortal,/data-download-school-document/,"School Admin must be able to download stored documents.");
assert.match(schoolPortal,/data-delete-school-document/,"School Admin must be able to delete stored documents.");
console.log("R2 school document upload, tenant isolation, verification and register regression checks passed.");
const boardingTransferApi=fs.readFileSync("functions/api/boarding-transfer.js","utf8");
assert.match(workerSource,/onRequestPost as boardingTransferPost/,"Worker must import the boarding transfer API.");
assert.match(workerSource,/route === "\/api\/boarding\/transfer"/,"Worker must route boarding transfer requests.");
assert.match(boardingTransferApi,/env\.DB\.batch\(\[/,"Boarding transfer must close and create placements in one D1 batch.");
assert.match(boardingTransferApi,/destination dormitory has reached its configured bed capacity/,"Boarding transfer must enforce destination capacity server-side.");
assert.match(boardingTransferApi,/selected destination room and bed are already occupied/,"Boarding transfer must reject occupied destination beds.");
assert.match(schoolPortal,/id="boardingTransferForm"[\s\S]*?id="boardingTransferHouse"/,"School Admin must provide a direct boarding transfer form.");
assert.match(schoolPortal,/data-transfer-boarding/,"Active boarding placements must expose a transfer action.");
console.log("Boarding transfer capacity, occupancy, atomic write and UI regression checks passed.");
const boardingDataApi=fs.readFileSync("functions/api/data.js","utf8");
const boardingRoomsMigration=fs.readFileSync("migrations/0024_boarding_rooms_and_beds.sql","utf8");
assert.match(boardingDataApi,/"boarding-rooms":\{table:"boarding_rooms"/,"Boarding room records must be school-scoped D1 resources.");
assert.match(boardingDataApi,/total capacity of this dormitory's rooms cannot exceed the house capacity/,"Room capacities must not exceed the dormitory capacity.");
assert.match(boardingDataApi,/Bed number must be between 1 and the room's configured capacity/,"New allocations must respect the configured room bed count.");
assert.match(boardingDataApi,/This room has reached its configured bed capacity/,"Room occupancy must be enforced server-side.");
assert.match(boardingTransferApi,/destination room's configured capacity/,"Transfers must respect destination room capacity.");
assert.match(boardingRoomsMigration,/CREATE TABLE IF NOT EXISTS boarding_rooms/,"D1 must persist room capacity records.");
assert.match(schoolPortal,/id="boardingRoomForm"[\s\S]*?id="boardingRoomsTable"/,"School Admin must have a room register and capacity editor.");
assert.match(schoolPortal,/id="boardingRoomSelect"/,"Learner allocations must choose a configured room.");
assert.match(schoolPortal,/id="boardingBedNumber"[^>]*type="number"/,"Learner allocations must select a numbered bed within room capacity.");
console.log("Boarding room registers and room-level bed capacity regression checks passed.");
const backupApi=fs.readFileSync("functions/api/backups.js","utf8");
const backupAdminSource=fs.readFileSync("public/super-admin.html","utf8");
const backupWorkflow=fs.readFileSync(".github/workflows/d1-backup-to-r2.yml","utf8");
const backupMigration=fs.readFileSync("migrations/0025_platform_backups.sql","utf8");
assert.match(workerSource,/onRequestGet as platformBackupsGet/,"Worker must import the Super Admin backup API.");
assert.match(workerSource,/route === "\/api\/backups"/,"Worker must route the backup register and download API.");
assert.match(backupApi,/getSuperAdminSession/,"Backup history and downloads must require Super Admin authentication.");
assert.match(backupApi,/env\.R2\.get\(row\.object_key\)/,"Backup downloads must stream from R2.");
assert.match(backupWorkflow,/wrangler d1 export navstar-erp-db --remote/,"Scheduled backup must export the remote D1 database.");
assert.match(backupWorkflow,/wrangler r2 object put/,"Scheduled backup must upload the SQL export to R2.");
assert.match(backupWorkflow,/wrangler r2 object get/,"Scheduled backup must read the R2 object back for verification.");
assert.match(backupWorkflow,/sha256sum/,"Scheduled backup must verify the uploaded backup checksum.");
assert.match(backupWorkflow,/INSERT INTO platform_backups/,"Verified backups must be registered in D1.");
assert.match(backupMigration,/CREATE TABLE IF NOT EXISTS platform_backups/,"D1 must retain backup verification metadata.");
assert.match(backupAdminSource,/Automated D1 backups/,"Super Admin must have a verified backup register.");
assert.match(backupAdminSource,/data-download-platform-backup/,"Super Admin must be able to download verified backup files.");
assert.ok(brandingApi.includes('writeReadDelete:"failed",cleanup:"failed"'),"R2 health must fail when temporary-object cleanup fails.");
assert.ok(backupAdminSource.includes("R2 read/write/delete verified"),"Super Admin health must distinguish a successful R2 operation test from a configured binding.");
assert.ok(backupAdminSource.includes("Checking D1 and R2 upload, read-back and cleanup"),"Super Admin settings must actively refresh live storage health.");
assert.ok(backupAdminSource.includes("private R2 for uploaded files"),"Super Admin storage guidance must describe the deployed D1 and R2 architecture accurately.");
console.log("Automated D1-to-R2 backup, checksum verification and Super Admin register regression checks passed.");
const healthApi=fs.readFileSync("functions/api/health.js","utf8");
const deployWorkflow=fs.readFileSync(".github/workflows/cloudflare-setup-deploy.yml","utf8");
for(const table of ["school_documents","boarding_rooms","platform_backups","fee_receipts"])assert.match(healthApi,new RegExp('"'+table+'"'),"Live health schema must require "+table+".");
assert.match(deployWorkflow,/Verify live Worker and D1 schema/,"Production deploy must perform a live health check.");
assert.match(deployWorkflow,/https:\/\/navstarerp\.navstaranalytics\.workers\.dev\/api\/health/,"Live health check must target the deployed Worker.");
assert.match(deployWorkflow,/r\.database!==['"]connected['"]\|\|r\.schema!==['"]ready['"]/,"Live health check must verify connected D1 and complete schema.");
console.log("Live Worker and D1 schema health-check regression checks passed.");





const superAdminSource=fs.readFileSync("public/super-admin.html","utf8");
const flatBillingStart=superAdminSource.lastIndexOf("Stage VI: enforce flat school subscription pricing");
if(flatBillingStart<0)throw new Error("Stage VI flat school billing override is missing.");
const flatBilling=superAdminSource.slice(flatBillingStart);
assert.match(flatBilling,/max_learners:null,storage_gb:null/,"New and updated subscription plans must not impose learner or storage limits.");
assert.match(flatBilling,/pages\.subscriptions=function\(\)/,"The live subscriptions page must use the D1-backed fixed-fee workspace.");
assert.match(flatBilling,/No per-learner or storage charges/,"Subscription UI must clearly state fixed school pricing.");
assert.doesNotMatch(flatBilling,/Maximum learners|Included storage \(GB\)|Learner count for billing/,"The effective plan and school billing forms must not expose learner or storage pricing.");
assert.match(flatBilling,/billing_model:\["flat_school_year","flat_school_term"\]/,"Only annual and term billing models may be saved.");
console.log("Flat annual/term school billing and no learner/storage pricing regression checks passed.");
assert.match(schoolPortal,/id="staffWorkspace"[\s\S]*?id="staffTable"/,"Staff workspace must contain a staff directory and data host.");
assert.match(schoolPortal,/id="attendanceWorkspace"[\s\S]*?id="attendanceSessionForm"[\s\S]*?id="attendanceSessionsTable"/,"Attendance workspace must contain a register form and saved-register table.");
assert.match(schoolPortal,/id="timetableWorkspace"[\s\S]*?id="timetableForm"[\s\S]*?id="timetableTable"/,"Timetable workspace must contain a lesson form and timetable host.");
assert.match(schoolPortal,/id="financeWorkspace"[\s\S]*?id="feeStructureForm"[\s\S]*?id="learnerFeeForm"[\s\S]*?id="financeTransactionsTable"/,"Finance workspace must contain fee setup, learner fee assignment and transaction history.");
assert.match(schoolPortal,/id="assessmentsWorkspace"[\s\S]*?id="assessmentForm"[\s\S]*?id="assessmentsTable"/,"Assessments workspace must contain an assessment form and records table.");
assert.match(schoolPortal,/id="analyticsWorkspace"[\s\S]*?id="analyticsFilters"[\s\S]*?id="analyticsResults"/,"School analytics must contain report filters and a results host.");
assert.match(schoolPortal,/id="learningAreasWorkspace"[\s\S]*?id="learningAreasContent"/,"Learning Areas workspace must contain a live catalogue host.");
assert.match(schoolPortal,/async function loadFinance\(\)[\s\S]*?fee-structures[\s\S]*?finance-transactions/,"Finance loader must read school fee structures and transaction records from the API.");
assert.match(schoolPortal,/async function loadStaff\(\)[\s\S]*?staff/,"Staff workspace must load staff profiles from the API.");
assert.match(schoolPortal,/async function loadAttendance\(\)[\s\S]*?attendance-sessions/,"Attendance loader must read saved registers from the API.");
assert.match(schoolPortal,/async function loadTimetable\(\)[\s\S]*?timetable/,"Timetable loader must read saved timetable entries from the API.");
assert.match(schoolPortal,/async function loadAssessments\(\)[\s\S]*?assessment-results/,"Assessments loader must read assessment results from the API.");
assert.match(schoolPortal,/async function loadAnalyticsSetup\(\)/,"School analytics must have an initialisation workflow.");
assert.match(schoolPortal,/async function loadAcademicSetup\(\)/,"Learning Areas must load school curriculum setup from the API.");
console.log("School Admin staff, attendance, timetable, finance, assessments, analytics and learning-area workspace regression checks passed.");
assert.doesNotMatch(schoolPortal,/localStorage/,"School Admin persistent school data must not be stored in browser localStorage.");


