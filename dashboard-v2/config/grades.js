const GRADES = [
  { name: 'Academy', points: 0, roleId: process.env.ROLE_ACADEMY },
  { name: 'Officer', points: 10, roleId: process.env.ROLE_OFFICER },
  { name: 'Senior Officer', points: 25, roleId: process.env.ROLE_SENIOR_OFFICER },
  { name: 'Sergent', points: 45, roleId: process.env.ROLE_SERGENT },
  { name: 'First Sergent', points: 70, roleId: process.env.ROLE_FIRST_SERGENT },
  { name: 'Lieutenant', points: 100, roleId: process.env.ROLE_LIEUTENANT },
  { name: 'Captain', points: 140, roleId: process.env.ROLE_CAPTAIN },
  { name: 'Commander', points: 190, roleId: process.env.ROLE_COMMANDER },
];
function getGradeFromPoints(points){let current=GRADES[0];for(const grade of GRADES){if(Number(points)>=grade.points)current=grade;}return current;}
function getNextGrade(points){return GRADES.find(g=>g.points>Number(points))||null;}
function getAllGradeRoleIds(){return GRADES.map(g=>g.roleId).filter(Boolean);}
function getGradeIndex(name){return GRADES.findIndex(g=>g.name===name);}


// Grades affichés depuis les vrais rôles Discord.
// L'ordre va du plus haut grade au plus bas.
const DISCORD_DISPLAY_GRADES = [
  { name: 'Chief Police', roleId: process.env.ROLE_CHIEF_POLICE },
  { name: 'Assistant Chief', roleId: process.env.ROLE_ASSISTANT_CHIEF },
  { name: 'Deputy Chief', roleId: process.env.ROLE_DEPUTY_CHIEF },
  { name: 'Commander', roleId: process.env.ROLE_COMMANDER },
  { name: 'Captain', roleId: process.env.ROLE_CAPTAIN },
  { name: 'Lieutenant', roleId: process.env.ROLE_LIEUTENANT },
  { name: 'First Sergent', roleId: process.env.ROLE_FIRST_SERGENT },
  { name: 'Sergent', roleId: process.env.ROLE_SERGENT },
  { name: 'Senior Officer', roleId: process.env.ROLE_SENIOR_OFFICER },
  { name: 'Officer', roleId: process.env.ROLE_OFFICER },
  { name: 'Academy', roleId: process.env.ROLE_ACADEMY },
];

function getDiscordGradeFromRoles(roles) {
  const memberRoles = new Set((Array.isArray(roles) ? roles : []).map(String));
  const match = DISCORD_DISPLAY_GRADES.find((grade) => {
    const roleId = String(grade.roleId || '').trim();
    return roleId && memberRoles.has(roleId);
  });
  return match?.name || null;
}

module.exports={GRADES,DISCORD_DISPLAY_GRADES,getGradeFromPoints,getNextGrade,getAllGradeRoleIds,getGradeIndex,getDiscordGradeFromRoles};
