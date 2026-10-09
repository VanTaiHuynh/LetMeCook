package com.server.letMeCook.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@Transactional
public class PlatformService {
 private final JdbcTemplate jdbc;
 private final ObjectMapper mapper;
 private final JavaMailSenderImpl mail = new JavaMailSenderImpl();
 private final String baseUrl;
 private final ConcurrentHashMap<String,ArrayDeque<Long>> rate = new ConcurrentHashMap<>();
 public PlatformService(JdbcTemplate jdbc,ObjectMapper mapper,@Value("${platform.mail.host:127.0.0.1}")String host,@Value("${platform.mail.port:56425}")int port,@Value("${platform.base-url:http://localhost:9401}")String baseUrl){
  this.jdbc=jdbc;this.mapper=mapper;this.baseUrl=baseUrl.replaceAll("/+$","");mail.setHost(host);mail.setPort(port);
  var properties=mail.getJavaMailProperties();properties.setProperty("mail.smtp.connectiontimeout","5000");properties.setProperty("mail.smtp.timeout","5000");properties.setProperty("mail.smtp.writetimeout","5000");
 }
 public Map<String,Object> config(){
  try{Map<String,Object> flags=mapper.readValue(jdbc.queryForObject("SELECT settings::text FROM public.lmc_platform_settings WHERE id=true",String.class),new TypeReference<>(){});flags.put("collaborationEnabled",Boolean.TRUE.equals(flags.get("collaborationEnabled")));return flags;}
  catch(Exception e){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Platform configuration is unavailable.");}
 }
 public void imageAccess(String path){
  if(!path.matches("/recipe-images/[0-9a-fA-F-]{36}\\.(?:jpg|jpeg|png|webp|gif)")||publicDemo()&&jdbc.queryForObject("SELECT count(*) FROM public.recipe WHERE image_url=? AND is_public AND demo_permission_confirmed AND coalesce(demo_permission_note,'')<>'' AND image_kind='source'",Long.class,path)==0)throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Image unavailable.");
 }
 public boolean publicDemo(){return Boolean.TRUE.equals(config().get("publicDemo"));}
 public boolean collaborationEnabled(){return Boolean.TRUE.equals(config().get("collaborationEnabled"));}
 public static UUID admin(Jwt jwt){
  if(jwt==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Sign in to continue.");
  Map<String,Object> metadata=jwt.getClaimAsMap("app_metadata");
  if(metadata==null||!"admin".equals(metadata.get("role")))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Administrator access is required.");
  return UUID.fromString(jwt.getSubject());
 }
 public void limit(String key){
  if(rate.size()>5000)rate.entrySet().removeIf(e->{synchronized(e.getValue()){return e.getValue().isEmpty()||e.getValue().peekLast()<System.currentTimeMillis()-3600000;}});
  var queue=rate.computeIfAbsent(key,k->new ArrayDeque<>());synchronized(queue){long now=System.currentTimeMillis();while(!queue.isEmpty()&&queue.peekFirst()<now-3600000)queue.removeFirst();if(queue.size()>=8)throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"Please wait before submitting more requests.");queue.addLast(now);}
 }
 public Map<String,Object> contact(Map<String,Object> body,String address){
  limit("contact:"+address);String name=text(body.get("name"),"name",100),email=email(body.get("email")),message=text(body.get("message"),"message",5000);
  UUID id=UUID.randomUUID();jdbc.update("INSERT INTO public.lmc_contacts(id,name,email,message) VALUES(?,?,?,?)",id,name,email,message);
  return Map.of("id",id,"message","Your message was saved to the local team inbox.");
 }
 @Transactional public Map<String,Object> subscribe(Map<String,Object> body,String address){
  limit("newsletter:"+address);String email=email(body.get("email"));if(!Boolean.TRUE.equals(body.get("consent")))throw bad("Confirm that you want to receive the newsletter.");
  String confirm=token(),unsubscribe=token();
  jdbc.update("INSERT INTO public.lmc_newsletter(email,consent_version,confirmation_hash,confirmation_expires_at,unsubscribe_hash) VALUES(?,'2026-10-08',?,now()+interval '1 day',?) ON CONFLICT(email) DO UPDATE SET confirmation_hash=EXCLUDED.confirmation_hash,confirmation_expires_at=EXCLUDED.confirmation_expires_at,unsubscribe_hash=EXCLUDED.unsubscribe_hash,consent_version=EXCLUDED.consent_version",email,hash(confirm),hash(unsubscribe));
  send(email,"Confirm your LetMeCook newsletter subscription","Please confirm your subscription by opening this link:\n"+baseUrl+"/newsletter?confirm="+confirm+"\n\nThe confirmation expires in 24 hours.\nUnsubscribe at any time:\n"+baseUrl+"/newsletter?unsubscribe="+unsubscribe);
  return Map.of("message","Check the local test inbox to confirm your subscription.","deliveryMode","local-capture","inboxUrl","http://localhost:56426");
 }
 @Transactional public Map<String,Object> newsletterToken(String raw,boolean unsubscribe){
  if(raw==null||!raw.matches("[A-Za-z0-9_-]{43}"))throw bad("This newsletter link is invalid.");
  int changed=unsubscribe?jdbc.update("UPDATE public.lmc_newsletter SET unsubscribed_at=now(),confirmation_hash=null WHERE unsubscribe_hash=? OR id IN(SELECT subscription_id FROM public.lmc_newsletter_tokens WHERE token_hash=?)",hash(raw),hash(raw)):
   jdbc.update("UPDATE public.lmc_newsletter SET confirmed_at=now(),unsubscribed_at=null,confirmation_hash=null WHERE confirmation_hash=? AND confirmation_expires_at>now()",hash(raw));
  if(changed!=1)throw bad("This link is invalid, expired or already used.");return Map.of("message",unsubscribe?"You have been unsubscribed.":"Your subscription is confirmed.");
 }
 public Map<String,Object> operations(Jwt jwt){
  admin(jwt);Map<String,Object> result=new LinkedHashMap<>();result.put("settings",config());result.put("contacts",jdbc.queryForList("SELECT id,name,email,message,status,created_at FROM public.lmc_contacts ORDER BY created_at DESC LIMIT 100"));
  result.put("audit",jdbc.queryForList("SELECT id,actor_id,action,target,response_status,created_at FROM public.lmc_admin_audit ORDER BY created_at DESC LIMIT 100"));
  result.put("newsletter",Map.of("confirmed",jdbc.queryForObject("SELECT count(*) FROM public.lmc_newsletter WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL",Long.class),"pending",jdbc.queryForObject("SELECT count(*) FROM public.lmc_newsletter WHERE confirmed_at IS NULL",Long.class),"deliveryMode","local-capture"));
  result.put("catalog",Map.of("total",jdbc.queryForObject("SELECT count(*) FROM public.recipe",Long.class),"demoApproved",jdbc.queryForObject("SELECT count(*) FROM public.recipe WHERE demo_permission_confirmed AND image_kind='source' AND image_url LIKE '/recipe-images/%' AND coalesce(demo_permission_note,'')<>''",Long.class)));
  result.put("aliases",jdbc.queryForList("SELECT a.alias,a.ingredient_id,i.name,a.review_note FROM public.lmc_ingredient_aliases a JOIN public.ingredients i ON i.id=a.ingredient_id ORDER BY a.alias LIMIT 200"));return result;
 }
 @Transactional public Map<String,Object> settings(Map<String,Object> body,Jwt jwt){
  admin(jwt);Map<String,Object> settings=new LinkedHashMap<>();for(String key:List.of("publicDemo","kitchenEnabled","voiceEnabled","collaborationEnabled")){if(!(body.get(key) instanceof Boolean))throw bad(key+" must be true or false.");settings.put(key,body.get(key));}
  try{jdbc.update("UPDATE public.lmc_platform_settings SET settings=?::jsonb,version=version+1 WHERE id=true",mapper.writeValueAsString(settings));}catch(java.io.IOException e){throw bad("Settings are invalid.");}return settings;
 }
 public Map<String,Object> reviewCatalog(UUID id,Map<String,Object> body,Jwt jwt){
  admin(jwt);Object confirmed=body.get("permissionConfirmed");if(!(confirmed instanceof Boolean))throw bad("Confirm the permission status.");String note=text(body.get("permissionNote"),"permissionNote",2000);
  if(jdbc.update("UPDATE public.recipe SET demo_permission_confirmed=?,demo_permission_note=?,demo_reviewed_at=now() WHERE id=?",confirmed,note,id)!=1)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Recipe not found.");return Map.of("message","Catalog permission declaration recorded.");
 }
 public Map<String,Object> alias(Map<String,Object> body,Jwt jwt){
  UUID actor=admin(jwt),ingredient;try{ingredient=UUID.fromString(body.get("ingredientId").toString());}catch(Exception e){throw bad("Choose an ingredient UUID.");}
  String alias=text(body.get("alias"),"alias",100).toLowerCase(Locale.ROOT),note=text(body.get("reviewNote"),"reviewNote",2000);
  if(jdbc.queryForObject("SELECT count(*) FROM public.ingredients WHERE id=?",Long.class,ingredient)!=1)throw bad("Ingredient not found.");
  jdbc.update("INSERT INTO public.lmc_ingredient_aliases(alias,ingredient_id,reviewed_by,review_note) VALUES(?,?,?,?) ON CONFLICT(alias) DO UPDATE SET ingredient_id=EXCLUDED.ingredient_id,reviewed_by=EXCLUDED.reviewed_by,review_note=EXCLUDED.review_note",alias,ingredient,actor,note);return Map.of("message","Reviewed alias saved.");
 }
 public Map<String,Object> contactStatus(UUID id,Map<String,Object> body,Jwt jwt){admin(jwt);String status=String.valueOf(body.get("status"));if(!List.of("new","read","resolved").contains(status))throw bad("Choose a valid status.");if(jdbc.update("UPDATE public.lmc_contacts SET status=? WHERE id=?",status,id)!=1)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Message not found.");return Map.of("message","Message updated.");}
 public Map<String,Object> dispatch(Map<String,Object> body,Jwt jwt){admin(jwt);String subject=text(body.get("subject"),"subject",150),content=text(body.get("content"),"content",10000);var subscribers=jdbc.queryForList("SELECT id,email FROM public.lmc_newsletter WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL ORDER BY created_at LIMIT 100");int sent=0;
  for(var subscriber:subscribers){try{String unsubscribe=token();jdbc.update("INSERT INTO public.lmc_newsletter_tokens(token_hash,subscription_id) VALUES(?,?)",hash(unsubscribe),subscriber.get("id"));send(subscriber.get("email").toString(),subject,content+"\n\nUnsubscribe:\n"+baseUrl+"/newsletter?unsubscribe="+unsubscribe);jdbc.update("INSERT INTO public.lmc_newsletter_deliveries(subscription_id,subject,status) VALUES(?,?,'captured')",subscriber.get("id"),subject);sent++;}catch(ResponseStatusException e){jdbc.update("INSERT INTO public.lmc_newsletter_deliveries(subscription_id,subject,status) VALUES(?,?,'failed')",subscriber.get("id"),subject);}}
  return Map.of("captured",sent,"attempted",subscribers.size(),"deliveryMode","local-capture");
 }
 private void send(String to,String subject,String text){try{var message=new SimpleMailMessage();message.setFrom("newsletter@letmecook.local");message.setTo(to);message.setSubject(subject);message.setText(text);mail.send(message);}catch(Exception e){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"The local mail inbox is unavailable. Please retry.");}}
 public void audit(UUID actor,String action,String target,int status){jdbc.update("INSERT INTO public.lmc_admin_audit(actor_id,action,target,response_status) VALUES(?,?,?,?)",actor,action,target,status);}
 public static String text(Object value,String field,int max){if(!(value instanceof String s)||s.isBlank()||s.length()>max||s.indexOf('\0')>=0)throw bad(field+" must contain 1–"+max+" characters.");return s.trim();}
 private static String email(Object value){String email=text(value,"email",254).toLowerCase(Locale.ROOT);if(!email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))throw bad("Enter a valid email address.");return email;}
 private static String token(){byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);}
 private static String hash(String value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}}
 private static ResponseStatusException bad(String message){return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);}
}
