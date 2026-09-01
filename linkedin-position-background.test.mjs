import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.dirname(new URL(import.meta.url).pathname);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const bridgePath = path.join(root, 'linkedin-position-background-v420.js');
const workerPath = path.join(root, 'service-worker-v420.js');

assert.equal(manifest.version, '4.0.20', 'LinkedIn background position fix must bump the extension version');
assert.equal(manifest.background?.service_worker, 'service-worker-v420.js');
assert.equal(fs.existsSync(bridgePath), true, 'same-origin LinkedIn background bridge must exist');
assert.equal(fs.existsSync(workerPath), true, 'v4.0.20 service worker must exist');

const require = createRequire(import.meta.url);
const bridge = require(bridgePath);

assert.equal(
  bridge.sameLinkedInProfile('/in/nathalie-m-schucht-funk-80468ba0', '/in/nathalie-m-schucht-funk-80468ba0/'),
  true,
);
assert.equal(bridge.sameLinkedInProfile('/in/expected', '/login'), false);
assert.equal(
  bridge.sameLinkedInProfile('/in/nathalie-m-schucht-funk-80468ba0', '/in/other-person'),
  false,
);
assert.equal(
  bridge.normalizedSameOriginProfileUrl('https://de.linkedin.com/in/nathalie-m-schucht-funk-80468ba0', 'https://www.linkedin.com/feed/'),
  'https://www.linkedin.com/in/nathalie-m-schucht-funk-80468ba0',
);
assert.throws(
  () => bridge.normalizedSameOriginProfileUrl('https://example.com/in/not-linkedin', 'https://www.linkedin.com/feed/'),
  /LinkedIn/i,
);

assert.equal(
  bridge.plausibleLinkedInPosition('Nathalie M. Schucht-Funk – Forvis Mazars Group', {
    name: 'Nathalie M. Schucht-Funk',
    company: 'Forvis Mazars Group',
  }),
  false,
  'the person/company header from the reported regression must never be accepted as a position',
);
assert.equal(
  bridge.plausibleLinkedInPosition('Senior Manager', { name: 'Marlena Presser', company: 'Grant Thornton AG' }),
  true,
);
assert.equal(
  bridge.plausibleLinkedInPosition('Prokuristin', { name: 'Nathalie M. Schucht-Funk', company: 'Forvis Mazars Group' }),
  true,
);

const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
assert.match(bridgeSource, /credentials:\s*['"]include['"]/);
assert.match(bridgeSource, /MatchMakerPositionParser/);
assert.doesNotMatch(bridgeSource, /location\.(?:href|assign|replace)\s*=/);

const workerSource = fs.readFileSync(workerPath, 'utf8');
assert.match(workerSource, /importScripts\(['"]service-worker-v419\.js['"]\)/);
assert.match(workerSource, /ESOS_FETCH_LINKEDIN_POSITION/);
assert.match(workerSource, /platform\s*!==\s*['"]linkedin['"]/);
assert.doesNotMatch(workerSource, /chrome\.(?:tabs\.create|windows\.create)/);
assert.doesNotMatch(workerSource, /esosV414DirectProfilePosition\(profileUrl,\s*['"]linkedin['"]\)/);

console.log('linkedin-position-background-v420: ok');
