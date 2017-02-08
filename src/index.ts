export type StartFnT<T> = ((...args: any[]) => (partialSystem: System) => Promise<T>);

export type ServiceName = string;
export type AliasedServiceName = {type: string, as: string};
export type Service<T, StartFn extends StartFnT<T>> = {
  (...args: any[]): (partialSystem: System) => Promise<T>,
  // Don't conflict with Function.prototype.name
  serviceName: ServiceName,
  dependencies: ServiceName[],
  start: StartFn;
  stop: ((instance: T) => void);
  [extraProps: string]: any
};
export type ServiceInstance<T, StartFn extends StartFnT<T>> = {
  (...args: any[]): (partialSystem: System) => Promise<T>,
  // Don't conflict with Function.prototype.name
  serviceName: ServiceName,
  dependencies: ServiceName[],
  start: (partialSystem: System) => Promise<T>;
  stop: ((instance: T) => void);
  [extraProps: string]: any
};

export type System = {[key in ServiceName]: any};
export type SystemMap = {[key in ServiceName]: ServiceInstance<any, any>};

export interface ServiceDescription<T, StartFn extends StartFnT<T>> {
  dependencies?: (ServiceName | AliasedServiceName)[];
  start: StartFn;
  stop?: ((instance: T) => void);
};

type ServiceRegistry = {[service in ServiceName]: Service<any, any>};

const registry: ServiceRegistry = {};

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
  description: ServiceDescription<T, StartFn>
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
      serviceName: name,
      dependencies: defaultedDescription.dependencies,
      start,
      stop: defaultedDescription.stop
    }) as any);

  registry[name] = service;
  return service;
}

function flatten<T>(ll: Iterable<T>[]): T[] {
  return ([] as T[]).concat(...ll.map(it => Array.from(it)));
}

// TODO: Can get rid of 'any' once Variadic Kinds lands (TS issue #5453)
export async function start(
  services: (Service<any, any> | Service<any, any>[]),
  overrides: System = {}
): Promise<System> {
  if (!Array.isArray(services)) {
    services = [services];
  }

  for (const s of services) {
    if (overrides[s.serviceName]) {
      throw new Error('Supplied ');
    }

    overrides[s.serviceName] = s;
  }

  function resolve(serviceName: ServiceName): Service<any, any> {
    if (overrides && overrides[serviceName]) {
      return overrides[serviceName];
    } else {
      return registry[serviceName];
    }
  }

  // Resolve all required dependencies, building of a map of
  // serviceNames -> still required dependencies
  const outstandingDeps: {[s in ServiceName]: Set<ServiceName>} = {};
  let toProcess = new Set(services.map(s => s.serviceName));
  do {
    for (const s of toProcess) {
      outstandingDeps[s] = new Set(resolve(s).dependencies);
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

  while (Object.keys(outstandingDeps).length > 0) {
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
    for (const d of registry[s].dependencies) {
      countDependents[d]++;
    }
  }

  const outstandingShutdowns: {[s in ServiceName]: Promise<void>} = {},
    finishedShutdowns: {[s in ServiceName]: boolean} = {};
  do {
    for (const [s, remainingDependents] of Object.entries(countDependents)) {
      if (remainingDependents === 0 && !outstandingShutdowns[s] && !finishedShutdowns[s]) {
        outstandingShutdowns[s] = (async function () {
          const service = registry[s];
          await service.stop(service);
          finishedShutdowns[s] = true;
          delete outstandingShutdowns[s];
          for (const d of service.dependencies) {
            countDependents[d]--;
          }
        })();
      }
    }

    await Promise.race(Object.values(outstandingShutdowns));
  } while (Object.keys(finishedShutdowns).length < Object.keys(system).length);
}
