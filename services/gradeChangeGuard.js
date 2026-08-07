const KEY=Symbol.for('hmpd.managedGradeChanges');
const store=globalThis[KEY]||(globalThis[KEY]=new Map());
function cleanup(){const now=Date.now();for(const [id,until] of store){if(until<=now)store.delete(id)}}
function markManagedGradeChange(userId,ttlMs=30000){cleanup();store.set(String(userId),Date.now()+Math.max(5000,Number(ttlMs)||30000))}
function isManagedGradeChange(userId){cleanup();return (store.get(String(userId))||0)>Date.now()}
function clearManagedGradeChange(userId){store.delete(String(userId))}
module.exports={markManagedGradeChange,isManagedGradeChange,clearManagedGradeChange};
