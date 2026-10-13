import { execFile, spawn } from "node:child_process";

const maxOutputBytes = 8 * 1024 * 1024;
const gitTimeoutMs = 10_000;

function commandArguments(args: readonly string[]): string[] {
  return ["--literal-pathspecs", "-c", "core.fsmonitor=false", ...args];
}

function commandEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" };
}

export class GitCommandError extends Error {
  constructor(
    readonly stderr: string,
    readonly code: number | string | null,
  ) {
    super(stderr || "Git could not read this folder");
  }
}

export function runGit(
  cwd: string,
  args: readonly string[],
  maxBytes = maxOutputBytes,
  input: string | null = null,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      commandArguments(args),
      {
        cwd,
        encoding: "buffer",
        maxBuffer: maxBytes,
        timeout: gitTimeoutMs,
        env: commandEnvironment(),
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const code = error.code ?? (error.killed ? "ETIMEDOUT" : null);
          reject(
            new GitCommandError(
              stderr.toString("utf8").trim() || (code === "ETIMEDOUT" ? "Git read timed out" : ""),
              code,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
    if (input !== null) {
      if (child.stdin === null) {
        child.kill();
        reject(new Error("Git input pipe is unavailable"));
        return;
      }
      child.stdin.on("error", (error: Error) => {
        child.kill();
        reject(error);
      });
      child.stdin.end(input);
    }
  });
}

export type GitReadStream = {
  read: () => Promise<Buffer | null>;
  close: () => void;
};

/** Bound each awaited read, rather than time spent paused by the media consumer. */
export function openGitStream(
  cwd: string,
  args: readonly string[],
  maxBytes: number,
): GitReadStream {
  const child = spawn("git", commandArguments(args), {
    cwd,
    env: commandEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = child.stdout;
  const iterator = output[Symbol.asyncIterator]();
  let stderr = "";
  child.stderr.on("data", (bytes: unknown) => {
    if (Buffer.isBuffer(bytes)) stderr = (stderr + bytes.toString("utf8")).slice(0, 4096);
  });
  const completion = new Promise<GitCommandError | null>((resolve) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      resolve(new GitCommandError(stderr.trim() || error.message, error.code ?? null));
    });
    child.on("close", (code, signal) => {
      resolve(code === 0 ? null : new GitCommandError(stderr.trim(), code ?? signal));
    });
  });
  let closed = false;
  let bytesRead = 0;
  const close = () => {
    if (closed) return;
    closed = true;
    output.destroy();
    child.kill();
  };
  return {
    close,
    async read() {
      if (closed) return null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timeoutError: GitCommandError | null = null;
      try {
        return await Promise.race([
          (async () => {
            const next = await iterator.next();
            if (closed) return null;
            if (next.done) {
              const error = await completion;
              if (error !== null) throw error;
              close();
              return null;
            }
            const bytes: unknown = next.value;
            if (!Buffer.isBuffer(bytes)) throw new Error("Git returned an invalid output chunk");
            bytesRead += bytes.length;
            if (bytesRead > maxBytes)
              throw new GitCommandError(
                "Git output exceeded the read limit",
                "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
              );
            return bytes;
          })(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              timeoutError = new GitCommandError("Git read timed out", "ETIMEDOUT");
              close();
              reject(timeoutError);
            }, gitTimeoutMs);
          }),
        ]);
      } catch (error: unknown) {
        if (timeoutError !== null) throw timeoutError;
        if (closed) return null;
        close();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
