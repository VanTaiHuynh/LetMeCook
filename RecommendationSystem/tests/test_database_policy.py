"""Pool/statement limits apply before querying, without leaking database errors."""
import importlib
import os
import unittest
from unittest.mock import MagicMock,patch
from sqlalchemy.exc import OperationalError
from src import database


class DatabasePolicyTests(unittest.TestCase):
    def test_default_pool_has_no_overflow_and_committed_statement_deadline(self):
        engine=MagicMock();connection=MagicMock()
        with patch.object(database,'create_engine',return_value=engine) as create,patch.object(database.event,'listen') as listen:
            self.assertIs(engine,database.get_engine())
        self.assertEqual(0,create.call_args.kwargs['max_overflow']);self.assertEqual(5,create.call_args.kwargs['pool_size'])
        self.assertEqual(5,create.call_args.kwargs['pool_timeout']);self.assertEqual(15,create.call_args.kwargs['connect_args']['timeout'])
        next(call.args[2] for call in listen.call_args_list if call.args[1]=='connect')(connection,None)
        connection.cursor.return_value.execute.assert_called_once_with('SET statement_timeout = 30000')
        connection.commit.assert_called_once();connection.cursor.return_value.close.assert_called_once()

    def test_invalid_or_unbounded_pool_settings_fail_before_connecting(self):
        for key,value in [('RECOMMENDATION_DB_POOL_SIZE','0'),('RECOMMENDATION_DB_POOL_SIZE','100'),
                          ('RECOMMENDATION_DB_QUERY_SECONDS','unlimited'),('RECOMMENDATION_DB_CONNECT_SECONDS','99')]:
            with patch.dict(os.environ,{key:value}),patch.object(database,'create_engine') as create:
                with self.assertRaises(ValueError):database.get_engine()
                create.assert_not_called()

    def test_database_exception_is503_with_static_message_without_sql_or_identity(self):
        with patch('src.cache_manager.get_cache',return_value=MagicMock()),patch('signal.signal'),patch('atexit.register'):
            module=importlib.import_module('app')
        identifier='00000000-0000-0000-0000-000000000001'
        error=OperationalError('SELECT private_parameter',{'password':'do-not-emit'},RuntimeError('secret'))
        with patch.object(module,'recommend_for_user',side_effect=error):
            response=module.app.test_client().post('/recommend/user',json={
                'favorites':[],'history':[],'eligibleIds':[identifier],'excludedIds':[],'dietaryPreferences':[],'topK':10})
        self.assertEqual(503,response.status_code)
        for value in ['private_parameter','do-not-emit','secret']:self.assertNotIn(value,response.get_data(as_text=True))


if __name__=='__main__':unittest.main()
