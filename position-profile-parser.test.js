const assert = require('node:assert/strict');
const parser = require('./position-profile-parser.js');

const linkedInTitle = parser.parseProfileHtml(
  '<meta property="og:title" content="Max Mustermann – Geschäftsführer bei Muster GmbH | LinkedIn">',
  { platform: 'linkedin' },
);
assert.equal(linkedInTitle.success, true);
assert.equal(linkedInTitle.data.currentPosition, 'Geschäftsführer');
assert.equal(linkedInTitle.data.positionSource, 'meta-title');

const linkedInCompanyOnlyTitle = parser.parseProfileHtml(
  '<meta property="og:title" content="Ferdinand Plehn – RSM Ebner Stolz | LinkedIn">',
  { platform: 'linkedin' },
);
assert.equal(linkedInCompanyOnlyTitle.success, false);

const linkedInCompanyOccupationWithHeadline = parser.parseProfileHtml(
  '<meta property="og:title" content="Ferdinand Plehn – RSM Ebner Stolz | LinkedIn"><script>{"occupation":"Ferdinand Plehn – RSM Ebner Stolz","companyName":"RSM Ebner Stolz","headline":"Wirtschaftsprüfer und Steuerberater"}</script>',
  { platform: 'linkedin' },
);
assert.equal(linkedInCompanyOccupationWithHeadline.success, true);
assert.equal(linkedInCompanyOccupationWithHeadline.data.currentPosition, 'Wirtschaftsprüfer und Steuerberater');
assert.equal(linkedInCompanyOccupationWithHeadline.data.positionSource, 'embedded-headline');

const xingOccupation = parser.parseProfileHtml(
  '<title>Britta Beispiel | XING</title><script>{"occupation":"Partnerin bei Beispiel GmbH"}</script>',
  { platform: 'xing' },
);
assert.equal(xingOccupation.success, true);
assert.equal(xingOccupation.data.currentPosition, 'Partnerin');

const jsonLd = parser.parseProfileHtml(
  '<script type="application/ld+json">{"@type":"Person","jobTitle":"Wirtschaftsprüfer und Steuerberater","worksFor":{"name":"Kanzlei GmbH"}}</script>',
  { platform: 'linkedin' },
);
assert.equal(jsonLd.success, true);
assert.equal(jsonLd.data.currentPosition, 'Wirtschaftsprüfer und Steuerberater');
assert.equal(jsonLd.data.positionSource, 'structured-jobtitle');

const currentRole = parser.parseProfileHtml(
  '<script type="application/json">{"positions":[{"title":"Consultant","endDate":"2021-01-01"},{"title":"Partner","isCurrent":true}]}</script>',
  { platform: 'linkedin' },
);
assert.equal(currentRole.success, true);
assert.equal(currentRole.data.currentPosition, 'Partner');
assert.equal(currentRole.data.positionSource, 'structured-current-role');

const headline = parser.parseProfileHtml(
  '<script>{"headline":"Inhaber | Wirtschaftsprüfer | Steuerberater"}</script>',
  { platform: 'linkedin' },
);
assert.equal(headline.success, true);
assert.equal(headline.data.currentPosition, 'Inhaber | Wirtschaftsprüfer | Steuerberater');
assert.equal(headline.data.positionSource, 'embedded-headline');

const cfo = parser.parseProfileHtml(
  '<script type="application/ld+json">{"jobTitle":"Chief Financial Officer at Example AG"}</script>',
  { platform: 'linkedin' },
);
assert.equal(cfo.success, true);
assert.equal(cfo.data.currentPosition, 'Chief Financial Officer');

const nameOnly = parser.parseProfileHtml('<title>Max Mustermann | LinkedIn</title>', { platform: 'linkedin' });
assert.equal(nameOnly.success, false);

const genericDescription = parser.parseProfileHtml(
  '<title>Max Mustermann | LinkedIn</title><meta name="description" content="Max ist seit vielen Jahren im Netzwerk aktiv und hat 500 Kontakte.">',
  { platform: 'linkedin' },
);
assert.equal(genericDescription.success, false);

const login = parser.parseProfileHtml(
  '<title>LinkedIn Login</title><meta name="description" content="Sign in">',
  { platform: 'linkedin' },
);
assert.equal(login.success, false);

assert.deepEqual(
  Object.keys(linkedInTitle.data).sort(),
  ['currentPosition', 'parserVersion', 'positionConfidence', 'positionSource'].sort(),
);
assert.equal(Object.prototype.hasOwnProperty.call(linkedInTitle.data, 'currentCompany'), false);
assert.equal(Object.prototype.hasOwnProperty.call(linkedInTitle.data, 'displayName'), false);
assert.equal(parser.PARSER_VERSION, 3);

console.log('position-profile-parser-v3: ok');
