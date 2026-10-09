package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.KitchenRepository;
import com.server.letMeCook.repository.KitchenRepository.Scope;
import com.server.letMeCook.repository.KitchenRepository.Record;
import com.server.letMeCook.repository.KitchenRepository.Recipe;
import com.server.letMeCook.repository.MealPlanRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
import static com.server.letMeCook.repository.KitchenRepository.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class KitchenServiceTests {
    KitchenRepository repository=mock(KitchenRepository.class);
    LocalAIService worker=mock(LocalAIService.class);
    MealPlanService planner=mock(MealPlanService.class);
    MealPlanRepository profiles=mock(MealPlanRepository.class);
    PlatformService platform=mock(PlatformService.class);
    KitchenService service;
    UUID user=UUID.randomUUID(),household=UUID.randomUUID();
    Jwt jwt=Jwt.withTokenValue("test").header("alg","none").subject(user.toString()).build();
    @BeforeEach void setup(){
        service=new KitchenService(repository,worker,planner,profiles,new ObjectMapper());
        service.setPlatformService(platform);when(platform.collaborationEnabled()).thenReturn(true);
        when(repository.access(household,user)).thenReturn(Optional.of(new Scope(household,user,"household","Test kitchen",7,"owner")));
        when(repository.records(any(),anyString(),anyInt())).thenReturn(List.of());
        when(repository.reviewedAliases()).thenReturn(List.of());
    }
    Record record(String kind,long version,Map<String,Object> body){return new Record(UUID.randomUUID(),household,kind,version,body,user,Instant.now(),Instant.now());}
    Map<String,Object> pantry(){return map("ingredient","rice","quantity",3,"unit","cup","confirmed",true);}
    @Test void missingOrForeignIdentityCannotReadOrWriteKitchen(){
        assertEquals(HttpStatus.UNAUTHORIZED,assertThrows(ResponseStatusException.class,()->service.bootstrap(household,null)).getStatusCode());
        UUID foreign=UUID.randomUUID();when(repository.access(foreign,user)).thenReturn(Optional.empty());
        assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->service.savePantry(foreign,null,pantry(),jwt)).getStatusCode());
        verify(repository,never()).insert(any(),any(),any(),any());verifyNoInteractions(worker);
    }
    @Test void viewerReadsButCannotMutateAndEditorCannotManageWorkspace(){
        when(repository.access(household,user)).thenReturn(Optional.of(new Scope(household,UUID.randomUUID(),"household","Test",1,"viewer")));
        assertNotNull(service.shopping(household,jwt));
        assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->service.savePantry(household,null,pantry(),jwt)).getStatusCode());
        when(repository.access(household,user)).thenReturn(Optional.of(new Scope(household,UUID.randomUUID(),"household","Test",1,"editor")));
        assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->service.saveWorkspace(household,map("name","Test"),jwt)).getStatusCode());
        verify(repository,never()).insert(any(),any(),any(),any());
    }
    @Test void roleIsRecheckedAfterWaitingForScopeLock(){
        Scope editor=new Scope(household,UUID.randomUUID(),"household","Test",1,"editor");
        Scope viewer=new Scope(household,editor.ownerId(),"household","Test",2,"viewer");
        when(repository.access(household,user)).thenReturn(Optional.of(editor),Optional.of(viewer));
        assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->service.savePantry(household,null,pantry(),jwt)).getStatusCode());
        verify(repository).lock(household);verify(repository,never()).insert(any(),any(),any(),any());
    }
    @Test void pantryNeedsExplicitConfirmationAndValidKnownQuantity(){
        Map<String,Object> body=pantry();body.put("confirmed",false);
        assertEquals(HttpStatus.BAD_REQUEST,assertThrows(ResponseStatusException.class,()->service.savePantry(household,null,body,jwt)).getStatusCode());
        body.put("confirmed",true);body.put("quantity",-2);
        assertThrows(ResponseStatusException.class,()->service.savePantry(household,null,body,jwt));
        body.put("quantity",null);body.put("useBy","2026-02-30");
        assertThrows(ResponseStatusException.class,()->service.savePantry(household,null,body,jwt));
        verify(repository,never()).insert(any(),any(),any(),any());
    }
    @Test void stalePantryAndShoppingVersionsNeverOverwrite(){
        Record lot=record("pantry",2,pantry());when(repository.record(household,lot.id(),"pantry")).thenReturn(Optional.of(lot));
        Map<String,Object> body=pantry();body.put("version",1);
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->service.savePantry(household,lot.id(),body,jwt)).getStatusCode());
        Record shopping=record("shopping",3,map("items",List.of(),"planWeekStart",null));when(repository.records(household,"shopping",1)).thenReturn(List.of(shopping));
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->service.saveShopping(household,map("version",0,"items",List.of()),jwt)).getStatusCode());
        verify(repository,never()).update(any(),any(),any(),anyLong(),any());
    }
    @Test void scopePredicateProtectsForeignLotEvenWhenUuidIsKnown(){
        UUID foreignLot=UUID.randomUUID();when(repository.record(household,foreignLot,"pantry")).thenReturn(Optional.empty());
        assertEquals(HttpStatus.NOT_FOUND,assertThrows(ResponseStatusException.class,()->service.deletePantry(household,foreignLot,1,jwt)).getStatusCode());
        verify(repository,never()).delete(any(),any(),any(),anyLong());
    }
    @Test void privateRecipeRequiresExplicitHouseholdCatalogSharing(){
        UUID id=UUID.randomUUID();when(repository.recipe(id,user)).thenReturn(Optional.of(new Recipe(id,user,false,"Private test","Boil water.",null,"",2,List.of())));
        assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->service.startSession(household,map("recipeId",id.toString(),"servings",2),jwt)).getStatusCode());
        verify(repository,never()).insert(any(),any(),eq("session"),any());
    }
    @Test void sourceInstructionsAreRebuiltAndCannotBeChangedBySessionPatch(){
        Record session=record("session",1,map("steps",List.of("Boil for 5 minutes.","Serve."),"stepIndex",0,"timers",List.of(),"messages",List.of(),"status","active"));
        when(repository.record(household,session.id(),"session")).thenReturn(Optional.of(session));
        when(repository.update(eq(household),eq(session.id()),eq("session"),eq(1L),anyMap())).thenAnswer(call->Optional.of(record("session",2,call.getArgument(4))));
        service.updateSession(household,session.id(),map("version",1,"stepIndex",1,"timers",List.of(),"steps",List.of("Invented temperature"),"sourceUrl","https://fake.invalid"),jwt);
        ArgumentCaptor<Map<String,Object>> body=ArgumentCaptor.forClass(Map.class);verify(repository).update(eq(household),eq(session.id()),eq("session"),eq(1L),body.capture());
        assertEquals(session.body().get("steps"),body.getValue().get("steps"));assertFalse(body.getValue().containsKey("sourceUrl"));
    }
    @Test void fabricatedCitationsAreRejectedBeforePersistingAssistantMessage(){
        Record session=record("session",1,map("steps",List.of("Bake at 180 C for 20 minutes."),"stepIndex",0,"timers",List.of(),"messages",List.of(),"status","active"));
        when(repository.record(household,session.id(),"session")).thenReturn(Optional.of(session));
        when(worker.post(eq("/ai/cook/ask"),anyMap())).thenReturn(map("answer","Bake at 250 C.","supported",true,"citations",List.of(map("stepIndex",0,"text","Bake at 250 C."))));
        assertEquals(HttpStatus.BAD_GATEWAY,assertThrows(ResponseStatusException.class,()->service.ask(household,session.id(),map("question","Which temperature?"),jwt)).getStatusCode());
        verify(repository,never()).update(any(),any(),any(),anyLong(),any());
    }
    @Test void coverageIgnoresCallerStockAndPreservesSignedCanonicalIntent(){
        Map<String,Object> intent=map("_parsed",map("allergies",List.of("peanut")),"_pricing",map("quotes",List.of(map("id","original-quote"))),"_signature","signed");
        UUID recipe=UUID.randomUUID();Map<String,Object> plan=map("weekStart","2026-10-12","servings",2,"settings",map("prompt","No peanuts","maxCookTime",45,"useProfile",true,"householdId",household.toString(),"usePantry",false),"intent",intent,
            "meals",List.of(map("dayIndex",0,"recipe",map("id",recipe.toString()))),"shoppingList",List.of(map("ingredient","forged")));
        Map<String,Object> pinned=map("shoppingList",List.of(map("name","rice","priceQuoteId","original-quote","estimatedCost",7)),"estimatedTotalCost",7);
        Map<String,Object> canonical=map("shoppingList",List.of(map("ingredient","rice")),"intent",intent,"pantryCoverage",pinned);
        when(planner.recalculate(anyMap(),eq(jwt))).thenReturn(canonical);
        when(repository.records(household,"price",1000)).thenReturn(List.of(record("price",1,map("ingredient","rice","packPrice",1,"id","newer-cheaper-quote"))));
        Map<String,Object> result=service.coverage(household,map("plan",plan,"pantry",List.of(map("quantity",99999))),jwt);
        ArgumentCaptor<Map<String,Object>> request=ArgumentCaptor.forClass(Map.class);verify(planner).recalculate(request.capture(),eq(jwt));
        assertEquals(intent,request.getValue().get("intent"));assertEquals(List.of(map("dayIndex",0,"recipeId",recipe.toString())),request.getValue().get("meals"));assertEquals(true,request.getValue().get("usePantry"));assertEquals(household.toString(),request.getValue().get("householdId"));assertFalse(request.getValue().containsKey("pantry"));
        assertEquals(pinned.get("shoppingList"),result.get("shoppingList"));assertEquals(7,result.get("estimatedTotalCost"));assertEquals(7L,result.get("pantryRevision"));
        verifyNoInteractions(worker);verify(repository,never()).records(any(),anyString(),anyInt());
    }
    @Test void coverageCannotSilentlyMovePersonalOrAnotherHouseholdPlanToSelectedScope(){
        for(Object original:new Object[]{null,UUID.randomUUID().toString()}){
            Map<String,Object> plan=map("settings",map("householdId",original));
            assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->service.coverage(household,map("plan",plan),jwt)).getStatusCode());
        }
        verifyNoInteractions(planner,worker);
    }
    @Test void coverageRejectsChangedStockRevisionInsteadOfReturningAFalseSnapshotMarker(){
        Map<String,Object> plan=map("settings",map("householdId",household.toString()),"meals",List.of());
        when(planner.recalculate(anyMap(),eq(jwt))).thenReturn(map("pantryCoverage",map("shoppingList",List.of())));
        when(repository.access(household,user)).thenReturn(Optional.of(new Scope(household,user,"household","Test",7,"owner")),Optional.of(new Scope(household,user,"household","Test",8,"owner")));
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->service.coverage(household,map("plan",plan),jwt)).getStatusCode());verifyNoInteractions(worker);
    }
    @Test void plannerAvailabilityExcludesExpiredAndDepletedLotsAndUsesOnlyReviewedAliases(){
        when(repository.records(household,"pantry",1000)).thenReturn(List.of(record("pantry",1,map("ingredient","spring onion","quantity",1,"useBy",null)),
            record("pantry",1,map("ingredient","expired rice","quantity",1,"useBy",LocalDate.now().minusDays(1).toString())),record("pantry",1,map("ingredient","empty flour","quantity",0,"useBy",null))));
        when(repository.reviewedAliases()).thenReturn(List.of(map("alias","spring onion","name","scallion")));
        Record quote=record("price",1,map("ingredient","scallion","area","Synthetic test area"));when(repository.records(household,"price",1000)).thenReturn(List.of(quote));
        Map<String,Object> context=service.plannerContext(user,household);
        assertEquals(List.of("scallion"),context.get("availableIngredients"));assertEquals(3,((List<?>)context.get("pantry")).size());
        assertEquals("Synthetic test area",((Map<?,?>)((List<?>)context.get("priceBook")).getFirst()).get("area"));
        assertEquals(List.of(map("alias","spring onion","name","scallion")),context.get("ingredientAliases"));assertEquals(7L,context.get("pantryRevision"));assertEquals(LocalDate.now(java.time.ZoneOffset.UTC).toString(),context.get("asOf"));
    }
    @Test void substitutionPreviewUsesCurrentUserDietAndAllergiesInsteadOfCallerRestrictions(){
        UUID recipeId=UUID.randomUUID();when(repository.recipe(recipeId,user)).thenReturn(Optional.of(new com.server.letMeCook.repository.KitchenRepository.Recipe(recipeId,user,true,"Source rice","Serve.",null,"",2,List.of(map("ingredient","rice","quantity","1","unit","cup")))));
        Record swap=record("swap",1,map("reviewed",true,"approvalStatus","approved","fromIngredient","rice","toIngredient","ham","ratio",1));when(repository.record(household,swap.id(),"swap")).thenReturn(Optional.of(swap));
        when(profiles.preferences(user)).thenReturn(map("allergies",List.of("peanut"),"dietaryPreferences",List.of("vegetarian")));
        when(worker.post(eq("/ai/pantry/substitute"),anyMap())).thenReturn(map("supported",false,"reason","Contradicts saved diet"));
        Map<String,Object> result=service.previewSwap(household,map("recipeId",recipeId.toString(),"swapId",swap.id().toString(),"servings",2,"dietaryPreferences",List.of(),"excludedIngredients",List.of()),jwt);
        ArgumentCaptor<Map<String,Object>> forwarded=ArgumentCaptor.forClass(Map.class);verify(worker).post(eq("/ai/pantry/substitute"),forwarded.capture());
        assertEquals(List.of("vegetarian"),forwarded.getValue().get("dietaryPreferences"));assertEquals(List.of("peanut"),forwarded.getValue().get("excludedIngredients"));assertEquals(false,result.get("supported"));assertEquals(recipeId.toString(),result.get("sourceRecipeId"));verify(profiles,times(2)).preferences(user);
    }
    @Test void ownConsentDeletionDoesNotDeleteHouseholdOrRecipeRecords(){
        when(repository.consent(user)).thenReturn(map("enabled",false,"updatedAt",Instant.now().toString()));service.deleteEvidence(jwt);
        verify(repository).lockUser(user);verify(repository).deleteEvidence(user);verify(repository).consent(user,false);
        verify(repository,never()).delete(any(),any(),any(),anyLong());
    }
    @Test void absentHouseholdCohortReportsNullRetentionInsteadOfInventedTraction(){
        when(repository.evidenceTimes(household)).thenReturn(List.of());Map<String,Object> evidence=service.evidence(household,jwt);
        assertEquals(0,evidence.get("eligibleWeek4Households"));assertEquals(0,evidence.get("confirmedMeals"));assertNull(evidence.get("week4Retention"));
        assertEquals("2026.10.08-kitchen",evidence.get("releaseVersion"));assertEquals(90,evidence.get("retentionDays"));assertEquals("retained90DayEvidence",evidence.get("cohortBasis"));
    }
    @Test void audioAndSpeechRequestsAreAuthenticatedAndBounded(){
        assertEquals(HttpStatus.UNAUTHORIZED,assertThrows(ResponseStatusException.class,()->service.speak(map("text","Hello"),null)).getStatusCode());
        assertThrows(ResponseStatusException.class,()->service.transcribe(map("audioBase64","not base64","mimeType","audio/webm"),jwt));
        assertThrows(ResponseStatusException.class,()->service.speak(map("text","x".repeat(2001)),jwt));verifyNoInteractions(worker);
    }
    @Test void ownEvidenceExportUsesJwtOnlyAndIncludesNoCookingContent(){
        when(repository.ownEvidence(eq(user),any(Instant.class))).thenReturn(List.of(map("scopeId",household.toString(),"sessionId",UUID.randomUUID().toString(),"confirmedAt",Instant.now().toString())));
        when(repository.consent(user)).thenReturn(map("enabled",false,"updatedAt",null));
        Map<String,Object> exported=service.exportEvidence(jwt);assertEquals(90,exported.get("retentionDays"));assertEquals(false,exported.get("truncated"));
        assertEquals(Set.of("scopeId","sessionId","confirmedAt"),((Map<?,?>)((List<?>)exported.get("events")).getFirst()).keySet());
        verify(repository).ownEvidence(eq(user),any(Instant.class));verify(repository,never()).records(any(),anyString(),anyInt());verifyNoInteractions(worker);
        assertEquals(HttpStatus.UNAUTHORIZED,assertThrows(ResponseStatusException.class,()->service.exportEvidence(null)).getStatusCode());
    }
    @Test void disabledCollaborationBlocksInvitesAndEditorWritesButNotOwnerSolo(){
        when(platform.collaborationEnabled()).thenReturn(false);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,assertThrows(ResponseStatusException.class,()->service.invite(household,map("role","editor"),jwt)).getStatusCode());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,assertThrows(ResponseStatusException.class,()->service.acceptInvite(map("code","unused"),jwt)).getStatusCode());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,assertThrows(ResponseStatusException.class,()->service.changeRole(household,UUID.randomUUID(),map("role","viewer"),jwt)).getStatusCode());
        Record lot=record("pantry",1,pantry());when(repository.record(household,lot.id(),"pantry")).thenReturn(Optional.of(lot));when(repository.delete(household,lot.id(),"pantry",1)).thenReturn(1);
        assertEquals(true,service.deletePantry(household,lot.id(),1,jwt).get("deleted"));
        when(repository.access(household,user)).thenReturn(Optional.of(new Scope(household,UUID.randomUUID(),"household","Test",7,"editor")));
        assertNotNull(service.shopping(household,jwt));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,assertThrows(ResponseStatusException.class,()->service.deletePantry(household,lot.id(),1,jwt)).getStatusCode());
        verify(repository,times(1)).delete(household,lot.id(),"pantry",1);
        KitchenService unwired=new KitchenService(repository,worker,planner,profiles,new ObjectMapper());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,assertThrows(ResponseStatusException.class,()->unwired.deletePantry(household,lot.id(),1,jwt)).getStatusCode());
    }
    Map<String,Object> savedSlotPlan(UUID recipe){return map("version",5,"plan",map("settings",map("householdId",household.toString()),"meals",List.of(map("dayIndex",0,"recipe",map("id",recipe.toString())))));}
    Map<String,Object> completion(){return map("version",1,"confirmed",true,"idempotencyKey","session-slot-regression","aggregateRevision",7,"consumption",List.of());}
    @Test void startPersistsOnlyAnAuthorizedSavedMealSlotAndResumeReturnsIt(){
        UUID recipe=UUID.randomUUID(),plan=UUID.randomUUID();
        when(repository.recipe(recipe,user)).thenReturn(Optional.of(new Recipe(recipe,user,true,"Source dinner","Boil water.",null,"",2,List.of())));
        when(repository.ownedPlan(plan,user)).thenReturn(Optional.of(savedSlotPlan(recipe)));
        when(repository.insert(eq(household),eq(user),eq("session"),anyMap())).thenAnswer(call->record("session",1,call.getArgument(3)));
        Map<String,Object> started=service.startSession(household,map("recipeId",recipe.toString(),"servings",2,"mealSlot",map("planId",plan.toString(),"dayIndex",0,"planVersion",999)),jwt);
        assertEquals(map("planId",plan.toString(),"dayIndex",0,"planVersion",5),started.get("mealSlot"));
        UUID id=UUID.fromString(started.get("id").toString());
        when(repository.record(household,id,"session")).thenReturn(Optional.of(new Record(id,household,"session",1,started,user,Instant.now(),Instant.now())));
        assertEquals(started.get("mealSlot"),service.session(household,id,jwt).get("mealSlot"));
        verify(repository).ownedPlan(plan,user);
    }
    @Test void startRejectsForeignWrongScopeWrongRecipeAndAlreadyCompletedSlots(){
        UUID recipe=UUID.randomUUID(),plan=UUID.randomUUID();
        when(repository.recipe(recipe,user)).thenReturn(Optional.of(new Recipe(recipe,user,true,"Source dinner","Boil water.",null,"",2,List.of())));
        Map<String,Object> input=map("recipeId",recipe.toString(),"servings",2,"mealSlot",map("planId",plan.toString(),"dayIndex",0));
        when(repository.ownedPlan(plan,user)).thenReturn(Optional.empty());
        assertEquals(HttpStatus.NOT_FOUND,assertThrows(ResponseStatusException.class,()->service.startSession(household,input,jwt)).getStatusCode());
        Map<String,Object> wrongScope=savedSlotPlan(recipe);((Map<String,Object>)((Map<String,Object>)wrongScope.get("plan")).get("settings")).put("householdId",null);
        when(repository.ownedPlan(plan,user)).thenReturn(Optional.of(wrongScope));
        assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->service.startSession(household,input,jwt)).getStatusCode());
        when(repository.ownedPlan(plan,user)).thenReturn(Optional.of(savedSlotPlan(UUID.randomUUID())));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,assertThrows(ResponseStatusException.class,()->service.startSession(household,input,jwt)).getStatusCode());
        when(repository.ownedPlan(plan,user)).thenReturn(Optional.of(savedSlotPlan(recipe)));when(repository.completedSlot(plan,0)).thenReturn(true);
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->service.startSession(household,input,jwt)).getStatusCode());
        verify(repository,never()).insert(any(),any(),eq("session"),anyMap());
    }
    @Test void preparedLeftoverSlotsCannotStartOrCompleteCookingAndDebitRawStock(){
        UUID recipe=UUID.randomUUID(),plan=UUID.randomUUID();Map<String,Object> saved=savedSlotPlan(recipe);
        Map<String,Object> body=(Map<String,Object>)saved.get("plan");((Map<String,Object>)((List<?>)body.get("meals")).getFirst()).put("reuse",map("leftoverId",UUID.randomUUID().toString(),"version",1,"recipeId",recipe.toString(),"servingsUsed",2));
        when(repository.recipe(recipe,user)).thenReturn(Optional.of(new Recipe(recipe,user,true,"Prepared dinner","Boil water.",null,"",2,List.of())));
        when(repository.ownedPlan(plan,user)).thenReturn(Optional.of(saved));Map<String,Object> binding=map("planId",plan.toString(),"dayIndex",0);
        var rejected=assertThrows(ResponseStatusException.class,()->service.startSession(household,map("recipeId",recipe.toString(),"servings",2,"mealSlot",binding),jwt));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,rejected.getStatusCode());assertTrue(rejected.getReason().contains("Pantry"));
        Record existing=record("session",1,map("recipeId",recipe.toString(),"status","active","timers",List.of(),"mealSlot",binding));when(repository.record(household,existing.id(),"session")).thenReturn(Optional.of(existing));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,assertThrows(ResponseStatusException.class,()->service.complete(household,existing.id(),completion(),jwt)).getStatusCode());
        verify(repository,never()).insert(any(),any(),eq("session"),anyMap());verify(repository,never()).update(any(),any(),anyString(),anyLong(),anyMap());
        verify(repository,never()).receipt(any(),any(),any(),anyString(),anyString(),anyMap());verify(repository,never()).linkReceipt(any(),anyString(),any(),anyInt());
    }
    @Test void resumedCompletionUsesPersistedSlotWithoutUrlAndReceiptRetryDoesNotNeedSession(){
        UUID recipe=UUID.randomUUID(),plan=UUID.randomUUID();
        Record session=record("session",1,map("recipeId",recipe.toString(),"status","active","timers",List.of(),"mealSlot",map("planId",plan.toString(),"dayIndex",0,"planVersion",4)));
        when(repository.record(household,session.id(),"session")).thenReturn(Optional.of(session));when(repository.ownedPlan(plan,user)).thenReturn(Optional.of(savedSlotPlan(recipe)));
        when(repository.update(eq(household),eq(session.id()),eq("session"),eq(1L),anyMap())).thenAnswer(call->Optional.of(new Record(session.id(),household,"session",2,call.getArgument(4),user,Instant.now(),Instant.now())));
        Map<String,Object> result=service.complete(household,session.id(),completion(),jwt);
        assertEquals(map("planId",plan.toString(),"dayIndex",0,"planVersion",5),result.get("mealSlot"));
        verify(repository).linkReceipt(household,"session-slot-regression",plan,0);
        ArgumentCaptor<String> fingerprint=ArgumentCaptor.forClass(String.class);verify(repository).receipt(eq(household),eq(user),eq(session.id()),eq("session-slot-regression"),fingerprint.capture(),eq(result));
        when(repository.receipt(household,"session-slot-regression")).thenReturn(Optional.of(new KitchenRepository.Receipt(user,session.id(),fingerprint.getValue(),result)));
        when(repository.record(household,session.id(),"session")).thenReturn(Optional.empty());
        assertEquals(result,service.complete(household,session.id(),completion(),jwt));
        verify(repository,times(1)).update(eq(household),eq(session.id()),eq("session"),anyLong(),anyMap());verify(repository,times(1)).ownedPlan(plan,user);
    }
    @Test void boundSessionCannotBeRelinkedAndAnEditedSavedRecipeIsRejected(){
        UUID recipe=UUID.randomUUID(),plan=UUID.randomUUID();
        Record session=record("session",1,map("recipeId",recipe.toString(),"status","active","timers",List.of(),"mealSlot",map("planId",plan.toString(),"dayIndex",0)));
        when(repository.record(household,session.id(),"session")).thenReturn(Optional.of(session));
        Map<String,Object> changed=completion();changed.put("mealSlot",map("planId",UUID.randomUUID().toString(),"dayIndex",0));
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->service.complete(household,session.id(),changed,jwt)).getStatusCode());
        when(repository.ownedPlan(plan,user)).thenReturn(Optional.of(savedSlotPlan(UUID.randomUUID())));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,assertThrows(ResponseStatusException.class,()->service.complete(household,session.id(),completion(),jwt)).getStatusCode());
        verify(repository,never()).update(any(),any(),any(),anyLong(),anyMap());verify(repository,never()).linkReceipt(any(),anyString(),any(),anyInt());
    }
}
