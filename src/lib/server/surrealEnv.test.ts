import { afterEach, describe, expect, it } from 'vitest';
import { hasSurrealTargetEnv, normalizeSurrealRpcUrl, resolveSurrealRpcUrl } from './surrealEnv.js';

function clearSurrealEnv() {
	delete process.env.SURREAL_URL;
	delete process.env.SURREAL_HOSTNAME;
	delete process.env.SURREAL_INSTANCE;
}

afterEach(() => {
	clearSurrealEnv();
});

describe('normalizeSurrealRpcUrl', () => {
	it('adds /rpc and upgrades https to wss', () => {
		expect(normalizeSurrealRpcUrl('https://example.com')).toBe('wss://example.com/rpc');
	});
	it('preserves existing /rpc', () => {
		expect(normalizeSurrealRpcUrl('ws://localhost:8000/rpc')).toBe('ws://localhost:8000/rpc');
	});
});

describe('resolveSurrealRpcUrl', () => {
	it('prefers SURREAL_URL when set', () => {
		process.env.SURREAL_URL = 'https://explicit.example/rpc';
		process.env.SURREAL_HOSTNAME = 'ignored.cloud';
		process.env.SURREAL_INSTANCE = 'ignored';
		expect(resolveSurrealRpcUrl()).toBe('wss://explicit.example/rpc');
	});
	it('composes instance + hostname when URL unset', () => {
		process.env.SURREAL_HOSTNAME = 'eu-west-1.aws.surrealdb.com';
		process.env.SURREAL_INSTANCE = 'myinstance';
		expect(resolveSurrealRpcUrl()).toBe('wss://myinstance.eu-west-1.aws.surrealdb.com/rpc');
	});
	it('uses hostname only when instance unset', () => {
		process.env.SURREAL_HOSTNAME = 'db.example.com';
		expect(resolveSurrealRpcUrl()).toBe('wss://db.example.com/rpc');
	});
});

describe('hasSurrealTargetEnv', () => {
	it('is false when nothing set', () => {
		clearSurrealEnv();
		expect(hasSurrealTargetEnv()).toBe(false);
	});
	it('is true with hostname + instance', () => {
		process.env.SURREAL_HOSTNAME = 'h';
		process.env.SURREAL_INSTANCE = 'i';
		expect(hasSurrealTargetEnv()).toBe(true);
	});
});
