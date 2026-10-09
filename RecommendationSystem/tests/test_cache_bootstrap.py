"""Fresh startup fails clearly; published caches are reused without an implicit build."""
import io
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import torch
from src import cache_bootstrap as boot,legacy_cache_store as store


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'model'
        self.env=patch.dict(os.environ,{'RECOMMENDATION_MODEL_DIR':str(self.path)})
        self.env.start()
    def tearDown(self):self.env.stop();self.temp.cleanup()

    def test_empty_volume_default_check_is_readonly_and_never_downloads_or_rebuilds(self):
        with patch.object(boot,'get_hybrid_snapshot',return_value=None),patch('src.embed_with_sbert.get_model',side_effect=AssertionError('No model download')),patch('src.pipeline.run_pipeline',side_effect=AssertionError('No automatic rebuild')),patch('sys.stdout',new_callable=io.StringIO):
            self.assertEqual(3,boot.main(['--check']))
        self.assertFalse(self.path.exists())

    def test_valid_hybrid_is_reused_without_loading_legacy_or_requesting_ollama(self):
        snapshot=SimpleNamespace(recipe_ids=tuple(range(10000)),embeddings=SimpleNamespace(shape=(10000,1024)))
        with patch.object(boot,'get_hybrid_snapshot',return_value=snapshot),patch.object(store,'load',side_effect=AssertionError('No legacy work')),patch('sys.stdout',new_callable=io.StringIO):
            self.assertEqual(0,boot.main(['--check','--expected-count','10000']))

    def test_valid_legacy_works_when_hybrid_is_unavailable(self):
        store.publish(torch.ones((2,384)),['first','second'])
        with patch.object(boot,'get_hybrid_snapshot',return_value=None):
            result=boot.inspect_cache(2)
        self.assertEqual({'status':'ready','engine':'legacy-sbert','count':2,'dimension':384},result)

    def test_expected_count_mismatch_never_serves_the_wrong_generation(self):
        store.publish(torch.ones((1,384)),['first'])
        with patch.object(boot,'get_hybrid_snapshot',return_value=None):self.assertEqual('needs_explicit_bootstrap',boot.inspect_cache(2)['status'])

    def test_explicit_legacy_build_fails_before_export_when_weights_not_provisioned(self):
        with patch('src.embed_with_sbert.get_model',side_effect=store.ModelUnavailable('not provisioned')),patch('src.pipeline.run_pipeline') as build,patch('sys.stdout',new_callable=io.StringIO):
            self.assertEqual(3,boot.main(['--build-legacy']))
            build.assert_not_called()


if __name__=='__main__':unittest.main()
