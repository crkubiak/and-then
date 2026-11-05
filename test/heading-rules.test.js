// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadingRules } from '../public/js/rules/HeadingRules.js';

test('only the word Backlog, in any case and with surrounding space, is a heading', () => {
  assert.equal(HeadingRules.isBacklogHeading('Backlog'), true);
  assert.equal(HeadingRules.isBacklogHeading('  backlog '), true);
  assert.equal(HeadingRules.isBacklogHeading('BACKLOG'), true);
  assert.equal(HeadingRules.isBacklogHeading('Backlog grooming'), false);
  assert.equal(HeadingRules.isBacklogHeading('The Backlog'), false);
  assert.equal(HeadingRules.isBacklogHeading(''), false);
});
