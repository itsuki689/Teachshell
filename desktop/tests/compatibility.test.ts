import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dateMs,decodeLibrary,emptyLibrary,relativePath} from '../shared/model.ts';
test('Swift 2001 reference seconds and ISO dates preserve subsecond precision',()=>{assert.equal(dateMs(0),Date.UTC(2001,0,1));assert.equal(dateMs(812345678.125),1790652878125);assert.equal(dateMs('2026-10-25T12:00:00.125Z'),Date.UTC(2026,9,25,12,0,0,125));});
test('unknown future fields roundtrip without deletion',()=>{const input={...emptyLibrary(),futureField:{nested:['preserve']}};assert.deepEqual(decodeLibrary(input),input);});
test('invalid and traversal indexes are rejected without modifying source',()=>{for(const path of ['../secret','files/../secret','files/a/../../secret','files\\a','/tmp/secret','files/C:/secret'])assert.throws(()=>relativePath(path));const input={...emptyLibrary(),schemaVersion:10};assert.throws(()=>decodeLibrary(input));assert.equal(input.schemaVersion,10);});
