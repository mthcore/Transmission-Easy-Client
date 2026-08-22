/**
 * Case- and diacritic-insensitive normalization for the search filter, so
 * typing "amelie" finds "Amélie" — matching how the name SORT already treats
 * accented letters (its collator uses sensitivity: 'base'). NFD splits each
 * accented letter into base + combining mark; the marks are then dropped.
 */
function searchNormalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export default searchNormalize;
