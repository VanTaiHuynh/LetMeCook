package com.server.letMeCook.service;

import com.server.letMeCook.repository.KitchenRepository;
import com.server.letMeCook.repository.KitchenRepository.Scope;
import com.server.letMeCook.repository.KitchenRepository.Record;
import com.server.letMeCook.repository.KitchenRepository.Recipe;
import com.server.letMeCook.repository.KitchenRepository.Cohort;
import com.server.letMeCook.repository.MealPlanRepository;
import com.server.letMeCook.security.RequestIdentity;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.*;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static com.server.letMeCook.repository.KitchenRepository.map;

/** Trusted gateway: record snapshots are built from the database, never caller identities. */
@Service
public class KitchenService {
    private final KitchenRepository repository;
    private final LocalAIService worker;
    private final MealPlanCanonicalPort planner;
    private final MealPlanRepository profiles;
    private final ObjectMapper mapper;
    private final InferenceTransactions transactions;
    private final SecureRandom random=new SecureRandom();
    private PlatformService platform;
    private Clock clock=Clock.systemUTC();
    private KitchenScopeAccess scopeAccess;
    private PlanningContextPort growthContext;
    @Autowired public void setScopeAccess(KitchenScopeAccess access){this.scopeAccess=access;}
    @Autowired public void setGrowthContext(PlanningContextPort context){this.growthContext=context;}
    @Autowired public void setPlatformService(PlatformService platform){this.platform=platform;}
    @Value("${kitchen.release-version:${KITCHEN_RELEASE_VERSION:2026.10.08-kitchen}}")
    private String releaseVersion="2026.10.08-kitchen";
    public KitchenService(KitchenRepository repository,LocalAIService worker,MealPlanCanonicalPort planner,MealPlanRepository profiles,ObjectMapper mapper) {
        this(repository,worker,planner,profiles,mapper,null);
    }
    @Autowired
    public KitchenService(KitchenRepository repository,LocalAIService worker,MealPlanCanonicalPort planner,MealPlanRepository profiles,ObjectMapper mapper,InferenceTransactions transactions) {
        this.repository=repository;this.worker=worker;this.planner=planner;this.profiles=profiles;this.mapper=mapper;this.transactions=transactions;
    }
    private <T> T snapshot(java.util.function.Supplier<T> action){return transactions==null?action.get():transactions.snapshot(action);}
    private <T> T commit(java.util.function.Supplier<T> action){return transactions==null?action.get():transactions.commit(action);}
    private <T> T outside(java.util.function.Supplier<T> action){return transactions==null?action.get():transactions.outside(action);}

    @Transactional
    public Map<String,Object> bootstrap(UUID household,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,false,false);
        List<Record> pantry=repository.records(scope.id(),"pantry",1000);
        List<Record> sessions=repository.records(scope.id(),"session",10);
        return map("scope",scopeView(scope),"households",repository.households(user),"pantry",views(pantry),
            "priceBook",views(repository.records(scope.id(),"price",1000)),"substitutions",views(repository.records(scope.id(),"swap",1000)),
            "consent",repository.consent(user),"stats",map("pantryLots",pantry.size(),"confirmedMeals",repository.evidenceTimes(scope.id()).size()),
            "recentSessions",views(sessions),"workspace",repository.records(scope.id(),"workspace",1).stream().findFirst().map(this::view).orElse(null),
            "features",map("collaborationEnabled",collaborationEnabled()),"cohorts",repository.cohorts(scope.id()).stream().map(this::cohortView).toList());
    }
    @Transactional
    public Map<String,Object> plannerContext(UUID owner,UUID household) {
        if(owner==null)throw unauthenticated();
        Scope scope=scope(owner,household,false,false);
        return planningContext(scope);
    }
    @Transactional
    public Map<String,Object> lockedPlannerContext(UUID owner,UUID household) {
        if(owner==null)throw unauthenticated();
        Scope scope=scope(owner,household,false,false);repository.lock(scope.id());
        scope=repository.access(scope.id(),owner).orElseThrow(()->forbidden("Your kitchen membership is no longer available."));
        return planningContext(scope);
    }
    private Map<String,Object> planningContext(Scope scope) {
        LocalDate asOf=LocalDate.now(ZoneOffset.UTC);
        return map("availableIngredients",available(scope.id(),asOf),"pantryRevision",scope.revision(),
            "pantry",views(repository.records(scope.id(),"pantry",1000)),"priceBook",views(repository.records(scope.id(),"price",1000)),
            "ingredientAliases",repository.reviewedAliases(),"asOf",asOf.toString());
    }
    @Transactional
    public Map<String,Object> createHousehold(Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);Scope scope=repository.createHousehold(user,required(input,"name",100));
        return map("id",scope.id().toString(),"name",scope.name(),"role","owner");
    }
    @Transactional
    public Map<String,Object> members(UUID household,Jwt jwt) {
        Scope scope=scope(user(jwt),household,false,false);household(scope);
        return map("members",repository.members(scope.id()));
    }
    @Transactional
    public Map<String,Object> invite(UUID household,Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,true,true);household(scope);requireCollaboration();
        String role=memberRole(input.get("role"));byte[] bytes=new byte[24];random.nextBytes(bytes);
        String code=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);Instant expires=Instant.now().plus(Duration.ofDays(7));
        repository.invite(scope.id(),user,hash(code),role,expires);repository.revise(scope.id());
        return map("code",code,"expiresAt",expires.toString());
    }
    @Transactional
    public Map<String,Object> acceptInvite(Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);requireCollaboration();String code=required(input,"code",100);String hashed=hash(code);
        var preview=repository.invite(hashed,false).orElseThrow(()->missing("Invite is unavailable."));
        repository.lock(preview.scopeId());
        var invite=repository.invite(hashed,true).orElseThrow(()->missing("Invite is unavailable."));
        if(invite.usedAt()!=null||!invite.expiresAt().isAfter(Instant.now()))throw conflict("This invite has expired or has already been accepted.");
        if(repository.access(invite.scopeId(),user).isPresent())throw conflict("You already belong to this household.");
        if(repository.accept(invite,user,Instant.now())!=1)throw conflict("This invite has expired or has already been accepted.");
        repository.addMember(invite.scopeId(),user,invite.role());repository.revise(invite.scopeId());
        Scope scope=repository.access(invite.scopeId(),user).orElseThrow();
        return map("id",scope.id().toString(),"name",scope.name(),"role",scope.role());
    }
    @Transactional
    public Map<String,Object> changeRole(UUID household,UUID member,Map<String,Object> input,Jwt jwt) {
        Scope scope=scope(user(jwt),household,true,true);household(scope);requireCollaboration();
        if(scope.ownerId().equals(member))throw bad("The household owner's role cannot be changed.");
        String role=memberRole(input.get("role"));
        if(repository.changeRole(scope.id(),member,role)!=1)throw missing("This member is unavailable.");
        repository.revise(scope.id());return map("userId",member.toString(),"role",role);
    }
    @Transactional
    public Map<String,Object> savePantry(UUID household,UUID id,Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,true,false);confirm(input,"confirmed");
        Map<String,Object> body=pantry(input);
        Record saved;
        String key=null,fingerprint=null;UUID line=null;
        if(id==null) {
            key=operationKey(input);line=uuid(input.get("lineId"),"lineId");
            fingerprint=hash(json(body));
            var replay=repository.pantryReceipt(scope.id(),key,line);
            if(replay.isPresent()) {
                if(!Objects.equals(replay.get().actorId(),user)||!replay.get().fingerprint().equals(fingerprint))throw conflict("This pantry operation key and line have already been used for another request.");
                return replay.get().response();
            }
            assertRevision(scope,input);
            capacity(scope.id(),"pantry");saved=repository.insert(scope.id(),user,"pantry",body);
            repository.ledger(scope.id(),user,saved,"added",nullableDecimal(body.get("quantity")),null);
        } else {
            Record old=record(scope.id(),id,"pantry");long version=version(input,1);assertVersion(old,version);
            saved=repository.update(scope.id(),id,"pantry",version,body).orElseThrow(()->conflict("This pantry lot has changed. Reload before saving."));
            BigDecimal before=nullableDecimal(old.body().get("quantity")),after=nullableDecimal(body.get("quantity"));
            // A name/unit change is a removal plus an addition, not a misleading numeric adjustment.
            if(!Objects.equals(old.body().get("ingredient"),body.get("ingredient"))||!Objects.equals(old.body().get("unit"),body.get("unit"))) {
                repository.ledger(scope.id(),user,old,"removed",before==null?null:before.negate(),null);
                repository.ledger(scope.id(),user,saved,"added",after,null);
            } else repository.ledger(scope.id(),user,saved,"updated",before==null||after==null?null:after.subtract(before),null);
        }
        repository.revise(scope.id());Map<String,Object> result=view(saved);result.put("aggregateRevision",scope.revision()+1);
        if(id==null)repository.pantryReceipt(scope.id(),user,key,line,fingerprint,result);
        return result;
    }
    @Transactional
    public Map<String,Object> deletePantry(UUID household,UUID id,long version,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,true,false);Record old=record(scope.id(),id,"pantry");assertVersion(old,version);
        if(repository.delete(scope.id(),id,"pantry",version)!=1)throw conflict("This pantry lot has changed. Reload before deleting.");
        BigDecimal quantity=nullableDecimal(old.body().get("quantity"));repository.ledger(scope.id(),user,old,"removed",quantity==null?null:quantity.negate(),null);
        repository.revise(scope.id());return map("deleted",true);
    }
    @Transactional
    public Map<String,Object> ledger(UUID household,Jwt jwt) {Scope scope=scope(user(jwt),household,false,false);return map("entries",repository.ledger(scope.id()));}
    @Transactional
    public Map<String,Object> savePrice(UUID household,Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,true,false);capacity(scope.id(),"price");
        String currency=required(input,"currency",3).toUpperCase(Locale.ROOT);
        try{Currency.getInstance(currency);}catch(IllegalArgumentException error){throw bad("Choose a valid three-letter currency.");}
        String observed=date(input.get("observedOn"),"observedOn",false);
        if(LocalDate.parse(observed).isAfter(LocalDate.now(ZoneOffset.UTC)))throw bad("A price observation cannot be dated in the future.");
        Map<String,Object> body=map("ingredient",canonical(required(input,"ingredient",120)),"unit",canonical(required(input,"unit",60)),
            "packQuantity",positive(input.get("packQuantity"),"packQuantity",1_000_000),"packPrice",positive(input.get("packPrice"),"packPrice",1_000_000_000),
            "currency",currency,"source",required(input,"source",2000),"area",required(map("area",input.getOrDefault("area","Local")),"area",200),"observedOn",observed);
        Record saved=repository.insert(scope.id(),user,"price",body);repository.revise(scope.id());return view(saved);
    }
    @Transactional
    public Map<String,Object> deleteRecord(UUID household,UUID id,String kind,boolean ownerOnly,Jwt jwt) {
        Scope scope=scope(user(jwt),household,true,ownerOnly);Record found=record(scope.id(),id,kind);
        if(repository.delete(scope.id(),id,kind,found.version())!=1)throw conflict("This item has changed. Reload before deleting.");
        repository.revise(scope.id());return map("deleted",true);
    }
    @Transactional
    public Map<String,Object> shopping(UUID household,Jwt jwt) {
        Scope scope=scope(user(jwt),household,false,false);
        return repository.records(scope.id(),"shopping",1).stream().findFirst().map(this::view).orElse(map("version",0,"items",List.of(),"planWeekStart",null));
    }
    @Transactional
    public Map<String,Object> saveShopping(UUID household,Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,true,false);long expected=version(input,0);
        List<Map<String,Object>> items=new ArrayList<>();Set<String> keys=new HashSet<>();
        for(Object raw:list(input.get("items"),"items",500)) {
            Map<String,Object> item=object(raw,"Shopping item");String key=required(item,"key",200);
            if(!keys.add(key))throw bad("Shopping item keys must be distinct.");
            items.add(map("key",key,"ingredient",required(item,"ingredient",120),"quantityText",text(item.getOrDefault("quantityText",""),"quantityText",300),"checked",bool(item.getOrDefault("checked",false),"checked")));
        }
        Map<String,Object> body=map("items",items,"planWeekStart",date(input.get("planWeekStart"),"planWeekStart",true));
        Record saved=singleton(scope.id(),user,"shopping",body,expected);repository.revise(scope.id());return view(saved);
    }
    @Transactional
    public Map<String,Object> startSession(UUID household,Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,true,false);UUID recipeId=uuid(input.get("recipeId"),"recipeId");
        Recipe recipe=accessibleRecipe(scope,user,recipeId);List<String> steps=steps(recipe.directions());
        if(steps.isEmpty())throw invalid("This recipe has no cooking instructions.");
        Map<String,Object> body=map("recipeId",recipe.id().toString(),"recipeTitle",recipe.title(),"steps",steps,"sourceUrl",recipe.sourceUrl(),
            "stepIndex",0,"timers",List.of(),"messages",List.of(),"status","active","servings",integer(input.get("servings"),"servings",1,12),
            "recipeVersion",CookSourceVersion.of(recipe,mapper),"ingredients",recipe.ingredients(),"originalServings",recipe.servings());
        Map<String,Object> mealSlot=mealSlot(input.get("mealSlot"));
        if(mealSlot!=null){authorizeMealSlot(scope,user,mealSlot,recipe.id());body.put("mealSlot",mealSlot);}
        Record session=repository.insert(scope.id(),user,"session",body);repository.revise(scope.id());return revisedView(session,scope);
    }
    @Transactional
    public Map<String,Object> session(UUID household,UUID id,Jwt jwt) {Scope scope=scope(user(jwt),household,false,false);Map<String,Object> result=view(record(scope.id(),id,"session"));result.put("aggregateRevision",scope.revision());return result;}
    @Transactional
    public Map<String,Object> updateSession(UUID household,UUID id,Map<String,Object> input,Jwt jwt) {
        Scope scope=scope(user(jwt),household,true,false);Record session=record(scope.id(),id,"session");active(session);long expected=version(input,1);assertVersion(session,expected);
        Map<String,Object> body=new LinkedHashMap<>(session.body());int count=list(body.get("steps"),"steps",60).size();
        body.put("stepIndex",integer(input.get("stepIndex"),"stepIndex",0,count-1));body.put("timers",timers(input.get("timers")));
        Record saved=repository.update(scope.id(),id,"session",expected,body).orElseThrow(()->conflict("This cooking session has changed. Reload before saving."));repository.revise(scope.id());return revisedView(saved,scope);
    }
    public Map<String,Object> ask(UUID household,UUID id,Map<String,Object> input,Jwt jwt) {
        UUID actor=user(jwt);String question=required(input,"question",1000);
        Record session=snapshot(()->{
            Scope scope=scope(actor,household,false,false);authorizeWrite(scope,false);
            Record current=record(scope.id(),id,"session");active(current);return current;
        });
        List<?> steps=list(session.body().get("steps"),"steps",60);
        List<?> history=list(session.body().get("messages"),"messages",12);
        List<Map<String,Object>> context=new ArrayList<>();for(Object raw:history){Map<String,Object> item=object(raw,"Message");String content=item.get("content").toString();context.add(map("role",item.get("role"),"content",content.substring(0,Math.min(content.length(),1000))));}
        Map<String,Object> response=outside(()->worker.post("/ai/cook/ask",map("question",question,"steps",steps,"stepIndex",session.body().get("stepIndex"),"history",context)));
        if(response==null)throw upstream("The cooking assistant returned no answer.");
        String answer=required(response,"answer",8000);boolean supported=bool(response.get("supported"),"supported");
        List<Map<String,Object>> citations=new ArrayList<>();
        for(Object raw:list(response.getOrDefault("citations",List.of()),"citations",20)) {
            Map<String,Object> citation=object(raw,"Citation");int step=integer(citation.get("stepIndex"),"stepIndex",0,steps.size()-1);String excerpt=required(citation,"text",3000);
            if(!steps.get(step).toString().equals(excerpt))throw upstream("The cooking assistant returned an invalid source citation.");
            citations.add(map("stepIndex",step,"text",excerpt));
        }
        if(supported&&citations.isEmpty())throw upstream("The cooking assistant did not provide a source citation.");
        List<Object> messages=new ArrayList<>(history);String now=Instant.now().toString();
        messages.add(map("role","user","content",question,"createdAt",now));messages.add(map("role","assistant","content",answer,"createdAt",now));
        if(messages.size()>12)messages=new ArrayList<>(messages.subList(messages.size()-12,messages.size()));
        List<Object> appended=messages;
        return commit(()->{
            Scope scope=scope(actor,household,true,false);
            Record current=record(scope.id(),id,"session");active(current);assertVersion(current,session.version());
            Map<String,Object> body=new LinkedHashMap<>(current.body());body.put("messages",appended);
            Record saved=repository.update(scope.id(),id,"session",session.version(),body).orElseThrow(()->conflict("This cooking session has changed. Reload and ask again."));repository.revise(scope.id());
            return map("answer",answer,"citations",citations,"supported",supported,"session",revisedView(saved,scope));
        });
    }
    @Transactional
    public Map<String,Object> complete(UUID household,UUID id,Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,true,false);confirm(input,"confirmed");
        long expected=version(input,1);String key=operationKey(input);
        Map<String,Object> suppliedSlot=mealSlot(input.get("mealSlot"));
        List<Map<String,Object>> consumption=new ArrayList<>();Set<UUID> lotIds=new HashSet<>();
        for(Object raw:list(input.getOrDefault("consumption",List.of()),"consumption",100)) {
            Map<String,Object> item=object(raw,"Consumption");UUID lotId=uuid(item.get("lotId"),"lotId");if(!lotIds.add(lotId))throw bad("A pantry lot can appear only once.");
            consumption.add(map("lotId",lotId.toString(),"quantity",positive(item.get("quantity"),"quantity",1_000_000).stripTrailingZeros(),"version",version(item,1)));
        }
        consumption.sort(Comparator.comparing(item->item.get("lotId").toString()));
        var previous=repository.receipt(scope.id(),key);
        // A receipt remains replayable even if a completed session was removed.
        Record session=previous.isPresent()?null:record(scope.id(),id,"session");
        Map<String,Object> boundSlot=mealSlot(previous.isPresent()?previous.get().response().get("mealSlot"):session.body().get("mealSlot"));
        if(boundSlot!=null&&suppliedSlot!=null&&!boundSlot.equals(suppliedSlot))throw conflict("This cooking session is already linked to a different saved meal slot.");
        Map<String,Object> mealSlot=boundSlot!=null?boundSlot:suppliedSlot;
        Map<String,Object> confirmation=map("sessionId",id.toString(),"actorId",user.toString(),"version",expected,"consumption",consumption);
        // Existing unlinked receipts remain replayable after this additive upgrade.
        if(mealSlot!=null)confirmation.put("mealSlot",mealSlot);
        String fingerprint=hash(json(confirmation));
        if(previous.isPresent()) {
            var receipt=previous.get();
            if(!Objects.equals(receipt.actorId(),user)||!receipt.sessionId().equals(id)||!receipt.fingerprint().equals(fingerprint))throw conflict("This confirmation key has already been used for another request.");
            return receipt.response();
        }
        assertRevision(scope,input);
        active(session);assertVersion(session,expected);
        if(mealSlot!=null)authorizeMealSlot(scope,user,mealSlot,UUID.fromString(session.body().get("recipeId").toString()));
        List<Record> lots=new ArrayList<>();
        for(Map<String,Object> item:consumption) {
            Record lot=record(scope.id(),uuid(item.get("lotId"),"lotId"),"pantry");assertVersion(lot,((Number)item.get("version")).longValue());
            BigDecimal stock=nullableDecimal(lot.body().get("quantity")),amount=(BigDecimal)item.get("quantity");
            if(stock==null||stock.compareTo(amount)<0)throw invalid("Confirm a sufficient known quantity for "+lot.body().get("ingredient")+" before consuming it.");
            lots.add(lot);
        }
        for(int index=0;index<lots.size();index++) {
            Record lot=lots.get(index);BigDecimal amount=(BigDecimal)consumption.get(index).get("quantity");Map<String,Object> body=new LinkedHashMap<>(lot.body());
            body.put("quantity",nullableDecimal(lot.body().get("quantity")).subtract(amount));
            repository.update(scope.id(),lot.id(),"pantry",lot.version(),body).orElseThrow(()->conflict("Pantry stock changed. Reload before confirming."));
            repository.ledger(scope.id(),user,lot,"consumed",amount.negate(),id);
        }
        Map<String,Object> body=new LinkedHashMap<>(session.body());body.put("status","completed");body.put("completedAt",Instant.now().toString());body.put("consumption",consumption);body.put("mealSlot",mealSlot);
        // Stop timers, retaining their labels and expiry for the completed session record.
        List<Map<String,Object>> stopped=new ArrayList<>();for(Object raw:list(body.get("timers"),"timers",20)){Map<String,Object> timer=new LinkedHashMap<>(object(raw,"Timer"));timer.put("running",false);stopped.add(timer);}body.put("timers",stopped);
        Record saved=repository.update(scope.id(),id,"session",expected,body).orElseThrow(()->conflict("Cooking session changed. Reload before confirming."));
        Map<String,Object> result=view(saved);result.put("aggregateRevision",scope.revision()+1);repository.receipt(scope.id(),user,id,key,fingerprint,result);
        if(mealSlot!=null)repository.linkReceipt(scope.id(),key,UUID.fromString(mealSlot.get("planId").toString()),(Integer)mealSlot.get("dayIndex"));
        repository.lockUser(user);repository.evidence(scope.id(),user,id);repository.revise(scope.id());return result;
    }
    @Transactional
    public Map<String,Object> consent(Map<String,Object> input,Jwt jwt) {UUID user=user(jwt);repository.lockUser(user);boolean enabled=bool(input.get("enabled"),"enabled");if(!enabled)repository.invalidateCohorts(user,false,clock.instant());repository.consent(user,enabled);return repository.consent(user);}
    @Transactional
    public Map<String,Object> deleteEvidence(Jwt jwt) {UUID user=user(jwt);repository.lockUser(user);repository.invalidateCohorts(user,true,clock.instant());repository.deleteEvidence(user);repository.consent(user,false);return map("deleted",true,"consent",repository.consent(user));}
    @Transactional
    public Map<String,Object> exportEvidence(Jwt jwt) {
        UUID user=user(jwt);Instant now=Instant.now();List<Map<String,Object>> events=repository.ownEvidence(user,now.minus(Duration.ofDays(90)));
        boolean truncated=events.size()>10000;
        return map("exportedAt",now.toString(),"releaseVersion",releaseVersion,"retentionDays",90,"consent",repository.consent(user),"events",truncated?events.subList(0,10000):events,"truncated",truncated,"cohortEnrollments",repository.ownCohorts(user).stream().map(cohort->map("scopeId",cohort.scopeId().toString(),"cohort",cohortView(cohort))).toList());
    }
    @Transactional
    public Map<String,Object> evidence(UUID household,Jwt jwt) {
        return evidence(household,null,jwt);
    }
    @Transactional
    public Map<String,Object> evidence(UUID household,String cohortName,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,false,false);List<Instant> events=repository.evidenceTimes(scope.id());
        Optional<Cohort> selected=cohortName==null?repository.cohorts(scope.id()).stream().findFirst():repository.cohort(scope.id(),canonical(required(map("cohortName",cohortName),"cohortName",100)));
        LocalDate today=LocalDate.now(ZoneOffset.UTC);Set<LocalDate> days=new HashSet<>();Map<LocalDate,Long> weekly=new TreeMap<>();
        for(Instant instant:events){LocalDate day=instant.atOffset(ZoneOffset.UTC).toLocalDate();days.add(day);LocalDate week=day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));weekly.merge(week,1L,Long::sum);}
        LocalDate first=events.isEmpty()?null:events.getFirst().atOffset(ZoneOffset.UTC).toLocalDate();
        boolean eligible="household".equals(scope.kind())&&first!=null&&!first.plusDays(28).isAfter(today);
        boolean retained=eligible&&days.stream().anyMatch(day->!day.isBefore(first.plusDays(21))&&day.isBefore(first.plusDays(28)));
        String explanation="Counts include only confirmations from the last 90 days, recorded while their actor consented, with current consent still enabled. Active days and weeks use UTC. "+
            ("household".equals(scope.kind())?"This is a retained-evidence cohort, not lifetime pilot retention: its anchor is the first currently retained consented confirmation. The denominator is this selected household after 28 days from that anchor; week 4 means days 22–28. Expiry or consent changes can move the anchor. No other households are included.":"Personal scope has no household-retention denominator. Select a household to assess its retained-evidence week-4 cohort.");
        return map("consent",repository.consent(user),"period",map("start",first==null?null:first.toString(),"end",today.toString()),"confirmedMeals",events.size(),"activeDays",days.size(),
            "weekly",weekly.entrySet().stream().map(entry->map("week",entry.getKey().toString(),"confirmedMeals",entry.getValue())).toList(),
            "eligibleWeek4Households",eligible?1:0,"retainedWeek4Households",retained?1:0,"week4Retention",eligible?(retained?1.0:0.0):null,"releaseVersion",releaseVersion,"retentionDays",90,"cohortBasis","retained90DayEvidence","cohortWindowText","Last 90 days (UTC); week 4 is days 22–28 after the first currently retained consented confirmation.","explanation",explanation,
            "cohort",selected.map(this::cohortView).orElse(null),"fixedCohort",fixedCohort(selected.orElse(null)));
    }
    @Transactional
    public Map<String,Object> enrollCohort(UUID household,Map<String,Object> input,Jwt jwt) {
        UUID actor=user(jwt);Scope scope=scope(actor,household,true,true);household(scope);confirm(input,"confirmed");
        String name=canonical(required(input,"cohortName",100));repository.lockUser(actor);
        if(!Boolean.TRUE.equals(repository.consent(actor).get("enabled")))throw bad("Enable personal evidence recording before enrolling this household.");
        Optional<Cohort> existing=repository.cohort(scope.id(),name);Cohort cohort;
        if(existing.isPresent()){
            cohort=existing.get();
            if(!"active".equals(cohort.state())||!clock.instant().isBefore(cohort.expiresAt()))throw conflict("This enrollment cannot be restarted. Use a distinct new cohort name for a new study.");
        }else{
            if(repository.cohorts(scope.id()).size()>=20)throw conflict("This kitchen has reached its 20 retained-cohort limit.");
            cohort=repository.enroll(scope.id(),actor,name,clock.instant(),releaseVersion,"2026-10-08-cohort");repository.revise(scope.id());
        }
        return map("cohort",cohortView(cohort),"fixedCohort",fixedCohort(cohort));
    }
    @Transactional
    public Map<String,Object> withdrawCohort(UUID household,UUID id,Map<String,Object> input,Jwt jwt) {
        Scope scope=scope(user(jwt),household,true,true);household(scope);confirm(input,"confirmed");
        Cohort cohort=repository.cohort(scope.id(),id).orElseThrow(()->missing("This cohort enrollment is unavailable."));repository.withdraw(cohort,clock.instant());
        return map("cohort",cohortView(repository.cohort(scope.id(),id).orElseThrow()),"fixedCohort",fixedCohort(repository.cohort(scope.id(),id).orElseThrow()));
    }
    private Map<String,Object> cohortView(Cohort cohort){return map("id",cohort.id().toString(),"name",cohort.name(),"enrolledAt",cohort.enrolledAt().toString(),"expiresAt",cohort.expiresAt().toString(),"state",cohort.state(),"releaseVersion",cohort.releaseVersion(),"consentVersion",cohort.consentVersion());}
    private Map<String,Object> fixedCohort(Cohort cohort) {
        Instant now=clock.instant();String reason=null;Integer denominator=null,numerator=null;Double rate=null;
        Instant start=cohort==null?null:cohort.enrolledAt().plus(Duration.ofDays(21)),end=cohort==null?null:cohort.enrolledAt().plus(Duration.ofDays(28));
        if(cohort==null)reason="notEnrolled";
        else if(!now.isBefore(cohort.expiresAt()))reason="expired";
        else if(!"active".equals(cohort.state()))reason=cohort.state();
        else if(cohort.enrolledBy()==null||!Boolean.TRUE.equals(repository.consent(cohort.enrolledBy()).get("enabled")))reason="incomplete";
        else if(now.isBefore(end)){reason="notMature";denominator=0;}
        else{denominator=1;numerator=repository.cohortReturned(cohort)?1:0;rate=numerator.doubleValue();}
        return map("basis","namedEnrollment","enrolledHouseholds",cohort==null?0:1,"eligibleHouseholds",denominator,"retainedHouseholds",numerator,"week4Retention",rate,"reason",reason,"detail",cohort==null?null:cohort.reason(),"windowStart",start==null?null:start.toString(),"windowEnd",end==null?null:end.toString(),"retentionDays",90,
            "explanation","This selected household is measured only after 28 elapsed days from explicit enrollment. Week 4 is the fixed UTC interval from day 22 through day 28. Withdrawn, incomplete or expired observations have no rate. Enrollment metadata expires after 90 days; no historical cohort is reconstructed from newer activity.");
    }
    @Transactional
    public Map<String,Object> saveSwap(UUID household,Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,true,false);confirm(input,"reviewed");capacity(scope.id(),"swap");
        String from=canonical(required(input,"fromIngredient",120)),to=canonical(required(input,"toIngredient",120));if(from.equals(to))throw bad("Choose two different ingredients.");
        Map<String,Object> body=map("fromIngredient",from,"toIngredient",to,"ratio",positive(input.get("ratio"),"ratio",1000),"note",text(input.getOrDefault("note",""),"note",3000),
            "sourceUrl",url(input.get("sourceUrl")),"reviewed",true,"reviewedBy",user.toString(),"reviewedAt",Instant.now().toString(),"reviewType","user reviewed; not independently certified","approvalStatus","pending");
        Record saved=repository.insert(scope.id(),user,"swap",body);repository.revise(scope.id());return view(saved);
    }
    public Map<String,Object> previewSwap(UUID household,Map<String,Object> input,Jwt jwt) {
        UUID actor=user(jwt);
        SwapSnapshot saved=snapshot(()->{
            Scope scope=scope(actor,household,false,false);Recipe recipe=accessibleRecipe(scope,actor,uuid(input.get("recipeId"),"recipeId"));
            Record swap=record(scope.id(),uuid(input.get("swapId"),"swapId"),"swap");approvedSwap(swap);
            Map<String,Object> profile=trustedProfile(actor,scope,bool(input.getOrDefault("useHouseholdPreferences",false),"useHouseholdPreferences"));
            Map<String,Object> request=map("recipe",map("id",recipe.id().toString(),"title",recipe.title(),"servings",recipe.servings(),"ingredients",recipe.ingredients()),
                "swap",swap.body(),"servings",integer(input.get("servings"),"servings",1,12),"excludedIngredients",profile.getOrDefault("allergies",List.of()),"dietaryPreferences",profile.getOrDefault("dietaryPreferences",List.of()),"ingredientAliases",repository.reviewedAliases());
            return new SwapSnapshot(scope,recipe,swap,profile,request);
        });
        Map<String,Object> response=outside(()->worker.post("/ai/pantry/substitute",saved.request()));
        if(response==null)throw upstream("Substitution preview is unavailable.");
        return snapshot(()->{
            Scope scope=recheckScope(saved.scope(),actor);recheckTrustedProfile(actor,scope,saved.profile());
            Record current=record(scope.id(),saved.swap().id(),"swap");assertVersion(current,saved.swap().version());approvedSwap(current);
            if(!Objects.equals(saved.recipe(),accessibleRecipe(scope,actor,saved.recipe().id())))throw conflict("This recipe changed during the preview. Refresh and try again.");
            Map<String,Object> result=new LinkedHashMap<>(response);result.put("sourceRecipeId",saved.recipe().id().toString());return result;
        });
    }
    private record SwapSnapshot(Scope scope,Recipe recipe,Record swap,Map<String,Object> profile,Map<String,Object> request){}
    private void approvedSwap(Record swap){if(!Boolean.TRUE.equals(swap.body().get("reviewed"))||!"approved".equals(swap.body().get("approvalStatus")))throw invalid("This substitution needs administrator curation approval before it can be previewed.");}
    @Transactional
    public Map<String,Object> saveWorkspace(UUID household,Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,true,true);String accent=text(input.getOrDefault("accentColor","#FED369"),"accentColor",7);
        if(!accent.matches("#[0-9a-fA-F]{6}"))throw bad("Accent color must be a six-digit hex color.");
        Map<String,Object> body=map("name",required(input,"name",100),"accentColor",accent,"description",text(input.getOrDefault("description",""),"description",3000));
        long expected=input.containsKey("version")?version(input,0):0L;
        Record saved=singleton(scope.id(),user,"workspace",body,expected);repository.revise(scope.id());return view(saved);
    }
    @Transactional
    public Map<String,Object> addCatalog(UUID household,Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);Scope scope=scope(user,household,true,true);confirm(input,"permissionConfirmed");UUID id=uuid(input.get("recipeId"),"recipeId");
        Recipe recipe=repository.recipe(id,user).orElseThrow(()->missing("Recipe is unavailable."));
        if(!recipe.isPublic()&&!user.equals(recipe.authorId()))throw forbidden("You cannot add someone else's private recipe.");
        capacity(scope.id(),"catalog");List<Record> catalog=repository.records(scope.id(),"catalog",1000);
        if(catalog.stream().anyMatch(record->id.toString().equals(record.body().get("recipeId"))))throw conflict("This recipe is already in the catalog.");
        Map<String,Object> body=map("recipeId",id.toString(),"title",recipe.title(),"imageUrl",recipe.imageUrl(),"permissionConfirmed",true,"permissionNote",required(input,"permissionNote",3000),
            "sourceUrl",url(input.get("sourceUrl")),"declaredBy",user.toString(),"declaredAt",Instant.now().toString(),"rightsStatus","user declaration; not independently verified");
        Record saved=repository.insert(scope.id(),user,"catalog",body);repository.revise(scope.id());return view(saved);
    }
    @Transactional
    public Map<String,Object> catalog(UUID household,Jwt jwt) {Scope scope=scope(user(jwt),household,false,false);return map("recipes",views(repository.records(scope.id(),"catalog",1000)));}
    public Map<String,Object> coverage(UUID household,Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);CoverageSnapshot saved=snapshot(()->{
        Scope scope=scope(user,household,false,false);Map<String,Object> plan=object(input.get("plan"),"plan");
        Map<String,Object> request=new LinkedHashMap<>(object(plan.get("settings"),"Plan settings"));request.put("weekStart",plan.get("weekStart"));request.put("servings",plan.get("servings"));request.put("intent",plan.get("intent"));
        String selectedScope="household".equals(scope.kind())?scope.id().toString():null;
        String originalScope=request.get("householdId")==null?null:uuid(request.get("householdId"),"Plan householdId").toString();
        if(!Objects.equals(selectedScope,originalScope))throw forbidden("Select the kitchen used by this meal plan before checking its stock.");
        request.put("usePantry",true);request.put("householdId",selectedScope);
        List<Map<String,Object>> meals=new ArrayList<>();for(Object raw:list(plan.get("meals"),"Plan meals",7)){Map<String,Object> meal=object(raw,"Meal");Map<String,Object> selected=map("dayIndex",meal.get("dayIndex"),"recipeId",object(meal.get("recipe"),"Recipe").get("id"));if(meal.get("reuse") instanceof Map<?,?> reuse){selected.put("leftoverId",reuse.get("leftoverId"));selected.put("leftoverVersion",reuse.get("version"));}meals.add(selected);}
        request.put("meals",meals);request.put("checkedItems",plan.getOrDefault("checkedItems",List.of()));
        return new CoverageSnapshot(scope,request);
        });
        Map<String,Object> canonical=outside(()->planner.recalculate(saved.request(),jwt));
        if(canonical==null||!(canonical.get("pantryCoverage") instanceof Map<?,?>))throw upstream("Canonical pantry coverage is unavailable.");
        // The signed planner validates pinned observations. Re-running generic
        // coverage against the full price book would silently replace those pins.
        Map<String,Object> result=new LinkedHashMap<>(object(canonical.get("pantryCoverage"),"Canonical pantry coverage"));
        return snapshot(()->{Scope current=recheckScope(saved.scope(),user);result.put("pantryRevision",current.revision());return result;});
    }
    private record CoverageSnapshot(Scope scope,Map<String,Object> request){}
    public Map<String,Object> suggestions(UUID household,Map<String,Object> input,Jwt jwt) {
        UUID user=user(jwt);SuggestionSnapshot saved=snapshot(()->{
        Scope scope=scope(user,household,false,false);boolean usePantry=bool(input.getOrDefault("usePantry",true),"usePantry");
        Set<String> available=new LinkedHashSet<>(strings(input.getOrDefault("availableIngredients",List.of()),"availableIngredients",100,120));
        if(usePantry)available.addAll(available(scope.id(),LocalDate.now(ZoneOffset.UTC)));
        Map<String,Object> profile=trustedProfile(user,scope,bool(input.getOrDefault("useHouseholdPreferences",false),"useHouseholdPreferences"));
        Map<String,Object> request=map("prompt",text(input.getOrDefault("prompt",""),"prompt",2000),"maxCookTime",integer(input.getOrDefault("maxCookTime",45),"maxCookTime",5,240),
            "dietaryPreferences",strings(input.getOrDefault("dietaryPreferences",List.of()),"dietaryPreferences",50,100),"availableIngredients",aliases(new ArrayList<>(available)),
            "mustUseIngredients",aliases(strings(input.getOrDefault("mustUseIngredients",List.of()),"mustUseIngredients",50,120)),"excludedIngredients",aliases(strings(input.getOrDefault("excludedIngredients",List.of()),"excludedIngredients",50,120)),"useHouseholdPreferences",bool(input.getOrDefault("useHouseholdPreferences",false),"useHouseholdPreferences"),"profile",profile);
        return new SuggestionSnapshot(scope,profile,request);
        });
        Map<String,Object> response=outside(()->worker.post("/ai/pantry/suggest",saved.request()));
        if(response==null)throw upstream("Recipe suggestions are unavailable.");
        return snapshot(()->{
            Scope current=recheckScope(saved.scope(),user);recheckTrustedProfile(user,current,saved.profile());
            Set<UUID> ids=new HashSet<>();for(Object raw:list(response.get("recipes"),"Suggested recipes",100))ids.add(uuid(object(raw,"Suggested recipe").get("id"),"recipeId"));
            if(!profiles.publicRecipeIds(ids).containsAll(ids))throw conflict("A suggested recipe is no longer available. Try again.");
            return response;
        });
    }
    private record SuggestionSnapshot(Scope scope,Map<String,Object> profile,Map<String,Object> request){}
    public Map<String,Object> transcribe(Map<String,Object> input,Jwt jwt) {
        user(jwt);String audio=required(input,"audioBase64",7_000_000);String mime=required(input,"mimeType",100);
        if(!Set.of("audio/webm","audio/ogg","audio/wav","audio/x-wav","audio/mp4","audio/m4a").contains(mime.split(";",2)[0].trim().toLowerCase(Locale.ROOT)))throw bad("Choose a supported audio recording.");
        try{int bytes=Base64.getDecoder().decode(audio).length;if(bytes==0)throw bad("Choose a nonempty audio recording.");if(bytes>5*1024*1024)throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,"Maximum recording size is 5 MB.");}catch(IllegalArgumentException error){throw bad("Audio must be base64 encoded.");}
        return worker.post("/ai/voice/transcribe",map("audioBase64",audio,"mimeType",mime));
    }
    public Map<String,Object> speak(Map<String,Object> input,Jwt jwt) {user(jwt);return worker.post("/ai/voice/speak",map("text",required(input,"text",2000),"language",voiceLanguage(input)));}
    public Map<String,Object> speakStep(UUID household,UUID id,Map<String,Object> input,Jwt jwt){
        UUID actor=user(jwt);int index=integer(input.get("stepIndex"),"stepIndex",0,59);String language=voiceLanguage(input);
        SpeakSnapshot saved=snapshot(()->{Scope scope=scope(actor,household,false,false);Record session=record(scope.id(),id,"session");List<?> source=list(session.body().get("steps"),"steps",60);if(index>=source.size())throw bad("Choose an existing cooking step.");Recipe recipe=accessibleRecipe(scope,actor,uuid(session.body().get("recipeId"),"recipeId"));return new SpeakSnapshot(scope,session,recipe,text(source.get(index),"Source step",3000));});
        Map<String,Object> result=outside(()->worker.post("/ai/voice/speak",map("text",saved.text(),"language",language,"sourceRecipeId",saved.recipe().id().toString(),"sourceStepIndex",index,"cachePublicSource",saved.recipe().isPublic(),"verifiedSessionStep",true)));
        return snapshot(()->{Scope current=recheckScope(saved.scope(),actor);Record session=record(current.id(),id,"session");if(!Objects.equals(session.body().get("recipeVersion"),saved.session().body().get("recipeVersion"))||!Objects.equals(saved.recipe(),accessibleRecipe(current,actor,saved.recipe().id())))throw conflict("This recipe changed while preparing audio. Reload the cooking session.");return result;});
    }
    private record SpeakSnapshot(Scope scope,Record session,Recipe recipe,String text){}
    private static String voiceLanguage(Map<String,Object> input){String value=text(input.getOrDefault("language","en"),"language",2);if(!Set.of("en","vi").contains(value))throw bad("Choose English or Vietnamese speech.");return value;}

    private Scope scope(UUID user,UUID household,boolean write,boolean ownerOnly) {
        if(scopeAccess!=null)return scopeAccess.require(user,household,write?(ownerOnly?KitchenScopeAccess.Access.OWNER_WRITE:KitchenScopeAccess.Access.WRITE):KitchenScopeAccess.Access.READ);
        Scope scope=household==null?repository.personal(user):repository.access(household,user).orElseThrow(()->forbidden("You are not an accepted member of this household."));
        if(household!=null&&!"household".equals(scope.kind()))throw forbidden("Choose an accepted household.");
        if(write) {
            repository.lock(scope.id());
            // A role may have changed while waiting for another writer.
            scope=repository.access(scope.id(),user).orElseThrow(()->forbidden("Your membership is no longer available."));
            authorizeWrite(scope,ownerOnly);
        }
        return scope;
    }
    private void authorizeWrite(Scope scope,boolean ownerOnly) {
        if(ownerOnly&&!"owner".equals(scope.role()))throw forbidden("Only the kitchen owner can manage this workspace or its members.");
        if("viewer".equals(scope.role()))throw forbidden("Viewers can read this kitchen but cannot change it.");
        if("household".equals(scope.kind())&&!"owner".equals(scope.role()))requireCollaboration();
    }
    private Scope recheckScope(Scope previous,UUID actor) {
        Scope current=repository.access(previous.id(),actor).orElseThrow(()->forbidden("Your kitchen membership is no longer available."));
        if(current.revision()!=previous.revision())throw conflict("This kitchen changed while processing the request. Refresh and try again.");
        return current;
    }
    private void recheckProfile(UUID actor,Map<String,Object> previous) {
        if(!Objects.equals(previous,profiles.preferences(actor)))throw conflict("Your cooking preferences changed while processing the request. Try again.");
    }
    private Map<String,Object> trustedProfile(UUID actor,Scope scope,boolean family){
        Map<String,Object> profile=new LinkedHashMap<>(profiles.preferences(actor));if(growthContext==null)return profile;
        Map<String,Object> context=growthContext.load(actor,"household".equals(scope.kind())?scope.id():null,false,new PlanningContextPort.Options(false,family,false)).fields();profile.putAll(context);
        if(family){List<String> diets=new ArrayList<>(strings(profile.getOrDefault("dietaryPreferences",List.of()),"dietaryPreferences",100,100)),allergies=new ArrayList<>(strings(profile.getOrDefault("allergies",List.of()),"allergies",100,120));List<String> sharedDiets=strings(profile.remove("householdDietaryPreferences"),"dietaryPreferences",100,100),sharedAllergies=strings(profile.remove("householdAllergies"),"allergies",100,120);profile.put("householdRestrictions",map("dietaryPreferences",sharedDiets,"allergies",sharedAllergies));diets.addAll(sharedDiets);allergies.addAll(sharedAllergies);profile.put("dietaryPreferences",diets.stream().distinct().toList());profile.put("allergies",allergies.stream().distinct().toList());}
        profile.put("contractVersion","local-ai.v2");return profile;
    }
    private void recheckTrustedProfile(UUID actor,Scope scope,Map<String,Object> previous){if(!Objects.equals(previous,trustedProfile(actor,scope,Boolean.TRUE.equals(previous.get("usedHouseholdPreferences")))))throw conflict("Your shared cooking preferences changed. Refresh and try again.");}
    private Record singleton(UUID scope,UUID user,String kind,Map<String,Object> body,long expected) {
        Optional<Record> previous=repository.records(scope,kind,1).stream().findFirst();
        if(previous.isEmpty()){if(expected!=0)throw conflict("This item is unavailable. Reload before saving.");return repository.insert(scope,user,kind,body);}
        assertVersion(previous.get(),expected);
        return repository.update(scope,previous.get().id(),kind,expected,body).orElseThrow(()->conflict("This item has changed. Reload before saving."));
    }
    private Recipe accessibleRecipe(Scope scope,UUID user,UUID id) {
        Recipe recipe=repository.recipe(id,user).orElseThrow(()->missing("Recipe is unavailable."));
        boolean declared=repository.records(scope.id(),"catalog",1000).stream().anyMatch(record->id.toString().equals(record.body().get("recipeId"))&&Boolean.TRUE.equals(record.body().get("permissionConfirmed")));
        if(!recipe.isPublic()&&!("personal".equals(scope.kind())&&user.equals(recipe.authorId()))&&!declared)throw forbidden("Use a public recipe or a recipe shared in this kitchen's permissioned catalog.");
        return recipe;
    }
    private Map<String,Object> mealSlot(Object raw) {
        if(raw==null)return null;
        Map<String,Object> supplied=object(raw,"mealSlot");
        return map("planId",uuid(supplied.get("planId"),"planId").toString(),"dayIndex",integer(supplied.get("dayIndex"),"dayIndex",0,6));
    }
    private void authorizeMealSlot(Scope scope,UUID actor,Map<String,Object> binding,UUID recipeId) {
        UUID planId=UUID.fromString(binding.get("planId").toString());int day=(Integer)binding.get("dayIndex");
        Map<String,Object> owned=repository.ownedPlan(planId,actor).orElseThrow(()->missing("This saved meal plan is unavailable."));
        Map<String,Object> plan=object(owned.get("plan"),"Saved plan"),settings=object(plan.get("settings"),"Saved plan settings");
        Object planHousehold=settings.get("householdId");String selected="household".equals(scope.kind())?scope.id().toString():null;
        if(!Objects.equals(planHousehold,selected))throw forbidden("Confirm the meal in the kitchen selected for its saved plan.");
        Map<String,Object> slot=null;for(Object raw:list(plan.get("meals"),"Saved plan meals",7)){Map<String,Object> candidate=object(raw,"Saved meal");if(integer(candidate.get("dayIndex"),"dayIndex",0,6)==day)slot=candidate;}
        if(slot==null||!Objects.equals(object(slot.get("recipe"),"Saved recipe").get("id"),recipeId.toString()))throw invalid("This cooking session does not match the saved meal slot.");
        if(slot.get("reuse")!=null)throw invalid("This dinner uses prepared leftovers. Record the portions eaten in Pantry instead of starting a new cooking session.");
        if(repository.completedSlot(planId,day))throw conflict("This saved meal slot has already been confirmed.");
        binding.put("planVersion",owned.get("version"));
    }
    private Map<String,Object> pantry(Map<String,Object> input) {
        return map("ingredient",canonical(required(input,"ingredient",120)),"quantity",input.get("quantity")==null?null:positive(input.get("quantity"),"quantity",1_000_000).stripTrailingZeros(),
            "unit",canonical(text(input.getOrDefault("unit",""),"unit",60)),"useBy",date(input.get("useBy"),"useBy",true),"purchasedOn",date(input.get("purchasedOn"),"purchasedOn",true),
            "location",text(input.getOrDefault("location",""),"location",100),"note",text(input.getOrDefault("note",""),"note",3000),"confirmed",true);
    }
    private List<String> available(UUID scope,LocalDate asOf) {
        Set<String> names=new LinkedHashSet<>();for(Record lot:repository.records(scope,"pantry",1000)){
            Object expires=lot.body().get("useBy");BigDecimal quantity=nullableDecimal(lot.body().get("quantity"));
            if((expires==null||!LocalDate.parse(expires.toString()).isBefore(asOf))&&(quantity==null||quantity.signum()>0))names.add(lot.body().get("ingredient").toString());
        }return aliases(new ArrayList<>(names));
    }
    private List<String> aliases(List<String> names){Map<String,String> reviewed=new HashMap<>();for(Map<String,Object> alias:repository.reviewedAliases())reviewed.put(canonical(alias.get("alias").toString()),alias.get("name").toString());return names.stream().map(name->reviewed.getOrDefault(canonical(name),name)).distinct().toList();}
    private List<Map<String,Object>> timers(Object raw) {
        List<Map<String,Object>> result=new ArrayList<>();Set<String> ids=new HashSet<>();for(Object item:list(raw,"timers",20)){
            Map<String,Object> timer=object(item,"Timer");String id=required(timer,"id",80);if(!ids.add(id))throw bad("Timer IDs must be distinct.");boolean running=bool(timer.get("running"),"running");Object end=timer.get("endsAt");String endsAt=null;
            if(end!=null){try{endsAt=Instant.parse(text(end,"endsAt",60)).toString();}catch(java.time.format.DateTimeParseException error){throw bad("Timer expiry must be an ISO timestamp.");}}
            if(running&&endsAt==null)throw bad("Running timers need an expiry time.");Map<String,Object> validated=map("id",id,"label",required(timer,"label",100),"endsAt",endsAt,"running",running);
            if(timer.containsKey("durationSeconds"))validated.put("durationSeconds",integer(timer.get("durationSeconds"),"durationSeconds",1,86400));
            validated.put("acknowledged",bool(timer.getOrDefault("acknowledged",false),"acknowledged"));result.add(validated);
        }return result;
    }
    private List<String> steps(String source) {return CookingSource.steps(source);}
    private Record record(UUID scope,UUID id,String kind){return repository.record(scope,id,kind).orElseThrow(()->missing("This kitchen item is unavailable."));}
    private Map<String,Object> view(Record record){Map<String,Object> result=new LinkedHashMap<>(record.body());result.put("id",record.id().toString());result.put("version",record.version());result.put("createdAt",record.createdAt().toString());result.put("updatedAt",record.updatedAt().toString());return result;}
    private Map<String,Object> revisedView(Record record,Scope scope){Map<String,Object> result=view(record);result.put("aggregateRevision",scope.revision()+1);return result;}
    private List<Map<String,Object>> views(List<Record> records){return records.stream().map(this::view).toList();}
    private Map<String,Object> scopeView(Scope scope){return map("id","personal".equals(scope.kind())?null:scope.id().toString(),"name",scope.name(),"role",scope.role(),"revision",scope.revision());}
    private void capacity(UUID scope,String kind){if(repository.records(scope,kind,1001).size()>=1000)throw conflict("This kitchen has reached its 1,000-item limit for "+kind+" records. Remove an unused item before adding another.");}
    private static void household(Scope scope){if(!"household".equals(scope.kind()))throw bad("Choose a household.");}
    private boolean collaborationEnabled(){return platform!=null&&platform.collaborationEnabled();}
    private void requireCollaboration(){if(!collaborationEnabled())throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Shared kitchen changes and invitations are disabled by the administrator. The owner can keep using their own kitchen.");}
    private static void active(Record record){if(!"active".equals(record.body().get("status")))throw conflict("This cooking session is already completed.");}
    private static void assertVersion(Record record,long version){if(version<1||record.version()!=version)throw conflict("This item has changed. Reload its latest version before saving.");}
    private static void assertRevision(Scope scope,Map<String,Object> input){long expected=integer(input.get("aggregateRevision"),"aggregateRevision",1,Integer.MAX_VALUE-1);if(scope.revision()!=expected)throw conflict("This kitchen has changed. Refresh its stock before confirming this operation.");}
    private static String operationKey(Map<String,Object> input){String key=required(input,"idempotencyKey",100);if(key.length()<8)throw bad("Use an idempotency key of 8–100 characters.");return key;}
    private static UUID user(Jwt jwt){UUID user=RequestIdentity.optionalUserId(jwt);if(user==null)throw unauthenticated();return user;}
    private static String memberRole(Object raw){String role=text(raw,"role",10);if(!Set.of("viewer","editor").contains(role))throw bad("Invite or assign an editor or viewer.");return role;}
    private static void confirm(Map<String,Object> input,String field){if(!Boolean.TRUE.equals(input.get(field)))throw bad("Explicitly confirm "+field+" before continuing.");}
    private static long version(Map<String,Object> input,int minimum){return integer(input.get("version"),"version",minimum,Integer.MAX_VALUE-1);}
    private static int integer(Object raw,String field,int min,int max){if(!(raw instanceof Number number)||!Double.isFinite(number.doubleValue())||number.doubleValue()!=number.longValue()||number.longValue()<min||number.longValue()>max)throw bad(field+" must be an integer from "+min+" to "+max+".");return number.intValue();}
    private static BigDecimal positive(Object raw,String field,int max){if(!(raw instanceof Number number)||!Double.isFinite(number.doubleValue()))throw bad(field+" must be a positive number.");BigDecimal value=new BigDecimal(number.toString());if(value.signum()<=0||value.compareTo(BigDecimal.valueOf(max))>0||value.scale()>8)throw bad(field+" must be positive and within supported bounds.");return value;}
    private static BigDecimal nullableDecimal(Object raw){return raw==null?null:new BigDecimal(raw.toString());}
    private static String required(Map<String,Object> input,String field,int max){String result=text(input.get(field),field,max).trim();if(result.isBlank())throw bad(field+" cannot be blank.");return result;}
    private static String text(Object raw,String field,int max){if(!(raw instanceof String value)||value.length()>max||value.indexOf('\0')>=0)throw bad(field+" must be text of at most "+max+" characters.");return value;}
    private static boolean bool(Object raw,String field){if(!(raw instanceof Boolean value))throw bad(field+" must be true or false.");return value;}
    private static List<?> list(Object raw,String field,int max){if(!(raw instanceof List<?> value)||value.size()>max)throw bad(field+" must be a list of at most "+max+" items.");return value;}
    @SuppressWarnings("unchecked")private static Map<String,Object> object(Object raw,String field){if(!(raw instanceof Map<?,?> value)||value.keySet().stream().anyMatch(key->!(key instanceof String)))throw bad(field+" must be a JSON object.");return (Map<String,Object>)value;}
    private static List<String> strings(Object raw,String field,int max,int length){Set<String> values=new LinkedHashSet<>();for(Object item:list(raw,field,max)){String value=text(item,field,length).trim();if(value.isBlank())throw bad(field+" cannot include blank entries.");values.add(value);}return new ArrayList<>(values);}
    private static UUID uuid(Object raw,String field){try{String value=text(raw,field,36);UUID id=UUID.fromString(value);if(!id.toString().equalsIgnoreCase(value))throw bad(field+" must be a UUID.");return id;}catch(IllegalArgumentException error){throw bad(field+" must be a UUID.");}}
    private static String date(Object raw,String field,boolean nullable){if(raw==null&&nullable)return null;String value=text(raw,field,10);try{LocalDate date=LocalDate.parse(value);if(!date.toString().equals(value)||date.getYear()<1||date.getYear()>9999)throw bad(field+" must be a date in YYYY-MM-DD format.");return value;}catch(java.time.format.DateTimeParseException error){throw bad(field+" must be a valid date.");}}
    private static String canonical(String value){return value.trim().replaceAll("\\s+"," ").toLowerCase(Locale.ROOT);}
    private static String url(Object raw){if(raw==null||"".equals(raw))return null;String value=text(raw,"sourceUrl",2000);try{URI uri=URI.create(value);if(!Set.of("http","https").contains(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)throw bad("Source URL must be an HTTP or HTTPS link.");return value;}catch(IllegalArgumentException error){throw bad("Source URL must be a valid link.");}}
    private String json(Object value){try{return mapper.writeValueAsString(value);}catch(java.io.IOException error){throw bad("The request could not be serialized.");}}
    private static String hash(String value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(java.security.NoSuchAlgorithmException error){throw new IllegalStateException(error);}}
    private static ResponseStatusException bad(String text){return new ResponseStatusException(HttpStatus.BAD_REQUEST,text);}
    private static ResponseStatusException forbidden(String text){return new ResponseStatusException(HttpStatus.FORBIDDEN,text);}
    private static ResponseStatusException missing(String text){return new ResponseStatusException(HttpStatus.NOT_FOUND,text);}
    private static ResponseStatusException conflict(String text){return new ResponseStatusException(HttpStatus.CONFLICT,text);}
    private static ResponseStatusException invalid(String text){return new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,text);}
    private static ResponseStatusException upstream(String text){return new ResponseStatusException(HttpStatus.BAD_GATEWAY,text);}
    private static ResponseStatusException unauthenticated(){return new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Sign in to use your kitchen.");}
}
