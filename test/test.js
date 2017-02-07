var ineedthis = require('../lib'),
  dangerouslyResetRegistry = ineedthis.dangerouslyResetRegistry,
  createService = ineedthis.createService,
  start = ineedthis.start;

describe('Hi', () => {
  beforeEach(dangerouslyResetRegistry);

  it('loads in order', () => {
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

});
