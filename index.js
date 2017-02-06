"use strict";
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
;
const registry = {};
function createService(name, description) {
    const defaultedDescription = __assign({}, description);
    if (!Array.isArray(defaultedDescription.dependencies)) {
        defaultedDescription.dependencies = [];
    }
    if (!defaultedDescription.stop) {
        defaultedDescription.stop = () => undefined;
    }
    const service = Object.assign(defaultedDescription.start.bind(null), {
        serviceName: name,
        stop: defaultedDescription.stop,
        dependencies: defaultedDescription.dependencies
    });
    registry[name] = service;
    return service;
}
exports.createService = createService;
function flatten(ll) {
    return [].concat(...ll);
}
// TODO: Can type without any once Variadic Kinds lands (TS issue #5453)
function start(services) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!Array.isArray(services)) {
            services = [services];
        }
        // Final output system we'll build up
        const system = {};
        // Map of the remaining dependencies to fulfill, keyed by dependent
        const outstandingDeps = {};
        for (const s of services) {
            outstandingDeps[s.serviceName] = new Set(s.dependencies);
        }
        // Resolve all required dependencies:
        let toProcess = new Set();
        function updateToProcess() {
            toProcess = new Set(flatten(Object.keys(outstandingDeps).map(s => registry[s].dependencies)));
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
        const outstandingLoads = {};
        function load(name) {
            return __awaiter(this, void 0, void 0, function* () {
                const service = yield registry[name]()(system);
                delete outstandingLoads[name];
                Object.values(outstandingDeps).forEach(deps => deps.delete(name));
                system[name] = service;
                return service;
            });
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
            yield Promise.race(Object.values(outstandingLoads));
        }
        return system;
    });
}
exports.start = start;
