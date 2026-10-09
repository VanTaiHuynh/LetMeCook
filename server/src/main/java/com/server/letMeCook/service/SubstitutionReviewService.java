package com.server.letMeCook.service;

import com.server.letMeCook.repository.KitchenRepository;
import com.server.letMeCook.repository.KitchenRepository.Record;
import java.net.URI;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Administrator curation is separate from the cook's own review declaration. */
@Service
public class SubstitutionReviewService {
    private final KitchenRepository repository;
    public SubstitutionReviewService(KitchenRepository repository) { this.repository=repository; }

    @Transactional(readOnly=true)
    public Map<String,Object> list(Jwt jwt) {
        PlatformService.admin(jwt);
        List<Record> records=repository.swapsForReview(101);
        return Map.of("rules",records.stream().limit(100).map(SubstitutionReviewService::view).toList(),"limit",100,"truncated",records.size()>100);
    }

    @Transactional
    public Map<String,Object> review(UUID id,Map<String,Object> input,Jwt jwt) {
        UUID actor=PlatformService.admin(jwt);
        if(input==null)throw bad("Provide a curation review.");
        Object rawVersion=input.get("version");
        if(!(rawVersion instanceof Number number)||number.longValue()<1||number.longValue()==Long.MAX_VALUE||number.doubleValue()!=number.longValue())throw bad("Provide the current rule version.");
        long expected=((Number)rawVersion).longValue();
        String status=PlatformService.text(input.get("status"),"status",20);
        if(!Set.of("approved","rejected").contains(status))throw bad("Approve or reject this rule.");
        String note=PlatformService.text(input.get("reviewNote"),"reviewNote",3000);
        String source=source(input.get("sourceUrl"));
        Record initial=repository.swapForReview(id).orElseThrow(SubstitutionReviewService::missing);
        repository.lock(initial.scopeId());
        Record current=repository.record(initial.scopeId(),id,"swap").orElseThrow(SubstitutionReviewService::missing);
        if(current.version()!=expected)throw conflict();
        // Start with the persisted declaration, never a caller-supplied rule or reviewer identity.
        Map<String,Object> body=new LinkedHashMap<>(current.body());
        body.put("approvalStatus",status);
        body.put("approvalNote",note);
        body.put("approvalSourceUrl",source);
        body.put("approvalReviewedBy",actor.toString());
        body.put("approvalReviewedAt",Instant.now().toString());
        body.put("approvalReviewType","administrator curation; no expert credential attestation");
        Record reviewed=repository.update(current.scopeId(),id,"swap",expected,body).orElseThrow(SubstitutionReviewService::conflict);
        repository.revise(current.scopeId());
        return Map.of("rule",view(reviewed));
    }

    private static Map<String,Object> view(Record record) {
        Map<String,Object> result=new LinkedHashMap<>(record.body());
        result.put("id",record.id().toString());result.put("scopeId",record.scopeId().toString());result.put("version",record.version());
        result.put("approvalStatus",record.body().getOrDefault("approvalStatus","pending"));
        result.put("createdAt",record.createdAt().toString());result.put("updatedAt",record.updatedAt().toString());
        return result;
    }
    private static String source(Object value) {
        String source=PlatformService.text(value,"sourceUrl",2000);
        try {
            URI uri=URI.create(source);
            if(!("https".equals(uri.getScheme())||"http".equals(uri.getScheme()))||uri.getHost()==null||uri.getUserInfo()!=null)throw bad("Provide a valid HTTP source URL without credentials.");
        }catch(IllegalArgumentException error){throw bad("Provide a valid HTTP source URL.");}
        return source;
    }
    private static ResponseStatusException bad(String message){return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);}
    private static ResponseStatusException missing(){return new ResponseStatusException(HttpStatus.NOT_FOUND,"Substitution rule is unavailable.");}
    private static ResponseStatusException conflict(){return new ResponseStatusException(HttpStatus.CONFLICT,"This substitution changed. Reload the current rule before reviewing it.");}
}
