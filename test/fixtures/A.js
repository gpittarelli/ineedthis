var ineedthis = require('../../lib/'),
  createService = ineedthis.createService;

module.exports = createService('A', {start: () => () => 0});
