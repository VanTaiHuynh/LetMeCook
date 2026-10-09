package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.GrowthMemoryRepository;
import com.server.letMeCook.repository.GrowthMemoryRepository.*;
import com.server.letMeCook.repository.KitchenRepository;
import com.server.letMeCook.repository.KitchenRepository.Scope;
import com.server.letMeCook.security.RequestIdentity;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static com.server.letMeCook.repository.KitchenRepository.map;

@Service
public class GrowthMemoryService {
    private final KitchenRepository kitchen;
    private final GrowthMemoryRepository memory;
    private final PlatformService platform;
    private final ObjectMapper mapper;
    private Clock clock=Clock.systemUTC();
    private KitchenScopeAccess scopeAccess;
    @org.springframework.beans.factory.annotation.Autowired public void setScopeAccess(KitchenScopeAccess access){this.scopeAccess=access;}
    public GrowthMemoryService(KitchenRepository kitchen,GrowthMemoryRepository memory,PlatformService platform,ObjectMapper mapper){this.kitchen=kitchen;this.memory=memory;this.platform=platform;this.mapper=mapper;}
    public void setClock(Clock clock){this.clock=clock;}
    @Transactional public Map<String,Object> sharing(UUID household,Jwt jwt){UUID actor=user(jwt);Scope scope=sharingScope(actor,household);return sharingView(memory.sharing(scope.id(),actor));}
    @Transactional public Map<String,Object> share(UUID household,Map<String,Object> input,Jwt jwt){
        UUID actor=user(jwt);Scope scope=sharingScope(actor,household);kitchen.lock(scope.id());scope=access(scope.id(),actor);
        Object raw=input.get("enabled");if(!(raw instanceof Boolean enabled))throw bad("Choose whether to share your cooking preferences.");
        if(enabled&&(!platform.collaborationEnabled()||!Boolean.TRUE.equals(platform.config().get("kitchenEnabled"))))throw unavailable("Household preference sharing is currently disabled.");
        long expected=version(input,0);if(!memory.saveSharing(scope.id(),actor,enabled,expected))throw conflict("Your sharing choice changed. Refresh and try again.");
        kitchen.revise(scope.id());return sharingView(memory.sharing(scope.id(),actor));
    }
    @Transactional public Map<String,Object> feedback(UUID household,Jwt jwt){UUID actor=user(jwt);Scope scope=scope(actor,household,false);return map("feedback",memory.feedback(scope.id(),actor,100).stream().map(GrowthMemoryService::feedbackView).toList());}
    @Transactional public Map<String,Object> saveFeedback(UUID household,UUID session,Map<String,Object> input,Jwt jwt){
        UUID actor=user(jwt);Scope scope=scope(actor,household,false);kitchen.lock(scope.id());scope=access(scope.id(),actor);
        var completed=completed(scope.id(),session);UUID recipe=uuid(completed.body().get("recipeId"));
        int rating=(int)integer(input.get("rating"),"rating",1,5);long expected=version(input,0);
        Map<String,Object> body=map("likedIngredients",strings(input.getOrDefault("likedIngredients",List.of()),20,120),
            "avoidedIngredients",strings(input.getOrDefault("avoidedIngredients",List.of()),20,120),
            "preferredCuisines",strings(input.getOrDefault("preferredCuisines",List.of()),10,100),"note",text(input.getOrDefault("note",""),"note",300));
        if(!memory.saveFeedback(scope.id(),actor,session,recipe,rating,body,expected))throw conflict("This feedback changed. Refresh before saving it again.");
        kitchen.revise(scope.id());return feedbackView(memory.feedback(scope.id(),actor,session).orElseThrow());
    }
    @Transactional public Map<String,Object> leftovers(UUID household,Jwt jwt){Scope scope=scope(user(jwt),household,false);return map("leftovers",memory.leftovers(scope.id(),1000).stream().map(GrowthMemoryService::leftoverView).toList());}
    @Transactional public Map<String,Object> createLeftover(UUID household,Map<String,Object> input,Jwt jwt){
        UUID actor=user(jwt);Scope scope=scope(actor,household,true);confirmed(input);
        UUID session=uuid(input.get("sessionId"));BigDecimal servings=quantity(input.get("servingsAvailable"));LocalDate cooked=date(input.get("cookedOn"),"cookedOn"),useBy=input.get("useBy")==null?null:date(input.get("useBy"),"useBy");
        if(cooked.isAfter(LocalDate.now(clock)))throw bad("The cooking date cannot be in the future.");
        if(useBy!=null&&useBy.isBefore(cooked))throw bad("Choose a use-by date on or after the cooking date.");
        String key=key(input),fingerprint=hash(map("action","create","sessionId",session.toString(),"servings",servings.stripTrailingZeros().toPlainString(),"cookedOn",cooked.toString(),"useBy",useBy==null?null:useBy.toString()));
        Optional<Map<String,Object>> replay=replay(scope.id(),actor,key,fingerprint);if(replay.isPresent())return replay.get();
        var completed=completed(scope.id(),session);
        if(memory.leftoverForSession(scope.id(),session).isPresent())throw conflict("Leftovers from this meal are already recorded. Use the existing record.");
        if(memory.leftovers(scope.id(),1001).size()>=1000)throw conflict("This kitchen has reached its leftover record limit.");
        UUID recipe=uuid(completed.body().get("recipeId"));String title=text(completed.body().get("recipeTitle"),"title",500);
        Map<String,Object> response=leftoverView(memory.insertLeftover(scope.id(),actor,session,recipe,title,servings,cooked,useBy));
        kitchen.revise(scope.id());memory.receipt(scope.id(),actor,key,fingerprint,response);return response;
    }
    @Transactional public Map<String,Object> consume(UUID household,UUID id,Map<String,Object> input,Jwt jwt){
        UUID actor=user(jwt);Scope scope=scope(actor,household,true);confirmed(input);long expected=version(input,1);BigDecimal amount=quantity(input.get("servings"));LocalDate consumed=date(input.get("consumedOn"),"consumedOn");
        String key=key(input),fingerprint=hash(map("action","consume","id",id.toString(),"version",expected,"servings",amount.stripTrailingZeros().toPlainString(),"consumedOn",consumed.toString()));
        Optional<Map<String,Object>> replay=replay(scope.id(),actor,key,fingerprint);if(replay.isPresent()){Map<String,Object> response=new LinkedHashMap<>(replay.get());response.put("replayed",true);return response;}
        Leftover lot=memory.leftover(scope.id(),id).orElseThrow(()->missing("This leftover is unavailable."));
        if(consumed.isBefore(lot.cookedOn())||consumed.isAfter(LocalDate.now(clock)))throw bad("Choose a consumption date between the cooking date and today.");
        if(lot.useBy()!=null&&(consumed.isAfter(lot.useBy())||LocalDate.now(clock).isAfter(lot.useBy())))throw bad("This is past your chosen use-by date. Do not use it through this action.");
        if(lot.version()!=expected||!memory.consume(scope.id(),id,expected,amount))throw conflict("This leftover changed or has insufficient servings. Refresh and try again.");
        Map<String,Object> result=map("leftover",leftoverView(memory.leftover(scope.id(),id).orElseThrow()),"consumedServings",amount,"replayed",false);
        kitchen.revise(scope.id());memory.receipt(scope.id(),actor,key,fingerprint,result);return result;
    }
    private Optional<Map<String,Object>> replay(UUID scope,UUID actor,String key,String fingerprint){return memory.receipt(scope,key).map(receipt->{if(!actor.equals(receipt.actor())||!fingerprint.equals(receipt.fingerprint()))throw conflict("This operation key was already used for another request.");return receipt.response();});}
    private KitchenRepository.Record completed(UUID scope,UUID session){var record=kitchen.record(scope,session,"session").orElseThrow(()->missing("This cooking session is unavailable."));if(!"completed".equals(record.body().get("status")))throw conflict("Confirm the cooked meal before recording feedback or leftovers.");return record;}
    private Scope access(UUID scope,UUID actor){return kitchen.access(scope,actor).orElseThrow(()->forbidden("You are no longer a member of this kitchen."));}
    private Scope sharingScope(UUID actor,UUID household){if(household==null)throw bad("Choose a household.");Scope scope=access(household,actor);household(scope);return scope;}
    private Scope scope(UUID actor,UUID household,boolean write){
        if(scopeAccess!=null)return scopeAccess.require(actor,household,write?KitchenScopeAccess.Access.WRITE:KitchenScopeAccess.Access.READ);
        if(!Boolean.TRUE.equals(platform.config().get("kitchenEnabled")))throw unavailable("Kitchen features are currently disabled.");
        Scope scope=household==null?kitchen.personal(actor):access(household,actor);if(household!=null&&!"household".equals(scope.kind()))throw forbidden("Choose an accepted household.");
        if(write){kitchen.lock(scope.id());scope=access(scope.id(),actor);if("viewer".equals(scope.role()))throw forbidden("Viewers cannot change leftovers.");if("household".equals(scope.kind())&&!"owner".equals(scope.role())&&!platform.collaborationEnabled())throw unavailable("Shared kitchen changes are currently disabled.");}return scope;
    }
    public static Map<String,Object> leftoverView(Leftover lot){return map("id",lot.id().toString(),"sessionId",lot.sessionId().toString(),"recipeId",lot.recipeId().toString(),"title",lot.title(),"servingsAvailable",lot.servingsAvailable(),"cookedOn",lot.cookedOn().toString(),"useBy",lot.useBy()==null?null:lot.useBy().toString(),"confirmedAt",lot.confirmedAt().toString(),"version",lot.version());}
    private static Map<String,Object> sharingView(Sharing value){return map("enabled",value.enabled(),"version",value.version(),"updatedAt",value.updatedAt()==null?null:value.updatedAt().toString());}
    private static Map<String,Object> feedbackView(Feedback value){Map<String,Object> result=new LinkedHashMap<>(value.body());result.putAll(map("id",value.id().toString(),"sessionId",value.sessionId().toString(),"recipeId",value.recipeId().toString(),"rating",value.rating(),"version",value.version(),"updatedAt",value.updatedAt().toString()));return result;}
    private String hash(Object value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(value)));}catch(Exception e){throw new IllegalStateException(e);}}
    private static UUID user(Jwt jwt){UUID id=RequestIdentity.optionalUserId(jwt);if(id==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Sign in to use your cooking history.");return id;}
    private static void household(Scope scope){if(!"household".equals(scope.kind()))throw bad("Choose a household.");}
    private static void confirmed(Map<String,Object> input){if(!Boolean.TRUE.equals(input.get("confirmed")))throw bad("Confirm the quantity and date before continuing.");}
    private static String key(Map<String,Object> input){String key=text(input.get("idempotencyKey"),"idempotencyKey",100);if(key.length()<8)throw bad("Use an operation key of 8–100 characters.");return key;}
    private static long version(Map<String,Object> input,int min){return integer(input.get("version"),"version",min,Integer.MAX_VALUE-1);}
    private static long integer(Object value,String field,int min,int max){if(!(value instanceof Number n)||!Double.isFinite(n.doubleValue())||n.doubleValue()!=n.longValue()||n.longValue()<min||n.longValue()>max)throw bad(field+" must be an integer from "+min+" to "+max+".");return n.longValue();}
    private static BigDecimal quantity(Object raw){if(!(raw instanceof Number n)||!Double.isFinite(n.doubleValue()))throw bad("Enter a confirmed number of servings.");BigDecimal q=new BigDecimal(n.toString()).stripTrailingZeros();if(q.signum()<=0||q.compareTo(BigDecimal.valueOf(1000))>0||q.scale()>3)throw bad("Servings must be positive, at most 1,000, with at most three decimals.");return q;}
    private static UUID uuid(Object raw){String value=text(raw,"id",36);try{UUID id=UUID.fromString(value);if(!id.toString().equalsIgnoreCase(value))throw bad("Choose a valid ID.");return id;}catch(IllegalArgumentException e){throw bad("Choose a valid ID.");}}
    private static LocalDate date(Object raw,String field){String value=text(raw,field,10);try{LocalDate d=LocalDate.parse(value);if(!d.toString().equals(value)||d.getYear()<1||d.getYear()>9999)throw bad("Choose a valid "+field+" date.");return d;}catch(java.time.format.DateTimeParseException e){throw bad("Choose a valid "+field+" date.");}}
    private static String text(Object raw,String field,int max){if(!(raw instanceof String s)||s.length()>max||s.indexOf('\0')>=0)throw bad(field+" must be text of at most "+max+" characters.");return s.trim();}
    private static List<String> strings(Object raw,int max,int length){if(!(raw instanceof List<?> list)||list.size()>max)throw bad("Too many preference entries.");Set<String> result=new LinkedHashSet<>();for(Object value:list){String s=text(value,"Preference",length);if(s.isBlank())throw bad("Preference names cannot be blank.");result.add(s);}return List.copyOf(result);}
    private static ResponseStatusException bad(String s){return new ResponseStatusException(HttpStatus.BAD_REQUEST,s);}
    private static ResponseStatusException missing(String s){return new ResponseStatusException(HttpStatus.NOT_FOUND,s);}
    private static ResponseStatusException forbidden(String s){return new ResponseStatusException(HttpStatus.FORBIDDEN,s);}
    private static ResponseStatusException conflict(String s){return new ResponseStatusException(HttpStatus.CONFLICT,s);}
    private static ResponseStatusException unavailable(String s){return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,s);}
}
