# ineedthis
(better name TBD)

Implements an opinionated, simple management layer for stateful
dependencies, directly akin to
[component](https://github.com/stuartsierra/component),
[mount](https://github.com/tolitius/mount),
[yoyo](https://github.com/jarohen/yoyo) etc. It provides tooling to
describe services and use those descriptions to automatically start
and stop collections of those services: eg, an HTTP server that in
turn uses a database connection, a cache connection, a configuration
service, etc.

It is designed to be flexible enough to handle all sorts of services
(eg stateless, constant state (eg configuration), network connections,
thread pools, etc.). It handles describing, starting, and linking
together those services while not imposing anything on the shape or
further use of those services.

The API is designed with an opinionated default usage, but also with
the flexibility to support any custom semantics.
  - Promises are used pervasively to handle (potentially) asynchronus
    services.
  - Since we don't have clojure's namespaced keywords, instead we just
    use strings that (by convention, any convention could be use)
    include the fully qualified package name, mimicing require/import
    paths.

**Status: Pre-Alpha; PoC implementation**

TODO:
  - decide which of the many "extra" features of component/mount we
    want

## Example

```js
// Static config
var A = createService(
  'package/Configuration', {
    start: (config = process.env) => () => config
  }
);

// Connect to a remote server, eg a DB, based on the configuration
// service
var B = createService(
  'package/ConnectionService', {
    dependencies: ['package/Configuration'],
    start: () => ({'package/Configuration': config}) => {
      return db.connect(config.url, config.key);
    },
    stop: (dbConnection) => dbConnection.close()
  }
);

var C = createService(
  'package/OverlayService', {
    dependencies: [
      'package/Configuration',
      'package/ConnectionService'
    ],
    start: () => ({
      'package/Configuration': config,
      'package/ConnectionService': underlyingConn
    }) => {
      return {
        _config: config,
        doSomething: function (msg) {
          console.log('Hello, ' + msg + '!');
        }
      };
    }
  }
);

var App = createService(
  'package/AppServer', {
    dependencies: [
      'package/Configuration',
      'package/OverlayService'
    ],
    start: () => ({
      'package/Configuration': config,
      'package/OverlayService': overlay
    }) => {
      const app = express();

      app.use(coolMiddleware());

      // 'global' request DI; possible example:
      app.use((req, res, next) => {
        req.config = config;
        req.ourFancyService = overlay;
        next();
      });

      return new Promise((reject, resolve) => {
        let server;
        app.on('error', reject);
        server = app.listen(config.httpPort, () => resolve(server));
      });
    },
    stop: server => new Promise(resolve => server.close(resolve))
  }
);

// If the service names all follow the intended nameing pattern, a
// simple start() suffices.
start(App)
  // Cleanly shutdown after 1 second:
  .then(system => setTimeout(() => stop(system), 1000))
  // uhoh
  .catch(err => { /* */ });

// Starts A then B then C and finally App; then 1 second later shuts
// them down in reverse order (more complex dependency graphs will be
// handled via topological sort with maximal concurrency at every
// step). Cyclic dependencies trigger an error.

// Starting multiple services that can dynamically share common
// dependencies
start([App, App2]);

// Manually specifying some (or all) dependency services:
const FakeB = MockB();
start(App, {
  'package/Configuration': A({key: 'ABC'}),
  'package/ConnectionService': FakeB,
}).catch(err => { /* */ });
```

## API

Types: (ala TypeScript)
```
type ServiceName = String;
type AliasedServiceName = {type: String, as: String};
type Service = {(): () => any, ...any}
type System = {[ServiceName]: any}
```

### createService

(types are rough/not final yet)

`createService<T, StartFn: (...any) => (System) => Promise<T>>(
  ServiceName: String, {
    dependencies?: [ServiceName | AliasedServiceName],
    start: StartFn,
    stop?: T => Promise<()>
  }
): StartFn`

Creates a service, registering it under the given
ServiceName.
  - `dependencies` can be specified, and they will be linked in before
    this service gets started; a map of them being passed to the
    second call of `start`. `AliasedServiceName`s allow asking for
    multiple services of a specific type (TODO: example).
  - `start` must be specified to initialize the server; curried so as
    to be called in two steps:
    1. Arbitrary initialization step: called internally or explicitly
       by the user to configure an instance of this service
    2. Actual start/linking step: the initialized dependencies are
       passed in, to actually startup this service
  - `stop` given a running instance, stop it

### start

`start(targets: (Service | [Service]), dependencies: System): Promise<System>`

Starts the specified service(s), resolving all their
dependencies. Returns a system--a map of all the initialized services.a

## License

Released under the MIT License. See the LICENSE file for full text

Copyright © 2017 George Pittarelli
