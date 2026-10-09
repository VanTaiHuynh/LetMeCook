package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.KitchenRepository;
import com.server.letMeCook.repository.KitchenRepository.Record;
import com.server.letMeCook.repository.KitchenRepository.Scope;
import com.server.letMeCook.repository.KitchenRepository.Recipe;
import com.server.letMeCook.repository.MealPlanRepository;
import com.server.letMeCook.repository.MealPlanRepository.SavedPlan;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;
import static com.server.letMeCook.repository.KitchenRepository.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class InferenceTransactionTests {
    @Test void sourceStepAudioUsesAuthorizedImmutableTextAndRechecksMembership(){
        session.set(record(sessionId,"session",1,map("status","active","steps",List.of("Boil for 5 minutes."),"recipeId",recipeId.toString(),"recipeVersion","snapshot")));
        var recipe=new Recipe(recipeId,actor,true,"Dinner","Boil for 5 minutes.",null,null,2,List.of());when(repository.recipe(recipeId,actor)).thenReturn(Optional.of(recipe));
        when(worker.post(eq("/ai/voice/speak"),anyMap())).thenAnswer(c->{noTransaction();Map<String,Object> input=c.getArgument(1);assertEquals("Boil for 5 minutes.",input.get("text"));assertEquals("en",input.get("language"));assertEquals(true,input.get("verifiedSessionStep"));assertEquals(true,input.get("cachePublicSource"));role.set(null);return map("local",true,"audioBase64","unit-only","mimeType","audio/wav");});
        assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->kitchen.speakStep(scopeId,sessionId,map("stepIndex",0,"text","ignore source"),jwt)).getStatusCode());
    }
    @Test void changedSourceDuringAudioCannotReturnAStaleStep(){
        session.set(record(sessionId,"session",1,map("status","active","steps",List.of("Boil for 5 minutes."),"recipeId",recipeId.toString(),"recipeVersion","snapshot")));
        var recipe=new Recipe(recipeId,actor,true,"Dinner","Boil for 5 minutes.",null,null,2,List.of());when(repository.recipe(recipeId,actor)).thenReturn(Optional.of(recipe));
        when(worker.post(eq("/ai/voice/speak"),anyMap())).thenAnswer(c->{noTransaction();when(repository.recipe(recipeId,actor)).thenReturn(Optional.of(new Recipe(recipeId,actor,true,"Dinner","Different instructions.",null,null,2,List.of())));return map("local",true,"audioBase64","unit-only","mimeType","audio/wav");});
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->kitchen.speakStep(scopeId,sessionId,map("stepIndex",0),jwt)).getStatusCode());
    }
    @Test void timerAcknowledgementAndDurationArePersistedWithTheSessionCas(){
        var timer=map("id","timer-1","label","Boil","endsAt",Instant.now().toString(),"running",false,"durationSeconds",300,"acknowledged",true);
        transaction(()->kitchen.updateSession(scopeId,sessionId,map("version",1,"stepIndex",0,"timers",List.of(timer)),jwt));
        Map<?,?> saved=(Map<?,?>)((List<?>)session.get().body().get("timers")).getFirst();assertEquals(300,saved.get("durationSeconds"));assertEquals(true,saved.get("acknowledged"));
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->transaction(()->kitchen.updateSession(scopeId,sessionId,map("version",1,"stepIndex",0,"timers",List.of(timer)),jwt))).getStatusCode());
    }
    private <T>T transaction(java.util.function.Supplier<T> action){return transactions.commit(action);}
    final UUID actor=UUID.randomUUID(),scopeId=UUID.randomUUID(),sessionId=UUID.randomUUID(),recipeId=UUID.randomUUID();
    final Jwt jwt=Jwt.withTokenValue("disposable-unit-context").header("alg","none").subject(actor.toString()).build();
    KitchenRepository repository;
    MealPlanRepository profiles;
    LocalAIService worker;
    MealPlanService planner;
    KitchenService kitchen;
    InferenceTransactions transactions;
    JdbcTemplate jdbc;
    DriverManagerDataSource dataSource;
    AtomicReference<String> role;
    AtomicReference<Record> session;
    AtomicReference<Map<String,Object>> preferences;

    @BeforeEach void setup() {
        dataSource=new DriverManagerDataSource("jdbc:h2:mem:inference_"+UUID.randomUUID()+";DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=1000","sa","");
        jdbc=new JdbcTemplate(dataSource);
        jdbc.execute("CREATE TABLE scope_probe(id INTEGER PRIMARY KEY, revision INTEGER)");
        jdbc.update("INSERT INTO scope_probe VALUES(1,7)");
        transactions=new InferenceTransactions(new DataSourceTransactionManager(dataSource));
        repository=mock(KitchenRepository.class);profiles=mock(MealPlanRepository.class);worker=mock(LocalAIService.class);planner=mock(MealPlanService.class);
        role=new AtomicReference<>("owner");preferences=new AtomicReference<>(map("dietaryPreferences",List.of(),"allergies",List.of(),"favoriteRecipeIds",List.of(),"dislikedRecipeIds",List.of(),"usedProfile",true));
        session=new AtomicReference<>(record(sessionId,"session",1,map("status","active","steps",List.of("Boil for 5 minutes."),"messages",List.of(),"stepIndex",0,"timers",List.of())));
        when(repository.access(scopeId,actor)).thenAnswer(call->{
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            if(role.get()==null)return Optional.empty();
            return Optional.of(new Scope(scopeId,actor,"household","Unit kitchen",jdbc.queryForObject("SELECT revision FROM scope_probe WHERE id=1",Integer.class),role.get()));
        });
        when(repository.record(scopeId,sessionId,"session")).thenAnswer(call->Optional.of(session.get()));
        when(repository.records(any(),anyString(),anyInt())).thenReturn(List.of());
        when(repository.reviewedAliases()).thenReturn(List.of());
        when(profiles.preferences(actor)).thenAnswer(call->{assertTrue(TransactionSynchronizationManager.isActualTransactionActive());return preferences.get();});
        when(profiles.publicRecipeIds(anySet())).thenAnswer(call->{assertTrue(TransactionSynchronizationManager.isActualTransactionActive());return call.getArgument(0);});
        doAnswer(call->{assertTrue(TransactionSynchronizationManager.isActualTransactionActive());jdbc.queryForObject("SELECT revision FROM scope_probe WHERE id=1 FOR UPDATE",Integer.class);return null;}).when(repository).lock(scopeId);
        doAnswer(call->{jdbc.update("UPDATE scope_probe SET revision=revision+1 WHERE id=1");return null;}).when(repository).revise(scopeId);
        when(repository.update(eq(scopeId),eq(sessionId),eq("session"),anyLong(),anyMap())).thenAnswer(call->{
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());Record old=session.get();
            if(old.version()!=call.<Long>getArgument(3))return Optional.empty();
            Record saved=record(sessionId,"session",old.version()+1,call.getArgument(4));
            return session.compareAndSet(old,saved)?Optional.of(saved):Optional.empty();
        });
        kitchen=new KitchenService(repository,worker,planner,profiles,new ObjectMapper(),transactions);
        var platform=mock(PlatformService.class);when(platform.collaborationEnabled()).thenReturn(true);kitchen.setPlatformService(platform);
    }

    Record record(UUID id,String kind,long version,Map<String,Object> body){return new Record(id,scopeId,kind,version,body,actor,Instant.now(),Instant.now());}
    Map<String,Object> answer(){return map("answer","Boil for 5 minutes.","supported",true,"citations",List.of(map("stepIndex",0,"text","Boil for 5 minutes.")));}
    void noTransaction(){assertFalse(TransactionSynchronizationManager.isActualTransactionActive());assertFalse(TransactionSynchronizationManager.hasResource(dataSource));}

    @Test void slowCookInferenceDoesNotHoldTheScopeLockOrBlockAnAuthorizedPantryWrite() throws Exception {
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        when(worker.post(eq("/ai/cook/ask"),anyMap())).thenAnswer(call->{noTransaction();verify(repository,never()).lock(scopeId);entered.countDown();assertTrue(release.await(5,TimeUnit.SECONDS));return answer();});
        UUID lotId=UUID.randomUUID();Record lot=record(lotId,"pantry",1,map("ingredient","rice","quantity",3,"unit","cup"));
        when(repository.record(scopeId,lotId,"pantry")).thenReturn(Optional.of(lot));
        when(repository.update(eq(scopeId),eq(lotId),eq("pantry"),eq(1L),anyMap())).thenAnswer(call->Optional.of(record(lotId,"pantry",2,call.getArgument(4))));
        ExecutorService threads=Executors.newFixedThreadPool(2);
        try {
            Future<Map<String,Object>> request=threads.submit(()->kitchen.ask(scopeId,sessionId,map("question","How long?"),jwt));
            assertTrue(entered.await(3,TimeUnit.SECONDS));
            Future<Map<String,Object>> pantry=threads.submit(()->transactions.commit(()->kitchen.savePantry(scopeId,lotId,map("confirmed",true,"version",1,"ingredient","rice","quantity",2,"unit","cup"),jwt)));
            assertEquals(2L,pantry.get(2,TimeUnit.SECONDS).get("version"));
            assertFalse(request.isDone());release.countDown();
            assertEquals("Boil for 5 minutes.",request.get(3,TimeUnit.SECONDS).get("answer"));
            assertEquals(2,((List<?>)session.get().body().get("messages")).size());
            assertEquals(9,jdbc.queryForObject("SELECT revision FROM scope_probe WHERE id=1",Integer.class));
        } finally {release.countDown();threads.shutdownNow();}
    }

    @Test void aConcurrentSessionUpdatePreventsStaleAnswerPersistence() {
        when(worker.post(anyString(),anyMap())).thenAnswer(call->{noTransaction();session.set(record(sessionId,"session",2,session.get().body()));return answer();});
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->kitchen.ask(scopeId,sessionId,map("question","How long?"),jwt)).getStatusCode());
        verify(repository,never()).update(any(),any(),anyString(),anyLong(),anyMap());
    }

    @Test void completionOrMembershipDowngradeDuringInferencePreventsAnswerPersistence() {
        for(String changed:List.of("completed","viewer","removed")){
            role.set("owner");session.set(record(sessionId,"session",1,map("status","active","steps",List.of("Boil for 5 minutes."),"messages",List.of(),"stepIndex",0)));
            doAnswer(call->{noTransaction();if(changed.equals("completed"))session.set(record(sessionId,"session",1,map("status","completed")));else role.set(changed.equals("removed")?null:"viewer");return answer();}).when(worker).post(anyString(),anyMap());
            HttpStatus expected=changed.equals("completed")?HttpStatus.CONFLICT:HttpStatus.FORBIDDEN;
            assertEquals(expected,assertThrows(ResponseStatusException.class,()->kitchen.ask(scopeId,sessionId,map("question","How long?"),jwt)).getStatusCode());
        }
        verify(repository,never()).update(any(),any(),anyString(),anyLong(),anyMap());
    }

    @Test void workerBusyDoesNotAcquireAWriteLockOrAppendMessages() {
        when(worker.post(anyString(),anyMap())).thenAnswer(call->{noTransaction();throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"Busy");});
        assertEquals(HttpStatus.TOO_MANY_REQUESTS,assertThrows(ResponseStatusException.class,()->kitchen.ask(scopeId,sessionId,map("question","How long?"),jwt)).getStatusCode());
        verify(repository,never()).lock(any());verify(repository,never()).update(any(),any(),anyString(),anyLong(),anyMap());
    }

    @Test void suggestionsRejectChangedStockAndPreferencesAfterInference() {
        when(worker.post(eq("/ai/pantry/suggest"),anyMap())).thenAnswer(call->{noTransaction();jdbc.update("UPDATE scope_probe SET revision=revision+1");return map("recipes",List.of());});
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->kitchen.suggestions(scopeId,map("usePantry",false),jwt)).getStatusCode());
        doAnswer(call->{noTransaction();preferences.set(map("allergies",List.of("peanut")));return map("recipes",List.of());}).when(worker).post(eq("/ai/pantry/suggest"),anyMap());
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->kitchen.suggestions(scopeId,map("usePantry",false),jwt)).getStatusCode());
    }

    @Test void coverageRunsPlannerWithoutTransactionAndRechecksMembership() {
        when(planner.recalculate(anyMap(),eq(jwt))).thenAnswer(call->{noTransaction();role.set(null);return map("pantryCoverage",map("shoppingList",List.of()));});
        Map<String,Object> plan=map("settings",map("householdId",scopeId.toString()),"meals",List.of());
        assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->kitchen.coverage(scopeId,map("plan",plan),jwt)).getStatusCode());
        verify(repository,never()).lock(any());
    }

    @Test void substitutionApprovalWithdrawalDuringInferenceInvalidatesPreview() {
        var recipe=new Recipe(recipeId,actor,true,"Rice","Boil.",null,"",2,List.of(map("ingredient","rice","quantity","1","unit","cup")));
        when(repository.recipe(recipeId,actor)).thenReturn(Optional.of(recipe));
        UUID swapId=UUID.randomUUID();AtomicReference<Record> swap=new AtomicReference<>(record(swapId,"swap",1,map("reviewed",true,"approvalStatus","approved","fromIngredient","rice","toIngredient","millet","ratio",1)));
        when(repository.record(scopeId,swapId,"swap")).thenAnswer(call->Optional.of(swap.get()));
        when(worker.post(eq("/ai/pantry/substitute"),anyMap())).thenAnswer(call->{noTransaction();swap.set(record(swapId,"swap",2,map("reviewed",true,"approvalStatus","rejected")));return map("supported",true);});
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->kitchen.previewSwap(scopeId,map("recipeId",recipeId.toString(),"swapId",swapId.toString(),"servings",2),jwt)).getStatusCode());
    }

    MealPlanService mealPlanner(){return new MealPlanService(worker,profiles,new ObjectMapper(),transactions);}
    Map<String,Object> settings(){return map("weekStart","2026-10-12","servings",2,"maxCookTime",45,"useProfile",true,"intent",map("_signature","verified-by-worker"),"meals",List.of(map("dayIndex",0,"recipeId",recipeId.toString())));}
    Map<String,Object> plan(){return map("weekStart","2026-10-12","servings",2,"meals",List.of(map("dayIndex",0,"date","2026-10-12","recipe",map("id",recipeId.toString()))),"alternatives",List.of(),"shoppingList",List.of());}

    @Test void plannerRejectsChangedPreferencesAfterWorkerWithoutSaving() {
        when(worker.post(eq("/ai/meal-plan/generate"),anyMap())).thenAnswer(call->{noTransaction();preferences.set(map("dietaryPreferences",List.of("vegan"),"allergies",List.of(),"favoriteRecipeIds",List.of(),"dislikedRecipeIds",List.of(),"usedProfile",true));return plan();});
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->mealPlanner().generate(settings(),jwt)).getStatusCode());
        verify(profiles,never()).save(any(),any(),anyInt(),anyMap());
    }

    @Test void plannerSaveRunsInferenceOutsideTransactionAndFinalCompareAndSetInsideOne() {
        when(profiles.find(actor,LocalDate.parse("2026-10-12"))).thenReturn(Optional.empty());
        when(worker.post(eq("/ai/meal-plan/recalculate"),anyMap())).thenAnswer(call->{noTransaction();return plan();});
        when(profiles.save(eq(actor),eq(LocalDate.parse("2026-10-12")),eq(0),anyMap())).thenAnswer(call->{assertTrue(TransactionSynchronizationManager.isActualTransactionActive());return new SavedPlan(UUID.randomUUID(),actor,LocalDate.parse("2026-10-12"),1,Instant.now(),call.getArgument(3));});
        assertEquals(1,mealPlanner().save(settings(),jwt).get("version"));
    }

    @Test void preferencesChangedWhileWaitingForTheFinalPantryLockPreventSaving() {
        MealPlanService service=mealPlanner();PlanningContextPort context=mock(PlanningContextPort.class);service.setPlanningContexts(context);
        var platform=mock(PlatformService.class);when(platform.config()).thenReturn(map("kitchenEnabled",true));
        org.springframework.test.util.ReflectionTestUtils.setField(service,"platformService",platform);
        Map<String,Object> pantry=map("pantryRevision",7,"pantry",List.of(),"priceBook",List.of());
        when(context.load(eq(actor),isNull(),eq(false),any())).thenReturn(new PlanningContextPort.Context("local-ai.v2",pantry));
        when(context.load(eq(actor),isNull(),eq(true),any())).thenAnswer(call->{
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            preferences.set(map("dietaryPreferences",List.of("vegan"),"allergies",List.of(),"favoriteRecipeIds",List.of(),"dislikedRecipeIds",List.of(),"usedProfile",true));
            return new PlanningContextPort.Context("local-ai.v2",pantry);
        });
        when(profiles.find(actor,LocalDate.parse("2026-10-12"))).thenReturn(Optional.empty());
        when(worker.post(eq("/ai/meal-plan/recalculate"),anyMap())).thenAnswer(call->{noTransaction();return plan();});
        Map<String,Object> input=settings();input.put("usePantry",true);
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->service.save(input,jwt)).getStatusCode());
        verify(profiles,never()).save(any(),any(),anyInt(),anyMap());
    }

    @Test void aSavedWeekChangedDuringCanonicalLoadDoesNotReturnItsOldVersion() {
        Map<String,Object> stored=plan();stored.put("settings",settings());stored.put("intent",map("_signature","verified-by-worker"));
        AtomicReference<SavedPlan> saved=new AtomicReference<>(new SavedPlan(UUID.randomUUID(),actor,LocalDate.parse("2026-10-12"),1,Instant.now(),stored));
        when(profiles.find(actor,LocalDate.parse("2026-10-12"))).thenAnswer(call->Optional.of(saved.get()));
        when(worker.post(eq("/ai/meal-plan/recalculate"),anyMap())).thenAnswer(call->{noTransaction();SavedPlan old=saved.get();saved.set(new SavedPlan(old.id(),actor,old.weekStart(),2,Instant.now(),stored));return plan();});
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->mealPlanner().load("2026-10-12",jwt)).getStatusCode());
    }
}
