package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import static com.server.letMeCook.repository.KitchenRepository.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GrowthMemoryTests {
    @Test void consentCanAlwaysBeReadAndRevokedWhenKitchenFeaturesAreDisabled(){
        transaction(()->service.share(scope,map("version",0,"enabled",true),jwt(editor)));when(platform.config()).thenReturn(map("kitchenEnabled",false));when(platform.collaborationEnabled()).thenReturn(false);
        assertEquals(true,transaction(()->service.sharing(scope,jwt(editor))).get("enabled"));assertEquals(false,transaction(()->service.share(scope,map("version",1,"enabled",false),jwt(editor))).get("enabled"));assertTrue(memory.consentedMembers(scope).isEmpty());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,status(()->transaction(()->service.share(scope,map("version",2,"enabled",true),jwt(editor)))));
    }
    JdbcTemplate jdbc;TransactionTemplate tx;GrowthMemoryRepository memory;GrowthMemoryService service;KitchenRepository kitchen;
    final UUID owner=UUID.randomUUID(),editor=UUID.randomUUID(),viewer=UUID.randomUUID(),outsider=UUID.randomUUID(),scope=UUID.randomUUID(),session=UUID.randomUUID(),recipe=UUID.randomUUID();
    final LocalDate today=LocalDate.parse("2026-10-08");
    PlatformService platform;
    @BeforeEach void setup()throws Exception{
        var ds=new DriverManagerDataSource("jdbc:h2:mem:growth_"+UUID.randomUUID()+";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=3000","sa","");jdbc=new JdbcTemplate(ds);tx=new TransactionTemplate(new DataSourceTransactionManager(ds));
        jdbc.execute("CREATE TABLE users(id UUID PRIMARY KEY)");for(UUID id:List.of(owner,editor,viewer,outsider))jdbc.update("INSERT INTO users VALUES(?)",id);
        jdbc.execute("CREATE TABLE kitchen_scopes(id UUID PRIMARY KEY,owner_id UUID,kind VARCHAR,name VARCHAR,revision BIGINT DEFAULT 1)");
        jdbc.execute("CREATE TABLE kitchen_members(scope_id UUID,user_id UUID,role VARCHAR,PRIMARY KEY(scope_id,user_id))");
        jdbc.execute("CREATE TABLE kitchen_records(id UUID PRIMARY KEY,scope_id UUID,kind VARCHAR,version BIGINT,body TEXT,actor_id UUID,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        jdbc.execute("CREATE TABLE kitchen_preference_sharing(scope_id UUID,user_id UUID,enabled BOOLEAN,version BIGINT DEFAULT 1,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(scope_id,user_id))");
        jdbc.execute("CREATE TABLE kitchen_taste_feedback(id UUID PRIMARY KEY,scope_id UUID,user_id UUID,session_id UUID,recipe_id UUID,rating INTEGER,body JSONB,version BIGINT DEFAULT 1,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE(session_id,user_id))");
        jdbc.execute("CREATE TABLE kitchen_leftovers(id UUID PRIMARY KEY,scope_id UUID,session_id UUID UNIQUE,actor_id UUID,recipe_id UUID,title VARCHAR,servings_available NUMERIC(12,3),cooked_on DATE,use_by DATE,confirmed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,version BIGINT DEFAULT 1)");
        jdbc.execute("CREATE TABLE kitchen_growth_receipts(scope_id UUID,idempotency_key VARCHAR,actor_id UUID,fingerprint VARCHAR,response JSONB,PRIMARY KEY(scope_id,idempotency_key))");
        jdbc.update("INSERT INTO kitchen_scopes(id,owner_id,kind,name)VALUES(?,?,'household','Unit kitchen')",scope,owner);for(var member:Map.of(owner,"owner",editor,"editor",viewer,"viewer").entrySet())jdbc.update("INSERT INTO kitchen_members VALUES(?,?,?)",scope,member.getKey(),member.getValue());
        var mapper=new ObjectMapper();jdbc.update("INSERT INTO kitchen_records(id,scope_id,kind,version,body,actor_id)VALUES(?,?,'session',1,?,?)",session,scope,mapper.writeValueAsString(map("status","completed","recipeId",recipe.toString(),"recipeTitle","Cooked dinner")),owner);
        UUID raw=UUID.randomUUID();jdbc.update("INSERT INTO kitchen_records(id,scope_id,kind,version,body,actor_id)VALUES(?,?,'pantry',1,?,?)",raw,scope,"{\"quantity\":7,\"ingredient\":\"rice\"}",owner);
        kitchen=new KitchenRepository(jdbc,mapper);memory=new GrowthMemoryRepository(jdbc,mapper);platform=mock(PlatformService.class);when(platform.config()).thenReturn(map("kitchenEnabled",true));when(platform.collaborationEnabled()).thenReturn(true);
        service=new GrowthMemoryService(kitchen,memory,platform,mapper);service.setScopeAccess(new KitchenScopeAccess(kitchen,platform));service.setClock(Clock.fixed(today.atStartOfDay(ZoneOffset.UTC).toInstant(),ZoneOffset.UTC));
    }
    Jwt jwt(UUID id){return Jwt.withTokenValue("unit-only").header("alg","none").subject(id.toString()).build();}
    Map<String,Object> create(String key){return map("sessionId",session.toString(),"servingsAvailable",2,"cookedOn",today.toString(),"useBy",today.plusDays(1).toString(),"confirmed",true,"idempotencyKey",key);}
    Map<String,Object> consume(String key,long version){return map("version",version,"servings",1,"consumedOn",today.toString(),"confirmed",true,"idempotencyKey",key);}
    <T>T transaction(java.util.function.Supplier<T> action){return tx.execute(status->action.get());}
    HttpStatus status(Runnable action){return HttpStatus.valueOf(assertThrows(ResponseStatusException.class,action::run).getStatusCode().value());}

    @Test void completedFeedbackIsActorOwnedSoftDataWithCompareAndSet(){
        Map<String,Object> body=map("version",0,"rating",2,"avoidedIngredients",List.of("mushroom"));
        var first=transaction(()->service.saveFeedback(scope,session,body,jwt(owner)));assertEquals(1L,first.get("version"));assertEquals(2,first.get("rating"));
        transaction(()->service.saveFeedback(scope,session,map("version",0,"rating",5),jwt(viewer)));
        assertEquals(2L,jdbc.queryForObject("SELECT count(*) FROM kitchen_taste_feedback",Long.class));
        assertEquals(HttpStatus.CONFLICT,status(()->transaction(()->service.saveFeedback(scope,session,body,jwt(owner)))));
        assertEquals(HttpStatus.FORBIDDEN,status(()->transaction(()->service.feedback(scope,jwt(outsider)))));
        assertEquals(1,((List<?>)transaction(()->service.feedback(scope,jwt(owner))).get("feedback")).size());
    }
    @Test void activeSessionsCannotCreateTasteOrLeftovers()throws Exception{
        jdbc.update("UPDATE kitchen_records SET body=? WHERE id=?","{\"status\":\"active\"}",session);
        assertEquals(HttpStatus.CONFLICT,status(()->transaction(()->service.saveFeedback(scope,session,map("version",0,"rating",5),jwt(owner)))));
        assertEquals(HttpStatus.CONFLICT,status(()->transaction(()->service.createLeftover(scope,create("create-01"),jwt(owner)))));
    }
    @Test void confirmationQuantityAndDateAreExplicitAndCreationReplaysOnce(){
        var invalid=create("create-01");invalid.put("confirmed",false);assertEquals(HttpStatus.BAD_REQUEST,status(()->transaction(()->service.createLeftover(scope,invalid,jwt(owner)))));
        var badQuantity=create("create-01");badQuantity.put("servingsAvailable","unknown");assertEquals(HttpStatus.BAD_REQUEST,status(()->transaction(()->service.createLeftover(scope,badQuantity,jwt(owner)))));
        var first=transaction(()->service.createLeftover(scope,create("create-01"),jwt(owner)));var again=transaction(()->service.createLeftover(scope,create("create-01"),jwt(owner)));assertEquals(first.get("id"),again.get("id"));
        assertEquals(1L,jdbc.queryForObject("SELECT count(*) FROM kitchen_leftovers",Long.class));assertEquals(HttpStatus.CONFLICT,status(()->transaction(()->service.createLeftover(scope,create("create-02"),jwt(owner)))));
    }
    @Test void competingConsumptionUsesCasAndReceiptWithoutDebitingRawStock()throws Exception{
        UUID id=UUID.fromString(transaction(()->service.createLeftover(scope,create("create-01"),jwt(owner))).get("id").toString());ExecutorService threads=Executors.newFixedThreadPool(2);
        try{
            Callable<Object> a=()->{try{return transaction(()->service.consume(scope,id,consume("consume-1",1),jwt(owner)));}catch(ResponseStatusException e){return e.getStatusCode().value();}};
            Callable<Object> b=()->{try{return transaction(()->service.consume(scope,id,consume("consume-2",1),jwt(editor)));}catch(ResponseStatusException e){return e.getStatusCode().value();}};
            List<Future<Object>> results=threads.invokeAll(List.of(a,b));List<Object> values=List.of(results.get(0).get(),results.get(1).get());assertEquals(1,values.stream().filter(Map.class::isInstance).count());assertTrue(values.contains(409));
            assertEquals(0,memory.leftover(scope,id).orElseThrow().servingsAvailable().compareTo(BigDecimal.ONE));
            String success=values.get(0) instanceof Map?"consume-1":"consume-2";UUID actor=values.get(0) instanceof Map?owner:editor;
            assertEquals(true,transaction(()->service.consume(scope,id,consume(success,1),jwt(actor))).get("replayed"));
            var changed=consume(success,1);changed.put("servings",0.5);assertEquals(HttpStatus.CONFLICT,status(()->transaction(()->service.consume(scope,id,changed,jwt(actor)))));
            assertEquals("{\"quantity\":7,\"ingredient\":\"rice\"}",jdbc.queryForObject("SELECT body FROM kitchen_records WHERE kind='pantry'",String.class));
            assertEquals(2L,jdbc.queryForObject("SELECT count(*) FROM kitchen_growth_receipts",Long.class));
        }finally{threads.shutdownNow();}
    }
    @Test void outsiderViewerAndRevokedMembershipCannotConsumePrivateStock(){
        UUID id=UUID.fromString(transaction(()->service.createLeftover(scope,create("create-01"),jwt(owner))).get("id").toString());
        assertEquals(HttpStatus.FORBIDDEN,status(()->transaction(()->service.consume(scope,id,consume("consume-1",1),jwt(viewer)))));
        jdbc.update("DELETE FROM kitchen_members WHERE user_id=?",editor);assertEquals(HttpStatus.FORBIDDEN,status(()->transaction(()->service.consume(scope,id,consume("consume-1",1),jwt(editor)))));
        assertEquals(HttpStatus.FORBIDDEN,status(()->transaction(()->service.leftovers(scope,jwt(outsider)))));
    }
    @Test void pastChosenUseByAndOverdrawNeverPass(){
        var input=create("create-01");input.put("cookedOn",today.minusDays(2).toString());input.put("useBy",today.minusDays(1).toString());UUID id=UUID.fromString(transaction(()->service.createLeftover(scope,input,jwt(owner))).get("id").toString());
        assertEquals(HttpStatus.BAD_REQUEST,status(()->transaction(()->service.consume(scope,id,consume("consume-1",1),jwt(owner)))));
        assertEquals(0,memory.leftover(scope,id).orElseThrow().servingsAvailable().compareTo(BigDecimal.valueOf(2)));
    }
    @Test void sharingIsSelfOnlyVersionedAndConsentedMembershipIsFresh(){
        assertEquals(false,transaction(()->service.sharing(scope,jwt(editor))).get("enabled"));
        transaction(()->service.share(scope,map("version",0,"enabled",true,"userId",owner.toString()),jwt(editor)));
        assertEquals(false,memory.sharing(scope,owner).enabled());assertEquals(List.of(editor),memory.consentedMembers(scope));
        assertEquals(HttpStatus.CONFLICT,status(()->transaction(()->service.share(scope,map("version",0,"enabled",false),jwt(editor)))));
        transaction(()->service.share(scope,map("version",1,"enabled",false),jwt(editor)));assertTrue(memory.consentedMembers(scope).isEmpty());
        transaction(()->service.share(scope,map("version",2,"enabled",true),jwt(editor)));jdbc.update("DELETE FROM kitchen_members WHERE user_id=?",editor);assertTrue(memory.consentedMembers(scope).isEmpty());
    }
    @Test void sharedRestrictionsSurviveSoloProfileOptOutAndRevocationPreventsInferenceCommit(){
        transaction(()->service.share(scope,map("version",0,"enabled",true),jwt(editor)));
        transaction(()->service.saveFeedback(scope,session,map("version",0,"rating",5),jwt(owner)));
        MealPlanRepository profiles=mock(MealPlanRepository.class);when(profiles.preferences(owner)).thenReturn(map("dietaryPreferences",List.of(),"allergies",List.of(),"favoriteRecipeIds",List.of(),"dislikedRecipeIds",List.of()));when(profiles.preferences(editor)).thenReturn(map("dietaryPreferences",List.of("vegetarian"),"allergies",List.of("peanut"),"favoriteRecipeIds",List.of(),"dislikedRecipeIds",List.of()));when(profiles.publicRecipeIds(anySet())).thenAnswer(c->c.getArgument(0));
        var context=new KitchenPlanningContext(kitchen,memory,profiles,platform,new ObjectMapper());var worker=mock(LocalAIService.class);
        var planner=new MealPlanService(worker,profiles,new ObjectMapper(),new InferenceTransactions(tx.getTransactionManager()));planner.setPlanningContexts(context);org.springframework.test.util.ReflectionTestUtils.setField(planner,"platformService",platform);
        when(worker.post(anyString(),anyMap())).thenAnswer(c->{assertFalse(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive());Map<String,Object> body=c.getArgument(1);var profile=(Map<?,?>)body.get("profile");assertEquals(false,profile.get("usedProfile"));assertEquals(List.of("vegetarian"),profile.get("dietaryPreferences"));assertEquals(List.of(),profile.get("tasteFeedback"));assertTrue(profile.containsKey("householdRestrictions"));transaction(()->service.share(scope,map("version",1,"enabled",false),jwt(editor)));return Map.of();});
        assertEquals(HttpStatus.CONFLICT,status(()->planner.generate(map("weekStart","2026-10-08","useHouseholdPreferences",true,"householdId",scope.toString(),"useProfile",false),jwt(owner))));
    }
    @Test void editedCookingSourcesCannotRelabelPreparedFoodButManualConsumptionStillWorks()throws Exception{
        jdbc.execute("CREATE TABLE recipe(id UUID PRIMARY KEY,author_id UUID,is_public BOOLEAN,title VARCHAR,directions VARCHAR,source_url VARCHAR,image_url VARCHAR,servings REAL)");
        jdbc.execute("CREATE TABLE ingredients(id UUID PRIMARY KEY,name VARCHAR)");
        jdbc.execute("CREATE TABLE recipe_ingredients(id UUID PRIMARY KEY,recipe_id UUID,ingredient_id UUID,quantity VARCHAR,unit VARCHAR)");
        jdbc.update("INSERT INTO recipe VALUES(?,?,true,'Cooked dinner','Cook rice.',null,null,2)",recipe,owner);UUID ingredient=UUID.randomUUID();
        jdbc.update("INSERT INTO ingredients VALUES(?,'rice')",ingredient);jdbc.update("INSERT INTO recipe_ingredients VALUES(?,?,?,'200','g')",UUID.randomUUID(),recipe,ingredient);
        var mapper=new ObjectMapper();var original=kitchen.recipe(recipe,owner).orElseThrow();
        jdbc.update("UPDATE kitchen_records SET body=? WHERE id=?",mapper.writeValueAsString(map("status","completed","recipeId",recipe.toString(),"recipeTitle","Cooked dinner","recipeVersion",CookSourceVersion.of(original,mapper))),session);
        var lot=memory.insertLeftover(scope,owner,session,recipe,"Cooked dinner",BigDecimal.valueOf(2),today.minusDays(1),today.plusYears(1));
        var profiles=mock(MealPlanRepository.class);when(profiles.publicRecipeIds(anySet())).thenReturn(Set.of());
        var context=new KitchenPlanningContext(kitchen,memory,profiles,platform,mapper);var options=new PlanningContextPort.Options(false,false,true,false);
        assertEquals(1,((List<?>)context.load(owner,scope,false,options).fields().get("confirmedLeftovers")).size());
        assertTrue(kitchen.recordsByIds(UUID.randomUUID(),Set.of(session),"session").isEmpty());
        jdbc.update("UPDATE ingredients SET name='ham' WHERE id=?",ingredient);
        assertEquals(List.of(),context.load(owner,scope,false,options).fields().get("confirmedLeftovers"));
        jdbc.update("UPDATE ingredients SET name='rice' WHERE id=?",ingredient);assertEquals(1,((List<?>)context.load(owner,scope,false,options).fields().get("confirmedLeftovers")).size());
        jdbc.update("UPDATE recipe SET directions='Different source instructions.' WHERE id=?",recipe);assertEquals(List.of(),context.load(owner,scope,false,options).fields().get("confirmedLeftovers"));
        jdbc.update("UPDATE recipe SET directions='Cook rice.',is_public=false WHERE id=?",recipe);assertEquals(List.of(),context.load(owner,scope,false,options).fields().get("confirmedLeftovers"));
        var consumed=transaction(()->service.consume(scope,lot.id(),consume("source-change-consume",1),jwt(owner)));assertEquals(lot.id().toString(),((Map<?,?>)consumed.get("leftover")).get("id"));
        assertEquals(0,memory.leftover(scope,lot.id()).orElseThrow().servingsAvailable().compareTo(BigDecimal.ONE));
        assertEquals("{\"quantity\":7,\"ingredient\":\"rice\"}",jdbc.queryForObject("SELECT body FROM kitchen_records WHERE kind='pantry'",String.class));
    }
}
