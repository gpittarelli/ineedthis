var ineedthis = require('./index.js');
var createService = ineedthis.createService;
var start = ineedthis.start;

const db = {
  connect: () => ({close: () => void 0})
};

// Static config
var A = createService(
  'package/Configuration', {
    start: (config = {url: '', key: ''}) => () => config
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
      console.log('hi', config, overlay);
      return new Promise((resolve, reject) => {
        setTimeout(() => resolve('APP SERVER!'), 2000);
      });
    },
    stop: server => new Promise(resolve => server.close(resolve))
  }
);

// If the service names all follow the intended nameing pattern, a
// simple start() suffices.
start(App)
  .then(system => {
    console.log('started', system);
//    setTimeout(() => stop(system), 1000);
  })
  .catch(err => console.error('ERR!', err));

// Starts A then B then C and finally App; then 1 second later shuts
// them down in reverse order (more complex dependency graphs will be
// handled via topological sort with maximal concurrency at every
// step). Cyclic dependencies trigger an error.
/*
// Starting multiple services that can dynamically share common
// dependencies
start([App, App2]);

// Manually specifying some (or all) dependency services:
const FakeB = MockB();
start(App, {
  'package/Configuration': A({key: 'ABC'}),
  'package/ConnectionService': FakeB,
}).catch(err => { /*  });
*/
