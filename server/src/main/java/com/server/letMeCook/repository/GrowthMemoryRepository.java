package com.server.letMeCook.repository;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Explicit scope and actor predicates remain required even with the gateway DB role. */
@Repository
public class GrowthMemoryRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    public record Sharing(boolean enabled,long version,Instant updatedAt) { }
    public record Feedback(UUID id,UUID scopeId,UUID userId,UUID sessionId,UUID recipeId,int rating,
                           Map<String,Object> body,long version,Instant updatedAt) { }
    public record Leftover(UUID id,UUID scopeId,UUID sessionId,UUID recipeId,String title,BigDecimal servingsAvailable,
                           LocalDate cookedOn,LocalDate useBy,Instant confirmedAt,long version) { }
    public record Receipt(UUID actor,String fingerprint,Map<String,Object> response) { }
    public GrowthMemoryRepository(JdbcTemplate jdbc,ObjectMapper mapper){this.jdbc=jdbc;this.mapper=mapper;}

    public Sharing sharing(UUID scope,UUID user){return jdbc.query("SELECT enabled,version,updated_at FROM public.kitchen_preference_sharing WHERE scope_id=? AND user_id=?",
        (r,n)->new Sharing(r.getBoolean(1),r.getLong(2),r.getTimestamp(3).toInstant()),scope,user).stream().findFirst().orElse(new Sharing(false,0,null));}
    public boolean saveSharing(UUID scope,UUID user,boolean enabled,long expected){
        if(expected==0)return jdbc.update("INSERT INTO public.kitchen_preference_sharing(scope_id,user_id,enabled) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM public.kitchen_preference_sharing WHERE scope_id=? AND user_id=?)",scope,user,enabled,scope,user)==1;
        return jdbc.update("UPDATE public.kitchen_preference_sharing SET enabled=?,version=version+1,updated_at=? WHERE scope_id=? AND user_id=? AND version=?",enabled,Timestamp.from(Instant.now()),scope,user,expected)==1;
    }
    public List<UUID> consentedMembers(UUID scope){return jdbc.queryForList("SELECT c.user_id FROM public.kitchen_preference_sharing c JOIN public.kitchen_members m ON m.scope_id=c.scope_id AND m.user_id=c.user_id WHERE c.scope_id=? AND c.enabled=true ORDER BY c.user_id",UUID.class,scope);}
    public Optional<Feedback> feedback(UUID scope,UUID user,UUID session){return jdbc.query("SELECT * FROM public.kitchen_taste_feedback WHERE scope_id=? AND user_id=? AND session_id=?",this::feedbackRow,scope,user,session).stream().findFirst();}
    public List<Feedback> feedback(UUID scope,UUID user,int limit){return jdbc.query("SELECT * FROM public.kitchen_taste_feedback WHERE scope_id=? AND user_id=? ORDER BY updated_at DESC,id LIMIT ?",this::feedbackRow,scope,user,limit);}
    public boolean saveFeedback(UUID scope,UUID user,UUID session,UUID recipe,int rating,Map<String,Object> body,long expected){
        if(expected==0)return jdbc.update("INSERT INTO public.kitchen_taste_feedback(id,scope_id,user_id,session_id,recipe_id,rating,body) SELECT ?,?,?,?,?,?,CAST(? AS jsonb) WHERE NOT EXISTS(SELECT 1 FROM public.kitchen_taste_feedback WHERE session_id=? AND user_id=?)",UUID.randomUUID(),scope,user,session,recipe,rating,json(body),session,user)==1;
        return jdbc.update("UPDATE public.kitchen_taste_feedback SET rating=?,body=CAST(? AS jsonb),version=version+1,updated_at=? WHERE scope_id=? AND user_id=? AND session_id=? AND version=?",rating,json(body),Timestamp.from(Instant.now()),scope,user,session,expected)==1;
    }
    public List<Leftover> leftovers(UUID scope,int limit){return jdbc.query("SELECT * FROM public.kitchen_leftovers WHERE scope_id=? ORDER BY confirmed_at DESC,id LIMIT ?",this::leftoverRow,scope,limit);}
    public Optional<Leftover> leftover(UUID scope,UUID id){return jdbc.query("SELECT * FROM public.kitchen_leftovers WHERE scope_id=? AND id=?",this::leftoverRow,scope,id).stream().findFirst();}
    public Optional<Leftover> leftoverForSession(UUID scope,UUID session){return jdbc.query("SELECT * FROM public.kitchen_leftovers WHERE scope_id=? AND session_id=?",this::leftoverRow,scope,session).stream().findFirst();}
    public Leftover insertLeftover(UUID scope,UUID actor,UUID session,UUID recipe,String title,BigDecimal quantity,LocalDate cooked,LocalDate useBy){
        UUID id=UUID.randomUUID();jdbc.update("INSERT INTO public.kitchen_leftovers(id,scope_id,actor_id,session_id,recipe_id,title,servings_available,cooked_on,use_by) VALUES(?,?,?,?,?,?,?,?,?)",id,scope,actor,session,recipe,title,quantity,java.sql.Date.valueOf(cooked),useBy==null?null:java.sql.Date.valueOf(useBy));
        return leftover(scope,id).orElseThrow();
    }
    public boolean consume(UUID scope,UUID id,long version,BigDecimal amount){return jdbc.update("UPDATE public.kitchen_leftovers SET servings_available=servings_available-?,version=version+1 WHERE scope_id=? AND id=? AND version=? AND servings_available>=?",amount,scope,id,version,amount)==1;}
    public Optional<Receipt> receipt(UUID scope,String key){return jdbc.query("SELECT actor_id,fingerprint,response FROM public.kitchen_growth_receipts WHERE scope_id=? AND idempotency_key=?",(r,n)->new Receipt(r.getObject(1,UUID.class),r.getString(2),object(r.getString(3))),scope,key).stream().findFirst();}
    public void receipt(UUID scope,UUID actor,String key,String fingerprint,Map<String,Object> response){jdbc.update("INSERT INTO public.kitchen_growth_receipts(scope_id,actor_id,idempotency_key,fingerprint,response) VALUES(?,?,?,?,CAST(? AS jsonb))",scope,actor,key,fingerprint,json(response));}
    private Feedback feedbackRow(java.sql.ResultSet r,int n)throws java.sql.SQLException{return new Feedback(r.getObject("id",UUID.class),r.getObject("scope_id",UUID.class),r.getObject("user_id",UUID.class),r.getObject("session_id",UUID.class),r.getObject("recipe_id",UUID.class),r.getInt("rating"),object(r.getString("body")),r.getLong("version"),r.getTimestamp("updated_at").toInstant());}
    private Leftover leftoverRow(java.sql.ResultSet r,int n)throws java.sql.SQLException{return new Leftover(r.getObject("id",UUID.class),r.getObject("scope_id",UUID.class),r.getObject("session_id",UUID.class),r.getObject("recipe_id",UUID.class),r.getString("title"),r.getBigDecimal("servings_available"),r.getDate("cooked_on").toLocalDate(),r.getDate("use_by")==null?null:r.getDate("use_by").toLocalDate(),r.getTimestamp("confirmed_at").toInstant(),r.getLong("version"));}
    private String json(Object value){try{return mapper.writeValueAsString(value);}catch(java.io.IOException e){throw new IllegalStateException("Growth memory serialization failed",e);}}
    private Map<String,Object> object(String value){try{var node=mapper.readTree(value);return mapper.readValue(node.isTextual()?node.asText():value,new TypeReference<>(){});}catch(java.io.IOException e){throw new IllegalStateException("Growth memory record is invalid",e);}}
}
