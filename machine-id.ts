import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function hashMachineId(rawId: string): string {
  return createHash("sha256").update(rawId.trim()).digest("hex");
}

async function readLinuxMachineId(): Promise<string | null> {
  for (const filePath of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const raw = (await fs.readFile(filePath, "utf8")).trim();
      if (raw) {
        return raw;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function readDarwinMachineId(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ioreg", [
      "-rd1",
      "-c",
      "IOPlatformExpertDevice",
    ]);
    const match = stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

async function readWindowsMachineId(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("reg", [
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
      "/v",
      "MachineGuid",
    ]);
    const match = stdout.match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

async function readRawMachineId(): Promise<string | null> {
  if (process.platform === "darwin") {
    return readDarwinMachineId();
  }
  if (process.platform === "linux") {
    return readLinuxMachineId();
  }
  if (process.platform === "win32") {
    return readWindowsMachineId();
  }
  return null;
}

export async function resolveQClawMachineGuid(): Promise<{
  guid: string;
  source: "machine-id" | "fallback-random";
}> {
  const rawMachineId = await readRawMachineId();
  if (rawMachineId) {
    return {
      guid: hashMachineId(rawMachineId),
      source: "machine-id",
    };
  }
  return {
    guid: randomUUID().replace(/-/g, ""),
    source: "fallback-random",
  };
}
