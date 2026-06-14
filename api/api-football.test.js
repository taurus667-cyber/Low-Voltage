import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminAuthorized } from './api-football.js';

test('admin sync endpoint rejects missing or invalid admin password', () => {
  process.env.ADMIN_PASSWORD = 'expected-admin';
  assert.equal(isAdminAuthorized({ headers: {}, query: {} }), false);
  assert.equal(isAdminAuthorized({ headers: { 'x-admin-password': 'wrong' }, query: {} }), false);
  assert.equal(isAdminAuthorized({ headers: { 'x-admin-password': 'expected-admin' }, query: {} }), true);
});

test('admin sync endpoint can use the existing Vite admin password env', () => {
  delete process.env.ADMIN_PASSWORD;
  process.env.VITE_ADMIN_PASSWORD = 'vite-admin';
  assert.equal(isAdminAuthorized({ headers: { 'x-admin-password': 'vite-admin' }, query: {} }), true);
});
