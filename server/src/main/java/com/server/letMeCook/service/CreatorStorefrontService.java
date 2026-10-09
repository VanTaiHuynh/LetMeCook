package com.server.letMeCook.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.KitchenRepository;
import com.server.letMeCook.security.RequestIdentity;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Public projections never expose kitchen records; each read rechecks source permissions. */
@Service
@Transactional
public class CreatorStorefrontService {
    static final String ELIGIBLE = "r.is_public AND r.demo_permission_confirmed AND length(trim(coalesce(r.demo_permission_note,'')))>0 AND r.image_kind='source' AND r.image_url ~ '^/recipe-images/[0-9a-fA-F-]{36}\\.(jpg|jpeg|png|webp|gif)$'";
    static final String CATALOG = " FROM public.kitchen_records c JOIN public.recipe r ON r.id::text=c.body->>'recipeId' WHERE c.scope_id=? AND c.kind='catalog' AND " + ELIGIBLE;
    private static final Set<String> RESERVED = Set.of("api","admin","login","register","recipes","collections","creator","terms","privacy","sunny","pantry");
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final KitchenRepository repository;
    private final KitchenScopeAccess access;
    private final boolean enabled;
    public record Publication(String slug, boolean published, long version) { }
    public record RecipeCard(UUID id, String title, String imageUrl, String sourceUrl, String sourceAuthor, Integer cookTime) { }
    public record Collection(String contractVersion,String slug,String name,String description,String accentColor,List<RecipeCard> recipes,long totalRecipes) { }
    public record Settings(String contractVersion,boolean featureEnabled,String slug,boolean published,long version,long eligibleRecipeCount,long omittedRecipeCount,String collectionUrl) { }
    public record Change(String slug,Boolean published,Long version,Boolean publishingAcknowledged) { }
    public CreatorStorefrontService(JdbcTemplate jdbc,ObjectMapper mapper,KitchenRepository repository,KitchenScopeAccess access,@Value("${creator.storefront-enabled:false}")boolean enabled) {
        this.jdbc=jdbc;this.mapper=mapper;this.repository=repository;this.access=access;this.enabled=enabled;
    }
    public Settings settings(UUID household,Jwt jwt) {
        UUID actor=actor(jwt);var scope=managementScope(actor,household);
        return settings(scope.id());
    }
    public Settings save(UUID household,Change change,Jwt jwt) {
        UUID actor=actor(jwt);
        if(change==null||change.published()==null||change.version()==null||change.version()<0)throw error(HttpStatus.BAD_REQUEST,"Choose a publication state and current version.");
        var scope=change.published()?access.require(actor,household,KitchenScopeAccess.Access.OWNER_WRITE):managementScope(actor,household);
        String slug=slug(change.slug());
        Publication current=publication(scope.id()).orElse(new Publication(null,false,0));
        if(current.version()!=change.version())throw error(HttpStatus.CONFLICT,"Publication changed. Reload before saving.");
        if(change.published()) {
            if(!enabled)throw error(HttpStatus.SERVICE_UNAVAILABLE,"Public collections are not enabled on this installation.");
            if(!Boolean.TRUE.equals(change.publishingAcknowledged()))throw error(HttpStatus.BAD_REQUEST,"Confirm that you want to publish this collection.");
            if(repository.records(scope.id(),"workspace",1).isEmpty())throw error(HttpStatus.BAD_REQUEST,"Save your workspace first.");
            if(eligible(scope.id())==0)throw error(HttpStatus.BAD_REQUEST,"No reviewed public recipes are available to publish.");
        }
        try {
            int changed=current.version()==0?jdbc.update("INSERT INTO public.kitchen_publications(scope_id,slug,published,version) VALUES (?,?,?,1)",scope.id(),slug,change.published()):
                jdbc.update("UPDATE public.kitchen_publications SET slug=?,published=?,version=version+1,updated_at=now() WHERE scope_id=? AND version=?",slug,change.published(),scope.id(),change.version());
            if(changed!=1)throw error(HttpStatus.CONFLICT,"Publication changed. Reload before saving.");
        } catch(DuplicateKeyException conflict) {throw error(HttpStatus.CONFLICT,"This collection address is already used. Choose another.");}
        return settings(scope.id());
    }
    @Transactional(readOnly=true)
    public Collection collection(String rawSlug) {
        if(!enabled)throw unavailable();
        String slug;
        try{slug=slug(rawSlug);}catch(ResponseStatusException invalid){throw unavailable();}
        var rows=jdbc.queryForList("SELECT p.scope_id,w.body::text AS workspace FROM public.kitchen_publications p JOIN public.kitchen_records w ON w.scope_id=p.scope_id AND w.kind='workspace' WHERE p.slug=? AND p.published ORDER BY w.updated_at DESC,w.id LIMIT 1",slug);
        if(rows.isEmpty())throw unavailable();
        UUID scope=UUID.fromString(rows.getFirst().get("scope_id").toString());
        Map<String,Object> workspace;
        try{workspace=mapper.readValue(rows.getFirst().get("workspace").toString(),new TypeReference<>(){});}catch(Exception badWorkspace){throw unavailable();}
        List<RecipeCard> cards=jdbc.query("SELECT DISTINCT r.id,r.title,r.image_url,r.source_url,r.source_author,r.time AS cook_time"+CATALOG+" ORDER BY r.title,r.id LIMIT 48",
            (rs,n)->new RecipeCard(rs.getObject("id",UUID.class),rs.getString("title"),rs.getString("image_url"),safeUrl(rs.getString("source_url")),rs.getString("source_author"),rs.getObject("cook_time",Integer.class)),scope);
        if(cards.isEmpty())throw unavailable();
        String accent=String.valueOf(workspace.getOrDefault("accentColor","#A37516"));
        if(!accent.matches("#[0-9a-fA-F]{6}"))accent="#A37516";
        return new Collection("creator.v1",slug,text(workspace.get("name"),"Recipe collection",100),text(workspace.get("description"),"",3000),accent,cards,eligible(scope));
    }
    private KitchenRepository.Scope managementScope(UUID actor,UUID household) {
        var initial=household==null?repository.personal(actor):access.current(actor,household);
        repository.lock(initial.id());
        var current=access.current(actor,initial.id());
        if(household!=null&&!"household".equals(current.kind())||!"owner".equals(current.role()))throw error(HttpStatus.FORBIDDEN,"Only this kitchen's current owner can manage publication.");
        return current;
    }
    private Settings settings(UUID scope) {
        Publication publication=publication(scope).orElse(new Publication(null,false,0));
        long eligible=eligible(scope);
        Long total=jdbc.queryForObject("SELECT count(*) FROM public.kitchen_records WHERE scope_id=? AND kind='catalog'",Long.class,scope);
        return new Settings("creator.v1",enabled,publication.slug(),publication.published(),publication.version(),eligible,Math.max(0,(total==null?0:total)-eligible),enabled&&publication.published()&&eligible>0?"/collections/"+publication.slug():null);
    }
    private long eligible(UUID scope) {Long count=jdbc.queryForObject("SELECT count(DISTINCT r.id)"+CATALOG,Long.class,scope);return count==null?0:count;}
    private Optional<Publication> publication(UUID scope) {
        return jdbc.query("SELECT slug,published,version FROM public.kitchen_publications WHERE scope_id=?",(rs,n)->new Publication(rs.getString("slug"),rs.getBoolean("published"),rs.getLong("version")),scope).stream().findFirst();
    }
    static String slug(String value) {
        if(value==null||!value.matches("[a-z0-9]+(?:-[a-z0-9]+)*")||value.length()<3||value.length()>80||RESERVED.contains(value))throw error(HttpStatus.BAD_REQUEST,"Use 3–80 lowercase letters, numbers or hyphens for the collection address.");
        return value;
    }
    private static String safeUrl(String value) {
        if(value==null)return null;
        try{var uri=java.net.URI.create(value);return Set.of("https","http").contains(uri.getScheme())&&uri.getHost()!=null&&uri.getUserInfo()==null?value:null;}catch(Exception invalid){return null;}
    }
    private static String text(Object value,String fallback,int limit){return value instanceof String text&&!text.isBlank()?text.substring(0,Math.min(text.length(),limit)):fallback;}
    private static UUID actor(Jwt jwt){UUID id=RequestIdentity.optionalUserId(jwt);if(id==null)throw error(HttpStatus.UNAUTHORIZED,"Sign in to manage your collection.");return id;}
    private static ResponseStatusException unavailable(){return error(HttpStatus.NOT_FOUND,"Collection is unavailable.");}
    private static ResponseStatusException error(HttpStatus status,String text){return new ResponseStatusException(status,text);}
}
