package com.server.letMeCook.controller;
import com.server.letMeCook.security.RequestIdentity;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
@RestController @RequestMapping("/api/reviews")
public class ReviewController {
 private final JdbcTemplate jdbc;
 public ReviewController(JdbcTemplate jdbc){this.jdbc=jdbc;}
 @PostMapping @Transactional public Map<String,Object> create(@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){
  UUID owner=RequestIdentity.optionalUserId(jwt);if(owner==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Sign in to leave a review.");
  UUID recipe;try{recipe=UUID.fromString(String.valueOf(body.get("recipeId")));}catch(Exception e){throw bad("Choose a recipe.");}
  if(!(body.get("comment")instanceof String comment)||comment.isBlank()||comment.length()>3000)throw bad("Write a review of 1–3000 characters.");
  if(!(body.get("ratings")instanceof Map<?,?> ratings)||!ratings.keySet().equals(Set.of("cost","time","difficulty","overall")))throw bad("Rate all four categories.");
  for(Object raw:ratings.values())if(!(raw instanceof Number n)||n.doubleValue()!=n.intValue()||n.intValue()<1||n.intValue()>5)throw bad("Each rating must be an integer from 1 to 5.");
  if(jdbc.queryForObject("SELECT count(*) FROM public.recipe WHERE id=? AND (author_id=? OR (is_public=true AND public.lmc_recipe_demo_visible(demo_permission_confirmed,demo_permission_note,image_kind,image_url)))",Long.class,recipe,owner)!=1)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Recipe not found.");
  UUID id=UUID.randomUUID();jdbc.update("INSERT INTO public.reviews(id,recipe_id,user_id,comment) VALUES(?,?,?,?)",id,recipe,owner,comment.trim());
  for(var entry:ratings.entrySet())jdbc.update("INSERT INTO public.review_ratings(review_id,category,value) VALUES(?,?,?)",id,entry.getKey(),((Number)entry.getValue()).intValue());
  return Map.of("id",id,"message","Your review was saved.");
 }
 private static ResponseStatusException bad(String message){return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);}
}
