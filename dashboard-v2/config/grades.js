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
module.exports={GRADES,getGradeFromPoints,getNextGrade,getAllGradeRoleIds,getGradeIndex};
