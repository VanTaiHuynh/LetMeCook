package com.server.letMeCook.service;

import com.server.letMeCook.config.RecommendationProperties;
import java.net.URI;
import java.util.*;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.*;
import org.springframework.web.server.ResponseStatusException;

@Service
public class RecommendationService {
    private final RestTemplate restTemplate;
    private final String origin;
    @org.springframework.beans.factory.annotation.Autowired(required=false) private AIRequestRegistry requestRegistry;
    private static final ParameterizedTypeReference<Map<String,Object>> RESPONSE = new ParameterizedTypeReference<>() {};

    public RecommendationService(RestTemplate restTemplate, RecommendationProperties properties) {
        this.restTemplate=restTemplate;
        URI uri=URI.create(properties.getUrl());
        if(!"http".equals(uri.getScheme()) || !Set.of("localhost","127.0.0.1","::1","[::1]").contains(uri.getHost())
                || uri.getUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null
                || (uri.getPath()!=null && !uri.getPath().isEmpty() && !uri.getPath().equals("/"))) {
            throw new IllegalArgumentException("Recommendation URL must be an HTTP loopback origin");
        }
        origin=properties.getUrl().replaceAll("/+$", "");
    }

    public List<UUID> recommendByRecipeId(UUID recipeId,int topK) {
        count(topK);if(recipeId==null)throw bad("Choose a recipe ID.");
        return recommendations(call("/recommend/id?recipeId="+recipeId+"&topK="+topK,HttpMethod.GET,null).getBody(),topK,null,Set.of());
    }

    public List<UUID> recommendForUser(List<UUID> favorites,List<UUID> history,int topK) {
        count(topK);bounded(favorites,100,"Favorites");bounded(history,100,"History");
        if(favorites.isEmpty()&&history.isEmpty())throw bad("Choose favorite or recent recipe IDs.");
        String path="/recommend/user?favorites="+String.join(",",favorites.stream().map(UUID::toString).toList())
                +"&history="+String.join(",",history.stream().map(UUID::toString).toList())+"&topK="+topK;
        Set<UUID> seen=new HashSet<>(favorites);seen.addAll(history);
        return recommendations(call(path,HttpMethod.GET,null).getBody(),topK,null,seen);
    }

    /** Complete current SQL eligibility travels in the body, without account identity. */
    public List<UUID> recommendForUser(List<UUID> favorites,List<UUID> history,List<UUID> eligibleIds,
            Set<UUID> excludedIds,Collection<String> dietaryPreferences,int topK) {
        return recommendForUser(favorites,history,eligibleIds,excludedIds,dietaryPreferences,topK,Map.of());
    }
    public List<UUID> recommendForUser(List<UUID> favorites,List<UUID> history,List<UUID> eligibleIds,
            Set<UUID> excludedIds,Collection<String> dietaryPreferences,int topK,Map<String,Object> taste) {
        count(topK);bounded(favorites,100,"Favorites");bounded(history,100,"History");
        bounded(eligibleIds,20000,"Eligible recipes");bounded(excludedIds,20000,"Excluded recipes");
        if(dietaryPreferences==null || dietaryPreferences.size()>20 || dietaryPreferences.stream().anyMatch(value->value==null||value.isBlank()||value.length()>60))throw bad("Dietary preferences are invalid.");
        Map<String,Object> body=new LinkedHashMap<>(Map.of("favorites",List.copyOf(favorites),"history",List.copyOf(history),
                "eligibleIds",List.copyOf(eligibleIds),"excludedIds",excludedIds.stream().sorted().toList(),
                "dietaryPreferences",dietaryPreferences.stream().sorted().toList(),"topK",topK));
        if(taste.containsKey("tasteFeedback")||taste.containsKey("tasteSignals")){body.put("contractVersion","local-ai.v2");body.put("tasteFeedback",taste.getOrDefault("tasteFeedback",List.of()));body.put("tasteSignals",taste.getOrDefault("tasteSignals",Map.of()));}
        return recommendations(call("/recommend/user",HttpMethod.POST,body).getBody(),topK,new HashSet<>(eligibleIds),excludedIds);
    }

    private List<UUID> recommendations(Map<String,Object> body,int topK,Set<UUID> eligible,Set<UUID> excluded) {
        if(!(body.get("recommendations") instanceof List<?> rows) || rows.size()>topK)throw malformed();
        Object count=body.get("count");
        if(count!=null && (!(count instanceof Number number) || number.doubleValue()!=rows.size()))throw malformed();
        LinkedHashSet<UUID> accepted=new LinkedHashSet<>();
        for(Object raw:rows) {
            if(!(raw instanceof List<?> pair) || pair.size()!=2 || !(pair.get(0) instanceof String value)
                    || !(pair.get(1) instanceof Number score) || !Double.isFinite(score.doubleValue()))throw malformed();
            UUID id;
            try{id=UUID.fromString(value);if(!id.toString().equalsIgnoreCase(value))throw malformed();}
            catch(IllegalArgumentException error){throw malformed();}
            if((eligible==null||eligible.contains(id))&&!excluded.contains(id))accepted.add(id);
        }
        return List.copyOf(accepted);
    }

    public ResponseEntity<Map<String,Object>> startPipeline() {
        ResponseEntity<Map<String,Object>> response=call("/pipeline/run",HttpMethod.POST,Map.of());
        Map<String,Object> body=response.getBody();
        if(!(body.get("started") instanceof Boolean) || !(body.get("message") instanceof String) || !(body.get("pipeline") instanceof Map))throw malformed();
        return response;
    }
    public Map<String,Object> pipelineStatus() {
        Map<String,Object> body=call("/pipeline/status",HttpMethod.GET,null).getBody();
        if(!(body.get("pipeline") instanceof Map) || !(body.get("status") instanceof String))throw malformed();
        return body;
    }
    public String triggerPipeline(){return (String)startPipeline().getBody().get("message");}
    public Map<String,Object> getCacheInfo() {
        Map<String,Object> body=call("/cache/info",HttpMethod.GET,null).getBody();
        if(!(body.get("cache_info") instanceof Map) || !(body.get("system_status") instanceof String))throw malformed();
        return body;
    }
    public ResponseEntity<Map<String,Object>> addEmbedding(Map<String,Object> input) {
        if(input==null || !input.keySet().equals(Set.of("id")))throw bad("Provide only one recipe ID.");
        String recipe=id(input.get("id")).toString();
        ResponseEntity<Map<String,Object>> response=call("/embedding/add",HttpMethod.POST,Map.of("id",recipe));
        if(!(response.getBody().get("message") instanceof String) || !recipe.equals(response.getBody().get("recipe_id")))throw malformed();
        return response;
    }
    public ResponseEntity<Map<String,Object>> removeEmbeddings(Map<String,Object> input) {
        if(input==null || !input.keySet().equals(Set.of("ids")) || !(input.get("ids") instanceof List<?> ids) || ids.isEmpty() || ids.size()>1000)throw bad("Provide 1–1000 recipe IDs.");
        List<String> values=ids.stream().map(RecommendationService::id).distinct().map(UUID::toString).toList();
        ResponseEntity<Map<String,Object>> response=call("/embedding/remove",HttpMethod.POST,Map.of("ids",values));
        if(!(response.getBody().get("message") instanceof String) || !values.equals(response.getBody().get("removed_ids")))throw malformed();
        return response;
    }

    private ResponseEntity<Map<String,Object>> call(String path,HttpMethod method,Map<String,Object> body) {
        HttpHeaders headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);
        try {
            RestTemplate client=restTemplate;var control=com.server.letMeCook.security.AIRequestContext.current();
            if(control!=null){if(requestRegistry!=null)requestRegistry.start(control);control.headers(headers);var factory=new org.springframework.http.client.SimpleClientHttpRequestFactory();factory.setConnectTimeout(Math.min(3000,control.remaining()));factory.setReadTimeout(control.remaining());client=new RestTemplate(factory);client.setMessageConverters(restTemplate.getMessageConverters());}
            ResponseEntity<Map<String,Object>> response=client.exchange(origin+path,method,new HttpEntity<>(body,headers),RESPONSE);
            if(control!=null)control.remaining();
            if(!response.getStatusCode().is2xxSuccessful() || response.getBody()==null)throw malformed();
            return ResponseEntity.status(response.getStatusCode()).body(response.getBody());
        } catch(RestClientResponseException error) {
            String message=switch(error.getStatusCode().value()) {
                case 429 -> "Recipe service is busy. Try again shortly.";
                case 503 -> "Recipe service is unavailable. Please retry.";
                case 404 -> "This recipe or worker operation is unavailable.";
                default -> "Recipe service could not complete the request. Please retry.";
            };
            if(error.getStatusCode().value()==429)throw new WorkerBusy(message);
            throw new ResponseStatusException(error.getStatusCode(),message);
        } catch(ResourceAccessException error) {
            if(com.server.letMeCook.security.AIRequestContext.current()!=null)throw com.server.letMeCook.security.AIRequestContext.failure(504,"The local recipe request reached its time limit or could not connect.");
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Recipe service is unavailable or timed out. Please retry.");
        } catch(RestClientException error) {throw malformed();}
    }
    private static UUID id(Object raw) {
        if(!(raw instanceof String value))throw bad("Recipe IDs must be UUIDs.");
        try {UUID id=UUID.fromString(value);if(!id.toString().equalsIgnoreCase(value))throw bad("Recipe IDs must be UUIDs.");return id;}
        catch(IllegalArgumentException error){throw bad("Recipe IDs must be UUIDs.");}
    }
    private static void bounded(Collection<UUID> values,int maximum,String name) {
        if(values==null || values.size()>maximum || values.stream().anyMatch(Objects::isNull))throw bad(name+" must contain at most "+maximum+" recipe IDs.");
    }
    private static void count(int topK){if(topK<1||topK>100)throw bad("topK must be between 1 and 100.");}
    private static final class WorkerBusy extends ResponseStatusException {
        private final HttpHeaders headers;
        private WorkerBusy(String message) {
            super(HttpStatus.TOO_MANY_REQUESTS,message);
            HttpHeaders values=new HttpHeaders();values.set("Retry-After","10");
            headers=HttpHeaders.readOnlyHttpHeaders(values);
        }
        @Override public HttpHeaders getHeaders(){return headers;}
    }
    private static ResponseStatusException bad(String message){return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);}
    private static ResponseStatusException malformed(){return new ResponseStatusException(HttpStatus.BAD_GATEWAY,"Recipe service returned an invalid response. Please retry.");}
}
