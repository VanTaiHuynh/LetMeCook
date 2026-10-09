"""Publication failures, permission transitions and competing writers, no live DB/models."""
import hashlib
import json
import os
from pathlib import Path
import pickle
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch,MagicMock
import torch
from src import legacy_cache_store as store,embed_with_sbert as embed
from src.cache_manager import RecipeCache
from src.download_from_supabase import QUERY
from src.local_ai import public_catalog_clause


class LegacyGenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.env=patch.dict(os.environ,{'RECOMMENDATION_MODEL_DIR':str(self.root),
                                     'CACHE_AUTO_REBUILD':'false','REBUILD_CACHE_ON_START':'false'})
        self.env.start()

    def tearDown(self):self.env.stop();self.temp.cleanup()

    def test_id_order_and_checksums_are_bound_to_an_immutable_generation(self):
        vector=torch.stack([torch.ones(384),torch.full((384,),2.)])
        name=embed.save_embeddings(vector,['b','a'])
        ids,matrix=embed.load_embeddings()
        self.assertEqual(['b','a'],ids);self.assertTrue(torch.equal(matrix,vector))
        manifest=json.loads((store.directory()/name/'manifest.json').read_text())
        self.assertEqual(store.REVISION,manifest['encoder']['revision'])
        self.assertEqual(384,manifest['encoder']['dimension'])
        self.assertEqual(2,manifest['count'])
        self.assertEqual(0o400,(store.directory()/name/'embeddings.pt').stat().st_mode&0o777)

    def test_corrupt_ids_cannot_pair_with_valid_old_embeddings(self):
        name=embed.save_embeddings(torch.ones((2,384)),['a','b'])
        path=store.directory()/name/'ids.json';path.chmod(0o600);path.write_text('["b","a"]')
        with self.assertRaisesRegex(store.CacheInvalid,'checksum'):embed.load_embeddings()

    def test_model_dimension_duplicate_and_nonfinite_mismatches_preserve_previous_pointer(self):
        previous=embed.save_embeddings(torch.ones((1,384)),['old'])
        for matrix,ids in [(torch.ones((1,1024)),['new']),(torch.ones((2,384)),['same','same']),
                           (torch.full((1,384),float('nan')),['new']),(torch.ones((1,384),dtype=torch.float64),['new'])]:
            with self.assertRaises(store.CacheInvalid):embed.save_embeddings(matrix,ids)
            self.assertEqual(previous,store.generation_name())
        self.assertEqual(['old'],embed.load_embeddings()[0])

    def test_interrupted_pointer_publication_keeps_last_complete_generation(self):
        previous=embed.save_embeddings(torch.ones((1,384)),['old'])
        replace=Path.replace
        def fail(path,target):
            if Path(target).name=='CURRENT':raise OSError('simulated interrupted publication')
            return replace(path,target)
        with patch.object(Path,'replace',fail):
            with self.assertRaises(OSError):embed.save_embeddings(torch.full((1,384),2.),['new'])
        self.assertEqual(previous,store.generation_name())
        self.assertEqual(['old'],embed.load_embeddings()[0])
        self.assertFalse(list(store.directory().glob('.CURRENT-*')))

    def test_rebuild_add_remove_serialize_without_lost_mutations(self):
        embed.save_embeddings(torch.ones((2,384)),['old','remove'])
        started=threading.Event();release=threading.Event();added=threading.Event();removed=threading.Event();errors=[]
        def rebuild():
            try:
                with store.writer_lock():
                    started.set();self.assertTrue(release.wait(5))
                    embed.save_embeddings(torch.ones((2,384)),['seed','remove'])
            except Exception as e:errors.append(e)
        def add():
            try:embed.append_embedding('added','Recipe');added.set()
            except Exception as e:errors.append(e)
        def remove():
            try:embed.remove_embeddings(['remove']);removed.set()
            except Exception as e:errors.append(e)
        with patch.object(embed,'public_ids',return_value={'seed','remove','added'}),patch.object(embed,'embed_texts',return_value=torch.full((1,384),3.)):
            threads=[threading.Thread(target=f) for f in [rebuild,add,remove]]
            threads[0].start();self.assertTrue(started.wait(5))
            threads[1].start();threads[2].start()
            self.assertFalse(added.wait(.05));self.assertFalse(removed.is_set())
            release.set()
            for thread in threads:thread.join(5);self.assertFalse(thread.is_alive())
        self.assertEqual([],errors)
        self.assertEqual({'seed','added'},set(embed.load_embeddings()[0]))

    def test_filesystem_lock_rejects_another_process_with_a_bounded_wait(self):
        ready=self.root/'locked';release=self.root/'release'
        code="import os,fcntl,time;from pathlib import Path;p=Path(os.environ['RECOMMENDATION_MODEL_DIR'])/'legacy-sbert';p.mkdir(exist_ok=True);f=(p/'.writer.lock').open('a');fcntl.flock(f,fcntl.LOCK_EX);Path(os.environ['RECOMMENDATION_MODEL_DIR'],'locked').touch();end=time.monotonic()+10\nwhile not Path(os.environ['RECOMMENDATION_MODEL_DIR'],'release').exists() and time.monotonic()<end:time.sleep(.01)"
        process=subprocess.Popen([sys.executable,'-c',code])
        try:
            deadline=time.monotonic()+5
            while not ready.exists() and time.monotonic()<deadline:time.sleep(.01)
            self.assertTrue(ready.exists())
            with self.assertRaises(store.CacheBusy):
                with store.writer_lock(wait_seconds=.02):self.fail('Other publisher must hold the lock')
        finally:release.touch();process.wait(timeout=5)

    def test_migration_is_explicit_validated_and_does_not_modify_original_flat_files(self):
        path=self.root/'recipe_ids.pkl';path.write_bytes(pickle.dumps(['public','now-private']))
        matrix=self.root/'recipe_embeddings.pt';torch.save(torch.ones((2,384)),matrix)
        before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [path,matrix]}
        self.assertEqual([],embed.load_embeddings()[0])
        with patch.object(embed,'public_ids',return_value={'public'}):
            with self.assertRaises(store.CacheInvalid):embed.migrate_legacy(expected_count=2)
            self.assertIsNone(store.generation_name())
            result=embed.migrate_legacy(expected_count=1)
        self.assertEqual(1,result['count']);self.assertEqual(['public'],embed.load_embeddings()[0])
        self.assertEqual(before,{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [path,matrix]})
        with self.assertRaises(store.CacheInvalid):embed.migrate_legacy()

    def test_incomplete_or_duplicate_legacy_files_never_publish(self):
        (self.root/'recipe_ids.pkl').write_bytes(pickle.dumps(['same','same']))
        torch.save(torch.ones((2,384)),self.root/'recipe_embeddings.pt')
        with self.assertRaises(store.CacheInvalid):embed.migrate_legacy()
        self.assertIsNone(store.generation_name())

    def test_private_transition_evicts_current_generation_before_reader_returns(self):
        embed.save_embeddings(torch.ones((2,384)),['still-public','now-private'])
        cache=RecipeCache()
        try:
            with patch('src.local_ai.public_catalog_ids',return_value={'still-public'}):ids,matrix=cache.get_data()
            self.assertEqual(['still-public'],ids);self.assertEqual((1,384),tuple(matrix.shape))
            self.assertEqual(['still-public'],embed.load_embeddings()[0])
        finally:cache.shutdown()

    def test_add_checks_public_permission_again_after_model_encode(self):
        embed.save_embeddings(torch.ones((1,384)),['old'])
        with patch.object(embed,'public_ids',side_effect=[{'old','new'},{'old'}]),patch.object(embed,'embed_texts',return_value=torch.ones((1,384))):
            with self.assertRaises(ValueError):embed.append_embedding('new','Previously public source')
        self.assertEqual(['old'],embed.load_embeddings()[0])

    def test_every_legacy_export_and_single_recipe_source_use_current_public_demo_clause(self):
        self.assertIn('WHERE '+public_catalog_clause(),QUERY)
        cache=RecipeCache();engine=MagicMock()
        import pandas as pd
        try:
            with patch('src.cache_manager.get_engine',return_value=engine),patch('src.cache_manager.pd.read_sql',return_value=pd.DataFrame()) as query:
                with self.assertRaises(ValueError):cache.add_recipe_to_cache('revoked')
                actual=str(query.call_args.args[0])
            self.assertIn('r.id = :recipe_id AND '+public_catalog_clause(),actual)
            self.assertEqual([],embed.load_embeddings()[0])
        finally:cache.shutdown()

    def test_missing_pinned_model_never_invokes_downloader(self):
        embed.get_model.cache_clear()
        with patch.dict(os.environ,{'HF_HOME':str(self.root/'absent')}),patch('sentence_transformers.SentenceTransformer') as constructor:
            with self.assertRaises(store.ModelUnavailable):embed.get_model()
            constructor.assert_not_called()

    def test_revision_mismatch_is_rejected_even_with_valid_tensor_checksums(self):
        name=embed.save_embeddings(torch.ones((1,384)),['source'])
        path=store.directory()/name/'manifest.json';manifest=json.loads(path.read_text());manifest['encoder']['revision']='0'*40
        path.chmod(0o600);path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(store.CacheInvalid,'revision mismatch'):embed.load_embeddings()

    def test_bad_pointer_keeps_process_cache_constructible_but_fails_readers_closed(self):
        root=store.directory();root.mkdir();(root/'CURRENT').write_text('../untrusted')
        cache=RecipeCache()
        try:
            self.assertEqual('CacheInvalid',cache.get_cache_info()['generation_error'])
            with self.assertRaises(store.CacheInvalid):cache.get_data()
        finally:cache.shutdown()

    def test_failed_rebuild_preserves_usable_old_generation_and_records_safe_error_type(self):
        embed.save_embeddings(torch.ones((1,384)),['public'])
        cache=RecipeCache()
        try:
            with patch.object(cache,'_rebuild_embeddings',side_effect=RuntimeError('secret-db-url')):
                cache.force_reload()
                deadline=time.monotonic()+5
                while cache._rebuild_lock.locked() and time.monotonic()<deadline:time.sleep(.01)
            self.assertEqual('failed',cache.get_rebuild_status()['status'])
            self.assertEqual('RuntimeError',cache.get_rebuild_status()['error'])
            with patch('src.local_ai.public_catalog_ids',return_value={'public'}):self.assertEqual(['public'],cache.get_data()[0])
        finally:cache.shutdown()

    def test_two_cache_instances_share_rebuild_single_flight_on_the_volume(self):
        first=RecipeCache();second=RecipeCache();started=threading.Event();finish=threading.Event()
        def rebuild():started.set();self.assertTrue(finish.wait(5))
        try:
            with patch.object(first,'_rebuild_embeddings',side_effect=rebuild):
                self.assertTrue(first.force_reload());self.assertTrue(started.wait(5))
                self.assertFalse(second.force_reload())
                finish.set()
                deadline=time.monotonic()+5
                while first._rebuild_lock.locked() and time.monotonic()<deadline:time.sleep(.01)
        finally:finish.set();first.shutdown();second.shutdown()

    def test_existing_source_edit_replaces_vector_without_duplicate_id(self):
        embed.save_embeddings(torch.ones((1,384)),['source'])
        with patch.object(embed,'public_ids',return_value={'source'}),patch.object(embed,'embed_texts',return_value=torch.full((1,384),2.)):
            embed.append_embedding('source','Updated source recipe')
        ids,matrix=embed.load_embeddings();self.assertEqual(['source'],ids);self.assertTrue(torch.equal(matrix,torch.full((1,384),2.)))

    def test_missing_legacy_seed_model_cannot_turn_into_successful_empty_recommendations(self):
        from src import recommend
        cache=MagicMock();cache.get_snapshot.return_value=([],torch.empty((0,384)))
        for failure in [store.ModelUnavailable('offline'),store.CacheBusy('busy'),store.CacheInvalid('invalid')]:
            cache.add_recipe_to_cache.side_effect=failure
            with patch.object(recommend,'get_cache',return_value=cache),patch.object(recommend,'public_catalog_ids',return_value={'seed','candidate'}):
                with self.assertRaises(type(failure)):recommend._legacy_recommend_for_user(['seed'],[],eligible_ids={'candidate'})

    def test_model_constructor_is_bound_to_local_pinned_snapshot(self):
        embed.get_model.cache_clear()
        with patch.dict(os.environ,{'HF_HOME':str(self.root/'hf')}):
            path=embed.local_model_snapshot();path.mkdir(parents=True)
            for name in ['config.json','modules.json','model.safetensors']:(path/name).touch()
            with patch('sentence_transformers.SentenceTransformer') as constructor:embed.get_model()
            self.assertEqual(str(path),constructor.call_args.args[0]);self.assertTrue(constructor.call_args.kwargs['local_files_only'])
        embed.get_model.cache_clear()


if __name__=='__main__':unittest.main()
