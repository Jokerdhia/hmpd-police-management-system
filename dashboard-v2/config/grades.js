const GRADES = [
  { name: 'Academy', points: 0, roleId: process.env.ROLE_ACADEMY },
  { name: 'Officer', points: 10, roleId: process.env.ROLE_OFFICER },
  { name: 'Senior Officer', points: 25, roleId: process.env.ROLE_SENIOR_OFFICER },
  { name: 'Sergeant', points: 45, roleId: process.env.ROLE_SERGENT },
  { name: 'First Sergeant', points: 70, roleId: process.env.ROLE_FIRST_SERGENT },
  { name: 'Lieutenant', points: 100, roleId: process.env.ROLE_LIEUTENANT },
  { name: 'Captain', points: 140, roleId: process.env.ROLE_CAPTAIN },
  { name: 'Commander', points: 190, roleId: process.env.ROLE_COMMANDER },
  { name: 'Deputy Chief', points: 250, roleId: process.env.ROLE_DEPUTY_CHIEF },
  { name: 'Assistant Chief', points: 320, roleId: process.env.ROLE_ASSISTANT_CHIEF },
  { name: 'Vice Chief', points: 400, roleId: process.env.ROLE_VICE_CHIEF },
  { name: 'Chief Police', points: 500, roleId: process.env.ROLE_CHIEF_POLICE },
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

function getGradeProgress(points) {
  const safePoints = Math.max(0, Number(points) || 0);
  const current = getGradeFromPoints(safePoints);
  const next = getNextGrade(safePoints);
  const currentFloor = Number(current.points) || 0;

  if (!next) {
    return {
      currentGrade: current.name,
      currentGradePoints: currentFloor,
      nextGrade: null,
      nextGradePoints: null,
      pointsRemaining: 0,
      progressPercent: 100,
      isMaximum: true,
    };
  }

  const interval = Math.max(Number(next.points) - currentFloor, 1);
  const earnedInGrade = Math.max(safePoints - currentFloor, 0);

  return {
    currentGrade: current.name,
    currentGradePoints: currentFloor,
    nextGrade: next.name,
    nextGradePoints: Number(next.points),
    pointsRemaining: Math.max(Number(next.points) - safePoints, 0),
    progressPercent: Math.min(100, Math.max(0, Math.round((earnedInGrade / interval) * 100))),
    isMaximum: false,
  };
}

function getPublicGradeRequirements() {
  return GRADES.map(({ name, points }, index) => ({
    name,
    points,
    nextGrade: GRADES[index + 1]?.name || null,
  }));
}

function getAllGradeRoleIds() {
  return GRADES.map((grade) => grade.roleId).filter(Boolean);
}

function getGradeIndex(name) {
  const normalized = normalizeGradeName(name);
  return GRADES.findIndex((grade) => grade.name === normalized);
}

const DISCORD_DISPLAY_GRADES = [...GRADES]
  .reverse()
  .map(({ name, roleId }) => ({ name, roleId }));

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
  const memberRoles = new Set((Array.isArray(roles) ? roles : []).map(String));
  const match = DISCORD_DISPLAY_GRADES.find((grade) => {
    const roleId = String(grade.roleId || '').trim();
    return roleId && memberRoles.has(roleId);
  });
  return match?.name || null;
}


function getNextGradeByName(name) {
  const index = getGradeIndex(name);
  return index >= 0 ? GRADES[index + 1] || null : null;
}

function getDisplayGradeOrder() {
  return GRADES.map((grade) => grade.name);
}

module.exports = {
  GRADES,
  DISCORD_DISPLAY_GRADES,
  getGradeFromPoints,
  getNextGrade,
  getNextGradeByName,
  getGradeProgress,
  getPublicGradeRequirements,
  getAllGradeRoleIds,
  getGradeIndex,
  getDiscordGradeFromRoles,
  getDisplayGradeOrder,
  normalizeGradeName,
};
