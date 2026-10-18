/**
 * Late-bound React for the browser-loaded client half.
 *
 * DSH serves this plugin's client as ONE classic script and hands it a
 * factory-scoped `require` whose only platform seed we rely on is `react`.
 * The bundle therefore must not touch React at module scope — every access
 * goes through this module's functions, which resolve against the instance
 * bound inside the factory. JSX compiles with `jsxFactory: h` (tsconfig
 * `jsx: react`), so components stay readable while the bundle stays loadable.
 */

export interface ReactElement {
  readonly type: unknown;
  readonly props: Record<string, unknown> | null;
}

type CreateElement = (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
type UseState = <T>(initial: T | (() => T)) => [T, (value: T | ((previous: T) => T)) => void];
type UseEffect = (effect: () => void | (() => void), deps?: readonly unknown[]) => void;
type UseMemo = <T>(factory: () => T, deps: readonly unknown[]) => T;
type UseRef = <T>(initial: T) => { current: T };
type UseCallback = <T extends (...args: never[]) => unknown>(callback: T, deps: readonly unknown[]) => T;

export interface ReactLike {
  createElement: CreateElement;
  useState: UseState;
  useEffect: UseEffect;
  useMemo: UseMemo;
  useRef: UseRef;
  useCallback: UseCallback;
  readonly Fragment: unknown;
}

let bound: ReactLike | undefined;

/** Bind the host's React instance; called once inside the module factory. */
export function bindReact(instance: ReactLike): void {
  bound = instance;
}

function requireBound(): ReactLike {
  if (bound === undefined) throw new Error('dsh-eval-control: React accessed before bindReact()');
  return bound;
}

/** The JSX factory: every `<tag/>` in client-src compiles to this call. */
export function h(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown {
  return requireBound().createElement(type, props, ...children);
}

export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] {
  return requireBound().useState(initial);
}

export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
  requireBound().useEffect(effect, deps);
}

export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
  return requireBound().useMemo(factory, deps);
}

export function useRef<T>(initial: T): { current: T } {
  return requireBound().useRef(initial);
}

export function useCallback<T extends (...args: never[]) => unknown>(callback: T, deps: readonly unknown[]): T {
  return requireBound().useCallback(callback, deps);
}

/** React.Fragment, resolved through the bound instance. */
export function Fragment(): unknown {
  return requireBound().Fragment;
}
