/**
 * Politique unique de synchronisation grade/points.
 *
 * Les points HMPD sont un score cumulatif de carrière : un changement de rôle
 * Discord ne doit jamais les faire baisser. En revanche, lorsqu'un membre est
 * importé/promu manuellement vers un grade dont le seuil est supérieur à son
 * score actuel, on l'aligne au minimum de ce grade afin de garder une donnée
 * cohérente avec la hiérarchie existante.
 */
function getPointsAfterGradeSync(currentPoints, targetGradePoints) {
  const current = Math.max(0, Number(currentPoints) || 0);
  const floor = Math.max(0, Number(targetGradePoints) || 0);
  return Math.max(current, floor);
}

module.exports = { getPointsAfterGradeSync };
