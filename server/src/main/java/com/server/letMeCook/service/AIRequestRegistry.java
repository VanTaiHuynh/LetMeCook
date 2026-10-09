package com.server.letMeCook.service;
import com.server.letMeCook.security.AIRequestContext;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import static com.server.letMeCook.security.AIRequestContext.failure;

public class AIRequestRegistry {
    public record Job(UUID actor,UUID scope,byte[] tokenHash,Instant expiresAt,boolean finished){}
    private final Map<UUID,Job> jobs=new ConcurrentHashMap<>();
    public synchronized void start(AIRequestContext.Control control){
        if(control.registered)return;Instant now=Instant.now();jobs.entrySet().removeIf(e->!e.getValue().expiresAt().isAfter(now));
        if(jobs.size()>=2000)throw failure(429,"Local AI request controls are busy. Try again shortly.");
        Job value=new Job(control.actor,control.scope,digest(control.token),now.plusSeconds(900),false);
        if(jobs.putIfAbsent(control.id,value)!=null)throw failure(409,"This AI request ID was already used. Start a new request.");control.registered=true;
    }
    public Optional<Job> authorize(UUID id,UUID actor,String token){
        if(token==null||!token.matches("[A-Za-z0-9_-]{32,128}"))throw failure(403,"This request cannot be cancelled with these controls.");
        Job job=jobs.get(id);if(job==null||!job.expiresAt().isAfter(Instant.now()))return Optional.empty();
        if(!Objects.equals(job.actor(),actor)||!MessageDigest.isEqual(job.tokenHash(),digest(token)))throw failure(403,"This request belongs to another caller.");
        return Optional.of(job);
    }
    public void finish(AIRequestContext.Control control){if(control!=null&&control.registered)jobs.computeIfPresent(control.id,(id,value)->new Job(value.actor(),value.scope(),value.tokenHash(),value.expiresAt(),true));}
    private static byte[] digest(String token){try{return MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));}catch(Exception e){throw new IllegalStateException(e);}}
}
