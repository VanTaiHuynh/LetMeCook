package com.server.letMeCook.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.KitchenRepository.Record;
import com.server.letMeCook.service.KitchenService;
import com.server.letMeCook.service.LocalAIService;
import com.server.letMeCook.service.MealPlanService;
import com.server.letMeCook.service.PlatformService;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import static com.server.letMeCook.repository.KitchenRepository.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real JDBC/transaction tests; PostgreSQL RLS/migrations are checked separately. */
class KitchenRepositoryTests {
    JdbcTemplate jdbc;
    KitchenRepository repository;
    KitchenService service;
    TransactionTemplate transaction;
    UUID owner=UUID.randomUUID(),other=UUID.randomUUID(),scope=UUID.randomUUID(),foreign=UUID.randomUUID();
    Jwt jwt=Jwt.withTokenValue("test").header("alg","none").subject(owner.toString()).build();
    ObjectMapper mapper;
    @BeforeEach void setup(){
        var datasource=new DriverManagerDataSource("jdbc:h2:mem:kitchen_"+UUID.randomUUID()+";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000","sa","");
        jdbc=new JdbcTemplate(datasource);transaction=new TransactionTemplate(new DataSourceTransactionManager(datasource));
        jdbc.execute("CREATE TABLE public.users(id uuid PRIMARY KEY,first_name varchar,last_name varchar)");
        jdbc.execute("CREATE TABLE public.kitchen_scopes(id uuid PRIMARY KEY,owner_id uuid NOT NULL,kind varchar NOT NULL,name varchar NOT NULL,revision bigint DEFAULT 1,created_at timestamp DEFAULT current_timestamp)");
        jdbc.execute("CREATE TABLE public.kitchen_members(scope_id uuid,user_id uuid,role varchar,joined_at timestamp DEFAULT current_timestamp,PRIMARY KEY(scope_id,user_id))");
        jdbc.execute("CREATE TABLE public.kitchen_records(id uuid PRIMARY KEY,scope_id uuid NOT NULL,kind varchar NOT NULL,body jsonb NOT NULL,version bigint DEFAULT 1,actor_id uuid NOT NULL,created_at timestamp DEFAULT current_timestamp,updated_at timestamp DEFAULT current_timestamp)");
        jdbc.execute("CREATE TABLE public.kitchen_ledger(id uuid PRIMARY KEY,scope_id uuid,lot_id uuid,actor_id uuid,action varchar,ingredient varchar,delta numeric,unit varchar,session_id uuid,created_at timestamp DEFAULT current_timestamp)");
        jdbc.execute("CREATE TABLE public.kitchen_consumption_receipts(scope_id uuid,idempotency_key varchar,session_id uuid UNIQUE,actor_id uuid,fingerprint varchar,response jsonb,created_at timestamp DEFAULT current_timestamp,PRIMARY KEY(scope_id,idempotency_key))");
        jdbc.execute("ALTER TABLE public.kitchen_consumption_receipts ADD plan_id uuid");jdbc.execute("ALTER TABLE public.kitchen_consumption_receipts ADD day_index integer");
        jdbc.execute("CREATE UNIQUE INDEX kitchen_plan_slot ON public.kitchen_consumption_receipts(plan_id,day_index)");
        jdbc.execute("CREATE TABLE public.kitchen_pantry_receipts(scope_id uuid,operation_key varchar,line_id uuid,actor_id uuid,fingerprint varchar,response jsonb,created_at timestamp DEFAULT current_timestamp,PRIMARY KEY(scope_id,operation_key,line_id))");
        jdbc.execute("CREATE TABLE public.weekly_meal_plans(id uuid PRIMARY KEY,user_id uuid,plan jsonb,version integer DEFAULT 1)");
        jdbc.execute("CREATE TABLE public.kitchen_consent(user_id uuid PRIMARY KEY,enabled boolean,updated_at timestamp DEFAULT current_timestamp)");
        jdbc.execute("CREATE TABLE public.kitchen_evidence_events(id uuid PRIMARY KEY,scope_id uuid,user_id uuid,session_id uuid UNIQUE,confirmed_at timestamp DEFAULT current_timestamp)");
        jdbc.execute("CREATE TABLE public.kitchen_cohort_enrollments(id uuid PRIMARY KEY,scope_id uuid,cohort_name varchar,enrolled_by uuid,enrolled_at timestamp,expires_at timestamp,state varchar DEFAULT 'active',unavailable_reason varchar,state_changed_at timestamp,release_version varchar,consent_version varchar,UNIQUE(scope_id,cohort_name))");
        jdbc.execute("CREATE TABLE public.kitchen_invites(id uuid PRIMARY KEY,scope_id uuid,code_hash varchar UNIQUE,role varchar,expires_at timestamp,created_by uuid,used_by uuid,used_at timestamp,created_at timestamp DEFAULT current_timestamp)");
        jdbc.execute("CREATE TABLE public.recipe(id uuid PRIMARY KEY,author_id uuid,is_public boolean,title varchar,directions varchar,source_url varchar,image_url varchar,servings real)");
        jdbc.execute("CREATE TABLE public.ingredients(id uuid PRIMARY KEY,name varchar)");
        jdbc.execute("CREATE TABLE public.recipe_ingredients(id uuid PRIMARY KEY,recipe_id uuid,ingredient_id uuid,quantity varchar,unit varchar)");
        jdbc.execute("CREATE TABLE public.lmc_ingredient_aliases(alias varchar PRIMARY KEY,ingredient_id uuid)");
        jdbc.update("INSERT INTO public.users VALUES (?,'Test','Owner'),(?,'Test','Member')",owner,other);
        jdbc.update("INSERT INTO public.kitchen_scopes(id,owner_id,kind,name) VALUES (?,?,'household','Test kitchen'),(?,?,'household','Other kitchen')",scope,owner,foreign,other);
        jdbc.update("INSERT INTO public.kitchen_members(scope_id,user_id,role) VALUES (?,?,'owner'),(?,?,'owner')",scope,owner,foreign,other);
        jdbc.update("INSERT INTO public.kitchen_consent(user_id,enabled) VALUES (?,true)",owner);
        mapper=new ObjectMapper(){@Override public <T>T readValue(String content,TypeReference<T> type)throws JsonProcessingException{JsonNode value=readTree(content);return super.readValue(value.isTextual()?value.asText():content,type);}};
        repository=new KitchenRepository(jdbc,mapper){
            // H2 has no PostgreSQL ON CONFLICT ... DO UPDATE. Keep an equivalent
            // real transactional upsert here; production retains its PG statement.
            @Override public void consent(UUID actor,boolean enabled){KitchenRepositoryTests.this.jdbc.update("MERGE INTO public.kitchen_consent(user_id,enabled,updated_at) KEY(user_id) VALUES(?,?,?)",actor,enabled,Timestamp.from(Instant.now()));}
        };service=service(repository);
    }
    KitchenService service(KitchenRepository repo){KitchenService result=new KitchenService(repo,mock(LocalAIService.class),mock(MealPlanService.class),mock(MealPlanRepository.class),mapper);PlatformService platform=mock(PlatformService.class);when(platform.collaborationEnabled()).thenReturn(true);result.setPlatformService(platform);return result;}
    <T>T tx(Supplier<T> action){return transaction.execute(status->action.get());}
    Record lot(UUID kitchen,int quantity){return repository.insert(kitchen,owner,"pantry",map("ingredient","rice","quantity",quantity,"unit","cup","useBy",null,"confirmed",true));}
    Record session(){return repository.insert(scope,owner,"session",map("recipeId",UUID.randomUUID().toString(),"recipeTitle","Test recipe","steps",List.of("Boil water."),"sourceUrl",null,"servings",2,"recipeVersion","testhash","stepIndex",0,"timers",List.of(),"messages",List.of(),"status","active"));}
    Map<String,Object> completion(Record session,String key,Record lot,int quantity){return map("version",session.version(),"confirmed",true,"idempotencyKey",key,"aggregateRevision",repository.access(scope,owner).orElseThrow().revision(),"consumption",List.of(map("lotId",lot.id().toString(),"quantity",quantity,"version",lot.version())));}
    BigDecimal stock(Record lot){return new BigDecimal(repository.record(lot.scopeId(),lot.id(),"pantry").orElseThrow().body().get("quantity").toString());}
    @Test void knownRecordIdCannotReadUpdateOrDeleteAnotherScope(){
        Record lot=lot(foreign,3);assertTrue(repository.record(scope,lot.id(),"pantry").isEmpty());
        assertTrue(repository.update(scope,lot.id(),"pantry",1,map("quantity",999)).isEmpty());assertEquals(0,repository.delete(scope,lot.id(),"pantry",1));assertEquals(new BigDecimal("3"),stock(lot));
    }
    @Test void versionCompareAndSetRejectsASecondWriter(){
        Record lot=lot(scope,3);Map<String,Object> body=new LinkedHashMap<>(lot.body());body.put("quantity",4);
        assertEquals(2,repository.update(scope,lot.id(),"pantry",1,body).orElseThrow().version());
        assertTrue(repository.update(scope,lot.id(),"pantry",1,map("quantity",999)).isEmpty());assertEquals(new BigDecimal("4"),stock(lot));
    }
    @Test void repeatedConfirmationReturnsReceiptWithoutDoubleConsumptionOrEvidence()throws Exception{
        Record lot=lot(scope,3),session=session();Map<String,Object> request=completion(session,"test-confirm-001",lot,1);
        Map<String,Object> first=tx(()->service.complete(scope,session.id(),request,jwt));Map<String,Object> repeated=tx(()->service.complete(scope,session.id(),request,jwt));
        assertEquals(mapper.readTree(mapper.writeValueAsString(first)),mapper.readTree(mapper.writeValueAsString(repeated)));assertEquals("completed",first.get("status"));assertEquals(new BigDecimal("2"),stock(lot));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_ledger",Integer.class));assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_evidence_events",Integer.class));
        Map<String,Object> changed=completion(session,"test-confirm-001",lot,2);
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->tx(()->service.complete(scope,session.id(),changed,jwt))).getStatusCode());assertEquals(new BigDecimal("2"),stock(lot));
    }
    @Test void insufficientSecondLotPreventsAllDecrementsAndCompletion(){
        Record first=lot(scope,3),second=lot(scope,1),session=session();Map<String,Object> request=map("version",1,"confirmed",true,"idempotencyKey","test-insufficient","aggregateRevision",1, "consumption",List.of(map("lotId",first.id().toString(),"quantity",1,"version",1),map("lotId",second.id().toString(),"quantity",2,"version",1)));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,assertThrows(ResponseStatusException.class,()->tx(()->service.complete(scope,session.id(),request,jwt))).getStatusCode());
        assertEquals(new BigDecimal("3"),stock(first));assertEquals(new BigDecimal("1"),stock(second));assertEquals("active",repository.record(scope,session.id(),"session").orElseThrow().body().get("status"));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_ledger",Integer.class));
    }
    @Test void failureAfterDecrementsRollsBackStockSessionAndLedgerTogether(){
        Record lot=lot(scope,3),session=session();KitchenRepository failing=spy(repository);
        doThrow(new IllegalStateException("Simulated receipt storage failure")).when(failing).receipt(eq(scope),eq(owner),eq(session.id()),anyString(),anyString(),anyMap());KitchenService failingService=service(failing);
        assertThrows(IllegalStateException.class,()->tx(()->failingService.complete(scope,session.id(),completion(session,"test-rollback-01",lot,1),jwt)));
        assertEquals(new BigDecimal("3"),stock(lot));assertEquals(1,repository.record(scope,session.id(),"session").orElseThrow().version());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_ledger",Integer.class));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_consumption_receipts",Integer.class));
    }
    @Test void competingConfirmationKeysCannotCompleteSameSessionTwice()throws Exception{
        Record lot=lot(scope,3),session=session();CountDownLatch ready=new CountDownLatch(2),start=new CountDownLatch(1);ExecutorService pool=Executors.newFixedThreadPool(2);
        try{
            List<Future<String>> results=new ArrayList<>();for(String key:List.of("test-race-first","test-race-second"))results.add(pool.submit(()->{ready.countDown();assertTrue(start.await(5,TimeUnit.SECONDS));try{tx(()->service.complete(scope,session.id(),completion(session,key,lot,1),jwt));return "saved";}catch(ResponseStatusException error){assertEquals(HttpStatus.CONFLICT,error.getStatusCode());return "conflict";}}));
            assertTrue(ready.await(5,TimeUnit.SECONDS));start.countDown();List<String> outcomes=List.of(results.get(0).get(15,TimeUnit.SECONDS),results.get(1).get(15,TimeUnit.SECONDS));
            assertEquals(1,Collections.frequency(outcomes,"saved"));assertEquals(1,Collections.frequency(outcomes,"conflict"));assertEquals(new BigDecimal("2"),stock(lot));assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_evidence_events",Integer.class));
        }finally{start.countDown();pool.shutdownNow();}
    }
    @Test void sourceSnapshotSurvivesLaterRecipeEditsAndIgnoresCallerInstructions(){
        UUID recipe=UUID.randomUUID();jdbc.update("INSERT INTO public.recipe VALUES (?,?,true,'Test recipe','<ol><li>Boil for 5 minutes.</li><li>Serve.</li></ol>',null,'',2)",recipe,owner);
        Map<String,Object> started=tx(()->service.startSession(scope,map("recipeId",recipe.toString(),"servings",2,"steps",List.of("fake instruction")),jwt));UUID id=UUID.fromString(started.get("id").toString());
        jdbc.update("UPDATE public.recipe SET directions='Changed source instructions' WHERE id=?",recipe);
        Map<String,Object> saved=tx(()->service.updateSession(scope,id,map("version",1,"stepIndex",1,"timers",List.of(map("id","test-timer","label","Rest","endsAt",Instant.now().plusSeconds(30).toString(),"running",true)),"steps",List.of("fake instruction")),jwt));
        assertEquals(List.of("Boil for 5 minutes.","Serve."),saved.get("steps"));assertEquals(started.get("recipeVersion"),saved.get("recipeVersion"));assertEquals(saved,tx(()->service.session(scope,id,jwt)));
    }
    @Test void acceptedInviteIsOneUseAndExpiredInviteCannotCreateMembership(){
        Map<String,Object> invite=tx(()->service.invite(scope,map("role","viewer"),jwt));Jwt member=Jwt.withTokenValue("test").header("alg","none").subject(other.toString()).build();
        Map<String,Object> accepted=tx(()->service.acceptInvite(map("code",invite.get("code")),member));assertEquals("viewer",accepted.get("role"));
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->tx(()->service.acceptInvite(map("code",invite.get("code")),member))).getStatusCode());
        Map<String,Object> expired=tx(()->service.invite(scope,map("role","editor"),jwt));jdbc.update("UPDATE public.kitchen_invites SET expires_at=? WHERE used_at IS NULL",Timestamp.from(Instant.now().minusSeconds(1)));
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->tx(()->service.acceptInvite(map("code",expired.get("code")),member))).getStatusCode());assertEquals("viewer",repository.access(scope,other).orElseThrow().role());
    }
    @Test void realWeek4DenominatorIsScopeBoundAndRevokedConsentHidesEvents(){
        Instant first=Instant.now().minusSeconds(35L*86400),week4=first.plusSeconds(23L*86400);jdbc.update("INSERT INTO public.kitchen_evidence_events VALUES (?,?,?,?,?),(?,?,?,?,?)",UUID.randomUUID(),scope,owner,UUID.randomUUID(),Timestamp.from(first),UUID.randomUUID(),scope,owner,UUID.randomUUID(),Timestamp.from(week4));
        Map<String,Object> evidence=tx(()->service.evidence(scope,jwt));assertEquals(2,evidence.get("confirmedMeals"));assertEquals(1,evidence.get("eligibleWeek4Households"));assertEquals(1,evidence.get("retainedWeek4Households"));assertEquals(1.0,evidence.get("week4Retention"));
        jdbc.update("UPDATE public.kitchen_consent SET enabled=false WHERE user_id=?",owner);Map<String,Object> revoked=tx(()->service.evidence(scope,jwt));assertEquals(0,revoked.get("confirmedMeals"));assertNull(revoked.get("week4Retention"));
    }
    @Test void publicDemoRecipeLookupRequiresPermissionAndLocalSourcePhoto(){
        jdbc.execute("ALTER TABLE public.recipe ADD demo_permission_confirmed boolean DEFAULT false");jdbc.execute("ALTER TABLE public.recipe ADD demo_permission_note varchar");jdbc.execute("ALTER TABLE public.recipe ADD image_kind varchar");
        UUID recipe=UUID.randomUUID();jdbc.update("INSERT INTO public.recipe(id,author_id,is_public,title,directions,source_url,image_url,servings) VALUES (?,?,true,'Test','Serve.',null,'/recipe-images/test.jpg',2)",recipe,owner);
        PlatformService platform=mock(PlatformService.class);when(platform.publicDemo()).thenReturn(true);repository.setPlatformService(platform);
        assertTrue(repository.recipe(recipe).isEmpty());assertTrue(repository.recipe(recipe,owner).isPresent());jdbc.update("UPDATE public.recipe SET demo_permission_confirmed=true,demo_permission_note='   ',image_kind='source' WHERE id=?",recipe);assertTrue(repository.recipe(recipe).isEmpty());
        jdbc.update("UPDATE public.recipe SET demo_permission_note='Synthetic test declaration' WHERE id=?",recipe);assertTrue(repository.recipe(recipe).isPresent());
        jdbc.update("UPDATE public.recipe SET image_url='https://example.invalid/remote.jpg' WHERE id=?",recipe);assertTrue(repository.recipe(recipe).isEmpty());
    }
    @Test void pantryOperationReplaysOnceRejectsPayloadReuseAndSupportsBatchLines()throws Exception{
        UUID line=UUID.randomUUID();Map<String,Object> request=map("ingredient","  RICE ","quantity",3,"unit"," CUP ","confirmed",true,"idempotencyKey","photo-batch-001","lineId",line.toString(),"aggregateRevision",1);
        Map<String,Object> first=tx(()->service.savePantry(scope,null,request,jwt));
        request.put("quantity",new BigDecimal("3.0"));
        Map<String,Object> replay=tx(()->service.savePantry(scope,null,request,jwt));
        assertEquals(mapper.readTree(mapper.writeValueAsString(first)),mapper.readTree(mapper.writeValueAsString(replay)));
        assertEquals(1,repository.records(scope,"pantry",100).size());assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_ledger",Integer.class));assertEquals(2,repository.access(scope,owner).orElseThrow().revision());
        request.put("quantity",4);assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->tx(()->service.savePantry(scope,null,request,jwt))).getStatusCode());
        request.put("lineId",UUID.randomUUID().toString());assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->tx(()->service.savePantry(scope,null,request,jwt))).getStatusCode());
        request.put("aggregateRevision",2);Map<String,Object> second=tx(()->service.savePantry(scope,null,request,jwt));
        assertEquals(3L,second.get("aggregateRevision"));assertEquals(2,repository.records(scope,"pantry",100).size());assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_pantry_receipts",Integer.class));
    }
    @Test void staleAggregateBlocksCompletionEvenWhenIndividualRecordsAreUnchanged(){
        Record lot=lot(scope,3),session=session();Map<String,Object> request=completion(session,"stale-scope-001",lot,1);repository.revise(scope);
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->tx(()->service.complete(scope,session.id(),request,jwt))).getStatusCode());
        assertEquals(new BigDecimal("3"),stock(lot));assertEquals("active",repository.record(scope,session.id(),"session").orElseThrow().body().get("status"));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_consumption_receipts",Integer.class));
    }
    @Test void savedPlanSlotChecksOwnershipScopeRecipeAndSingleConfirmation(){
        Record lot=lot(scope,5),session=session();UUID plan=UUID.randomUUID();Map<String,Object> snapshot=map("settings",map("householdId",scope.toString()),"meals",List.of(map("dayIndex",0,"recipe",map("id",session.body().get("recipeId")))));
        jdbc.update("INSERT INTO public.weekly_meal_plans(id,user_id,plan) VALUES (?,?,CAST(? AS jsonb))",plan,other,json(snapshot));
        Map<String,Object> request=completion(session,"slot-confirm-001",lot,1);request.put("mealSlot",map("planId",plan.toString(),"dayIndex",0));
        assertEquals(HttpStatus.NOT_FOUND,assertThrows(ResponseStatusException.class,()->tx(()->service.complete(scope,session.id(),request,jwt))).getStatusCode());
        jdbc.update("UPDATE public.weekly_meal_plans SET user_id=? WHERE id=?",owner,plan);
        snapshot.put("settings",map("householdId",foreign.toString()));jdbc.update("UPDATE public.weekly_meal_plans SET plan=CAST(? AS jsonb) WHERE id=?",json(snapshot),plan);
        assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->tx(()->service.complete(scope,session.id(),request,jwt))).getStatusCode());
        snapshot.put("settings",map("householdId",scope.toString()));snapshot.put("meals",List.of(map("dayIndex",0,"recipe",map("id",UUID.randomUUID().toString()))));jdbc.update("UPDATE public.weekly_meal_plans SET plan=CAST(? AS jsonb) WHERE id=?",json(snapshot),plan);
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,assertThrows(ResponseStatusException.class,()->tx(()->service.complete(scope,session.id(),request,jwt))).getStatusCode());
        snapshot.put("meals",List.of(map("dayIndex",0,"recipe",map("id",session.body().get("recipeId")))));jdbc.update("UPDATE public.weekly_meal_plans SET plan=CAST(? AS jsonb) WHERE id=?",json(snapshot),plan);
        Map<String,Object> saved=tx(()->service.complete(scope,session.id(),request,jwt));assertEquals(1,((Map<?,?>)saved.get("mealSlot")).get("planVersion"));assertTrue(repository.completedSlot(plan,0));
        Record duplicate=repository.insert(scope,owner,"session",session.body());Record current=repository.record(scope,lot.id(),"pantry").orElseThrow();Map<String,Object> again=completion(duplicate,"slot-confirm-002",current,1);again.put("mealSlot",map("planId",plan.toString(),"dayIndex",0));
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->tx(()->service.complete(scope,duplicate.id(),again,jwt))).getStatusCode());assertEquals(new BigDecimal("4"),stock(lot));
    }
    @Test void evidenceExpiresAtNinetyDaysWithBoundedPurgesAndOwnExportOnly(){
        Instant cutoff=Instant.parse("2026-07-10T12:00:00Z");Record operational=lot(scope,3);
        for(int index=0;index<3;index++)jdbc.update("INSERT INTO public.kitchen_evidence_events VALUES (?,?,?,?,?)",UUID.randomUUID(),scope,owner,UUID.randomUUID(),Timestamp.from(cutoff.minusSeconds(index+1)));
        jdbc.update("INSERT INTO public.kitchen_evidence_events VALUES (?,?,?,?,?),(?,?,?,?,?)",UUID.randomUUID(),scope,owner,UUID.randomUUID(),Timestamp.from(cutoff),UUID.randomUUID(),scope,other,UUID.randomUUID(),Timestamp.from(cutoff.plusSeconds(1)));
        jdbc.update("INSERT INTO public.kitchen_consent(user_id,enabled) VALUES (?,true)",other);
        assertEquals(2,repository.evidenceTimes(scope,cutoff).size());assertEquals(1,repository.ownEvidence(owner,cutoff).size());
        assertEquals(2,tx(()->repository.purgeEvidence(cutoff,2)));assertEquals(3,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_evidence_events",Integer.class));
        assertEquals(1,tx(()->repository.purgeEvidence(cutoff,2)));assertEquals(0,tx(()->repository.purgeEvidence(cutoff,2)));assertEquals(new BigDecimal("3"),stock(operational));
        repository.deleteEvidence(owner);assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_evidence_events",Integer.class));assertEquals(other,jdbc.queryForObject("SELECT user_id FROM public.kitchen_evidence_events",UUID.class));assertEquals(1,repository.records(scope,"pantry",100).size());
    }
    final Instant enrolledAt=Instant.parse("2026-10-08T12:00:00Z");
    void clock(Instant instant){ReflectionTestUtils.setField(service,"clock",Clock.fixed(instant,ZoneOffset.UTC));}
    Map<?,?> fixed(UUID kitchen,Jwt actor){return (Map<?,?>)tx(()->service.evidence(kitchen,actor)).get("fixedCohort");}
    Map<?,?> enrollment(UUID kitchen,String name,Jwt actor){return (Map<?,?>)tx(()->service.enrollCohort(kitchen,map("cohortName",name,"confirmed",true),actor)).get("cohort");}
    void event(UUID kitchen,UUID actor,Instant at){jdbc.update("INSERT INTO public.kitchen_evidence_events VALUES (?,?,?,?,?)",UUID.randomUUID(),kitchen,actor,UUID.randomUUID(),Timestamp.from(at));}
    @Test void namedEnrollmentIsExplicitOwnerOnlyAndRetriesCannotMoveItsAnchor(){
        clock(enrolledAt);assertEquals("notEnrolled",fixed(scope,jwt).get("reason"));assertNull(fixed(scope,jwt).get("week4Retention"));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_cohort_enrollments",Integer.class));
        assertEquals(HttpStatus.BAD_REQUEST,assertThrows(ResponseStatusException.class,()->tx(()->service.enrollCohort(scope,map("cohortName","Pilot","confirmed",false),jwt))).getStatusCode());
        jdbc.update("UPDATE public.kitchen_consent SET enabled=false WHERE user_id=?",owner);
        assertEquals(HttpStatus.BAD_REQUEST,assertThrows(ResponseStatusException.class,()->enrollment(scope,"Pilot",jwt)).getStatusCode());
        jdbc.update("UPDATE public.kitchen_consent SET enabled=true WHERE user_id=?",owner);
        Map<?,?> first=enrollment(scope,"  Household  Pilot  ",jwt);clock(enrolledAt.plus(Duration.ofDays(27)));
        Map<?,?> replay=enrollment(scope,"HOUSEHOLD PILOT",jwt);assertEquals(first,replay);assertEquals("household pilot",first.get("name"));
        assertEquals(enrolledAt.toString(),first.get("enrolledAt"));assertEquals(enrolledAt.plus(Duration.ofDays(90)).toString(),first.get("expiresAt"));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_cohort_enrollments",Integer.class));assertEquals(2,repository.access(scope,owner).orElseThrow().revision());
        jdbc.update("INSERT INTO public.kitchen_members(scope_id,user_id,role) VALUES (?,?,'editor')",scope,other);
        Jwt member=Jwt.withTokenValue("test").header("alg","none").subject(other.toString()).build();
        assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->enrollment(scope,"Forbidden",member)).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND,assertThrows(ResponseStatusException.class,()->tx(()->service.withdrawCohort(scope,UUID.randomUUID(),map("confirmed",true),jwt))).getStatusCode());
    }
    @Test void fixedWeekFourMaturesAtTwentyEightDaysAndUsesOnlyItsExactScopeWindow(){
        clock(enrolledAt);enrollment(scope,"Boundary pilot",jwt);
        event(scope,owner,enrolledAt.plus(Duration.ofDays(21)).minusSeconds(1));event(scope,owner,enrolledAt.plus(Duration.ofDays(28)));
        event(foreign,owner,enrolledAt.plus(Duration.ofDays(23)));
        clock(enrolledAt.plus(Duration.ofDays(27)));Map<?,?> immature=fixed(scope,jwt);assertEquals("notMature",immature.get("reason"));assertEquals(0,immature.get("eligibleHouseholds"));assertNull(immature.get("retainedHouseholds"));assertNull(immature.get("week4Retention"));
        clock(enrolledAt.plus(Duration.ofDays(28)));Map<?,?> matured=fixed(scope,jwt);assertNull(matured.get("reason"));assertEquals(1,matured.get("eligibleHouseholds"));assertEquals(0,matured.get("retainedHouseholds"));assertEquals(0.0,matured.get("week4Retention"));
        event(scope,owner,enrolledAt.plus(Duration.ofDays(21)));assertEquals(1.0,fixed(scope,jwt).get("week4Retention"));
        assertEquals(enrolledAt.plus(Duration.ofDays(21)).toString(),fixed(scope,jwt).get("windowStart"));assertEquals(enrolledAt.plus(Duration.ofDays(28)).toString(),fixed(scope,jwt).get("windowEnd"));
    }
    @Test void withdrawalIsUnavailableAndCannotRestartTheSameNamedObservation(){
        clock(enrolledAt);Map<?,?> cohort=enrollment(scope,"Withdraw pilot",jwt);UUID id=UUID.fromString(cohort.get("id").toString());
        event(scope,owner,enrolledAt.plus(Duration.ofDays(23)));clock(enrolledAt.plus(Duration.ofDays(28)));assertEquals(1.0,fixed(scope,jwt).get("week4Retention"));
        tx(()->service.withdrawCohort(scope,id,map("confirmed",true),jwt));assertEquals("withdrawn",fixed(scope,jwt).get("reason"));assertNull(fixed(scope,jwt).get("eligibleHouseholds"));assertNull(fixed(scope,jwt).get("week4Retention"));
        assertEquals(enrolledAt,repository.cohort(scope,id).orElseThrow().enrolledAt());assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->enrollment(scope,"Withdraw pilot",jwt)).getStatusCode());
        Map<?,?> distinct=enrollment(scope,"Distinct new study",jwt);assertNotEquals(cohort.get("id"),distinct.get("id"));assertEquals(enrolledAt.plus(Duration.ofDays(28)).toString(),distinct.get("enrolledAt"));
        Jwt stranger=Jwt.withTokenValue("test").header("alg","none").subject(other.toString()).build();
        assertEquals(HttpStatus.NOT_FOUND,assertThrows(ResponseStatusException.class,()->tx(()->service.withdrawCohort(foreign,id,map("confirmed",true),stranger))).getStatusCode());
    }
    @Test void ownEvidenceDeletionInvalidatesSharedCohortWithoutDeletingOtherActorsOrOperationalData(){
        clock(enrolledAt);Map<?,?> cohort=enrollment(scope,"Delete pilot",jwt);UUID id=UUID.fromString(cohort.get("id").toString());Record stock=lot(scope,3);
        jdbc.update("INSERT INTO public.kitchen_consent(user_id,enabled) VALUES (?,true)",other);Jwt stranger=Jwt.withTokenValue("test").header("alg","none").subject(other.toString()).build();
        Map<?,?> untouched=enrollment(foreign,"Other pilot",stranger);UUID untouchedId=UUID.fromString(untouched.get("id").toString());
        event(scope,owner,enrolledAt.plus(Duration.ofDays(23)));event(scope,other,enrolledAt.plus(Duration.ofDays(23)));event(foreign,other,enrolledAt.plus(Duration.ofDays(23)));
        clock(enrolledAt.plus(Duration.ofDays(28)));tx(()->service.deleteEvidence(jwt));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_evidence_events WHERE user_id=?",Integer.class,owner));assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_evidence_events WHERE user_id=?",Integer.class,other));
        var incomplete=repository.cohort(scope,id).orElseThrow();assertNull(incomplete.enrolledBy());assertEquals("incomplete",incomplete.state());assertEquals(enrolledAt,incomplete.enrolledAt());assertEquals("incomplete",fixed(scope,jwt).get("reason"));assertNull(fixed(scope,jwt).get("week4Retention"));
        tx(()->service.consent(map("enabled",true),jwt));assertEquals("incomplete",fixed(scope,jwt).get("reason"));assertEquals("active",repository.cohort(foreign,untouchedId).orElseThrow().state());assertEquals(1.0,fixed(foreign,stranger).get("week4Retention"));assertEquals(new BigDecimal("3"),stock(stock));
    }
    @Test void memberConsentRevocationMarksOnlyAffectedEnrollmentIncompleteWithoutReanchoring(){
        clock(enrolledAt);Map<?,?> cohort=enrollment(scope,"Shared pilot",jwt);UUID id=UUID.fromString(cohort.get("id").toString());
        jdbc.update("INSERT INTO public.kitchen_consent(user_id,enabled) VALUES (?,true)",other);event(scope,other,enrolledAt.plus(Duration.ofDays(23)));
        Jwt member=Jwt.withTokenValue("test").header("alg","none").subject(other.toString()).build();clock(enrolledAt.plus(Duration.ofDays(28)));assertEquals(1.0,fixed(scope,jwt).get("week4Retention"));
        tx(()->service.consent(map("enabled",false),member));assertEquals("incomplete",fixed(scope,jwt).get("reason"));assertNull(fixed(scope,jwt).get("retainedHouseholds"));
        tx(()->service.consent(map("enabled",true),member));assertNull(fixed(scope,jwt).get("week4Retention"));assertEquals(enrolledAt,repository.cohort(scope,id).orElseThrow().enrolledAt());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_evidence_events",Integer.class));
    }
    @Test void exactNinetyDayExpiryPurgesOnlyBoundedMetadataAndNeverReconstructsAHistoricRate(){
        clock(enrolledAt);enrollment(scope,"Expired one",jwt);enrollment(scope,"Expired two",jwt);Record stock=lot(scope,3);
        event(scope,owner,enrolledAt.plus(Duration.ofDays(23)));clock(enrolledAt.plus(Duration.ofDays(90)).minusSeconds(1));assertEquals(1.0,fixed(scope,jwt).get("week4Retention"));
        Instant expiry=enrolledAt.plus(Duration.ofDays(90));clock(expiry);assertEquals("expired",fixed(scope,jwt).get("reason"));assertNull(fixed(scope,jwt).get("week4Retention"));
        assertEquals(0,tx(()->repository.purgeCohorts(expiry.minusSeconds(1),1)));assertEquals(1,tx(()->repository.purgeCohorts(expiry,1)));assertEquals(1,tx(()->repository.purgeCohorts(expiry,1)));assertEquals(0,tx(()->repository.purgeCohorts(expiry,1)));
        event(scope,owner,expiry);assertEquals("notEnrolled",fixed(scope,jwt).get("reason"));assertNull(fixed(scope,jwt).get("week4Retention"));assertEquals(new BigDecimal("3"),stock(stock));assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM public.kitchen_evidence_events",Integer.class));
        assertThrows(IllegalArgumentException.class,()->repository.purgeCohorts(expiry,1001));
    }
    String json(Object value){try{return mapper.writeValueAsString(value);}catch(Exception error){throw new IllegalStateException(error);}}
}
