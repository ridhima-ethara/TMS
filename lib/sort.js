// Explicit comparators for Array.prototype.sort().
//
// compareText reproduces sort()'s default ordering exactly: both values are
// converted with String() and compared by UTF-16 code unit. It exists so call
// sites state their intent (and satisfy SonarQube S2871) without changing any
// existing ordering. Use localeCompare instead only where a case-insensitive,
// human ordering is wanted.
export const compareText = (a, b) => {
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
};

export const compareNumber = (a, b) => a - b;
