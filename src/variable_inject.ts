import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { scopeOf } from '@deepseek-ai/dsh-scope';
import type {} from '@deepseek-ai/dsh-system-prompt';
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools';
import type { EvalControlConfig } from './config.js';

function identityOf(config: EvalControlConfig) {
  return {
    provider: config.provider,
    model: config.model,
    ...(config.reasoningEffort !== undefined
      ? { reasoningEffort: ReasoningEffortId(config.reasoningEffort) }
      : {}),
  };
}

export function agentOptionsOf(config: EvalControlConfig): AgentOptions {
  return identityOf(config);
}

export function installExperimentVariables(ctx: Context, config: EvalControlConfig): void {
  if (scopeOf(ctx) !== undefined) {
    throw new Error('dsh-eval-control: experiment variables require a global host context');
  }
  const identity = identityOf(config);
  const allow = config.tools?.allow === undefined ? undefined : new Set(config.tools.allow);
  const deny = new Set(config.tools?.deny);
  const allowed = (name: string): boolean => (allow === undefined || allow.has(name)) && !deny.has(name);
  const modeDenial = (agent: Agent): string | undefined => {
    // DSH 0.1.7 has no public mode getter; only non-native modes expose this reserved tool.
    if (ctx.tools.get(RUN_CODE_NAME, agent) !== undefined) {
      return 'dsh-eval-control: experiment tool filtering requires native mode; PTC/both is unsupported';
    }
    return undefined;
  };

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    if (context.agent?.id !== config.sessionId) return next();
    const denial = modeDenial(context.agent);
    if (denial !== undefined) throw new Error(denial);
    const assembly = await next();
    const finalDenial = modeDenial(context.agent);
    if (finalDenial !== undefined) throw new Error(finalDenial);
    const variables = { ...assembly.variables };
    delete variables.reasoningEffort;
    return {
      ...assembly,
      variables: { ...variables, ...identity },
      tools: assembly.tools.filter((tool) => allowed(tool.name)),
    };
  }, { global: true, prepend: true });

  ctx.on('agent/request', async ({ agent }, next) => {
    if (agent.id !== config.sessionId) return next();
    const denial = modeDenial(agent);
    if (denial !== undefined) throw new Error(denial);
    const request = { ...await next() };
    const finalDenial = modeDenial(agent);
    if (finalDenial !== undefined) throw new Error(finalDenial);
    delete request.reasoningEffort;
    return { ...request, ...identity };
  }, { global: true, prepend: true });

  ctx.tools.guard((execution) => {
    if (execution.agent?.id !== config.sessionId) return undefined;
    return modeDenial(execution.agent)
      ?? (allowed(execution.name) ? undefined : `dsh-eval-control: tool "${execution.name}" is disallowed`);
  });
}
