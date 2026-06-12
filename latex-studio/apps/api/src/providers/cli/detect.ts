import { runCli, type CliRunner } from './spawnCli.js';

/**
 * Detect whether a vendor model CLI is installed (and its version). Login state
 * for these CLIs is owned by the CLI itself and is not reliably probeable
 * without side effects, so we report `installed` + `version` deterministically;
 * the provider surfaces a typed `auth` error at generation time if the CLI says
 * it is not signed in.
 */
export interface CliStatus {
  installed: boolean;
  version?: string;
}

export async function cliStatus(command: string, runner: CliRunner = runCli, versionArgs: string[] = ['--version']): Promise<CliStatus> {
  const res = await runner(command, versionArgs).catch(() => null);
  if (!res || res.notFound) return { installed: false };
  // `--version` may exit 0 with the version on stdout; treat any non-ENOENT run
  // that produced version-like output as installed.
  const out = `${res.stdout} ${res.stderr}`.trim();
  const version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(out)?.[1];
  const installed = res.code === 0 || version !== undefined;
  return version ? { installed, version } : { installed };
}
