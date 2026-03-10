declare const process: {
  platform: string;
};

declare namespace NodeJS {
  interface ReadableStream {
    [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array | string>;
  }
}

type Buffer = Uint8Array & {
  toString(encoding?: string): string;
};

declare const Buffer: {
  from(value: string | ArrayBuffer | Uint8Array): Buffer;
  concat(values: Array<Uint8Array | Buffer>): Buffer;
  isBuffer(value: unknown): value is Buffer;
};

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string): {
      digest(encoding: "hex"): string;
    };
    digest(encoding: "hex"): string;
  };
  export function randomUUID(): string;
}

declare module "node:fs/promises" {
  export function readFile(path: string, encoding: string): Promise<string>;
  export function writeFile(
    path: string,
    data: string,
    encoding: string,
  ): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void>;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}

declare module "node:child_process" {
  export function execFile(
    command: string,
    args?: string[],
  ): void;
  export function spawn(
    command: string,
    args?: string[],
    options?: Record<string, unknown>,
  ): {
    unref(): void;
  };
}

declare module "node:util" {
  export function promisify<T extends (...args: any[]) => void>(
    fn: T,
  ): (...args: T extends (...args: infer A) => void ? A : never) => Promise<{
    stdout: string;
    stderr: string;
  }>;
}

declare module "node:http" {
  type RequestListener = (req: any, res: any) => void | Promise<void>;
  export function createServer(handler: RequestListener): {
    once(event: string, listener: (...args: any[]) => void): void;
    off(event: string, listener: (...args: any[]) => void): void;
    listen(
      port: number,
      host: string,
      callback?: () => void,
    ): void;
    address(): { port: number } | string | null;
    close(callback?: () => void): void;
  };
}

declare module "*.cjs" {
  const value: any;
  export default value;
}
