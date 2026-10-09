package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.MealPlanRepository;
import com.server.letMeCook.repository.MealPlanRepository.SavedPlan;
import com.server.letMeCook.security.RequestIdentity;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class MealPlanService implements MealPlanCanonicalPort {
    private final LocalAIService worker;
    private final MealPlanRepository repository;
    private final ObjectMapper mapper;
    private final InferenceTransactions transactions;
    private PlanningContextPort planningContexts;
    @Autowired private PlatformService platformService;
    @Autowired public void setPlanningContexts(PlanningContextPort contexts) { this.planningContexts = contexts; }
    private Map<String,Object> planningContext(UUID owner, Map<String,Object> request) {
        return planningContext(owner,request,false);
    }
    private Map<String,Object> planningContext(UUID owner, Map<String,Object> request,boolean lockPantry) {
        Map<String,Object> pantry = Map.of();
        boolean usePantry=Boolean.TRUE.equals(request.get("usePantry"));
        boolean useFamily=Boolean.TRUE.equals(request.get("useHouseholdPreferences"));
        boolean useLeftovers=Boolean.TRUE.equals(request.get("useLeftovers"));
        if (usePantry||useFamily||useLeftovers) {
            if (platformService == null || !Boolean.TRUE.equals(platformService.config().get("kitchenEnabled"))) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Kitchen features are currently disabled.");
            if (owner == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sign in to use your pantry.");
            Object household = request.get("householdId");
            UUID scope=household==null?null:uuid(household);
            pantry = planningContexts.load(owner,scope,lockPantry,new PlanningContextPort.Options(usePantry,useFamily,useLeftovers,Boolean.TRUE.equals(request.get("useProfile")))).fields();
        } else if(owner!=null&&planningContexts!=null) {
            Object household=request.get("householdId");pantry=planningContexts.load(owner,household==null?null:uuid(household),lockPantry,new PlanningContextPort.Options(false,false,false,Boolean.TRUE.equals(request.get("useProfile")))).fields();
        }
        // Read preferences after a possible pantry-lock wait, before the final CAS.
        Map<String,Object> result = new LinkedHashMap<>(context(owner, (boolean)request.get("useProfile")));
        result.putAll(pantry);
        if(useFamily)result.put("householdRestrictions",Map.of("dietaryPreferences",result.getOrDefault("householdDietaryPreferences",List.of()),"allergies",result.getOrDefault("householdAllergies",List.of())));
        mergeRestrictions(result,"dietaryPreferences","householdDietaryPreferences");
        mergeRestrictions(result,"allergies","householdAllergies");
        result.put("contractVersion","local-ai.v2");
        return result;
    }
    private static void mergeRestrictions(Map<String,Object> profile,String own,String family){
        Object shared=profile.remove(family);if(!(shared instanceof Collection<?> members))return;
        Set<Object> values=new LinkedHashSet<>();if(profile.get(own) instanceof Collection<?> current)values.addAll(current);values.addAll(members);profile.put(own,new ArrayList<>(values));
    }

    public MealPlanService(LocalAIService worker, MealPlanRepository repository, ObjectMapper mapper) {
        this(worker,repository,mapper,null);
    }
    @Autowired
    public MealPlanService(LocalAIService worker, MealPlanRepository repository, ObjectMapper mapper,InferenceTransactions transactions) {
        this.worker = worker;
        this.repository = repository;
        this.mapper = mapper;
        this.transactions=transactions;
    }
    private <T> T snapshot(java.util.function.Supplier<T> action){return transactions==null?action.get():transactions.snapshot(action);}
    private <T> T commit(java.util.function.Supplier<T> action){return transactions==null?action.get():transactions.commit(action);}
    private <T> T outside(java.util.function.Supplier<T> action){return transactions==null?action.get():transactions.outside(action);}

    public Map<String, Object> generate(Map<String, Object> input, Jwt jwt) {
        Map<String, Object> request = settings(input);
        UUID owner=RequestIdentity.optionalUserId(jwt);
        request.put("profile", snapshot(()->planningContext(owner, request)));
        return canonical("/ai/meal-plan/generate", request, false,owner);
    }

    public Map<String, Object> recalculate(Map<String, Object> input, Jwt jwt) {
        return recalculateFor(input, RequestIdentity.optionalUserId(jwt));
    }

    public Map<String, Object> whatIf(Map<String, Object> input, Jwt jwt) {
        UUID owner=RequestIdentity.optionalUserId(jwt);
        return canonical("/ai/meal-plan/what-if", signedRequest(input, owner), false,owner);
    }

    public Map<String, Object> refreshPrices(Map<String, Object> input, Jwt jwt) {
        UUID owner = requireUser(jwt);
        return canonical("/ai/meal-plan/refresh-prices", signedRequest(input, owner), true,owner);
    }

    public Map<String, Object> preferences(Jwt jwt) {
        return context(requireUser(jwt), true);
    }

    public Map<String, Object> save(Map<String, Object> input, Jwt jwt) {
        UUID owner = requireUser(jwt);
        Map<String, Object> request = signedRequest(input,owner);
        LocalDate week = week(request.get("weekStart"));
        int version = input.containsKey("version") ? integer(input.get("version"), "version", 0, Integer.MAX_VALUE - 1) : 0;
        Optional<SavedPlan> existing = snapshot(()->repository.find(owner, week));
        if ((existing.isPresent() && existing.get().version() != version) || (existing.isEmpty() && version != 0)) {
            throw MealPlanRepository.conflict();
        }
        Map<String, Object> plan = canonical("/ai/meal-plan/recalculate",request,true,owner);
        if (((List<?>) plan.get("meals")).isEmpty()) throw bad("Choose at least one dinner before saving.");
        // The final database compare-and-set also catches races during worker recalculation.
        return commit(()->{
            revalidateContext(owner,request,true);
            validateRecipeVisibility(plan,request);
            return withMetadata(plan, repository.save(owner, week, version, plan));
        });
    }

    public Map<String, Object> load(String weekStart, Jwt jwt) {
        UUID owner = requireUser(jwt);
        Optional<SavedPlan> saved = snapshot(()->repository.find(owner, week(weekStart)));
        Map<String, Object> response = new LinkedHashMap<>();
        if (saved.isEmpty()) { response.put("plan", null); return response; }
        SavedPlan record = saved.get();
        try {
            Map<String,Object> plan=recalculateFor(savedRequest(record), owner);
            snapshot(()->{assertSavedVersion(owner,record);return null;});
            response.put("plan", withMetadata(plan, record));
        } catch (ResponseStatusException error) {
            if (error.getStatusCode().value() != 400 && error.getStatusCode().value() != 422) throw error;
            snapshot(()->{assertSavedVersion(owner,record);return null;});
            // An owned week still exists for CAS replacement, but invalid snapshots must stay private.
            response.put("plan", null);
            response.put("invalidSavedPlan", Map.of("id", record.id().toString(), "version", record.version(),
                    "weekStart", record.weekStart().toString(), "invalid", true,
                    "message", "This saved plan no longer meets current recipe or preference requirements. Generate a new plan to replace it."));
        }
        return response;
    }

    private Map<String, Object> savedRequest(SavedPlan record) {
        Map<String, Object> stored = record.plan();
        Map<String, Object> request = new LinkedHashMap<>(object(stored.get("settings"), "Saved settings"));
        request.put("weekStart", record.weekStart().toString());
        request.put("servings", stored.get("servings"));
        request.put("intent", stored.get("intent"));
        List<Map<String, Object>> selections = new ArrayList<>();
        for (Object raw : list(stored.get("meals"), "Saved meals", 7)) {
            Map<String, Object> meal = object(raw, "Saved meal");
            Map<String, Object> recipe = object(meal.get("recipe"), "Saved recipe");
            Map<String,Object> selected=new LinkedHashMap<>(Map.of("dayIndex",meal.get("dayIndex"),"recipeId",recipe.get("id")));
            if(meal.get("reuse") instanceof Map<?,?> reuse){selected.put("leftoverId",reuse.get("leftoverId"));selected.put("leftoverVersion",reuse.get("version"));}selections.add(selected);
        }
        request.put("meals", selections);
        request.put("checkedItems", stored.getOrDefault("checkedItems", List.of()));
        // Rebuild, rather than returning a snapshot with possibly stale/private recipe data.
        return request;
    }

    private Map<String, Object> recalculateFor(Map<String, Object> input, UUID owner) {
        return canonical("/ai/meal-plan/recalculate", signedRequest(input, owner), true,owner);
    }

    private Map<String, Object> signedRequest(Map<String, Object> input, UUID owner) {
        Map<String, Object> request = settings(input);
        Map<String, Object> intent = object(input.get("intent"), "intent");
        try {
            if (mapper.writeValueAsString(intent).length() > 524_288) throw bad("Intent is too large. Generate the plan again.");
        } catch (java.io.IOException error) { throw bad("Intent must be a JSON object."); }
        // Preserve every worker-signed metadata envelope, including pinned prices.
        request.put("intent", intent);
        request.put("meals", selections(input.get("meals")));
        if(!Boolean.TRUE.equals(request.get("useLeftovers"))&&((List<?>)request.get("meals")).stream().anyMatch(raw->((Map<?,?>)raw).containsKey("leftoverId")))throw bad("Enable confirmed leftovers before selecting a leftover meal.");
        request.put("checkedItems", strings(input.getOrDefault("checkedItems", List.of()), "checkedItems", 500, 200));
        request.put("profile", snapshot(()->planningContext(owner, request)));
        return request;
    }

    private Map<String, Object> canonical(String endpoint, Map<String, Object> request, boolean revalidateSelections,UUID owner) {
        Map<String, Object> result = outside(()->worker.post(endpoint, request));
        return snapshot(()->{revalidateContext(owner,request,false);return validatedCanonical(result,request,revalidateSelections);});
    }
    private void revalidateContext(UUID owner,Map<String,Object> request,boolean lockPantry) {
        if(!Objects.equals(request.get("profile"),planningContext(owner,request,lockPantry)))throw new ResponseStatusException(HttpStatus.CONFLICT,"Your kitchen or cooking preferences changed. Refresh and try again.");
    }
    private void assertSavedVersion(UUID owner,SavedPlan previous) {
        SavedPlan current=repository.find(owner,previous.weekStart()).orElseThrow(MealPlanRepository::conflict);
        if(!current.id().equals(previous.id())||current.version()!=previous.version())throw MealPlanRepository.conflict();
    }
    private Map<String, Object> validatedCanonical(Map<String, Object> result, Map<String, Object> request, boolean revalidateSelections) {
        if (result == null || !request.get("weekStart").equals(result.get("weekStart"))
                || !Objects.equals(request.get("servings"), result.get("servings"))) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Local planner returned an invalid plan.");
        }
        List<?> meals = list(result.get("meals"), "Planner meals", 7);
        Set<UUID> recipeIds = new LinkedHashSet<>();
        Map<Integer, UUID> selected = new LinkedHashMap<>();
        LocalDate start = week(request.get("weekStart"));
        for (Object raw : meals) {
            Map<String, Object> meal = object(raw, "Planner meal");
            int day = integer(meal.get("dayIndex"), "dayIndex", 0, (int)request.get("mealCount") - 1);
            UUID id = uuid(object(meal.get("recipe"), "Planner recipe").get("id"));
            if (selected.put(day, id) != null || !recipeIds.add(id)
                    || !start.plusDays(day).toString().equals(meal.get("date"))) {
                throw bad("Each dinner must have a distinct recipe and a valid date in this week.");
            }
        }
        if (revalidateSelections) {
            Map<Integer, UUID> expected = new LinkedHashMap<>();
            for (Map<String, Object> meal : selections(request.get("meals"))) expected.put((int) meal.get("dayIndex"), uuid(meal.get("recipeId")));
            if (!expected.equals(selected)) throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Local planner changed your selected dinners. Please retry.");
        }
        validateReuse(meals,request,revalidateSelections);
        for (Object raw : list(result.getOrDefault("alternatives", List.of()), "Planner alternatives", 100)) {
            recipeIds.add(uuid(object(raw, "Planner alternative").get("id")));
        }
        validateRecipeIds(recipeIds,request);
        Set<String> shoppingKeys = new LinkedHashSet<>();
        for (Object raw : list(result.get("shoppingList"), "Planner shopping list", 500)) {
            String key = text(object(raw, "Shopping item").get("key"), "Shopping key", 200);
            if (!key.isBlank()) shoppingKeys.add(key);
        }
        List<String> requestedChecks = strings(request.getOrDefault("checkedItems", List.of()), "checkedItems", 500, 200);
        Map<String, Object> plan = new LinkedHashMap<>(result);
        Map<String,Object> settings=new LinkedHashMap<>(request);for(String field:List.of("profile","intent","meals","checkedItems","weekStart","servings"))settings.remove(field);plan.put("settings",settings);
        plan.put("checkedItems", requestedChecks.stream().filter(shoppingKeys::contains).toList());
        return plan;
    }
    private void validateReuse(List<?> meals,Map<String,Object> request,boolean revalidate){
        Map<UUID,Map<String,Object>> lots=new LinkedHashMap<>();Map<UUID,java.math.BigDecimal> used=new HashMap<>();
        Map<String,Object> profile=object(request.get("profile"),"Profile");
        for(Object raw:list(profile.getOrDefault("confirmedLeftovers",List.of()),"Confirmed leftovers",1000)){Map<String,Object> lot=object(raw,"Leftover");lots.put(uuid(lot.get("id")),lot);}
        Map<Integer,Map<String,Object>> selections=new HashMap<>();if(revalidate)for(var meal:selections(request.get("meals")))selections.put((Integer)meal.get("dayIndex"),meal);
        for(Object raw:meals){Map<String,Object> meal=object(raw,"Meal"),expected=selections.get(meal.get("dayIndex"));Object reuseRaw=meal.get("reuse");
            if(reuseRaw==null){if(expected!=null&&expected.containsKey("leftoverId"))throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"Local planner changed the selected leftovers.");continue;}
            if(!Boolean.TRUE.equals(request.get("useLeftovers"))||!((List<?>)request.get("mustUseIngredients")).isEmpty())throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"Local planner returned an unexpected leftover meal.");
            Map<String,Object> reuse=object(reuseRaw,"Leftover allocation");UUID id=uuid(reuse.get("leftoverId"));Map<String,Object> lot=lots.get(id);int version=integer(reuse.get("version"),"Leftover version",1,Integer.MAX_VALUE-1);
            Object quantity=reuse.get("servingsUsed");if(!(quantity instanceof Number n)||!Double.isFinite(n.doubleValue())||n.doubleValue()<=0||n.doubleValue()>1000)throw bad("Local planner returned an invalid leftover quantity.");
            java.math.BigDecimal amount=new java.math.BigDecimal(n.toString());used.merge(id,amount,java.math.BigDecimal::add);
            LocalDate date=LocalDate.parse(meal.get("date").toString());String recipe=object(meal.get("recipe"),"Recipe").get("id").toString();
            if(lot==null||((Number)lot.get("version")).longValue()!=version||!Objects.equals(lot.get("recipeId"),recipe)||!Objects.equals(reuse.get("recipeId"),recipe)||date.isBefore(LocalDate.parse(lot.get("cookedOn").toString()))||
                (lot.get("useBy")==null?date.isAfter(LocalDate.now(java.time.ZoneOffset.UTC)):date.isAfter(LocalDate.parse(lot.get("useBy").toString())))||used.get(id).compareTo(new java.math.BigDecimal(lot.get("servingsAvailable").toString()))>0)
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"The selected leftover is unavailable for this date or serving quantity.");
            if(expected!=null&&(!Objects.equals(expected.get("leftoverId"),id.toString())||((Number)expected.getOrDefault("leftoverVersion",0)).intValue()!=version))throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"Local planner changed the selected leftover meal.");
        }
    }
    private void validateRecipeVisibility(Map<String,Object> plan,Map<String,Object> request) {
        Set<UUID> ids=new HashSet<>();
        for(Object raw:list(plan.get("meals"),"Planner meals",7))ids.add(uuid(object(object(raw,"Planner meal").get("recipe"),"Planner recipe").get("id")));
        for(Object raw:list(plan.getOrDefault("alternatives",List.of()),"Planner alternatives",100))ids.add(uuid(object(raw,"Planner alternative").get("id")));
        validateRecipeIds(ids,request);
    }
    private void validateRecipeIds(Set<UUID> ids,Map<String,Object> request) {
        if(!repository.publicRecipeIds(ids).containsAll(ids))throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"A selected recipe is no longer public. Generate a new plan.");
        Set<String> disliked=new HashSet<>(strings(object(request.get("profile"),"Profile").get("dislikedRecipeIds"),"dislikedRecipeIds",100_000,36));
        if(ids.stream().anyMatch(id->disliked.contains(id.toString())))throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"The plan contains a recipe you excluded.");
    }

    private Map<String, Object> context(UUID owner, boolean useProfile) {
        if (owner == null) return Map.of("dietaryPreferences", List.of(), "allergies", List.of(),
                "favoriteRecipeIds", List.of(), "dislikedRecipeIds", List.of(), "usedProfile", false);
        Map<String, Object> context = new LinkedHashMap<>(repository.preferences(owner));
        context.put("usedProfile", useProfile);
        if (!useProfile) {
            context.put("dietaryPreferences", List.of());
            context.put("allergies", List.of());
            context.put("favoriteRecipeIds", List.of());
        }
        return context;
    }

    private Map<String, Object> settings(Map<String, Object> input) {
        if (input == null) throw bad("Provide plan settings.");
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("weekStart", week(input.get("weekStart")).toString());
        request.put("servings", integer(input.getOrDefault("servings", 2), "servings", 1, 12));
        request.put("maxCookTime", integer(input.getOrDefault("maxCookTime", 45), "maxCookTime", 5, 240));
        request.put("prompt", text(input.getOrDefault("prompt", ""), "prompt", 2000));
        request.put("dietaryPreferences", strings(input.getOrDefault("dietaryPreferences", List.of()), "dietaryPreferences", 50, 100));
        request.put("excludedIngredients", strings(input.getOrDefault("excludedIngredients", List.of()), "excludedIngredients", 50, 100));
        Object useProfile = input.getOrDefault("useProfile", true);
        if (!(useProfile instanceof Boolean)) throw bad("useProfile must be true or false.");
        request.put("useProfile", useProfile);
        Object usePantry = input.getOrDefault("usePantry", false);
        if (!(usePantry instanceof Boolean)) throw bad("usePantry must be true or false.");
        request.put("usePantry", usePantry);
        for(String field:List.of("useHouseholdPreferences","useLeftovers")){
            Object choice=input.getOrDefault(field,false);if(!(choice instanceof Boolean))throw bad(field+" must be true or false.");request.put(field,choice);
        }
        Object household = input.get("householdId");
        request.put("householdId", household == null ? null : uuid(household).toString());
        if(Boolean.TRUE.equals(request.get("useHouseholdPreferences"))&&household==null)throw bad("Choose a household before using shared preferences.");
        int mealCount = integer(input.getOrDefault("mealCount", 7), "mealCount", 1, 7);
        if (!Set.of(1,3,7).contains(mealCount)) throw bad("Choose 1, 3 or 7 dinners.");
        request.put("mealCount", mealCount);
        String mustUseScope = text(input.getOrDefault("mustUseScope", "perMeal"), "mustUseScope", 20);
        if (!Set.of("perMeal", "plan").contains(mustUseScope)) throw bad("Choose a valid must-use scope.");
        request.put("mustUseScope", mustUseScope);
        List<String> mustUse = strings(input.getOrDefault("mustUseIngredients", List.of()), "mustUseIngredients", 10, 120);
        request.put("mustUseIngredients", mustUse);
        Object rawBudget = input.get("budget");
        if (rawBudget != null) {
            Map<String,Object> budget = object(rawBudget, "budget");
            Object rawAmount = budget.get("amount");
            if (!(rawAmount instanceof Number number) || !Double.isFinite(number.doubleValue()) || number.doubleValue() <= 0 || number.doubleValue() > 1000000) throw bad("Budget must be a positive amount up to 1,000,000.");
            if (new java.math.BigDecimal(number.toString()).stripTrailingZeros().scale() > 2) throw bad("Use at most two decimal places for a budget.");
            String currency = text(budget.get("currency"), "currency", 3).toUpperCase(Locale.ROOT);
            try { Currency.getInstance(currency); } catch (IllegalArgumentException error) { throw bad("Choose a valid currency."); }
            request.put("budget", Map.of("amount", number.doubleValue(), "currency", currency));
        } else request.put("budget", null);
        if ((!mustUse.isEmpty() || rawBudget != null) && !Boolean.TRUE.equals(usePantry)) throw bad("Use your confirmed pantry to verify must-use ingredients or a budget.");

        return request;
    }

    private List<Map<String, Object>> selections(Object raw) {
        List<Map<String, Object>> result = new ArrayList<>();
        Set<Integer> days = new HashSet<>();
        Set<UUID> recipes = new HashSet<>();
        for (Object item : list(raw, "meals", 7)) {
            Map<String, Object> meal = object(item, "Meal selection");
            int day = integer(meal.get("dayIndex"), "dayIndex", 0, 6);
            UUID id = uuid(meal.get("recipeId"));
            if (!days.add(day) || !recipes.add(id)) throw bad("Choose distinct recipes for distinct days.");
            Map<String,Object> selection=new LinkedHashMap<>(Map.of("dayIndex",day,"recipeId",id.toString()));
            if(meal.containsKey("leftoverId")||meal.containsKey("leftoverVersion")){
                selection.put("leftoverId",uuid(meal.get("leftoverId")).toString());selection.put("leftoverVersion",integer(meal.get("leftoverVersion"),"leftoverVersion",1,Integer.MAX_VALUE-1));
            }
            result.add(selection);
        }
        return result;
    }

    private static Map<String, Object> withMetadata(Map<String, Object> plan, SavedPlan record) {
        Map<String, Object> result = new LinkedHashMap<>(plan);
        result.put("id", record.id().toString());
        result.put("version", record.version());
        result.put("updatedAt", record.updatedAt().toString());
        return result;
    }

    private static UUID requireUser(Jwt jwt) {
        UUID owner = RequestIdentity.optionalUserId(jwt);
        if (owner == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sign in to save and view your meal plans.");
        return owner;
    }

    private static LocalDate week(Object value) {
        if (!(value instanceof String date) || !date.matches("\\d{4}-\\d{2}-\\d{2}")) throw bad("weekStart must be a date in YYYY-MM-DD format.");
        try {
            LocalDate week = LocalDate.parse(date);
            if (week.getYear() < 1 || week.plusDays(6).getYear() > 9999) throw bad("Choose a valid week.");
            return week;
        } catch (DateTimeParseException error) { throw bad("Choose a valid weekStart date."); }
    }

    private static int integer(Object raw, String field, int minimum, int maximum) {
        if (!(raw instanceof Number value) || value.doubleValue() != value.intValue()
                || value.intValue() < minimum || value.intValue() > maximum) throw bad(field + " must be an integer from " + minimum + " to " + maximum + ".");
        return value.intValue();
    }

    private static String text(Object raw, String field, int maximum) {
        if (!(raw instanceof String value) || value.length() > maximum || value.indexOf('\0') >= 0) throw bad(field + " must be text of at most " + maximum + " characters.");
        return value;
    }

    private static List<String> strings(Object raw, String field, int maximumItems, int maximumLength) {
        Set<String> result = new LinkedHashSet<>();
        for (Object item : list(raw, field, maximumItems)) {
            String value = text(item, field, maximumLength).trim();
            if (value.isBlank()) throw bad(field + " cannot include blank entries.");
            result.add(value);
        }
        return new ArrayList<>(result);
    }

    private static List<?> list(Object raw, String field, int maximum) {
        if (!(raw instanceof List<?> result) || result.size() > maximum) throw bad(field + " must be a list of at most " + maximum + " entries.");
        return result;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> object(Object raw, String field) {
        if (!(raw instanceof Map<?, ?> value) || value.keySet().stream().anyMatch(key -> !(key instanceof String))) throw bad(field + " must be a JSON object.");
        return (Map<String, Object>) value;
    }

    private static UUID uuid(Object raw) {
        try {
            String value = text(raw, "recipeId", 36);
            UUID id = UUID.fromString(value);
            if (!id.toString().equalsIgnoreCase(value)) throw bad("recipeId must be a UUID.");
            return id;
        }
        catch (IllegalArgumentException error) { throw bad("recipeId must be a UUID."); }
    }

    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
}
