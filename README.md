# ineedthis
[![npm version](https://badge.fury.io/js/ineedthis.svg)](https://badge.fury.io/js/ineedthis)

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
(stateless, constant state (eg static configuration), network
connections, thread pools, etc.). It handles describing, starting, and
linking together those services while not imposing any structure on
the shape or further use of those services.

The API is designed with an opinionated default usage, but also with
the flexibility to support any custom semantics.
  - Promises are used pervasively to handle (potentially) asynchronus
    services.
  - Since we don't have clojure's namespaced keywords, instead we just
    use strings that (by convention, any convention could be use)
    include the fully qualified package name, mimicing require/import
    paths.

It comes with two bin utils for eaily running programs built with this
library:

  - `ineedthis-run file1.js file2.js`: the listed files should be
    modules each with an `ineedthis` service as its default
    export. This command will then automatically start all the
    services and their dependencies, and handles graceful shutdown on
    Ctrl-C (SIGINT).
  - `ineedthis-debug file1.js file2.js` behaves the same as
    `ineedthis-run`, but automatically watches all loaded sources
    files and will hot reload the changed code + gracefully restart
    the affected services.

Finally, ineedthis promotes code reuse and makes it easier to
encapsulate best practices for common libraries:

  - [`@ineedthis/express`](https://github.com/gpittarelli/ineedthis-express)
    makes it easy to start an express server with graceful startup,
    shutdown, and hot reloading.

**Status: Alpha; Working with test suite; Used in prod!**

TODO:
  - Decide which of the many "extra" features of component/mount we
    want
  - Write more wrappers around common node libraries

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

### Example project

https://github.com/tf2stadium/qgs is a WIP project; but it
demonstrates a frontend+backend website implemented with this
library. Most stateful aspects of both the frontend and backend are
split into individual ineedthis services and then composed to produce
the final system.

For example, the frontend [uses a
helper](https://github.com/TF2Stadium/qgs/blob/728d30671ea0b8b04f17a10185c46715e04cdb66/frontend/src/services/withServices.js)
to delay the initial React render and inject the launched services as
props.

The backend has [many stateful
components](https://github.com/TF2Stadium/qgs/tree/728d30671ea0b8b04f17a10185c46715e04cdb66/backend/src/systems)
such as a database connection, a
[postgraphql](https://github.com/graphile/postgraphile) server, and a
job queue.

In development, this runs all the services with hot reloading and
shared DB connections, etc:

```
ineedthis-debug -r localenv -r babel-polyfill ./dist/systems/server ./dist/systems/jobqueue ./dist/systems/monitor
```

In production, we can easily split the services into separate deployments:
```
# Run just the web server:
ineedthis-run -r localenv -r babel-polyfill ./dist/systems/server

# Run just the backend monitoring processes:
ineedthis-run -r localenv -r babel-polyfill ./dist/systems/jobqueue ./dist/systems/monitor
```

## Runners

Often JS apps have a slightly awkward need for a separate startup
script to actually launch the desired services. `ineedthis` provides
two scripts you can use to do this automatically for you:

  - `ineedthis-run` starts services that are the default exports of
    all files listed on the command lines.
  - `ineedthis-debug` is the same as `-run`, except it also
    automatically watches for changes in any files used by the started
    systems. When a change is detected, those files are hot-reloaded and
    the affected services are restarted to pickup the new code. This
    skips having to restart db connections, etc. and thus can be much
    faster than a full restart. For example, even large monolithic
    webservers with DB and other stateful connections can typically hot
    reload route file changes in a fraction of a second.
    - When using a compiler like babel or TypeScript; I highly recommend
      having an incremental compiler running in the background and running
      the built files directly instead of using `babel-register`,
      `babel-node`, or their TS equivalents. This is generally more stable
      because syntax errors pop up in the compiler process instead of
      inside the running `ineedthis-debug` process.

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

### partial restarting

See `stopPartial` and `startPartial` for partially reloading only
certain bits of a system without having to restart every individual
service.

## Development

`npm run test/clean/build` work as expected.

`npm run dev` gets a full stack of builds watching + test cases
running on change.

To filter tests, run with `MOCHA_OPTS` set to, eg, `'-g somepattern'`.

## License

Released under the MIT License. See the LICENSE file for full text

Copyright © 2017 George Pittarelli
