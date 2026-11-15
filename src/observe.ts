import { resolvePaths } from './config/paths';
import { observeCompact } from './store/compact-observer';

await observeCompact(resolvePaths().root);
