import type { PluginRuntime } from "openclaw/plugin-sdk";

// ============================================
// Runtime 管理
// ============================================
// 用于存储和获取 OpenClaw 的运行时实例
// Runtime 提供了访问配置、会话、路由、事件等核心功能的接口

/**
 * 全局运行时实例
 * 在插件初始化时由 OpenClaw 框架注入
 */
let runtime: PluginRuntime | null = null;

/**
 * 设置微信企业号运行时实例
 * @param next - OpenClaw 提供的运行时实例
 * @description 此方法应在插件初始化时调用一次，用于注入运行时依赖
 */
export const setWecomRuntime = (next: PluginRuntime): void => {
  runtime = next;
};

/**
 * 获取微信企业号运行时实例
 * @returns OpenClaw 运行时实例
 * @throws 如果运行时未初始化则抛出错误
 * @description 在需要访问 OpenClaw 核心功能时调用此方法
 */
export const getWecomRuntime = (): PluginRuntime => {
  if (!runtime) {
    throw new Error("WeCom runtime not initialized");
  }
  return runtime;
};