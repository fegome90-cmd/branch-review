export function getVerdictBorderClass(verdict: 'PASS' | 'FAIL') {
  return verdict === 'PASS' ? 'border-green-500' : 'border-red-500';
}

export function formatNetChange(linesAdded: number, linesRemoved: number) {
  const net = linesAdded - linesRemoved;
  return `${net > 0 ? '+' : ''}${net}`;
}

export function getDriftBadgeVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' {
  if (status === 'ALIGNED') {
    return 'default';
  }

  if (status === 'DRIFT_RISK') {
    return 'secondary';
  }

  return 'destructive';
}
