import { ensureJunit, junitVersion } from '../runner/runtime.mjs';
await ensureJunit();
console.log(`JUnit ${junitVersion} 已下载并通过 SHA-256 校验。`);
