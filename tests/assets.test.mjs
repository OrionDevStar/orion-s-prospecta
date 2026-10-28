import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceJson } from '../scripts/prepare-assets.mjs';

test('municipality source JSON accepts the UTF-8 BOM present in upstream data',()=>{
 const input=Buffer.from('\uFEFF[{"nome":"Jaraguá do Sul","latitude":-26.48}]','utf8');
 assert.deepEqual(parseSourceJson(input),[{nome:'Jaraguá do Sul',latitude:-26.48}]);
 assert.deepEqual(parseSourceJson(Buffer.from('[{"nome":"São Paulo"}]')),[{nome:'São Paulo'}]);
});
