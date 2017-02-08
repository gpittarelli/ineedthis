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
  start: StartFn;
  stop: ((instance: T) => void);
  [extraProps: string]: any
};
export type System = {[key in ServiceName]: ServiceInstance<any, any>};

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

  const service = Object.assign(
    defaultedDescription.start.bind(null), {
      serviceName: name,
      stop: defaultedDescription.stop,
      dependencies: defaultedDescription.dependencies
    }
  );

  registry[name] = service;
  return service;
}

function flatten<T>(ll: T[][]): T[] {
  return ([] as T[]).concat(...ll);
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

// TODO: Can type without 'any' once Variadic Kinds lands (TS issue #5453)
export async function start(services: (Service<any, any> | Service<any, any>[])): Promise<System> {
  if (!Array.isArray(services)) {
    services = [services];
  }

  // Final output system we'll build up
  const system: {[key in ServiceName]: any} = {};

  // Map of the remaining dependencies to fulfill, keyed by dependent
  const outstandingDeps: {[s in ServiceName]: Set<ServiceName>} = {};
  for (const s of services) {
    outstandingDeps[s.serviceName] = new Set(s.dependencies);
  }

  // Resolve all required dependencies:
  let toProcess = new Set();
  function updateToProcess() {
    toProcess = new Set(
      flatten(Object.keys(outstandingDeps).map(s => registry[s].dependencies))
    );
    Object.keys(outstandingDeps).forEach(k => toProcess.delete(k));
  }

  updateToProcess();
  while (toProcess.size > 0) {
    toProcess.forEach(s => {
      outstandingDeps[s] = new Set(registry[s].dependencies);
    });

    updateToProcess();
  }

  // Initialize all dependencies
  const outstandingLoads: {[name in ServiceName]: Promise<Service<any, any>>} = {};

  async function load(name: ServiceName): Promise<Service<any, any>> {
    const service = await registry[name]()(system);

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
