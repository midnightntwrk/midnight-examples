// The vector contracts hold only pure circuits and are exercised in memory, so
// they never need proving keys. signature_auth is deployed by the e2e tests and
// gets full keys unless Q3_SKIP_ZK=1.
import { compile } from '../../harness/scripts/compact.mjs';

const ZKIR_V3 = ['--feature-zkir-v3'];
const skipZk = process.env['Q3_SKIP_ZK'];

process.env['Q3_SKIP_ZK'] = '1';
compile('contract/ed25519_vectors.compact', 'contract/managed/ed25519_vectors', ZKIR_V3);
compile('contract/p256_vectors.compact', 'contract/managed/p256_vectors', ZKIR_V3);

if (skipZk === undefined) delete process.env['Q3_SKIP_ZK'];
else process.env['Q3_SKIP_ZK'] = skipZk;
compile('contract/signature_auth.compact', 'contract/managed/signature_auth', ZKIR_V3);
