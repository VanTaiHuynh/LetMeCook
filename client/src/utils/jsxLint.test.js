import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

test('the project lint gate rejects undeclared JSX components and accepts a locally defined component', async () => {
  const lint = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });
  const options = { filePath: 'src/JsxGateFixture.jsx' };
  const [missing] = await lint.lintText('export default function Page() { return <MissingIcon />; }', options);
  assert.ok(missing.messages.some(message => message.ruleId === 'react/jsx-no-undef' && message.severity === 2));
  const [declared] = await lint.lintText('const ExistingIcon = () => null; export default function Page() { return <ExistingIcon />; }', options);
  assert.equal(declared.errorCount, 0);
});
