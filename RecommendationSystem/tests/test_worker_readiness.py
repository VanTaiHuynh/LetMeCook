"""Cheap liveness, independent capability availability and enforced queue ownership."""
import importlib
import os
from pathlib import Path
import subprocess
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock,patch
from src import readiness,legacy_cache_store as store


class ReadinessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch('src.cache_manager.get_cache',return_value=MagicMock()),patch('signal.signal'),patch('atexit.register'):
            cls.module=importlib.import_module('app')
        cls.client=cls.module.app.test_client()

    def test_liveness_does_not_copy_embeddings_probe_db_or_call_model(self):
        with patch.object(self.module,'get_recommendation_stats',side_effect=AssertionError('Expensive stats')),patch.object(readiness,'ready',side_effect=AssertionError('No dependencies')),patch.object(readiness,'status',side_effect=AssertionError('No model probes')):
            for path in ['/', '/health/live']:
                response=self.client.get(path)
                self.assertEqual(200,response.status_code);self.assertEqual({'local':True,'status':'alive'},response.json)

    def test_unavailable_capability_is503_and_unknown_capability_is400(self):
        with patch.object(readiness,'ready',return_value={'capability':'recommendation','status':'unavailable','reason':'catalog_unavailable'}) as probe:
            response=self.client.get('/health/ready');self.assertEqual(503,response.status_code)
            response=self.client.get('/health/ready?capability=unsupported');self.assertEqual(400,response.status_code)
            probe.assert_called_once_with('recommendation')

    def test_text_is_ready_even_if_vision_is_missing_and_without_catalog_call(self):
        with patch.object(readiness,'models_probe',return_value={'text':{'status':'ready'},'vision':{'status':'unavailable'}}),patch.object(readiness,'catalog_probe',side_effect=AssertionError('Text does not require DB')):
            response=self.client.get('/health/ready?capability=text');self.assertEqual(200,response.status_code)
            response=self.client.get('/health/ready?capability=vision');self.assertEqual(503,response.status_code)

    def test_recommendations_require_both_an_index_and_current_database_access(self):
        with patch.object(readiness,'recommendation_probe',return_value={'status':'ready','engine':'hybrid-v2'}),patch.object(readiness,'catalog_probe',return_value={'status':'unavailable'}):
            self.assertEqual('unavailable',readiness.ready()['status'])

    def test_catalog_probe_has_connect_statement_deadlines_and_pool_free_cleanup(self):
        source=MagicMock();engine=MagicMock();connection=engine.begin.return_value.__enter__.return_value
        connection.execute.return_value.scalar.return_value=1
        with patch.object(readiness,'get_engine',return_value=source),patch.object(readiness,'create_engine',return_value=engine) as create:
            result=readiness.catalog_probe()
        self.assertEqual('ready',result['status']);self.assertEqual({'timeout':2},create.call_args.kwargs['connect_args'])
        self.assertIn('2000ms',str(connection.execute.call_args_list[0].args[0]))
        self.assertEqual('SELECT 1',str(connection.execute.call_args_list[1].args[0]))
        source.dispose.assert_called_once();engine.dispose.assert_called_once()

    def test_catalog_failure_does_not_return_connection_exception_or_credentials(self):
        with patch.object(readiness,'get_engine',side_effect=RuntimeError('secret-database-url')):
            result=readiness.catalog_probe()
        self.assertEqual({'status':'unavailable','reason':'catalog_unavailable'},result)
        self.assertNotIn('secret',str(result))

    def test_embedding_busy_is429_retry_after_and_missing_model_is503(self):
        identifier=str(uuid.uuid4())
        for exception,status in [(store.CacheBusy('busy'),429),(store.ModelUnavailable('missing'),503),(store.CacheInvalid('bad checksum'),503)]:
            with patch.object(self.module.cache,'add_recipe_to_cache',side_effect=exception):
                response=self.client.post('/embedding/add',json={'id':identifier})
            self.assertEqual(status,response.status_code)
            if status==429:self.assertEqual('10',response.headers['Retry-After'])

    def test_bad_embedding_uuid_or_unbounded_remove_does_not_publish(self):
        with patch.object(self.module.cache,'add_recipe_to_cache') as add,patch.object(self.module.cache,'remove_recipes_from_cache') as remove:
            self.assertEqual(400,self.client.post('/embedding/add',json={'id':'invalid'}).status_code)
            self.assertEqual(400,self.client.post('/embedding/remove',json={'ids':[str(uuid.uuid4())]*5001}).status_code)
            add.assert_not_called();remove.assert_not_called()

    def test_legacy_recommendation_endpoints_preserve_unavailable_and_busy_statuses(self):
        identifier=str(uuid.uuid4())
        for name,path,exception,status in [
            ('recommend_by_id','/recommend/id?recipeId='+identifier,store.ModelUnavailable('offline'),503),
            ('recommend_for_user','/recommend/user?favorites='+identifier,store.CacheBusy('busy'),429)]:
            with patch.object(self.module,name,side_effect=exception):response=self.client.get(path)
            self.assertEqual(status,response.status_code)
            if status==429:self.assertEqual('10',response.headers['Retry-After'])

    def test_launcher_and_gunicorn_hook_reject_more_than_one_process(self):
        path=Path(__file__).resolve().parents[1]
        result=subprocess.run(['bash',str(path/'run_gunicorn.sh')],env={**os.environ,'RECOMMENDATION_WORKERS':'2'},capture_output=True,text=True,timeout=5)
        self.assertEqual(64,result.returncode)
        spec=importlib.util.spec_from_file_location('worker_configuration',path/'gunicorn.conf.py')
        config=importlib.util.module_from_spec(spec);spec.loader.exec_module(config)
        with self.assertRaises(RuntimeError):config.on_starting(SimpleNamespace(cfg=SimpleNamespace(workers=2)))
        config.on_starting(SimpleNamespace(cfg=SimpleNamespace(workers=1)))


if __name__=='__main__':unittest.main()
