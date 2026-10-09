package com.server.letMeCook.repository;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import com.server.letMeCook.service.PlatformService;

/** Scope is an explicit predicate on every record read/write; never rely only on RLS. */
@Repository
public class KitchenRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final String userLockClause;
    private PlatformService platform;
    @Autowired public void setPlatformService(PlatformService platform){this.platform=platform;}
    public record Scope(UUID id, UUID ownerId, String kind, String name, long revision, String role) { }
    public record Record(UUID id, UUID scopeId, String kind, long version, Map<String,Object> body,
                         UUID actorId, Instant createdAt, Instant updatedAt) { }
    public record Invite(UUID id, UUID scopeId, String role, Instant expiresAt, UUID usedBy, Instant usedAt) { }
    public record Receipt(UUID actorId, UUID sessionId, String fingerprint, Map<String,Object> response) { }
    public record PantryReceipt(UUID actorId, String fingerprint, Map<String,Object> response) { }
    public record Cohort(UUID id,UUID scopeId,String name,UUID enrolledBy,Instant enrolledAt,Instant expiresAt,String state,String reason,String releaseVersion,String consentVersion) { }
    public record Recipe(UUID id, UUID authorId, boolean isPublic, String title, String directions,
                         String sourceUrl, String imageUrl, double servings, List<Map<String,Object>> ingredients) { }
    public KitchenRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc=jdbc;this.mapper=mapper;
        String product=jdbc.execute((ConnectionCallback<String>)connection->connection.getMetaData().getDatabaseProductName());
        // PostgreSQL FK inserts already hold KEY SHARE on the actor. A non-key lock
        // serializes consent without a cross-scope lock-upgrade deadlock. H2 lacks it.
        this.userLockClause="PostgreSQL".equalsIgnoreCase(product)?" FOR NO KEY UPDATE":" FOR UPDATE";
    }

    public Scope personal(UUID owner) {
        // ON CONFLICT is safe for simultaneous first loads, without aborting the transaction.
        jdbc.update("INSERT INTO public.kitchen_scopes(id,owner_id,kind,name,revision) VALUES (?,?,'personal','My kitchen',1) ON CONFLICT DO NOTHING",owner,owner);
        return access(owner,owner).orElseThrow(() -> new IllegalStateException("Personal kitchen is missing"));
    }
    public Optional<Scope> access(UUID scope, UUID user) {
        return jdbc.query("SELECT s.*,m.role FROM public.kitchen_scopes s LEFT JOIN public.kitchen_members m ON m.scope_id=s.id AND m.user_id=? WHERE s.id=? AND (s.owner_id=? OR m.user_id IS NOT NULL)",
            (rs,n)->new Scope(rs.getObject("id",UUID.class),rs.getObject("owner_id",UUID.class),rs.getString("kind"),rs.getString("name"),rs.getLong("revision"),
                rs.getObject("owner_id",UUID.class).equals(user)?"owner":rs.getString("role")),user,scope,user).stream().findFirst();
    }
    public List<Map<String,Object>> households(UUID user) {
        return jdbc.query("SELECT s.id,s.name,m.role FROM public.kitchen_scopes s JOIN public.kitchen_members m ON m.scope_id=s.id WHERE m.user_id=? AND s.kind='household' ORDER BY s.created_at,s.id",
            (rs,n)->map("id",rs.getObject("id").toString(),"name",rs.getString("name"),"role",rs.getString("role")),user);
    }
    public void lock(UUID scope) { jdbc.queryForObject("SELECT revision FROM public.kitchen_scopes WHERE id=? FOR UPDATE",Long.class,scope); }
    public void lockUser(UUID user) { jdbc.queryForObject("SELECT id FROM public.users WHERE id=?"+userLockClause,UUID.class,user); }
    public void revise(UUID scope) { jdbc.update("UPDATE public.kitchen_scopes SET revision=revision+1 WHERE id=?",scope); }
    public Scope createHousehold(UUID user,String name) {
        UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO public.kitchen_scopes(id,owner_id,kind,name,revision) VALUES (?,?,'household',?,1)",id,user,name);
        addMember(id,user,"owner");
        return access(id,user).orElseThrow();
    }
    public void addMember(UUID scope,UUID user,String role) { jdbc.update("INSERT INTO public.kitchen_members(scope_id,user_id,role) VALUES (?,?,?)",scope,user,role); }
    public List<Map<String,Object>> members(UUID scope) {
        return jdbc.query("SELECT m.user_id,m.role,u.first_name,u.last_name FROM public.kitchen_members m JOIN public.users u ON u.id=m.user_id WHERE m.scope_id=? ORDER BY m.joined_at,m.user_id",
            (rs,n)->map("userId",rs.getObject("user_id").toString(),"name",name(rs.getString("first_name"),rs.getString("last_name")),"role",rs.getString("role")),scope);
    }
    public int changeRole(UUID scope,UUID user,String role) { return jdbc.update("UPDATE public.kitchen_members SET role=? WHERE scope_id=? AND user_id=? AND role<>'owner'",role,scope,user); }
    public void invite(UUID scope,UUID owner,String hash,String role,Instant expires) {
        jdbc.update("INSERT INTO public.kitchen_invites(id,scope_id,code_hash,role,expires_at,created_by) VALUES (?,?,?,?,?,?)",UUID.randomUUID(),scope,hash,role,Timestamp.from(expires),owner);
    }
    public Optional<Invite> invite(String hash,boolean lock) {
        return jdbc.query("SELECT * FROM public.kitchen_invites WHERE code_hash=?"+(lock?" FOR UPDATE":""),
            (rs,n)->new Invite(rs.getObject("id",UUID.class),rs.getObject("scope_id",UUID.class),rs.getString("role"),rs.getTimestamp("expires_at").toInstant(),
                rs.getObject("used_by",UUID.class),rs.getTimestamp("used_at")==null?null:rs.getTimestamp("used_at").toInstant()),hash).stream().findFirst();
    }
    public int accept(Invite invite,UUID user,Instant now) {
        return jdbc.update("UPDATE public.kitchen_invites SET used_by=?,used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?",user,Timestamp.from(now),invite.id(),Timestamp.from(now));
    }
    public List<Record> records(UUID scope,String kind,int limit) {
        return jdbc.query("SELECT * FROM public.kitchen_records WHERE scope_id=? AND kind=? ORDER BY updated_at DESC,id LIMIT ?",this::record,scope,kind,limit);
    }
    public Optional<Record> record(UUID scope,UUID id,String kind) {
        return jdbc.query("SELECT * FROM public.kitchen_records WHERE scope_id=? AND id=? AND kind=?",this::record,scope,id,kind).stream().findFirst();
    }
    public Map<UUID,Record> recordsByIds(UUID scope,Set<UUID> ids,String kind) {
        if(ids.isEmpty())return Map.of();
        if(ids.size()>1000)throw new IllegalArgumentException("Kitchen snapshot reads are bounded to 1,000 records");
        List<Object> args=new ArrayList<>(List.of(scope,kind));args.addAll(ids);
        List<Record> found=jdbc.query("SELECT * FROM public.kitchen_records WHERE scope_id=? AND kind=? AND id IN ("+String.join(",",Collections.nCopies(ids.size(),"?"))+")",this::record,args.toArray());
        Map<UUID,Record> result=new HashMap<>();found.forEach(value->result.put(value.id(),value));return result;
    }
    /** Call only after trusted administrator authorization; returns no other kitchen record kinds. */
    public List<Record> swapsForReview(int limit) {
        if(limit<1||limit>101)throw new IllegalArgumentException("Substitution review lists are bounded to 101 records");
        return jdbc.query("SELECT * FROM public.kitchen_records WHERE kind='swap' ORDER BY CASE WHEN coalesce(body->>'approvalStatus','pending')='pending' THEN 0 ELSE 1 END,updated_at DESC,id LIMIT ?",this::record,limit);
    }
    public Optional<Record> swapForReview(UUID id) {
        return jdbc.query("SELECT * FROM public.kitchen_records WHERE id=? AND kind='swap'",this::record,id).stream().findFirst();
    }
    public Record insert(UUID scope,UUID actor,String kind,Map<String,Object> body) {
        UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO public.kitchen_records(id,scope_id,kind,body,version,actor_id) VALUES (?,?,?,CAST(? AS jsonb),1,?)",id,scope,kind,json(body),actor);
        return record(scope,id,kind).orElseThrow();
    }
    public Optional<Record> update(UUID scope,UUID id,String kind,long version,Map<String,Object> body) {
        int count=jdbc.update("UPDATE public.kitchen_records SET body=CAST(? AS jsonb),version=version+1,updated_at=? WHERE scope_id=? AND id=? AND kind=? AND version=?",
            json(body),Timestamp.from(Instant.now()),scope,id,kind,version);
        return count==1?record(scope,id,kind):Optional.empty();
    }
    public int delete(UUID scope,UUID id,String kind,long version) {
        return jdbc.update("DELETE FROM public.kitchen_records WHERE scope_id=? AND id=? AND kind=? AND version=?",scope,id,kind,version);
    }
    public void ledger(UUID scope,UUID actor,Record lot,String action,BigDecimal delta,UUID session) {
        jdbc.update("INSERT INTO public.kitchen_ledger(id,scope_id,lot_id,actor_id,action,ingredient,delta,unit,session_id) VALUES (?,?,?,?,?,?,?,?,?)",
            UUID.randomUUID(),scope,lot.id(),actor,action,lot.body().get("ingredient"),delta,lot.body().get("unit"),session);
    }
    public List<Map<String,Object>> ledger(UUID scope) {
        return jdbc.query("SELECT l.*,u.first_name,u.last_name FROM public.kitchen_ledger l LEFT JOIN public.users u ON u.id=l.actor_id WHERE l.scope_id=? ORDER BY l.created_at DESC,l.id LIMIT 100",
            (rs,n)->map("id",rs.getObject("id").toString(),"action",rs.getString("action"),"ingredient",rs.getString("ingredient"),"delta",rs.getBigDecimal("delta"),"unit",rs.getString("unit"),
                "createdAt",rs.getTimestamp("created_at").toInstant().toString(),"actorName",name(rs.getString("first_name"),rs.getString("last_name")),"sessionId",rs.getObject("session_id")==null?null:rs.getObject("session_id").toString()),scope);
    }
    public Optional<Receipt> receipt(UUID scope,String key) {
        return jdbc.query("SELECT * FROM public.kitchen_consumption_receipts WHERE scope_id=? AND idempotency_key=?",
            (rs,n)->new Receipt(rs.getObject("actor_id",UUID.class),rs.getObject("session_id",UUID.class),rs.getString("fingerprint"),object(rs.getString("response"))),scope,key).stream().findFirst();
    }
    public void receipt(UUID scope,UUID actor,UUID session,String key,String fingerprint,Map<String,Object> response) {
        jdbc.update("INSERT INTO public.kitchen_consumption_receipts(scope_id,idempotency_key,session_id,actor_id,fingerprint,response) VALUES (?,?,?,?,?,CAST(? AS jsonb))",scope,key,session,actor,fingerprint,json(response));
    }
    public Optional<PantryReceipt> pantryReceipt(UUID scope,String key,UUID line) {
        return jdbc.query("SELECT actor_id,fingerprint,response FROM public.kitchen_pantry_receipts WHERE scope_id=? AND operation_key=? AND line_id=?",
            (rs,n)->new PantryReceipt(rs.getObject("actor_id",UUID.class),rs.getString("fingerprint"),object(rs.getString("response"))),scope,key,line).stream().findFirst();
    }
    public void pantryReceipt(UUID scope,UUID actor,String key,UUID line,String fingerprint,Map<String,Object> response) {
        jdbc.update("INSERT INTO public.kitchen_pantry_receipts(scope_id,operation_key,line_id,actor_id,fingerprint,response) VALUES (?,?,?,?,?,CAST(? AS jsonb))",scope,key,line,actor,fingerprint,json(response));
    }
    public Optional<Map<String,Object>> ownedPlan(UUID plan,UUID owner) {
        // Lock the saved plan so a concurrent replacement cannot change the slot being confirmed.
        return jdbc.query("SELECT plan,version FROM public.weekly_meal_plans WHERE id=? AND user_id=? FOR UPDATE",
            (rs,n)->map("plan",object(rs.getString("plan")),"version",rs.getInt("version")),plan,owner).stream().findFirst();
    }
    public boolean completedSlot(UUID plan,int day) {
        return jdbc.queryForObject("SELECT count(*) FROM public.kitchen_consumption_receipts WHERE plan_id=? AND day_index=?",Long.class,plan,day)>0;
    }
    public void linkReceipt(UUID scope,String key,UUID plan,int day) {
        jdbc.update("UPDATE public.kitchen_consumption_receipts SET plan_id=?,day_index=? WHERE scope_id=? AND idempotency_key=?",plan,day,scope,key);
    }
    public Map<String,Object> consent(UUID user) {
        return jdbc.query("SELECT enabled,updated_at FROM public.kitchen_consent WHERE user_id=?",(rs,n)->map("enabled",rs.getBoolean("enabled"),"updatedAt",rs.getTimestamp("updated_at").toInstant().toString()),user)
            .stream().findFirst().orElse(map("enabled",false,"updatedAt",null));
    }
    public void consent(UUID user,boolean enabled) {
        jdbc.update("INSERT INTO public.kitchen_consent(user_id,enabled,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at",user,enabled,Timestamp.from(Instant.now()));
    }
    public void evidence(UUID scope,UUID user,UUID session) {
        // Consent is checked at insertion as well as every aggregate read.
        jdbc.update("INSERT INTO public.kitchen_evidence_events(id,scope_id,user_id,session_id) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM public.kitchen_consent WHERE user_id=? AND enabled=true) AND NOT EXISTS(SELECT 1 FROM public.kitchen_evidence_events WHERE session_id=?)",UUID.randomUUID(),scope,user,session,user,session);
    }
    public void deleteEvidence(UUID user) { jdbc.update("DELETE FROM public.kitchen_evidence_events WHERE user_id=?",user); }
    public List<Cohort> cohorts(UUID scope) {
        return jdbc.query("SELECT * FROM public.kitchen_cohort_enrollments WHERE scope_id=? ORDER BY enrolled_at DESC,id LIMIT 20",this::cohort,scope);
    }
    public Optional<Cohort> cohort(UUID scope,UUID id) {
        return jdbc.query("SELECT * FROM public.kitchen_cohort_enrollments WHERE scope_id=? AND id=?",this::cohort,scope,id).stream().findFirst();
    }
    public Optional<Cohort> cohort(UUID scope,String name) {
        return jdbc.query("SELECT * FROM public.kitchen_cohort_enrollments WHERE scope_id=? AND cohort_name=?",this::cohort,scope,name).stream().findFirst();
    }
    public Cohort enroll(UUID scope,UUID user,String name,Instant now,String release,String consentVersion) {
        UUID id=UUID.randomUUID();jdbc.update("INSERT INTO public.kitchen_cohort_enrollments(id,scope_id,cohort_name,enrolled_by,enrolled_at,expires_at,release_version,consent_version) VALUES(?,?,?,?,?,?,?,?)",id,scope,name,user,Timestamp.from(now),Timestamp.from(now.plus(java.time.Duration.ofDays(90))),release,consentVersion);
        return cohort(scope,id).orElseThrow();
    }
    public void withdraw(Cohort cohort,Instant now) {
        jdbc.update("UPDATE public.kitchen_cohort_enrollments SET state='withdrawn',unavailable_reason='ownerWithdrawal',state_changed_at=? WHERE scope_id=? AND id=? AND state<>'withdrawn'",Timestamp.from(now),cohort.scopeId(),cohort.id());
    }
    public void invalidateCohorts(UUID user,boolean delete,Instant now) {
        // Retain only shared cohort state until its original expiry. Delete removes the actor link.
        jdbc.update("UPDATE public.kitchen_cohort_enrollments SET state=CASE WHEN enrolled_by=? AND ?=false THEN 'withdrawn' ELSE 'incomplete' END,unavailable_reason=?,state_changed_at=? WHERE state='active' AND (enrolled_by=? OR EXISTS(SELECT 1 FROM public.kitchen_evidence_events e WHERE e.scope_id=kitchen_cohort_enrollments.scope_id AND e.user_id=? AND e.confirmed_at>=kitchen_cohort_enrollments.enrolled_at))",user,delete,delete?"evidenceDeleted":"consentChanged",Timestamp.from(now),user,user);
        if(delete)jdbc.update("UPDATE public.kitchen_cohort_enrollments SET enrolled_by=null WHERE enrolled_by=?",user);
    }
    public boolean cohortReturned(Cohort cohort) {
        return jdbc.queryForObject("SELECT count(*) FROM public.kitchen_evidence_events e JOIN public.kitchen_consent c ON c.user_id=e.user_id AND c.enabled=true WHERE e.scope_id=? AND e.confirmed_at>=? AND e.confirmed_at<?",Long.class,cohort.scopeId(),Timestamp.from(cohort.enrolledAt().plus(java.time.Duration.ofDays(21))),Timestamp.from(cohort.enrolledAt().plus(java.time.Duration.ofDays(28))))>0;
    }
    public List<Cohort> ownCohorts(UUID user) {
        return jdbc.query("SELECT * FROM public.kitchen_cohort_enrollments WHERE enrolled_by=? AND expires_at>? ORDER BY enrolled_at,id LIMIT 100",this::cohort,user,Timestamp.from(Instant.now()));
    }
    public List<Instant> evidenceTimes(UUID scope) {
        return evidenceTimes(scope,Instant.now().minus(java.time.Duration.ofDays(90)));
    }
    public List<Instant> evidenceTimes(UUID scope,Instant cutoff) {
        return jdbc.query("SELECT e.confirmed_at FROM public.kitchen_evidence_events e JOIN public.kitchen_consent c ON c.user_id=e.user_id AND c.enabled=true WHERE e.scope_id=? AND e.confirmed_at>=? ORDER BY e.confirmed_at",(rs,n)->rs.getTimestamp(1).toInstant(),scope,Timestamp.from(cutoff));
    }
    public List<Map<String,Object>> ownEvidence(UUID user,Instant cutoff) {
        // Consent revocation stops aggregation; the owner can still export their own unexpired events.
        return jdbc.query("SELECT scope_id,session_id,confirmed_at FROM public.kitchen_evidence_events WHERE user_id=? AND confirmed_at>=? ORDER BY confirmed_at,id LIMIT 10001",
            (rs,n)->map("scopeId",rs.getObject("scope_id").toString(),"sessionId",rs.getObject("session_id").toString(),"confirmedAt",rs.getTimestamp("confirmed_at").toInstant().toString()),user,Timestamp.from(cutoff));
    }
    @Transactional
    public int purgeEvidence(Instant cutoff,int limit) {
        if(limit<1||limit>1000)throw new IllegalArgumentException("Retention batches must contain 1–1000 events");
        return jdbc.update("DELETE FROM public.kitchen_evidence_events WHERE id IN (SELECT id FROM public.kitchen_evidence_events WHERE confirmed_at<? ORDER BY confirmed_at,id LIMIT ?)",Timestamp.from(cutoff),limit);
    }
    @Transactional
    public int purgeCohorts(Instant now,int limit) {
        if(limit<1||limit>1000)throw new IllegalArgumentException("Retention batches must contain 1–1000 cohorts");
        return jdbc.update("DELETE FROM public.kitchen_cohort_enrollments WHERE id IN(SELECT id FROM public.kitchen_cohort_enrollments WHERE expires_at<=? ORDER BY expires_at,id LIMIT ?)",Timestamp.from(now),limit);
    }
    public List<Map<String,Object>> reviewedAliases() {
        return jdbc.query("SELECT a.alias,i.name FROM public.lmc_ingredient_aliases a JOIN public.ingredients i ON i.id=a.ingredient_id ORDER BY a.alias LIMIT 5000",
            (rs,n)->map("alias",rs.getString("alias"),"name",rs.getString("name")));
    }
    public Optional<Recipe> recipe(UUID id) {return recipe(id,null);}
    /** Fresh public eligibility and two bounded queries, without per-leftover hydration. */
    public Map<UUID,Recipe> publicRecipes(Set<UUID> ids) {
        if(ids.isEmpty())return Map.of();
        if(ids.size()>1000)throw new IllegalArgumentException("Recipe snapshot reads are bounded to 1,000 recipes");
        String placeholders=String.join(",",Collections.nCopies(ids.size(),"?"));
        String demo=platform!=null&&platform.publicDemo()?" AND demo_permission_confirmed=true AND length(trim(coalesce(demo_permission_note,'')))>0 AND image_kind='source' AND image_url LIKE '/recipe-images/%'":"";
        List<Recipe> found=jdbc.query("SELECT id,author_id,is_public,title,directions,source_url,image_url,servings FROM public.recipe WHERE is_public=true"+demo+" AND id IN ("+placeholders+")",
            (rs,n)->new Recipe(rs.getObject("id",UUID.class),rs.getObject("author_id",UUID.class),rs.getBoolean("is_public"),rs.getString("title"),rs.getString("directions"),rs.getString("source_url"),rs.getString("image_url"),rs.getDouble("servings"),List.of()),ids.toArray());
        if(found.isEmpty())return Map.of();
        Map<UUID,List<Map<String,Object>>> ingredients=new HashMap<>();Set<UUID> visible=new LinkedHashSet<>(found.stream().map(Recipe::id).toList());
        jdbc.query("SELECT ri.recipe_id,i.name,ri.quantity,ri.unit FROM public.recipe_ingredients ri JOIN public.ingredients i ON i.id=ri.ingredient_id WHERE ri.recipe_id IN ("+String.join(",",Collections.nCopies(visible.size(),"?"))+") ORDER BY ri.recipe_id,ri.id",rs->{
            ingredients.computeIfAbsent(rs.getObject(1,UUID.class),key->new ArrayList<>()).add(map("ingredient",rs.getString(2),"quantity",rs.getString(3),"unit",rs.getString(4)));
        },visible.toArray());
        Map<UUID,Recipe> result=new HashMap<>();for(Recipe recipe:found)result.put(recipe.id(),new Recipe(recipe.id(),recipe.authorId(),recipe.isPublic(),recipe.title(),recipe.directions(),recipe.sourceUrl(),recipe.imageUrl(),recipe.servings(),ingredients.getOrDefault(recipe.id(),List.of())));return result;
    }
    public Optional<Recipe> recipe(UUID id,UUID viewer) {
        boolean publicDemo=platform!=null&&platform.publicDemo();
        String approved="(demo_permission_confirmed=true AND length(trim(coalesce(demo_permission_note,'')))>0 AND image_kind='source' AND image_url LIKE '/recipe-images/%')";
        // Service checks private ownership or accepted permissioned sharing before exposure.
        String demo=publicDemo?" AND (is_public=false OR "+(viewer==null?"":"author_id=? OR ")+approved+")":"";
        Object[] params=publicDemo&&viewer!=null?new Object[]{id,viewer}:new Object[]{id};
        List<Recipe> found=jdbc.query("SELECT id,author_id,is_public,title,directions,source_url,image_url,servings FROM public.recipe WHERE id=?"+demo,
            (rs,n)->new Recipe(rs.getObject("id",UUID.class),rs.getObject("author_id",UUID.class),rs.getBoolean("is_public"),rs.getString("title"),rs.getString("directions"),rs.getString("source_url"),rs.getString("image_url"),rs.getDouble("servings"),List.of()),params);
        if(found.isEmpty())return Optional.empty();
        Recipe recipe=found.getFirst();
        List<Map<String,Object>> ingredients=jdbc.query("SELECT i.name,ri.quantity,ri.unit FROM public.recipe_ingredients ri JOIN public.ingredients i ON i.id=ri.ingredient_id WHERE ri.recipe_id=? ORDER BY ri.id",
            (rs,n)->map("ingredient",rs.getString("name"),"quantity",rs.getString("quantity"),"unit",rs.getString("unit")),id);
        return Optional.of(new Recipe(recipe.id(),recipe.authorId(),recipe.isPublic(),recipe.title(),recipe.directions(),recipe.sourceUrl(),recipe.imageUrl(),recipe.servings(),ingredients));
    }
    public static Map<String,Object> map(Object... pairs) {
        Map<String,Object> map=new LinkedHashMap<>();
        for(int index=0;index<pairs.length;index+=2)map.put((String)pairs[index],pairs[index+1]);
        return map;
    }
    private Record record(java.sql.ResultSet rs,int index)throws java.sql.SQLException {
        return new Record(rs.getObject("id",UUID.class),rs.getObject("scope_id",UUID.class),rs.getString("kind"),rs.getLong("version"),object(rs.getString("body")),rs.getObject("actor_id",UUID.class),rs.getTimestamp("created_at").toInstant(),rs.getTimestamp("updated_at").toInstant());
    }
    private Cohort cohort(java.sql.ResultSet rs,int index)throws java.sql.SQLException {
        return new Cohort(rs.getObject("id",UUID.class),rs.getObject("scope_id",UUID.class),rs.getString("cohort_name"),rs.getObject("enrolled_by",UUID.class),rs.getTimestamp("enrolled_at").toInstant(),rs.getTimestamp("expires_at").toInstant(),rs.getString("state"),rs.getString("unavailable_reason"),rs.getString("release_version"),rs.getString("consent_version"));
    }
    private Map<String,Object> object(String json) {
        try{return mapper.readValue(json,new TypeReference<Map<String,Object>>(){});}catch(java.io.IOException error){throw new IllegalStateException("Kitchen JSON is invalid",error);}
    }
    private String json(Map<String,Object> body) {
        try{String result=mapper.writeValueAsString(body);if(result.length()>700_000)throw new IllegalArgumentException("Kitchen record is too large");return result;}
        catch(java.io.IOException error){throw new IllegalArgumentException("Kitchen record is invalid",error);}
    }
    private static String name(String first,String last){String result=((first==null?"":first)+" "+(last==null?"":last)).trim();return result.isBlank()?"Kitchen member":result;}
}
