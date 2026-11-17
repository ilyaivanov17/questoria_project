import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
import { AdminMfaGuard } from './admin-mfa.guard.js';
import { AdminCsrfGuard } from './admin-csrf.guard.js';

function createContext(user: Record<string, unknown>, method = 'GET', origin?: string): ExecutionContext {
  const request = { authUser: user, method, headers: origin ? { origin } : {} };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function rolesGuard(required: string[]): RolesGuard {
  return new RolesGuard({
    getAllAndOverride: () => required,
  } as unknown as Reflector);
}

test('AUTHOR cannot review or publish; REVIEWER can author and review but not publish', () => {
  const author = { userId: 'author', roleKeys: ['AUTHOR'] };
  assert.equal(rolesGuard(['AUTHOR']).canActivate(createContext(author)), true);
  assert.throws(
    () => rolesGuard(['REVIEWER']).canActivate(createContext(author)),
    ForbiddenException,
  );
  const reviewer = { userId: 'reviewer', roleKeys: ['REVIEWER'] };
  assert.equal(rolesGuard(['AUTHOR']).canActivate(createContext(reviewer)), true);
  assert.equal(rolesGuard(['REVIEWER']).canActivate(createContext(reviewer)), true);
  assert.throws(
    () => rolesGuard(['ADMIN']).canActivate(createContext(reviewer)),
    ForbiddenException,
  );
});

test('ADMIN never inherits SUPER_ADMIN-only privileges', () => {
  const admin = { userId: 'admin', roleKeys: ['ADMIN'] };
  assert.equal(rolesGuard(['ADMIN']).canActivate(createContext(admin)), true);
  assert.throws(
    () => rolesGuard(['SUPER_ADMIN']).canActivate(createContext(admin)),
    ForbiddenException,
  );
});

test('administrator mutations require enabled and session-verified MFA', () => {
  const guard = new AdminMfaGuard();
  assert.equal(guard.canActivate(createContext({
    userId: 'author', roleKeys: ['AUTHOR'], mfaEnabled: false, sessionMfaVerified: false,
  })), true);
  assert.throws(() => guard.canActivate(createContext({
    userId: 'admin', roleKeys: ['ADMIN'], mfaEnabled: false, sessionMfaVerified: false,
  })), ForbiddenException);
  assert.throws(() => guard.canActivate(createContext({
    userId: 'admin', roleKeys: ['ADMIN'], mfaEnabled: true, sessionMfaVerified: false,
  })), ForbiddenException);
  assert.equal(guard.canActivate(createContext({
    userId: 'admin', roleKeys: ['ADMIN'], mfaEnabled: true, sessionMfaVerified: true,
  })), true);
});

test('admin writes require the configured same-origin request', () => {
  process.env.WEB_ORIGIN = 'https://questoria.example';
  const guard = new AdminCsrfGuard();
  assert.equal(guard.canActivate(createContext({}, 'GET')), true);
  assert.equal(guard.canActivate(createContext({}, 'POST', 'https://questoria.example')), true);
  assert.throws(() => guard.canActivate(createContext({}, 'POST')), ForbiddenException);
  assert.throws(() => guard.canActivate(createContext({}, 'PATCH', 'https://attacker.example')), ForbiddenException);
});
