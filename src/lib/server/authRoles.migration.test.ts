import { describe, expect, it } from 'vitest';
import { isLastOwnerDemotion, isOwnerUserDoc, migrateLegacyRoleToken } from './authRoles';

describe('migrateLegacyRoleToken', () => {
  it('maps legacy administrator to owner', () => {
    expect(migrateLegacyRoleToken('administrator')).toBe('owner');
    expect(migrateLegacyRoleToken('owner')).toBe('owner');
    expect(migrateLegacyRoleToken('user')).toBe('user');
    expect(migrateLegacyRoleToken('unknown')).toBeNull();
  });
});

describe('isOwnerUserDoc', () => {
  it('treats administrator stored role as owner', () => {
    expect(isOwnerUserDoc({ role: 'administrator' })).toBe(true);
    expect(isOwnerUserDoc({ role: 'owner' })).toBe(true);
    expect(isOwnerUserDoc({ role: 'user' })).toBe(false);
    expect(isOwnerUserDoc({ roles: ['administrator'] })).toBe(true);
    expect(isOwnerUserDoc({ roles: ['user'] })).toBe(false);
  });
});

describe('isLastOwnerDemotion', () => {
  it('blocks demoting the only owner', () => {
    expect(
      isLastOwnerDemotion({ newRole: 'user', targetWasOwner: true, ownerCount: 1 })
    ).toBe(true);
  });

  it('allows demoting one owner when another exists', () => {
    expect(
      isLastOwnerDemotion({ newRole: 'user', targetWasOwner: true, ownerCount: 2 })
    ).toBe(false);
  });

  it('does not apply to promotions or non-owners', () => {
    expect(
      isLastOwnerDemotion({ newRole: 'owner', targetWasOwner: true, ownerCount: 1 })
    ).toBe(false);
    expect(
      isLastOwnerDemotion({ newRole: 'user', targetWasOwner: false, ownerCount: 1 })
    ).toBe(false);
  });
});
