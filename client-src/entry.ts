/**
 * The browser entry: register the plugin factory with the host's module
 * loader. React is late-bound here — the bundle never touches it at module
 * scope (see react-binding.ts for why).
 */
import { bindReact, type ReactLike } from './react-binding.js';
import { createPlugin } from './plugin.js';

const globalWindow = window as unknown as {
  __ModuleLoader__?: {
    load?: (spec: { id?: string; factory: (require: (name: string) => unknown) => unknown }) => void;
  };
};

globalWindow.__ModuleLoader__?.load?.({
  id: 'dsh-eval-control/client',
  factory(require) {
    bindReact(require('react') as ReactLike);
    return createPlugin();
  },
});
