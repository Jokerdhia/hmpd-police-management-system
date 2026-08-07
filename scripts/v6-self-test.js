const fs=require('fs'); const path=require('path');
const root=path.resolve(__dirname,'..'); const failures=[];
function read(rel){return fs.readFileSync(path.join(root,rel),'utf8')}
function assert(cond,msg){if(!cond)failures.push(msg)}
const pkg=require(path.join(root,'package.json'));
assert(pkg.version==='6.0.0',`package version=${pkg.version}`);
assert(read('dashboard-v2/server.js').includes('version: "6.0.0"'),'health version non synchronisée');

const grades=require(path.join(root,'dashboard-v2/config/grades.js'));
assert(grades.GRADES.length===12,'la hiérarchie doit contenir 12 grades');
assert(grades.getGradeIndex('Academy')===0,'Academy doit être le premier grade');
assert(grades.getGradeIndex('Chief Police')===11,'Chief Police doit être le dernier grade');
assert(grades.normalizeGradeName('Sergent')==='Sergeant','alias Sergent cassé');
for(let i=1;i<grades.GRADES.length;i++)assert(grades.GRADES[i].points>=grades.GRADES[i-1].points,'barème points non croissant');

const guard=require(path.join(root,'services/gradeChangeGuard.js'));
guard.markManagedGradeChange('123456789012345678',5000);
assert(guard.isManagedGradeChange('123456789012345678'),'gradeChangeGuard ne protège pas une modification MDT');
guard.clearManagedGradeChange('123456789012345678');
assert(!guard.isManagedGradeChange('123456789012345678'),'gradeChangeGuard ne se nettoie pas');

const officer=read('dashboard-v2/services/officerService.js');
assert(!(/\bGRADES\b/.test(officer)&&!officer.includes('GRADES,')),'GRADES utilisé sans import dans officerService');
assert(officer.includes('getOfficerExisting'),'les profils peuvent encore recréer un dossier fantôme');

const management=read('dashboard-v2/public/js/management.js');
for(const line of management.split(/\r?\n/)){const m=line.match(/const\s+(\w+)\s*=/);if(m&&line.includes('${'+m[1]+'}'))failures.push('auto-référence JS détectée dans management.js: '+m[1]);}

const extras=read('dashboard-v2/routes/extras.js');
assert(extras.includes('updateSanctionStatusForUser')&&extras.includes('deleteSanctionForUser'),'protection propriétaire sanctions absente');
const promotion=read('dashboard-v2/services/promotionService.js');
assert(promotion.includes('pg_advisory_lock'),'verrou inter-instance de promotion absent');
assert(promotion.includes('eligible_notified_at'),'anti-doublon candidat absent');
assert(promotion.includes('closed_at'),'cycle carrière fermé absent');
assert(promotion.includes("AT TIME ZONE 'Europe/Brussels'"),'calcul jours promotion sans timezone Bruxelles');
const sync=read('dashboard-v2/services/roleSyncService.js');
assert(sync.includes('isManagedGradeChange'),'sync Discord/MDT non protégé contre les courses');
const attendance=read('dashboard-v2/dashboardDatabase.js');
assert(attendance.includes('LEAST(s.effective_end,b.ends_at)'),'présence période non découpée aux limites');
const auth=read('dashboard-v2/auth/auth.js');
assert(auth.includes('Auto-modification interdite'),'protection auto-modification absente');
assert(auth.includes('targetIsHigher'),'protection hiérarchique absente');

if(failures.length){console.error('❌ V6 self-test:'); failures.forEach(x=>console.error(' - '+x)); process.exit(1)}
console.log('✅ V6 self-test : invariants critiques validés.');
