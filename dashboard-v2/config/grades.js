const GRADES = [
  { name: 'Academy', points: 0, roleId: process.env.ROLE_ACADEMY },
  { name: 'Officer', points: 10, roleId: process.env.ROLE_OFFICER },
  { name: 'Senior Officer', points: 25, roleId: process.env.ROLE_SENIOR_OFFICER },
  { name: 'Sergeant', points: 45, roleId: process.env.ROLE_SERGENT },
  { name: 'First Sergeant', points: 70, roleId: process.env.ROLE_FIRST_SERGENT },
  { name: 'Lieutenant', points: 100, roleId: process.env.ROLE_LIEUTENANT },
  { name: 'Captain', points: 140, roleId: process.env.ROLE_CAPTAIN },
  { name: 'Commander', points: 190, roleId: process.env.ROLE_COMMANDER },
];

function getGradeFromPoints(points) {
  let current = GRADES[0];
  for (const grade of GRADES) {
    if (Number(points) >= grade.points) current = grade;
  }
  return current;
}

function getNextGrade(points) {
  return GRADES.find((grade) => grade.points > Number(points)) || null;
}

function getAllGradeRoleIds() {
  return GRADES.map((grade) => grade.roleId).filter(Boolean);
}

function getGradeIndex(name) {
  const normalized = normalizeGradeName(name);
  return GRADES.findIndex((grade) => grade.name === normalized);
}

/*
 * Hiérarchie Discord réelle, du grade le plus élevé au plus bas.
 * Le premier rôle trouvé sur le membre est celui affiché partout dans le dashboard.
 */
const DISCORD_DISPLAY_GRADES = [
  { name: 'Chief Police', roleId: process.env.ROLE_CHIEF_POLICE },
  { name: 'Vice Chief', roleId: process.env.ROLE_VICE_CHIEF },
  { name: 'Assistant Chief', roleId: process.env.ROLE_ASSISTANT_CHIEF },
  { name: 'Deputy Chief', roleId: process.env.ROLE_DEPUTY_CHIEF },
  { name: 'Commander', roleId: process.env.ROLE_COMMANDER },
  { name: 'Captain', roleId: process.env.ROLE_CAPTAIN },
  { name: 'Lieutenant', roleId: process.env.ROLE_LIEUTENANT },
  { name: 'First Sergeant', roleId: process.env.ROLE_FIRST_SERGENT },
  { name: 'Sergeant', roleId: process.env.ROLE_SERGENT },
  { name: 'Senior Officer', roleId: process.env.ROLE_SENIOR_OFFICER },
  { name: 'Officer', roleId: process.env.ROLE_OFFICER },
  { name: 'Academy', roleId: process.env.ROLE_ACADEMY },
];

const GRADE_ALIASES = new Map([
  ['sergent', 'Sergeant'],
  ['sergeant', 'Sergeant'],
  ['first sergent', 'First Sergeant'],
  ['first sergeant', 'First Sergeant'],
  ['deputy chief', 'Deputy Chief'],
  ['assistant chief', 'Assistant Chief'],
  ['vice chief', 'Vice Chief'],
  ['vice-chief', 'Vice Chief'],
  ['vicechief', 'Vice Chief'],
  ['chief police', 'Chief Police'],
]);

function normalizeGradeName(name) {
  const value = String(name || '').trim();
  if (!value) return value;

  const alias = GRADE_ALIASES.get(value.toLowerCase());
  if (alias) return alias;

  const exact = DISCORD_DISPLAY_GRADES.find(
    (grade) => grade.name.toLowerCase() === value.toLowerCase()
  );

  return exact?.name || value;
}

function getDiscordGradeFromRoles(roles) {
  const memberRoles = new Set(
    (Array.isArray(roles) ? roles : []).map(String)
  );

  const match = DISCORD_DISPLAY_GRADES.find((grade) => {
    const roleId = String(grade.roleId || '').trim();
    return roleId && memberRoles.has(roleId);
  });

  return match?.name || null;
}

function getDisplayGradeOrder() {
  return [...DISCORD_DISPLAY_GRADES]
    .reverse()
    .map((grade) => grade.name);
}

module.exports = {
  GRADES,
  DISCORD_DISPLAY_GRADES,
  getGradeFromPoints,
  getNextGrade,
  getAllGradeRoleIds,
  getGradeIndex,
  getDiscordGradeFromRoles,
  getDisplayGradeOrder,
  normalizeGradeName,
};
