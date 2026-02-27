export function detectInteractiveTTY(
  stdout: Pick<NodeJS.WriteStream, 'isTTY'>,
  stderr: Pick<NodeJS.WriteStream, 'isTTY'>,
): boolean {
  return Boolean(stdout.isTTY && stderr.isTTY);
}
