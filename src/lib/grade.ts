/**
 * Grade (hs_grade / ms_grade systems) for an athlete during a season, calculated
 * from graduation year. A season ending in Aug-Dec belongs to the school year
 * that finishes the following spring.
 */
export function gradeForSeason(graduationYear: number, seasonEndDate: string): number {
  const [year, month] = seasonEndDate.split("-").map(Number);
  const schoolYearEnd = month >= 8 ? year + 1 : year;
  return 12 - (graduationYear - schoolYearEnd);
}
