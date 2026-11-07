/**
 * 极简配置校验（无第三方依赖）
 *
 * 为什么需要它：真实 DSH 的每个插件都用 Schemastery 声明 config schema，
 * 配置不合法会在**加载时**失败，而不是运行到一半才炸。
 * 这里实现一个够用的小版本，保持"fail fast"这个关键语义。
 */

export type FieldSpec =
  | { type: 'string'; required?: boolean; default?: string; description?: string }
  | { type: 'number'; required?: boolean; default?: number; min?: number; max?: number }
  | { type: 'boolean'; required?: boolean; default?: boolean }
  | { type: 'string[]'; required?: boolean; default?: string[] };

export type ConfigSchema = Record<string, FieldSpec>;

export class ConfigError extends Error {
  constructor(pluginName: string, message: string) {
    super(`[${pluginName}] Config Error: ${message}`);
    this.name = 'ConfigError';
  }
}

/**
 * 校验并补全默认值。
 * 失败时抛 ConfigError，绝不带着半个配置继续跑。
 */
export function resolveConfig<T extends Record<string, any>>(
  pluginName: string,
  schema: ConfigSchema,
  raw: Record<string, any> | undefined,
): T {
  const input = raw ?? {};
  const output: Record<string, any> = {};

  for (const [key, spec] of Object.entries(schema)) {
    const hasValue = input[key] !== undefined && input[key] !== null;
    const value = hasValue ? input[key] : spec.default;

    if (value === undefined) {
      if (spec.required) throw new ConfigError(pluginName, `缺少必填字段 \`${key}\``);
      continue;
    }

    switch (spec.type) {
      case 'string':
        if (typeof value !== 'string') {
          throw new ConfigError(pluginName, `字段 \`${key}\` 应为 string，实际为 ${typeof value}`);
        }
        if (value.length === 0 && spec.required) {
          throw new ConfigError(pluginName, `字段 \`${key}\` 不能为空字符串`);
        }
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          throw new ConfigError(pluginName, `字段 \`${key}\` 应为 number，实际为 ${typeof value}`);
        }
        if (spec.min !== undefined && value < spec.min) {
          throw new ConfigError(pluginName, `字段 \`${key}\` 应 >= ${spec.min}，实际为 ${value}`);
        }
        if (spec.max !== undefined && value > spec.max) {
          throw new ConfigError(pluginName, `字段 \`${key}\` 应 <= ${spec.max}，实际为 ${value}`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new ConfigError(pluginName, `字段 \`${key}\` 应为 boolean，实际为 ${typeof value}`);
        }
        break;
      case 'string[]':
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
          throw new ConfigError(pluginName, `字段 \`${key}\` 应为 string[]`);
        }
        break;
    }

    output[key] = value;
  }

  return output as T;
}
