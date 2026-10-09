package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.GrowthMemoryRepository;
import com.server.letMeCook.repository.GrowthMemoryRepository.Feedback;
import com.server.letMeCook.repository.KitchenRepository;
import com.server.letMeCook.repository.KitchenRepository.Scope;
import com.server.letMeCook.repository.MealPlanRepository;
import java.math.BigDecimal;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import static com.server.letMeCook.repository.KitchenRepository.map;

@Service
public class KitchenPlanningContext implements PlanningContextPort {
    private final KitchenRepository kitchen;
    private final GrowthMemoryRepository memory;
    private final MealPlanRepository profiles;
    private final PlatformService platform;
    private final ObjectMapper mapper;
    public KitchenPlanningContext(KitchenRepository kitchen,GrowthMemoryRepository memory,MealPlanRepository profiles,PlatformService platform,ObjectMapper mapper){this.kitchen=kitchen;this.memory=memory;this.profiles=profiles;this.platform=platform;this.mapper=mapper;}
    @Override public Context load(UUID actor,UUID household,boolean lock,Options options){
        if(actor==null)throw error(HttpStatus.UNAUTHORIZED,"Sign in to use your kitchen preferences.");
        if((options.pantry()||options.householdPreferences()||options.leftovers())&&!Boolean.TRUE.equals(platform.config().get("kitchenEnabled")))throw error(HttpStatus.SERVICE_UNAVAILABLE,"Kitchen features are currently disabled.");
        Scope scope=household==null?kitchen.personal(actor):access(household,actor);
        com.server.letMeCook.security.AIRequestContext.scope(scope.id());
        if(household!=null&&!"household".equals(scope.kind()))throw error(HttpStatus.FORBIDDEN,"Choose an accepted household.");
        if(lock){kitchen.lock(scope.id());scope=access(scope.id(),actor);if(!options.householdPreferences())kitchen.lockUser(actor);}
        Map<String,Object> fields=new LinkedHashMap<>();LocalDate asOf=LocalDate.now(ZoneOffset.UTC);
        if(options.pantry()){
            List<Map<String,Object>> pantry=kitchen.records(scope.id(),"pantry",1000).stream().map(KitchenPlanningContext::view).toList();
            List<Map<String,Object>> aliases=kitchen.reviewedAliases();Map<String,String> aliasNames=new HashMap<>();for(var alias:aliases)aliasNames.put(canonical(alias.get("alias")),String.valueOf(alias.get("name")));
            Set<String> available=new LinkedHashSet<>();for(var lot:pantry){Object until=lot.get("useBy"),q=lot.get("quantity");if((until==null||!LocalDate.parse(until.toString()).isBefore(asOf))&&(q==null||new BigDecimal(q.toString()).signum()>0)){String name=String.valueOf(lot.get("ingredient"));available.add(aliasNames.getOrDefault(canonical(name),name));}}
            fields.putAll(map("availableIngredients",List.copyOf(available),"pantryRevision",scope.revision(),"pantry",pantry,"priceBook",kitchen.records(scope.id(),"price",1000).stream().map(KitchenPlanningContext::view).toList(),"ingredientAliases",aliases,"asOf",asOf.toString()));
        }
        List<UUID> participants=new ArrayList<>(options.ownTaste()?List.of(actor):List.of());List<Object> consentSnapshot=new ArrayList<>();Set<String> diets=new LinkedHashSet<>(),allergies=new LinkedHashSet<>();
        if(options.householdPreferences()){
            if(household==null)throw error(HttpStatus.BAD_REQUEST,"Choose a household before using shared preferences.");
            if(!platform.collaborationEnabled())throw error(HttpStatus.SERVICE_UNAVAILABLE,"Household preference sharing is currently disabled.");
            List<UUID> shared=memory.consentedMembers(scope.id());
            if(shared.size()>50)throw error(HttpStatus.UNPROCESSABLE_ENTITY,"This household has too many shared profiles for a single plan. Choose a smaller household before planning.");
            if(lock){Set<UUID> lockedMembers=new TreeSet<>(shared);lockedMembers.add(actor);lockedMembers.forEach(kitchen::lockUser);}
            for(UUID member:shared){
                var consent=memory.sharing(scope.id(),member);if(!consent.enabled())continue;
                Map<String,Object> profile=profiles.preferences(member);
                add(diets,profile.get("dietaryPreferences"));add(allergies,profile.get("allergies"));
                if(!participants.contains(member))participants.add(member);
                consentSnapshot.add(map("member",member.toString(),"version",consent.version(),"profile",profile));
            }
            fields.put("householdDietaryPreferences",List.copyOf(diets));fields.put("householdAllergies",List.copyOf(allergies));fields.put("usedHouseholdPreferences",true);
        }
        List<Feedback> feedback=new ArrayList<>();for(UUID person:participants)feedback.addAll(memory.feedback(scope.id(),person,100));
        feedback.sort(Comparator.comparing(Feedback::updatedAt).reversed().thenComparing(f->f.id().toString()));feedback=feedback.stream().limit(100).toList();
        Set<UUID> publicIds=profiles.publicRecipeIds(new LinkedHashSet<>(feedback.stream().map(Feedback::recipeId).toList()));
        List<Map<String,Object>> weighted=new ArrayList<>();Set<String> likes=new LinkedHashSet<>(),avoids=new LinkedHashSet<>(),cuisines=new LinkedHashSet<>();
        for(Feedback f:feedback){if(!publicIds.contains(f.recipeId()))continue;weighted.add(map("recipeId",f.recipeId().toString(),"rating",f.rating()));add(likes,f.body().get("likedIngredients"));add(avoids,f.body().get("avoidedIngredients"));add(cuisines,f.body().get("preferredCuisines"));}
        fields.put("tasteFeedback",weighted);fields.put("tasteSignals",map("preferredIngredients",likes.stream().limit(20).toList(),"avoidedIngredients",avoids.stream().limit(20).toList(),"preferredCuisines",cuisines.stream().limit(10).toList()));
        if(options.leftovers()){
            var lots=memory.leftovers(scope.id(),1000);
            var recipes=kitchen.publicRecipes(new LinkedHashSet<>(lots.stream().map(GrowthMemoryRepository.Leftover::recipeId).toList()));
            var sessions=kitchen.recordsByIds(scope.id(),new LinkedHashSet<>(lots.stream().map(GrowthMemoryRepository.Leftover::sessionId).toList()),"session");
            fields.put("confirmedLeftovers",lots.stream().filter(l->{
                var source=recipes.get(l.recipeId());var completed=sessions.get(l.sessionId());
                return l.servingsAvailable().signum()>0&&!l.cookedOn().isAfter(asOf)&&(l.useBy()==null||!l.useBy().isBefore(asOf))
                    &&source!=null&&completed!=null&&"completed".equals(completed.body().get("status"))
                    &&l.recipeId().toString().equals(completed.body().get("recipeId"))
                    &&CookSourceVersion.of(source,mapper).equals(completed.body().get("recipeVersion"));
            }).map(GrowthMemoryService::leftoverView).toList());
        }
        fields.put("preferenceContextFingerprint",digest(map("scope",scope.id().toString(),"revision",scope.revision(),"participants",consentSnapshot,"taste",weighted)));
        return new Context("local-ai.v2",fields);
    }
    private Scope access(UUID scope,UUID actor){return kitchen.access(scope,actor).orElseThrow(()->error(HttpStatus.FORBIDDEN,"Your household membership is no longer available."));}
    private String digest(Object value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(value)));}catch(Exception e){throw new IllegalStateException(e);}}
    private static String canonical(Object value){return String.valueOf(value).trim().replaceAll("\\s+"," ").toLowerCase(Locale.ROOT);}
    private static void add(Set<String> target,Object values){if(values instanceof Collection<?> list)for(Object value:list)if(value instanceof String s&&!s.isBlank())target.add(s.trim());}
    private static Map<String,Object> view(KitchenRepository.Record record){Map<String,Object> view=new LinkedHashMap<>(record.body());view.putAll(map("id",record.id().toString(),"version",record.version(),"createdAt",record.createdAt().toString(),"updatedAt",record.updatedAt().toString()));return view;}
    private static ResponseStatusException error(HttpStatus code,String message){return new ResponseStatusException(code,message);}
}
