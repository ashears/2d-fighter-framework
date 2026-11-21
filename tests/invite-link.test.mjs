import assert from 'node:assert/strict';
import test from 'node:test';
import { createInviteLink, readInviteLink } from '@ashears/fighter-direct';

test('a lobby offer round trips through the fragment of a nested static page', () => {
  const page = new URL('https://example.com/games/fighter/?lang=en#menu');
  const offer = 'FIGHT1.Ab+/0=';
  const link = new URL(createInviteLink(page, offer));
  assert.equal(link.pathname, page.pathname);
  assert.equal(link.search, '?lang=en');
  assert.equal(page.hash, '#menu');
  assert.equal(readInviteLink(link), offer);
});

test('ordinary pages, query parameters, and non-web links skip the invite flow', () => {
  for (const value of ['https://example.com/?invite=offer', 'https://example.com/#rules', 'ftp://example.com/#invite=offer', 'FIGHT1.offer']) {
    assert.equal(readInviteLink(value), null);
  }
});
