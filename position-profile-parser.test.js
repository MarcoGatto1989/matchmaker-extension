const assert = require('node:assert/strict');
const parser = require('./position-profile-parser.js');

const linkedIn = parser.parseProfileHtml(
  '<meta property="og:title" content="Max Mustermann – Geschäftsführer bei Muster GmbH | LinkedIn">',
  { platform: 'linkedin' },
);
assert.equal(linkedIn.success, true);
assert.equal(linkedIn.data.currentPosition, 'Geschäftsführer');
assert.equal(linkedIn.data.firstName, 'Max');
assert.equal(linkedIn.data.lastName, 'Mustermann');
assert.equal(Object.prototype.hasOwnProperty.call(linkedIn.data, 'currentCompany'), false);

const xing = parser.parseProfileHtml(
  '<title>Britta Beispiel | XING</title><script>{"firstName":"Britta","lastName":"Beispiel","occupation":"Partnerin bei Beispiel GmbH"}</script>',
  { platform: 'xing' },
);
assert.equal(xing.success, true);
assert.equal(xing.data.currentPosition, 'Partnerin');
assert.equal(xing.data.firstName, 'Britta');
assert.equal(xing.data.lastName, 'Beispiel');

const login = parser.parseProfileHtml(
  '<title>LinkedIn Login</title><meta name="description" content="Sign in">',
  { platform: 'linkedin' },
);
assert.equal(login.success, false);

console.log('position-profile-parser: ok');

