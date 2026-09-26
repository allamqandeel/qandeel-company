/**
 * Minimal child-process harness for multi-process proofs. Children run under the same signed
 * Node executable with an argument array (no shell), and every wait is bounded.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export interface Child {
  readonly process: ChildProcess;
  readonly lines: string[];
  /** Resolves with the first stdout line matching `predicate`; rejects after `timeoutMs`. */
  waitFor(predicate: (line: string) => boolean, timeoutMs?: number): Promise<string>;
  /** Resolves with the exit code (or signal) once the child exits; rejects after `timeoutMs`. */
  exited(timeoutMs?: number): Promise<number | string>;
  stderr(): string;
}

export function spawnScript(scriptUrl: URL | string, args: readonly string[]): Child {
  const script = typeof scriptUrl === 'string' ? scriptUrl : fileURLToPath(scriptUrl);
  const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
  const lines: string[] = [];
  const waiters: { predicate: (l: string) => boolean; resolve: (l: string) => void }[] = [];
  let err = '';
  child.stderr?.setEncoding('utf8').on('data', (d: string) => {
    err += d;
  });
  if (!child.stdout) throw new Error('child stdout is not piped');
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    lines.push(line);
    for (const w of [...waiters]) {
      if (w.predicate(line)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(line);
      }
    }
  });
  const exit = new Promise<number | string>((resolve) => child.on('exit', (code, signal) => resolve(code ?? signal ?? 'unknown')));
  return {
    process: child,
    lines,
    stderr: () => err,
    waitFor(predicate, timeoutMs = 20_000) {
      const hit = lines.find(predicate);
      if (hit !== undefined) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for child output; got ${JSON.stringify(lines)}; stderr ${err}`)), timeoutMs);
        waiters.push({ predicate, resolve: (l) => (clearTimeout(timer), resolve(l)) });
      });
    },
    exited(timeoutMs = 30_000) {
      return Promise.race([
        exit,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`child did not exit in ${timeoutMs} ms; stderr ${err}`)), timeoutMs).unref()),
      ]);
    },
  };
}

export function fixture(name: string): URL {
  return new URL(`./fixtures/${name}.js`, import.meta.url);
}
