// tslint:disable-next-line:no-var-requires
const {name: pkgName, version}: {name: string, version: string} = require('../package');

export type StartFnT<T> = ((...args: any[]) => (partialSystem: System) => Promise<T>);

export type ServiceName = string;
export type AliasedServiceName = {type: string, as: string};
export type Service<T, StartFn extends StartFnT<T>> = {
  (...args: any[]): (partialSystem: System) => Promise<T>,
  // Don't conflict with Function.prototype.name
  dependencies: ServiceName[],
  serviceName: ServiceName,
  start: StartFn;
  stop: ((instance: T) => void);
  [extraProps: string]: any
};
export type ServiceInstance<T, StartFn extends StartFnT<T>> = {
  (...args: any[]): (partialSystem: System) => Promise<T>,
  // Don't conflict with Function.prototype.name
  dependencies: ServiceName[],
  serviceName: ServiceName,
  start: (partialSystem: System) => Promise<T>;
  stop: ((instance: T) => void);
  [extraProps: string]: any
};

export type System = {[key in ServiceName]: any};
export type SystemMap = {[key in ServiceName]: ServiceInstance<any, any>};

export interface ServiceDescription<T, StartFn extends StartFnT<T>> {
  dependencies?: (ServiceName | AliasedServiceName | Service<any, any>)[];
  start: StartFn;
  stop?: ((instance: T) => void);
};

export type PackageSpec = {path?: string[], package: string, __isPackageSpec: true};
type FriendlyPackageSpec = string | PackageSpec | ServiceName | Service<any, any>;

type ServiceRegistry = {[service in ServiceName]: Service<any, any>};

// Persist registry across multiple instances of this module. Terrible
// hack, but needed to support a truly 'global' registry in
// environments such as lerna  or old npm verisons
const registrySym = Symbol.for(`Global registry for ${pkgName}@${version}`);
if (!(global as any)[registrySym]) {
  (global as any)[registrySym] = {};
}
const registry: ServiceRegistry = (global as any)[registrySym];

function dependencyOrService(input: FriendlyPackageSpec): string | keyof PackageSpec {
  if (typeof input === 'string') {
    return input;
  } else if (input.hasOwnProperty('__isPackageSpec')) {
    return requireOrThrow((input as PackageSpec)).serviceName;
  }
  return (input as Service<any, any>).serviceName;
}

export function dangerouslyResetRegistry() {
  for (const serviceName of Object.keys(registry)) {
    delete registry[serviceName];
  }
}

function cloneFn<T>(fn: ((...args: any[]) => T)): ((...args: any[]) => T) {
  return (...args: any[]) => fn(...args);
}

export function createService<T, StartFn extends StartFnT<T>>(
  name: ServiceName,
  description: ServiceDescription<T, StartFn>,
): Service<T, StartFn> {
  const defaultedDescription = {...description};
  if (!Array.isArray(defaultedDescription.dependencies)) {
    defaultedDescription.dependencies = [];
  }

  if (!defaultedDescription.stop) {
    defaultedDescription.stop = () => undefined;
  }

  const start: StartFn = (cloneFn(defaultedDescription.start) as any),
    service: Service<T, StartFn> = (Object.assign(start, {
      dependencies: defaultedDescription.dependencies,
      serviceName: name,
      start,
      stop: defaultedDescription.stop,
    }) as any);

  registry[name] = service;
  return service;
}

function flatten<T>(ll: Iterable<T>[]): T[] {
  return ([] as T[]).concat(...ll.map(it => Array.from(it)));
}

function getPath(o: any, ks: (string | number)[] = []): any {
  if (ks.length === 0) {
    return o;
  } else {
    return getPath(o[ks[0]], ks.slice(1));
  }
}

/**
 * Creates a service that, when used, is loaded from the given node
 * packageName (eg @scope/some-cool-package/path/inside/package) and a
 * lodash get-style path (eg "abc.0.hi" to get "x" from {abc:[{hi:"x"}]}).
 */
export function fromPackage(packageName: string, path?: string[]): PackageSpec {
  return {path, package: packageName, __isPackageSpec: true};
}

function parsePackage(s: string): PackageSpec {
  const parts = s.split('.');
  return {path: parts.slice(1), package: parts[0], __isPackageSpec: true};
}

const notFound = Symbol('Package not found');
function tryRequire(p: string | PackageSpec): Service<any, any> | Symbol {
  if (typeof p === 'string') {
    p = parsePackage(p);
  }

  try {
    const service = getPath(require(p.package), (p.path || []));
    return service;
  } catch (e) {
    return notFound;
  }
}

function requireOrThrow(p: string | PackageSpec): Service<any, any> {
  const required = tryRequire(p);
  if (required === notFound) {
    throw new Error(`Couldn't resolve dependency: "${p}"`);
  } else {
    return (required as Service<any, any>);
  }
}

// TODO: Can get rid of 'any' once Variadic Kinds lands (TS issue #5453)
export async function start(
  namesOrServices: (ServiceName | PackageSpec | Service<any, any> | (PackageSpec | Service<any, any> | ServiceName)[]),
  overrides: System = {},
): Promise<System> {
  if (!Array.isArray(namesOrServices)) {
    namesOrServices = [namesOrServices];
  }

  function resolve(serviceName: ServiceName): Service<any, any> {
    if (overrides && overrides[serviceName]) {
      return overrides[serviceName];
    } else if (registry[serviceName]) {
      return registry[serviceName];
    } else {
      return requireOrThrow(serviceName);
    }
  }

  const services: Service<any, any>[] = namesOrServices.map(nameOrService => {
    if (typeof nameOrService === 'string') {
      if (registry[nameOrService]) {
        return registry[nameOrService];
      } else {
        throw new Error(`Couldn't find: "${nameOrService}"`);
      }
    } else if (nameOrService.hasOwnProperty('__isPackageSpec')) {
      return requireOrThrow(nameOrService as PackageSpec);
    } else {
      return (nameOrService as Service<any, any>);
    }
  });

  for (const s of services) {
    if (!overrides[s.serviceName]) {
      overrides[s.serviceName] = s;
    }
  }

  // Resolve all required dependencies, building of a map of
  // serviceNames -> still required dependencies
  const outstandingDeps: {[s in ServiceName]: Set<ServiceName>} = {};
  let toProcess = new Set(services.map(s => s.serviceName));
  do {
    for (const s of toProcess) {
      outstandingDeps[s] = new Set(resolve(s).dependencies.map(dependencyOrService));
    }

    toProcess = new Set(flatten(Object.values(outstandingDeps)));
    Object.keys(outstandingDeps).forEach(k => toProcess.delete(k));
  } while (toProcess.size > 0);

  // Final output system we'll build up
  const system: {[key in ServiceName]: any} = {};

  const outstandingLoads: {[name in ServiceName]: Promise<Service<any, any>>} = {};
  async function load(name: ServiceName): Promise<Service<any, any>> {
    const service = await resolve(name)()(system);

    delete outstandingLoads[name];
    Object.values(outstandingDeps).forEach(deps => deps.delete(name));
    system[name] = service;

    return service;
  }

  while (Object.keys(outstandingDeps).length > 0 ||
        Object.keys(outstandingLoads).length > 0) {
    // Start loading any deps that are no longer waiting for another dep
    for (const [name, deps] of Object.entries(outstandingDeps)) {
      if (deps.size === 0) {
        outstandingLoads[name] = load(name);
        delete outstandingDeps[name];
      }
    }

    if (Object.keys(outstandingLoads).length === 0 &&
        Object.keys(outstandingDeps).length > 0) {
      throw new Error('Cycle detected');
    }

    // Wait for the next dep to finish starting
    await Promise.race(Object.values(outstandingLoads));
  }

  return system;
}

export async function stop(system: System): Promise<void> {
  const countDependents: {[s in ServiceName]: number} = {};
  for (const s of Object.keys(system)) {
    countDependents[s] = 0;
  }

  for (const s of Object.keys(system)) {
    for (const d of registry[s].dependencies.map(dependencyOrService)) {
      countDependents[d]++;
    }
  }

  const outstandingShutdowns: {[s in ServiceName]: Promise<void>} = {},
    finishedShutdowns: {[s in ServiceName]: boolean} = {};
  do {
    for (const [s, remainingDependents] of Object.entries(countDependents)) {
      if (remainingDependents === 0 &&
          !outstandingShutdowns[s] &&
          !finishedShutdowns[s]) {

        outstandingShutdowns[s] = (async () => {
          const service = registry[s];
          await service.stop(system[s]);
          finishedShutdowns[s] = true;
          delete outstandingShutdowns[s];
          for (const d of service.dependencies.map(dependencyOrService)) {
            countDependents[d]--;
          }
        })();

      }
    }

    await Promise.race(Object.values(outstandingShutdowns));
  } while (Object.keys(finishedShutdowns).length < Object.keys(system).length);
}
