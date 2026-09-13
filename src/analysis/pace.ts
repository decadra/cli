/** Straight-line projection of month-to-date usage to month end. Pure. */
export function projectMonth(monthToDate: number, daysObserved: number, daysInMonth: number): number | null {
  if (daysObserved <= 0) return null;
  if (daysObserved >= daysInMonth) return monthToDate;
  return (monthToDate / daysObserved) * daysInMonth;
}
