import { applyTestEnv } from './env.setup';
import { resetPersistence } from './reset-persistence';
import { getTestGlobals } from './test-globals';

applyTestEnv();

jest.setTimeout(60000);

beforeEach(() => {
	jest.clearAllMocks();

	getTestGlobals().__QR_VERIFIER__?.verify.mockReset();
	getTestGlobals().__OUTBOX_DISPATCHER__?.dispatch.mockReset();
});

afterEach(async () => {
	const globals = getTestGlobals();

	if (!globals.__PRISMA__) {
		return;
	}

	await resetPersistence(globals.__PRISMA__, globals.__REDIS_CLIENT__);
});