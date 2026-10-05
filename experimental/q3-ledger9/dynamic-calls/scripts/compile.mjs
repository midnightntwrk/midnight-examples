// Callees and caller compile independently under 0.35.0: the registry needs
// only its `contract Token { ... }` declaration, not the token sources. (The
// vendor harness's "callee managed dir must be named after the interface"
// convention predates dynamic resolution.)
import { compile } from '../../harness/scripts/compact.mjs';

compile('contract/standard_token.compact', 'contract/managed/standard_token');
compile('contract/audited_token.compact', 'contract/managed/audited_token');
compile('contract/token_registry.compact', 'contract/managed/token_registry');
