package com.server.letMeCook.service;

import com.server.letMeCook.dto.recipe.RecipeCardDTO;
import com.server.letMeCook.repository.UserRepository;
import com.server.letMeCook.repository.MealPlanRepository;
import java.util.*;
import org.springframework.data.domain.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@Transactional(readOnly=true)
public class AccountReadService {
    public record AllergyIngredient(UUID id,String name){}
    public record Profile(String contractVersion,UUID id,String firstName,String lastName,String fullName,String email,
        String cookingSkill,List<String> dietaryPreferences,List<UUID> allergyIngredientIds,List<String> allergyNames,List<AllergyIngredient> allergyIngredients,String aboutMe,String imageUrl){}
    public record Summary(String contractVersion,String fullName,long recipeCount,long favoriteCount,long reviewCount){}
    public record State(String contractVersion,boolean owned,boolean favorite){}
    private final JdbcTemplate jdbc;private final UserRepository users;private final MealPlanRepository profiles;private final PlatformService platform;
    public AccountReadService(JdbcTemplate jdbc,UserRepository users,MealPlanRepository profiles,PlatformService platform){this.jdbc=jdbc;this.users=users;this.profiles=profiles;this.platform=platform;}
    public Profile profile(UUID actor){var user=users.findById(actor).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Your profile is unavailable."));var prefs=profiles.restrictionPreferences(actor);Set<UUID> ids=new LinkedHashSet<>(jdbc.queryForList("SELECT ingredient_id FROM public.user_allergy WHERE user_id=? ORDER BY ingredient_id",UUID.class,actor));
        jdbc.query("SELECT user_allergy FROM public.users WHERE id=?",r->{java.sql.Array array=r.getArray(1);if(array!=null){try{for(Object raw:(Object[])array.getArray())if(raw!=null)ids.add(UUID.fromString(raw.toString()));}finally{array.free();}}},actor);
        List<AllergyIngredient> pairs=ids.isEmpty()?List.of():jdbc.query("SELECT id,name FROM public.ingredients WHERE id IN ("+String.join(",",Collections.nCopies(ids.size(),"?"))+") ORDER BY id",(r,n)->new AllergyIngredient(r.getObject(1,UUID.class),r.getString(2)),ids.toArray());
        return new Profile("account.v1",actor,clean(user.getFirstName()),clean(user.getLastName()),(clean(user.getFirstName())+" "+clean(user.getLastName())).trim(),clean(user.getEmail()),clean(user.getCookingLvl()),strings(prefs.get("dietaryPreferences")),pairs.stream().map(AllergyIngredient::id).toList(),strings(prefs.get("allergies")),pairs,clean(user.getAboutMe()),clean(user.getImageUrl()));}
    public Summary summary(UUID actor){var user=users.findById(actor).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Your profile is unavailable."));return new Summary("account.v1",(clean(user.getFirstName())+" "+clean(user.getLastName())).trim(),count("SELECT count(*) FROM public.recipe WHERE author_id=?",actor),count("SELECT count(*) FROM public.recipe_favourites f JOIN public.recipe r ON r.id=f.recipe_id WHERE f.user_id=? AND "+visible(),actor,actor),count("SELECT count(*) FROM public.reviews WHERE user_id=?",actor));}
    public Page<RecipeCardDTO> recipes(UUID actor,int page,int size,boolean favorites){if(page<0||page>1000000||size<1||size>24)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Choose a page size from 1 to 24.");
        String joins=" FROM public.recipe r LEFT JOIN public.users u ON u.id=r.author_id";
        String where;List<Object> params=new ArrayList<>();
        if(favorites){joins+=" JOIN public.recipe_favourites f ON f.recipe_id=r.id";where=" WHERE f.user_id=? AND "+visible();params.add(actor);params.add(actor);}else{where=" WHERE r.author_id=?";params.add(actor);}
        String order=favorites?" ORDER BY f.created_at DESC,f.id":" ORDER BY r.created_at DESC NULLS LAST,r.id";
        long total=count("SELECT count(*)"+joins+where,params.toArray());params.add(size);params.add((long)page*size);
        List<RecipeCardDTO> rows=jdbc.query("SELECT r.id,r.title,r.description,r.servings,r.image_url,r.source_url,r.source_license,r.source_author,r.image_source_url,r.image_author,r.image_license,r.image_kind,r.time,r.rating_average,r.rating_count,u.first_name,u.last_name"+joins+where+order+" LIMIT ? OFFSET ?",(r,n)->{RecipeCardDTO dto=new RecipeCardDTO();dto.setId(r.getObject("id",UUID.class));dto.setTitle(r.getString("title"));dto.setDescription(r.getString("description"));dto.setServings(r.getFloat("servings"));dto.setImageUrl(r.getString("image_url"));dto.setSourceUrl(r.getString("source_url"));dto.setSourceLicense(r.getString("source_license"));dto.setSourceAuthor(r.getString("source_author"));dto.setImageSourceUrl(r.getString("image_source_url"));dto.setImageAuthor(r.getString("image_author"));dto.setImageLicense(r.getString("image_license"));dto.setImageKind(r.getString("image_kind"));dto.setCookingTime(r.getInt("time"));dto.setRatingAverage(r.getDouble("rating_average"));dto.setRatingCount(r.getInt("rating_count"));String name=(clean(r.getString("first_name"))+" "+clean(r.getString("last_name"))).trim();dto.setAuthorName(name.isBlank()?Objects.requireNonNullElse(r.getString("source_author"),"Unknown"):name);return dto;},params.toArray());return new PageImpl<>(rows,PageRequest.of(page,size),total);}
    public State state(UUID actor,UUID recipe){List<Map<String,Object>> rows=jdbc.queryForList("SELECT r.author_id,EXISTS(SELECT 1 FROM public.recipe_favourites f WHERE f.recipe_id=r.id AND f.user_id=?) AS favorite FROM public.recipe r WHERE r.id=? AND "+visible(),actor,recipe,actor);if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"This recipe is unavailable.");var row=rows.getFirst();return new State("account.v1",actor.equals(row.get("author_id")),Boolean.TRUE.equals(row.get("favorite")));}
    private String visible(){return "(r.author_id=? OR (r.is_public=true"+(platform.publicDemo()?" AND r.demo_permission_confirmed=true AND length(trim(coalesce(r.demo_permission_note,'')))>0 AND r.image_kind='source' AND r.image_url LIKE '/recipe-images/%'":"")+"))";}
    private long count(String sql,Object... args){return Objects.requireNonNull(jdbc.queryForObject(sql,Long.class,args));}
    private static String clean(String value){return value==null?"":value;}
    private static List<String> strings(Object raw){return raw instanceof Collection<?> list?list.stream().filter(String.class::isInstance).map(String.class::cast).toList():List.of();}
}
