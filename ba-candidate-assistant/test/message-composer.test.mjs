import test from 'node:test';
import assert from 'node:assert/strict';
import { composeMessage } from '../src/domain/message-composer.js';

test('message uses only candidate/project facts and never invents salary remote work or client disclosure', () => {
  const candidate={desiredRoles:['Steuerfachwirt/in'],skills:['DATEV'],experienceYears:6};
  const project={targetRoles:['Steuerfachwirt/in'],clientName:'Geheim GmbH',outreach:{senderName:'Marco',discloseClient:false,closing:'Viele Grüße'}};
  const text=composeMessage(candidate,project);
  assert.match(text,/DATEV|6 Jahre Berufserfahrung|Steuerfachwirt/);
  assert.doesNotMatch(text,/Geheim GmbH/);
  assert.doesNotMatch(text,/Gehalt|Homeoffice|Remote|Euro|€|Firmenwagen/i);
  assert.match(text,/Viele Grüße\nMarco/);
});

test('client is only named when explicitly enabled', () => {
  const text=composeMessage({desiredRoles:['Lohnbuchhalter/in'],skills:[]},{targetRoles:[],clientName:'Muster AG',outreach:{discloseClient:true}});
  assert.match(text,/Muster AG/);
});
