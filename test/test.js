var ineedthis = require('../lib'),
  dangerouslyResetRegistry = ineedthis.dangerouslyResetRegistry,
  createService = ineedthis.createService,
  start = ineedthis.start,
  stop = ineedthis.stop;

function delay(d, x) {
  return new Promise((resolve, reject) => setTimeout(() => resolve(x), d));
}

describe('ineedthis', () => {
  beforeEach(dangerouslyResetRegistry);

  it('starts in order; doesn\'t load unnecessary deps', () => {
    var A = createService('A', {start: () => () => 0}),
      B = createService('B', {dependencies: ['A'], start: () => () => 1}),
      C = createService('C', {dependencies: ['B'], start: () => () => 2}),
      // unused:
      D = createService('D', {dependencies: ['C'], start: () => () => 3});

    return start(C).then(sys => {
      expect(sys).to.deep.equal({
        A: 0,
        B: 1,
        C: 2
      });
    });
  });

  it('starts in order without global registry; doesn\'t load unnecessary deps', () => {
    var A = createService('A', {start: () => () => 0}),
      B = createService('B', {dependencies: [A], start: () => () => 1}),
      C = createService('C', {dependencies: [B], start: () => () => 2}),
      // unused:
      D = createService('D', {dependencies: [C], start: () => () => 3});

    return start(C).then(sys => {
      expect(sys).to.deep.equal({
        A: 0,
        B: 1,
        C: 2
      });
    });
  });

  it('start with overriden dependencies', () => {
    var A = createService('A', {start: () => () => 0}),
      B = createService('B', {dependencies: ['A'], start: () => () => 1}),
      C = createService('C', {dependencies: ['B'], start: () => () => 2}),
      D = createService('D', {start: () => () => 3});

    return start(C, {B: D}).then(sys => {
      expect(sys).to.deep.equal({
        B: 3,
        C: 2
      });
    });
  });

  it('loads concurrenctly', function () {
    this.timeout(40);
    var A = createService('A', {start: () => () => delay(25, 0)}),
      B = createService('B', {start: () => () => delay(25, 1)}),
      C = createService('C', {start: () => () => delay(25, 2)}),
      // unused:
      D = createService('D', {dependencies: ['A', 'B', 'C'], start: () => () => 3});

    return start(D).then(sys => {
      expect(sys).to.deep.equal({
        A: 0,
        B: 1,
        C: 2,
        D: 3
      });
    });
  });

  it('detects cycles', () => {
    var A = createService('A', {dependencies: ['B'], start: () => () => 0}),
      B = createService('B', {dependencies: ['A'], start: () => () => 1});

    return expect(start(B)).to.eventually.be.rejectedWith(Error, 'Cycle detected');
  });

  it('stops', () => {
    var log = [],
      A = createService('A', {
        start: () => () => (log.push('start A'), 0),
        stop: () => log.push('stop A')
      }),
      B = createService('B', {
        dependencies: ['A'],
        start: () => () => (log.push('start B'), 1),
        stop: () => log.push('stop B')
      }),
      C = createService('C', {
        dependencies: ['B'],
        start: () => () => (log.push('start C'), 2),
        stop: () => log.push('stop C')
      });

    return start(C)
      .then(system => stop(system))
      .then(() => {
        expect(log).to.deep.equal([
          'start A',
          'start B',
          'start C',
          'stop C',
          'stop B',
          'stop A'
        ]);
      });
  });
});
