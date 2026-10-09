package com.server.letMeCook.service;

import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.dto.recipe.RecipeSearchFields;
import com.server.letMeCook.security.AIRequestContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;

/** Loopback-only gateway. All model inference and recipe retrieval run locally. */
@Service
public class LocalAIService {
    private final RestTemplate restTemplate;
    private final String baseUrl;
    private final ObjectMapper mapper = new ObjectMapper();
    @Autowired(required=false) private AIRequestRegistry requestRegistry;

    public LocalAIService(RestTemplate restTemplate, @Value("${local-ai.url:http://127.0.0.1:9501}") String baseUrl) {
        this.restTemplate = restTemplate;
        URI uri = URI.create(baseUrl);
        if (!"http".equals(uri.getScheme()) || !Set.of("127.0.0.1", "localhost", "[::1]", "::1").contains(uri.getHost())
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || (uri.getPath() != null && !uri.getPath().isEmpty() && !uri.getPath().equals("/"))) {
            throw new IllegalArgumentException("Local AI URL must be an HTTP loopback origin");
        }
        this.baseUrl = baseUrl.replaceAll("/+$", "");
    }

    public Map<String, Object> status() {
        try {
            return restTemplate.getForObject(baseUrl + "/ai/status", Map.class);
        } catch (RestClientException error) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Local AI service is unavailable.");
        }
    }

    public Map<String, Object> search(Map<String, Object> body) {
        Object prompt = body.getOrDefault("prompt", "");
        if (!(prompt instanceof String value) || value.length() > 2000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Prompt must contain at most 2000 characters.");
        }
        Object ingredients = body.getOrDefault("confirmedIngredients", List.of());
        if (!(ingredients instanceof List<?> values) || values.size() > 20 || values.stream().anyMatch(item ->
                !(item instanceof String term) || term.isBlank() || term.length() > 60)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Confirm at most 20 ingredient names of 1–60 characters.");
        }
        Map<String,Object> request=new java.util.LinkedHashMap<>(Map.of("prompt",prompt,"confirmedIngredients",ingredients));
        if(body.containsKey("clarificationContext")){
            if(!(body.get("clarificationContext") instanceof Map<?,?> context)||context.size()>20)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Confirm the earlier clarification request.");
            try{if(mapper.writeValueAsBytes(context).length>20000)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Clarification is too large.");}catch(java.io.IOException e){throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Clarification is invalid.");}
            request.put("clarificationContext",context);
        }
        if(body.containsKey("clarificationAnswers")){
            if(!(body.get("clarificationAnswers") instanceof Map<?,?> answers)||answers.size()>2||answers.isEmpty()||answers.entrySet().stream().anyMatch(e->!(e.getKey() instanceof String key)||key.isBlank()||key.length()>80||!(e.getValue() instanceof String answer)||answer.isBlank()||answer.length()>200))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Answer up to two clarification questions.");
            if(!request.containsKey("clarificationContext"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Include the original clarification request.");request.put("clarificationAnswers",answers);
        }
        return post("/ai/search",request);
    }

    public Map<String, Object> vision(String image) {
        if (image == null || image.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a JPG, PNG or WebP photo.");
        }
        if (image.length() > 7_000_000) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Maximum photo size is 5 MB.");
        }
        return post("/ai/vision", Map.of("imageBase64", image));
    }

    public RecipeSearchFields extractRecipeSearchFields(String prompt) {
        if (prompt == null || prompt.isBlank() || prompt.length() > 2000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter a request of 1–2000 characters.");
        }
        return mapper.convertValue(post("/ai/parse", Map.of("prompt", prompt)), RecipeSearchFields.class);
    }

    public Map<String, Object> post(String path, Map<String, Object> body) {
        try {
            AIRequestContext.Control control=AIRequestContext.current();
            if(control!=null&&!path.endsWith("/cancel")){
                if(requestRegistry!=null)requestRegistry.start(control);
                HttpHeaders headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);control.headers(headers);
                Map<String,Object> request=new java.util.LinkedHashMap<>(body);request.put("contractVersion","local-ai.v2");
                SimpleClientHttpRequestFactory factory=new SimpleClientHttpRequestFactory();factory.setConnectTimeout(Math.min(3000,control.remaining()));factory.setReadTimeout(control.remaining());
                RestTemplate bounded=new RestTemplate(factory);bounded.setMessageConverters(restTemplate.getMessageConverters());
                Map<String,Object> result=bounded.exchange(baseUrl+path,HttpMethod.POST,new HttpEntity<>(request,headers),Map.class).getBody();control.remaining();return result;
            }
            return restTemplate.postForObject(baseUrl + path, body, Map.class);
        } catch (HttpStatusCodeException error) {
            String message = "Local AI could not process the request. Please retry.";
            try {
                String received = mapper.readTree(error.getResponseBodyAsString()).path("message").asText();
                if (!received.isBlank() && received.length() <= 500) message = received;
            } catch (Exception ignored) { }
            if(error.getStatusCode().is5xxServerError())message=error.getStatusCode().value()==504?"The local AI request reached its time limit.":"Local AI is unavailable. Check its readiness and retry.";
            if(error.getStatusCode().value()==429)throw new Busy(message);
            throw new ResponseStatusException(error.getStatusCode(), message);
        } catch (RestClientException error) {
            if(AIRequestContext.current()!=null&&error instanceof org.springframework.web.client.ResourceAccessException)throw AIRequestContext.failure(504,"The local AI request reached its time limit or could not connect. Retry when it is ready.");
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Local AI unavailable or timed out. Check Ollama and retry.");
        }
    }
    private static final class Busy extends ResponseStatusException {
        private final HttpHeaders headers;
        private Busy(String message){super(HttpStatus.TOO_MANY_REQUESTS,message);HttpHeaders values=new HttpHeaders();values.set("Retry-After","10");headers=HttpHeaders.readOnlyHttpHeaders(values);}
        @Override public HttpHeaders getHeaders(){return headers;}
    }
}
