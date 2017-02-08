var ineedthis = require('../lib'),
  dangerouslyResetRegistry = ineedthis.dangerouslyResetRegistry,
  createService = ineedthis.createService,
  start = ineedthis.start;

function delay(d, x) {
  return new Promise((resolve, reject) => setTimeout(() => resolve(x), d));
}

describe('ineedthis', () => {
  beforeEach(dangerouslyResetRegistry);

  it('loads in order; doesn\'t load unnecessary deps', () => {
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
  })

});