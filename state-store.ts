import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { PLUGIN_ID } from "./constants.js";
import { resolveQClawMachineGuid } from "./machine-id.js";

export type QClawWechatState = {
  version: 1;
  guid: string;
  guidSource?: "machine-id" | "fallback-random";
  jwtToken?: string;
  openclawChannelToken?: string;
  qclawApiKey?: string;
  userInfo?: Record<string, unknown>;
  updatedAtMs: number;
};

const STATE_REL_PATH = ["plugins", PLUGIN_ID, "state.json"] as const;

function resolveStatePath(api: OpenClawPluginApi): string {
  const stateDir = api.runtime.state.resolveStateDir();
  return path.join(stateDir, ...STATE_REL_PATH);
}

export async function readState(
  api: OpenClawPluginApi,
): Promise<QClawWechatState | null> {
  try {
    const raw = await fs.readFile(resolveStatePath(api), "utf8");
    const parsed = JSON.parse(raw) as Partial<QClawWechatState>;
    if (parsed.version !== 1 || typeof parsed.guid !== "string") {
      return null;
    }
    return {
      version: 1,
      guid: parsed.guid,
      guidSource:
        parsed.guidSource === "machine-id" ||
        parsed.guidSource === "fallback-random"
          ? parsed.guidSource
          : undefined,
      jwtToken:
        typeof parsed.jwtToken === "string" ? parsed.jwtToken : undefined,
      openclawChannelToken:
        typeof parsed.openclawChannelToken === "string"
          ? parsed.openclawChannelToken
          : undefined,
      qclawApiKey:
        typeof parsed.qclawApiKey === "string" ? parsed.qclawApiKey : undefined,
      userInfo:
        parsed.userInfo && typeof parsed.userInfo === "object"
          ? (parsed.userInfo as Record<string, unknown>)
          : undefined,
      updatedAtMs:
        typeof parsed.updatedAtMs === "number" ? parsed.updatedAtMs : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function writeState(
  api: OpenClawPluginApi,
  state: QClawWechatState,
): Promise<void> {
  const statePath = resolveStatePath(api);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(
    statePath,
    `${JSON.stringify(
      {
        ...state,
        updatedAtMs: Date.now(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function clearState(api: OpenClawPluginApi): Promise<void> {
  try {
    await fs.unlink(resolveStatePath(api));
  } catch {
    // ignore
  }
}

export async function ensureGuid(
  api: OpenClawPluginApi,
): Promise<QClawWechatState> {
  const existing = await readState(api);
  const resolvedGuid = await resolveQClawMachineGuid();
  if (
    existing?.guid === resolvedGuid.guid &&
    existing.guidSource === resolvedGuid.source
  ) {
    return existing;
  }
  if (resolvedGuid.source === "machine-id") {
    const sameGuid = existing?.guid === resolvedGuid.guid;
    const next: QClawWechatState = {
      version: 1,
      guid: resolvedGuid.guid,
      guidSource: resolvedGuid.source,
      jwtToken: sameGuid ? existing?.jwtToken : undefined,
      openclawChannelToken: sameGuid
        ? existing?.openclawChannelToken
        : undefined,
      qclawApiKey: sameGuid ? existing?.qclawApiKey : undefined,
      userInfo: sameGuid ? existing?.userInfo : undefined,
      updatedAtMs: Date.now(),
    };
    await writeState(api, next);
    return next;
  }
  if (existing?.guid) {
    return existing;
  }
  const next: QClawWechatState = {
    version: 1,
    guid: resolvedGuid.guid,
    guidSource: resolvedGuid.source,
    updatedAtMs: Date.now(),
  };
  await writeState(api, next);
  return next;
}
