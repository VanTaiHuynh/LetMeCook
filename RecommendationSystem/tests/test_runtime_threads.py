"""CPU startup bounds, lifecycle ordering and real Torch pool configuration."""
import ast
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src/runtime_threads.py"


def fresh_helper():
    spec = importlib.util.spec_from_file_location("thread_helper_test", SOURCE)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper


class FakeTorch:
    def __init__(self):
        self.intra = self.inter = None
        self.inter_calls = 0

    def set_num_threads(self, value): self.intra = value

    def set_num_interop_threads(self, value):
        self.inter_calls += 1
        if self.inter_calls != 1: raise RuntimeError("inter-op already initialized")
        self.inter = value

    def get_num_threads(self): return self.intra
    def get_num_interop_threads(self): return self.inter


class RuntimeThreadsTests(unittest.TestCase):
    def test_invalid_and_oversized_settings_fail_before_torch_import(self):
        helper = fresh_helper()
        for value in ("0", "-1", "25", "104", "16.5", "all", ""):
            with self.subTest(value=value), patch.dict(os.environ, {"OMP_NUM_THREADS": value}):
                with self.assertRaisesRegex(ValueError, "between 1 and 24"):
                    helper.configure_cpu_threads()
        self.assertIsNone(helper._configuration)

    def test_repeated_and_concurrent_startup_cannot_initialize_interop_twice(self):
        helper, torch = fresh_helper(), FakeTorch()
        with patch.dict(os.environ, {"OMP_NUM_THREADS": "16"}), patch.dict(sys.modules, {"torch": torch}):
            with ThreadPoolExecutor(max_workers=8) as executor:
                results = list(executor.map(lambda _: helper.configure_cpu_threads(), range(16)))
            self.assertTrue(all(result == {"intraop_threads": 16, "interop_threads": 1} for result in results))
            self.assertEqual(torch.inter_calls, 1)
            results[0]["intraop_threads"] = 104
            self.assertEqual(helper.configure_cpu_threads()["intraop_threads"], 16)

    def test_changing_config_in_live_process_requires_restart(self):
        helper, torch = fresh_helper(), FakeTorch()
        with patch.dict(os.environ, {"OMP_NUM_THREADS": "2"}), patch.dict(sys.modules, {"torch": torch}):
            helper.configure_cpu_threads()
            os.environ["OMP_NUM_THREADS"] = "16"
            with self.assertRaisesRegex(RuntimeError, "restart the worker"):
                helper.configure_cpu_threads()
            self.assertEqual(torch.intra, 2)
            self.assertEqual(torch.inter_calls, 1)

    def test_default_uses_measured_threads_and_preserves_explicit_operator_overrides(self):
        helper, torch = fresh_helper(), FakeTorch()
        with patch.dict(os.environ, {"MKL_NUM_THREADS": "4"}, clear=True), patch.dict(sys.modules, {"torch": torch}):
            self.assertEqual(helper.configure_cpu_threads(), {"intraop_threads": 16, "interop_threads": 1})
            self.assertEqual(os.environ["OMP_NUM_THREADS"], "16")
            self.assertEqual(os.environ["MKL_NUM_THREADS"], "4")
            self.assertEqual(os.environ["TOKENIZERS_PARALLELISM"], "false")

    def test_entrypoints_configure_before_recommendation_and_embedding_torch_imports(self):
        app = ast.parse((ROOT / "app.py").read_text())
        configure = next(node for node in app.body if isinstance(node, ast.Assign) and
                         isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and
                         node.value.func.id == "configure_cpu_threads")
        first_domain_import = next(node for node in app.body if isinstance(node, ast.ImportFrom) and
                                   node.module == "src.recommend")
        self.assertLess(configure.lineno, first_domain_import.lineno)
        embedding = ast.parse((ROOT / "src/embed_with_sbert.py").read_text())
        main_guard = next(node for node in embedding.body if isinstance(node, ast.If) and
                          any(isinstance(child, ast.Call) and isinstance(child.func, ast.Name) and
                              child.func.id == "configure_cpu_threads" for child in ast.walk(node)))
        torch_import = next(node for node in embedding.body if isinstance(node, ast.Import) and
                            any(alias.name == "torch" for alias in node.names))
        self.assertLess(main_guard.lineno, torch_import.lineno)

    def test_real_fresh_torch_process_reports_configured_pools_and_unchanged_matrix_result(self):
        code = '''
import json
from src.runtime_threads import configure_cpu_threads
first = configure_cpu_threads()
import torch
x = torch.arange(16, dtype=torch.float32).reshape(4, 4)
actual = torch.mm(x, x)
expected = [[sum(float(x[r,k])*float(x[k,c]) for k in range(4)) for c in range(4)] for r in range(4)]
assert torch.equal(actual, torch.tensor(expected))
assert configure_cpu_threads() == first
print(json.dumps(first))
'''
        env = os.environ.copy()
        env.update({"OMP_NUM_THREADS": "4", "MKL_NUM_THREADS": "4", "PYTHONDONTWRITEBYTECODE": "1"})
        process = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env,
                                 capture_output=True, text=True, timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout), {"intraop_threads": 4, "interop_threads": 1})


if __name__ == "__main__": unittest.main()
