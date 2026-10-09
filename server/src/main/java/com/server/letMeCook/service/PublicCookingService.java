package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.KitchenRepository;
import com.server.letMeCook.repository.KitchenRepository.Recipe;
import java.util.*;
import org.jsoup.Jsoup;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import static com.server.letMeCook.repository.KitchenRepository.map;

/** Stateless guest cooking. Never reads a private session or writes a kitchen record. */
@Service
public class PublicCookingService {
    private final KitchenRepository repository;
    private final LocalAIService worker;
    private final PlatformService platform;
    private final ObjectMapper mapper;
    public PublicCookingService(KitchenRepository repository,LocalAIService worker,PlatformService platform,ObjectMapper mapper){this.repository=repository;this.worker=worker;this.platform=platform;this.mapper=mapper;}

    public Map<String,Object> recipe(UUID id){
        requireEnabled(false);Recipe recipe=publicRecipe(id);List<String> steps=CookingSource.steps(recipe.directions());
        return map("contractVersion","guest-cook.v1","recipeId",id.toString(),"recipeTitle",recipe.title(),"steps",steps,
            "sourceUrl",recipe.sourceUrl(),"imageUrl",recipe.imageUrl(),"servings",recipe.servings(),"originalServings",recipe.servings(),
            "ingredients",recipe.ingredients(),"recipeVersion",CookSourceVersion.of(recipe,mapper));
    }
    public Map<String,Object> ask(UUID id,Map<String,Object> input){
        requireEnabled(false);Recipe recipe=versionedRecipe(id,input);List<String> steps=CookingSource.steps(recipe.directions());
        int index=index(input.get("stepIndex"),steps.size());String question=text(input,"question",1000);
        // Caller history and source text cannot replace the trusted recipe snapshot.
        Map<String,Object> response=worker.post("/ai/cook/ask",map("question",question,"steps",steps,"stepIndex",index,"history",List.of()));
        if(response==null)throw error(HttpStatus.BAD_GATEWAY,"The cooking assistant returned no answer.");
        String answer=text(response,"answer",8000);Object supported=response.get("supported");
        if(!(supported instanceof Boolean))throw error(HttpStatus.BAD_GATEWAY,"The cooking assistant returned an invalid answer.");
        Object raw=response.getOrDefault("citations",List.of());
        if(!(raw instanceof List<?> entries)||entries.size()>20)throw error(HttpStatus.BAD_GATEWAY,"The cooking assistant returned invalid citations.");
        List<Map<String,Object>> citations=new ArrayList<>();
        for(Object entry:entries){
            if(!(entry instanceof Map<?,?> citation)||!(citation.get("stepIndex") instanceof Number number)||number.doubleValue()!=number.intValue()||number.intValue()<0||number.intValue()>=steps.size()||!steps.get(number.intValue()).equals(citation.get("text")))throw error(HttpStatus.BAD_GATEWAY,"The cooking assistant returned an invalid source citation.");
            citations.add(map("stepIndex",number.intValue(),"text",steps.get(number.intValue())));
        }
        if(Boolean.TRUE.equals(supported)&&citations.isEmpty())throw error(HttpStatus.BAD_GATEWAY,"The cooking assistant did not provide a source citation.");
        if(Boolean.TRUE.equals(supported)&&citations.stream().noneMatch(citation->citation.get("text").toString().replaceAll("\\s+"," ").contains(answer.replaceAll("\\s+"," "))))throw error(HttpStatus.BAD_GATEWAY,"The cooking assistant returned an answer outside the recipe source.");
        recheck(recipe);
        return map("answer",answer,"supported",supported,"citations",citations,"local",true);
    }
    public Map<String,Object> speak(UUID id,Map<String,Object> input){
        requireEnabled(true);Recipe recipe=versionedRecipe(id,input);List<String> steps=CookingSource.steps(recipe.directions());int index=index(input.get("stepIndex"),steps.size());
        Map<String,Object> response=worker.post("/ai/voice/speak",map("text",steps.get(index),"language","en","sourceRecipeId",id.toString(),"sourceStepIndex",index,"cachePublicSource",true,"verifiedSessionStep",true));
        recheck(recipe);requireEnabled(true);return response;
    }
    public Map<String,Object> timerCue(UUID id,Map<String,Object> input){
        requireEnabled(true);Recipe recipe=versionedRecipe(id,input);
        String label=Jsoup.parse(text(input,"label",100)).text();String phase=text(input,"phase",10);
        String cue=switch(phase){case "due" -> label+" timer finished. Check the recipe and your food before continuing.";case "near" -> label+": thirty seconds or less remaining.";default -> throw error(HttpStatus.BAD_REQUEST,"Choose a timer reminder.");};
        Map<String,Object> result=worker.post("/ai/voice/speak",map("text",cue,"language","en"));recheck(recipe);requireEnabled(true);return result;
    }
    public Map<String,Object> transcribe(UUID id,Map<String,Object> input){
        requireEnabled(true);Recipe recipe=versionedRecipe(id,input);String audio=text(input,"audioBase64",7_000_000),mime=text(input,"mimeType",100);
        if(!Set.of("audio/webm","audio/ogg","audio/wav","audio/x-wav","audio/mp4","audio/m4a").contains(mime.split(";",2)[0].trim().toLowerCase(Locale.ROOT)))throw error(HttpStatus.BAD_REQUEST,"Choose a supported audio recording.");
        try{int bytes=Base64.getDecoder().decode(audio).length;if(bytes==0)throw error(HttpStatus.BAD_REQUEST,"Choose a nonempty recording.");if(bytes>5*1024*1024)throw error(HttpStatus.PAYLOAD_TOO_LARGE,"Maximum recording size is 5 MB.");}catch(IllegalArgumentException failure){throw error(HttpStatus.BAD_REQUEST,"Audio must be base64 encoded.");}
        Map<String,Object> response=worker.post("/ai/voice/transcribe",map("audioBase64",audio,"mimeType",mime));recheck(recipe);requireEnabled(true);return response;
    }
    private Recipe publicRecipe(UUID id){Recipe result=repository.publicRecipes(Set.of(id)).get(id);if(result==null||!result.isPublic())throw error(HttpStatus.NOT_FOUND,"This recipe is unavailable. Choose another recipe.");return result;}
    private Recipe versionedRecipe(UUID id,Map<String,Object> input){Recipe recipe=publicRecipe(id);if(!CookSourceVersion.of(recipe,mapper).equals(text(input,"recipeVersion",64)))throw error(HttpStatus.CONFLICT,"This recipe changed. Reload its cooking steps.");return recipe;}
    private void recheck(Recipe recipe){if(!Objects.equals(recipe,publicRecipe(recipe.id())))throw error(HttpStatus.CONFLICT,"This recipe changed while Sunny was working. Reload its cooking steps.");requireEnabled(false);}
    private void requireEnabled(boolean voice){Map<String,Object> flags=platform.config();if(!Boolean.TRUE.equals(flags.get("kitchenEnabled")))throw error(HttpStatus.SERVICE_UNAVAILABLE,"Cooking tools are currently unavailable.");if(voice&&!Boolean.TRUE.equals(flags.get("voiceEnabled")))throw error(HttpStatus.SERVICE_UNAVAILABLE,"Local voice is currently unavailable. You can follow the written steps.");}
    private static int index(Object raw,int count){if(!(raw instanceof Number number)||number.doubleValue()!=number.intValue()||number.intValue()<0||number.intValue()>=count)throw error(HttpStatus.BAD_REQUEST,"Choose an existing cooking step.");return number.intValue();}
    private static String text(Map<String,Object> body,String key,int max){Object raw=body.get(key);if(!(raw instanceof String value)||value.isBlank()||value.length()>max)throw error(HttpStatus.BAD_REQUEST,key+" must contain 1–"+max+" characters.");return value.trim();}
    private static ResponseStatusException error(HttpStatus status,String message){return new ResponseStatusException(status,message);}
}
