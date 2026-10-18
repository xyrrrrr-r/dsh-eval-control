import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-config-editor';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

const MODULE = '@deepseek-ai/dsh-compaction-basic';
function targets(config: Record<string, unknown>, prefix = ''): Array<{suffix: string; config: Record<string, unknown>}> {
  const rows = Array.isArray(config) ? config : Array.isArray(config.plugins) ? config.plugins : [];
  return rows.flatMap((row, index) => {
    if (!row || typeof row !== 'object') return [];
    const child = row.config ?? {};
    const suffix = `${prefix}${index}`;
    return row.name === MODULE ? [{suffix, config: child}] : targets(child, `${suffix}.`);
  });
}
function targetConfig(root: Record<string, unknown>, suffix: string): Record<string, unknown> {
  let value = root;
  for (const index of suffix.split('.')) {
    const rows = Array.isArray(value) ? value : value.plugins;
    const row = (rows as Array<{config?: Record<string, unknown>; name?: string}> | undefined)?.[Number(index)];
    if (!row) throw new Error('压缩配置目标已变化，请重新读取');
    value = row.config ?? (row.config = {});
  }
  return value;
}
/** Only verified host policy fields may be changed by a diagnostic action. */
export class DiagnosticConfig extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'trajectoryConfiguration'); }

  @Remote
  describe() {
    const editor = this.ctx.get('configEditor');
    if (!editor) throw new Error('当前宿主未提供持久化配置编辑器');
    return { path: editor.documentPath, entries: editor.configuration().flatMap(({entry}) => {
      if (!entry.fiber || entry.fiber.state !== 2) return [];
      if (entry.options.name === MODULE) return [{id: entry.options.id, config: entry.options.config ?? {}, applies: '后续步骤'}];
      if (entry.options.name !== '@deepseek-ai/dsh-agent-preset') return [];
      return targets(entry.options.config ?? {}).map((target) => ({id: `${entry.options.id}::${target.suffix}`, config: target.config, applies: '新建会话（现有会话保留原预设版本）'}));
    }) };
  }

  @Remote
  async apply(entryId: string, expected: string, thresholdRatio: number) {
    if (!Number.isFinite(thresholdRatio) || thresholdRatio < 0.2 || thresholdRatio > 0.9) throw new Error('压缩触发比例必须为 0.2–0.9');
    const editor = this.ctx.get('configEditor');
    if (!editor) throw new Error('当前宿主未提供持久化配置编辑器');
    const [ownerId, suffix] = entryId.split('::');
    const entry = editor.entries().find((item) => item.options.id === ownerId && (suffix === undefined ? item.options.name === MODULE : item.options.name === '@deepseek-ai/dsh-agent-preset'));
    if (suffix !== undefined && !targets(entry?.options.config ?? {}).some((target) => target.suffix === suffix)) throw new Error('压缩配置目标已变化，请重新读取');
    if (!entry) throw new Error('压缩配置不存在或已变更，请重新读取');
    await editor.edit(entry, (root) => {
      if (suffix !== undefined && !targets(root).some((target) => target.suffix === suffix)) throw new Error('压缩配置目标已变化，请重新读取');
      const current = suffix === undefined ? root : targetConfig(root, suffix);
      if (JSON.stringify(current) !== expected) throw new Error('配置已被其他操作修改，请重新读取');
      const retainRatio = typeof current.retainRatio === 'number' ? current.retainRatio : 0.16;
      if (current.retainTokens === undefined && retainRatio >= thresholdRatio) throw new Error('触发比例必须大于保留比例');
      const policies = Array.isArray(current.modelPolicies) ? current.modelPolicies : [];
      Object.assign(current, { auto: true, thresholdRatio, modelPolicies: policies.map((policy: Record<string, unknown>) => ({ ...policy, thresholdRatio })) });
      return root;
    });
    const verified = editor.entries().find((item) => item.options.id === ownerId);
    const actual = suffix === undefined ? verified?.options.config : targetConfig(verified?.options.config ?? {}, suffix);
    if (actual?.thresholdRatio !== thresholdRatio || actual.auto !== true) throw new Error('写入后的配置校验失败，请检查宿主设置');
    return { applied: true, path: editor.documentPath, thresholdRatio, applies: suffix === undefined ? '后续步骤' : '新建会话（现有会话保留原预设版本）' };
  }
}
