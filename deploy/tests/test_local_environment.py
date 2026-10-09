import json
import os
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest
from unittest.mock import patch


class LocalEnvironmentTests(unittest.TestCase):
    def run_writer(self, directory, status):
        script = directory / 'write-local-env.py'
        shutil.copyfile(Path(__file__).resolve().parents[1] / script.name, script)
        with patch('subprocess.check_output', return_value=json.dumps(status)):
            runpy.run_path(str(script), run_name='__main__')

    def test_refresh_keeps_signing_key_runtime_roles_and_operator_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = root / '.env.local'
            env.write_text('PLANNER_SIGNING_KEY=preserved-test-key\nWORKER_DATABASE_PASSWORD=test-worker\n'
                           'GATEWAY_DATABASE_PASSWORD=test-gateway\nOMP_NUM_THREADS=16\nSUPABASE_PASSWORD=old\n')
            self.run_writer(root, {'DB_URL':'postgresql://postgres:changed%2Blocal@127.0.0.1:56422/postgres',
                                  'API_URL':'http://127.0.0.1:56421','ANON_KEY':'public-test-key'})
            values = dict(line.split('=',1) for line in env.read_text().splitlines())
            self.assertEqual(values['PLANNER_SIGNING_KEY'], 'preserved-test-key')
            self.assertEqual(values['WORKER_DATABASE_PASSWORD'], 'test-worker')
            self.assertEqual(values['GATEWAY_DATABASE_PASSWORD'], 'test-gateway')
            self.assertEqual(values['OMP_NUM_THREADS'], '16')
            self.assertEqual(values['SUPABASE_PASSWORD'], 'changed+local')
            self.assertEqual(values['SPRING_DATASOURCE_PASSWORD'], 'changed+local')
            self.assertEqual(env.stat().st_mode & 0o777, 0o600)

    def test_invalid_multiline_value_does_not_replace_existing_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = root / '.env.local'
            env.write_text('PLANNER_SIGNING_KEY=preserved-test-key\n')
            before = env.read_bytes()
            with self.assertRaises(ValueError):
                self.run_writer(root, {'DB_URL':'postgresql://postgres:test@127.0.0.1:56422/postgres',
                                      'API_URL':'http://127.0.0.1:56421','ANON_KEY':'key\nINJECTED=value'})
            self.assertEqual(env.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
