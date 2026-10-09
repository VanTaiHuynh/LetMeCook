"""Versioned boundaries, cancellation, clarification, taste and reuse regressions."""
import base64
import io
import json
import os
import tempfile
import threading
import time
import unittest
import uuid
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock,patch

import numpy as np
from src import local_ai as ai,ai_transport as transport,request_context as context
from src import intent_clarification as clarification,meal_planner as planner
from src import local_voice,step_audio_cache,artifact_lineage,leftover_planning
from src.ai_contracts import SearchIntent,TasteContext
from src.inference_queue import InferenceQueue


def intent(**values):
    return {**planner.empty_intent(),**values}


def wav():
    output=io.BytesIO()
    with wave.open(output,'wb') as handle:
        handle.setnchannels(1);handle.setsampwidth(2);handle.setframerate(16000)
        handle.writeframes(b'\0\0'*3200)
    return output.getvalue()


class VersionedIntentTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{'MEAL_PLANNER_SIGNING_KEY':'authored-test-key-'*3});self.env.start();self.addCleanup(self.env.stop)

    def test_immutable_intent_rejects_unknown_fields_and_boolean_time(self):
        for value in (intent(unknown='x'),intent(maxCookingTime=True),intent(dietaryPreferences=['keto'])):
            with self.assertRaises(ai.AIError):SearchIntent.from_mapping(value)
        value=SearchIntent.from_mapping(intent(ingredients=['nấm']))
        self.assertEqual(['mushroom'],value.to_dict()['ingredients'])
        with self.assertRaises(TypeError):value.lists['ingredients']=('peanut',)

    def test_explicit_en_vi_exclusions_survive_model_omission(self):
        for prompt in ('Dinner with mushrooms without peanuts or milk under 30 minutes.','Món chay với nấm, không có đậu phộng hoặc sữa trong 30 phút.'):
            with patch.object(ai,'_chat',return_value=intent(ingredients=['mushroom'])):
                result=ai.parse_intent(prompt)
            self.assertEqual(['peanut','dairy' if 'không' in prompt else 'milk'],result['allergies'])
            self.assertEqual(30,result['maxCookingTime'])
        self.assertEqual(['vegetarian'],result['dietaryPreferences'])

    def test_contradiction_returns_questions_not_false_zero_matches(self):
        with patch.object(ai,'_chat',return_value=intent(ingredients=['chicken'],allergies=['peanut'],dietaryPreferences=['vegetarian'])),patch.object(ai,'_db',side_effect=AssertionError('No catalog query before clarification')):
            result=ai.search('A vegetarian meal with chicken, without peanuts.')
        self.assertEqual('needs_clarification',result['status'])
        self.assertLessEqual(len(result['clarification']['questions']),2)
        self.assertEqual(['peanut'],result['intent']['allergies'])

    def test_ambiguous_healthy_prompt_asks_bounded_specific_question(self):
        with patch.object(ai,'_chat',return_value=intent(keyword='healthy')):
            result=ai.search('Something healthy please')
        self.assertEqual('needs_clarification',result['status']);self.assertEqual(1,len(result['clarification']['questions']))

    def test_signed_resume_preserves_exclusions_diets_time_other_positive_ingredients(self):
        original=intent(ingredients=['chicken','mushroom'],allergies=['peanut'],dietaryPreferences=['vegetarian'],categories=['dinner'],maxCookingTime=30)
        response=clarification.response('original',original,clarification.reasons('original',original))
        saved,combined=clarification.resume('original',response['clarification']['context'],{'diet_conflict':'Remove chicken; use tofu.'})
        self.assertIn('Remove chicken',combined)
        merged=clarification.preserve(saved,intent(ingredients=['tofu'],maxCookingTime=60))
        self.assertEqual(['mushroom','tofu'],merged['ingredients']);self.assertEqual(['peanut'],merged['allergies'])
        self.assertEqual(['vegetarian'],merged['dietaryPreferences']);self.assertEqual(['dinner'],merged['categories']);self.assertEqual(30,merged['maxCookingTime'])

    def test_changed_context_expiry_and_more_than_two_answers_fail(self):
        original=intent(ingredients=['peanut'],allergies=['peanut'])
        response=clarification.response('original',original,clarification.reasons('original',original))
        signed=response['clarification']['context'];tampered=json.loads(json.dumps(signed));tampered['originalIntent']['allergies']=[]
        for ctx,answers,prompt in ((tampered,{'ingredient_conflict':'Remove peanut'},'original'),(signed,{'ingredient_conflict':'Remove peanut','extra':'x'},'original'),(signed,{'ingredient_conflict':'Remove peanut'},'edited')):
            with self.assertRaises(ai.AIError):clarification.resume(prompt,ctx,answers)
        with patch.object(clarification.time,'time',return_value=signed['issuedAt']+901):
            with self.assertRaises(ai.AIError):clarification.resume('original',signed,{'ingredient_conflict':'Remove peanut'})

    def test_unknown_diet_is_not_lost_when_model_omits_it(self):
        with patch.object(ai,'_chat',return_value=intent(ingredients=['tofu'])):
            with self.assertRaises(ai.AIError) as error:ai.parse_intent('A keto dinner with tofu')
        self.assertEqual(422,error.exception.status)

    def test_negation_stops_before_positive_clause_and_no_allergies_is_not_a_food(self):
        for prompt in ('Without peanuts and use mushrooms. No allergies.','Không có đậu phộng và thêm nấm.'):
            with patch.object(ai,'_chat',return_value=intent(ingredients=['mushroom'])):
                result=ai.parse_intent(prompt)
            self.assertEqual(['peanut'],result['allergies'])
            self.assertEqual(['mushroom'],result['ingredients'])

    def test_signed_long_original_can_be_answered_without_truncating_constraints(self):
        original=intent(ingredients=['chicken'],allergies=['peanut'],dietaryPreferences=['vegetarian'])
        prompt='A vegetarian dinner without peanuts. '+('Detailed request. '*110)
        response=clarification.response(prompt,original,clarification.reasons(prompt,original))
        saved,combined=clarification.resume(prompt,response['clarification']['context'],{'diet_conflict':'Remove chicken; use tofu and mushrooms instead.'})
        self.assertGreater(len(combined),2000)
        with patch.object(ai,'_chat',return_value=intent(ingredients=['tofu','mushroom'])):
            parsed=ai.parse_intent(combined,clarified=True)
            with self.assertRaises(ai.AIError):ai.parse_intent(combined)
        self.assertEqual(['peanut'],clarification.preserve(saved,parsed)['allergies'])


class CancellationTransportTests(unittest.TestCase):
    def test_deadline_and_cancel_are_distinct_and_registry_always_cleans_up(self):
        identifier=str(uuid.uuid4());token='a'*48
        closed=[]
        with self.assertRaises(context.RequestStopped) as stopped:
            with context.request_scope(1000,identifier,token) as active:
                with self.assertRaises(ai.AIError) as wrong:context.cancel(identifier,'b'*48)
                self.assertEqual(403,wrong.exception.status)
                with context.interruptible(lambda:closed.append(True)):
                    self.assertTrue(context.cancel(identifier,token)['cancelled'])
                    context.checkpoint()
        self.assertEqual(499,stopped.exception.status)
        self.assertEqual([True],closed)
        self.assertFalse(context.cancel(identifier,token)['cancelled'])

    def test_monotonic_deadline_yields_504_without_wall_clock_dependency(self):
        with patch.object(context.time,'monotonic',return_value=1):
            scope=context.request_scope(1000);scope.__enter__()
        try:
            with patch.object(context.time,'monotonic',return_value=2.1):
                with self.assertRaises(context.RequestStopped) as error:context.checkpoint()
                self.assertEqual('deadline_exceeded',error.exception.code);self.assertEqual(504,error.exception.status)
        finally:scope.__exit__(Exception,Exception(),None)

    def test_exact_model_digest_mismatch_and_missing_pin_are_unavailable(self):
        pin='a'*64;tags={'models':[{'name':ai.TEXT_MODEL,'digest':'sha256:'+pin}]}
        with patch.dict(os.environ,{'LOCAL_AI_TEXT_DIGEST':pin}):
            self.assertEqual(pin,transport.model_pin(ai.TEXT_MODEL,tags)['digest'])
            with self.assertRaises(ai.AIError):transport.model_pin(ai.TEXT_MODEL,{'models':[{'name':ai.TEXT_MODEL,'digest':'b'*64}]})
        with patch.dict(os.environ,{'LOCAL_AI_TEXT_DIGEST':''}):
            with self.assertRaises(ai.AIError):transport.model_pin(ai.TEXT_MODEL,tags)

    def test_streaming_structured_response_assembles_only_complete_chunks(self):
        response=MagicMock();response.__enter__.return_value=response
        response.__iter__.return_value=iter([json.dumps({'message':{'content':'{"keyword":'}}).encode()+b'\n',json.dumps({'message':{'content':'"rice"}'},'done':True}).encode()+b'\n'])
        with patch.object(transport.urllib.request,'urlopen',return_value=response):
            result=transport.ollama('/api/chat',{'stream':True})
        self.assertEqual({'keyword':'rice'},json.loads(result['message']['content']))
        response.__iter__.return_value=iter([b'{"message":{"content":"partial"}}\n'])
        with patch.object(transport.urllib.request,'urlopen',return_value=response):
            with self.assertRaises(ai.AIError) as error:transport.ollama('/api/chat',{'stream':True})
        self.assertEqual(502,error.exception.status)

    def test_outer_cpu_admission_reenters_model_once_without_self_deadlock(self):
        queue=InferenceQueue(capacity=1,burst=1)
        with queue.slot('plan',rate_limit=False,reentrant=True):
            with queue.slot('text'):self.assertEqual('plan',queue.status()['active'])
            with queue.slot('text'):pass
        self.assertEqual(1,queue.status()['completed']);self.assertIsNone(queue.status()['active'])

    def test_cancelled_waiter_leaves_no_queued_work_or_admission_leak(self):
        queue=InferenceQueue(capacity=2,wait_seconds=25);identifier=str(uuid.uuid4());token='q'*48
        registered=threading.Event();result=[]
        def waiter():
            try:
                with context.request_scope(10000,identifier,token):
                    registered.set()
                    with queue.slot('plan'):result.append('must not run')
            except context.RequestStopped as error:result.append(error.status)
        with queue.slot('cook'):
            thread=threading.Thread(target=waiter);thread.start();self.assertTrue(registered.wait(1))
            context.cancel(identifier,token);thread.join(1)
            self.assertFalse(thread.is_alive());self.assertEqual(0,queue.status()['queued'])
        self.assertEqual([499],result)

    def test_database_query_uses_remaining_request_deadline(self):
        from src import database
        engine=MagicMock()
        with patch.object(database,'create_engine',return_value=engine),patch.object(database.event,'listen') as listen:
            database.get_engine()
        before=next(call.args[2] for call in listen.call_args_list if call.args[1]=='before_cursor_execute')
        cursor=MagicMock()
        with context.request_scope(1000):before(None,cursor,'SELECT 1',{},None,False)
        statement=cursor.execute.call_args.args[0]
        self.assertTrue(statement.startswith('SET LOCAL statement_timeout = '));self.assertLessEqual(int(statement.rsplit(' ',1)[1]),1000)

    def test_http_response_cannot_claim_success_after_its_deadline(self):
        import importlib
        with patch('src.cache_manager.get_cache',return_value=MagicMock()),patch('signal.signal'),patch('atexit.register'):
            module=importlib.import_module('app')
        def delayed(*args,**kwargs):
            context.current().deadline=time.monotonic()-1
            return []
        with patch.object(module,'recommend_for_user',side_effect=delayed):
            response=module.app.test_client().post('/recommend/user',json={'favorites':[],'history':[],'eligibleIds':[],'excludedIds':[],'dietaryPreferences':[],'topK':10})
        self.assertEqual(504,response.status_code);self.assertEqual('deadline_exceeded',response.json['code'])


class GrowthBoundaryTests(unittest.TestCase):
    def test_taste_feedback_is_real_bounded_rating_not_an_allergy(self):
        value=TasteContext.from_mapping({'tasteSignals':{'avoidedIngredients':['peanuts']},'tasteFeedback':[{'recipeId':str(uuid.UUID(int=1)),'rating':1}]})
        self.assertEqual(['peanut'],value.to_preferences()['avoidedIngredients'])
        for rating in (True,0,6,float('nan')):
            with self.assertRaises(ai.AIError):TasteContext.from_mapping({'tasteFeedback':[{'recipeId':str(uuid.UUID(int=1)),'rating':rating}]})

    def test_negative_rating_and_soft_ingredient_dislike_rerank_before_mmr(self):
        from src.hybrid_ranking import HybridRanker
        ids=tuple(str(uuid.UUID(int=n)) for n in (1,2,3));vectors=np.zeros((3,1024),dtype=np.float32)
        vectors[0,0]=vectors[1,0]=vectors[2,1]=1
        snapshot=SimpleNamespace(recipe_ids=ids,id_to_row={key:i for i,key in enumerate(ids)},embeddings=vectors,documents={key:{'title':'Rice','ingredients':['peanut'] if key==ids[1] else ['rice']} for key in ids})
        snapshot.dense_search=lambda vector,allowed,limit:[(key,float(vectors[snapshot.id_to_row[key]]@vector)) for key in sorted(allowed)]
        ranker=HybridRanker(snapshot)
        result=ranker.rank_for_user([],[],{ids[1],ids[2]},visible_seed_ids=set(ids),preferences={'tasteFeedback':[{'recipeId':ids[0],'rating':1}],'avoidedIngredients':['peanut']},top_k=2)
        self.assertEqual(ids[2],result.recommendations[0][0]);self.assertEqual(set(ids[1:]),{item[0] for item in result.recommendations})

    def test_family_restrictions_survive_solo_profile_opt_out(self):
        settings={'useProfile':False,'useHouseholdPreferences':True,'maxCookTime':45,'dietaryPreferences':[],'excludedIngredients':[]}
        profile={'usedProfile':True,'allergies':['milk'],'householdRestrictions':{'allergies':['peanut'],'dietaryPreferences':['vegetarian']}}
        result,*_=planner.effective_constraints(intent(),settings,profile)
        self.assertEqual(['peanut'],result['allergies']);self.assertEqual(['vegetarian'],result['dietaryPreferences'])
        settings['useHouseholdPreferences']=False;result,*_=planner.effective_constraints(intent(),settings,profile)
        self.assertEqual([],result['allergies'])

    def test_pantry_suggestions_forward_explicit_family_restrictions_before_eligibility(self):
        from src import pantry
        profile={'usedProfile':False,'householdRestrictions':{'allergies':['peanut'],'dietaryPreferences':['vegetarian']}}
        with patch.object(planner,'eligible_recipes',return_value=[]) as eligible:
            pantry.suggest({'useHouseholdPreferences':True,'profile':profile})
        captured=eligible.call_args.args[0]
        self.assertEqual(['peanut'],captured['allergies']);self.assertEqual(['vegetarian'],captured['dietaryPreferences'])

    def test_confirmed_leftover_portions_allocate_without_double_debit(self):
        from datetime import date
        identifier=str(uuid.UUID(int=1));recipe=str(uuid.UUID(int=2))
        profile={'confirmedLeftovers':[{'id':identifier,'version':2,'recipeId':recipe,'servingsAvailable':4,'confirmedAt':'2026-10-08T12:00:00Z','cookedOn':'2026-10-08','useBy':'2026-10-10'}]}
        selected,reuse=leftover_planning.allocate(profile,date(2026,10,8),2,[{'id':recipe}],7)
        self.assertEqual(2,len(selected));self.assertEqual(4,sum(item['servingsUsed'] for item in reuse.values()))
        self.assertEqual([],planner.shopping_list([{'recipe':{'id':recipe},'reuse':reuse[0]}],2))
        with self.assertRaises(ai.AIError):leftover_planning.validate_selected(profile,date(2026,10,8),2,[{'dayIndex':0,'recipeId':recipe,'leftoverId':identifier,'leftoverVersion':1}])

    def test_unknown_leftover_expiry_never_becomes_inferred_shelf_life(self):
        profile={'confirmedLeftovers':[{'id':str(uuid.UUID(int=1)),'version':1,'recipeId':str(uuid.UUID(int=2)),'servingsAvailable':2,'confirmedAt':'2026-10-08T12:00:00Z','cookedOn':'2026-10-08','useBy':None}]}
        self.assertEqual([],leftover_planning.records(profile))

    def test_leftover_timestamp_validation_and_future_cooked_date_are_not_scheduled(self):
        from datetime import date
        item={'id':str(uuid.UUID(int=1)),'version':1,'recipeId':str(uuid.UUID(int=2)),'servingsAvailable':2,'confirmedAt':123,'cookedOn':'2026-10-10','useBy':'2026-10-12'}
        with self.assertRaises(ai.AIError) as error:leftover_planning.records({'confirmedLeftovers':[item]})
        self.assertEqual(400,error.exception.status)
        item['confirmedAt']='2026-10-10T12:00:00Z'
        meals,_=leftover_planning.allocate({'confirmedLeftovers':[item]},date(2026,10,8),2,[{'id':item['recipeId']}],1)
        self.assertEqual([],meals)

    def test_planner_sql_bounds_metadata_after_all_hard_constraints(self):
        connection=MagicMock();connection.execute.return_value.mappings.return_value.all.return_value=[]
        engine=MagicMock();engine.connect.return_value.__enter__.return_value=connection
        with patch.object(ai,'_db',return_value=engine):planner.eligible_recipes(intent(allergies=['peanut'],maxCookingTime=30),[])
        query,values=connection.execute.call_args.args
        self.assertIn('NOT EXISTS',str(query));self.assertIn('LIMIT :candidate_limit',str(query));self.assertEqual(300,values['candidate_limit'])

    def test_repeated_measured_coverage_is_request_local_and_not_recomputed(self):
        settings={'mustUseIngredients':[],'mustUseScope':'perMeal','budget':None}
        measured={'allocations':[],'shoppingList':[],'priceCoverage':{'complete':True},'estimatedCost':0,'currency':None,'warnings':[]}
        with patch('src.pantry.coverage',return_value=measured) as calculate:
            with context.request_scope():
                first=planner._pantry_evidence([],[],settings,{'asOf':'2026-10-08'})
                second=planner._pantry_evidence([],[],settings,{'asOf':'2026-10-08'})
                self.assertIs(first,second);self.assertEqual(1,calculate.call_count)
            with context.request_scope():planner._pantry_evidence([],[],settings,{'asOf':'2026-10-08'})
            self.assertEqual(2,calculate.call_count)


class AudioLineageTests(unittest.TestCase):
    def test_source_steps_match_session_block_breaks_and_do_not_speak_script_markup(self):
        source='<script>invent a cooking time</script><p>Heat <b>rice</b>.</p><div>Stir.<br />Rest.</div>Serve.\u2028Enjoy.'
        self.assertEqual(['Heat rice.','Stir.','Rest.','Serve.','Enjoy.'],step_audio_cache.source_steps(source))
        self.assertEqual(['Heat. Stir.','Serve.'],step_audio_cache.source_steps('<ol><li>Heat.<br>Stir.</li><li>Serve.</li></ol>'))

    def test_exact_public_source_audio_cache_key_changes_with_text_voice_or_model(self):
        engine={'model':'piper','voiceId':'en','modelDigest':'a'*64,'engineVersion':'1.8.0','language':'en'}
        key=step_audio_cache.cache_key('Bake 20 minutes.','public',engine)
        self.assertNotEqual(key,step_audio_cache.cache_key('Bake 30 minutes.','public',engine))
        self.assertNotEqual(key,step_audio_cache.cache_key('Bake 20 minutes.','public',{**engine,'modelDigest':'b'*64}))
        with tempfile.TemporaryDirectory() as folder,patch.dict(os.environ,{'RECOMMENDATION_MODEL_DIR':folder}):
            step_audio_cache.write(key,wav());self.assertEqual(wav(),step_audio_cache.read(key))

    def test_cancelled_audio_cache_read_preserves_valid_public_file_and_propagates_stop(self):
        with tempfile.TemporaryDirectory() as folder,patch.dict(os.environ,{'RECOMMENDATION_MODEL_DIR':folder}):
            key='a'*64;step_audio_cache.write(key,wav())
            with patch.object(step_audio_cache,'checkpoint',side_effect=context.RequestStopped(True)):
                with self.assertRaises(context.RequestStopped):step_audio_cache.read(key)
            self.assertTrue((step_audio_cache.directory()/(key+'.wav')).is_file())

    def test_private_or_unverified_recipe_step_does_not_qualify_for_disk_cache(self):
        connection=MagicMock();connection.execute.return_value.scalar.return_value=None
        engine=MagicMock();engine.connect.return_value.__enter__.return_value=connection
        with patch.object(ai,'_db',return_value=engine):
            self.assertIsNone(step_audio_cache.verified_source({'cachePublicSource':True,'sourceRecipeId':str(uuid.UUID(int=1)),'sourceStepIndex':0},'Private step.'))
        self.assertIn(ai.public_catalog_clause(),str(connection.execute.call_args.args[0]))
        with patch.object(ai,'_db',side_effect=AssertionError('Generic speech needs no catalog')):
            self.assertIsNone(step_audio_cache.verified_source({'text':'private question'},'private question'))

    def test_piper_selection_and_ephemeral_generic_text_preserve_response_contract(self):
        from src import piper_runtime
        state={'status':'ready','version':'1.8.0','voiceId':'en_US-ljspeech-medium','modelDigest':'a'*64}
        result={'rawBytes':wav(),'voiceId':state['voiceId'],'modelDigest':state['modelDigest'],'engineVersion':'1.8.0'}
        with patch.dict(os.environ,{'LOCAL_TTS_ENGINE':'piper'}),patch.object(piper_runtime,'status',return_value=state),patch.object(piper_runtime,'synthesize',return_value=result),patch.object(step_audio_cache,'write',side_effect=AssertionError('Private text must not persist')):
            response=local_voice.speak({'text':'Read my private note.'})
        self.assertEqual('piper',response['model']);self.assertEqual('ephemeral',response['cachePolicy']);self.assertFalse(response['cached']);self.assertEqual(wav(),base64.b64decode(response['audioBase64']))

    def test_new_semantic_lineage_tracks_input_change_and_unknown_history_honestly(self):
        first=artifact_lineage.input_lineage(['one'],['Rice with mushrooms'])
        second=artifact_lineage.input_lineage(['one'],['Rice without mushrooms'])
        self.assertNotEqual(first['dataset']['semanticInputSha256'],second['dataset']['semanticInputSha256'])
        self.assertTrue(first['historicalInputsKnown']);self.assertFalse(artifact_lineage.unknown_lineage(['one'])['historicalInputsKnown'])

    def test_future_preprocessing_does_not_fabricate_unknown_yield_or_time(self):
        from src.clean_data import combine_fields
        value=combine_fields({'title':'Soup','servings':0,'time':0})
        self.assertIn('source servings not specified',value)
        self.assertIn('source cooking time not specified',value)
        self.assertNotIn('serves 1',value)

    def test_incremental_lineage_preserves_old_known_inputs_without_inventing_missing_ones(self):
        previous=artifact_lineage.unknown_lineage(['old'])
        updated=artifact_lineage.incremental_lineage(previous,['old','new'],{'new':'Actual new embedding text'})
        self.assertFalse(updated['historicalInputsKnown'])
        self.assertEqual(['new'],[row['id'] for row in updated['dataset']['knownInputs']])


class CanonicalReuseTests(unittest.TestCase):
    def test_generate_and_recalculate_reuse_slots_preserve_cas_and_no_raw_demand(self):
        ids=[str(uuid.UUID(int=n)) for n in (1,2,3)]
        lot=str(uuid.UUID(int=9))
        rows=[{'id':key,'title':'Dinner '+str(n),'description':'','image_url':'/recipe-images/'+key+'.jpg','time':20,'servings':2,'source_url':'https://source.example/recipe'} for n,key in enumerate(ids)]
        source={key:[{'id':str(uuid.UUID(int=20)),'name':'rice','quantity':'100','unit':'g'}] for key in ids}
        profile={'confirmedLeftovers':[{'id':lot,'version':2,'recipeId':ids[0],'servingsAvailable':4,'confirmedAt':'2026-10-08T12:00:00Z','cookedOn':'2026-10-08','useBy':'2026-10-10'}]}
        body={'weekStart':'2026-10-08','servings':2,'mealCount':3,'maxCookTime':30,'useLeftovers':True,'profile':profile}
        with patch.dict(os.environ,{'MEAL_PLANNER_SIGNING_KEY':'canonical-test-key-'*3}),patch.object(planner,'_eligible_rows',return_value=rows),patch.object(planner,'_ranked_rows',return_value=rows),patch.object(planner,'_ingredients',return_value=source):
            result=planner.generate(body)
            self.assertEqual(2,result['personalization']['leftoverMealsUsed'])
            self.assertEqual(1,len(result['shoppingList']))
            self.assertEqual(100,result['shoppingList'][0]['quantity'])
            meals=[{'dayIndex':meal['dayIndex'],'recipeId':meal['recipe']['id'],**({'leftoverId':meal['reuse']['leftoverId'],'leftoverVersion':meal['reuse']['version']} if meal.get('reuse') else {})} for meal in result['meals']]
            changed=planner.recalculate({**body,'intent':result['intent'],'meals':meals})
            self.assertEqual(2,changed['personalization']['leftoverMealsUsed'])
            self.assertEqual(result['shoppingList'],changed['shoppingList'])
            profile['confirmedLeftovers'][0]['version']=3
            with self.assertRaises(ai.AIError) as error:planner.recalculate({**body,'intent':result['intent'],'meals':meals})
            self.assertEqual(422,error.exception.status)


if __name__=='__main__':unittest.main()
