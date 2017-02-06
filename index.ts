type ServiceName = string;
type AliasedServiceName = {type: string, as: string};
type Service<T> = {
  (...args: any[]): (partialSystem: System) => Promise<T>,
  // Don't conflict with Function.prototype.name
  serviceName: ServiceName,
  dependencies: ServiceName[],
  [extraProps: string]: any
};
type System = {[key in ServiceName]: any};

type StartFnT<T> = ((...args: any[]) => (partialSystem: System) => Promise<T>);
interface ServiceDescription<T, StartFn extends StartFnT<T>> {
  dependencies?: (ServiceName | AliasedServiceName)[];
  start: StartFn;
  stop?: ((instance: T) => void);
};

type ServiceRegistry = {[service in ServiceName]: Service<any>};

const registry: ServiceRegistry = {};

export function createService<T, StartFn extends StartFnT<T>>(
  name: ServiceName,
  description: ServiceDescription<T, StartFn>
): Service<T> {
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

// TODO: Can type without any once Variadic Kinds lands (TS issue #5453)
export async function start(services: (Service<any> | Service<any>[])) {
  if (!Array.isArray(services)) {
    services = [services];
  }

  // Final output system we'll build up
  const system: System = {};

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
  const outstandingLoads: {[name in ServiceName]: Promise<Service<any>>} = {};

  async function load(name: ServiceName): Promise<Service<any>> {
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
