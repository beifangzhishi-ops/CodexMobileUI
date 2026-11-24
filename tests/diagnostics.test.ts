import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDiagnosticError, sanitizeDiagnosticEvent, sanitizeDiagnosticFields } from '../src/diagnostics/safe';
test('diagnostic log strips private context before recording or exporting', () => {
  const safe=sanitizeDiagnosticEvent('app.connectionUpdated',{
    outcome:'success',count:3,threadId:'private-thread',token:'private-token',
    hostUrl:'https://private.example',message:'private chat',rawBody:'secret'
  });
  assert.deepEqual(safe,{event:'app.connectionUpdated',fields:{outcome:'success',count:3}});
  assert.doesNotMatch(JSON.stringify(safe),/private|secret|threadId|hostUrl/);
});
test('diagnostics reject arbitrary URLs, messages, and invalid numeric values',()=>{
  assert.deepEqual(sanitizeDiagnosticFields({
    errorKind:'network',result:'https://private.example',durationMs:Infinity,
    status:NaN,attempt:2
  }),{errorKind:'network',attempt:2});
  assert.equal(sanitizeDiagnosticEvent('http://invalid',{token:'secret'}).event,'diagnostics.invalidEvent');
});
test('diagnostics classify errors without emitting their sensitive messages',()=>{
  const classified=classifyDiagnosticError(new TypeError('Fetch failed https://private.example?token=secret'));
  assert.deepEqual(classified,{errorType:'TypeError',errorKind:'network'});
  assert.doesNotMatch(JSON.stringify(classified),/private|secret|https/);
});
